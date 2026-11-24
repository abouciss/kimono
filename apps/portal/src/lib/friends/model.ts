/**
 * 友 Friends, profiles and recommendations: Kimono's, not one app's.
 *
 * Friendship: anyone can ask anyone; once the other says yes they're friends.
 * Asking someone who already asked you makes you friends. No (or taking an
 * ask back, or unfriending) forgets the link.
 *
 * A profile is private until you're friends: anyone else sees a name and a
 * portrait, enough to ask. Friends see the bio, what someone recommends, and
 * each app's activity (Watch: watched, loved, liked, My list; Books: reading,
 * read, want to read), worked out from that app's own data. Anyone can keep an
 * app's activity off their profile, or just some of its rows (their Watchlist,
 * what they loved), or their friends list; or go invisible, when friends see
 * only their name and portrait and no app shows them what they're doing.
 *
 * A recommendation is one title from one app (`app` + `itemId`, with a small
 * snapshot of its name and cover so it shows without that app), sent to a
 * friend or put on your own profile, with a note if you like.
 *
 * Pure logic over SQLite, tested in scripts/test-friends.mjs; ./index.ts serves it.
 */
import type { DatabaseSync } from "node:sqlite";
import { bannerPath } from "../banner-jpeg";

export function migrateSocial(db: DatabaseSync) {
  db.exec(`CREATE TABLE IF NOT EXISTS friends (a TEXT NOT NULL, b TEXT NOT NULL, asked_by TEXT NOT NULL, state TEXT NOT NULL, at INTEGER NOT NULL, PRIMARY KEY (a, b));
    CREATE INDEX IF NOT EXISTS friends_b ON friends (b);
    CREATE TABLE IF NOT EXISTS profiles (username TEXT PRIMARY KEY, bio TEXT NOT NULL DEFAULT '', updated_at INTEGER NOT NULL);
    CREATE TABLE IF NOT EXISTS recommendations (id TEXT PRIMARY KEY, from_user TEXT NOT NULL, to_user TEXT, app TEXT NOT NULL, item_id TEXT NOT NULL, title TEXT NOT NULL, subtitle TEXT, cover TEXT, note TEXT, at INTEGER NOT NULL, seen_at INTEGER, dismissed_at INTEGER);
    CREATE INDEX IF NOT EXISTS recommendations_to ON recommendations (to_user);
    CREATE INDEX IF NOT EXISTS recommendations_from ON recommendations (from_user);
    CREATE TABLE IF NOT EXISTS meta (key TEXT PRIMARY KEY, value TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS profile_off (username TEXT NOT NULL, row TEXT NOT NULL, item_id TEXT NOT NULL, at INTEGER NOT NULL, PRIMARY KEY (username, row, item_id));`);
  /* Loved and Liked were rows of their own; a rating is now a mark on the title where it already is. What was taken off them stays off. */
  db.exec(`UPDATE OR IGNORE profile_off SET row = 'books:read' WHERE row IN ('books:loved', 'books:liked');
    UPDATE OR IGNORE profile_off SET row = 'watch:watched' WHERE row IN ('watch:loved', 'watch:liked');
    DELETE FROM profile_off WHERE row IN ('books:loved', 'books:liked', 'watch:loved', 'watch:liked');`);
  const columns = (db.prepare("PRAGMA table_info(profiles)").all() as { name: string }[]).map((c) => c.name);
  /* Apps whose activity someone keeps off their profile, comma-separated. */
  if (!columns.includes("hidden")) db.exec("ALTER TABLE profiles ADD COLUMN hidden TEXT NOT NULL DEFAULT ''");
  /* Rows of a profile someone keeps to themselves ("watch:listed", "friends"), comma-separated; and whether they've gone invisible. */
  if (!columns.includes("kept")) db.exec("ALTER TABLE profiles ADD COLUMN kept TEXT NOT NULL DEFAULT ''");
  if (!columns.includes("invisible")) db.exec("ALTER TABLE profiles ADD COLUMN invisible INTEGER NOT NULL DEFAULT 0");
  /* What makes a profile someone's own: pronouns, a colour, and their links (JSON). */
  if (!columns.includes("pronouns")) db.exec("ALTER TABLE profiles ADD COLUMN pronouns TEXT NOT NULL DEFAULT ''");
  if (!columns.includes("color")) db.exec("ALTER TABLE profiles ADD COLUMN color TEXT NOT NULL DEFAULT ''");
  if (!columns.includes("links")) db.exec("ALTER TABLE profiles ADD COLUMN links TEXT NOT NULL DEFAULT '[]'");
  /* A banner photo across the top of the profile: its file in lib/banners (empty for the colour alone). */
  if (!columns.includes("banner")) db.exec("ALTER TABLE profiles ADD COLUMN banner TEXT NOT NULL DEFAULT ''");
  /* A profile's home screen: its widgets, in order, each with a size (JSON; empty means the default set). */
  if (!columns.includes("widgets")) db.exec("ALTER TABLE profiles ADD COLUMN widgets TEXT");
  /* Public: anyone with the address sees the profile as a friend would. */
  if (!columns.includes("public")) db.exec("ALTER TABLE profiles ADD COLUMN public INTEGER NOT NULL DEFAULT 0");
  /* Apps whose sharing someone has chosen (comma-separated); until then, everything in that app stays theirs. */
  if (!columns.includes("decided")) db.exec("ALTER TABLE profiles ADD COLUMN decided TEXT NOT NULL DEFAULT ''");
  /* On a public profile, what only friends see (comma-separated apps, rows "watch:listed", or "friends"); the rest anyone with the link sees. */
  if (!columns.includes("friends_only")) db.exec("ALTER TABLE profiles ADD COLUMN friends_only TEXT NOT NULL DEFAULT ''");
  /* What a title taken off a profile is called, so it can be put back from a list. */
  const off = (db.prepare("PRAGMA table_info(profile_off)").all() as { name: string }[]).map((c) => c.name);
  for (const c of ["title", "subtitle", "cover"]) if (!off.includes(c)) db.exec(`ALTER TABLE profile_off ADD COLUMN ${c} TEXT`);
}

/* ───── Off your profile ───── */

/**
 * A title someone took off one row of their profile ("books:reading"). Only the profile forgets it: the app keeps
 * their progress, rating or list as it was. It stays off until they put it back (offProfileList, putBackOnProfile).
 * [item]'s name and cover are kept so that list can show it.
 */
export function takeOffProfile(db: DatabaseSync, username: string, row: string, itemId: string, item: { title?: unknown; subtitle?: unknown; cover?: unknown } = {}, at = Date.now()) {
  db.prepare(`INSERT INTO profile_off (username, row, item_id, at, title, subtitle, cover) VALUES (?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT (username, row, item_id) DO UPDATE SET at = excluded.at, title = excluded.title, subtitle = excluded.subtitle, cover = excluded.cover`)
    .run(username.toLowerCase(), row, itemId, at, text(item.title, 200) || null, text(item.subtitle, 200) || null, coverOf(item.cover));
}

/** Puts a title back on one row of someone's profile. */
export function putBackOnProfile(db: DatabaseSync, username: string, row: string, itemId: string) {
  db.prepare("DELETE FROM profile_off WHERE username = ? AND row = ? AND item_id = ?").run(username.toLowerCase(), row, itemId);
}

/** What someone has taken off their profile, as `row|itemId`. */
export function offProfileOf(db: DatabaseSync, username: string): Set<string> {
  const rows = db.prepare("SELECT row, item_id FROM profile_off WHERE username = ?").all(username.toLowerCase()) as { row: string; item_id: string }[];
  return new Set(rows.map((r) => `${r.row}|${r.item_id}`));
}

/** Whether a title is kept off a row of a profile. */
export const isOffProfile = (off: Set<string>, row: string, itemId: string) => off.has(`${row}|${itemId}`);

/** What someone took off their profile, latest first, each with the row it came off, to put back. */
export function offProfileList(db: DatabaseSync, username: string) {
  const rows = db.prepare("SELECT row, item_id, at, title, subtitle, cover FROM profile_off WHERE username = ? ORDER BY at DESC")
    .all(username.toLowerCase()) as { row: string; item_id: string; at: number; title: string | null; subtitle: string | null; cover: string | null }[];
  return rows.flatMap((r) => {
    const [app, kind] = r.row.split(":");
    const rowTitle = rowsOf[app]?.find(([k]) => k === kind)?.[1];
    if (!rowTitle) return [];
    return [{ app, appName: apps[app]?.name ?? app, kind, rowTitle, itemId: r.item_id, title: r.title ?? "Untitled", named: r.title !== null, subtitle: r.subtitle ?? null, cover: r.cover ?? null, at: Number(r.at) }];
  });
}
export type OffProfile = ReturnType<typeof offProfileList>[number];

export class FriendsProblem extends Error {
  constructor(message: string, readonly status = 400) { super(message); }
}

/* ───── Friendship ───── */

const pair = (x: string, y: string): [string, string] => { const a = x.toLowerCase(), b = y.toLowerCase(); return a < b ? [a, b] : [b, a]; };

/** "friends"; "asked": they asked you; "asking": you asked them. */
export type LinkState = "friends" | "asked" | "asking";
export type Link = { username: string; state: LinkState; at: number };

type Row = { a: string; b: string; asked_by: string; state: string; at: number };

export function linksOf(db: DatabaseSync, me: string): Link[] {
  const u = me.toLowerCase();
  const rows = db.prepare("SELECT * FROM friends WHERE a = ? OR b = ? ORDER BY at DESC").all(u, u) as Row[];
  return rows.map((r) => {
    const other = r.a === u ? r.b : r.a;
    const state: LinkState = r.state === "friends" ? "friends" : r.asked_by === u ? "asking" : "asked";
    return { username: other, state, at: Number(r.at) };
  });
}

export function linkOf(db: DatabaseSync, me: string, them: string): LinkState | null {
  const [a, b] = pair(me, them);
  const r = db.prepare("SELECT * FROM friends WHERE a = ? AND b = ?").get(a, b) as Row | undefined;
  if (!r) return null;
  return r.state === "friends" ? "friends" : r.asked_by === me.toLowerCase() ? "asking" : "asked";
}

export const areFriends = (db: DatabaseSync, x: string, y: string) => linkOf(db, x, y) === "friends";
export const friendsOf = (db: DatabaseSync, me: string) => linksOf(db, me).filter((l) => l.state === "friends").map((l) => l.username);

/** Asks to be friends; when they already asked, it's a yes. Answers what it is now. */
export function askFriend(db: DatabaseSync, me: string, them: string, now = Date.now()): LinkState {
  const u = me.toLowerCase(), t = them.toLowerCase();
  if (!t || u === t) throw new Error("self");
  const state = linkOf(db, u, t);
  if (state === "friends" || state === "asking") return state;
  const [a, b] = pair(u, t);
  if (state === "asked") { db.prepare("UPDATE friends SET state = 'friends', at = ? WHERE a = ? AND b = ?").run(now, a, b); return "friends"; }
  db.prepare("INSERT INTO friends (a, b, asked_by, state, at) VALUES (?, ?, ?, 'asked', ?)").run(a, b, u, now);
  return "asking";
}

/** Says yes or no to someone who asked. No forgets the link. */
export function answerFriend(db: DatabaseSync, me: string, them: string, yes: boolean, now = Date.now()): LinkState | null {
  const state = linkOf(db, me, them);
  if (state !== "asked") return state;
  if (yes) return askFriend(db, me, them, now);
  removeFriend(db, me, them);
  return null;
}

export function removeFriend(db: DatabaseSync, me: string, them: string) {
  const [a, b] = pair(me, them);
  db.prepare("DELETE FROM friends WHERE a = ? AND b = ?").run(a, b);
  /* What they sent each other goes with the friendship. */
  db.prepare("DELETE FROM recommendations WHERE (from_user = ? AND to_user = ?) OR (from_user = ? AND to_user = ?)").run(a, b, b, a);
}

/**
 * Brings in friendships kept somewhere else before (Watch's own table), once:
 * a link already here stays as it is, and nothing is ever dropped.
 */
export function importFriends(db: DatabaseSync, rows: Row[], marker: string): number {
  if (db.prepare("SELECT 1 FROM meta WHERE key = ?").get(marker)) return 0;
  let added = 0;
  const insert = db.prepare("INSERT OR IGNORE INTO friends (a, b, asked_by, state, at) VALUES (?, ?, ?, ?, ?)");
  for (const r of rows) {
    const [a, b] = pair(String(r.a), String(r.b));
    if (!a || a === b) continue;
    added += Number(insert.run(a, b, String(r.asked_by).toLowerCase(), r.state === "friends" ? "friends" : "asked", Number(r.at) || 0).changes);
  }
  db.prepare("INSERT INTO meta (key, value) VALUES (?, ?)").run(marker, String(added));
  return added;
}

/* ───── Profiles ───── */

export const bioLimit = 280;

export function bioOf(db: DatabaseSync, username: string): string {
  return (db.prepare("SELECT bio FROM profiles WHERE username = ?").get(username.toLowerCase()) as { bio?: string } | undefined)?.bio ?? "";
}

export function setBio(db: DatabaseSync, username: string, bio: unknown, now = Date.now()): string {
  if (typeof bio !== "string") throw new FriendsProblem("Write a few words.");
  const clean = bio.replace(/\r\n?/g, "\n").replace(/\n{3,}/g, "\n\n").trim();
  if ([...clean].length > bioLimit) throw new FriendsProblem(`Keep it under ${bioLimit} characters.`);
  db.prepare("INSERT INTO profiles (username, bio, updated_at) VALUES (?, ?, ?) ON CONFLICT (username) DO UPDATE SET bio = excluded.bio, updated_at = excluded.updated_at").run(username.toLowerCase(), clean, now);
  return clean;
}

/* ── A profile of one's own: pronouns, a colour, links ─────────────────── */

/** The colours a profile can wear: Kimono's own pigments, so every profile still sits in the house. */
export const profileColors = ["suo", "plum", "moss", "ai", "kuchiba", "sakura", "sumi"] as const;
export type ProfileColor = (typeof profileColors)[number];
/** Where a link shows: as a mark under the name, as a button in the Links widget, or both. None: both for a social site, the widget for the rest. */
export type LinkShow = "name" | "links" | "both";
export type ProfileLink = { title: string; url: string; icon?: string; show?: LinkShow };
export const linksLimit = 8;

/** Links as typed, checked: a web address (or mail), a short title (the site's name when left out). */
export function linksFrom(raw: unknown): ProfileLink[] {
  if (!Array.isArray(raw)) throw new FriendsProblem("Links come as a list.");
  if (raw.length > linksLimit) throw new FriendsProblem(`Up to ${linksLimit} links.`);
  return raw.map((l) => {
    const r = (l ?? {}) as Record<string, unknown>;
    let url = text(r.url, 400);
    if (!url) throw new FriendsProblem("Each link needs an address.");
    if (!/^[a-z][a-z0-9+.-]*:/i.test(url)) url = url.includes("@") && !url.includes("/") ? `mailto:${url}` : `https://${url}`;
    let parsed: URL;
    try { parsed = new URL(url); } catch { throw new FriendsProblem(`“${url}” isn't a web address.`); }
    if (!["https:", "http:", "mailto:"].includes(parsed.protocol) || (parsed.protocol !== "mailto:" && !parsed.hostname.includes("."))) throw new FriendsProblem(`“${url}” isn't a web address.`);
    const title = text(r.title, 40) || (parsed.protocol === "mailto:" ? "Email" : parsed.hostname.replace(/^www\./, ""));
    /* Its mark: a drawn one by name, or an emoji; none is the site's own icon. */
    const icon = text(r.icon, 24);
    const mark = /^[a-z]{2,12}$/.test(icon) || (/^emoji:\S/u.test(icon) && [...icon.slice(6)].length <= 4) ? icon : "";
    const show = ["name", "links", "both"].includes(r.show as string) ? r.show as LinkShow : null;
    return { title, url: parsed.toString(), ...(mark ? { icon: mark } : {}), ...(show ? { show } : {}) };
  });
}

/* ── A profile's home screen: widgets ──────────────────────────────────── */

export const widgetKinds = [
  "listening", "song", "album", "artists", "playlist", "loved", "onrepeat",
  "reading", "book", "review", "bookshelf", "yearbooks",
  "watching", "show", "watched",
  "stats", "note", "status", "clock", "links", "friends", "countdown", "quote",
] as const;
export type WidgetKind = (typeof widgetKinds)[number];
/** Small (one cell), medium (two wide), large (two by two), extra large (the full row, two high). */
export const widgetSizes = ["s", "m", "l", "xl"] as const;
export type WidgetSize = (typeof widgetSizes)[number];
export type Widget = { id: string; kind: WidgetKind; size: WidgetSize; config?: Record<string, string> };
export const widgetsLimit = 16;

/* A picture's address: on the web over https, or on this Portal (Watch's posters). */
const https = (v: unknown) => { const t = text(v, 600); return /^https:\/\/[^\s]+$/i.test(t) || /^\/[^\s/][^\s]*$/.test(t) ? t : ""; };
const snapshot = (c: Record<string, unknown>, key: string) => ({ key, title: text(c.title, 120), subtitle: text(c.subtitle, 120), cover: https(c.cover) });

/** Widgets as arranged, checked: known kinds and sizes, and only what each kind keeps (a favourite's snapshot, a note's words, a zone). */
export function widgetsFrom(raw: unknown): Widget[] {
  if (!Array.isArray(raw)) throw new FriendsProblem("Widgets come as a list.");
  if (raw.length > widgetsLimit) throw new FriendsProblem(`Up to ${widgetsLimit} widgets.`);
  return raw.map((w, i) => {
    const r = (w ?? {}) as Record<string, unknown>;
    const kind = String(r.kind) as WidgetKind;
    const size = String(r.size) as WidgetSize;
    if (!(widgetKinds as readonly string[]).includes(kind)) throw new FriendsProblem("That isn't a widget.");
    if (!(widgetSizes as readonly string[]).includes(size)) throw new FriendsProblem("That isn't a widget size.");
    const id = /^[A-Za-z0-9_-]{1,24}$/.test(String(r.id ?? "")) ? String(r.id) : `w${i}`;
    const c = (r.config ?? {}) as Record<string, unknown>;
    let config: Record<string, string> | undefined;
    if (kind === "song" || kind === "album") {
      const key = text(c.key, 40);
      if (!/^dz:\d{1,20}$/.test(key)) throw new FriendsProblem("Pick a song or an album for it.");
      config = { key, title: text(c.title, 120), subtitle: text(c.subtitle, 120), cover: https(c.cover) };
    } else if (kind === "book") {
      const key = text(c.key, 100);
      if (!/^[a-z]{2}:[\w:./-]{1,90}$/.test(key)) throw new FriendsProblem("Pick a book for it.");
      config = snapshot(c, key);
    } else if (kind === "show") {
      const key = text(c.key, 100);
      if (!/^[\w:.-]{1,90}$/.test(key)) throw new FriendsProblem("Pick a film or a show for it.");
      config = snapshot(c, key);
    } else if (kind === "playlist") {
      const key = text(c.key, 60);
      if (!/^[\w-]{8,60}$/.test(key)) throw new FriendsProblem("Pick one of your playlists.");
      config = snapshot(c, key);
    } else if (kind === "countdown") {
      const date = text(c.date, 10);
      if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || Number.isNaN(Date.parse(date))) throw new FriendsProblem("Pick a day to count down to.");
      config = { date, label: text(c.label, 40) };
    } else if (kind === "quote") {
      const words = text(c.text, 201);
      if (!words || [...words].length > 200) throw new FriendsProblem("A quote is a few words, under 200 characters.");
      config = { text: words, by: text(c.by, 60) };
    } else if (kind === "yearbooks") {
      const goal = text(c.goal, 3);
      config = { goal: /^\d{1,3}$/.test(goal) ? goal : "" };
    } else if (kind === "note") {
      const words = text(c.text, 161);
      if ([...words].length > 160) throw new FriendsProblem("Keep a note under 160 characters.");
      config = { text: words, tint: (profileColors as readonly string[]).includes(String(c.tint)) ? String(c.tint) : "" };
    } else if (kind === "status") {
      const emoji = text(c.emoji, 16), words = text(c.text, 61);
      if ([...words].length > 60) throw new FriendsProblem("Keep a status under 60 characters.");
      config = { emoji, text: words };
    } else if (kind === "friends") {
      /* Taken off the board: kept as a mark, so Friends aren't put back on their own. */
      if (c.off === "1") config = { off: "1" };
    } else if (kind === "clock") {
      const zone = text(c.zone, 60);
      try { if (zone) new Intl.DateTimeFormat("en", { timeZone: zone }); } catch { throw new FriendsProblem("That isn't a time zone."); }
      config = { zone };
    }
    return config ? { id, kind, size, config } : { id, kind, size };
  });
}

export function widgetsOf(db: DatabaseSync, username: string): Widget[] | null {
  const row = db.prepare("SELECT widgets FROM profiles WHERE username = ?").get(username.toLowerCase()) as { widgets?: string | null } | undefined;
  if (!row?.widgets) return null;
  try { return widgetsFrom(JSON.parse(row.widgets)); } catch { return null; }
}

export type ProfileLook = { pronouns: string; color: ProfileColor | null; links: ProfileLink[]; banner: string | null };

export function lookOf(db: DatabaseSync, username: string): ProfileLook {
  const row = db.prepare("SELECT pronouns, color, links, banner FROM profiles WHERE username = ?").get(username.toLowerCase()) as { pronouns?: string; color?: string; links?: string; banner?: string } | undefined;
  let links: ProfileLink[] = [];
  try { links = JSON.parse(row?.links || "[]") as ProfileLink[]; } catch { /* none */ }
  const color = (profileColors as readonly string[]).includes(row?.color ?? "") ? row!.color as ProfileColor : null;
  return { pronouns: row?.pronouns ?? "", color, links, banner: bannerPath(row?.banner) };
}

/** Puts [file] up as someone's banner (or takes it down, for null) and answers the file it replaced, to be deleted. */
export function setBannerFile(db: DatabaseSync, username: string, file: string | null, now = Date.now()): string | null {
  const u = username.toLowerCase();
  db.prepare("INSERT OR IGNORE INTO profiles (username, bio, updated_at) VALUES (?, '', ?)").run(u, now);
  const was = (db.prepare("SELECT banner FROM profiles WHERE username = ?").get(u) as { banner?: string } | undefined)?.banner || null;
  db.prepare("UPDATE profiles SET banner = ?, updated_at = ? WHERE username = ?").run(file ?? "", now, u);
  return was && was !== file ? was : null;
}

/** Changes what's given: `{ pronouns?, color?, links? }`. Answers the look as it now is. */
export function setLook(db: DatabaseSync, username: string, raw: Record<string, unknown>, now = Date.now()): ProfileLook {
  const u = username.toLowerCase();
  db.prepare("INSERT OR IGNORE INTO profiles (username, bio, updated_at) VALUES (?, '', ?)").run(u, now);
  if ("pronouns" in raw) {
    const pronouns = text(raw.pronouns, 31);
    if ([...pronouns].length > 30) throw new FriendsProblem("Keep pronouns short.");
    db.prepare("UPDATE profiles SET pronouns = ?, updated_at = ? WHERE username = ?").run(pronouns, now, u);
  }
  if ("color" in raw) {
    const color = raw.color === null || raw.color === "" ? "" : String(raw.color);
    if (color && !(profileColors as readonly string[]).includes(color)) throw new FriendsProblem("Pick one of the colours.");
    db.prepare("UPDATE profiles SET color = ?, updated_at = ? WHERE username = ?").run(color, now, u);
  }
  if ("links" in raw) db.prepare("UPDATE profiles SET links = ?, updated_at = ? WHERE username = ?").run(JSON.stringify(linksFrom(raw.links)), now, u);
  if ("widgets" in raw) db.prepare("UPDATE profiles SET widgets = ?, updated_at = ? WHERE username = ?").run(raw.widgets === null ? null : JSON.stringify(widgetsFrom(raw.widgets)), now, u);
  return lookOf(db, u);
}

/** A title from one app, as a profile or a recommendation shows it. */
export type Item = { app: string; itemId: string; title: string; subtitle: string | null; cover: string | null };

/** The apps whose titles can be shared and whose activity shows on a profile. */
export const apps: Record<string, { name: string }> = {
  watch: { name: "Watch" },
  books: { name: "Books" },
  music: { name: "Music" },
};

/** One row of a profile: what someone did in one app (watched, loved, reading…), latest first. */
export type Section = { app: string; appName: string; kind: string; title: string; items: (Item & { href?: string | null; progress?: number | null; at?: number | null; rating?: Rating | null;
  /** Watch, for what's on: its wide still, and where they are (how far into this film or episode; for a series, which episode of how many in its season; the kind of screen it was last put on). */
  wide?: string | null; spot?: { part: number; episode?: number; of?: number; screen?: "phone" | "computer" | "tv"; live?: boolean } | null })[] };
/** How someone rated a title, shown as a mark on its cover rather than a row of its own. */
export type Rating = "love" | "up" | "down";

const text = (value: unknown, max: number) => (typeof value === "string" ? value.trim().slice(0, max) : "");
/** A cover is an address on the web or on this Portal; anything else is left out. */
const coverOf = (value: unknown) => {
  const v = text(value, 1000);
  return /^https?:\/\/[^\s]+$/i.test(v) || /^\/[^\s/][^\s]*$/.test(v) ? v : null;
};

/** What a request says about a title, checked: a known app, an id and a name. */
export function itemOf(raw: Record<string, unknown>): Item {
  const app = text(raw.app, 40).toLowerCase();
  if (!apps[app]) throw new FriendsProblem("That app's titles can't be shared.");
  const itemId = text(raw.itemId, 200);
  const title = text(raw.title, 200);
  if (!itemId || !title) throw new FriendsProblem("Pick something to share.");
  return { app, itemId, title, subtitle: text(raw.subtitle, 200) || null, cover: coverOf(raw.cover) };
}

const itemFrom = (r: { app: string; item_id: string; title: string; subtitle: string | null; cover: string | null }): Item =>
  ({ app: r.app, itemId: r.item_id, title: r.title, subtitle: r.subtitle ?? null, cover: r.cover ?? null });

/** The rows each app puts on a profile, by kind, so any of them can be kept back before it has anything in it. */
export const rowsOf: Record<string, [kind: string, title: string][]> = {
  watch: [["watching", "Watching"], ["watched", "Watched"], ["listed", "Watchlist"], ["rated", "Ratings"]],
  books: [["reading", "Reading now"], ["want", "Want to read"], ["read", "Read"], ["reviews", "Reviews"]],
  music: [["playing", "Listening to"], ["stats", "Top artists and plays"], ["loved", "Loved"], ["playlists", "Playlists"]],
};

/**
 * What each app asks the first time you open it (with a friend to share with): a few plain choices, each
 * one or more rows, and whether it starts on. Until you answer, nothing of that app is shared.
 */
export const sharingAsks: Record<string, { key: string; says: string; rows: string[]; on: boolean }[]> = {
  watch: [
    { key: "watching", says: "What you're watching right now", rows: ["watching"], on: false },
    { key: "watched", says: "Shows and films you've watched", rows: ["watched", "listed"], on: false },
    { key: "rated", says: "How you rated them", rows: ["rated"], on: true },
  ],
  books: [
    { key: "reading", says: "What you're reading right now", rows: ["reading"], on: true },
    { key: "read", says: "What you've read", rows: ["read", "want"], on: true },
    { key: "reviews", says: "Your reviews", rows: ["reviews"], on: true },
  ],
  music: [
    { key: "playing", says: "What you're listening to right now", rows: ["playing"], on: false },
    { key: "stats", says: "Your top artists and how much you listen", rows: ["stats"], on: false },
    { key: "loved", says: "Songs you love", rows: ["loved"], on: false },
  ],
};

type PrivacyRow = { hidden?: string; kept?: string; invisible?: number; public?: number; decided?: string };
const privacyRow = (db: DatabaseSync, username: string) =>
  db.prepare("SELECT hidden, kept, invisible, public, decided FROM profiles WHERE username = ?").get(username.toLowerCase()) as PrivacyRow | undefined;

/** The apps whose sharing someone has chosen. */
export const decidedOf = (db: DatabaseSync, username: string) => (privacyRow(db, username)?.decided ?? "").split(",").filter((a) => rowsOf[a]);

/** Who sees a profile: friends (the default), anyone with its address, or only its owner (friends get a name and portrait). */
export type Visibility = "friends" | "public" | "private";
export function visibilityOf(db: DatabaseSync, username: string): Visibility {
  const row = privacyRow(db, username);
  return Number(row?.invisible ?? 0) === 1 ? "private" : Number(row?.public ?? 0) === 1 ? "public" : "friends";
}
export function setVisibility(db: DatabaseSync, username: string, to: Visibility, now = Date.now()): Visibility {
  if (!["friends", "public", "private"].includes(to)) throw new FriendsProblem("Pick friends, public or private.");
  const u = username.toLowerCase();
  saveProfile(db, u, "invisible", to === "private" ? 1 : 0, now);
  saveProfile(db, u, "public", to === "public" ? 1 : 0, now);
  return to;
}

/** An app's sharing, chosen: the asks that are on are shared, the rest kept; the app counts as decided from now. */
export function decideSharing(db: DatabaseSync, username: string, app: string, on: string[], now = Date.now()) {
  const asks = sharingAsks[app];
  if (!asks) throw new FriendsProblem("That app has nothing to share.");
  const u = username.toLowerCase();
  const row = privacyRow(db, u);
  const explicit = (row?.kept ?? "").split(",").filter((k) => k && !k.startsWith(`${app}:`));
  const keep = asks.filter((a) => !on.includes(a.key)).flatMap((a) => a.rows.map((r) => `${app}:${r}`));
  saveProfile(db, u, "kept", [...new Set([...explicit, ...keep])].sort().join(","), now);
  saveProfile(db, u, "decided", [...new Set([...decidedOf(db, u), app])].sort().join(","), now);
}

/** Whether someone has gone invisible: friends see their name and portrait, and no app shows them what they do. */
export const isInvisible = (db: DatabaseSync, username: string) => Number(privacyRow(db, username)?.invisible ?? 0) === 1;

/** The apps whose activity someone keeps off their profile: every one while they're invisible. */
export function hiddenAppsOf(db: DatabaseSync, username: string): string[] {
  const row = privacyRow(db, username);
  if (Number(row?.invisible ?? 0) === 1) return Object.keys(apps).sort();
  return (row?.hidden ?? "").split(",").filter((a) => apps[a]);
}

/** The app rows ("watch:listed") and parts ("friends") someone keeps to themselves, with their apps still shown. */
export function keptOf(db: DatabaseSync, username: string): string[] {
  const row = privacyRow(db, username);
  const decided = (row?.decided ?? "").split(",");
  /* An app not chosen yet keeps all of its rows. */
  const undecided = Object.keys(rowsOf).filter((a) => !decided.includes(a)).flatMap((a) => rowsOf[a].map(([kind]) => `${a}:${kind}`));
  return [...new Set([...(row?.kept ?? "").split(","), ...undecided])].filter((k) => k === "friends" || (k.includes(":") && rowsOf[k.split(":")[0]]?.some(([kind]) => kind === k.split(":")[1])));
}

/** On a public profile, the apps, rows and parts only friends see: hidden from anyone else with the link. */
export function friendsOnlyOf(db: DatabaseSync, username: string): string[] {
  const row = db.prepare("SELECT friends_only FROM profiles WHERE username = ?").get(username.toLowerCase()) as { friends_only?: string } | undefined;
  return (row?.friends_only ?? "").split(",").filter(Boolean);
}

/** Who [viewer] is to [username]'s profile: them, a friend, or anyone else (signed out, or not friends) at a public address. */
export function audienceOf(db: DatabaseSync, viewer: string, username: string): "you" | "friend" | "stranger" {
  const v = viewer.toLowerCase(), u = username.toLowerCase();
  if (v !== "" && v === u) return "you";
  return v !== "" && areFriends(db, v, u) ? "friend" : "stranger";
}

/**
 * Who sees one app, row ("watch:listed") or your friends list ("friends"): "me", "friends", or "everyone"
 * (anyone with a public profile's link). Answers what's kept and shown as it now is.
 */
export function setAudience(db: DatabaseSync, username: string, key: string, to: "me" | "friends" | "everyone", now = Date.now()) {
  const u = username.toLowerCase();
  if (apps[key]) setAppHidden(db, u, key, to === "me", now);
  else setKept(db, u, key, to === "me", now);
  /* Sharing a whole app shares each of its rows that far (Only me just folds the app away, keeping its rows' choices). */
  const rows = apps[key] && to !== "me" ? (rowsOf[key] ?? []).map(([kind]) => `${key}:${kind}`) : [];
  for (const row of rows) setKept(db, u, row, false, now);
  const touched = [key, ...rows];
  const next = [...new Set([...friendsOnlyOf(db, u).filter((k) => !touched.includes(k)), ...(to === "friends" ? touched : [])])].sort();
  saveProfile(db, u, "friends_only", next.join(","), now);
}

const saveProfile = (db: DatabaseSync, u: string, column: "hidden" | "kept" | "invisible" | "public" | "decided" | "friends_only", value: string | number, now: number) =>
  db.prepare(`INSERT INTO profiles (username, bio, updated_at, ${column}) VALUES (?, '', ?, ?) ON CONFLICT (username) DO UPDATE SET ${column} = excluded.${column}, updated_at = excluded.updated_at`).run(u, now, value);

/** Shows or keeps one app's activity off your profile. Answers the apps kept off as you set them (going invisible doesn't change these). */
export function setAppHidden(db: DatabaseSync, username: string, app: string, hidden: boolean, now = Date.now()): string[] {
  if (!apps[app]) throw new FriendsProblem("That app isn't on profiles.");
  const u = username.toLowerCase();
  const was = (privacyRow(db, u)?.hidden ?? "").split(",").filter((a) => apps[a]);
  const next = [...new Set([...was.filter((a) => a !== app), ...(hidden ? [app] : [])])].sort();
  saveProfile(db, u, "hidden", next.join(","), now);
  return next;
}

/** Shows or keeps one row ("watch:listed") or part ("friends") of your profile from friends. */
export function setKept(db: DatabaseSync, username: string, key: string, kept: boolean, now = Date.now()): string[] {
  const [app, kind] = key.split(":");
  if (key !== "friends" && !rowsOf[app]?.some(([k]) => k === kind)) throw new FriendsProblem("That isn't on profiles.");
  const u = username.toLowerCase();
  const next = [...new Set([...keptOf(db, u).filter((k) => k !== key), ...(kept ? [key] : [])])].sort();
  /* Choosing one row of an app is choosing that app's sharing: what's kept is now written down. */
  const decided = rowsOf[app] && !decidedOf(db, u).includes(app);
  saveProfile(db, u, "kept", next.filter((k) => decidedOf(db, u).includes(k.split(":")[0]) || k.split(":")[0] === app || k === "friends").join(","), now);
  if (decided) saveProfile(db, u, "decided", [...decidedOf(db, u), app].sort().join(","), now);
  return keptOf(db, u);
}

export function setInvisible(db: DatabaseSync, username: string, invisible: boolean, now = Date.now()): boolean {
  saveProfile(db, username.toLowerCase(), "invisible", invisible ? 1 : 0, now);
  return invisible;
}

/** What you let friends see, for your own profile: going invisible, and each app and its rows, and your friends list. */
export function privacyOf(db: DatabaseSync, username: string) {
  const row = privacyRow(db, username);
  const hidden = (row?.hidden ?? "").split(",");
  const kept = keptOf(db, username);
  const only = friendsOnlyOf(db, username);
  /* `everyone`: anyone with a public profile's link sees it too, not just friends. */
  return {
    invisible: Number(row?.invisible ?? 0) === 1,
    visibility: visibilityOf(db, username),
    friends: !kept.includes("friends"),
    friendsEveryone: !kept.includes("friends") && !only.includes("friends"),
    apps: Object.entries(apps).map(([app, { name }]) => ({
      app, name, shown: !hidden.includes(app), everyone: !hidden.includes(app) && !only.includes(app),
      rows: (rowsOf[app] ?? []).map(([kind, title]) => ({ kind, title, shown: !kept.includes(`${app}:${kind}`), everyone: !kept.includes(`${app}:${kind}`) && !only.includes(`${app}:${kind}`) })),
    })),
  };
}
export type Privacy = ReturnType<typeof privacyOf>;

/** Whether [viewer] sees [username]'s whole profile: their own, or a friend's who isn't invisible. */
export const seesProfile = (db: DatabaseSync, viewer: string, username: string) =>
  (viewer !== "" && viewer.toLowerCase() === username.toLowerCase())
  || (visibilityOf(db, username) === "public")
  || (viewer !== "" && areFriends(db, viewer, username) && !isInvisible(db, username));

/**
 * Someone's profile as [viewer] sees it. Not friends (or they're invisible): their name and portrait and how you're linked, nothing more.
 * Friends: the bio, what they recommend, their friends, and each app's activity, less the apps and rows they keep to themselves.
 * Their own: everything, with what's kept back still there and `hidden`, `kept` and `privacy` saying what it is.
 * [sections] is only asked for when it will be shown.
 */
export function profileFor<P extends { username: string }>(db: DatabaseSync, viewer: string, person: P, sections: () => Section[]) {
  const v = viewer.toLowerCase(), u = person.username.toLowerCase();
  const you = v !== "" && v === u;
  const link = you || !v ? null : linkOf(db, v, u);
  /* Signed out, at a public profile's address. */
  const visitor = v === "";
  if (!seesProfile(db, v, u)) return { ...person, you, link, ...(visitor ? { visitor } : {}), open: false as const };
  /* Anyone else at a public address doesn't see what's for friends only. */
  const only = audienceOf(db, v, u) === "stranger" ? friendsOnlyOf(db, u) : [];
  const hidden = [...hiddenAppsOf(db, u), ...only.filter((k) => apps[k])];
  const kept = [...keptOf(db, u), ...only.filter((k) => !apps[k])];
  const friends = friendsOf(db, u);
  return {
    ...person, you, link, ...(visitor ? { visitor } : {}), open: true as const,
    bio: bioOf(db, u),
    ...lookOf(db, u),
    widgets: widgetsOf(db, u),
    sections: sections().filter((s) => you || (!hidden.includes(s.app) && !kept.includes(`${s.app}:${s.kind}`))),
    recommendations: onProfile(db, u),
    friends: friends.length,
    /* Who they're friends with, unless they keep it to themselves; never those who've gone invisible, but to themselves. */
    friendList: you || !kept.includes("friends") ? friends.filter((f) => you || f === v || !isInvisible(db, f)) : null,
    ...(you ? { hidden, kept, privacy: privacyOf(db, u), off: offProfileList(db, u) } : {}),
  };
}

/* ───── Recommendations ───── */

export const noteLimit = 500;

export type Recommendation = Item & { id: string; from: string; to: string | null; note: string | null; at: number; seen: boolean };
type RecRow = { id: string; from_user: string; to_user: string | null; app: string; item_id: string; title: string; subtitle: string | null; cover: string | null; note: string | null; at: number; seen_at: number | null };
const recFrom = (r: RecRow): Recommendation => ({ ...itemFrom(r), id: r.id, from: r.from_user, to: r.to_user, note: r.note ?? null, at: Number(r.at), seen: r.seen_at !== null });

/**
 * Recommends a title to each of [to] (friends only), or puts it on your own profile when [to] is empty.
 * Recommending the same title to the same person again brings it back to the top with the new note.
 */
export function recommend(db: DatabaseSync, from: string, to: string[], raw: Record<string, unknown>, newId: () => string, now = Date.now()): Recommendation[] {
  const u = from.toLowerCase();
  const item = itemOf(raw);
  const note = text(raw.note, noteLimit + 1);
  if ([...note].length > noteLimit) throw new FriendsProblem(`Keep the note under ${noteLimit} characters.`);
  const targets = [...new Set(to.map((t) => t.toLowerCase()).filter(Boolean))];
  if (targets.some((t) => t === u)) throw new FriendsProblem("Pick someone else.");
  if (targets.some((t) => !areFriends(db, u, t))) throw new FriendsProblem("You can only recommend to friends.", 403);
  return (targets.length ? targets : [null]).map((t) => {
    const was = db.prepare("SELECT id FROM recommendations WHERE from_user = ? AND to_user IS ? AND app = ? AND item_id = ?").get(u, t, item.app, item.itemId) as { id: string } | undefined;
    const id = was?.id ?? newId();
    if (was) db.prepare("UPDATE recommendations SET title = ?, subtitle = ?, cover = ?, note = ?, at = ?, seen_at = NULL, dismissed_at = NULL WHERE id = ?").run(item.title, item.subtitle, item.cover, note || null, now, id);
    else db.prepare("INSERT INTO recommendations (id, from_user, to_user, app, item_id, title, subtitle, cover, note, at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)").run(id, u, t, item.app, item.itemId, item.title, item.subtitle, item.cover, note || null, now);
    return recFrom(db.prepare("SELECT * FROM recommendations WHERE id = ?").get(id) as RecRow);
  });
}

/** What friends sent you and you haven't put away, the latest first. Only from people you're still friends with. */
export function receivedBy(db: DatabaseSync, me: string, app?: string): Recommendation[] {
  const u = me.toLowerCase();
  const friends = new Set(friendsOf(db, u));
  const rows = db.prepare(`SELECT * FROM recommendations WHERE to_user = ? AND dismissed_at IS NULL ${app ? "AND app = ?" : ""} ORDER BY at DESC LIMIT 200`).all(...(app ? [u, app] : [u])) as RecRow[];
  return rows.map(recFrom).filter((r) => friends.has(r.from));
}

/** What you sent to friends, the latest first. */
export function sentBy(db: DatabaseSync, me: string): Recommendation[] {
  return (db.prepare("SELECT * FROM recommendations WHERE from_user = ? AND to_user IS NOT NULL ORDER BY at DESC LIMIT 200").all(me.toLowerCase()) as RecRow[]).map(recFrom);
}

/** What someone put on their profile, the latest first. */
export function onProfile(db: DatabaseSync, username: string): Recommendation[] {
  return (db.prepare("SELECT * FROM recommendations WHERE from_user = ? AND to_user IS NULL ORDER BY at DESC LIMIT 60").all(username.toLowerCase()) as RecRow[]).map(recFrom);
}

/** What friends recommended you of one title (for its page). */
export function recommendedTo(db: DatabaseSync, me: string, app: string, itemId: string): Recommendation[] {
  return receivedBy(db, me, app).filter((r) => r.itemId === itemId);
}

export function markSeen(db: DatabaseSync, me: string, now = Date.now()) {
  db.prepare("UPDATE recommendations SET seen_at = ? WHERE to_user = ? AND seen_at IS NULL").run(now, me.toLowerCase());
}

export const unseenCount = (db: DatabaseSync, me: string) => receivedBy(db, me).filter((r) => !r.seen).length;

/** The sender takes it back (or off their profile); the one it was sent to puts it away. */
export function dropRecommendation(db: DatabaseSync, me: string, id: string, now = Date.now()): boolean {
  const u = me.toLowerCase();
  const row = db.prepare("SELECT from_user, to_user FROM recommendations WHERE id = ?").get(id) as { from_user: string; to_user: string | null } | undefined;
  if (!row) return false;
  if (row.from_user === u) { db.prepare("DELETE FROM recommendations WHERE id = ?").run(id); return true; }
  if (row.to_user === u) { db.prepare("UPDATE recommendations SET dismissed_at = ? WHERE id = ?").run(now, id); return true; }
  return false;
}
