"use client";

import { useSyncExternalStore } from "react";
import type { AppIdentity } from "@kimono/ui";
import { PrayerApp } from "./prayer-app";
import type { Mine } from "./schedule";

/* The day is read in the browser's clock, so Prayer draws in the browser only. */
const never = () => () => {};
export function PrayerEntry(props: { app: AppIdentity; mine: Mine | null; canSearch: boolean }) {
  const here = useSyncExternalStore(never, () => true, () => false);
  if (!here) return <div className="kp" aria-busy="true" />;
  return <PrayerApp {...props} />;
}

export function PrayerOff() {
  return <div className="kp"><div className="kp-empty"><p>Prayer isn&apos;t switched on.</p></div></div>;
}
