/*
 * 礼 Kimono Prayer's shapes, shared by the website, the phone, its widgets and
 * the menu bar app. Times are HH:MM on the wall clock of the place's own time
 * zone; each client works out instants from `timezone`.
 */

export type PlaceKind = "mawaqit" | "masjidbox" | "calculated";

/** A mosque or a position someone can take their prayer times from. */
export type Place = {
  /** `mawaqit:<slug or uuid>`, `masjidbox:<slug>` or `calc:<lat>,<lon>@<time zone>`. */
  id: string;
  kind: PlaceKind;
  name: string;
  /** Where it is, as the source puts it; for calculated times, the method. */
  detail: string | null;
  /** The mosque's own page, to open. */
  url: string | null;
};

/** One day. `times` is Fajr, Sunrise, Dhuhr, Asr, Maghrib, Isha. */
export type PrayerDayTimes = {
  date: string;
  times: [string, string, string, string, string, string];
  /** The congregation (iqama) of Fajr, Dhuhr, Asr, Maghrib and Isha, when the mosque gives them. */
  iqama: [string | null, string | null, string | null, string | null, string | null] | null;
  /** Jumu'a prayers on Fridays. */
  jumua: string[];
};

export type Timetable = {
  place: Place;
  timezone: string;
  /** From yesterday onwards, as far as the source goes (a week for MasjidBox, weeks for the rest). */
  days: PrayerDayTimes[];
  fetchedAt: number;
};

export const prayerNames = ["Fajr", "Sunrise", "Dhuhr", "Asr", "Maghrib", "Isha"] as const;

export class PrayerProblem extends Error {
  constructor(public status: number, message: string) { super(message); }
}

const hhmm = /^([01]?\d|2[0-3]):[0-5]\d$/;
export const validTime = (value: unknown): value is string => typeof value === "string" && hhmm.test(value);
export const pad = (value: string) => value.length === 4 ? `0${value}` : value;
