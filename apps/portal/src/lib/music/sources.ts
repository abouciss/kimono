import "server-only";

import { MusicProblem, parseLrc, type Album, type Artist, type ArtistRef, type Lyrics, type Track } from "./model";

/*
 * The live sources Music asks: Deezer for the catalogue (search, artists,
 * albums, artwork, charts, related artists, artist radio), Last.fm for songs
 * like a song and what genre an artist is, LRCLIB for lyrics. None of them
 * learns who is listening: the server asks about music, never about people.
 */

type Json = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any

const userAgent = "KimonoMusic/1.0 (+https://github.com/kimonoapps/kimono)";

async function getJson(url: string, timeoutMs = 9000): Promise<Json | null> {
  const res = await fetch(url, { headers: { "user-agent": userAgent, accept: "application/json" }, signal: AbortSignal.timeout(timeoutMs), cache: "no-store" });
  if (res.status === 404) return null;
  if (!res.ok) throw new MusicProblem(`${new URL(url).host}: ${res.status}`);
  return await res.json() as Json;
}

/* ── Deezer ────────────────────────────────────────────────────────────── */

const dz = "https://api.deezer.com";

async function deezer(path: string, tries = 3): Promise<Json | null> {
  const res = await getJson(`${dz}${path}`);
  /* Deezer answers 200 with { error } for most problems; "no data" is a miss. */
  if (res?.error) {
    if (res.error.code === 800) return null;
    /* Over its 50 requests in 5 seconds: it asks for a moment. */
    if (res.error.code === 4 && tries > 1) { await new Promise((r) => setTimeout(r, 1500)); return deezer(path, tries - 1); }
    throw new MusicProblem(`deezer: ${res.error.message ?? res.error.type ?? "error"}`);
  }
  return res;
}

const artistRef = (a: Json | undefined): ArtistRef | null => a?.id ? { key: `dz:${a.id}`, name: String(a.name ?? "") } : null;

export function trackOf(t: Json, album?: Json): Track | null {
  if (!t?.id || !t.title || t.readable === false) return null;
  const al = t.album ?? album;
  const contributors = Array.isArray(t.contributors) ? t.contributors.map(artistRef).filter(Boolean) as ArtistRef[] : [];
  const main = artistRef(t.artist);
  /* Deezer can name a featured artist twice. */
  const artists = (contributors.length ? contributors : main ? [main] : []).filter((a, i, all) => all.findIndex((b) => b.key === a.key) === i);
  return {
    key: `dz:${t.id}`,
    title: String(t.title),
    artists,
    album: al?.id ? { key: `dz:${al.id}`, title: String(al.title ?? ""), cover: al.cover_xl ?? al.cover_big ?? null } : null,
    duration: Number(t.duration) || 0,
    isrc: typeof t.isrc === "string" ? t.isrc : null,
    explicit: Boolean(t.explicit_lyrics),
    rank: Number(t.rank) || 0,
  };
}

const tracks = (list: Json[] | undefined, album?: Json) => (list ?? []).map((t) => trackOf(t, album)).filter((t): t is Track => Boolean(t));

function albumOf(a: Json): Album | null {
  if (!a?.id || !a.title) return null;
  const kind = a.record_type === "single" || a.record_type === "ep" || a.record_type === "compile" ? a.record_type : "album";
  return {
    key: `dz:${a.id}`,
    title: String(a.title),
    artist: artistRef(a.artist),
    cover: a.cover_xl ?? a.cover_big ?? null,
    year: typeof a.release_date === "string" ? Number(a.release_date.slice(0, 4)) || null : null,
    kind,
    genres: ((a.genres?.data ?? []) as Json[]).map((g) => String(g.name)).filter(Boolean),
    tracks: tracks(a.tracks?.data, a),
  };
}

function artistOf(a: Json): Artist | null {
  if (!a?.id || !a.name) return null;
  /* Deezer's stand-in picture for an artist without one is a grey silhouette: none is better. */
  const picture = a.picture_xl && !/\/artist\/\//.test(a.picture_xl) ? a.picture_xl : null;
  return { key: `dz:${a.id}`, name: String(a.name), picture, fans: Number(a.nb_fan) || 0, tags: [] };
}

const q = (s: string) => encodeURIComponent(s);

export const deezerSource = {
  async search(text: string) {
    const [t, al, ar] = await Promise.all([
      deezer(`/search/track?q=${q(text)}&limit=25`), deezer(`/search/album?q=${q(text)}&limit=12`), deezer(`/search/artist?q=${q(text)}&limit=8`),
    ]);
    return {
      tracks: tracks(t?.data),
      albums: ((al?.data ?? []) as Json[]).map(albumOf).filter((a): a is Album => Boolean(a)),
      artists: ((ar?.data ?? []) as Json[]).map(artistOf).filter((a): a is Artist => Boolean(a)),
    };
  },
  async track(id: string) { const t = await deezer(`/track/${id}`); return t ? trackOf(t) : null; },
  async album(id: string) { const a = await deezer(`/album/${id}`); return a ? albumOf(a) : null; },
  async artist(id: string) {
    const [a, top, albums, related] = await Promise.all([
      deezer(`/artist/${id}`), deezer(`/artist/${id}/top?limit=10`), deezer(`/artist/${id}/albums?limit=50`), deezer(`/artist/${id}/related?limit=12`),
    ]);
    const artist = a ? artistOf(a) : null;
    if (!artist) return null;
    return {
      artist,
      top: tracks(top?.data),
      albums: ((albums?.data ?? []) as Json[]).map((x) => albumOf({ ...x, artist: a })).filter((x): x is Album => Boolean(x)),
      related: ((related?.data ?? []) as Json[]).map(artistOf).filter((x): x is Artist => Boolean(x)),
    };
  },
  async artistRadio(id: string) { return tracks((await deezer(`/artist/${id}/radio?limit=40`))?.data); },
  /** The day's charts, and the genres Deezer files music under. */
  async chart(genre = 0) {
    /* Each part asked on its own: the whole chart comes ten of each. */
    const [t, al, ar] = await Promise.all([deezer(`/chart/${genre}/tracks?limit=50`), deezer(`/chart/${genre}/albums?limit=24`), deezer(`/chart/${genre}/artists?limit=24`)]);
    return {
      tracks: tracks(t?.data),
      albums: ((al?.data ?? []) as Json[]).map(albumOf).filter((a): a is Album => Boolean(a)),
      artists: ((ar?.data ?? []) as Json[]).map(artistOf).filter((a): a is Artist => Boolean(a)),
    };
  },
  async genres() {
    const g = await deezer("/genre");
    return ((g?.data ?? []) as Json[]).filter((x) => x.id).map((x) => ({ id: Number(x.id), name: String(x.name), picture: x.picture_xl ?? null }));
  },
  /** The best Deezer match for a song named elsewhere (Last.fm's similar tracks come as names). */
  async find(artist: string, title: string) {
    const r = await deezer(`/search/track?q=${q(`artist:"${artist}" track:"${title}"`)}&limit=1`);
    return tracks(r?.data)[0] ?? null;
  },
  /** A recording by its ISRC: the same release, exactly. */
  async isrc(code: string) { const t = await deezer(`/track/isrc:${q(code)}`); return t ? trackOf(t) : null; },
  async searchTracks(text: string, limit = 10) { return tracks((await deezer(`/search/track?q=${q(text)}&limit=${limit}`))?.data); },
  async findArtist(name: string) {
    const r = await deezer(`/search/artist?q=${q(name)}&limit=1`);
    const a = ((r?.data ?? []) as Json[]).map(artistOf).filter(Boolean)[0];
    return a && a.name.toLowerCase() === name.toLowerCase() ? a : null;
  },
};

/* ── Last.fm ───────────────────────────────────────────────────────────── */

/* Tags people put on everything, which say nothing about the music. */
const noiseTags = new Set(["seen live", "favorites", "favourite", "favorite", "albums i own", "under 2000 listeners", "spotify", "awesome", "love", "beautiful", "male vocalists", "female vocalists", "my favorite"]);

export function lastfm(key: string) {
  const call = async (method: string, params: Record<string, string>) => {
    const p = new URLSearchParams({ method, api_key: key, format: "json", autocorrect: "1", ...params });
    const r = await getJson(`https://ws.audioscrobbler.com/2.0/?${p}`);
    if (r?.error) { if (r.error === 6) return null; throw new MusicProblem(`last.fm: ${r.message ?? r.error}`); }
    return r;
  };
  return {
    /** Songs like this one, by name: [artist, title, how alike from 0 to 1]. */
    async similarTracks(artist: string, title: string, limit = 40): Promise<{ artist: string; title: string; match: number }[]> {
      const r = await call("track.getSimilar", { artist, track: title, limit: String(limit) });
      return ((r?.similartracks?.track ?? []) as Json[]).map((t) => ({ artist: String(t.artist?.name ?? ""), title: String(t.name ?? ""), match: Number(t.match) || 0 })).filter((t) => t.artist && t.title);
    },
    /** What listeners call an artist's music, most agreed first. */
    async artistTags(artist: string): Promise<string[]> {
      const r = await call("artist.getTopTags", { artist });
      return ((r?.toptags?.tag ?? []) as Json[])
        .filter((t) => Number(t.count) >= 10)
        .map((t) => String(t.name ?? "").toLowerCase().trim())
        .filter((t) => t && t.length <= 30 && !noiseTags.has(t))
        .slice(0, 8);
    },
    async tagTracks(tag: string, limit = 50): Promise<{ artist: string; title: string }[]> {
      const r = await call("tag.getTopTracks", { tag, limit: String(limit) });
      return ((r?.tracks?.track ?? []) as Json[]).map((t) => ({ artist: String(t.artist?.name ?? ""), title: String(t.name ?? "") })).filter((t) => t.artist && t.title);
    },
    /** A tag as Last.fm knows it: its name as people write it, and how many listeners use it (0: nobody, so not a genre). */
    async tagInfo(tag: string): Promise<{ name: string; reach: number } | null> {
      const r = await call("tag.getInfo", { tag });
      const t = r?.tag;
      return t?.name ? { name: String(t.name), reach: Number(t.reach) || 0 } : null;
    },
    async tagArtists(tag: string, limit = 20): Promise<string[]> {
      const r = await call("tag.getTopArtists", { tag, limit: String(limit) });
      return ((r?.topartists?.artist ?? []) as Json[]).map((a) => String(a.name ?? "")).filter(Boolean);
    },
    async similarArtists(artist: string, limit = 20): Promise<string[]> {
      const r = await call("artist.getSimilar", { artist, limit: String(limit) });
      return ((r?.similarartists?.artist ?? []) as Json[]).map((a) => String(a.name ?? "")).filter(Boolean);
    },
  };
}
export type LastFm = ReturnType<typeof lastfm>;

/* ── LRCLIB ────────────────────────────────────────────────────────────── */

/** Lyrics for a recording, timed to the line when LRCLIB has them. Null when it knows nothing. */
export async function lrclib(t: Track): Promise<Lyrics | null> {
  const p = new URLSearchParams({ artist_name: t.artists[0]?.name ?? "", track_name: t.title, duration: String(t.duration) });
  if (t.album?.title) p.set("album_name", t.album.title);
  let r = await getJson(`https://lrclib.net/api/get?${p}`);
  if (!r) {
    /* The album or a "(Radio Edit)" can be what's off: search, and keep one within a few seconds. */
    const s = await getJson(`https://lrclib.net/api/search?${new URLSearchParams({ artist_name: t.artists[0]?.name ?? "", track_name: t.title.replace(/\s*[([].*?[)\]]/g, "") })}`) as unknown as Json[] | null;
    r = (Array.isArray(s) ? s : []).find((x) => Math.abs(Number(x.duration) - t.duration) <= 4) ?? null;
  }
  if (!r) return null;
  const synced = typeof r.syncedLyrics === "string" && r.syncedLyrics.trim() ? parseLrc(r.syncedLyrics) : null;
  return { synced: synced?.length ? synced : null, plain: typeof r.plainLyrics === "string" ? r.plainLyrics : null, instrumental: Boolean(r.instrumental) };
}
