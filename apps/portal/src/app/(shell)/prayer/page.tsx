import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { auth } from "@/auth";
import { AppShell } from "@/components/app-shell";
import { mine } from "@/lib/prayer";
import { prayerConfig, prayerIdentity } from "@/lib/prayer/config";
import { getPlatformSettings } from "@/lib/settings";
import { PrayerEntry, PrayerOff } from "./prayer-entry";
import type { Mine } from "./schedule";
import "./prayer.css";

const inTime = <T,>(work: Promise<T>, ms: number) => Promise.race([work.catch(() => null), new Promise<null>((done) => setTimeout(() => done(null), ms))]);

export const metadata: Metadata = { title: { absolute: "Kimono Prayer" } };

/** Kimono Prayer on the web: today's prayers at your mosque. */
export default async function PrayerPage() {
  const session = await auth();
  if (!session?.user) redirect("/login");
  const settings = await getPlatformSettings();
  const admin = session.user.role === "owner" || session.user.role === "admin";
  const config = prayerConfig(settings);
  if (!config.enabled && admin) redirect("/admin/apps/kimono-prayer");
  const [app, arrived] = await Promise.all([prayerIdentity(settings), config.enabled ? inTime(mine(config, session.user.username), 2500) : null]);
  return <AppShell user={session.user} brandColors={settings.brand.colors} app={app}>
    {config.enabled ? <PrayerEntry app={app} mine={arrived as Mine | null} canSearch={Boolean(config.mawaqit)} /> : <PrayerOff />}
  </AppShell>;
}
