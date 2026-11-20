import "server-only";

import { randomBytes } from "node:crypto";
import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { apiError } from "../api-v1";
import { getPlatformSettings } from "../settings";
import { stateDir } from "../state";
import { prayerConfig, type PrayerConfig } from "./config";
import { PrayerProblem, type Place, type Timetable } from "./model";
import {
  calculatedAt, calculatedPlace, calculatedTimes, distance, findMosques, isoDay, linkOf, masjidboxFromLink, masjidboxTimes, mawaqitFromLink,
  mawaqitMatch, mawaqitTimes, parseCalculatedId, validZone, type Fetched, type PlaceRecord,
} from "./sources";

export * from "./model";

/*
 * 礼 Kimono Times, server side. Everyone picks a place (a Mawaqit mosque, a
 * MasjidBox masjid, or times calculated for where they are), kept here so the
 * website, the phone, its widgets and the menu bar app all show the same one.
 * A place's timetable is fetched when someone needs it and kept: half a day
 * for MasjidBox, which only gives a week, a day for the rest. When a source is
 * down, the last timetable is served.
 */

const root = join(stateDir, "prayer");
const g = globalThis as unknown as { kimonoPrayer?: DatabaseSync };
const HOUR = 60 * 60 * 1000;

/* The schema, brought up to date whenever new code meets an open database (a hot reload keeps the connection). */
let migrated: DatabaseSync | null = null;
function db() {
  if (!g.kimonoPrayer) {
    mkdirSync(root, { recursive: true });
    g.kimonoPrayer = new DatabaseSync(join(root, "prayer.db"));
  }
  const database = g.kimonoPrayer;
  if (migrated === database) return database;
  database.exec(`
PRAGMA journal_mode = WAL;
CREATE TABLE IF NOT EXISTS places (id TEXT PRIMARY KEY, data TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS timetables (id TEXT PRIMARY KEY, data TEXT NOT NULL, fetched_at INTEGER NOT NULL);
CREATE TABLE IF NOT EXISTS choices (username TEXT NOT NULL, place TEXT NOT NULL, chosen_at INTEGER NOT NULL, PRIMARY KEY (username, place));
CREATE INDEX IF NOT EXISTS choices_recent ON choices (username, chosen_at DESC);
CREATE TABLE IF NOT EXISTS guesses (slug TEXT PRIMARY KEY, found INTEGER NOT NULL, checked_at INTEGER NOT NULL);
CREATE TABLE IF NOT EXISTS links (token TEXT PRIMARY KEY, username TEXT NOT NULL UNIQUE, created_at INTEGER NOT NULL);
`);
  migrated = database;
  return database;
}

const publicPlace = ({ id, kind, name, detail, url }: PlaceRecord): Place => ({ id, kind, name, detail, url });

function rememberPlace(place: PlaceRecord) {
  db().prepare("INSERT INTO places (id, data) VALUES (?, ?) ON CONFLICT (id) DO UPDATE SET data = excluded.data").run(place.id, JSON.stringify(place));
  return place;
}

function knownPlace(id: string): PlaceRecord | null {
  const row = db().prepare("SELECT data FROM places WHERE id = ?").get(id) as { data: string } | undefined;
  return row ? JSON.parse(row.data) as PlaceRecord : parseCalculatedId(id);
}

/* ---------- search ---------- */

export type SearchQuery = { q?: string; lat?: number; lon?: number; tz?: string; near?: { lat: number; lon: number } };

/* Names compared without case or accents: "Mosquée" finds "MOSQUEE". */
const fold = (text: string) => text.normalize("NFD").replace(/\p{M}/gu, "").toLowerCase().replace(/[^\p{L}\p{N}]+/gu, " ").trim();

/* Whether a guessed Mawaqit address was a mosque, remembered for a month. */
const guessed = (slug: string) => {
  const row = db().prepare("SELECT found, checked_at FROM guesses WHERE slug = ?").get(slug) as { found: number; checked_at: number } | undefined;
  return row && Date.now() - row.checked_at < 30 * 24 * HOUR ? row.found === 1 : undefined;
};
const noteGuess = (slug: string, found: boolean) => {
  db().prepare("INSERT INTO guesses (slug, found, checked_at) VALUES (?, ?, ?) ON CONFLICT (slug) DO UPDATE SET found = excluded.found, checked_at = excluded.checked_at").run(slug, found ? 1 : 0, Date.now());
};

/**
 * Mawaqit and MasjidBox keep their own search to their apps, so Times finds
 * mosques from what's open: a mosque's link (its public page); the mosques
 * already added here, by name; any mosque by name from OpenStreetMap, with its
 * Mawaqit times when its page can be found, else times calculated where it
 * stands; and times calculated for where you are.
 */
export async function search(_config: PrayerConfig, query: SearchQuery): Promise<Place[]> {
  const text = query.q?.trim() ?? "";
  const link = linkOf(text);
  if (link) {
    const place = link.kind === "masjidbox" ? await masjidboxFromLink(link.slug) : await mawaqitFromLink(link.slug);
    return [publicPlace(rememberPlace(place))];
  }
  const coords = /^\s*(-?\d+(?:\.\d+)?)\s*,\s*(-?\d+(?:\.\d+)?)\s*$/.exec(text);
  const lat = coords ? Number(coords[1]) : query.lat, lon = coords ? Number(coords[2]) : query.lon;
  const at = typeof lat === "number" && typeof lon === "number" && Number.isFinite(lat) && Number.isFinite(lon) && Math.abs(lat) <= 90 && Math.abs(lon) <= 180;
  if (!at && text.length >= 2) {
    const words = fold(text).split(" ").filter(Boolean);
    const known: PlaceRecord[] = [];
    for (const row of db().prepare("SELECT data FROM places").all() as { data: string }[]) {
      const place = JSON.parse(row.data) as PlaceRecord;
      if (place.kind === "calculated") continue;
      if (words.every((w) => fold(`${place.name} ${place.detail ?? ""}`).includes(w))) known.push(place);
    }
    known.sort((x, y) => x.name.localeCompare(y.name));
    let found: Awaited<ReturnType<typeof findMosques>> = [];
    try { found = await findMosques(text, query.near); } catch (error) { if (!known.length) throw error; }
    /* A mosque already added here, found again in OpenStreetMap, is shown once: as added. */
    const placed = known.filter((k) => typeof k.latitude === "number" && typeof k.longitude === "number");
    found = found.filter((f) => !placed.some((k) => distance(f, { lat: k.latitude!, lon: k.longitude! }) < 0.4));
    /* Each found mosque looks for its Mawaqit page at once, but the whole search waits at most a few seconds. */
    const matched = await Promise.all(found.map((f) => Promise.race([
      mawaqitMatch(f, guessed, noteGuess).catch(() => null),
      new Promise<null>((done) => setTimeout(() => done(null), 6000)),
    ])));
    const results = [...known];
    found.forEach((f, i) => { const place = matched[i] ?? calculatedAt(f); if (place) results.push(place); });
    const seen = new Set<string>();
    return results.filter((p) => !seen.has(p.id) && seen.add(p.id)).slice(0, 20).map((place) => publicPlace(rememberPlace(place)));
  }
  const results: PlaceRecord[] = [];
  if (at && query.tz && validZone(query.tz)) results.push(calculatedPlace(lat!, lon!, query.tz, coords ? undefined : "Where you are"));
  return results.map((place) => publicPlace(rememberPlace(place)));
}

/* ---------- timetables ---------- */

const keepFor = (place: Place) => place.kind === "masjidbox" ? 12 * HOUR : 24 * HOUR;
const inFlight = new Map<string, Promise<Timetable>>();

async function fetchTimes(config: PrayerConfig, place: PlaceRecord): Promise<Fetched> {
  if (place.kind === "calculated") return calculatedTimes(place);
  if (place.kind === "masjidbox") return masjidboxTimes(place);
  return mawaqitTimes(place);
}

/** A place's timetable, from yesterday onwards: kept, refreshed when old, and the old one when the source is down. */
export async function timetable(config: PrayerConfig, id: string): Promise<Timetable> {
  const place = knownPlace(id);
  if (!place) throw new PrayerProblem(404, "Find that place again: Kimono doesn't know it.");
  const row = db().prepare("SELECT data, fetched_at FROM timetables WHERE id = ?").get(id) as { data: string; fetched_at: number } | undefined;
  const kept = row ? JSON.parse(row.data) as Timetable : null;
  const today = kept ? isoDay(kept.timezone) : "";
  /* Fresh enough, and it still reaches past tomorrow. */
  /* Kept in this shape since iqama minutes came along (v 2); older ones are fetched again. */
  if (kept && kept.v === 2 && Date.now() - row!.fetched_at < keepFor(place) && kept.days.filter((d) => d.date > today).length >= 2) return trim(kept);
  let pending = inFlight.get(id);
  if (!pending) {
    pending = (async () => {
      const fetched = await fetchTimes(config, place);
      const named: PlaceRecord = { ...place, name: place.kind === "calculated" ? place.name : fetched.name?.trim() || place.name, detail: place.kind === "calculated" ? place.detail : fetched.detail?.trim() || place.detail };
      if (named.name !== place.name || named.detail !== place.detail) rememberPlace(named);
      const table: Timetable = { place: publicPlace(named), timezone: fetched.timezone, days: fetched.days, fetchedAt: Date.now(), v: 2 };
      db().prepare("INSERT INTO timetables (id, data, fetched_at) VALUES (?, ?, ?) ON CONFLICT (id) DO UPDATE SET data = excluded.data, fetched_at = excluded.fetched_at").run(id, JSON.stringify(table), table.fetchedAt);
      return table;
    })().finally(() => inFlight.delete(id));
    inFlight.set(id, pending);
  }
  try {
    return trim(await pending);
  } catch (error) {
    if (kept) { console.warn("prayer: serving the last timetable for", id, (error as Error).message); return trim(kept); }
    throw error;
  }
}

/* Days before yesterday are no use to anyone. */
function trim(table: Timetable): Timetable {
  const yesterday = isoDay(table.timezone, -1);
  return { ...table, days: table.days.filter((d) => d.date >= yesterday) };
}

/* ---------- someone's place ---------- */

export type Mine = { place: Place | null; timetable: Timetable | null; recent: Place[]; problem?: string };

export async function mine(config: PrayerConfig, username: string): Promise<Mine> {
  const rows = db().prepare("SELECT place FROM choices WHERE username = ? ORDER BY chosen_at DESC LIMIT 6").all(username.toLowerCase()) as { place: string }[];
  const recent = rows.map((r) => knownPlace(r.place)).filter((p): p is PlaceRecord => Boolean(p)).map(publicPlace);
  const place = recent[0] ?? null;
  if (!place) return { place: null, timetable: null, recent };
  try {
    return { place, timetable: await timetable(config, place.id), recent };
  } catch (error) {
    return { place, timetable: null, recent, problem: error instanceof PrayerProblem ? error.message : "The prayer times couldn't be reached. Try again in a moment." };
  }
}

export async function choose(config: PrayerConfig, username: string, id: string): Promise<Mine> {
  const place = knownPlace(id);
  if (!place) throw new PrayerProblem(404, "Find that place again: Kimono doesn't know it.");
  await timetable(config, id);
  db().prepare("INSERT INTO choices (username, place, chosen_at) VALUES (?, ?, ?) ON CONFLICT (username, place) DO UPDATE SET chosen_at = excluded.chosen_at").run(username.toLowerCase(), id, Date.now());
  return mine(config, username);
}

export function forget(username: string, id: string) {
  db().prepare("DELETE FROM choices WHERE username = ? AND place = ?").run(username.toLowerCase(), id);
}

/* ---------- links for the menu bar app ---------- */

/*
 * The menu bar app (Mawaqit for Kimono) has no Kimono sign-in: it gets a link
 * of its own, which reads and changes only this person's prayer place. Making
 * a new one stops the old one working.
 */
export function linkToken(username: string, renew = false): string {
  const user = username.toLowerCase();
  const row = db().prepare("SELECT token FROM links WHERE username = ?").get(user) as { token: string } | undefined;
  if (row && !renew) return row.token;
  const token = randomBytes(24).toString("base64url");
  db().prepare("INSERT INTO links (token, username, created_at) VALUES (?, ?, ?) ON CONFLICT (username) DO UPDATE SET token = excluded.token, created_at = excluded.created_at").run(token, user, Date.now());
  return token;
}

export function linkOwner(token: string): string | null {
  if (!/^[A-Za-z0-9_-]{20,64}$/.test(token)) return null;
  const row = db().prepare("SELECT username FROM links WHERE token = ?").get(token) as { username: string } | undefined;
  return row?.username ?? null;
}

/* ---------- the routes' wrapper ---------- */

export async function prayer(work: (config: PrayerConfig) => Promise<Response> | Response): Promise<Response> {
  try {
    const config = prayerConfig(await getPlatformSettings());
    if (!config.enabled) return apiError(404, "Times isn't switched on.");
    return await work(config);
  } catch (error) {
    if (error instanceof PrayerProblem) return apiError(error.status, error.message);
    console.error("prayer:", error);
    return apiError(502, "The prayer times couldn't be reached. Try again in a moment.");
  }
}
