/*
 * 礼 The day's shape, worked out the way the menu bar app (mawaqit-bar) does
 * it, so every Kimono surface agrees: each prayer lasts until the next one,
 * Isha until Islamic midnight (halfway from Maghrib to Fajr), and the night
 * has its midnight, its last third and its sunrise.
 */

export type DayTimes = {
  date: string;
  times: [string, string, string, string, string, string];
  iqama: [string | null, string | null, string | null, string | null, string | null] | null;
  /** Minutes after the adhan, when the mosque sets its iqama that way ("+10"). */
  iqamaAfter?: [number | null, number | null, number | null, number | null, number | null] | null;
  jumua: string[];
};
export type Place = { id: string; kind: "mawaqit" | "masjidbox" | "calculated"; name: string; detail: string | null; url: string | null };
export type Timetable = { place: Place; timezone: string; days: DayTimes[]; fetchedAt: number };
export type Mine = { place: Place | null; timetable: Timetable | null; recent: Place[]; problem?: string };

export const names = ["Fajr", "Sunrise", "Dhuhr", "Asr", "Maghrib", "Isha"] as const;

export type Prayer = {
  name: (typeof names)[number];
  time: string;
  start: number;
  end: number | null;
  sunrise: boolean;
  iqama: string | null;
  /** When the iqama is, as an instant (a day later if it's past midnight). */
  iqamaAt: number | null;
  /** The iqama as the mosque set it, minutes after the adhan, when it's set that way. */
  iqamaAfter: number | null;
  /** -1 for yesterday's, 0 for today's. */
  day: number;
  id: string;
};
export type Phase = "midnight" | "lastThird" | "sunrise";
export type View = {
  now: number;
  timezone: string;
  today: Prayer[];
  next: Prayer | null;
  current: Prayer | null;
  night: { start: number; end: number; midnight: number; lastThird: number };
  milestones: { maghrib: number; isha: number; midnight: number; lastThird: number; fajr: number; sunrise: number; active: boolean; phase: Phase | null };
  jumua: string[];
  isFriday: boolean;
};

const MINUTE = 60_000;

/** The instant a wall-clock time on a date happens in a time zone. */
export function instant(date: string, time: string, timezone: string): number {
  const [y, m, d] = date.split("-").map(Number);
  const [hh, mm] = time.split(":").map(Number);
  const guess = Date.UTC(y, m - 1, d, hh, mm);
  const offset = (at: number) => {
    const parts = new Intl.DateTimeFormat("en-US", { timeZone: timezone, hourCycle: "h23", year: "numeric", month: "numeric", day: "numeric", hour: "numeric", minute: "numeric" }).formatToParts(new Date(at));
    const v = (t: string) => Number(parts.find((p) => p.type === t)?.value);
    return Date.UTC(v("year"), v("month") - 1, v("day"), v("hour"), v("minute")) - at;
  };
  const first = guess - offset(guess);
  return guess - offset(first);
}

export function isoDay(timezone: string, at: number, shift = 0): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: timezone, year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date(at + shift * 86_400_000));
}

export function clock(at: number, timezone: string, hour12 = false): string {
  return new Intl.DateTimeFormat(hour12 ? "en-US" : "en-GB", { timeZone: timezone, hour: hour12 ? "numeric" : "2-digit", minute: "2-digit", hourCycle: hour12 ? "h12" : "h23" }).format(new Date(at));
}

function prayersOf(day: DayTimes, offset: number, timezone: string): Prayer[] {
  return names.map((name, i) => {
    const slot = i === 0 ? 0 : i - 1;
    const iq = day.iqama && i !== 1 ? day.iqama[slot] : null;
    const iqamaAfter = iq && day.iqamaAfter ? day.iqamaAfter[slot] ?? null : null;
    const start = instant(day.date, day.times[i], timezone);
    let iqamaAt = iq ? instant(day.date, iq, timezone) : null;
    if (iqamaAt !== null && iqamaAt < start) iqamaAt += 86_400_000;
    return { name, time: day.times[i], start, end: null, sunrise: i === 1, iqama: iq, iqamaAt, iqamaAfter, day: offset, id: `${name}:${day.date}` };
  });
}

/** Today as seen at `now`, or null when the timetable doesn't reach yesterday to tomorrow. */
export function build(table: Timetable, now = Date.now()): View | null {
  const tz = table.timezone;
  const byDate = new Map(table.days.map((d) => [d.date, d]));
  const dates = [-1, 0, 1].map((s) => byDate.get(isoDay(tz, now, s)));
  if (dates.some((d) => !d)) return null;
  const days = dates.map((d, i) => prayersOf(d!, i - 1, tz));
  const nights = [0, 1].map((i) => {
    const start = days[i][4].start, end = days[i + 1][0].start, length = end - start;
    return { start, end, midnight: start + length / 2, lastThird: start + length * 2 / 3 };
  });
  for (const d of [0, 1]) for (let i = 0; i < 6; i++) {
    const p = days[d][i];
    if (p.sunrise) continue;
    p.end = i === 5 ? nights[d].midnight : days[d][i + 1].start;
  }
  const today = days[1];
  const next = [...today, ...days[2]].find((p) => !p.sunrise && p.start > now) ?? null;
  const current = [...days[0], ...days[1]].find((p) => !p.sunrise && p.start <= now && now < (p.end ?? p.start)) ?? null;
  const night = now < today[0].start ? nights[0] : nights[1];
  const cycle = now < today[1].start ? 0 : 1;
  const cycleNight = nights[cycle];
  const sunrise = days[cycle + 1][1].start;
  const active = now >= days[cycle][5].start && now < sunrise;
  const phase: Phase | null = !active ? null : now < cycleNight.midnight ? "midnight" : now < cycleNight.lastThird ? "lastThird" : "sunrise";
  const todayRow = dates[1]!;
  const isFriday = new Intl.DateTimeFormat("en-US", { timeZone: tz, weekday: "short" }).format(new Date(now)) === "Fri";
  return {
    now, timezone: tz, today, next, current, night,
    milestones: { maghrib: cycleNight.start, isha: days[cycle][5].start, midnight: cycleNight.midnight, lastThird: cycleNight.lastThird, fajr: cycleNight.end, sunrise, active, phase },
    jumua: todayRow.jumua, isFriday,
  };
}

/** Minutes rounded up, never less than one: "45min", "1h05min". */
export function remaining(until: number, now: number): string {
  const minutes = Math.max(1, Math.ceil((until - now) / MINUTE));
  return minutes >= 60 ? `${Math.floor(minutes / 60)}h${String(minutes % 60).padStart(2, "0")}min` : `${minutes}min`;
}

export type TitleMode = "next" | "left";

/** The one line that says where the day is: the next event, or with "left", how long the open prayer has. */
export function title(view: View, mode: TitleMode = "next"): string {
  const { milestones: m, now } = view;
  if (mode === "left" && view.current?.end) return `${view.current.name}, ${remaining(view.current.end, now)} left`;
  if (m.active && now < m.midnight) return `Midnight in ${remaining(m.midnight, now)}`;
  if (m.active && now < m.lastThird) return `Last third in ${remaining(m.lastThird, now)}`;
  if (m.active && now < m.fajr) return `Fajr in ${remaining(m.fajr, now)}`;
  if (m.active) return `Sunrise in ${remaining(m.sunrise, now)}`;
  return view.next ? `${view.next.name} in ${remaining(view.next.start, now)}` : "";
}

/** Overnight, the open prayer stands in for today's of the same name rather than adding a row. */
export function rows(view: View): Prayer[] {
  return view.today.filter((p) => !p.sunrise).map((p) => view.current && view.current.name === p.name && !view.today.some((t) => t.id === view.current!.id) ? view.current : p);
}

export function nextSummary(view: View): string {
  if (!view.next || view.today.some((p) => p.id === view.next!.id)) return "";
  return `Next: ${view.next.name} at ${view.next.time} tomorrow`;
}

export type RowState = "current" | "next" | "past" | "later";
export function stateOf(p: Prayer, view: View): RowState {
  if (p.id === view.current?.id) return "current";
  if (p.id === view.next?.id) return "next";
  if ((p.end ?? Infinity) <= view.now) return "past";
  return "later";
}

/** What the row says beside its time; while a prayer has begun and its iqama hasn't, how long until the iqama. */
export function detail(p: Prayer, view: View, iqama = true): string {
  if (p.id === view.next?.id) return `in ${remaining(p.start, view.now)}`;
  if (p.end === null) return "";
  const time = clock(p.end, view.timezone);
  if (p.id === view.current?.id && iqama && p.iqamaAt !== null && p.iqamaAt > view.now) return `Iqama in ${remaining(p.iqamaAt, view.now)}`;
  if (p.id === view.current?.id) return `Ends at ${time}${p.name === "Isha" ? " · Islamic midnight" : ""}`;
  return p.end <= view.now ? `Ended ${time}` : `Ends ${time}`;
}
