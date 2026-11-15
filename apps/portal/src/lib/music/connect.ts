import "server-only";

import { createHash, createPrivateKey, randomBytes, sign } from "node:crypto";
import { portalOrigin } from "../account";
import type { MusicConfig } from "./config";
import { fromYouTube, type Service, type Source, type Wanted } from "./imports";
import { musicDb } from "./index";
import { MusicProblem } from "./model";

/*
 * Signing in to Spotify, YouTube (Google) or Apple Music, so a person can
 * bring in the playlists they keep private, and their liked songs. Each
 * service's sign-in is the admin's to set up (Music's settings); a person's
 * tokens are kept in music.db and only ever used to read their playlists.
 */

type Json = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any
const MAX = 5000;
const user = (u: string) => u.toLowerCase();

export type Mine = { id: string; name: string; count: number | null; cover: string | null };
export type Account = { service: Service; ready: boolean; connected: boolean };

export function ready(config: MusicConfig, service: Service): boolean {
  if (service === "spotify") return Boolean(config.spotify.id && config.spotify.secret);
  if (service === "youtube") return Boolean(config.google.id && config.google.secret);
  return Boolean(config.apple.team && config.apple.keyId && config.apple.key);
}

export function accounts(config: MusicConfig, username: string): Account[] {
  const have = new Set((musicDb().prepare("SELECT service FROM connections WHERE username = ?").all(user(username)) as { service: string }[]).map((r) => r.service));
  return (["spotify", "apple", "youtube"] as Service[]).map((service) => ({ service, ready: ready(config, service), connected: have.has(service) }));
}

export function disconnect(username: string, service: Service) {
  musicDb().prepare("DELETE FROM connections WHERE username = ? AND service = ?").run(user(username), service);
}

function keep(username: string, service: Service, access: string, refresh: string | null, seconds: number) {
  musicDb().prepare(`INSERT INTO connections (username, service, access, refresh, expires_at, at) VALUES (?, ?, ?, ?, ?, ?)
    ON CONFLICT (username, service) DO UPDATE SET access = excluded.access, refresh = COALESCE(excluded.refresh, connections.refresh), expires_at = excluded.expires_at, at = excluded.at`)
    .run(user(username), service, access, refresh, Date.now() + seconds * 1000, Date.now());
}

/* ── Spotify and Google: OAuth with PKCE ───────────────────────────────── */

const callback = (service: Service) => `${portalOrigin()}/api/v1/music/connect/${service}/callback`;

const g = globalThis as unknown as { kimonoMusicConnecting?: Map<string, { username: string; service: Service; verifier: string; at: number }> };
const pending = () => (g.kimonoMusicConnecting ??= new Map());

/** Where to send the person to sign in to the service. */
export function signInUrl(config: MusicConfig, username: string, service: "spotify" | "youtube"): string {
  if (!ready(config, service)) throw new MusicProblem("That service isn't set up for Music.", 404);
  const state = randomBytes(24).toString("base64url");
  const verifier = randomBytes(48).toString("base64url");
  for (const [k, v] of pending()) if (Date.now() - v.at > 15 * 60_000) pending().delete(k);
  pending().set(state, { username: user(username), service, verifier, at: Date.now() });
  const challenge = createHash("sha256").update(verifier).digest("base64url");
  const common = { response_type: "code", redirect_uri: callback(service), state, code_challenge_method: "S256", code_challenge: challenge };
  if (service === "spotify") {
    return `https://accounts.spotify.com/authorize?${new URLSearchParams({ ...common, client_id: config.spotify.id, scope: "playlist-read-private playlist-read-collaborative user-library-read" })}`;
  }
  return `https://accounts.google.com/o/oauth2/v2/auth?${new URLSearchParams({ ...common, client_id: config.google.id, scope: "https://www.googleapis.com/auth/youtube.readonly", access_type: "offline", prompt: "consent" })}`;
}

async function tokenCall(config: MusicConfig, service: "spotify" | "youtube", form: Record<string, string>) {
  const client = service === "spotify" ? config.spotify : config.google;
  const res = await fetch(service === "spotify" ? "https://accounts.spotify.com/api/token" : "https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded", authorization: `Basic ${Buffer.from(`${client.id}:${client.secret}`).toString("base64")}` },
    body: new URLSearchParams({ ...form, client_id: client.id, client_secret: client.secret }),
    signal: AbortSignal.timeout(15_000),
  });
  const body = await res.json().catch(() => ({})) as Json;
  if (!res.ok || !body.access_token) throw new MusicProblem(`${service === "spotify" ? "Spotify" : "Google"} didn't sign you in${body.error_description ? `: ${body.error_description}` : ""}.`, 400);
  return body as { access_token: string; refresh_token?: string; expires_in?: number };
}

/** The service sent the person back: their code becomes tokens kept here. Answers whose it was. */
export async function finishSignIn(config: MusicConfig, service: "spotify" | "youtube", state: string, code: string, username: string) {
  const asked = pending().get(state);
  pending().delete(state);
  if (!asked || asked.service !== service || asked.username !== user(username) || Date.now() - asked.at > 15 * 60_000) throw new MusicProblem("That sign-in ran out. Try again.", 400);
  const t = await tokenCall(config, service, { grant_type: "authorization_code", code, redirect_uri: callback(service), code_verifier: asked.verifier });
  keep(username, service, t.access_token, t.refresh_token ?? null, t.expires_in ?? 3600);
}

async function accessFor(config: MusicConfig, username: string, service: Service): Promise<string> {
  const row = musicDb().prepare("SELECT access, refresh, expires_at FROM connections WHERE username = ? AND service = ?").get(user(username), service) as { access: string; refresh: string | null; expires_at: number } | undefined;
  if (!row) throw new MusicProblem("Connect it first.", 401);
  if (service === "apple" || Date.now() < row.expires_at - 60_000) return row.access;
  if (!row.refresh) { disconnect(username, service); throw new MusicProblem("Your sign-in ran out. Connect again.", 401); }
  try {
    const t = await tokenCall(config, service, { grant_type: "refresh_token", refresh_token: row.refresh });
    keep(username, service, t.access_token, t.refresh_token ?? null, t.expires_in ?? 3600);
    return t.access_token;
  } catch {
    disconnect(username, service);
    throw new MusicProblem("Your sign-in ran out. Connect again.", 401);
  }
}

async function api(url: string, headers: Record<string, string>, service: Service, username: string): Promise<Json> {
  const res = await fetch(url, { headers, signal: AbortSignal.timeout(20_000), cache: "no-store" });
  if (res.status === 401) { disconnect(username, service); throw new MusicProblem("Your sign-in ran out. Connect again.", 401); }
  if (res.status === 404) throw new MusicProblem("That playlist is gone.", 404);
  if (!res.ok) throw new MusicProblem(`${service === "spotify" ? "Spotify" : service === "apple" ? "Apple Music" : "YouTube"}: ${res.status}`);
  return await res.json() as Json;
}

/* ── Apple Music: MusicKit, signed in on the page ──────────────────────── */

/** MusicKit's developer token: a JWT the team's key signs, good for a month (kept for a day). */
let developer: { token: string; until: number } | null = null;
export function developerToken(config: MusicConfig): string {
  if (!ready(config, "apple")) throw new MusicProblem("Apple Music isn't set up for Music.", 404);
  if (developer && Date.now() < developer.until) return developer.token;
  /* A key pasted into a one-line field loses its line breaks: put the PEM back together. */
  const body = config.apple.key.replace(/-----(BEGIN|END) PRIVATE KEY-----/g, "").replace(/\s+/g, "");
  const key = createPrivateKey(`-----BEGIN PRIVATE KEY-----\n${body.match(/.{1,64}/g)?.join("\n")}\n-----END PRIVATE KEY-----\n`);
  const now = Math.floor(Date.now() / 1000);
  const part = (o: object) => Buffer.from(JSON.stringify(o)).toString("base64url");
  const unsigned = `${part({ alg: "ES256", kid: config.apple.keyId })}.${part({ iss: config.apple.team, iat: now, exp: now + 30 * 86400 })}`;
  const signature = sign("sha256", Buffer.from(unsigned), { key, dsaEncoding: "ieee-p1363" }).toString("base64url");
  developer = { token: `${unsigned}.${signature}`, until: Date.now() + 86400_000 };
  return developer.token;
}

/** The Music User Token MusicKit gave the page: Apple says it lasts about six months. */
export function keepAppleUser(username: string, token: string) {
  if (!/^[\w+/=.-]{20,4096}$/.test(token)) throw new MusicProblem("That isn't an Apple Music sign-in.", 400);
  keep(username, "apple", token, null, 180 * 86400);
}

const appleHeaders = (config: MusicConfig, username: string) => {
  const row = musicDb().prepare("SELECT access FROM connections WHERE username = ? AND service = 'apple'").get(user(username)) as { access: string } | undefined;
  if (!row) throw new MusicProblem("Connect Apple Music first.", 401);
  return { authorization: `Bearer ${developerToken(config)}`, "music-user-token": row.access };
};

/* ── Your playlists, and reading one ───────────────────────────────────── */

export const likedId = "liked";

export async function myPlaylists(config: MusicConfig, username: string, service: Service): Promise<Mine[]> {
  const out: Mine[] = [];
  if (service === "spotify") {
    const h = { authorization: `Bearer ${await accessFor(config, username, service)}` };
    const liked = await api("https://api.spotify.com/v1/me/tracks?limit=1", h, service, username);
    out.push({ id: likedId, name: "Liked Songs", count: Number(liked.total) || 0, cover: null });
    let next: string | null = "https://api.spotify.com/v1/me/playlists?limit=50";
    while (next && out.length < 500) {
      const page = await api(next, h, service, username);
      for (const p of (page.items ?? []) as Json[]) {
        if (!p?.id) continue;
        out.push({ id: String(p.id), name: String(p.name ?? ""), count: Number(p.items?.total ?? p.tracks?.total) || null, cover: p.images?.[0]?.url ?? null });
      }
      next = typeof page.next === "string" ? page.next : null;
    }
  } else if (service === "youtube") {
    const h = { authorization: `Bearer ${await accessFor(config, username, service)}` };
    out.push({ id: "LL", name: "Liked videos", count: null, cover: null });
    let token = "";
    do {
      const page = await api(`https://www.googleapis.com/youtube/v3/playlists?part=snippet,contentDetails&mine=true&maxResults=50${token ? `&pageToken=${token}` : ""}`, h, service, username);
      for (const p of (page.items ?? []) as Json[]) out.push({ id: String(p.id), name: String(p.snippet?.title ?? ""), count: Number(p.contentDetails?.itemCount) || 0, cover: p.snippet?.thumbnails?.medium?.url ?? null });
      token = typeof page.nextPageToken === "string" ? page.nextPageToken : "";
    } while (token && out.length < 500);
  } else {
    const h = appleHeaders(config, username);
    let next: string | null = "/v1/me/library/playlists?limit=100";
    while (next && out.length < 500) {
      const page = await api(`https://api.music.apple.com${next}`, h, service, username);
      for (const p of (page.data ?? []) as Json[]) {
        const art = p.attributes?.artwork?.url;
        out.push({ id: String(p.id), name: String(p.attributes?.name ?? ""), count: null, cover: typeof art === "string" ? art.replace("{w}", "300").replace("{h}", "300") : null });
      }
      next = typeof page.next === "string" ? `${page.next}${page.next.includes("limit=") ? "" : "&limit=100"}` : null;
    }
  }
  return out;
}

const isoSeconds = (iso: string) => {
  const m = /^PT(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?$/.exec(iso);
  return m ? Number(m[1] ?? 0) * 3600 + Number(m[2] ?? 0) * 60 + Number(m[3] ?? 0) : 0;
};

/** One of your playlists on the service, as names, for an import. */
export async function readMine(config: MusicConfig, username: string, service: Service, id: string): Promise<Source> {
  if (!/^[\w.-]{1,128}$/.test(id)) throw new MusicProblem("That isn't a playlist.", 400);
  const tracks: Wanted[] = [];
  let name = "", cover: string | null = null;
  if (service === "spotify") {
    const h = { authorization: `Bearer ${await accessFor(config, username, service)}` };
    const songOf = (t: Json): Wanted | null => t?.type === "track" || (t?.name && t?.artists) ? {
      title: String(t.name), artists: ((t.artists ?? []) as Json[]).map((a) => String(a.name ?? "")).filter(Boolean),
      album: t.album?.name ?? null, seconds: Math.round(Number(t.duration_ms) / 1000) || 0, isrc: t.external_ids?.isrc ?? null,
    } : null;
    let next: string | null;
    if (id === likedId) { name = "Liked Songs"; next = "https://api.spotify.com/v1/me/tracks?limit=50"; }
    else {
      const head = await api(`https://api.spotify.com/v1/playlists/${id}?fields=name,images`, h, service, username);
      name = String(head.name ?? ""); cover = head.images?.[0]?.url ?? null;
      next = `https://api.spotify.com/v1/playlists/${id}/items?limit=100`;
    }
    while (next && tracks.length < MAX) {
      let page: Json;
      try { page = await api(next, h, service, username); }
      catch (error) {
        /* Before Spotify named a playlist's songs "items", they were its "tracks". */
        if (error instanceof MusicProblem && error.status === 404 && next.includes("/items")) { next = next.replace("/items", "/tracks"); continue; }
        throw error;
      }
      for (const row of (page.items ?? []) as Json[]) { const w = songOf(row.item ?? row.track); if (w) tracks.push(w); }
      next = typeof page.next === "string" ? page.next : null;
    }
  } else if (service === "youtube") {
    const h = { authorization: `Bearer ${await accessFor(config, username, service)}` };
    if (id === "LL") name = "Liked videos";
    else {
      const head = (await api(`https://www.googleapis.com/youtube/v3/playlists?part=snippet&id=${id}`, h, service, username)).items?.[0];
      name = String(head?.snippet?.title ?? ""); cover = head?.snippet?.thumbnails?.medium?.url ?? null;
    }
    let token = "";
    do {
      const page = await api(`https://www.googleapis.com/youtube/v3/playlistItems?part=snippet,contentDetails&playlistId=${id}&maxResults=50${token ? `&pageToken=${token}` : ""}`, h, service, username);
      const items = ((page.items ?? []) as Json[]).filter((i) => i.snippet?.title && !/^(Private|Deleted) video$/.test(i.snippet.title));
      const ids = items.map((i) => String(i.contentDetails?.videoId ?? "")).filter(Boolean);
      const lengths = new Map<string, number>();
      if (ids.length) {
        const v = await api(`https://www.googleapis.com/youtube/v3/videos?part=contentDetails&id=${ids.join(",")}`, h, service, username);
        for (const x of (v.items ?? []) as Json[]) lengths.set(String(x.id), isoSeconds(String(x.contentDetails?.duration ?? "")));
      }
      for (const i of items) {
        const t = i.snippet.thumbnails ?? {};
        tracks.push(fromYouTube({ id: String(i.contentDetails?.videoId ?? "") || null, title: String(i.snippet.title), artists: [String(i.snippet.videoOwnerChannelTitle ?? "")].filter(Boolean), album: null, seconds: lengths.get(String(i.contentDetails?.videoId)) ?? 0,
          cover: (t.maxres ?? t.standard ?? t.high ?? t.medium ?? t.default)?.url ?? null }));
      }
      token = typeof page.nextPageToken === "string" ? page.nextPageToken : "";
    } while (token && tracks.length < MAX);
  } else {
    const h = appleHeaders(config, username);
    const head = (await api(`https://api.music.apple.com/v1/me/library/playlists/${id}`, h, service, username)).data?.[0]?.attributes ?? {};
    name = String(head.name ?? "");
    const art = head.artwork?.url;
    cover = typeof art === "string" ? art.replace("{w}", "600").replace("{h}", "600") : null;
    let next: string | null = `/v1/me/library/playlists/${id}/tracks?limit=100&include=catalog`;
    while (next && tracks.length < MAX) {
      const page = await api(`https://api.music.apple.com${next}`, h, service, username);
      for (const t of (page.data ?? []) as Json[]) {
        const a = t.attributes;
        if (!a?.name) continue;
        const catalog = t.relationships?.catalog?.data?.[0]?.attributes;
        tracks.push({ title: String(a.name), artists: [String(a.artistName ?? "")].filter(Boolean), album: a.albumName ?? null,
          seconds: Math.round(Number(a.durationInMillis) / 1000) || 0, isrc: typeof catalog?.isrc === "string" ? catalog.isrc : null });
      }
      next = typeof page.next === "string" ? `${page.next}${page.next.includes("include=") ? "" : "&include=catalog"}${page.next.includes("limit=") ? "" : "&limit=100"}` : null;
    }
  }
  return { service, name, cover, tracks, cut: false };
}
