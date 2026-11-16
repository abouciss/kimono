import "server-only";

import { Innertube, Platform } from "youtubei.js";
import { matchScore, MusicProblem, plainTitle, songOfVideo, videoTrack, type Candidate, type Track } from "./model";
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

const g = globalThis as unknown as { kimonoMusicYt?: { yt: Promise<Innertube>; until: number }; kimonoMusicSearch?: { yt: Promise<Innertube>; until: number } };

/* Finding a song needs no proof of a real player: a plain session, so a search never waits on (or fails with) BotGuard. */
async function searchSession(): Promise<Innertube> {
  const now = Date.now();
  if (g.kimonoMusicSearch && now < g.kimonoMusicSearch.until) return g.kimonoMusicSearch.yt;
  const made = Innertube.create({ retrieve_player: false, generate_session_locally: true });
  g.kimonoMusicSearch = { yt: made, until: now + 6 * 3600_000 };
  made.catch(() => { if (g.kimonoMusicSearch?.yt === made) g.kimonoMusicSearch = undefined; });
  return made;
}

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

type Thumbs = { thumbnails?: { url: string; width?: number }[]; contents?: { url: string; width?: number }[] } | { url: string; width?: number }[] | undefined;
/** The largest of YouTube's thumbnails, square ones (YouTube Music's) preferred as they are. */
function bestThumb(t: Thumbs): string | null {
  const list = Array.isArray(t) ? t : t?.thumbnails ?? t?.contents ?? [];
  const top = [...list].sort((a, b) => (b.width ?? 0) - (a.width ?? 0))[0]?.url ?? null;
  /* YouTube Music's art comes sized in its address (=w60-h60): ask for a big one. */
  return top ? top.replace(/=w\d+-h\d+/, "=w600-h600") : null;
}

type Found = Candidate & { cover: string | null; album: string | null };

async function candidates(yt: Innertube, query: string, type: "song" | "video"): Promise<Found[]> {
  const res = await yt.music.search(query, { type });
  const shelf = type === "song" ? res.songs : res.videos;
  return (shelf?.contents ?? []).flatMap((item) => {
    const it = item as unknown as { id?: string; title?: string; artists?: { name: string }[]; authors?: { name: string }[]; duration?: { seconds: number }; thumbnail?: Thumbs; thumbnails?: Thumbs; album?: { name?: string } };
    if (!it.id || !it.title) return [];
    return [{ id: it.id, title: it.title, artists: (it.artists ?? it.authors ?? []).map((a) => a.name), seconds: it.duration?.seconds ?? 0, kind: type, cover: bestThumb(it.thumbnail ?? it.thumbnails), album: it.album?.name ?? null }];
  });
}

/**
 * What YouTube Music has for a search: its own songs, and videos that are
 * plainly one song ("3rd Coast - Jealousy (Lyrics)"), read as that song.
 * For what Deezer doesn't carry: game and anime music, niche uploads.
 */
export async function searchYouTube(text: string): Promise<{ songs: Track[]; videos: Track[] }> {
  const yt = await searchSession();
  const allowed = plainTitle(text);
  const [songs, videos] = await Promise.all([candidates(yt, text, "song").catch(() => []), candidates(yt, text, "video").catch(() => [])]);
  return {
    songs: songs.filter((c) => c.seconds > 0).slice(0, 12).map((c) => videoTrack({ id: c.id, title: c.title, artists: c.artists, seconds: c.seconds, cover: c.cover, album: c.album })),
    videos: videos.flatMap((c) => {
      /* A song is a few minutes: not a 30-second clip, not an hour. */
      if (c.seconds < 45 || c.seconds > 900) return [];
      const song = songOfVideo(c.title, c.artists[0] ?? "", allowed);
      return song ? [videoTrack({ id: c.id, title: song.title, artists: song.artists, seconds: c.seconds, cover: c.cover })] : [];
    }).slice(0, 8),
  };
}

/**
 * A song Deezer doesn't have, found on YouTube Music as a song of its own (a
 * label's or a Topic channel's upload; never a video): the same title, the
 * same artist, within seconds of its length. Null when there's none.
 */
export async function songOnYouTube(want: { title: string; artists: string[]; seconds: number }): Promise<Track | null> {
  const yt = await searchSession();
  const like: Track = { key: "", title: want.title, artists: want.artists.map((name) => ({ key: "", name })), album: null, duration: want.seconds, isrc: null, explicit: false, rank: 0 };
  const query = `${want.artists[0] ?? ""} ${want.title.replace(/\s*[([](feat|ft|with)\.?\s[^)\]]*[)\]]/gi, "")}`.trim();
  let best: { c: Found; s: number } | null = null;
  /* Only YouTube Music's own songs: a video (a gameplay run, a piano cover, a fan edit) borrows a song's name too easily. */
  for (const type of ["song"] as const) {
    for (const c of await candidates(yt, query, type).catch(() => [])) {
      if (!c.artists.length) continue;
      const s = matchScore(like, c);
      if (s > 0 && (!best || s > best.s)) best = { c, s };
    }
    if (best && best.s >= 12) break;
  }
  if (!best) return null;
  const c = best.c;
  return videoTrack({ id: c.id, title: c.title, artists: c.artists, seconds: c.seconds || want.seconds, cover: c.cover, album: c.album });
}

/** A YouTube video as a song: its title, its channel, its length and its thumbnail. */
export async function videoAsTrack(id: string): Promise<Track | null> {
  const yt = await searchSession();
  const info = await yt.music.getInfo(id).catch(() => null) ?? await yt.getBasicInfo(id).catch(() => null);
  const b = info?.basic_info as { title?: string; author?: string; duration?: number; thumbnail?: { url: string; width?: number }[] } | undefined;
  if (!b?.title) return null;
  return videoTrack({ id, title: b.title, artists: b.author ? [b.author] : [], seconds: b.duration ?? 0, cover: bestThumb(b.thumbnail) });
}

/** The YouTube video id of this recording, or null when nothing matches well enough. */
export async function findRecording(track: Track): Promise<string | null> {
  const yt = await searchSession();
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

/** A public YouTube or YouTube Music playlist, as names: what an import matches against the catalogue. */
export async function playlistOf(id: string, max = 5000) {
  const yt = await searchSession();
  let page = await yt.music.getPlaylist(id);
  const header = page.header as unknown as { title?: { toString(): string }; thumbnail?: { contents?: { url: string }[] } } | undefined;
  const items = [...(page.items ?? [])];
  while (page.has_continuation && items.length < max) { page = await page.getContinuation(); items.push(...(page.items ?? [])); }
  return {
    name: header?.title?.toString() ?? "",
    cover: header?.thumbnail?.contents?.[0]?.url ?? null,
    items: items.slice(0, max).flatMap((item) => {
      const it = item as unknown as { id?: string; title?: string; authors?: { name: string }[]; artists?: { name: string }[]; album?: { name?: string }; duration?: { seconds: number }; thumbnail?: Thumbs; thumbnails?: Thumbs };
      if (!it.title) return [];
      return [{ id: it.id ?? null, title: it.title, artists: (it.artists ?? it.authors ?? []).map((a) => a.name), album: it.album?.name ?? null, seconds: it.duration?.seconds ?? 0, cover: bestThumb(it.thumbnail ?? it.thumbnails) }];
    }),
  };
}
