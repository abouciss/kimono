import "server-only";

import { Innertube, Platform } from "youtubei.js";
import { matchScore, MusicProblem, type Candidate, type Track } from "./model";
import { poExpires, poToken } from "./po-token";

/*
 * YouTube.js asks for an evaluator to run the player's signature and "n"
 * functions it extracts (its own throws). Only that extracted code runs here,
 * the same code a browser's YouTube player would run.
 */
Platform.shim.eval = async (data: { output: string }, env: Record<string, string | undefined>) => {
  const props: string[] = [];
  if (env.n) props.push(`n: exportedVars.nFunction(${JSON.stringify(env.n)})`);
  if (env.sig) props.push(`sig: exportedVars.sigFunction(${JSON.stringify(env.sig)})`);
  return new Function(`${data.output}\nreturn { ${props.join(", ")} }`)();
};

/*
 * Playing a recording: YouTube Music finds it (by its ISRC first, which lands
 * on the label's own upload, then by artist and title within a few seconds of
 * its length) and YouTube.js gives its audio's address. That address only
 * works from the server that asked for it, so the Portal fetches the audio
 * and the listener's player gets it from the Portal (./audio.ts).
 */

const g = globalThis as unknown as { kimonoMusicYt?: { yt: Promise<Innertube>; until: number } };

async function session(): Promise<Innertube> {
  const now = Date.now();
  if (g.kimonoMusicYt && now < g.kimonoMusicYt.until) return g.kimonoMusicYt.yt;
  const made = (async () => {
    /* A visitor first, then a session whose requests carry that visitor's token. */
    const plain = await Innertube.create({ retrieve_player: false, generate_session_locally: true });
    const visitor = plain.session.context.client.visitorData;
    if (!visitor) throw new MusicProblem("YouTube gave no visitor id.");
    const po = await poToken(visitor);
    return Innertube.create({ po_token: po, visitor_data: visitor, retrieve_player: true, generate_session_locally: true });
  })();
  g.kimonoMusicYt = { yt: made, until: now + 60_000 };
  try {
    const yt = await made;
    /* Kept until BotGuard's run ends, or six hours, whichever comes first. */
    g.kimonoMusicYt = { yt: made, until: Math.min((await poExpires()) || now + 6 * 3600_000, now + 6 * 3600_000) };
    return yt;
  } catch (error) {
    if (g.kimonoMusicYt?.yt === made) g.kimonoMusicYt = undefined;
    throw error;
  }
}

/** Drops the session, so the next request makes a fresh one (after YouTube turned one down). */
export function forgetSession() { g.kimonoMusicYt = undefined; }

async function candidates(yt: Innertube, query: string, type: "song" | "video"): Promise<Candidate[]> {
  const res = await yt.music.search(query, { type });
  const shelf = type === "song" ? res.songs : res.videos;
  return (shelf?.contents ?? []).flatMap((item) => {
    const it = item as unknown as { id?: string; title?: string; artists?: { name: string }[]; authors?: { name: string }[]; duration?: { seconds: number } };
    if (!it.id || !it.title) return [];
    return [{ id: it.id, title: it.title, artists: (it.artists ?? it.authors ?? []).map((a) => a.name), seconds: it.duration?.seconds ?? 0, kind: type }];
  });
}

/** The YouTube video id of this recording, or null when nothing matches well enough. */
export async function findRecording(track: Track): Promise<string | null> {
  const yt = await session();
  const artist = track.artists[0]?.name ?? "";
  /* YouTube Music's search is fuzzy about ISRCs (it finds look-alike strings), so it's asked by name. */
  const query = `${artist} ${track.title.replace(/\s*[([](feat|ft|with)\.?\s[^)\]]*[)\]]/gi, "")}`;
  const queries: [string, "song" | "video"][] = [[query, "song"], [query, "video"]];
  let best: { id: string; s: number } | null = null;
  for (const [query, type] of queries) {
    const found = await candidates(yt, query, type).catch(() => []);
    for (const c of found) {
      const s = matchScore(track, c);
      if (s > 0 && (!best || s > best.s)) best = { id: c.id, s };
    }
    /* The artist's own release of it: no need to look through videos. */
    if (best && best.s >= 12) break;
  }
  return best?.id ?? null;
}

export type Stream = { url: string; size: number; mime: string; expires: number };

const streams = new Map<string, Stream>();

/** Where this video's audio is, as AAC in MP4 (every browser, and the phones, play it). Kept until its address expires. */
export async function streamOf(videoId: string): Promise<Stream> {
  const known = streams.get(videoId);
  if (known && Date.now() < known.expires) return known;
  const yt = await session();
  const info = await yt.getBasicInfo(videoId, { client: "YTMUSIC" });
  if (info.playability_status?.status && info.playability_status.status !== "OK") throw new MusicProblem(`YouTube won't play it: ${info.playability_status.reason ?? info.playability_status.status}`, 404);
  const formats = (info.streaming_data?.adaptive_formats ?? []).filter((f) => f.has_audio && !f.has_video && f.mime_type.startsWith("audio/mp4"));
  const format = formats.sort((a, b) => (b.bitrate ?? 0) - (a.bitrate ?? 0))[0];
  if (!format?.content_length) throw new MusicProblem("YouTube has no audio for it.", 404);
  const address = new URL(await format.decipher(yt.session.player));
  address.searchParams.set("pot", await poToken(videoId));
  const expires = Number(address.searchParams.get("expire")) * 1000 || Date.now() + 3 * 3600_000;
  const stream = { url: address.toString(), size: Number(format.content_length), mime: format.mime_type.split(";")[0], expires: expires - 10 * 60_000 };
  streams.set(videoId, stream);
  if (streams.size > 500) for (const [k, v] of streams) if (Date.now() >= v.expires) streams.delete(k);
  return stream;
}

export function forgetStream(videoId: string) { streams.delete(videoId); }
