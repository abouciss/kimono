import "server-only";

import {
  calculatePrayerTimes, calculationMethodName, defaultCalculationSettings, prayerDay,
  type PrayerTimesLike,
} from "@mawaqit/sdk/prayer-times";
import { pad, PrayerProblem, validTime, type Place, type PrayerDayTimes } from "./model";

/*
 * Where prayer times come from:
 *
 * - Mawaqit, from a mosque's public page, which carries its whole year:
 *   the API behind Mawaqit's own apps is theirs alone.
 * - MasjidBox, through the API behind its own widget (a week at a time).
 * - Calculated from a position, on this server, with Mawaqit's methods.
 */

const DAY = 24 * 60 * 60 * 1000;
const agent = "Mozilla/5.0 (compatible; KimonoPrayer/1.0)";
/* The key MasjidBox's own public widget sends: not a secret. */
const masjidboxKey = "JejYcMS7hsOsZTPDk2ZhKOAlW9IyQ6Px";

/** What a source keeps about a place, beyond what everyone sees. */
export type PlaceRecord = Place & { uuid?: string | null; slug?: string | null; latitude?: number; longitude?: number; timezone?: string };
export type Fetched = { timezone: string; days: PrayerDayTimes[]; name?: string; detail?: string | null };

/* ---------- days, from a year's calendar ---------- */

/** The ISO date `offset` days from today in `timezone`. */
export function isoDay(timezone: string, offset = 0, now = Date.now()) {
  return new Intl.DateTimeFormat("en-CA", { timeZone: timezone, year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date(now + offset * DAY));
}

/** Yesterday to `ahead` days from now, read from a Mawaqit-shaped calendar (the API's, a page's, or a calculated one). */
export function daysFrom(data: PrayerTimesLike, ahead: number): PrayerDayTimes[] {
  const days: PrayerDayTimes[] = [];
  for (let offset = -1; offset <= ahead; offset++) {
    const date = isoDay(data.timezone, offset);
    let day: ReturnType<typeof prayerDay>;
    try { day = prayerDay(data, date); } catch { continue; }
    if (!day) continue;
    const list = [day.fajr, day.shuruq, day.dhuhr, day.asr, day.maghrib, day.isha];
    if (list.some((p) => !p || !validTime(p.time))) continue;
    const times = list.map((p) => pad(p!.time)) as PrayerDayTimes["times"];
    const congregations = [day.fajr, day.dhuhr, day.asr, day.maghrib, day.isha].map((p) => p?.iqama?.time && validTime(p.iqama.time) ? pad(p.iqama.time) : null);
    /* A mosque may set its iqama as minutes after the adhan ("+10"): kept, so it can be shown that way. */
    const [, month, dayOfMonth] = date.split("-").map(Number);
    const raw = (data.iqamaCalendar as unknown as Record<string, unknown>[] | null | undefined)?.[month - 1]?.[String(dayOfMonth)];
    const after = congregations.map((time, i) => {
      const value = Array.isArray(raw) ? raw[i] : null;
      const minutes = typeof value === "string" ? /^\+\s*(\d{1,3})$/.exec(value.trim()) : null;
      return time && minutes ? Number(minutes[1]) : null;
    });
    days.push({
      date, times,
      iqama: congregations.some(Boolean) ? congregations as PrayerDayTimes["iqama"] : null,
      ...(after.some((m) => m !== null) ? { iqamaAfter: after as PrayerDayTimes["iqamaAfter"] } : {}),
      jumua: day.jumua.map((p) => p.time).filter(validTime).map(pad),
    });
  }
  return days;
}

/* ---------- Mawaqit ---------- */

/** A mosque's calendar from its public page (`confData`), for a pasted link or when there's no account. */
async function mawaqitPage(slug: string) {
  const response = await fetch(`https://mawaqit.net/en/m/${encodeURIComponent(slug)}`, { headers: { "User-Agent": agent }, signal: AbortSignal.timeout(20_000) });
  if (response.status === 404) throw new PrayerProblem(404, "Mawaqit has no mosque at that address.");
  if (!response.ok) throw new PrayerProblem(502, "Mawaqit didn't answer. Try again in a moment.");
  const html = await response.text();
  const start = /(?:var|let|const)\s+confData\s*=\s*/.exec(html);
  if (!start) throw new PrayerProblem(502, "That mosque's page has no prayer times.");
  let depth = 0, quoted = false, escaped = false, from = -1;
  for (let i = start.index + start[0].length; i < html.length; i++) {
    const c = html[i];
    if (quoted) { if (escaped) escaped = false; else if (c === "\\") escaped = true; else if (c === "\"") quoted = false; continue; }
    if (c === "\"") quoted = true;
    else if (c === "{") { if (from < 0) from = i; depth++; }
    else if (c === "}" && --depth === 0 && from >= 0) {
      const data = JSON.parse(html.slice(from, i + 1)) as PrayerTimesLike & { name?: string; label?: string; localisation?: string };
      if (!Array.isArray(data.calendar) || data.calendar.length !== 12) break;
      return data;
    }
  }
  throw new PrayerProblem(502, "That mosque's prayer calendar couldn't be read.");
}

export async function mawaqitTimes(place: PlaceRecord): Promise<Fetched> {
  if (!place.slug) throw new PrayerProblem(404, "Paste this mosque's Mawaqit link again.");
  const data = await mawaqitPage(place.slug);
  return { timezone: data.timezone, days: daysFrom(data, 60), name: data.name, detail: data.localisation };
}

/** A Mawaqit mosque from its link or slug, read from its page. */
export async function mawaqitFromLink(slug: string): Promise<PlaceRecord> {
  const data = await mawaqitPage(slug) as PrayerTimesLike & { name?: string; label?: string; localisation?: string };
  return { id: `mawaqit:${slug}`, kind: "mawaqit", name: (data.name || slug).trim(), detail: data.localisation?.trim() || null, url: `https://mawaqit.net/en/${slug}`, slug, uuid: null };
}

/* ---------- MasjidBox ---------- */

type BoxDay = { date?: string; fajr?: string; sunrise?: string; dhuhr?: string; asr?: string; maghrib?: string; isha?: string; jumuah?: string[]; iqamah?: Record<string, string | string[]> };
type BoxLanding = { name?: string; address?: string; settings?: { timezone?: string }; timetable?: BoxDay[] };

async function masjidbox(slug: string, begin?: string): Promise<BoxLanding> {
  const query = begin ? `?get=at&days=7&begin=${begin}` : "";
  const response = await fetch(`https://api.masjidbox.com/1.0/masjidbox/landing/athany/${encodeURIComponent(slug)}${query}`, {
    headers: { "User-Agent": "Mozilla/5.0", apikey: masjidboxKey }, signal: AbortSignal.timeout(20_000),
  });
  if (response.status === 404) throw new PrayerProblem(404, "MasjidBox has no masjid at that address.");
  if (!response.ok) throw new PrayerProblem(502, "MasjidBox didn't answer. Try again in a moment.");
  return await response.json() as BoxLanding;
}

export async function masjidboxFromLink(slug: string): Promise<PlaceRecord> {
  const landing = await masjidbox(slug);
  if (!landing.name) throw new PrayerProblem(404, "MasjidBox has no masjid at that address.");
  return { id: `masjidbox:${slug}`, kind: "masjidbox", name: landing.name.trim(), detail: landing.address?.trim() || null, url: `https://masjidbox.com/prayer-times/${slug}`, slug };
}

export async function masjidboxTimes(place: PlaceRecord): Promise<Fetched> {
  const slug = place.slug ?? place.id.slice("masjidbox:".length);
  const first = await masjidbox(slug);
  const timezone = first.settings?.timezone;
  if (!timezone) throw new PrayerProblem(502, "MasjidBox gave no time zone for this masjid.");
  const landing = await masjidbox(slug, isoDay(timezone, -1)).catch(() => first);
  const clock = new Intl.DateTimeFormat("en-GB", { timeZone: timezone, hour: "2-digit", minute: "2-digit", hourCycle: "h23" });
  const local = (iso: unknown) => typeof iso === "string" && !Number.isNaN(Date.parse(iso)) ? clock.format(new Date(iso)) : null;
  const days: PrayerDayTimes[] = [];
  for (const day of landing.timetable ?? []) {
    const times = [day.fajr, day.sunrise, day.dhuhr, day.asr, day.maghrib, day.isha].map(local);
    if (!day.date || times.some((t) => !t)) continue;
    const iq = day.iqamah ?? {};
    const congregations = (["fajr", "dhuhr", "asr", "maghrib", "isha"] as const).map((k) => local(iq[k]));
    days.push({
      date: day.date.slice(0, 10), times: times as PrayerDayTimes["times"],
      iqama: congregations.some(Boolean) ? congregations as PrayerDayTimes["iqama"] : null,
      jumua: (Array.isArray(iq.jumuah) ? iq.jumuah : day.jumuah ?? []).map(local).filter((t): t is string => Boolean(t)),
    });
  }
  if (!days.length) throw new PrayerProblem(502, "MasjidBox has no prayer times for this masjid.");
  return { timezone, days, name: landing.name, detail: landing.address };
}

/* ---------- calculated ---------- */

export function calculatedPlace(latitude: number, longitude: number, timezone: string, name?: string): PlaceRecord {
  const lat = Math.round(latitude * 1e4) / 1e4, lon = Math.round(longitude * 1e4) / 1e4;
  const settings = defaultCalculationSettings(null);
  return {
    id: `calc:${lat},${lon}@${timezone}`, kind: "calculated", name: name?.trim() || `${lat.toFixed(2)}, ${lon.toFixed(2)}`,
    detail: calculationMethodName(settings.method, "en"), url: null, latitude: lat, longitude: lon, timezone,
  };
}

export function parseCalculatedId(id: string): PlaceRecord | null {
  const match = /^calc:(-?\d+(?:\.\d+)?),(-?\d+(?:\.\d+)?)@([A-Za-z_]+(?:\/[A-Za-z0-9_+-]+)*)$/.exec(id);
  if (!match) return null;
  const [lat, lon] = [Number(match[1]), Number(match[2])];
  if (Math.abs(lat) > 90 || Math.abs(lon) > 180 || !validZone(match[3])) return null;
  return calculatedPlace(lat, lon, match[3]);
}

export function validZone(zone: string) {
  try { new Intl.DateTimeFormat("en", { timeZone: zone }); return true; } catch { return false; }
}

export function calculatedTimes(place: PlaceRecord): Fetched {
  const timezone = place.timezone!;
  const data = calculatePrayerTimes({ latitude: place.latitude!, longitude: place.longitude!, timeZone: timezone }, defaultCalculationSettings(null));
  /* A calculated year is the year it's made for: on New Year's Eve, the next one carries on. */
  const next = calculatePrayerTimes({ latitude: place.latitude!, longitude: place.longitude!, timeZone: timezone }, defaultCalculationSettings(null), { year: Number(isoDay(timezone).slice(0, 4)) + 1 });
  const days = daysFrom(data, 60);
  const seen = new Set(days.map((d) => d.date));
  const later = daysFrom(next, 60).filter((d) => !seen.has(d.date));
  return { timezone, days: [...days, ...later].sort((a, b) => a.date.localeCompare(b.date)) };
}

/* ---------- links ---------- */

/** A pasted Mawaqit or MasjidBox address, as a place to look up. */
export function linkOf(text: string): { kind: "mawaqit" | "masjidbox"; slug: string } | null {
  const value = text.trim();
  const box = /^(?:https?:\/\/)?(?:www\.)?masjidbox\.com\/(?:prayer-times|widget\/[^/]+)\/([a-z0-9_-]+)/i.exec(value);
  if (box) return { kind: "masjidbox", slug: box[1] };
  const mawaqit = /^(?:https?:\/\/)?(?:www\.)?mawaqit\.net\/(?:[a-z]{2}\/)?(?:m\/|w\/)?([a-z0-9_-]+)\/?(?:[?#].*)?$/i.exec(value);
  if (mawaqit) return { kind: "mawaqit", slug: mawaqit[1] };
  return null;
}
