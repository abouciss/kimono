/**
 * 音 Kimono Music: one shape for a track, an album and an artist, whatever
 * Deezer called them. Pure (no requests, no database).
 *
 * Keys are Deezer's ids with a prefix (`dz:3135556`): a track's page, its
 * place in a playlist and its stream all go by that key.
 */

export type ArtistRef = { key: string; name: string };

export type Track = {
  key: string;
  title: string;
  artists: ArtistRef[];
  album: { key: string; title: string; cover: string | null } | null;
  /** Seconds. */
  duration: number;
  isrc: string | null;
  explicit: boolean;
  /** Deezer's popularity, for ordering. */
  rank: number;
};

export type Album = {
  key: string;
  title: string;
  artist: ArtistRef | null;
  cover: string | null;
  year: number | null;
  kind: "album" | "single" | "ep" | "compile";
  genres: string[];
  tracks: Track[];
};

export type Artist = {
  key: string;
  name: string;
  picture: string | null;
  fans: number;
  /** Last.fm's tags, else Deezer's album genres. */
  tags: string[];
};

export type Rating = "down" | "up" | "love";
export type RatedKind = "track" | "album" | "artist";

export type Lyrics = { synced: { at: number; line: string }[] | null; plain: string | null; instrumental: boolean };

export type Playlist = { id: string; name: string; count: number; covers: string[]; updatedAt: string };

export type Row<T = Track> = { id: string; title: string; items: T[] };

export class MusicProblem extends Error {
  constructor(message: string, readonly status = 502) { super(message); }
}

export const deezerId = (key: string): string | null => /^dz:(\d{1,20})$/.exec(key)?.[1] ?? null;

/** For matching a recording elsewhere: no "(feat. …)", "- Radio Edit", accents or punctuation. */
export function plainTitle(title: string): string {
  return title.toLowerCase()
    .normalize("NFKD").replace(/\p{M}/gu, "")
    .replace(/\s*[([](feat|ft|with)\.?\s[^)\]]*[)\]]/g, "")
    .replace(/[^\p{L}\p{N}]+/gu, " ").trim();
}

/* ── Finding the recording on YouTube Music ─────────────────────────────── */

/** A YouTube Music search result, as matching sees it. */
export type Candidate = { id: string; title: string; artists: string[]; seconds: number; kind: "song" | "video" };

/* Words that make an upload something else than the recording, unless the song itself is one. */
const otherVersion = /\b(cover(?:ed|s)?|tribute|mashup|medley|parody|live|remix(?:ed)?|slowed|reverb|sped up|nightcore|karaoke|instrumental|acoustic|8d|bass|piano|guitar|lyrics? video|reaction|tutorial|432 ?hz)\b/;

/* How sure a YouTube Music result is the recording: 0 is no, higher is better. */
export function matchScore(track: Track, c: Candidate): number {
  const off = Math.abs(c.seconds - track.duration);
  /* A label's "song" is the recording as released; a music video can open with a scene before it. */
  if (track.duration && off > (c.kind === "song" ? 8 : 20)) return 0;
  /* The song's own name, without "(Radio Edit)", "[feat. …]" or " - Remastered": length tells those apart. */
  const core = plainTitle(track.title.replace(/\s*[([][^)\]]*[)\]]/g, "").replace(/\s+-\s+.*$/, "")) || plainTitle(track.title);
  const want = plainTitle(track.title), got = plainTitle(c.title);
  if (!core || !` ${got} `.includes(` ${core} `)) return 0;
  const versions = new Set([...got.matchAll(new RegExp(otherVersion, "g"))].map((m) => m[0]));
  for (const v of versions) if (!want.includes(v)) return 0;
  const names = track.artists.map((a) => plainTitle(a.name)).filter(Boolean);
  const by = plainTitle(c.artists.join(" "));
  const theirs = names.some((n) => by.includes(n));
  /* A video naming the artist only in its title is someone else's upload: kept as a last resort. */
  if (!theirs && !(c.kind === "video" && names.some((n) => got.includes(n)))) return 0;
  /* The closer the title and length, the better; the artist's own upload, and a song over a video. */
  return (c.kind === "song" ? 10 : 6) + (theirs ? 4 : 0) + (got === want || got === core ? 3 : 0) - off / (c.kind === "song" ? 2 : 4);
}

/** LRCLIB's "[mm:ss.xx] line" into seconds and lines. */
export function parseLrc(lrc: string): { at: number; line: string }[] {
  const out: { at: number; line: string }[] = [];
  for (const raw of lrc.split(/\r?\n/)) {
    const stamps = [...raw.matchAll(/\[(\d{1,3}):(\d{2}(?:\.\d{1,3})?)\]/g)];
    if (!stamps.length) continue;
    const line = raw.replace(/\[[^\]]*\]/g, "").trim();
    for (const s of stamps) out.push({ at: Number(s[1]) * 60 + Number(s[2]), line });
  }
  return out.sort((a, b) => a.at - b.at);
}
