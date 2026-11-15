import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { Suspense, type ReactNode } from "react";
import { auth } from "@/auth";
import { AppShell } from "@/components/app-shell";
import { appIcons } from "@/lib/app-favicon";
import { musicConfig, musicIdentity } from "@/lib/music/config";
import { getPlatformSettings } from "@/lib/settings";
import { PlayerChrome } from "./bar";
import { MusicProvider } from "./player";
import { TopBar } from "./views";
import "./music.css";

export const metadata: Metadata = { title: { absolute: "Kimono Music" }, icons: appIcons("music") };

/*
 * 音 Kimono Music on the web. The player lives here, in the layout, so it
 * keeps playing as you move between Music's pages; each page is only what's
 * under the bar.
 */
export default async function MusicLayout({ children }: { children: ReactNode }) {
  const session = await auth();
  if (!session?.user) redirect("/login");
  const admin = session.user.role === "owner" || session.user.role === "admin";
  const settings = await getPlatformSettings();
  if (!musicConfig(settings).enabled) {
    if (admin) redirect("/admin/apps/kimono-music");
    return <AppShell user={session.user}><div className="km km-off"><h1 className="km-page-title">Music isn&rsquo;t switched on yet.</h1><p className="km-quiet">Ask whoever runs this Kimono.</p></div></AppShell>;
  }
  const app = await musicIdentity(settings);
  return <AppShell user={session.user}>
    <MusicProvider>
      <div className="km">
        <Suspense><TopBar app={app} /></Suspense>
        {children}
      </div>
      <PlayerChrome />
    </MusicProvider>
  </AppShell>;
}
