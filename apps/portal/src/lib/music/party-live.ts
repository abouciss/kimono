import "server-only";

import { randomBytes } from "node:crypto";
import type { MusicConfig } from "./config";
import { musicDb, radio, tracksFor } from "./index";
import { MusicProblem } from "./model";
import {
  addChat, addSongs, command, leave, liveParties, loadParty, mayJoin, migrateParties, newParty, nowPlaying, parseCommand, positionOf, reactions, replaceWith, report, saveParty, seen, tick, viewOf,
  type ChatLine, type MemberState, type Party, type PartyView,
} from "./party";

/*
 * 共 Listen parties on the server (./party.ts has the rules). While anyone is
 * in one, the Portal holds it here, runs its clock twice a second, and sends
 * every change to each player listening; it's kept in music.db as it goes, so
 * a restart picks up where it was and players simply reconnect.
 */

export type LiveEvent =
  | { type: "state"; state: PartyView }
  | { type: "chat"; lines: ChatLine[] }
  | { type: "react"; username: string; emoji: string; at: number }
  | { type: "ended" };

type Listener = { client: string; username: string; send: (event: LiveEvent) => void };
type Room = { party: Party; listeners: Set<Listener>; reacted: Map<string, number[]>; growing: boolean };

const cache = globalThis as unknown as { kimonoMusicParties?: Map<string, Room>; kimonoMusicPartyClock?: ReturnType<typeof setInterval>; kimonoMusicPartyDb?: boolean };
const rooms: Map<string, Room> = (cache.kimonoMusicParties ??= new Map());

function db() {
  const d = musicDb();
  if (!cache.kimonoMusicPartyDb) { migrateParties(d); cache.kimonoMusicPartyDb = true; }
  return d;
}

async function friendsOf(username: string) {
  const { friendsOfUser } = await import("../friends");
  return friendsOfUser(username);
}

function roomOf(id: string): Room | null {
  const known = rooms.get(id);
  if (known) return known;
  const p = loadParty(db(), id);
  if (!p || p.ended) return null;
  const room: Room = { party: p, listeners: new Set(), reacted: new Map(), growing: false };
  rooms.set(id, room);
  runClock();
  return room;
}

function must(id: string): Room {
  const room = roomOf(id);
  if (!room) throw new MusicProblem("This listen party has ended.", 404);
  return room;
}

const tell = (room: Room, event: LiveEvent) => { for (const l of room.listeners) l.send(event); };

function commit(room: Room, next: Party) {
  const changed = next.seq !== room.party.seq || next.members.length !== room.party.members.length;
  room.party = next;
  if (changed) {
    saveParty(db(), next);
    tell(room, { type: "state", state: viewOf(next, Date.now()) });
  }
}

/* When the queue runs out, songs like the last one (as the host likes them) keep it going. */
async function grow(cfg: MusicConfig, room: Room) {
  if (room.growing) return;
  room.growing = true;
  try {
    const last = room.party.tracks[room.party.tracks.length - 1];
    if (!last) return;
    const more = await radio(cfg, room.party.host, last.key, room.party.tracks.map((t) => t.key));
    if (more.length) commit(room, addSongs(room.party, more.slice(0, 15), "end", Date.now()));
  } catch (error) {
    console.warn("music party: no more songs:", error instanceof Error ? error.message : error);
  } finally { room.growing = false; }
}

let clockConfig: MusicConfig | null = null;

function runClock() {
  if (cache.kimonoMusicPartyClock) return;
  cache.kimonoMusicPartyClock = setInterval(() => {
    const now = Date.now();
    for (const [id, room] of rooms) {
      /* Everyone listening is here. */
      room.party = seen(room.party, [...room.listeners].map((l) => l.client), now);
      const { party, changed, wantMore } = tick(room.party, now);
      if (changed) commit(room, party);
      if (wantMore && clockConfig) void grow(clockConfig, room);
      /* Nobody listening for a while: put it away (kept in the database, ended after an hour). */
      if (!room.listeners.size && now - Math.max(...room.party.members.map((m) => m.seen), room.party.started) > 10 * 60_000) rooms.delete(id);
    }
    if (!rooms.size) { clearInterval(cache.kimonoMusicPartyClock); cache.kimonoMusicPartyClock = undefined; }
  }, 500);
  cache.kimonoMusicPartyClock.unref?.();
}

/** Starts a party from your queue (the song playing, where you are in it, what's next), asking `invited` along. */
export async function startParty(cfg: MusicConfig, username: string, keys: string[], index: number, position: number, invited: string[]) {
  clockConfig = cfg;
  const tracks = await tracksFor(keys, 500);
  if (!tracks.length) throw new MusicProblem("Play something first.", 400);
  const friends = new Set(await friendsOf(username));
  const asked = invited.map((u) => u.toLowerCase()).filter((u) => friends.has(u));
  const id = randomBytes(9).toString("base64url");
  const p = newParty(id, username, tracks, Math.min(index, tracks.length - 1), position, asked, Date.now());
  /* It starts where you were, playing, for whoever is there. */
  const started: Party = { ...p, playing: true, at: Date.now() + 500 };
  saveParty(db(), started);
  rooms.set(id, { party: started, listeners: new Set(), reacted: new Map(), growing: false });
  runClock();
  return id;
}

/** The parties you could be in now: yours, ones you were asked to, your friends' open ones. */
export async function partiesFor(username: string) {
  const u = username.toLowerCase();
  const friends = await friendsOf(u);
  const now = Date.now();
  const { people, personIn } = await import("../friends");
  const everyone = await people();
  const out = [];
  for (const stored of liveParties(db(), now)) {
    const p = rooms.get(stored.id)?.party ?? stored;
    const hostFriends = p.host === u ? [] : await friendsOf(p.host);
    if (p.host !== u && !mayJoin(p, u, hostFriends)) continue;
    const view = viewOf(p, now);
    if (!view.members.length && p.host !== u) continue;
    out.push({ id: p.id, host: personIn(everyone, p.host), invited: p.invited.includes(u), members: view.members.map((m) => personIn(everyone, m.username)), song: nowPlaying(p) });
  }
  void friends;
  return out;
}

async function allowed(room: Room, username: string) {
  return mayJoin(room.party, username, await friendsOf(room.party.host));
}

export async function partyNow(id: string, username: string) {
  const room = must(id);
  if (!(await allowed(room, username))) throw new MusicProblem("This listen party is for the host's friends.", 403);
  const { people, personIn } = await import("../friends");
  const everyone = await people();
  const names = [...new Set([room.party.host, ...room.party.members.map((m) => m.username), ...room.party.chat.map((c) => c.username)])];
  return { state: viewOf(room.party, Date.now()), chat: room.party.chat, people: names.map((n) => personIn(everyone, n)) };
}

/** Listens to a party: its state and chat now, then every change. The player counts as here while it listens. */
export async function listen(cfg: MusicConfig, id: string, client: string, username: string, send: (event: LiveEvent) => void): Promise<(() => void) | null> {
  clockConfig = cfg;
  const room = roomOf(id);
  if (!room || !(await allowed(room, username))) return null;
  const listener: Listener = { client, username: username.toLowerCase(), send };
  room.listeners.add(listener);
  send({ type: "state", state: viewOf(room.party, Date.now()) });
  send({ type: "chat", lines: room.party.chat });
  return () => {
    room.listeners.delete(listener);
    /* Gone without saying: they leave once they've been away a moment (the clock ages them out). */
  };
}

const states = new Set<MemberState>(["loading", "ready"]);

/**
 * Something a player does: `{ client, seq, type, … }`: `status` (loading or
 * ready, for which song), a command (play, pause, seek, jump, next, prev,
 * remove, move), `add` (keys, next or at the end), `replace` (keys: play
 * these now), `react`, `chat`, `invite`, `open`, `leave`, `end` (the host).
 */
export async function act(cfg: MusicConfig, id: string, username: string, raw: Record<string, unknown>): Promise<{ status: number; body: Record<string, unknown> }> {
  clockConfig = cfg;
  const now = Date.now();
  const room = must(id);
  const u = username.toLowerCase();
  if (!(await allowed(room, u))) return { status: 403, body: { ok: false, error: "This listen party is for the host's friends." } };
  const client = typeof raw.client === "string" && /^[A-Za-z0-9_-]{6,64}$/.test(raw.client) ? raw.client : null;
  const type = String(raw.type ?? "");
  const answer = (status = 200, extra: Record<string, unknown> = {}) => ({ status, body: { ok: status < 300, ...extra, state: viewOf(room.party, Date.now()) } });
  const keys = (v: unknown) => (Array.isArray(v) ? v.filter((k): k is string => typeof k === "string").slice(0, 200) : []);

  if (type === "end") {
    if (u !== room.party.host) return answer(403);
    room.party = { ...room.party, ended: true, seq: room.party.seq + 1 };
    saveParty(db(), room.party);
    tell(room, { type: "ended" });
    rooms.delete(id);
    return { status: 200, body: { ok: true } };
  }
  if (type === "invite") {
    const friends = new Set(await friendsOf(room.party.host));
    const asked = keys(raw.usernames).map((x) => x.toLowerCase()).filter((x) => friends.has(x) || x === room.party.host);
    commit(room, { ...room.party, invited: [...new Set([...room.party.invited, ...asked])], seq: room.party.seq + 1 });
    return answer();
  }
  if (type === "open") {
    if (u !== room.party.host) return answer(403);
    commit(room, { ...room.party, open: Boolean(raw.open), seq: room.party.seq + 1 });
    return answer();
  }
  if (!client) return { status: 400, body: { ok: false, error: "Say which player this is." } };
  if (type === "status") {
    const state = raw.state as MemberState;
    if (!states.has(state)) return { status: 400, body: { ok: false, error: "That isn't a state." } };
    const fresh = !room.party.members.some((m) => m.client === client);
    const next = report(room.party, { client, username: u }, state, typeof raw.key === "string" ? raw.key : null, now);
    const { party } = tick(next, now);
    commit(room, fresh ? { ...party, seq: party.seq + 1 } : party);
    return answer();
  }
  if (type === "leave") { commit(room, leave(room.party, client)); return answer(); }
  if (!room.party.members.some((m) => m.client === client)) return { status: 409, body: { ok: false, reason: "not-joined", error: "Join the party first." } };

  if (type === "react") {
    const emoji = String(raw.emoji ?? "");
    if (!(reactions as readonly string[]).includes(emoji)) return { status: 400, body: { ok: false, error: "That isn't one of the reactions." } };
    const recent = (room.reacted.get(client) ?? []).filter((t) => now - t < 1000);
    if (recent.length >= 4) return answer(429);
    room.reacted.set(client, [...recent, now]);
    tell(room, { type: "react", username: u, emoji, at: now });
    return { status: 200, body: { ok: true } };
  }
  if (type === "chat") {
    const added = addChat(room.party, u, String(raw.text ?? ""), randomBytes(6).toString("base64url"), now);
    if (!added) return { status: 400, body: { ok: false, error: "Say something first." } };
    room.party = added.party;
    saveParty(db(), room.party);
    tell(room, { type: "chat", lines: [added.line] });
    return { status: 200, body: { ok: true } };
  }
  if (type === "add" || type === "replace") {
    const tracks = await tracksFor(keys(raw.keys), 200);
    if (!tracks.length) return answer(400);
    commit(room, type === "add" ? addSongs(room.party, tracks, raw.where === "next" ? "next" : "end", Date.now()) : replaceWith(room.party, tracks, Date.now()));
    return answer();
  }
  const cmd = parseCommand(raw);
  if (!cmd) return { status: 400, body: { ok: false, error: "That isn't something a party does." } };
  const seq = Number(raw.seq);
  const out = command(room.party, cmd, Number.isSafeInteger(seq) ? seq : 0, now);
  if (!out.ok) return answer(out.reason === "stale" ? 409 : 400, { reason: out.reason });
  commit(room, tick(out.party, now).party);
  return answer();
}

/** Where a party is now, for a player that missed a beat. */
export const whereNow = (id: string) => { const r = rooms.get(id); return r ? positionOf(r.party, Date.now()) : null; };
