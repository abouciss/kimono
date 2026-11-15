import "server-only";

import type { Section } from "../friends/model";
import type { MusicConfig } from "./config";
import { getArtist, musicDb, playlistRow, playlists, playlistView, publicPlaylists, ratings, taste, tracksFor, type Queue } from "./index";
import { MusicProblem, type Artist, type Playlist, type Track } from "./model";

/*
 * 音 Music among friends: what they're listening to now (or last), their rows
 * on a Kimono profile, their playlists; and your own space's numbers.
 *
 * Kimono's friends rules hold (lib/friends): only friends, never anyone gone
 * invisible or keeping Music off their profile, and not a row they keep to
 * themselves (music:playing, music:loved, music:playlists).
 */

const DAY = 24 * 3600_000;
const user = (u: string) => u.toLowerCase();

export type Person = { username: string; name: string; picture: string | null };

/** Your friends who show Music, with the rows each keeps to themselves. */
async function visibleFriends(viewer: string): Promise<(Person & { kept: Set<string> })[]> {
  const [{ friendsOfUser, friendsDb, people, personIn }, { hiddenAppsOf, keptOf, isInvisible }] = await Promise.all([import("../friends"), import("../friends/model")]);
  const everyone = await people();
  const db = friendsDb();
  return friendsOfUser(user(viewer))
    .filter((u) => !isInvisible(db, u) && !hiddenAppsOf(db, u).includes("music"))
    .map((u) => ({ ...personIn(everyone, u), kept: new Set(keptOf(db, u).filter((k) => k.startsWith("music:")).map((k) => k.slice(6))) }));
}

/** Whether `viewer` may see `owner`'s Music row `row`: themselves always; a friend unless it's kept back. */
async function sees(viewer: string, owner: string, row: string) {
  if (user(viewer) === user(owner)) return true;
  const friend = (await visibleFriends(viewer)).find((f) => f.username === user(owner));
  return Boolean(friend && !friend.kept.has(row));
}

/* ── Friends listening ─────────────────────────────────────────────────── */

export type FriendListening = Person & { track: Track; at: string; live: boolean };

/**
 * What each friend is on: the song playing now (their player said so in the
 * last couple of minutes), else the last one they heard properly, from the
 * last month. Live first, then the latest.
 */
export async function friendsListening(viewer: string): Promise<FriendListening[]> {
  const friends = (await visibleFriends(viewer)).filter((f) => !f.kept.has("playing"));
  if (!friends.length) return [];
  const db = musicDb();
  const now = Date.now();
  const out: FriendListening[] = [];
  for (const f of friends) {
    const q = db.prepare("SELECT data, updated_at FROM queues WHERE username = ?").get(f.username) as { data: string; updated_at: number } | undefined;
    const queue = q ? JSON.parse(q.data) as Omit<Queue, "updatedAt"> : null;
    const { kept: _kept, ...person } = f; // eslint-disable-line @typescript-eslint/no-unused-vars
    if (q && queue?.playing && now - q.updated_at < 2 * 60_000 && queue.tracks[queue.index]) {
      out.push({ ...person, track: queue.tracks[queue.index], at: new Date(q.updated_at).toISOString(), live: true });
      continue;
    }
    const last = db.prepare("SELECT track, played_at FROM plays WHERE username = ? AND seconds >= 30 AND played_at > ? ORDER BY played_at DESC LIMIT 1").get(f.username, now - 30 * DAY) as { track: string; played_at: number } | undefined;
    if (!last) continue;
    const [track] = await tracksFor([last.track], 1);
    if (track) out.push({ ...person, track, at: new Date(last.played_at).toISOString(), live: false });
  }
  return out.sort((a, b) => Number(b.live) - Number(a.live) || Date.parse(b.at) - Date.parse(a.at));
}

/* ── For a profile's widgets ───────────────────────────────────────────── */

/**
 * What a profile's Music widgets show: the song on now (or the last one
 * heard properly), the artists played most this month, and the month's count.
 * The profile asks only when friends may see this person's listening.
 */
export async function musicExtras(username: string, songs: string[] = []) {
  const db = musicDb();
  const u = user(username);
  const now = Date.now();
  const q = db.prepare("SELECT data, updated_at FROM queues WHERE username = ?").get(u) as { data: string; updated_at: number } | undefined;
  const queue = q ? JSON.parse(q.data) as Omit<Queue, "updatedAt"> : null;
  let listening: { track: Track; at: string; live: boolean } | null = null;
  if (q && queue?.playing && now - q.updated_at < 2 * 60_000 && queue.tracks[queue.index]) listening = { track: queue.tracks[queue.index], at: new Date(q.updated_at).toISOString(), live: true };
  else {
    const last = db.prepare("SELECT track, played_at FROM plays WHERE username = ? AND seconds >= 30 ORDER BY played_at DESC LIMIT 1").get(u) as { track: string; played_at: number } | undefined;
    const [t] = last ? await tracksFor([last.track], 1) : [];
    if (t && last) listening = { track: t, at: new Date(last.played_at).toISOString(), live: false };
  }
  const month = db.prepare("SELECT count(*) AS n, coalesce(sum(seconds), 0) AS s FROM plays WHERE username = ? AND played_at > ? AND seconds >= 30").get(u, now - 30 * DAY) as { n: number; s: number };
  /* Each artist's plays this month, a song with two artists counting for both. */
  const rows = db.prepare("SELECT artists, count(*) AS n FROM plays WHERE username = ? AND played_at > ? AND seconds >= 30 GROUP BY artists").all(u, now - 30 * DAY) as { artists: string; n: number }[];
  const tally = new Map<string, { key: string; name: string; plays: number }>();
  for (const row of rows) for (const a of JSON.parse(row.artists) as { key: string; name: string }[]) {
    const was = tally.get(a.key);
    if (was) was.plays += row.n; else tally.set(a.key, { key: a.key, name: a.name, plays: row.n });
  }
  const artists = [...tally.values()].sort((a, b) => b.plays - a.plays).slice(0, 6).map((a) => {
    const kept = db.prepare("SELECT data FROM lookups WHERE kind = 'artist' AND id = ?").get(a.key) as { data: string | null } | undefined;
    const picture = kept?.data ? (JSON.parse(kept.data) as { artist?: { picture?: string | null } }).artist?.picture ?? null : null;
    return { ...a, picture };
  });
  /* The song played through most this month. */
  const repeat = db.prepare("SELECT track, count(*) AS n FROM plays WHERE username = ? AND played_at > ? AND seconds >= length * 0.6 GROUP BY track ORDER BY n DESC LIMIT 1").get(u, now - 30 * DAY) as { track: string; n: number } | undefined;
  const [onRepeat] = repeat ? await tracksFor([repeat.track], 1) : [];
  /* How many times they've played the songs their widgets show, ever. */
  const counts: Record<string, number> = {};
  for (const key of songs.slice(0, 20)) counts[key] = (db.prepare("SELECT count(*) AS n FROM plays WHERE username = ? AND track = ? AND seconds >= 30").get(u, key) as { n: number }).n;
  return { listening, plays: month.n, minutes: Math.round(month.s / 60), artists, counts, onRepeat: onRepeat ? { track: onRepeat, plays: repeat!.n } : null };
}

/* ── Friends on a song ─────────────────────────────────────────────────── */

export type FriendOnSong = Person & { loved: boolean; playedAt: string | null };

/** Which friends have played this song (the last half year) or love it, as each lets friends see. */
export async function friendsOnSong(viewer: string, key: string): Promise<FriendOnSong[]> {
  const friends = await visibleFriends(viewer);
  if (!friends.length) return [];
  const db = musicDb();
  const out: FriendOnSong[] = [];
  for (const f of friends) {
    const played = f.kept.has("playing") ? undefined
      : db.prepare("SELECT max(played_at) AS at FROM plays WHERE username = ? AND track = ? AND seconds >= 30 AND played_at > ?").get(f.username, key, Date.now() - 180 * DAY) as { at: number | null } | undefined;
    const loved = !f.kept.has("loved") && ratings(f.username).some((r) => r.kind === "track" && r.key === key && r.rating === "love");
    const { kept: _kept, ...person } = f; // eslint-disable-line @typescript-eslint/no-unused-vars
    if (loved || played?.at) out.push({ ...person, loved, playedAt: played?.at ? new Date(played.at).toISOString() : null });
  }
  return out.sort((a, b) => Number(b.loved) - Number(a.loved) || Date.parse(b.playedAt ?? "0") - Date.parse(a.playedAt ?? "0"));
}

/* ── Your space ────────────────────────────────────────────────────────── */

export type Me = {
  plays: number;
  minutes: number;
  tags: string[];
  artists: Artist[];
  onRepeat: Track[];
  recent: Track[];
  playlists: Playlist[];
  liked: number;
};

/** Your month in Music: how much you listened, your genres and artists, what you keep coming back to. */
export async function me(config: MusicConfig, username: string): Promise<Me> {
  const db = musicDb();
  const since = Date.now() - 30 * DAY;
  const totals = db.prepare("SELECT count(*) AS n, coalesce(sum(seconds), 0) AS s FROM plays WHERE username = ? AND played_at > ? AND seconds >= 30").get(user(username), since) as { n: number; s: number };
  const repeat = db.prepare("SELECT track, count(*) AS n FROM plays WHERE username = ? AND played_at > ? AND seconds >= length * 0.6 GROUP BY track HAVING n >= 2 ORDER BY n DESC, max(played_at) DESC LIMIT 20").all(user(username), since) as { track: string }[];
  const recent = (db.prepare("SELECT track, max(played_at) AS at FROM plays WHERE username = ? AND seconds >= 30 GROUP BY track ORDER BY at DESC LIMIT 20").all(user(username)) as { track: string }[]).map((r) => r.track);
  const t = await taste(config, username);
  const artists = (await Promise.all(t.artists.filter((a) => a.key).slice(0, 10).map((a) => getArtist(config, a.key).then((p) => p?.artist ?? null).catch(() => null)))).filter((a): a is Artist => Boolean(a));
  return {
    plays: totals.n,
    minutes: Math.round(totals.s / 60),
    tags: t.tags.slice(0, 6).map((x) => x.tag),
    artists,
    onRepeat: await tracksFor(repeat.map((r) => r.track), 20),
    recent: await tracksFor(recent, 20),
    playlists: playlists(username),
    liked: ratings(username).filter((r) => r.kind === "track" && r.rating !== "down").length,
  };
}

/* ── Playlists, as friends see them ────────────────────────────────────── */

/** A playlist for whoever asks: its owner, or a friend who may see their playlists (read only). */
export async function playlistFor(viewer: string, id: string) {
  const row = playlistRow(id);
  if (!row) throw new MusicProblem("No such playlist.", 404);
  const view = playlistView(row, viewer);
  /* Not yours or shared with you: only a public one, and only for friends who see your playlists. */
  if (view.role === "listener" && !(row.public === 1 && await sees(viewer, row.username, "playlists"))) throw new MusicProblem("No such playlist.", 404);
  const { people, personIn } = await import("../friends");
  const everyone = await people();
  return { ...view, owner: personIn(everyone, row.username), members: view.members.map((m) => ({ ...personIn(everyone, m.username), joined: m.joined })), mine: view.role === "owner" || view.role === "member" };
}

/** A friend's playlists, as their profile and their Music page show them. */
export async function playlistsOf(viewer: string, username: string): Promise<Playlist[]> {
  return (await sees(viewer, username, "playlists")) ? publicPlaylists(username) : [];
}

/* ── On a Kimono profile ───────────────────────────────────────────────── */

const albumHref = (t: Track) => (t.album?.key ? `/music/album/${t.album.key.replace(/^dz:/, "")}` : null);

/** Music's rows on someone's profile: what they've been listening to, what they love, their playlists. */
export async function musicSectionsFrom(username: string): Promise<Section[]> {
  const db = musicDb();
  const u = user(username);
  const heard = db.prepare("SELECT track, max(played_at) AS at FROM plays WHERE username = ? AND seconds >= 30 GROUP BY track ORDER BY at DESC LIMIT 24").all(u) as { track: string; at: number }[];
  const heardTracks = await tracksFor(heard.map((h) => h.track), 24);
  const at = new Map(heard.map((h) => [h.track, h.at]));
  const loved = ratings(u).filter((r) => r.kind === "track" && r.rating === "love").slice(0, 24);
  const lists = publicPlaylists(u).filter((p) => p.count > 0).slice(0, 24);
  const item = (t: Track) => ({ app: "music", itemId: t.key, title: t.title, subtitle: t.artists.map((a) => a.name).join(", ") || null, cover: t.album?.cover ?? null, href: albumHref(t) });
  const sections: Section[] = [
    { app: "music", appName: "Music", kind: "playing", title: "Listening to", items: heardTracks.map((t) => ({ ...item(t), at: at.get(t.key) ?? null })) },
    { app: "music", appName: "Music", kind: "loved", title: "Loved", items: (await tracksFor(loved.map((r) => r.key), 24)).map((t) => ({ ...item(t), rating: "love" as const })) },
    { app: "music", appName: "Music", kind: "playlists", title: "Playlists", items: lists.map((p) => ({ app: "music", itemId: p.id, title: p.name, subtitle: `${p.count} ${p.count === 1 ? "song" : "songs"}`, cover: p.covers[0] ?? null, href: `/music/playlist/${p.id}`, at: Date.parse(p.updatedAt) || null })) },
  ];
  return sections.filter((s) => s.items.length > 0);
}

async function musicOn() {
  const [{ musicConfig }, { getPlatformSettings }] = await Promise.all([import("./config"), import("../settings")]);
  return musicConfig(await getPlatformSettings()).enabled;
}

/** Someone's Music rows for their profile (the friends rules are applied by the profile); nothing while Music is off. */
export async function musicSections(viewer: string, username: string): Promise<Section[]> {
  void viewer;
  if (!(await musicOn())) return [];
  return musicSectionsFrom(username);
}

/** What friends listened to, as Kimono's Home shows friends' activity. */
export async function musicActivity(viewer: string) {
  if (!(await musicOn())) return [];
  return (await friendsListening(viewer)).map((f) => ({
    kind: "listening" as const, app: "music", from: f.username, itemId: f.track.key, title: f.track.title,
    subtitle: f.track.artists.map((a) => a.name).join(", ") || null, cover: f.track.album?.cover ?? null, href: albumHref(f.track), at: Date.parse(f.at),
  }));
}
