/**
 * 音 Kimono Music: one shape for a track, an album and an artist, whatever
 * Deezer called them. Pure (no requests, no database).
 *
 * Keys are Deezer's ids with a prefix (`dz:3135556`): a track's page, its
 * place in a playlist and its stream all go by that key. A song Deezer doesn't
 * have (a game's score, a fan upload, a niche version) is its YouTube video
 * instead (`yt:dQw4w9WgXcQ`): it plays that video, its artist is the channel
 * (no key, so no page), and its album is only there to carry the thumbnail.
 */

/** Music's gilt: its accent, and the wash its loader is painted in. */
export const musicGold = "#946c25";

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

/** `owner`: whose it is, when it isn't yours; `invited`: you've been asked in and haven't answered; `shared`: how many have joined. */
export type Playlist = { id: string; name: string; count: number; covers: string[]; updatedAt: string; public?: boolean; shared?: number; owner?: string; invited?: boolean };

export type Row<T = Track> = { id: string; title: string; items: T[] };

export class MusicProblem extends Error {
  constructor(message: string, readonly status = 502) { super(message); }
}

export const deezerId = (key: string): string | null => /^dz:(\d{1,20})$/.exec(key)?.[1] ?? null;
export const videoId = (key: string): string | null => /^yt:([A-Za-z0-9_-]{11})$/.exec(key)?.[1] ?? null;
/** A song's key, from Deezer or YouTube. */
export const isTrackKey = (key: string): boolean => Boolean(deezerId(key) || videoId(key));

/** A channel's name as an artist's: YouTube Music's "Artist - Topic" and "ArtistVEVO" are the artist. */
export const channelName = (name: string) => name.replace(/\s*-\s*Topic$/i, "").replace(/VEVO$/i, "").trim();

/** A song that is a YouTube video. */
export function videoTrack(v: { id: string; title: string; artists: string[]; seconds: number; cover: string | null; album?: string | null }): Track {
  return {
    key: `yt:${v.id}`, title: v.title.slice(0, 300),
    artists: v.artists.map(channelName).filter(Boolean).slice(0, 6).map((name) => ({ key: "", name })),
    album: { key: "", title: v.album ?? "", cover: v.cover }, duration: v.seconds, isrc: null, explicit: false, rank: 0,
  };
}

/** For matching a recording elsewhere: no "(feat. …)", "- Radio Edit", accents or punctuation. */
export function plainTitle(title: string): string {
  return title.toLowerCase()
    .normalize("NFKD").replace(/\p{M}/gu, "")
    .replace(/\s*[([](feat|ft|with)\.?\s[^)\]]*[)\]]/g, "")
    .replace(/[^\p{L}\p{N}]+/gu, " ").trim();
}

/* ── Search ─────────────────────────────────────────────────────────────── */

/* What makes a video something other than a song to play: a loop, a game run, a reaction. */
const notASong = /\b(\d+ ?hours?|1 ?hr|perfect play|full combo|gameplay|noobplay|walkthrough|playthrough|reaction|tutorial|review|loop(?:ed)?|compilation|full album|mix ?\d{4}|ost full|osu|bga|ctb|\d+b|mx|nm|insane|expert|chart|trailer)\b/;
/* Words a video adds to a song's name that aren't the name: "(Lyrics)", "[Official Video]", "4K". */
const videoDressing = /\s*[([](?:[^)\]]*\b(?:lyrics?|official|audio|video|visuali[sz]er|hd|hq|4k|mv|m\/v|color coded|eng|sub|romaji|kan)\b[^)\]]*)[)\]]/gi;

/**
 * A video's name as a song's: "3rd Coast - Jealousy (Lyrics)" is Jealousy by
 * 3rd Coast. Null when the video is plainly not one song (an hour's loop, a
 * game's full run), or, unless [allowed], a version the search didn't ask for.
 */
export function songOfVideo(title: string, channel: string, allowed: string): { title: string; artists: string[] } | null {
  const plain = plainTitle(title);
  if (notASong.test(plain) && !notASong.test(allowed)) return null;
  for (const m of plain.matchAll(new RegExp(otherVersion, "g"))) if (!allowed.includes(m[0])) return null;
  const clean = title.replace(videoDressing, "").replace(/\s*【[^】]*】/g, "").replace(/\s{2,}/g, " ").trim();
  const split = /^(.+?)\s+[-–—|]\s+(.+)$/.exec(clean);
  /* A soundtrack's "[Game OST] 4-04 Jealousy": the song's own name is what's after the tag and the track number. */
  const bare = (s: string) => s.replace(/^\s*(?:[([][^)\]]*[)\]]\s*)+/, "").replace(/^\d{1,2}[-.]\d{1,3}\.?\s+/, "").trim() || s.trim();
  if (split) return { artists: split[1].split(/\s*(?:,|&| x | feat\.? | ft\.? )\s*/i).map((a) => bare(a)).filter(Boolean), title: bare(split[2]) };
  return { artists: channel ? [channel] : [], title: bare(clean) };
}

/** How well a song answers a search: the share of the words typed found in its name and artists (the last word may be half-typed), with the name itself counting most. */
export function searchScore(query: string, t: Track): number {
  const words = plainTitle(query).split(" ").filter(Boolean);
  if (!words.length) return 0;
  const name = plainTitle(t.title), by = plainTitle(t.artists.map((a) => a.name).join(" "));
  const hay = ` ${name} ${by} `;
  let got = 0;
  words.forEach((w, i) => { if (hay.includes(` ${w} `) || (i === words.length - 1 && hay.includes(` ${w}`))) got += 1; });
  const share = got / words.length;
  /* "Jealousy 3rd coast": the name and the artist both, exactly, is the song asked for. */
  const exact = plainTitle(query) === name || plainTitle(query) === `${name} ${by}` || plainTitle(query) === `${by} ${name}` ? 3 : 0;
  const named = words.some((w) => ` ${name} `.includes(` ${w} `)) ? 1 : 0;
  /* A cover, a parody, a karaoke or 8-bit take waits behind the song, unless that's what was asked for. */
  const typed = plainTitle(query);
  const other = [...name.matchAll(new RegExp(otherVersion, "g")), ...name.matchAll(/\b(8 ?bit|emulation|in the style of|made famous by|originally performed)\b/g)].some((m) => !typed.includes(m[0])) ? 6 : 0;
  return share * 10 + exact + named - other;
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
  /* "Lyn Inaizumi" on Deezer is "Lyn" on YouTube Music: a name that is the other's first word(s) is the same artist. */
  const theyre = c.artists.map(plainTitle).filter((a) => a.length >= 3);
  const theirs = names.some((n) => by.includes(n) || theyre.some((a) => ` ${n} `.startsWith(` ${a} `)));
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
