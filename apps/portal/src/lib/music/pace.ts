/*
 * 歩 What Music asks of YouTube in bulk, taken at a walk.
 *
 * Someone pressing play is never held up. But a phone downloading a
 * two-thousand-song playlist, or an import looking up the songs Deezer
 * doesn't have, would otherwise ask YouTube for everything back to back, and
 * YouTube answers a burst like that by turning the server away (for plays
 * too). So bulk asks take turns: songs one at a time, seconds apart with a
 * little randomness, a cap each hour; searches a second or two apart. When
 * YouTube pushes back anyway (429, "confirm you're not a bot"), bulk work
 * rests, a couple of minutes the first time and twice as long each time after,
 * up to two hours, and picks up again on its own. A song the server already
 * has costs YouTube nothing and never waits.
 */

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;

/** Turns spaced [gap] apart (give or take [jitter]), no more than [perHour] in any hour. */
export class Pacer {
  private next = 0;
  private times: number[] = [];
  constructor(readonly gap: number, readonly jitter: number, readonly perHour: number, private random: () => number = Math.random) {}

  /** When a turn asked for at [now] could start, without taking it. */
  when(now: number): number {
    this.times = this.times.filter((t) => t > now - HOUR);
    let at = Math.max(now, this.next);
    if (this.times.length >= this.perHour) at = Math.max(at, this.times[this.times.length - this.perHour] + HOUR);
    return at;
  }

  /** Takes the next turn: when it starts. The one after waits [gap] ± [jitter] past it. */
  take(now: number): number {
    const at = this.when(now);
    this.times.push(at);
    this.next = at + Math.max(0, this.gap + (this.random() * 2 - 1) * this.jitter);
    return at;
  }

  /** Puts the next turn off until at least [at]. */
  holdUntil(at: number) { this.next = Math.max(this.next, at); }
}

/* Words YouTube (or yt-dlp passing it on) uses for "too much, slow down". */
const pushback = /\b429\b|too many requests|rate.?limit|confirm you(?:'|’)?re not a bot|sign in to confirm|unusual traffic/i;
export const isPushback = (said: string) => pushback.test(said);

export class Pace {
  /** One song at a time from YouTube, about 8 s apart, at most 240 an hour. */
  readonly songs: Pacer;
  /** Looking songs up (an import's misses), about 1.5 s apart, at most 600 an hour. */
  readonly searches: Pacer;
  private coolUntil = 0;
  private rest = 2 * MINUTE;
  private flying = 0;
  private clock: () => number;

  constructor(clock: () => number = Date.now, random: () => number = Math.random) {
    this.clock = clock;
    this.songs = new Pacer(8_000, 4_000, 240, random);
    this.searches = new Pacer(1_500, 750, 600, random);
  }

  /** How long bulk work is resting after YouTube pushed back (0 when it isn't). */
  cooling(): number { return Math.max(0, this.coolUntil - this.clock()); }

  /** What YouTube said when something failed: if it's pushing back, bulk work rests. */
  heard(said: string) {
    if (!isPushback(said)) return;
    const now = this.clock();
    if (now < this.coolUntil) return;
    this.coolUntil = now + this.rest;
    console.warn(`music: YouTube pushed back (${said.slice(0, 120)}); bulk downloads rest ${Math.round(this.rest / MINUTE)} min`);
    this.rest = Math.min(this.rest * 2, 2 * HOUR);
  }

  /** A song came in from YouTube fine: the next pushback starts the rest short again. */
  fine() { if (this.clock() >= this.coolUntil) this.rest = 2 * MINUTE; }

  /** How long until a bulk song may be fetched from YouTube (0: now). */
  songWait(): number {
    const now = this.clock();
    if (this.flying > 0) return Math.max(this.cooling(), 3_000);
    return Math.max(this.cooling(), this.songs.when(now) - now);
  }

  /**
   * Takes a bulk song's turn when it's free: a release to call once it's in
   * (or it gave up), or null and how long to wait. Released by itself after
   * three minutes, so one that never ends can't hold the line.
   */
  claimSong(): { release: () => void } | { wait: number } {
    const wait = this.songWait();
    if (wait > 0) return { wait };
    this.songs.take(this.clock());
    this.flying++;
    let done = false;
    const release = () => {
      if (done) return;
      done = true;
      this.flying = Math.max(0, this.flying - 1);
      /* The gap counts from when it finished, so a slow song doesn't run into the next. */
      this.songs.holdUntil(this.clock() + this.songs.gap / 2);
    };
    setTimeout(release, 3 * MINUTE).unref?.();
    return { release };
  }

  /** Waits for a search's turn; false (at once) while YouTube's being rested. */
  async searchTurn(): Promise<boolean> {
    if (this.cooling() > 0) return false;
    const now = this.clock();
    const at = this.searches.take(now);
    if (at > now) await new Promise((r) => setTimeout(r, at - now));
    return this.cooling() === 0;
  }
}

const g = globalThis as unknown as { kimonoMusicPace?: Pace };
/** The server's one pace for YouTube, shared by every import and download. */
export const pace = () => (g.kimonoMusicPace ??= new Pace());
