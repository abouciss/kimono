import "server-only";

import { closeSync, mkdirSync, openSync, readFileSync, readSync, renameSync, rmSync, statfsSync, statSync, writeFileSync, writeSync } from "node:fs";
import { join } from "node:path";
import { stateDir } from "../state";
import type { MusicConfig } from "./config";
import { MusicProblem } from "./model";

import { forgetSession, forgetStream, streamOf } from "./youtube";

/*
 * 音 A song's audio, kept on the server's disk once anyone has played it.
 *
 * It's fetched into the cache once, two ways: the Portal's own YouTube.js,
 * which starts in well under a second; and when that fails (YouTube changed
 * something, the token was turned down), the yt-dlp fetcher beside the
 * Portal, which is slower to start (YouTube makes it wait a few seconds) but
 * finds a way. After a fast-path failure the fast path sits out for a while,
 * so a broken YouTube.js costs a few seconds per song, never the song.
 *
 * Players don't wait for the whole file: a range is answered as soon as its
 * bytes have arrived. Least recently played songs make room past the cap
 * (KIMONO_MUSIC_CACHE_GB, 100 GB by default), or when the disk gets down to its last 10 GB.
 */

const dir = join(stateDir, "music", "audio");
const capBytes = (Number(process.env.KIMONO_MUSIC_CACHE_GB) || 100) * 1024 ** 3;
const leaveFree = 10 * 1024 ** 3;
const freeOnDisk = () => { try { const f = statfsSync(dir); return f.bavail * f.bsize; } catch { return Infinity; } };
const chunk = 2 * 1024 * 1024;

type Entry = { size: number; mime: string; at: number };
type Job = { size: number; mime: string; got: number; done: boolean; failed: Error | null; wake: Set<() => void>; via: "youtube.js" | "yt-dlp" };

const g = globalThis as unknown as { kimonoMusicAudio?: { index: Record<string, Entry>; jobs: Map<string, Job>; fastOffUntil: number } };
const state = () => {
  if (!g.kimonoMusicAudio) {
    mkdirSync(dir, { recursive: true, mode: 0o700 });
    let index: Record<string, Entry> = {};
    try { index = JSON.parse(readFileSync(join(dir, "index.json"), "utf8")) as Record<string, Entry>; } catch { /* a fresh cache */ }
    g.kimonoMusicAudio = { index, jobs: new Map(), fastOffUntil: 0 };
  }
  return g.kimonoMusicAudio;
};

const fileOf = (videoId: string) => join(dir, `${videoId}.m4a`);
const partOf = (videoId: string) => join(dir, `${videoId}.m4a.part`);

let last = 0;
const tick = () => (last = Math.max(Date.now(), last + 1));

function writeIndex() {
  const tmp = join(dir, "index.json.tmp");
  writeFileSync(tmp, JSON.stringify(state().index), { mode: 0o600 });
  renameSync(tmp, join(dir, "index.json"));
}

function kept(videoId: string): Entry | null {
  const s = state();
  const entry = s.index[videoId];
  if (!entry) return null;
  try { if (statSync(fileOf(videoId)).size !== entry.size) throw new Error("changed"); }
  catch { delete s.index[videoId]; writeIndex(); return null; }
  entry.at = tick();
  return entry;
}

function evict() {
  const s = state();
  let total = Object.values(s.index).reduce((n, e) => n + e.size, 0);
  let free = freeOnDisk();
  for (const [id, e] of Object.entries(s.index).sort((a, b) => a[1].at - b[1].at)) {
    if (total <= capBytes && free >= leaveFree) break;
    if (s.jobs.has(id)) continue;
    rmSync(fileOf(id), { force: true });
    delete s.index[id];
    total -= e.size;
    free += e.size;
  }
}

/* ── Filling ───────────────────────────────────────────────────────────── */

type Source = { size: number; mime: string; body: AsyncIterable<Uint8Array> };

/* The fast way: the address YouTube.js found, asked a couple of megabytes at a time (bigger asks get slowed down). */
async function viaYoutubeJs(videoId: string): Promise<Source> {
  const stream = await streamOf(videoId);
  const first = await fetch(stream.url, { headers: { range: `bytes=0-${Math.min(chunk, stream.size) - 1}` }, signal: AbortSignal.timeout(15_000) });
  if (first.status !== 206 && first.status !== 200) {
    forgetStream(videoId);
    if (first.status === 403) forgetSession();
    throw new MusicProblem(`YouTube turned the audio down (${first.status})`);
  }
  async function* body() {
    yield new Uint8Array(await first.arrayBuffer());
    for (let at = chunk; at < stream.size; at += chunk) {
      const end = Math.min(at + chunk, stream.size) - 1;
      const res = await fetch(stream.url, { headers: { range: `bytes=${at}-${end}` }, signal: AbortSignal.timeout(30_000) });
      if (res.status !== 206) { forgetStream(videoId); throw new MusicProblem(`YouTube stopped sending at ${at} bytes (${res.status})`); }
      yield new Uint8Array(await res.arrayBuffer());
    }
  }
  return { size: stream.size, mime: stream.mime, body: body() };
}

/* The sturdy way: yt-dlp beside the Portal, which sends the song as it downloads. */
async function viaYtDlp(config: MusicConfig, videoId: string): Promise<Source> {
  if (!config.fetcher.key) throw new MusicProblem("Music's fetcher isn't set up.", 503);
  const res = await fetch(`${config.fetcher.url}/audio/${encodeURIComponent(videoId)}`, { headers: { "x-kimono-key": config.fetcher.key }, signal: AbortSignal.timeout(120_000) });
  if (!res.ok || !res.body) throw new MusicProblem(`The fetcher couldn't get it: ${(await res.text().catch(() => "")).slice(0, 200) || res.status}`, res.status === 404 ? 404 : 502);
  const size = Number(res.headers.get("content-length"));
  if (!size) throw new MusicProblem("The fetcher sent no length.");
  return { size, mime: res.headers.get("content-type")?.split(";")[0] || "audio/mp4", body: res.body as unknown as AsyncIterable<Uint8Array> };
}

const wakeAll = (job: Job) => { for (const w of job.wake) w(); job.wake.clear(); };

async function fill(config: MusicConfig, videoId: string, job: Job, ready: (ok: boolean) => void) {
  const s = state();
  const part = partOf(videoId);
  const fd = openSync(part, "w", 0o600);
  try {
    let source: Source | null = null;
    let triedFast = false;
    /* KIMONO_MUSIC_YOUTUBEJS=off sends every song through yt-dlp (to test it, or while YouTube.js misbehaves). */
    const fastAllowed = process.env.KIMONO_MUSIC_YOUTUBEJS !== "off";
    if (fastAllowed && Date.now() >= s.fastOffUntil) {
      triedFast = true;
      try { source = await viaYoutubeJs(videoId); }
      catch (error) {
        /* Sits out ten minutes, then gets another go. */
        s.fastOffUntil = Date.now() + 10 * 60_000;
        console.warn(`music: youtube.js couldn't get ${videoId}, using yt-dlp for a while: ${error instanceof Error ? error.message : error}`);
      }
    }
    let skip = 0;
    for (let attempt = 0; ; attempt++) {
      if (!source) {
        try { source = await viaYtDlp(config, videoId); job.via = "yt-dlp"; }
        catch (error) {
          /* yt-dlp failing too: YouTube.js gets a go even while it's sitting out, rather than the song failing. */
          if (!fastAllowed || triedFast || job.got) throw error;
          triedFast = true;
          source = await viaYoutubeJs(videoId);
          job.via = "youtube.js";
        }
      }
      job.size = source.size; job.mime = source.mime;
      ready(true);
      try {
        for await (const piece of source.body) {
          /* A second try starts from the top: what's already written is passed over. */
          let bytes = piece;
          if (skip) { const drop = Math.min(skip, bytes.length); bytes = bytes.subarray(drop); skip -= drop; }
          if (!bytes.length) continue;
          writeSync(fd, bytes, 0, bytes.length, job.got);
          job.got += bytes.length;
          wakeAll(job);
        }
        if (job.got !== job.size) throw new MusicProblem(`short: ${job.got} of ${job.size}`);
        break;
      } catch (error) {
        /* The fast path gave out partway: yt-dlp carries on from where it got to. */
        if (attempt === 0 && job.via === "youtube.js") {
          s.fastOffUntil = Date.now() + 10 * 60_000;
          console.warn(`music: youtube.js stopped partway through ${videoId}: ${error instanceof Error ? error.message : error}`);
          source = null; skip = job.got;
          continue;
        }
        throw error;
      }
    }
    closeSync(fd);
    renameSync(part, fileOf(videoId));
    s.index[videoId] = { size: job.size, mime: job.mime, at: tick() };
    evict();
    writeIndex();
  } catch (error) {
    try { closeSync(fd); } catch { /* closed */ }
    rmSync(part, { force: true });
    job.failed = error instanceof Error ? error : new Error(String(error));
    console.warn(`music: couldn't get ${videoId}: ${job.failed.message}`);
    ready(false);
  } finally {
    job.done = true;
    wakeAll(job);
    s.jobs.delete(videoId);
  }
}

/** Starts getting a song into the cache (once, however many ask), and answers when its length is known. */
async function begin(config: MusicConfig, videoId: string): Promise<Job | Entry> {
  const entry = kept(videoId);
  if (entry) return entry;
  const s = state();
  let job = s.jobs.get(videoId);
  if (!job) {
    job = { size: 0, mime: "audio/mp4", got: 0, done: false, failed: null, wake: new Set(), via: "youtube.js" };
    s.jobs.set(videoId, job);
    const started = job;
    await new Promise<boolean>((ready) => void fill(config, videoId, started, ready));
  } else if (!job.size && !job.done) {
    const waiting = job;
    await new Promise<void>((woke) => { waiting.wake.add(woke); });
    while (!waiting.size && !waiting.done) await new Promise<void>((woke) => { waiting.wake.add(woke); });
  }
  if (job.failed) throw new MusicProblem("This song won't play right now.", 502);
  return job;
}

/** Gets a song ready ahead of being played (the next in the queue), without waiting for it. */
export function prefetch(config: MusicConfig, videoId: string) {
  if (kept(videoId) || state().jobs.has(videoId)) return;
  void begin(config, videoId).catch(() => null);
}

export type Served = { body: ReadableStream<Uint8Array>; size: number; mime: string; range: { start: number; end: number } | null };

/** A song's audio, whole or a byte range, from the cache, waiting for bytes still on their way. */
export async function serveAudio(config: MusicConfig, videoId: string, range?: { start: number; end?: number }): Promise<Served> {
  const got = await begin(config, videoId);
  const job = "wake" in got ? got : null;
  const size = got.size;
  if (range && range.start >= size) throw new MusicProblem("That range isn't in the song.", 416);
  const start = range?.start ?? 0;
  const end = Math.min(range?.end ?? size - 1, size - 1);
  let at = start;
  let fd: number | null = null;
  const open = () => {
    if (fd !== null) return fd;
    /* The finished file if it's there, else the part being written (the same bytes, the rename keeps an open file). */
    try { fd = openSync(fileOf(videoId), "r"); } catch { fd = openSync(partOf(videoId), "r"); }
    return fd;
  };
  const body = new ReadableStream<Uint8Array>({
    async pull(controller) {
      try {
        if (at > end) { controller.close(); if (fd !== null) closeSync(fd); fd = null; return; }
        while (job && !job.done && job.got <= at) await new Promise<void>((woke) => { job.wake.add(woke); });
        const available = job && !job.done ? job.got : size;
        if (job?.failed || available <= at) throw new Error("the song stopped arriving");
        const want = Math.min(256 * 1024, end + 1 - at, available - at);
        const buf = Buffer.alloc(want);
        const n = readSync(open(), buf, 0, want, at);
        if (n <= 0) throw new Error("nothing to read");
        at += n;
        controller.enqueue(new Uint8Array(buf.buffer, buf.byteOffset, n));
      } catch (error) {
        if (fd !== null) { try { closeSync(fd); } catch { /* closed */ } fd = null; }
        controller.error(error);
      }
    },
    cancel() { if (fd !== null) { try { closeSync(fd); } catch { /* closed */ } fd = null; } },
  });
  return { body, size, mime: got.mime, range: range ? { start, end } : null };
}

/** How far a song has got into the cache: kept, on its way (bytes so far of how many), or not started. */
export function audioStatus(videoId: string): { ready: true } | { ready: false; got: number; size: number } | null {
  if (kept(videoId)) return { ready: true };
  const job = state().jobs.get(videoId);
  return job ? { ready: false, got: job.got, size: job.size } : null;
}

/** How playback is getting songs now, for the admin page. */
export function audioHealth() {
  const s = state();
  return { fastPath: Date.now() >= s.fastOffUntil, keptSongs: Object.keys(s.index).length, keptBytes: Object.values(s.index).reduce((n, e) => n + e.size, 0) };
}
