/**
 * The scrubber's pictures, made once per file and kept (what Jellyfin calls
 * trickplay): a frame every ten seconds, a hundred to a JPEG sheet. A player
 * loads the sheets and shows a tile as the pointer moves along the bar, so
 * hovering costs no video work.
 *
 * The packager makes them (infra/compose/server/watch-packager/trickplay.go)
 * with one small read per frame. Debrid answers those in under a second; a
 * Usenet read takes several, so Usenet copies get none and their scrubber
 * shows what it did before.
 *
 * The sheets live on disk under the release's key, the index in the cache
 * table. One file is worked on at a time; the next episode's are made while
 * this one plays.
 */
import { existsSync, mkdirSync, readdirSync, renameSync, rmSync, statSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { DatabaseSync } from "node:sqlite";
import { releaseKey } from "./markers";
import { cached, keep } from "./model";
import type { Release } from "./releases";

/** What a player needs to cut a tile out: sheets are `cols` by `rows` tiles of `width` by `height`, `count` frames `interval` seconds apart. */
export type Trickplay = { interval: number; width: number; height: number; cols: number; rows: number; count: number; sheets: number };

export type TrickDeps = {
  db: DatabaseSync;
  /** Where sheets are kept: a folder per release. */
  dir: string;
  packager: (path: string, body: Record<string, unknown>, timeoutMs: number) => Promise<Record<string, unknown> | null>;
  /** The Portal's own relay address for a release, as the packager reads it. */
  input: (release: Release) => string;
};

const keepFor = 180 * 24 * 60 * 60 * 1000;
/* A file that couldn't be read isn't tried again on every play. */
const retryAfter = 6 * 60 * 60 * 1000;
/* About a gigabyte of sheets at most; the ones made longest ago go first. */
const mostKept = 400;
const indexKey = (rk: string) => `trickplay:${rk}`;
const failedKey = (rk: string) => `trickplay:failed:${rk}`;

const state = globalThis as unknown as { kimonoWatchTrickplay?: { queue: Promise<void>; queued: Set<string> } };
const work = (state.kimonoWatchTrickplay ??= { queue: Promise.resolve(), queued: new Set() });

/** Copies that get pictures: the ones a seek is quick on. */
export const tricked = (release: Pick<Release, "service">) => release.service === "debrid";

/** A release's sheets, if they have been made and are still there. */
export function trickplayOf(db: DatabaseSync, dir: string, rk: string): Trickplay | null {
  const known = cached<Trickplay>(db, indexKey(rk));
  return known && existsSync(join(dir, rk, "0.jpg")) ? known : null;
}

/** Makes a release's sheets in the background, unless they exist, are on their way, or just failed. */
export function trickLater(deps: TrickDeps, release: Release) {
  if (!tricked(release)) return;
  const rk = releaseKey(release);
  if (work.queued.has(rk) || trickplayOf(deps.db, deps.dir, rk) || cached(deps.db, failedKey(rk))) return;
  work.queued.add(rk);
  work.queue = work.queue.then(() => make(deps, release, rk)).catch((error) => {
    keep(deps.db, failedKey(rk), 1, retryAfter);
    console.warn("Watch couldn't make scrubber pictures:", error instanceof Error ? error.message : error);
  }).finally(() => { work.queued.delete(rk); });
}

const whole = (value: unknown, least: number, most: number) => (typeof value === "number" && Number.isInteger(value) && value >= least && value <= most ? value : null);

async function make(deps: TrickDeps, release: Release, rk: string) {
  const body = await deps.packager("/trickplay", { input: deps.input(release), interval: 10, width: 320 }, 50 * 60_000);
  const sheets = Array.isArray(body?.sheets) ? (body.sheets as unknown[]).filter((s): s is string => typeof s === "string" && s.length > 0) : [];
  const [width, height, cols, rows, count] = [whole(body?.width, 16, 1024), whole(body?.height, 16, 1024), whole(body?.cols, 1, 50), whole(body?.rows, 1, 50), whole(body?.count, 1, 100_000)];
  const interval = typeof body?.interval === "number" && body.interval > 0 ? body.interval : null;
  if (!body || !sheets.length || !width || !height || !cols || !rows || !count || !interval || sheets.length !== Math.ceil(count / (cols * rows))) throw new Error("the packager made none");
  /* Written beside, then moved into place: a player never reads half a set. */
  const folder = join(deps.dir, rk), fresh = `${folder}.new`;
  rmSync(fresh, { recursive: true, force: true });
  mkdirSync(fresh, { recursive: true, mode: 0o700 });
  sheets.forEach((sheet, n) => writeFileSync(join(fresh, `${n}.jpg`), Buffer.from(sheet, "base64"), { mode: 0o600 }));
  rmSync(folder, { recursive: true, force: true });
  renameSync(fresh, folder);
  keep(deps.db, indexKey(rk), { interval, width, height, cols, rows, count, sheets: sheets.length } satisfies Trickplay, keepFor);
  console.info(`Watch scrubber pictures for ${release.filename || release.name}: ${count} on ${sheets.length} sheets in ${Math.round((Number(body.ms) || 0) / 1000)}s`);
  prune(deps.dir);
}

function prune(dir: string) {
  try {
    const folders = readdirSync(dir).filter((name) => !name.endsWith(".new")).map((name) => ({ name, made: statSync(join(dir, name)).mtimeMs })).sort((a, b) => b.made - a.made);
    for (const old of folders.slice(mostKept)) rmSync(join(dir, old.name), { recursive: true, force: true });
  } catch { /* nothing kept yet */ }
}

/** The path of one sheet, or null when the name isn't one. */
export function sheetPath(dir: string, rk: string, file: string, known: Trickplay): string | null {
  const n = /^(\d{1,4})\.jpg$/.exec(file);
  return n && /^[0-9a-f]{24}$/.test(rk) && Number(n[1]) < known.sheets ? join(dir, rk, `${Number(n[1])}.jpg`) : null;
}
