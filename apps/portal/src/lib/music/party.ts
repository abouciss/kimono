/**
 * 共 Listening together: one queue, one timeline, many players.
 *
 * A listen party is a queue friends hear at the same moment from wherever
 * they are. Each player fetches the song itself; what's shared is the queue,
 * which song, playing or paused, the position, and the server time they were
 * set: where anyone should be is position + (now − at) while playing.
 *
 * - Anyone in the party can play, pause, seek, skip, and add to the queue.
 *   A seek or a skip made against an older state (seq) than the party's is
 *   refused as stale: someone else moved first. Play and pause always land.
 * - A new song waits for everyone to have it loaded (the first play of a
 *   song can take seconds while the server fetches it), at most a few
 *   seconds, then starts for everyone a moment ahead, together.
 * - When a song ends the next starts; when the queue runs out the server adds
 *   songs like the last one (./party-live.ts), so a party doesn't go quiet.
 * - Each player keeps to the timeline itself, with Watch Together's maths
 *   (lib/watch/together.ts: positionAt, correction, clockOffset).
 *
 * Pure logic over plain objects, and SQLite for keeping parties.
 */
import type { DatabaseSync } from "node:sqlite";
import type { Track } from "./model";

export type MemberState = "loading" | "ready";
export type Member = { client: string; username: string; state: MemberState; key: string | null; seen: number; joined: number };
export type ChatLine = { id: string; username: string; text: string; at: number };

export type Party = {
  id: string;
  host: string;
  /** Who was asked; any friend of the host may also join while it's open. */
  invited: string[];
  open: boolean;
  tracks: Track[];
  index: number;
  playing: boolean;
  /** Seconds into the song at `at` (server ms); while playing it moves on from there. */
  position: number;
  at: number;
  /** A new song waiting for everyone to load it: who, since when. */
  waiting: { for: string[]; since: number } | null;
  members: Member[];
  chat: ChatLine[];
  seq: number;
  started: number;
  ended: boolean;
};

export const party = {
  /** A player not heard from in this long has left. */
  goneAfter: 30_000,
  /** The longest a new song waits for anyone to load it. */
  waitAtMost: 12_000,
  /** How far ahead a song starts once everyone has it, so all start together. */
  leadIn: 700,
  chatKept: 200,
  queueAtMost: 500,
};

export const reactions = ["❤️", "🔥", "😂", "😮", "🕺", "👏"] as const;

export const nowPlaying = (p: Party) => p.tracks[p.index] ?? null;
export const present = (m: Member, now: number) => now - m.seen < party.goneAfter;

/** Where the song is at `now`, in seconds. */
export function positionOf(p: Pick<Party, "playing" | "position" | "at">, now: number) {
  return p.playing ? Math.max(0, p.position + Math.max(0, now - p.at) / 1000) : p.position;
}

export function newParty(id: string, host: string, tracks: Track[], index: number, position: number, invited: string[], now: number): Party {
  return {
    id, host: host.toLowerCase(), invited: [...new Set(invited.map((u) => u.toLowerCase()))], open: true,
    tracks: tracks.slice(0, party.queueAtMost), index: Math.max(0, Math.min(index, tracks.length - 1)),
    playing: false, position: Math.max(0, position), at: now, waiting: null,
    members: [], chat: [], seq: 1, started: now, ended: false,
  };
}

/* A change everyone must hear about: a new seq. */
const bump = (p: Party): Party => ({ ...p, seq: p.seq + 1 });

/** Moves to song `index` from the start: it plays once everyone here has it loaded. */
export function startSong(p: Party, index: number, now: number): Party {
  const here = p.members.filter((m) => present(m, now)).map((m) => m.client);
  return bump({ ...p, index, position: 0, at: now, playing: false, waiting: { for: here, since: now } });
}

/** A player saying how it is: loading or ready for song `key`. Being heard from keeps it in the party. */
export function report(p: Party, who: { client: string; username: string }, state: MemberState, key: string | null, now: number): Party {
  const others = p.members.filter((m) => m.client !== who.client);
  const was = p.members.find((m) => m.client === who.client);
  const member: Member = { client: who.client, username: who.username.toLowerCase(), state, key, seen: now, joined: was?.joined ?? now };
  return { ...p, members: [...others, member] };
}

export function seen(p: Party, clients: Iterable<string>, now: number): Party {
  const ids = new Set(clients);
  return { ...p, members: p.members.map((m) => (ids.has(m.client) ? { ...m, seen: now } : m)) };
}

export function leave(p: Party, client: string): Party {
  return bump({ ...p, members: p.members.filter((m) => m.client !== client), waiting: p.waiting ? { ...p.waiting, for: p.waiting.for.filter((c) => c !== client) } : null });
}

/**
 * The clock: a waiting song starts once everyone has it (or it waited long
 * enough); a song that has played through gives way to the next. Answers
 * whether anything changed, and whether the queue has run out (more is wanted).
 */
export function tick(p: Party, now: number): { party: Party; changed: boolean; wantMore: boolean } {
  if (p.ended) return { party: p, changed: false, wantMore: false };
  const song = nowPlaying(p);
  if (p.waiting && song) {
    const ready = new Set(p.members.filter((m) => present(m, now) && m.state === "ready" && m.key === song.key).map((m) => m.client));
    const still = p.waiting.for.filter((c) => !ready.has(c) && p.members.some((m) => m.client === c && present(m, now)));
    if (!still.length || now - p.waiting.since >= party.waitAtMost) {
      return { party: bump({ ...p, waiting: null, playing: true, position: 0, at: now + party.leadIn }), changed: true, wantMore: false };
    }
    if (still.length !== p.waiting.for.length) return { party: { ...p, waiting: { ...p.waiting, for: still } }, changed: true, wantMore: false };
    return { party: p, changed: false, wantMore: false };
  }
  if (p.playing && song && song.duration && positionOf(p, now) >= song.duration - 0.25) {
    if (p.index + 1 < p.tracks.length) return { party: startSong(p, p.index + 1, now), changed: true, wantMore: p.index + 2 >= p.tracks.length };
    return { party: bump({ ...p, playing: false, position: song.duration, at: now }), changed: true, wantMore: true };
  }
  return { party: p, changed: false, wantMore: false };
}

export type Command =
  | { type: "play" } | { type: "pause" }
  | { type: "seek"; position: number }
  | { type: "jump"; index: number }
  | { type: "next" } | { type: "prev" }
  | { type: "remove"; index: number }
  | { type: "move"; from: number; to: number };

export function parseCommand(raw: Record<string, unknown>): Command | null {
  const n = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? v : null);
  switch (raw.type) {
    case "play": case "pause": case "next": case "prev": return { type: raw.type };
    case "seek": { const position = n(raw.position); return position === null || position < 0 ? null : { type: "seek", position }; }
    case "jump": case "remove": { const index = n(raw.index); return index === null ? null : { type: raw.type, index: Math.trunc(index) }; }
    case "move": { const from = n(raw.from), to = n(raw.to); return from === null || to === null ? null : { type: "move", from: Math.trunc(from), to: Math.trunc(to) }; }
    default: return null;
  }
}

export type Outcome = { ok: true; party: Party } | { ok: false; reason: "stale" | "invalid"; party: Party };

/** A command from anyone in the party, made against the state `seenSeq`. */
export function command(p: Party, cmd: Command, seenSeq: number, now: number): Outcome {
  const at = positionOf(p, now);
  const stale = seenSeq < p.seq;
  const inQueue = (i: number) => i >= 0 && i < p.tracks.length;
  switch (cmd.type) {
    case "play":
      if (p.playing || p.waiting) return { ok: true, party: p };
      if (!nowPlaying(p)) return { ok: false, reason: "invalid", party: p };
      return { ok: true, party: bump({ ...p, playing: true, position: at, at: now + 300 }) };
    case "pause":
      if (!p.playing) return { ok: true, party: p };
      return { ok: true, party: bump({ ...p, playing: false, position: at, at: now }) };
    case "seek": {
      if (stale) return { ok: false, reason: "stale", party: p };
      const song = nowPlaying(p);
      const position = Math.min(cmd.position, Math.max(0, (song?.duration ?? cmd.position) - 1));
      return { ok: true, party: bump({ ...p, position, at: now + (p.playing ? 300 : 0) }) };
    }
    case "jump":
      if (stale) return { ok: false, reason: "stale", party: p };
      return inQueue(cmd.index) ? { ok: true, party: startSong(p, cmd.index, now) } : { ok: false, reason: "invalid", party: p };
    case "next":
      if (stale) return { ok: false, reason: "stale", party: p };
      return inQueue(p.index + 1) ? { ok: true, party: startSong(p, p.index + 1, now) } : { ok: false, reason: "invalid", party: p };
    case "prev":
      if (stale) return { ok: false, reason: "stale", party: p };
      if (at > 3 || p.index === 0) return { ok: true, party: bump({ ...p, position: 0, at: now + (p.playing ? 300 : 0) }) };
      return { ok: true, party: startSong(p, p.index - 1, now) };
    case "remove": {
      if (!inQueue(cmd.index) || cmd.index === p.index) return { ok: false, reason: "invalid", party: p };
      return { ok: true, party: bump({ ...p, tracks: p.tracks.filter((_, i) => i !== cmd.index), index: cmd.index < p.index ? p.index - 1 : p.index }) };
    }
    case "move": {
      if (!inQueue(cmd.from) || !inQueue(cmd.to) || cmd.from === p.index || cmd.from === cmd.to) return { ok: false, reason: "invalid", party: p };
      const tracks = [...p.tracks];
      const [t] = tracks.splice(cmd.from, 1);
      tracks.splice(cmd.to, 0, t);
      const playing = p.tracks[p.index];
      return { ok: true, party: bump({ ...p, tracks, index: tracks.indexOf(playing) }) };
    }
  }
}

/** Songs added: after what's playing ("next") or at the end. */
export function addSongs(p: Party, tracks: Track[], where: "next" | "end", now: number): Party {
  const room = party.queueAtMost - p.tracks.length;
  const add = tracks.slice(0, Math.max(0, room));
  if (!add.length) return p;
  const queue = where === "next" ? [...p.tracks.slice(0, p.index + 1), ...add, ...p.tracks.slice(p.index + 1)] : [...p.tracks, ...add];
  const grown = bump({ ...p, tracks: queue });
  /* A party that had run out picks up with what was added. */
  const song = nowPlaying(p);
  const over = !p.playing && !p.waiting && song && p.position >= song.duration - 0.5 && p.index + 1 < queue.length;
  return over ? startSong(grown, p.index + 1, now) : grown;
}

/** Plays these songs now for everyone, in place of what's left in the queue. */
export function replaceWith(p: Party, tracks: Track[], now: number): Party {
  if (!tracks.length) return p;
  const kept = p.tracks.slice(0, p.index + 1);
  return startSong({ ...p, tracks: [...kept, ...tracks].slice(0, party.queueAtMost) }, kept.length, now);
}

export function addChat(p: Party, username: string, text: string, id: string, now: number): { party: Party; line: ChatLine } | null {
  const clean = text.replace(/\s+/g, " ").trim().slice(0, 400);
  if (!clean) return null;
  const line: ChatLine = { id, username: username.toLowerCase(), text: clean, at: now };
  return { party: { ...p, chat: [...p.chat, line].slice(-party.chatKept) }, line };
}

/** Who may be in a party: its host, anyone asked, and (while it's open) the host's friends. */
export function mayJoin(p: Party, username: string, friendsOfHost: string[]): boolean {
  const u = username.toLowerCase();
  return u === p.host || p.invited.includes(u) || (p.open && friendsOfHost.includes(u));
}

export type PartyView = Omit<Party, "members" | "chat"> & {
  members: { username: string; state: MemberState }[];
  /** The server's clock when this was made, for players to set theirs by. */
  now: number;
};

export function viewOf(p: Party, now: number): PartyView {
  const { chat: _chat, members, ...rest } = p; // eslint-disable-line @typescript-eslint/no-unused-vars
  /* One entry per person, however many screens they have it on. */
  const people = new Map<string, MemberState>();
  for (const m of members) if (present(m, now)) people.set(m.username, people.get(m.username) === "ready" ? "ready" : m.state);
  return { ...rest, members: [...people].map(([username, state]) => ({ username, state })), now };
}

export const cleanClient = (raw: unknown) => (typeof raw === "string" && /^[A-Za-z0-9_-]{6,64}$/.test(raw) ? raw : null);
export const cleanPartyId = (raw: unknown) => (typeof raw === "string" && /^[A-Za-z0-9_-]{8,40}$/.test(raw) ? raw : null);

/* ── Keeping parties ───────────────────────────────────────────────────── */

export function migrateParties(db: DatabaseSync) {
  db.exec("CREATE TABLE IF NOT EXISTS parties (id TEXT PRIMARY KEY, host TEXT NOT NULL, data TEXT NOT NULL, ended INTEGER NOT NULL DEFAULT 0, updated_at INTEGER NOT NULL)");
}

export function saveParty(db: DatabaseSync, p: Party) {
  db.prepare("INSERT INTO parties (id, host, data, ended, updated_at) VALUES (?, ?, ?, ?, ?) ON CONFLICT (id) DO UPDATE SET data = excluded.data, ended = excluded.ended, updated_at = excluded.updated_at")
    .run(p.id, p.host, JSON.stringify(p), p.ended ? 1 : 0, Date.now());
}

export function loadParty(db: DatabaseSync, id: string): Party | null {
  const row = db.prepare("SELECT data FROM parties WHERE id = ?").get(id) as { data: string } | undefined;
  return row ? JSON.parse(row.data) as Party : null;
}

/** Parties still going (heard from in the last hour), newest first. */
export function liveParties(db: DatabaseSync, now: number): Party[] {
  return (db.prepare("SELECT data FROM parties WHERE ended = 0 AND updated_at > ? ORDER BY updated_at DESC").all(now - 3600_000) as { data: string }[]).map((r) => JSON.parse(r.data) as Party);
}
