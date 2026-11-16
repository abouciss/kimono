import "server-only";

import { randomUUID } from "node:crypto";
import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { apiError } from "../api-v1";
import { getPlatformSettings } from "../settings";
import { stateDir } from "../state";
import { audioStatus, prefetch } from "./audio";
import { musicConfig, type MusicConfig } from "./config";
import { deezerId, isTrackKey, MusicProblem, plainTitle, searchScore, videoId, type Album, type Artist, type Lyrics, type Playlist, type RatedKind, type Rating, type Row, type Track } from "./model";
import { deezerSource as dz, lastfm, lrclib } from "./sources";
import { findRecording, searchYouTube, videoAsTrack } from "./youtube";

export * from "./model";

/*
 * 音 Kimono Music, server side. Nothing is kept in bulk: what Deezer, Last.fm
 * and LRCLIB say is looked up the first time anyone needs it and kept in
 * music.db, checked again after a while (a day for charts, a month for an
 * album), and a lookup that found nothing is tried again later.
 *
 * Each person's listening (what they played and how far, what they rated,
 * their playlists and queue) is kept here too, and is theirs alone: their
 * taste is worked out from it here, never sent anywhere.
 */

const root = join(stateDir, "music");
const g = globalThis as unknown as { kimonoMusic?: DatabaseSync };
/* A hot reload keeps the connection but brings new code: bring the tables along. */
let migrated = false;

const HOUR = 3600_000, DAY = 24 * HOUR;

function migrate(db: DatabaseSync) {
  db.exec(`
PRAGMA journal_mode = WAL;
CREATE TABLE IF NOT EXISTS lookups (kind TEXT NOT NULL, id TEXT NOT NULL, data TEXT, checked_at INTEGER NOT NULL, PRIMARY KEY (kind, id));
CREATE TABLE IF NOT EXISTS tracks (key TEXT PRIMARY KEY, data TEXT NOT NULL, updated_at INTEGER NOT NULL);
CREATE TABLE IF NOT EXISTS recordings (track TEXT PRIMARY KEY, video TEXT, tries INTEGER NOT NULL DEFAULT 0, checked_at INTEGER NOT NULL);
CREATE TABLE IF NOT EXISTS plays (
  username TEXT NOT NULL, track TEXT NOT NULL, artists TEXT NOT NULL, played_at INTEGER NOT NULL,
  seconds REAL NOT NULL, length REAL NOT NULL
);
CREATE INDEX IF NOT EXISTS plays_recent ON plays (username, played_at DESC);
CREATE TABLE IF NOT EXISTS ratings (
  username TEXT NOT NULL, kind TEXT NOT NULL, key TEXT NOT NULL, rating TEXT NOT NULL,
  data TEXT NOT NULL, updated_at INTEGER NOT NULL, PRIMARY KEY (username, kind, key)
);
CREATE TABLE IF NOT EXISTS playlists (id TEXT PRIMARY KEY, username TEXT NOT NULL, name TEXT NOT NULL, created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL);
CREATE INDEX IF NOT EXISTS playlists_mine ON playlists (username, updated_at DESC);
CREATE TABLE IF NOT EXISTS playlist_tracks (playlist TEXT NOT NULL, position INTEGER NOT NULL, track TEXT NOT NULL, added_at INTEGER NOT NULL, PRIMARY KEY (playlist, position));
CREATE TABLE IF NOT EXISTS queues (username TEXT PRIMARY KEY, data TEXT NOT NULL, updated_at INTEGER NOT NULL);
CREATE TABLE IF NOT EXISTS playlist_members (playlist TEXT NOT NULL, username TEXT NOT NULL, invited_by TEXT NOT NULL, joined INTEGER NOT NULL DEFAULT 0, at INTEGER NOT NULL, PRIMARY KEY (playlist, username));
CREATE INDEX IF NOT EXISTS playlist_members_user ON playlist_members (username);
CREATE TABLE IF NOT EXISTS connections (username TEXT NOT NULL, service TEXT NOT NULL, access TEXT NOT NULL, refresh TEXT, expires_at INTEGER NOT NULL, at INTEGER NOT NULL, PRIMARY KEY (username, service));
`);
  /* Public: friends see it on your profile and can play it. Private (the default): you and whoever you've shared it with. */
  const columns = (db.prepare("PRAGMA table_info(playlists)").all() as { name: string }[]).map((c) => c.name);
  if (!columns.includes("public")) db.exec("ALTER TABLE playlists ADD COLUMN public INTEGER NOT NULL DEFAULT 0");
}

export function musicDb(): DatabaseSync {
  if (!g.kimonoMusic) {
    mkdirSync(root, { recursive: true, mode: 0o700 });
    g.kimonoMusic = new DatabaseSync(join(root, "music.db"));
  }
  if (!migrated) { migrate(g.kimonoMusic); migrated = true; }
  return g.kimonoMusic;
}

const user = (username: string) => username.toLowerCase();

/* ── Kept lookups ──────────────────────────────────────────────────────── */

/* The same question asked twice at once is asked of the source once. */
const asking = new Map<string, Promise<unknown>>();

/** What a source said, kept for `fresh` ms; a miss (null) is kept a day. A failure gives what was kept before, if anything. */
export async function kept<T>(kind: string, id: string, fresh: number, ask: () => Promise<T | null>): Promise<T | null> {
  const db = musicDb();
  const row = db.prepare("SELECT data, checked_at FROM lookups WHERE kind = ? AND id = ?").get(kind, id) as { data: string | null; checked_at: number } | undefined;
  const old = row?.data ? JSON.parse(row.data) as T : null;
  if (row && Date.now() - row.checked_at < (row.data ? fresh : DAY)) return old;
  const k = `${kind}|${id}`;
  const known = asking.get(k) as Promise<T | null> | undefined;
  if (known) return known;
  const job = (async () => {
    try {
      const value = await ask();
      db.prepare("INSERT INTO lookups (kind, id, data, checked_at) VALUES (?, ?, ?, ?) ON CONFLICT (kind, id) DO UPDATE SET data = excluded.data, checked_at = excluded.checked_at")
        .run(kind, id, value === null ? null : JSON.stringify(value), Date.now());
      return value;
    } catch (error) {
      if (old) return old;
      throw error;
    }
  })().finally(() => asking.delete(k));
  asking.set(k, job);
  return job;
}

/** Tracks are kept as seen, so a playlist or history can draw them without asking Deezer. */
export function keepTracks(tracks: Track[]) {
  if (!tracks.length) return;
  const db = musicDb();
  const put = db.prepare("INSERT INTO tracks (key, data, updated_at) VALUES (?, ?, ?) ON CONFLICT (key) DO UPDATE SET data = excluded.data, updated_at = excluded.updated_at");
  const now = Date.now();
  db.exec("BEGIN");
  try { for (const t of tracks) put.run(t.key, JSON.stringify(t), now); db.exec("COMMIT"); }
  catch (error) { db.exec("ROLLBACK"); throw error; }
}

function keptTracks(keys: string[]): Map<string, Track> {
  if (!keys.length) return new Map();
  const rows = musicDb().prepare(`SELECT key, data FROM tracks WHERE key IN (${keys.map(() => "?").join(",")})`).all(...keys) as { key: string; data: string }[];
  return new Map(rows.map((r) => [r.key, JSON.parse(r.data) as Track]));
}

/** Tracks by key, as the server knows them (kept, else asked of Deezer): what a browser says a track is never kept. */
export async function tracksFor(keys: string[], max = 1000): Promise<Track[]> {
  const wanted = [...new Set(keys.filter((k) => typeof k === "string" && isTrackKey(k)))].slice(0, max);
  const known = keptTracks(wanted);
  const missing = wanted.filter((k) => !known.has(k));
  for (let i = 0; i < missing.length; i += 8) {
    const found = await Promise.all(missing.slice(i, i + 8).map((k) => getTrack(k).catch(() => null)));
    for (const t of found) if (t) known.set(t.key, t);
  }
  return keys.flatMap((k) => known.get(k) ? [known.get(k)!] : []);
}

const idOf = (key: string) => {
  const id = deezerId(key);
  if (!id) throw new MusicProblem("That isn't a Music address.", 400);
  return id;
};

/* ── Catalogue ─────────────────────────────────────────────────────────── */

/**
 * Songs, albums and artists for what was typed. Deezer's catalogue and
 * YouTube Music's (its songs, and videos that are one song) are asked at
 * once; songs are ranked by how well they answer the words typed, then how
 * popular they are, and a song both have is shown once, from Deezer.
 */
/** A genre (or mood, decade, scene) that a search names: its best songs, two an artist, and its artists. */
export type GenreFound = { tag: string; title: string; tracks: Track[]; artists: Artist[] };

/*
 * Whether what was typed is a genre people tag music with on Last.fm ("city
 * pop", "lofi", "90s", "sad"), and if so its songs; without Last.fm, Deezer's
 * own genres by name. Slow the first time (each song is looked up on Deezer),
 * then kept for a week.
 */
async function genreSearch(config: MusicConfig, text: string): Promise<(GenreFound & { reach: number }) | null> {
  const key = text.toLowerCase();
  if (key.length < 3) return null;
  const titled = (s: string) => s.replace(/\b\p{L}/gu, (c) => c.toUpperCase());
  if (!config.lastfmKey) {
    const g = (await genres().catch(() => [])).find((x) => x.id !== 0 && x.name.toLowerCase() === key);
    if (!g) return null;
    const c = await chart(g.id);
    return { tag: g.name.toLowerCase(), title: g.name, tracks: spread(c.tracks, 2).slice(0, 30), artists: c.artists.slice(0, 12), reach: 100_000 };
  }
  const fm = lastfm(config.lastfmKey);
  const info = await kept("tag-info", key, 30 * DAY, () => fm.tagInfo(key)).catch(() => null);
  /* A tag a few people used isn't a genre; and it has to be what was typed, not something near it. */
  if (!info || info.reach < 500 || info.name.toLowerCase() !== key) return null;
  const [named, names] = await Promise.all([
    kept("tag-tracks-deep", key, 7 * DAY, () => fm.tagTracks(key, 150)).catch(() => null),
    kept("tag-artists", key, 7 * DAY, () => fm.tagArtists(key, 20)).catch(() => null),
  ]);
  const [songs, artists] = await Promise.all([
    byName((named ?? []).slice(0, 50), 45),
    inTurn((names ?? []).slice(0, 12), (n) => kept<Artist>("artist-named", n.toLowerCase(), 60 * DAY, () => dz.findArtist(n)).catch(() => null), 6),
  ]);
  const tracks = spread(songs, 2).slice(0, 30);
  if (tracks.length < 5) return null;
  return { tag: key, title: titled(info.name), tracks, artists: artists.filter((a): a is Artist => Boolean(a)), reach: info.reach };
}

export async function search(q: string, config?: MusicConfig) {
  const text = q.trim().slice(0, 200);
  if (!text) return { tracks: [], albums: [], artists: [], genre: null };
  const key = text.toLowerCase();
  const [found, yt, genre] = await Promise.all([
    kept(`search`, key, DAY, () => dz.search(text)),
    /* YouTube is the extra, never the wait: a slow answer is left out. */
    Promise.race([
      kept<{ songs: Track[]; videos: Track[] }>("yt-search-3", key, DAY, () => searchYouTube(text)).catch(() => null),
      new Promise<null>((done) => setTimeout(() => done(null), 6000)),
    ]),
    /* The same for a genre's songs: the first time can take a while, and the search doesn't wait on it past eight seconds (it's kept for next time). */
    config ? Promise.race([
      genreSearch(config, text).catch(() => null),
      new Promise<null>((done) => setTimeout(() => done(null), 8000)),
    ]) : null,
  ]);
  const out = found ?? { tracks: [], albums: [], artists: [] };
  const seen = new Set<string>();
  /* The same song whichever way round a video names it ("3rd Coast - Jealousy", "Jealousy - 3rd Coast"). */
  const same = (t: Track) => [plainTitle(t.title.replace(/\s*[([][^)\]]*[)\]]/g, "")), plainTitle(t.artists[0]?.name ?? "")].sort().join("|");
  const scored: { t: Track; s: number }[] = [];
  const add = (t: Track, lift: number, least: number) => {
    const id = same(t);
    if (seen.has(id)) return;
    const s = searchScore(text, t);
    if (s < least) return;
    seen.add(id);
    scored.push({ t, s: s * 10 + lift });
  };
  /* A video can name the artist second ("My Jealousy - 3rd Coast"): when its "title" is an artist the search knows and its "artist" isn't, it's the other way round. */
  const artistsKnown = new Set([...out.artists.map((a) => plainTitle(a.name)), ...out.tracks.flatMap((t) => t.artists.map((a) => plainTitle(a.name)))]);
  const righted = (t: Track): Track => {
    const by = t.artists[0]?.name ?? "";
    return artistsKnown.has(plainTitle(t.title)) && !artistsKnown.has(plainTitle(by)) && by ? { ...t, title: by, artists: [{ key: "", name: t.title }] } : t;
  };
  for (const t of out.tracks) add(t, Math.log10((t.rank ?? 0) + 10), 0);
  for (const t of yt?.songs ?? []) add(t, 3, 4);
  /* A video only when it answers most of what was typed. */
  for (const t of yt?.videos ?? []) add(righted(t), 1, 7);
  const tracks = scored.sort((a, b) => b.s - a.s).map((x) => x.t).slice(0, 30);
  keepTracks(tracks);
  /* A name that's an artist and a small tag ("taylor") is the artist. */
  const artistNamed = out.artists.some((a) => a.name.toLowerCase() === key);
  const g = genre && !(artistNamed && genre.reach < 5000) ? { tag: genre.tag, title: genre.title, tracks: genre.tracks, artists: genre.artists } : null;
  return { ...out, tracks, genre: g };
}

export async function getTrack(key: string): Promise<Track | null> {
  const known = keptTracks([key]).get(key);
  /* A YouTube song is kept for good once seen: its video doesn't change, so it's asked of YouTube once. */
  const video = videoId(key);
  if (video) {
    if (known) return known;
    const t = await kept<Track>("video-track", key, 365 * DAY, () => videoAsTrack(video));
    if (t) keepTracks([t]);
    return t;
  }
  /* An ISRC only comes with a track's own page: worth asking once for, it finds the recording. */
  if (known?.isrc) return known;
  const t = await kept<Track>("track", key, 30 * DAY, () => dz.track(idOf(key)));
  if (t) keepTracks([t]);
  return t ?? known ?? null;
}

export async function getAlbum(key: string): Promise<Album | null> {
  const a = await kept<Album>("album", key, 30 * DAY, () => dz.album(idOf(key)));
  if (a) keepTracks(a.tracks);
  return a;
}

export async function getArtist(config: MusicConfig, key: string) {
  const page = await kept("artist", key, 7 * DAY, () => dz.artist(idOf(key)));
  if (!page) return null;
  keepTracks(page.top);
  const tags = await artistTags(config, page.artist.key, page.artist.name).catch(() => []);
  return { ...page, artist: { ...page.artist, tags } };
}

/** What genre an artist is: Last.fm's tags when there's a key, else the genres on Deezer's albums. */
export async function artistTags(config: MusicConfig, key: string, name: string): Promise<string[]> {
  const tags = await kept<string[]>("tags", key, 60 * DAY, async () => {
    if (config.lastfmKey) {
      const t = await lastfm(config.lastfmKey).artistTags(name);
      if (t.length) return t;
    }
    const page = await kept("artist", key, 7 * DAY, () => dz.artist(idOf(key)));
    const counts = new Map<string, number>();
    for (const a of (page?.albums ?? []).slice(0, 6)) {
      const album = await getAlbum(a.key).catch(() => null);
      for (const genre of album?.genres ?? []) counts.set(genre.toLowerCase(), (counts.get(genre.toLowerCase()) ?? 0) + 1);
    }
    return [...counts.entries()].sort((a, b) => b[1] - a[1]).map(([t]) => t).slice(0, 5);
  });
  return tags ?? [];
}

export async function lyrics(key: string): Promise<Lyrics | null> {
  const t = await getTrack(key);
  if (!t) return null;
  return kept<Lyrics>("lyrics", key, 90 * DAY, () => lrclib(t));
}

export async function genres() {
  return (await kept("genres", "all", 30 * DAY, () => dz.genres())) ?? [];
}

export async function chart(genre = 0) {
  const c = await kept("chart", String(genre), 12 * HOUR, () => dz.chart(genre));
  if (c) keepTracks(c.tracks);
  return c ?? { tracks: [], albums: [], artists: [] };
}

/* ── Playing ───────────────────────────────────────────────────────────── */

/** The YouTube recording of a track: found once, kept; a miss is tried again after a day, a week, then a month. */
export async function recordingOf(key: string): Promise<string> {
  const db = musicDb();
  /* A YouTube song is its video. */
  const own = videoId(key);
  if (own) {
    db.prepare("INSERT INTO recordings (track, video, tries, checked_at) VALUES (?, ?, 0, ?) ON CONFLICT (track) DO NOTHING").run(key, own, Date.now());
    return own;
  }
  const row = db.prepare("SELECT video, tries, checked_at FROM recordings WHERE track = ?").get(key) as { video: string | null; tries: number; checked_at: number } | undefined;
  if (row?.video) return row.video;
  const wait = !row ? 0 : row.tries <= 1 ? DAY : row.tries === 2 ? 7 * DAY : 30 * DAY;
  if (row && Date.now() - row.checked_at < wait) throw new MusicProblem("Music couldn't find a recording of this song.", 404);
  const track = await getTrack(key);
  if (!track) throw new MusicProblem("No such song.", 404);
  const video = await findRecording(track);
  db.prepare("INSERT INTO recordings (track, video, tries, checked_at) VALUES (?, ?, ?, ?) ON CONFLICT (track) DO UPDATE SET video = excluded.video, tries = excluded.tries, checked_at = excluded.checked_at")
    .run(key, video, video ? 0 : (row?.tries ?? 0) + 1, Date.now());
  if (!video) throw new MusicProblem("Music couldn't find a recording of this song.", 404);
  return video;
}

/** Forgets that a song's recording couldn't be found, so the next ask looks again (Music's "Why?"). */
export function forgetMissingRecording(key: string) {
  musicDb().prepare("DELETE FROM recordings WHERE track = ? AND video IS NULL").run(key);
}

/** The recording a song came with (a YouTube Music playlist's own upload of it), kept unless one was already found. */
export function seedRecording(key: string, video: string) {
  if (!deezerId(key) || !/^[A-Za-z0-9_-]{11}$/.test(video)) return;
  musicDb().prepare("INSERT INTO recordings (track, video, tries, checked_at) VALUES (?, ?, 0, ?) ON CONFLICT (track) DO UPDATE SET video = excluded.video, tries = 0, checked_at = excluded.checked_at WHERE recordings.video IS NULL")
    .run(key, video, Date.now());
}

/**
 * Where a song is on its way to playing, for the bar's first-play progress:
 * still finding its recording, coming in (how much of it), or ready.
 */
export function songStatus(key: string): { stage: "finding" } | { stage: "fetching"; fraction: number } | { stage: "ready" } {
  const own = videoId(key);
  const row = own ? { video: own } : musicDb().prepare("SELECT video FROM recordings WHERE track = ?").get(key) as { video: string | null } | undefined;
  if (!row?.video) return { stage: "finding" };
  const s = audioStatus(row.video);
  if (!s || s.ready) return s ? { stage: "ready" } : { stage: "fetching", fraction: 0 };
  return { stage: "fetching", fraction: s.size ? Math.min(1, s.got / s.size) : 0 };
}

/** Gets the next songs ready while this one plays, so the queue never stops to fetch. */
export async function getReady(config: MusicConfig, keys: string[]) {
  for (const key of keys.slice(0, 3)) {
    try { prefetch(config, await recordingOf(key)); } catch { /* it'll say so when it's its turn */ }
  }
}

/** A play, when it ends or is skipped: how much of the song was heard. */
export async function recordPlay(username: string, key: string, seconds: number) {
  if (!Number.isFinite(seconds) || seconds < 0) return;
  const track = await getTrack(key);
  if (!track) throw new MusicProblem("No such song.", 404);
  musicDb().prepare("INSERT INTO plays (username, track, artists, played_at, seconds, length) VALUES (?, ?, ?, ?, ?, ?)")
    .run(user(username), track.key, JSON.stringify(track.artists), Date.now(), Math.min(seconds, track.duration || seconds), track.duration || seconds);
}

export function history(username: string, limit = 50): (Track & { playedAt: string })[] {
  const rows = musicDb().prepare("SELECT track, max(played_at) AS at FROM plays WHERE username = ? AND seconds >= 30 GROUP BY track ORDER BY at DESC LIMIT ?").all(user(username), limit) as { track: string; at: number }[];
  const tracks = keptTracks(rows.map((r) => r.track));
  return rows.flatMap((r) => { const t = tracks.get(r.track); return t ? [{ ...t, playedAt: new Date(r.at).toISOString() }] : []; });
}

/**
 * The songs you come back to: each play heard past 30s counts, less as it ages
 * (half every 30 days), so this month's favourite beats last spring's. Four
 * pages of nine; when that many haven't been played through, the rest are
 * other songs you've played, latest first. Nothing you've thumbed down (the
 * song, or its artist).
 */
export function mostPlayed(username: string, limit = 36): Track[] {
  const now = Date.now();
  const down = downRated(username);
  const rows = musicDb().prepare("SELECT track, played_at FROM plays WHERE username = ? AND seconds >= 30 AND played_at > ?").all(user(username), now - 180 * DAY) as { track: string; played_at: number }[];
  const score = new Map<string, { s: number; last: number }>();
  for (const r of rows) {
    if (down.has(r.track)) continue;
    const x = score.get(r.track) ?? { s: 0, last: 0 };
    x.s += Math.pow(0.5, (now - r.played_at) / (30 * DAY));
    x.last = Math.max(x.last, r.played_at);
    score.set(r.track, x);
  }
  const keys = [...score.entries()].sort((a, b) => b[1].s - a[1].s || b[1].last - a[1].last).slice(0, limit).map(([k]) => k);
  if (keys.length < limit) {
    const more = musicDb().prepare("SELECT track, MAX(played_at) AS at FROM plays WHERE username = ? GROUP BY track ORDER BY at DESC LIMIT ?").all(user(username), limit * 3) as { track: string }[];
    for (const r of more) { if (keys.length >= limit) break; if (!keys.includes(r.track) && !down.has(r.track)) keys.push(r.track); }
  }
  const tracks = keptTracks(keys);
  return keys.flatMap((k) => tracks.get(k) ?? []).filter((t) => !t.artists.some((a) => a.key && down.has(a.key)));
}

/* ── Ratings ───────────────────────────────────────────────────────────── */

export type RatedItem = { kind: RatedKind; key: string; rating: Rating; title: string; subtitle: string; picture: string | null; updatedAt: string };

export async function rate(config: MusicConfig, username: string, kind: RatedKind, key: string, rating: Rating | null) {
  const db = musicDb();
  if (!rating) { db.prepare("DELETE FROM ratings WHERE username = ? AND kind = ? AND key = ?").run(user(username), kind, key); return; }
  const about = await describe(config, kind, key);
  db.prepare("INSERT INTO ratings (username, kind, key, rating, data, updated_at) VALUES (?, ?, ?, ?, ?, ?) ON CONFLICT (username, kind, key) DO UPDATE SET rating = excluded.rating, data = excluded.data, updated_at = excluded.updated_at")
    .run(user(username), kind, key, rating, JSON.stringify({ title: about.title.slice(0, 300), subtitle: (about.subtitle ?? "").slice(0, 300), picture: about.picture ?? null }), Date.now());
}

/* What a rating shows beside it, looked up here. */
async function describe(config: MusicConfig, kind: RatedKind, key: string): Promise<{ title: string; subtitle: string; picture: string | null }> {
  if (kind === "track") {
    const t = await getTrack(key);
    if (!t) throw new MusicProblem("No such song.", 404);
    return { title: t.title, subtitle: t.artists.map((a) => a.name).join(", "), picture: t.album?.cover ?? null };
  }
  if (kind === "album") {
    const a = await getAlbum(key);
    if (!a) throw new MusicProblem("No such album.", 404);
    return { title: a.title, subtitle: a.artist?.name ?? "", picture: a.cover };
  }
  const page = await getArtist(config, key);
  if (!page) throw new MusicProblem("No such artist.", 404);
  return { title: page.artist.name, subtitle: "", picture: page.artist.picture };
}

export function ratingOf(username: string, kind: RatedKind, key: string): Rating | null {
  const row = musicDb().prepare("SELECT rating FROM ratings WHERE username = ? AND kind = ? AND key = ?").get(user(username), kind, key) as { rating: Rating } | undefined;
  return row?.rating ?? null;
}

export function ratings(username: string): RatedItem[] {
  const rows = musicDb().prepare("SELECT kind, key, rating, data, updated_at FROM ratings WHERE username = ? ORDER BY updated_at DESC").all(user(username)) as { kind: RatedKind; key: string; rating: Rating; data: string; updated_at: number }[];
  return rows.map((r) => ({ kind: r.kind, key: r.key, rating: r.rating, ...JSON.parse(r.data) as { title: string; subtitle: string; picture: string | null }, updatedAt: new Date(r.updated_at).toISOString() }));
}

/** Songs you rated up or love, newest first: Library's liked songs. */
export async function liked(username: string): Promise<Track[]> {
  const keys = ratings(username).filter((r) => r.kind === "track" && r.rating !== "down").map((r) => r.key);
  return tracksFor(keys, 5000);
}

/* ── Playlists ─────────────────────────────────────────────────────────── */

type PlaylistRow = { id: string; username: string; name: string; updated_at: number; public: number };
const rowOf = (id: string) => musicDb().prepare("SELECT id, username, name, updated_at, public FROM playlists WHERE id = ?").get(id) as PlaylistRow | undefined;
const memberOf = (id: string, username: string) =>
  musicDb().prepare("SELECT joined, invited_by FROM playlist_members WHERE playlist = ? AND username = ?").get(id, user(username)) as { joined: number; invited_by: string } | undefined;

/** Yours alone: renaming, deleting, sharing. */
function ownPlaylist(username: string, id: string) {
  const row = rowOf(id);
  if (!row || row.username !== user(username)) throw new MusicProblem("No such playlist.", 404);
  return row;
}

/** Yours, or one you've joined: its songs are yours to change too. */
function editablePlaylist(username: string, id: string) {
  const row = rowOf(id);
  if (!row || (row.username !== user(username) && !memberOf(id, username)?.joined)) throw new MusicProblem("No such playlist.", 404);
  return row;
}

/** Who a playlist is shared with: who's in, and who's been asked. */
export function membersOf(id: string) {
  return (musicDb().prepare("SELECT username, joined, invited_by FROM playlist_members WHERE playlist = ? ORDER BY at").all(id) as { username: string; joined: number; invited_by: string }[])
    .map((m) => ({ username: m.username, joined: m.joined === 1, invitedBy: m.invited_by }));
}

function summary(p: PlaylistRow, viewer: string): Playlist {
  const db = musicDb();
  const keys = (db.prepare("SELECT track FROM playlist_tracks WHERE playlist = ? ORDER BY position").all(p.id) as { track: string }[]).map((r) => r.track);
  const tracks = keptTracks(keys.slice(0, 12));
  const covers = [...new Set(keys.slice(0, 12).map((k) => tracks.get(k)?.album?.cover).filter((c): c is string => Boolean(c)))].slice(0, 4);
  const members = membersOf(p.id);
  const me = members.find((m) => m.username === user(viewer));
  return {
    id: p.id, name: p.name, count: keys.length, covers, updatedAt: new Date(p.updated_at).toISOString(),
    public: p.public === 1, shared: members.filter((m) => m.joined).length,
    ...(p.username !== user(viewer) ? { owner: p.username } : {}),
    ...(me && !me.joined ? { invited: true } : {}),
  };
}

/** Your playlists: your own, the ones you've joined, and the ones you've been asked into. */
export function playlists(username: string): Playlist[] {
  const db = musicDb();
  const rows = db.prepare(`SELECT p.id, p.username, p.name, p.updated_at, p.public FROM playlists p
    WHERE p.username = ? OR p.id IN (SELECT playlist FROM playlist_members WHERE username = ?) ORDER BY p.updated_at DESC`).all(user(username), user(username)) as PlaylistRow[];
  return rows.map((p) => summary(p, username));
}

/** Only the public ones: what friends see. */
export const publicPlaylists = (username: string) => playlists(username).filter((p) => p.public && !p.owner);

/** A playlist's songs, for its owner or anyone it's shared with (asked in or joined). */
export function playlist(username: string, id: string) {
  const p = rowOf(id);
  if (!p || (p.username !== user(username) && !memberOf(id, username))) throw new MusicProblem("No such playlist.", 404);
  return playlistView(p, username);
}

export function playlistView(p: PlaylistRow, viewer: string) {
  const keys = (musicDb().prepare("SELECT track FROM playlist_tracks WHERE playlist = ? ORDER BY position").all(p.id) as { track: string }[]).map((r) => r.track);
  const tracks = keptTracks(keys);
  const me = memberOf(p.id, viewer);
  return {
    id: p.id, name: p.name, updatedAt: new Date(p.updated_at).toISOString(), tracks: keys.flatMap((k) => tracks.get(k) ? [tracks.get(k)!] : []),
    public: p.public === 1, ownerName: p.username, members: membersOf(p.id),
    /* What this viewer may do with it. */
    role: p.username === user(viewer) ? "owner" as const : me?.joined ? "member" as const : me ? "invited" as const : "listener" as const,
  };
}
export const playlistRow = rowOf;

/** Public (friends see it) or private (you and who you shared it with). */
export function setPlaylistPublic(username: string, id: string, shown: boolean) {
  ownPlaylist(username, id);
  musicDb().prepare("UPDATE playlists SET public = ?, updated_at = ? WHERE id = ?").run(shown ? 1 : 0, Date.now(), id);
  return playlist(username, id);
}

/** Asks a friend in: once they join, they add, remove and move songs too. The caller checks they're friends. */
export function invitePlaylist(username: string, id: string, friend: string, now = Date.now()) {
  const row = ownPlaylist(username, id);
  if (user(friend) === row.username) throw new MusicProblem("It's already yours.", 400);
  if (membersOf(id).length >= 20) throw new MusicProblem("Up to 20 people on one playlist.", 400);
  musicDb().prepare("INSERT OR IGNORE INTO playlist_members (playlist, username, invited_by, joined, at) VALUES (?, ?, ?, 0, ?)").run(id, user(friend), row.username, now);
  return playlist(username, id);
}

/** The owner takes someone off it. */
export function dropFromPlaylist(username: string, id: string, friend: string) {
  ownPlaylist(username, id);
  musicDb().prepare("DELETE FROM playlist_members WHERE playlist = ? AND username = ?").run(id, user(friend));
  return playlist(username, id);
}

/** Yes to being asked in. */
export function joinPlaylist(username: string, id: string) {
  if (!memberOf(id, username)) throw new MusicProblem("No such playlist.", 404);
  musicDb().prepare("UPDATE playlist_members SET joined = 1 WHERE playlist = ? AND username = ?").run(id, user(username));
  return playlist(username, id);
}

/** No thanks, or leaving one you'd joined. */
export function leavePlaylist(username: string, id: string) {
  musicDb().prepare("DELETE FROM playlist_members WHERE playlist = ? AND username = ?").run(id, user(username));
}

export async function createPlaylist(username: string, name: string, keys: string[] = []) {
  const clean = name.trim().slice(0, 120);
  if (!clean) throw new MusicProblem("A playlist needs a name.", 400);
  const id = randomUUID();
  const now = Date.now();
  musicDb().prepare("INSERT INTO playlists (id, username, name, created_at, updated_at) VALUES (?, ?, ?, ?, ?)").run(id, user(username), clean, now, now);
  if (keys.length) return setPlaylistTracks(username, id, keys);
  return playlist(username, id);
}

export function renamePlaylist(username: string, id: string, name: string) {
  editablePlaylist(username, id);
  const clean = name.trim().slice(0, 120);
  if (!clean) throw new MusicProblem("A playlist needs a name.", 400);
  musicDb().prepare("UPDATE playlists SET name = ?, updated_at = ? WHERE id = ?").run(clean, Date.now(), id);
  return playlist(username, id);
}

export function deletePlaylist(username: string, id: string) {
  ownPlaylist(username, id);
  const db = musicDb();
  db.prepare("DELETE FROM playlist_tracks WHERE playlist = ?").run(id);
  db.prepare("DELETE FROM playlist_members WHERE playlist = ?").run(id);
  db.prepare("DELETE FROM playlists WHERE id = ?").run(id);
}

/** A playlist's songs, in order, as the person left them (added, removed, moved). */
export async function setPlaylistTracks(username: string, id: string, keys: string[]) {
  editablePlaylist(username, id);
  if (keys.length > 5000) throw new MusicProblem("A playlist holds up to 5,000 songs.", 400);
  const tracks = await tracksFor(keys, 5000);
  const db = musicDb();
  const now = Date.now();
  db.exec("BEGIN");
  try {
    db.prepare("DELETE FROM playlist_tracks WHERE playlist = ?").run(id);
    const put = db.prepare("INSERT INTO playlist_tracks (playlist, position, track, added_at) VALUES (?, ?, ?, ?)");
    tracks.forEach((t, i) => put.run(id, i, t.key, now));
    db.prepare("UPDATE playlists SET updated_at = ? WHERE id = ?").run(now, id);
    db.exec("COMMIT");
  } catch (error) { db.exec("ROLLBACK"); throw error; }
  return playlist(username, id);
}

export async function addToPlaylist(username: string, id: string, keys: string[]) {
  const current = playlist(username, id).tracks.map((t) => t.key);
  const have = new Set(current);
  return setPlaylistTracks(username, id, [...current, ...keys.filter((k) => !have.has(k))]);
}

/* ── Queue ─────────────────────────────────────────────────────────────── */

/** What's playing and what's next, and where in the song: picked up on any device. */
export type Queue = { tracks: Track[]; index: number; position: number; shuffle: boolean; repeat: "off" | "all" | "one"; source: { kind: string; id: string; title: string } | null; playing: boolean; updatedAt: string };

export function getQueue(username: string): Queue | null {
  const row = musicDb().prepare("SELECT data, updated_at FROM queues WHERE username = ?").get(user(username)) as { data: string; updated_at: number } | undefined;
  return row ? { ...JSON.parse(row.data) as Queue, updatedAt: new Date(row.updated_at).toISOString() } : null;
}

export async function saveQueue(username: string, q: Omit<Queue, "tracks" | "updatedAt"> & { keys: string[] }, at = Date.now()) {
  const tracks = await tracksFor(q.keys.slice(0, 1000));
  const source = q.source && typeof q.source.kind === "string" && typeof q.source.id === "string" && typeof q.source.title === "string"
    ? { kind: q.source.kind.slice(0, 20), id: q.source.id.slice(0, 200), title: q.source.title.slice(0, 200) } : null;
  const data: Omit<Queue, "updatedAt"> = { tracks, index: Math.max(0, Math.min(q.index, tracks.length - 1)), position: Math.max(0, q.position || 0), shuffle: Boolean(q.shuffle), repeat: q.repeat === "all" || q.repeat === "one" ? q.repeat : "off", source, playing: Boolean(q.playing) };
  /* A device reporting late doesn't pull the queue back. */
  musicDb().prepare("INSERT INTO queues (username, data, updated_at) VALUES (?, ?, ?) ON CONFLICT (username) DO UPDATE SET data = excluded.data, updated_at = excluded.updated_at WHERE excluded.updated_at >= queues.updated_at")
    .run(user(username), JSON.stringify(data), at);
  return getQueue(username);
}

/* ── Taste ─────────────────────────────────────────────────────────────── */

/*
 * What someone likes, worked out from what they did: a song heard most of the
 * way counts for its artist, one skipped early counts a little against, and a
 * rating counts more (love most). Recent listening counts more than old
 * (a play loses half its weight every 60 days). Tags come from the artists.
 */
const halfLife = 60 * DAY;
const ratingWeight: Record<Rating, number> = { love: 3, up: 1, down: -2 };

export async function taste(config: MusicConfig, username: string) {
  const db = musicDb();
  const now = Date.now();
  const artists = new Map<string, { name: string; score: number }>();
  /* A YouTube song's channel has no artist page (no key): it counts for nothing here. */
  const add = (key: string, name: string, w: number) => { if (!key) return; const a = artists.get(key) ?? { name, score: 0 }; a.score += w; artists.set(key, a); };
  const plays = db.prepare("SELECT artists, played_at, seconds, length FROM plays WHERE username = ? AND played_at > ?").all(user(username), now - 365 * DAY) as { artists: string; played_at: number; seconds: number; length: number }[];
  for (const p of plays) {
    const decay = Math.pow(0.5, (now - p.played_at) / halfLife);
    const heard = p.length ? p.seconds / p.length : 0;
    const w = heard >= 0.6 ? 1 : p.seconds < 30 ? -0.5 : 0.25;
    for (const a of JSON.parse(p.artists) as { key: string; name: string }[]) add(a.key, a.name, w * decay);
  }
  for (const r of ratings(username)) {
    const w = ratingWeight[r.rating];
    if (r.kind === "artist") add(r.key, r.title, w * 2);
    else if (r.subtitle) {
      /* A rated song or album counts for its artist, who's kept with the track. */
      const t = r.kind === "track" ? keptTracks([r.key]).get(r.key) : null;
      for (const a of t?.artists ?? []) add(a.key, a.name, w);
    }
  }
  const topArtists = [...artists.entries()].map(([key, a]) => ({ key, ...a })).filter((a) => a.score > 0).sort((a, b) => b.score - a.score).slice(0, 25);
  const tags = new Map<string, number>();
  await Promise.all(topArtists.slice(0, 15).map(async (a) => {
    const t = await artistTags(config, a.key, a.name).catch(() => []);
    t.forEach((tag, i) => tags.set(tag, (tags.get(tag) ?? 0) + a.score * (1 - i * 0.1)));
  }));
  const disliked = new Set([...artists.entries()].filter(([, a]) => a.score < -1).map(([k]) => k));
  return { plays: plays.length, artists: topArtists, tags: [...tags.entries()].sort((a, b) => b[1] - a[1]).slice(0, 12).map(([tag, score]) => ({ tag, score: Math.round(score * 100) / 100 })), disliked };
}

/* ── Finding more ──────────────────────────────────────────────────────── */

/** Songs named by Last.fm, found on Deezer (kept, so each name is looked up once). */
async function byName(list: { artist: string; title: string }[], limit: number): Promise<Track[]> {
  const out: Track[] = [];
  for (let i = 0; i < list.length && out.length < limit; i += 6) {
    const found = await Promise.all(list.slice(i, i + 6).map(({ artist, title }) =>
      kept<Track>("named", `${artist.toLowerCase()}|${title.toLowerCase()}`, 60 * DAY, () => dz.find(artist, title)).catch(() => null)));
    for (const t of found) if (t && !out.some((o) => o.key === t.key)) out.push(t);
  }
  keepTracks(out);
  return out.slice(0, limit);
}

const downRated = (username: string) => new Set(ratings(username).filter((r) => r.rating === "down").map((r) => r.key));

function mixed(tracks: Track[], username: string, disliked: Set<string>, skip = new Set<string>()) {
  const down = downRated(username);
  const seen = new Set<string>();
  return tracks.filter((t) => {
    if (seen.has(t.key) || skip.has(t.key) || down.has(t.key) || t.artists.some((a) => a.key && (disliked.has(a.key) || down.has(a.key)))) return false;
    seen.add(t.key);
    return true;
  });
}

/* Who a song is by, for keeping one artist from taking over a mix. */
const byWhom = (t: Track) => t.artists[0]?.key || t.artists[0]?.name.toLowerCase() || t.key;

/**
 * At most [cap] songs by any one artist ([caps] for some), then reordered so
 * the same artist doesn't come twice in a row where it can be helped.
 */
function spread(list: Track[], cap = 2, caps: Record<string, number> = {}): Track[] {
  const count = new Map<string, number>();
  const left = list.filter((t) => {
    const a = byWhom(t);
    const n = count.get(a) ?? 0;
    if (n >= (caps[a] ?? cap)) return false;
    count.set(a, n + 1);
    return true;
  });
  const out: Track[] = [];
  while (left.length) {
    const last = out.length ? byWhom(out[out.length - 1]) : null;
    const i = left.findIndex((t) => byWhom(t) !== last);
    out.push(...left.splice(i < 0 ? 0 : i, 1));
  }
  return out;
}

/** What you've heard (past 30s, this past year), and every artist you've played at all: what isn't new to you. */
function familiar(username: string) {
  const rows = musicDb().prepare("SELECT track, artists, seconds FROM plays WHERE username = ? AND played_at > ?").all(user(username), Date.now() - 365 * DAY) as { track: string; artists: string; seconds: number }[];
  const songs = new Set<string>();
  const artists = new Set<string>();
  for (const r of rows) {
    if (r.seconds >= 30) songs.add(r.track);
    for (const a of JSON.parse(r.artists) as { key: string }[]) if (a.key) artists.add(a.key);
  }
  return { songs, artists };
}

/* A few at a time: a cold start asks Deezer for four things per artist, and it allows fifty every five seconds. */
async function inTurn<T, R>(list: T[], each: (x: T) => Promise<R>, at = 4): Promise<R[]> {
  const out: R[] = [];
  for (let i = 0; i < list.length; i += at) out.push(...await Promise.all(list.slice(i, i + at).map(each)));
  return out;
}

const artistPage = (key: string) => kept("artist", key, 7 * DAY, () => dz.artist(idOf(key))).catch(() => null);

/**
 * New to you: artists Deezer puts beside the ones you play that you've never
 * played, the ones beside several of yours first, two of their best songs
 * each. Changes daily.
 */
async function newToYou(t: Awaited<ReturnType<typeof taste>>, username: string, known: ReturnType<typeof familiar>, daySeed: number): Promise<Track[]> {
  const seeds = t.artists.slice(0, 10);
  const pages = await inTurn(seeds, (a) => artistPage(a.key));
  const near = new Map<string, number>();
  pages.forEach((p, i) => (p?.related ?? []).forEach((a, rank) => {
    if (known.artists.has(a.key) || t.disliked.has(a.key)) return;
    near.set(a.key, (near.get(a.key) ?? 0) + seeds[i].score * (1 - rank * 0.05));
  }));
  /* The closest twenty-four, a different fifteen of them each day. */
  const closest = [...near.entries()].sort((a, b) => b[1] - a[1]).slice(0, 24).map(([k]) => k);
  const picked = shuffled(closest, daySeed).slice(0, 15);
  const tops = await inTurn(picked, (k) => artistPage(k));
  const songs = tops.flatMap((p) => shuffled((p?.top ?? []).slice(0, 6), daySeed).filter((s) => !known.songs.has(s.key)).slice(0, 2));
  keepTracks(songs);
  return spread(mixed(songs, username, t.disliked), 2).slice(0, 25);
}

/** More like a song, for when the queue runs out: Last.fm's similar songs, else Deezer's radio of its artist. */
export async function radio(config: MusicConfig, username: string, seed: string, skip: string[] = []): Promise<Track[]> {
  const track = await getTrack(seed);
  if (!track) throw new MusicProblem("No such song.", 404);
  const { disliked } = await taste(config, username);
  let found: Track[] = [];
  if (config.lastfmKey) {
    const similar = await kept("similar", seed, 30 * DAY, () => lastfm(config.lastfmKey).similarTracks(track.artists[0]?.name ?? "", track.title, 60)).catch(() => null);
    found = await byName(similar ?? [], 30);
  }
  const first = track.artists[0]?.key;
  if (found.length < 10 && first) found.push(...await artistRadio(first));
  /* Not a run of one artist: two each, the song's own artist included. */
  let out = spread(mixed(found, username, disliked, new Set([seed, ...skip])), 2);
  if (out.length < 15 && first) {
    const near = (await artistPage(first))?.related.slice(0, 8) ?? [];
    const tops = await inTurn(near, (a) => artistPage(a.key));
    out = spread(mixed([...out, ...tops.flatMap((p) => (p?.top ?? []).slice(0, 3))], username, disliked, new Set([seed, ...skip])), 2);
  }
  return out.slice(0, 25);
}

export async function artistRadio(key: string): Promise<Track[]> {
  const r = await kept<Track[]>("artist-radio", key, DAY, () => dz.artistRadio(idOf(key)));
  keepTracks(r ?? []);
  return r ?? [];
}

const shuffled = <T,>(list: T[], seed: number) => {
  const out = [...list];
  let s = seed;
  for (let i = out.length - 1; i > 0; i--) { s = (s * 9301 + 49297) % 233280; const j = Math.floor((s / 233280) * (i + 1)); [out[i], out[j]] = [out[j], out[i]]; }
  return out;
};

export type Home = {
  greeting: "new" | "back";
  jumpBack: (Track & { playedAt: string })[];
  /** Your most played, for the grid at the top (pages of nine). */
  listenAgain: Track[];
  /** The artists you play most. */
  yourArtists: Artist[];
  mixes: Row[];
  artists: Artist[];
  charts: Row;
  albums: Album[];
  playlists: Playlist[];
  genres: { id: number; name: string; picture: string | null }[];
};

/**
 * Home: what you played lately; mixes from what you listen to (your genres
 * and the artists you come back to), once there's enough to go on; and the
 * charts, which are where someone new starts.
 */
export async function homeFor(config: MusicConfig, username: string): Promise<Home> {
  const [t, top, gs] = await Promise.all([taste(config, username), chart(0), genres().catch(() => [])]);
  const recent = history(username, 20);
  const heard = new Set(recent.map((r) => r.key));
  const daySeed = Math.floor(Date.now() / DAY);
  const mixes: Row[] = [];
  if (t.plays >= 10 || t.artists.length >= 3) {
    const known = familiar(username);
    /* First, what you haven't heard: artists beside yours you've never played. */
    const fresh = await newToYou(t, username, known, daySeed).catch(() => []);
    if (fresh.length >= 8) mixes.push({ id: "new", title: "New to you", items: fresh });
    /*
     * One mix for each of your top genres (Last.fm's tag charts, deep into
     * them): songs you haven't heard, two an artist, the ones you don't
     * already play first.
     */
    if (config.lastfmKey) {
      const tagMixes = await Promise.all(t.tags.slice(0, 3).map(async ({ tag }) => {
        const named = await kept("tag-tracks-deep", tag, 7 * DAY, () => lastfm(config.lastfmKey).tagTracks(tag, 150)).catch(() => null);
        const found = mixed(await byName(shuffled(named ?? [], daySeed).slice(0, 45), 40), username, t.disliked, known.songs);
        const ordered = [...found.filter((x) => !known.artists.has(byWhom(x))), ...found.filter((x) => known.artists.has(byWhom(x)))];
        return { id: `tag:${tag}`, title: tag.replace(/\b\p{L}/gu, (c) => c.toUpperCase()), items: spread(ordered, 2).slice(0, 25) };
      }));
      mixes.push(...tagMixes.filter((m) => m.items.length >= 6));
    }
    /* One for each of your top artists: their radio, a few of theirs and the rest by others, the unheard ahead. */
    const artistMixes = await Promise.all(t.artists.slice(0, 3).map(async (a) => {
      const radio = mixed(shuffled(await artistRadio(a.key).catch(() => []), daySeed), username, t.disliked);
      const ordered = [...radio.filter((x) => !known.songs.has(x.key)), ...radio.filter((x) => known.songs.has(x.key))];
      return { id: `artist:${a.key}`, title: `${a.name} and more`, items: spread(ordered, 2, { [a.key]: 4 }).slice(0, 25) };
    }));
    mixes.push(...artistMixes.filter((m) => m.items.length >= 6));
  }
  /* Artists like the ones you play that you've never played. */
  const known = familiar(username).artists;
  for (const a of t.artists) known.add(a.key);
  let artists: Artist[] = top.artists;
  const pages = await inTurn(t.artists.slice(0, 10), (a) => getArtist(config, a.key).catch(() => null));
  const yourArtists = pages.flatMap((p) => p ? [p.artist] : []);
  if (t.artists.length) {
    const related = pages.slice(0, 6).map((p) => p?.related ?? []);
    const fresh = related.flat().filter((a, i, all) => !known.has(a.key) && !t.disliked.has(a.key) && all.findIndex((b) => b.key === a.key) === i);
    if (fresh.length >= 4) artists = shuffled(fresh, daySeed).slice(0, 12);
  }
  return {
    greeting: t.plays ? "back" : "new",
    jumpBack: recent,
    listenAgain: mostPlayed(username),
    yourArtists: yourArtists.length >= 3 ? yourArtists : [],
    mixes,
    artists,
    charts: { id: "chart", title: "Top songs", items: mixed(top.tracks, username, t.disliked, heard.size > 30 ? heard : new Set()).slice(0, 20) },
    albums: top.albums,
    playlists: playlists(username),
    genres: gs.filter((x) => x.id !== 0).slice(0, 16),
  };
}

/** A mix on Home, played as a whole (its id says which). */
export async function mix(config: MusicConfig, username: string, id: string): Promise<Row> {
  const home = await homeFor(config, username);
  const found = home.mixes.find((m) => m.id === id) ?? (id === "chart" ? home.charts : null);
  if (!found) throw new MusicProblem("No such mix.", 404);
  return found;
}

/* ── Requests ──────────────────────────────────────────────────────────── */

export async function musicSettings() {
  return musicConfig(await getPlatformSettings());
}

/** Runs an API request with Music's settings, answering its problems as JSON. */
export async function music(work: (config: MusicConfig) => Promise<Response> | Response): Promise<Response> {
  try {
    const config = await musicSettings();
    if (!config.enabled) return apiError(404, "Music isn't switched on.");
    return await work(config);
  } catch (error) {
    if (error instanceof MusicProblem) return apiError(error.status, error.message);
    console.error("music:", error);
    return apiError(502, "Music couldn't reach its sources. Try again in a moment.");
  }
}
