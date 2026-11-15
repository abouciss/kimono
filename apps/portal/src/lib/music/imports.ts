import "server-only";

import { createPlaylist, kept, keepTracks } from "./index";
import { MusicProblem, plainTitle, type Track } from "./model";
import { deezerSource as dz } from "./sources";
import { playlistOf } from "./youtube";

/*
 * Bringing a playlist in from Spotify, Apple Music or YouTube Music: its
 * songs are read from the link (public playlists need no sign-in) and each is
 * found in the catalogue: by ISRC where the service gives one (the same
 * release, exactly), else by artist, title and length.
 */

export type Service = "spotify" | "apple" | "youtube";
/** A song as another service names it. */
/** `video`: a music video, whose length runs past the song's (an intro, a scene after). */
export type Wanted = { title: string; artists: string[]; album: string | null; seconds: number; isrc: string | null; video?: boolean };
export type Source = { service: Service; name: string; cover: string | null; tracks: Wanted[]; cut: boolean };

export const serviceName: Record<Service, string> = { spotify: "Spotify", apple: "Apple Music", youtube: "YouTube Music" };
const MAX = 5000;
const DAY = 24 * 3600_000;

/* ── Links ─────────────────────────────────────────────────────────────── */

export type Link = { service: Service; id: string; storefront: string };

export function linkOf(text: string): Link | null {
  const raw = text.trim();
  const uri = /^spotify:(?:user:[^:]+:)?playlist:([A-Za-z0-9]{22})$/.exec(raw);
  if (uri) return { service: "spotify", id: uri[1], storefront: "" };
  let url: URL;
  try { url = new URL(/^https?:\/\//.test(raw) ? raw : `https://${raw}`); } catch { return null; }
  const host = url.hostname.replace(/^www\./, "");
  if (host === "open.spotify.com" || host === "play.spotify.com") {
    const m = /\/playlist\/([A-Za-z0-9]{22})/.exec(url.pathname);
    return m ? { service: "spotify", id: m[1], storefront: "" } : null;
  }
  if (host === "music.apple.com" || host === "embed.music.apple.com" || host === "itunes.apple.com") {
    const m = /^\/([a-z]{2})\/playlist\/(?:[^/]+\/)?(pl\.[A-Za-z0-9.-]+)/.exec(url.pathname);
    return m ? { service: "apple", id: m[2], storefront: m[1] } : null;
  }
  if (host === "music.youtube.com" || host === "youtube.com" || host === "m.youtube.com" || host === "youtu.be") {
    const list = url.searchParams.get("list");
    return list && /^[A-Za-z0-9_-]{2,64}$/.test(list) ? { service: "youtube", id: list, storefront: "" } : null;
  }
  return null;
}

/* ── Reading ───────────────────────────────────────────────────────────── */

const browser = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Safari/537.36";
type Json = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any

async function page(url: string, init?: RequestInit) {
  const res = await fetch(url, { ...init, headers: { "user-agent": browser, "accept-language": "en", ...init?.headers }, signal: AbortSignal.timeout(15_000), cache: "no-store" });
  return res;
}

const g = globalThis as unknown as { kimonoImportKeys?: { spotifyHash?: { value: string; until: number }; apple?: { value: string; until: number } } };
const keys = () => (g.kimonoImportKeys ??= {});

/* Spotify: its embed gives a playlist's first 100 songs and a visitor's token; the web player's own query gives the rest. */
const spotifyHashKnown = "21ea11a6ac75a5f3e01fd365d29c18e0a4a8b7dc09f89bbb5d73910190c6acaf";

async function spotifyHash(): Promise<string> {
  const k = keys();
  if (k.spotifyHash && Date.now() < k.spotifyHash.until) return k.spotifyHash.value;
  let value = spotifyHashKnown;
  try {
    const html = await (await page("https://open.spotify.com/")).text();
    for (const src of new Set(html.match(/https:\/\/open[\w.-]*\.spotifycdn\.com\/[^"']+\.js/g) ?? [])) {
      const m = /"fetchPlaylist","query","([0-9a-f]{64})"/.exec(await (await page(src)).text());
      if (m) { value = m[1]; break; }
    }
  } catch { /* the one known last */ }
  k.spotifyHash = { value, until: Date.now() + DAY };
  return value;
}

async function readSpotify(id: string): Promise<Source> {
  const res = await page(`https://open.spotify.com/embed/playlist/${id}`);
  const data = /<script id="__NEXT_DATA__"[^>]*>([\s\S]*?)<\/script>/.exec(await res.text());
  const state = data ? (JSON.parse(data[1]) as Json).props?.pageProps?.state : null;
  const entity = state?.data?.entity;
  if (!res.ok || !entity?.trackList) throw new MusicProblem("That Spotify playlist is private or gone. Connect Spotify to bring in your private ones.", 404);
  const first: Wanted[] = (entity.trackList as Json[]).filter((t) => t.title).map((t) => ({
    title: String(t.title), artists: String(t.subtitle ?? "").split(/,\s*/).map((a) => a.trim()).filter(Boolean),
    album: null, seconds: Math.round(Number(t.duration) / 1000) || 0, isrc: null,
  }));
  const source: Source = { service: "spotify", name: String(entity.name ?? ""), cover: entity.coverArt?.sources?.[0]?.url ?? null, tracks: first, cut: false };
  if (first.length < 100) return source;
  /* A hundred is where the embed stops: the rest from the web player's query, with the embed's token. */
  const token = state?.settings?.session?.accessToken;
  try {
    const hash = await spotifyHash();
    const all: Wanted[] = [];
    for (let offset = 0; offset < MAX; offset += 100) {
      const r = await page("https://api-partner.spotify.com/pathfinder/v2/query", {
        method: "POST",
        headers: { authorization: `Bearer ${token}`, "content-type": "application/json;charset=UTF-8", "app-platform": "WebPlayer" },
        body: JSON.stringify({ operationName: "fetchPlaylist", variables: { uri: `spotify:playlist:${id}`, offset, limit: 100, enableWatchFeedEntrypoint: false }, extensions: { persistedQuery: { version: 1, sha256Hash: hash } } }),
      });
      if (!r.ok) throw new Error(`spotify ${r.status}`);
      const content = ((await r.json()) as Json).data?.playlistV2?.content;
      if (!content?.items) throw new Error("spotify: no items");
      for (const item of content.items as Json[]) {
        const t = item.itemV2?.data;
        if (t?.__typename !== "Track" || !t.name) continue;
        all.push({ title: String(t.name), artists: ((t.artists?.items ?? []) as Json[]).map((a) => String(a.profile?.name ?? "")).filter(Boolean),
          album: t.albumOfTrack?.name ?? null, seconds: Math.round(Number(t.trackDuration?.totalMilliseconds) / 1000) || 0, isrc: null });
      }
      if (offset + 100 >= Number(content.totalCount ?? 0)) break;
    }
    if (all.length >= first.length) source.tracks = all;
  } catch (error) {
    console.warn("music import: spotify past 100:", error);
    source.cut = true;
  }
  return source;
}

/* Apple Music: the web player's own token reads any public playlist, ISRCs included. */
async function appleToken(): Promise<string> {
  const k = keys();
  if (k.apple && Date.now() < k.apple.until) return k.apple.value;
  const html = await (await page("https://music.apple.com/us/browse")).text();
  for (const src of new Set(html.match(/\/assets\/index[^"']*\.js/g) ?? [])) {
    const m = /eyJ[\w-]+\.eyJpc3MiOiJBTVBXZWJQbGF5[\w-]*\.[\w-]+/.exec(await (await page(`https://music.apple.com${src}`)).text());
    if (!m) continue;
    let until = Date.now() + 12 * 3600_000;
    try { until = Math.min(until, JSON.parse(Buffer.from(m[0].split(".")[1], "base64url").toString()).exp * 1000 - 3600_000); } catch { /* twelve hours */ }
    k.apple = { value: m[0], until };
    return m[0];
  }
  throw new MusicProblem("Apple Music isn't answering right now.");
}

async function readApple(id: string, storefront: string): Promise<Source> {
  const token = await appleToken();
  const ask = async (path: string) => {
    const r = await page(`https://amp-api.music.apple.com${path}`, { headers: { authorization: `Bearer ${token}`, origin: "https://music.apple.com" } });
    if (r.status === 401) { keys().apple = undefined; throw new MusicProblem("Apple Music isn't answering right now. Try again."); }
    if (r.status === 404) throw new MusicProblem("That Apple Music playlist is private or gone. Connect Apple Music to bring in your library's.", 404);
    if (!r.ok) throw new MusicProblem(`Apple Music: ${r.status}`);
    return (await r.json()) as Json;
  };
  const head = (await ask(`/v1/catalog/${storefront}/playlists/${encodeURIComponent(id)}`)).data?.[0]?.attributes ?? {};
  const tracks: Wanted[] = [];
  let next: string | null = `/v1/catalog/${storefront}/playlists/${encodeURIComponent(id)}/tracks?limit=100`;
  while (next && tracks.length < MAX) {
    const body = await ask(next);
    for (const t of (body.data ?? []) as Json[]) {
      const a = t.attributes;
      if (!a?.name) continue;
      tracks.push({ title: String(a.name), artists: [String(a.artistName ?? "")].filter(Boolean), album: a.albumName ?? null,
        seconds: Math.round(Number(a.durationInMillis) / 1000) || 0, isrc: typeof a.isrc === "string" ? a.isrc : null });
    }
    next = typeof body.next === "string" ? `${body.next}${body.next.includes("limit=") ? "" : "&limit=100"}` : null;
  }
  const art = typeof head.artwork?.url === "string" ? head.artwork.url.replace("{w}", "600").replace("{h}", "600").replace("{f}", "jpg") : null;
  return { service: "apple", name: String(head.name ?? ""), cover: art, tracks, cut: false };
}

/* YouTube: a song's channel is "Artist - Topic" or "ArtistVEVO"; a video's title is often "Artist - Song (Official Video)". */
export function fromYouTube(item: { title: string; artists: string[]; album: string | null; seconds: number }): Wanted {
  let artists = item.artists.map((a) => a.replace(/\s*-\s*Topic$/i, "").replace(/VEVO$/i, "").trim()).filter(Boolean);
  let title = item.title;
  const split = /^(.+?)\s+[-–—]\s+(.+)$/.exec(title);
  if (split && !item.album) { artists = [split[1].trim()]; title = split[2]; }
  title = title.replace(/\s*[([](?:official|lyrics?|audio|music video|video|visuali[sz]er|hd|4k)[^)\]]*[)\]]/gi, "").trim();
  return { title, artists, album: item.album, seconds: item.seconds, isrc: null, video: !item.album };
}

async function readYouTube(id: string): Promise<Source> {
  if (id === "LM" || id === "LL" || id === "WL") throw new MusicProblem("That's your own list on YouTube: connect YouTube Music to bring it in.", 400);
  const p = await playlistOf(id, MAX).catch((error) => {
    console.warn("music import: youtube:", error);
    throw new MusicProblem("That YouTube playlist is private or gone. Connect YouTube Music to bring in your private ones.", 404);
  });
  return { service: "youtube", name: p.name, cover: p.cover, tracks: p.items.map(fromYouTube), cut: false };
}

export async function readLink(link: Link): Promise<Source> {
  const source = link.service === "spotify" ? await readSpotify(link.id) : link.service === "apple" ? await readApple(link.id, link.storefront) : await readYouTube(link.id);
  if (!source.tracks.length) throw new MusicProblem("That playlist has no songs to bring in.", 404);
  return source;
}

/* ── Finding each song here ────────────────────────────────────────────── */

/* Deezer allows 50 requests in 5 seconds: an import takes 8 a second, leaving room for everyone listening. */
let nextTurn = 0;
async function turn() {
  const now = Date.now();
  const at = Math.max(now, nextTurn);
  nextTurn = at + 125;
  if (at > now) await new Promise((r) => setTimeout(r, at - now));
}

const bare = (title: string) => plainTitle(title.replace(/\s*[([][^)\]]*[)\]]/g, "").replace(/\s+-\s+.*$/, "")) || plainTitle(title);
const versionWords = /\b(live|remix|acoustic|instrumental|karaoke|sped up|slowed|demo|cover)\b/g;

/** How sure a catalogue track is the song named: 0 is no, higher is better. */
export function likeness(w: Wanted, t: Track): number {
  const want = bare(w.title), got = bare(t.title);
  if (!want || !got) return 0;
  if (!(want === got || ` ${got} `.includes(` ${want} `) || ` ${want} `.includes(` ${got} `))) return 0;
  /* A live take or a remix is another recording, unless that's what was asked for. */
  const asked = new Set(plainTitle(w.title).match(versionWords) ?? []), has = new Set(plainTitle(t.title).match(versionWords) ?? []);
  for (const v of has) if (!asked.has(v)) return 0;
  for (const v of asked) if (!has.has(v)) return 0;
  const theirs = w.artists.map(plainTitle).filter(Boolean);
  const ours = t.artists.map((a) => plainTitle(a.name)).filter(Boolean);
  const sameArtist = !theirs.length || theirs.some((a) => ours.some((b) => a.includes(b) || b.includes(a)));
  if (!sameArtist) return 0;
  const off = w.seconds && t.duration ? Math.abs(w.seconds - t.duration) : 0;
  /* A video only ever runs longer than its song, and an intro can be minutes. */
  const late = w.video ? Math.max(0, w.seconds - t.duration) : off;
  if (w.video ? t.duration - w.seconds > 20 || late > 360 : off > 30) return 0;
  return 10 + (want === got ? 3 : 0) + (w.album && t.album && plainTitle(w.album) === plainTitle(t.album.title) ? 2 : 0)
    - (w.video ? late / 60 : off / 3 + (off > 10 ? 4 : 0));
}

async function find(w: Wanted): Promise<Track | null> {
  if (w.isrc) {
    await turn();
    const exact = await dz.isrc(w.isrc).catch(() => null);
    if (exact && likeness({ ...w, artists: [] }, exact) > 0) return exact;
  }
  const artist = w.artists[0] ?? "";
  const title = w.title.replace(/\s*[([](feat|ft|with)\.?\s[^)\]]*[)\]]/gi, "").replace(/\s+(?:feat\.?|ft\.|with)\s.*$/i, "").replace(/\s+-\s+.*(remaster|version|edit|mix).*$/i, "").trim();
  const asks = [artist ? `artist:"${artist}" track:"${title}"` : `track:"${title}"`, `${artist} ${title}`.trim()];
  let best: { t: Track; s: number } | null = null;
  for (const ask of asks) {
    await turn();
    for (const t of await dz.searchTracks(ask, 10).catch(() => [])) {
      const s = likeness(w, t);
      if (s > 0 && (!best || s > best.s)) best = { t, s };
    }
    if (best && best.s >= 10) break;
  }
  return best?.t ?? null;
}

/** The catalogue's track for a song named elsewhere, kept a month (a miss, a day). */
export function match(w: Wanted): Promise<Track | null> {
  const id = [w.isrc ?? "", w.artists.join(","), w.title, w.seconds].join("|").toLowerCase().slice(0, 400);
  return kept("import-match", id, 30 * DAY, () => find(w));
}

export type Progress =
  | { stage: "read"; name: string; service: Service; total: number; cut: boolean }
  | { stage: "match"; done: number; found: number; total: number }
  | { stage: "done"; playlist: { id: string; name: string }; found: number; total: number; missed: { title: string; artists: string[] }[] };

/** A playlist link, read. */
export function fromLink(text: string): () => Promise<Source> {
  const link = linkOf(text);
  if (!link) throw new MusicProblem("That isn't a Spotify, Apple Music or YouTube Music playlist link.", 400);
  return () => readLink(link);
}

/** Reads the playlist, finds its songs, and makes it here, telling `say` how far along it is. */
export async function importPlaylist(username: string, read: () => Promise<Source>, say: (p: Progress) => void, name?: string): Promise<void> {
  const source = await read();
  if (!source.tracks.length) throw new MusicProblem("That playlist has no songs to bring in.", 404);
  const total = source.tracks.length;
  say({ stage: "read", name: source.name, service: source.service, total, cut: source.cut });
  const found: (Track | null)[] = new Array(total).fill(null);
  let done = 0, hits = 0, last = 0;
  let next = 0;
  await Promise.all(Array.from({ length: 6 }, async () => {
    while (next < total) {
      const i = next++;
      found[i] = await match(source.tracks[i]).catch(() => null);
      done++; if (found[i]) hits++;
      if (Date.now() - last > 300 || done === total) { last = Date.now(); say({ stage: "match", done, found: hits, total }); }
    }
  }));
  const tracks = found.filter((t): t is Track => Boolean(t));
  if (!tracks.length) throw new MusicProblem("None of its songs are in Music's catalogue.", 404);
  keepTracks(tracks);
  const title = (name?.trim() || source.name.trim() || `From ${serviceName[source.service]}`).slice(0, 120);
  const made = await createPlaylist(username, title, tracks.map((t) => t.key));
  say({
    stage: "done", playlist: { id: made.id, name: made.name }, found: tracks.length, total,
    missed: source.tracks.flatMap((w, i) => (found[i] ? [] : [{ title: w.title, artists: w.artists }])).slice(0, 200),
  });
}
