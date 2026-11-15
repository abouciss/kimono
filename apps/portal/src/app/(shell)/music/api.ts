"use client";

import { useCallback, useEffect, useState } from "react";
import type { Album, Artist, Lyrics, Playlist, RatedKind, Rating, Row, Track } from "@/lib/music/model";
import type { Home, Queue, RatedItem } from "@/lib/music";
import type { FriendListening, Me, Person } from "@/lib/music/social";

export type { Album, Artist, FriendListening, Home, Lyrics, Me, Person, Playlist, Queue, RatedItem, RatedKind, Rating, Row, Track };
export type ArtistPage = { artist: Artist; top: Track[]; albums: Album[]; related: Artist[]; rating: Rating | null };
export type PlaylistPage = { id: string; name: string; updatedAt: string; tracks: Track[]; owner?: Person; mine?: boolean };
export type SongStatus = { stage: "finding" } | { stage: "fetching"; fraction: number } | { stage: "ready" };
export type Genre = { id: number; name: string; picture: string | null };
export type Results = { tracks: Track[]; albums: Album[]; artists: Artist[] };

export class MusicError extends Error {
  constructor(message: string, readonly status: number) { super(message); }
}

async function call<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`/api/v1/music/${path}`, { ...init, headers: { ...(init?.body ? { "content-type": "application/json" } : {}), ...init?.headers } });
  const body = await res.json().catch(() => null) as (T & { error?: string }) | null;
  if (!res.ok) throw new MusicError(body?.error || "Music couldn't load.", res.status);
  return body as T;
}
const send = (method: string, body: unknown): RequestInit => ({ method, body: JSON.stringify(body) });
const q = encodeURIComponent;

export const musicApi = {
  home: () => call<Home>("home"),
  me: () => call<Me>("me"),
  friends: () => call<{ friends: FriendListening[] }>("friends"),
  status: (key: string) => call<SongStatus>(`status?key=${q(key)}`),
  search: (text: string) => call<Results>(`search?q=${q(text)}`),
  album: (key: string) => call<{ album: Album; rating: Rating | null }>(`album?key=${q(key)}`),
  artist: (key: string) => call<ArtistPage>(`artist?key=${q(key)}`),
  genre: (id: number) => call<Results & { genre: Genre }>(`genre?id=${id}`),
  mix: (id: string) => call<{ mix: Row }>(`mix?id=${q(id)}`),
  track: (key: string) => call<{ track: Track; rating: Rating | null }>(`track?key=${q(key)}`),
  lyrics: (key: string) => call<{ lyrics: Lyrics | null }>(`lyrics?key=${q(key)}`),
  radio: (seed: string, skip: string[]) => call<{ tracks: Track[] }>(`radio?seed=${q(seed)}&skip=${q(skip.slice(-200).join(","))}`),
  ready: (keys: string[]) => call<{ ok: true }>("ready", send("POST", { keys })),
  played: (key: string, seconds: number) => call<{ ok: true }>("play", { ...send("POST", { key, seconds }), keepalive: true }),
  rate: (kind: RatedKind, key: string, rating: Rating | null) => call<{ rating: Rating | null }>("rating", send("PUT", { kind, key, rating })),
  ratings: () => call<{ ratings: RatedItem[] }>("ratings"),
  liked: () => call<{ tracks: Track[] }>("liked"),
  history: () => call<{ tracks: (Track & { playedAt: string })[] }>("history"),
  queue: () => call<{ queue: Queue | null }>("queue"),
  saveQueue: (body: { keys: string[]; index: number; position: number; shuffle: boolean; repeat: Queue["repeat"]; source: Queue["source"]; playing: boolean; at: number }) =>
    call<{ queue: Queue }>("queue", { ...send("PUT", body), keepalive: true }),
  playlists: () => call<{ playlists: Playlist[] }>("playlists"),
  playlist: (id: string) => call<{ playlist: PlaylistPage }>(`playlists/${q(id)}`),
  createPlaylist: (name: string, keys: string[] = []) => call<{ playlist: PlaylistPage }>("playlists", send("POST", { name, keys })),
  renamePlaylist: (id: string, name: string) => call<{ playlist: PlaylistPage }>(`playlists/${q(id)}`, send("PATCH", { name })),
  setPlaylist: (id: string, keys: string[]) => call<{ playlist: PlaylistPage }>(`playlists/${q(id)}`, send("PATCH", { keys })),
  addToPlaylist: (id: string, keys: string[]) => call<{ playlist: PlaylistPage }>(`playlists/${q(id)}`, send("PATCH", { add: keys })),
  deletePlaylist: (id: string) => call<{ ok: true }>(`playlists/${q(id)}`, { method: "DELETE" }),
};

/* What a page asked for, kept for the visit: going back to a page draws it at once, then freshens it. */
const kept = new Map<string, unknown>();

export function useMusic<T>(id: string | null, load: () => Promise<T>) {
  const [data, setData] = useState<T | null>(() => (id ? (kept.get(id) as T | undefined) ?? null : null));
  const [error, setError] = useState<string | null>(null);
  const [tick, setTick] = useState(0);
  /* Another thing asked for: what's kept of it shows at once (set while drawing, as React has it). */
  const [shownId, setShownId] = useState(id);
  if (shownId !== id) { setShownId(id); setData(id ? (kept.get(id) as T | undefined) ?? null : null); setError(null); }
  useEffect(() => {
    if (!id) return;
    let live = true;
    const known = kept.get(id) as T | undefined;
    load().then((value) => { if (!live) return; kept.set(id, value); setData(value); setError(null); })
      .catch((e: unknown) => { if (live && !known) setError(e instanceof Error ? e.message : "Music couldn't load."); });
    return () => { live = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- `load` is a fresh closure each render; `id` names what it loads
  }, [id, tick]);
  const retry = useCallback(() => setTick((t) => t + 1), []);
  const replace = useCallback((value: T) => { if (id) kept.set(id, value); setData(value); }, [id]);
  return { data, error, retry, replace };
}

export const forget = (prefix: string) => { for (const k of kept.keys()) if (k.startsWith(prefix)) kept.delete(k); };

/* Addresses: Deezer's numbers in the path, so /music/artist/27 is Daft Punk. */
export const idOf = (key: string) => key.replace(/^dz:/, "");
export const hrefOf = {
  artist: (key: string) => `/music/artist/${idOf(key)}`,
  album: (key: string) => `/music/album/${idOf(key)}`,
  playlist: (id: string) => `/music/playlist/${id}`,
  genre: (id: number) => `/music/genre/${id}`,
  mix: (id: string) => `/music/mix?id=${encodeURIComponent(id)}`,
  song: (key: string) => `/music/song/${idOf(key)}`,
};

export function clock(seconds: number) {
  if (!Number.isFinite(seconds) || seconds < 0) seconds = 0;
  const s = Math.floor(seconds % 60), m = Math.floor(seconds / 60) % 60, h = Math.floor(seconds / 3600);
  return h ? `${h}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}` : `${m}:${String(s).padStart(2, "0")}`;
}

export function length(tracks: Track[]) {
  const total = tracks.reduce((n, t) => n + t.duration, 0);
  const h = Math.floor(total / 3600), m = Math.round((total % 3600) / 60);
  return h ? `${h} hr ${m} min` : `${m} min`;
}

/**
 * Sends a Music address: the phone's share sheet where there is one, else the
 * link is copied. Answers what to tell the person, or null if they backed out.
 */
export async function share(path: string, title: string): Promise<string | null> {
  const url = `${location.origin}${path}`;
  if (navigator.share && matchMedia("(pointer: coarse)").matches) {
    try { await navigator.share({ title, url }); return null; } catch { return null; }
  }
  try { await navigator.clipboard.writeText(url); return "Link copied"; } catch { return "That link couldn't be copied"; }
}

/** "3 min ago", "yesterday", "12 Nov": when a friend last listened. */
export function ago(iso: string) {
  const s = (Date.now() - Date.parse(iso)) / 1000;
  if (s < 90) return "just now";
  if (s < 3600) return `${Math.round(s / 60)} min ago`;
  if (s < 86400) return `${Math.round(s / 3600)} hr ago`;
  if (s < 2 * 86400) return "yesterday";
  return new Date(iso).toLocaleDateString(undefined, { day: "numeric", month: "short" });
}

export const byline = (t: Pick<Track, "artists">) => [...new Set(t.artists.map((a) => a.name))].join(", ");
