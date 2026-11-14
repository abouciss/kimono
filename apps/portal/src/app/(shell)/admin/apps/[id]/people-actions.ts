"use server";

import { redirect } from "next/navigation";
import { auth } from "@/auth";
import { portalOrigin } from "@/lib/account";
import { db, grantCredits, grantUsage, setOwnShare, takeBackCredits, takeBackGrant } from "@/lib/code";
import { codeConfig } from "@/lib/code/config";
import { holdMediaBudget } from "@/lib/code/media";
import { getPlatformSettings } from "@/lib/settings";
import { decideScreens, setScreens, watchDb } from "@/lib/watch";

async function requireAdmin() {
  const session = await auth();
  if (!session?.user || (session.user.role !== "owner" && session.user.role !== "admin")) redirect("/");
  return session.user;
}

/** Runs a change for one person and comes back to them on the app's People view, open, saying what happened or what went wrong. */
async function forPerson(form: FormData, work: (username: string, by: string) => Promise<string> | string): Promise<never> {
  const admin = await requireAdmin();
  /* As the directory spells it: Watch and the VPN key people that way; Kimono AI lowercases it itself. */
  const username = String(form.get("username") || "");
  const key = encodeURIComponent(username.toLowerCase());
  const app = form.get("app") === "kimono-watch" ? "kimono-watch" : "kimono-code";
  const back = (outcome: "done" | "error", said: string) => `/admin/apps/${app}?view=people&open=${key}&${outcome}=${encodeURIComponent(said)}#p-${key}`;
  let said: string;
  try { said = await work(username, admin.username || "admin"); }
  catch (error) { redirect(back("error", error instanceof Error ? error.message : "That didn't work.")); }
  redirect(back("done", said));
}

/** Opens or closes someone's Pro Tools to match what they may spend now. */
async function recheckCredits(username: string) {
  const config = codeConfig(await getPlatformSettings());
  await holdMediaBudget(db(), config, username.toLowerCase(), portalOrigin(), Date.now(), 0).catch(() => null);
}

/* More of Kimono AI for someone, on top of their share, until this week or these 5 hours end. */
export async function giveShare(form: FormData) {
  await forPerson(form, (username, by) => {
    const extra = Number(form.get("extra")), window = form.get("window") === "five_hour" ? "five_hour" : "week";
    grantUsage(db(), username, window, extra / 100, by);
    return `Gave ${username} ${extra}% more ${window === "week" ? "this week" : "for these 5 hours"}.`;
  });
}

export async function takeBackShare(form: FormData) {
  await forPerson(form, (username) => {
    takeBackGrant(db(), Number(form.get("grant")));
    return `Took it back from ${username}.`;
  });
}

/* More Pro Tools credits this month; their tools open again at once if they'd run out. Anyone, the owner too. */
export async function giveCredits(form: FormData) {
  await forPerson(form, async (username, by) => {
    const credits = Number(form.get("credits"));
    grantCredits(db(), username, credits / 100, by);
    await recheckCredits(username);
    return `Gave ${username} ${credits.toLocaleString("en")} credits this month.`;
  });
}

export async function takeBackGivenCredits(form: FormData) {
  await forPerson(form, async (username) => {
    takeBackCredits(db(), Number(form.get("grant")));
    await recheckCredits(username);
    return `Took the credits back from ${username}.`;
  });
}

export async function answerScreens(form: FormData) {
  await forPerson(form, (username) => {
    const screens = decideScreens(watchDb(), username, form.get("decision") === "approve");
    return screens ? `${username} can watch on ${screens} screens at once.` : `Declined ${username}'s ask for more screens.`;
  });
}

export async function changeScreens(form: FormData) {
  await forPerson(form, (username) => {
    const n = Number(form.get("screens"));
    setScreens(watchDb(), username, n);
    return `${username} can watch on ${Math.max(2, n)} screens at once.`;
  });
}

/* Someone's own share of a window, in place of everyone's; "default" goes back to everyone's. */
export async function changeShare(form: FormData) {
  await forPerson(form, (username, by) => {
    const window = form.get("window") === "five_hour" ? "five_hour" : "week";
    const raw = String(form.get("share") || "default");
    setOwnShare(db(), username, window, raw === "default" ? null : Number(raw) / 100, by);
    return raw === "default" ? `${username} has everyone's share again.` : `${username}'s share is ${raw}% ${window === "week" ? "of the week" : "of each 5-hour window"}.`;
  });
}
