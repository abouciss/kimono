"use client";

import { clockOffset, correction, type ClockSample } from "@/lib/watch/together";
import type { ChatLine, PartyView } from "@/lib/music/party";
import type { Person, Track } from "./api";

/*
 * 共 One player in a listen party: it listens to the party's changes, says
 * when it has each song ready, and keeps its audio on the shared timeline
 * (Watch Together's maths: drift under a second is taken out by easing the
 * rate, anything more by jumping). It knows nothing of React; the player
 * (./player.tsx) holds one while you're in a party and draws what it says.
 */

export type PartyEvents = {
  view(view: PartyView): void;
  chat(lines: ChatLine[], fresh: boolean): void;
  react(username: string, emoji: string): void;
  people(people: Person[]): void;
  ended(): void;
  problem(text: string): void;
};

const streamOf = (t: Track) => `/api/v1/music/stream?key=${encodeURIComponent(t.key)}`;

/** This tab's name in parties: each tab is a player of its own. */
export function clientId() {
  try {
    const known = sessionStorage.getItem("km-client");
    if (known) return known;
    const made = crypto.randomUUID().replace(/-/g, "").slice(0, 20);
    sessionStorage.setItem("km-client", made);
    return made;
  } catch { return crypto.randomUUID().replace(/-/g, "").slice(0, 20); }
}

export class PartyPlayer {
  view: PartyView | null = null;
  private source: EventSource | null = null;
  private offset = 0;
  private loadedKey: string | null = null;
  private reportedKey: string | null = null;
  private correcting = false;
  private startTimer: ReturnType<typeof setTimeout> | null = null;
  private driftTimer: ReturnType<typeof setInterval> | null = null;
  private stopped = false;

  constructor(readonly id: string, readonly client: string, private audio: HTMLAudioElement, private on: PartyEvents) {}

  /** The server's time now, by this tab's clock and the measured offset. */
  serverNow() { return Date.now() + this.offset; }

  async start() {
    await this.measureClock();
    if (this.stopped) return;
    this.source = new EventSource(`/api/v1/music/party/${encodeURIComponent(this.id)}?client=${this.client}`);
    this.source.addEventListener("state", (e) => this.apply(JSON.parse((e as MessageEvent).data) as PartyView));
    let first = true;
    this.source.addEventListener("chat", (e) => { this.on.chat((JSON.parse((e as MessageEvent).data) as { lines: ChatLine[] }).lines, !first); first = false; });
    this.source.addEventListener("react", (e) => { const r = JSON.parse((e as MessageEvent).data) as { username: string; emoji: string }; this.on.react(r.username, r.emoji); });
    this.source.addEventListener("ended", () => { this.stop(); this.on.ended(); });
    this.source.addEventListener("ping", (e) => { const now = (JSON.parse((e as MessageEvent).data) as { now: number }).now; if (Math.abs(now - this.serverNow()) > 1500) void this.measureClock(); });
    this.audio.addEventListener("canplay", this.onCanPlay);
    this.driftTimer = setInterval(() => this.keepTime(), 1000);
    fetch(`/api/v1/music/party/${encodeURIComponent(this.id)}`).then((r) => r.json()).then((b: { people?: Person[] }) => { if (b.people) this.on.people(b.people); }).catch(() => null);
  }

  stop() {
    this.stopped = true;
    this.source?.close();
    this.audio.removeEventListener("canplay", this.onCanPlay);
    if (this.startTimer) clearTimeout(this.startTimer);
    if (this.driftTimer) clearInterval(this.driftTimer);
    this.audio.playbackRate = 1;
  }

  /** NTP-style: a few round trips to the server's clock, the steadiest kept. */
  private async measureClock() {
    const samples: ClockSample[] = [];
    for (let i = 0; i < 4; i++) {
      const sent = Date.now();
      const r = await fetch("/api/v1/music/clock", { cache: "no-store" }).then((x) => x.json() as Promise<{ now: number }>).catch(() => null);
      if (r) samples.push({ sent, received: Date.now(), server: r.now });
    }
    const got = clockOffset(samples);
    if (got) this.offset = got.offset;
  }

  async send(body: Record<string, unknown>): Promise<boolean> {
    const res = await fetch(`/api/v1/music/party/${encodeURIComponent(this.id)}`, {
      method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ client: this.client, seq: this.view?.seq ?? 0, ...body }),
    }).catch(() => null);
    if (!res) { this.on.problem("The party didn't hear that."); return false; }
    const answer = await res.json().catch(() => null) as { state?: PartyView; error?: string; reason?: string } | null;
    if (answer?.state && !this.stopped) this.apply(answer.state);
    if (res.status === 409 && answer?.reason === "stale") return false;
    if (!res.ok && answer?.error) this.on.problem(answer.error);
    return res.ok;
  }

  private report(state: "loading" | "ready", key: string) {
    void this.send({ type: "status", state, key });
  }

  private onCanPlay = () => {
    const song = this.song();
    if (song && this.loadedKey === song.key && this.reportedKey !== song.key) { this.reportedKey = song.key; this.report("ready", song.key); }
  };

  song(): Track | null { return this.view ? this.view.tracks[this.view.index] ?? null : null; }

  /** A newer state from the party: the right song, at the right place, playing or not. */
  apply(view: PartyView) {
    /* A reply that arrives after leaving (to the "leave" itself, say) mustn't bring the party back. */
    if (this.stopped) return;
    if (this.view && view.seq < this.view.seq) return;
    const firstTime = !this.view;
    this.view = view;
    this.on.view(view);
    const song = this.song();
    if (!song) { this.audio.pause(); return; }
    if (this.loadedKey !== song.key) {
      this.loadedKey = song.key;
      this.reportedKey = null;
      this.audio.src = streamOf(song);
      this.audio.preload = "auto";
      this.audio.load();
      this.report("loading", song.key);
    } else if (firstTime && this.audio.readyState >= 3) this.onCanPlay();
    this.keepTime();
  }

  /** Where the party says the song is now, in seconds (negative: it starts in that long). */
  private expected() {
    const v = this.view!;
    return v.playing ? v.position + (this.serverNow() - v.at) / 1000 : v.position;
  }

  private keepTime() {
    const v = this.view;
    if (!v || this.stopped || !this.song()) return;
    if (this.startTimer) { clearTimeout(this.startTimer); this.startTimer = null; }
    if (v.waiting || !v.playing) {
      if (!this.audio.paused) this.audio.pause();
      this.audio.playbackRate = 1;
      if (!v.waiting && this.audio.readyState >= 1 && Math.abs(this.audio.currentTime - v.position) > 0.5) this.audio.currentTime = v.position;
      return;
    }
    const want = this.expected();
    if (want < 0) {
      /* It starts a moment from now, for everyone at once. */
      if (!this.audio.paused) this.audio.pause();
      if (this.audio.readyState >= 1) this.audio.currentTime = v.position;
      this.startTimer = setTimeout(() => { void this.audio.play().catch(() => this.on.problem("Press play to hear the party.")); }, -want * 1000);
      return;
    }
    if (this.audio.readyState < 1) return;
    const fix = correction(this.audio.currentTime, want, this.correcting, 1);
    this.correcting = fix.correcting;
    if (fix.seek !== null) this.audio.currentTime = fix.seek;
    this.audio.playbackRate = fix.rate;
    if (this.audio.paused) void this.audio.play().catch(() => this.on.problem("Press play to hear the party."));
  }
}
