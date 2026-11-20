"use client";

import { useCallback, useEffect, useId, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { AppLockup, InkBlot, InkCard, Joint, MorphLoader, Seal, blotPath, inkBrushD, inkFilters, inkRandom, ringPath, type AppIdentity, type InkPoint } from "@kimono/ui";
import { useTabTitle } from "@/components/tab-title";
import { build, clock, detail, nextSummary, remaining, rows, stateOf, title, type Mine, type Place, type Prayer, type TitleMode, type View } from "./schedule";

/*
 * 礼 Kimono Times on the web: the sky of the day painted in ink and wash,
 * with the sun (or tonight's moon) where it is over the mosque, today's
 * prayers lit the way the menu bar app lights them, and the night's midnight,
 * last third and sunrise. Your place is the same on every device: changing it
 * here changes it on the phone and its widgets.
 */

type Prefs = { mode: TitleMode; iqama: boolean; hour12: boolean };
const defaults: Prefs = { mode: "next", iqama: true, hour12: false };
const readPrefs = (): Prefs => { try { return { ...defaults, ...JSON.parse(localStorage.getItem("kimono-prayer") ?? "{}") }; } catch { return defaults; } };
const savePrefs = (p: Prefs) => { try { localStorage.setItem("kimono-prayer", JSON.stringify(p)); } catch { /* private window */ } };

const cx = (...c: (string | false | null | undefined)[]) => c.filter(Boolean).join(" ");
const kindLabel = { mawaqit: "Mawaqit", masjidbox: "MasjidBox", calculated: "Calculated" } as const;

async function call<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`/api/v1/prayer${path}`, { ...init, headers: { "content-type": "application/json", ...init?.headers }, cache: "no-store" });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error((body as { error?: string }).error ?? "Times couldn't answer.");
  return body as T;
}

/* A clock that ticks at each minute's turn, so countdowns change when the minute does. */
function useMinute() {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout>;
    const tick = () => { setNow(Date.now()); timer = setTimeout(tick, 60_000 - (Date.now() % 60_000) + 50); };
    timer = setTimeout(tick, 60_000 - (Date.now() % 60_000) + 50);
    const wake = () => { if (document.visibilityState === "visible") setNow(Date.now()); };
    document.addEventListener("visibilitychange", wake);
    return () => { clearTimeout(timer); document.removeEventListener("visibilitychange", wake); };
  }, []);
  return now;
}

export function PrayerApp({ app, mine: arrived, canSearch }: { app: AppIdentity; mine: Mine | null; canSearch: boolean }) {
  const [mine, setMine] = useState<Mine | null>(arrived);
  const [problem, setProblem] = useState<string | null>(arrived?.problem ?? null);
  const [open, setOpen] = useState<"place" | "settings" | null>(null);
  const [prefs, setPrefs] = useState<Prefs>(readPrefs);
  const now = useMinute();

  const change = (p: Partial<Prefs>) => setPrefs((old) => { const next = { ...old, ...p }; savePrefs(next); return next; });

  const load = useCallback(() => call<Mine>("").then((m) => { setMine(m); setProblem(m.problem ?? null); }).catch((e: Error) => setProblem(e.message)), []);
  useEffect(() => { if (!arrived) void load(); }, [arrived, load]);
  /* Past midnight the timetable must reach a new tomorrow: ask again every few hours, and when the tab comes back. */
  useEffect(() => {
    const again = setInterval(load, 3 * 60 * 60_000);
    const back = () => { if (document.visibilityState === "visible" && mine?.timetable && Date.now() - mine.timetable.fetchedAt > 3 * 60 * 60_000) void load(); };
    document.addEventListener("visibilitychange", back);
    return () => { clearInterval(again); document.removeEventListener("visibilitychange", back); };
  }, [load, mine?.timetable]);

  const view = mine?.timetable ? build(mine.timetable, now) : null;
  const line = view ? title(view, prefs.mode) : "";
  useTabTitle(line, "Times");

  const chosen = (m: Mine) => { setMine(m); setProblem(m.problem ?? null); setOpen(null); };
  const close = useCallback(() => setOpen(null), []);
  const later = view ? nextSummary(view) : "";

  return <div className="kp" style={{ ["--k-app-accent" as string]: app.accent }}>
    <header className="kp-top">
      <AppLockup identity={app} />
      <button type="button" className="kp-round" aria-label="Settings" onClick={() => setOpen("settings")}><Line d={glyphs.settings} /></button>
    </header>

    {!mine ? <div className="kp-empty"><MorphLoader tone="plain" label="Loading" /></div>
      : !mine.place ? <Welcome accent={app.accent} onPick={() => setOpen("place")} />
      : !view ? <div className="kp-empty"><p>{problem ?? "Today's times aren't in yet."}</p><div className="kp-link"><Seal onClick={() => void load()}>Try again</Seal><Seal tone="quiet" onClick={() => setOpen("place")}>Change mosque</Seal></div></div>
      : <main className="kp-main">
        <Sky view={view} place={mine.place} mode={prefs.mode} hour12={prefs.hour12} onPlace={() => setOpen("place")} />
        <div className="kp-side">
          <section className="kp-card" aria-label="Today's prayers">
            <ol className="kp-rows">{rows(view).map((p) => <Row key={p.id} p={p} view={view} accent={app.accent} iqama={prefs.iqama} hour12={prefs.hour12} />)}</ol>
            {view.isFriday && view.jumua.length ? <div className="kp-row kp-jumua">
              <InkBlot seed="jumua" tint={app.accent} className="kp-blot"><Line d={glyphs.dome} /></InkBlot>
              <span className="kp-name">Jumu&apos;a</span>
              <span className="kp-jumua-times">{view.jumua.map((t) => <span key={t} className="kp-time">{fmt(t, prefs.hour12)}</span>)}</span>
            </div> : null}
            {later ? <p className="kp-later">{prefs.hour12 ? twelve(later) : later}</p> : null}
          </section>
          <Night view={view} hour12={prefs.hour12} />
          {problem ? <p className="kp-note">{problem}</p> : null}
        </div>
      </main>}

    {open === "place" && mine ? <Picker mine={mine} canSearch={canSearch} accent={app.accent} onClose={close} onChosen={chosen} /> : null}
    {open === "settings" ? <Settings prefs={prefs} change={change} accent={app.accent} onClose={close} /> : null}
  </div>;
}

const fmt = (hhmm: string, hour12: boolean) => {
  if (!hour12) return hhmm;
  const [h, m] = hhmm.split(":").map(Number);
  return `${((h + 11) % 12) + 1}:${String(m).padStart(2, "0")} ${h < 12 ? "AM" : "PM"}`;
};
/* The day's sentences come in 24-hour time; with the 12-hour clock on, their times are said that way too. */
const twelve = (words: string) => words.replace(/\b\d\d:\d\d\b/g, (t) => fmt(t, true));

function seedOf(text: string) {
  let hash = 2166136261;
  for (let i = 0; i < text.length; i++) { hash ^= text.charCodeAt(i); hash = Math.imul(hash, 16777619); }
  return hash >>> 0;
}

/* The size of a box on the page, so a drawing can be made in real pixels. */
function useBox<T extends HTMLElement>() {
  const ref = useRef<T>(null);
  const [box, setBox] = useState<{ w: number; h: number } | null>(null);
  useLayoutEffect(() => {
    const el = ref.current; if (!el) return;
    const watch = new ResizeObserver(() => setBox((old) => { const w = Math.round(el.clientWidth), h = Math.round(el.clientHeight); return old && old.w === w && old.h === h ? old : { w, h }; }));
    watch.observe(el);
    return () => watch.disconnect();
  }, []);
  return [ref, box] as const;
}

/* ───── line icons ───── */

const glyphs = {
  Fajr: "M4 18h16M7 18a5 5 0 0 1 10 0M12 9V6M5.6 11.6l1.6 1.6M18.4 11.6l-1.6 1.6M9.5 4.5 12 2l2.5 2.5",
  Dhuhr: "M12 7a5 5 0 1 0 0 10 5 5 0 0 0 0-10ZM12 2v2M12 20v2M4.2 4.2l1.4 1.4M18.4 18.4l1.4 1.4M2 12h2M20 12h2M4.2 19.8l1.4-1.4M18.4 5.6l1.4-1.4",
  Asr: "M12 9a4 4 0 1 0 0 8 4 4 0 0 0 0-8ZM12 4v2M5.6 6.6 7 8M18.4 6.6 17 8M3 13h2M19 13h2M5 21h14",
  Maghrib: "M4 18h16M7 18a5 5 0 0 1 10 0M12 2v5M9.5 4.5 12 7l2.5-2.5M5.6 11.6l1.6 1.6M18.4 11.6l-1.6 1.6",
  Isha: "M15 4a8 8 0 1 0 5 13 6.5 6.5 0 1 1-5-13ZM19 3v3M17.5 4.5h3",
  midnight: "M15 4a8 8 0 1 0 5 13 6.5 6.5 0 1 1-5-13Z",
  lastThird: "M12 3a9 9 0 1 0 9 9M12 3v9l7.8 4.5M17 3v3M15.5 4.5h3M20.5 7v2M19.5 8h2",
  sunrise: "M3 18h18M7 18a5 5 0 0 1 10 0M12 10V7M5.6 12.6 7 14M18.4 12.6 17 14M5 21h14",
  dome: "M4 20h16M6 20v-6h12v6M8 14c-1.2-4 2-6 4-9 2 3 5.2 5 4 9M12 5V3",
  pin: "M12 21s-6-5.6-6-11a6 6 0 0 1 12 0c0 5.4-6 11-6 11ZM12 12.2a2.2 2.2 0 1 0 0-4.4 2.2 2.2 0 0 0 0 4.4Z",
  search: "M11 17.5a6.5 6.5 0 1 0 0-13 6.5 6.5 0 0 0 0 13ZM16 16l4.5 4.5",
  settings: "M4 7h9M17 7h3M4 12h3M11 12h9M4 17h7M15 17h5M15 5v4M9 10v4M13 15v4",
  close: "M6 6l12 12M18 6 6 18",
  check: "m5 12.5 4.5 4.5L19 7.5",
} as const;
const Line = ({ d }: { d: string }) => <svg className="kp-line" viewBox="0 0 24 24" aria-hidden><path d={d} /></svg>;

/* ───── the sky ───── */

type SkyPhase = "night" | "dawn" | "day" | "gold" | "dusk";
function skyPhase(view: View): SkyPhase {
  const [fajr, sunrise, , asr, maghrib, isha] = view.today;
  const now = view.now;
  return now < fajr.start ? "night" : now < sunrise.start ? "dawn" : now < asr.start ? "day" : now < maghrib.start ? "gold" : now < isha.start ? "dusk" : "night";
}

/* The Islamic date turns over at Maghrib, not at midnight. */
function hijri(view: View) {
  try {
    const at = view.now >= view.today[4].start ? view.now + 86_400_000 : view.now;
    return new Intl.DateTimeFormat("en-GB-u-ca-islamic-umalqura", { timeZone: view.timezone, day: "numeric", month: "long", year: "numeric" }).format(new Date(at)).replace(/\s*(AH|BH)$/, "");
  } catch { return ""; }
}

function Sky({ view, place, mode, hour12, onPlace }: { view: View; place: Place; mode: TitleMode; hour12: boolean; onPlace: () => void }) {
  const [ref, box] = useBox<HTMLDivElement>();
  const line = title(view, mode);
  const open = view.current;
  /* Under the title, the other half of the story: what's open now, or with "time left", what comes next. */
  const under = mode === "left" && open?.end ? title(view, "next") : open?.end ? `${open.name} · until ${clock(open.end, view.timezone, hour12)}` : "";
  const islamic = hijri(view);
  return <section className={cx("kp-sky", `kp-${skyPhase(view)}`)} aria-label={line}>
    <div className="kp-hero">
      <button type="button" className="kp-place" onClick={onPlace}><span>{place.name}</span><Line d="m7 10 5 5 5-5" /></button>
      <p className="kp-date">
        <span>{new Intl.DateTimeFormat("en-GB", { timeZone: view.timezone, weekday: "long", day: "numeric", month: "long" }).format(new Date(view.now))}</span>
        {islamic ? <span>{islamic}</span> : null}
      </p>
      <h1 className="kp-title">{line}</h1>
      {under ? <p className="kp-now">{under}</p> : null}
    </div>
    <div ref={ref} className="kp-scene">{box && box.w > 0 && box.h > 0 ? <Scene view={view} hour12={hour12} w={box.w} h={box.h} /> : null}</div>
  </section>;
}

/* Where things sit in a scene of this size: the horizon, and the arc the sun or the moon rides over it. */
function geometry(w: number, h: number, daytime: boolean) {
  const pad = w < 480 ? 30 : 52, base = h - (w < 480 ? 50 : 60);
  const lift = Math.max(64, Math.min(base - 50, (w - 2 * pad) * .5)) * (daytime ? 1 : .88);
  const arc = (f: number): InkPoint => [pad + f * (w - 2 * pad), base - Math.sin(f * Math.PI) * lift];
  return { pad, base, lift, arc };
}

const n1 = (v: number) => v.toFixed(1);
const ENSO = ringPath(inkRandom(3), 21, .7);
const MOSQUE = "M-52 3V-24H-34V-30H-27C-36-52-12-60 0-76C12-60 36-52 27-30H34V-24H46V-57H43V-62H46V-96L51-110L56-96V-62H59V-57H56V3Z";

/* Tonight's moon: how far through its month it is, as the lit shape of a disc of radius r (waxing, lit on the right). */
function moonOf(now: number, r: number) {
  const age = ((((now - Date.UTC(2000, 0, 6, 18, 14)) / 86_400_000 / 29.530588853) % 1) + 1) % 1;
  const k = Math.min(.8, Math.cos(2 * Math.PI * age));
  return { waning: age > .5, d: `M0 ${-r}A${r} ${r} 0 0 1 0 ${r}A${n1(Math.abs(k) * r)} ${r} 0 0 ${k > 0 ? 0 : 1} 0 ${-r}Z` };
}

/*
 * The day as an arc from sunrise to Maghrib, the night as a lower arc from
 * Maghrib to sunrise: the sun rides the first, the moon the second, each
 * prayer is a mark on the path, and the brush has gone as far as the day has.
 * Move over the sky to read the time anywhere along it.
 */
function Scene({ view, hour12, w, h }: { view: View; hour12: boolean; w: number; h: number }) {
  const uid = useId().replaceAll(":", "");
  const [hover, setHover] = useState<number | null>(null);
  const t = view.today, m = view.milestones;
  const [, sunrise, , , maghrib] = t;
  const daytime = view.now >= sunrise.start && view.now < maghrib.start;
  const phase = skyPhase(view);
  const { pad, base, arc } = geometry(w, h, daytime);
  /* By day the sun's arc runs sunrise to Maghrib; by night the moon's runs Maghrib to sunrise. */
  const [from, to] = daytime ? [sunrise.start, maghrib.start] : [m.maghrib, m.sunrise];
  const along = (when: number) => Math.min(1, Math.max(0, (when - from) / (to - from)));
  const f = along(view.now);
  const [bx, by] = arc(f);

  /* What doesn't move with the minute: the path, the land, the stars and the clouds. */
  const art = useMemo(() => {
    const g = geometry(w, h, daytime);
    const line = Array.from({ length: 121 }, (_, i) => g.arc(i / 120));
    let length = 0;
    for (let i = 1; i < line.length; i++) length += Math.hypot(line[i][0] - line[i - 1][0], line[i][1] - line[i - 1][1]);
    const random = inkRandom(daytime ? 41 : 97), between = (a: number, b: number) => a + random() * (b - a);
    const roll = (count: number, low: number, high: number) => Array.from({ length: count + 1 }, (_, i): InkPoint => [-24 + (w + 48) * i / count, g.base - between(low, high)]);
    const land = (points: InkPoint[]) => {
      let d = `M${n1(points[0][0])} ${h + 24}L${n1(points[0][0])} ${n1(points[0][1])}`;
      for (let i = 1; i < points.length - 1; i++) d += `Q${n1(points[i][0])} ${n1(points[i][1])} ${n1((points[i][0] + points[i + 1][0]) / 2)} ${n1((points[i][1] + points[i + 1][1]) / 2)}`;
      const last = points[points.length - 1];
      return `${d}L${n1(last[0])} ${n1(last[1])}L${n1(last[0])} ${h + 24}Z`;
    };
    const far = roll(Math.max(4, Math.round(w / 120)), 8, Math.min(40, g.base * .14)), near = roll(Math.max(5, Math.round(w / 100)), -3, 3);
    const stars = Array.from({ length: Math.round(w / 11) }, () => ({ x: between(0, w), y: between(6, g.base - 20), r: between(.5, 1.5), o: between(.25, .9), twinkle: random() < .22, delay: between(0, 5) }));
    const clouds = [.16, .5, .86].map((x) => ({ x: w * (x + between(-.05, .05)), y: between(14, Math.max(24, g.base * .34)), s: between(.8, 1.35), d: blotPath(random, 0, 0, 20) }));
    return {
      length, line, stars, clouds,
      dots: line.map(([x, y], i) => `${i ? "L" : "M"}${n1(x)} ${n1(y)}`).join(""),
      far: land(far), near: land(near),
      ridge: inkBrushD(near, inkRandom(5), 2.2, { lift: [140, 260], gap: [6, 12] }),
    };
  }, [w, h, daytime]);

  /* The brush has come this far along the path; it presses and lifts in the same places all day. */
  const reached = art.line.slice(0, Math.floor(f * 120) + 1).concat([[bx, by]]);
  const lit = reached.length > 1 ? inkBrushD(reached, inkRandom(7), w < 480 ? 2.6 : 3, { extent: art.length, lift: [130, 220], gap: [5, 9], swell: .26, wander: .14 }) : "";

  const marks: { key: string; label: string; when: number; on: boolean }[] = daytime
    ? t.filter((p) => p.name === "Dhuhr" || p.name === "Asr").map((p) => ({ key: p.id, label: p.name, when: p.start, on: stateOf(p, view) === "current" }))
    : [
      { key: "isha", label: "Isha", when: m.isha, on: view.now >= m.isha && view.now < m.midnight },
      { key: "midnight", label: "Midnight", when: m.midnight, on: m.phase === "lastThird" },
      { key: "third", label: "Last third", when: m.lastThird, on: view.now >= m.lastThird && view.now < m.fajr },
      { key: "fajr", label: "Fajr", when: m.fajr, on: view.now >= m.fajr && view.now < m.sunrise },
    ];
  const moon = moonOf(view.now, 14);
  const small = w < 480, scale = small ? .62 : Math.min(1.2, Math.max(.8, h / 420));
  /* Where the sun has just gone down, or is about to come up, the horizon glows. */
  const glow = phase === "dusk" ? pad : phase === "dawn" || phase === "gold" ? w - pad : null;
  const wash = `url(#ink-wash-${uid})`, fine = `url(#ink-fine-${uid})`;
  const point = (e: React.PointerEvent<SVGSVGElement>) => setHover(Math.min(1, Math.max(0, (e.clientX - e.currentTarget.getBoundingClientRect().left - pad) / (w - 2 * pad))));

  return <svg className="kp-art" width={w} height={h} viewBox={`0 0 ${w} ${h}`} aria-hidden onPointerMove={point} onPointerDown={point} onPointerLeave={() => setHover(null)} onPointerCancel={() => setHover(null)}>
    <defs dangerouslySetInnerHTML={{ __html: inkFilters(uid, 9)
      + `<radialGradient id="sun-${uid}" cx="42%" cy="40%" r="70%"><stop offset="0" stop-color="#fbe6a2"></stop><stop offset=".6" stop-color="#eeb04a"></stop><stop offset="1" stop-color="#d98328"></stop></radialGradient>`
      + `<radialGradient id="glow-${uid}"><stop offset="0" stop-color="#f2a65e" stop-opacity=".62"></stop><stop offset=".55" stop-color="#d9788a" stop-opacity=".2"></stop><stop offset="1" stop-color="#d9788a" stop-opacity="0"></stop></radialGradient>` }} />
    {daytime
      ? <g className="kp-clouds">{art.clouds.map((c, i) => <path key={i} d={c.d} transform={`translate(${n1(c.x)} ${n1(c.y)}) scale(${n1(c.s * 2.8)} ${n1(c.s * .8)})`} filter={wash} />)}</g>
      : <g className="kp-stars">{art.stars.map((s, i) => <circle key={i} cx={n1(s.x)} cy={n1(s.y)} r={n1(s.r)} opacity={n1(s.o)} className={s.twinkle ? "kp-twinkle" : undefined} style={s.twinkle ? { animationDelay: `${n1(s.delay)}s` } : undefined} />)}</g>}
    {glow !== null ? <ellipse cx={glow} cy={base} rx={w * .36} ry={(base - 40) * .5} fill={`url(#glow-${uid})`} className="kp-glow" /> : null}
    <path d={art.far} className="kp-far" filter={wash} />
    <path d={art.dots} className="kp-path" />
    <path d={lit} className="kp-lit" filter={fine} />
    {marks.map(({ key, label, when, on }, i) => { const [x, y] = arc(along(when)); const below = !daytime && i % 2 === 1; return <g key={key} className={cx("kp-mark", on && "kp-mark-on")}>
      <circle cx={x} cy={y} r={on ? 6 : 5} /><text x={x} y={below ? y + 24 : y - 14} textAnchor="middle">{label}</text>
    </g>; })}
    {daytime
      ? <g className="kp-sun" transform={`translate(${n1(bx)} ${n1(by)})`}>
        <circle r={34} className="kp-halo" />
        <circle r={15} fill={`url(#sun-${uid})`} filter={wash} />
        <path d={ENSO} transform="translate(-50 -50)" className="kp-enso" filter={fine} />
      </g>
      : <g className="kp-moon" transform={`translate(${n1(bx)} ${n1(by)})`}>
        <circle r={30} className="kp-halo" />
        <circle r={14} className="kp-moon-dark" />
        <path d={moon.d} transform={moon.waning ? "scale(-1 1)" : undefined} className="kp-moon-lit" filter={fine} />
      </g>}
    <path d={art.near} className="kp-near" filter={wash} />
    <path d={art.ridge} className="kp-ridge" />
    <g className="kp-mosque" transform={`translate(${n1(w * .66)} ${base + 2}) scale(${n1(scale)})`}>
      <path d={MOSQUE} filter={fine} />
      <path d="M0-76V-89M-3-92a4 4 0 1 0 6 0 3 3 0 1 1-6 0Z" className="kp-finial" />
      <path d="M-5 3V-9C-5-17 5-17 5-9V3ZM-21-6v-6c0-5 6-5 6 0v6ZM15-6v-6c0-5 6-5 6 0v6ZM49-70v-5c0-3 4-3 4 0v5Z" className="kp-lamp" />
    </g>
    <text x={pad} y={base + (small ? 28 : 34)} textAnchor="start" className="kp-edge">{daytime ? "Sunrise" : "Maghrib"} <tspan>{clock(from, view.timezone, hour12)}</tspan></text>
    <text x={w - pad} y={base + (small ? 28 : 34)} textAnchor="end" className="kp-edge">{daytime ? "Maghrib" : "Sunrise"} <tspan>{clock(to, view.timezone, hour12)}</tspan></text>
    {hover !== null ? (() => { const [x, y] = arc(hover); return <g className="kp-scrub">
      <path d={`M${n1(x)} ${n1(y + 6)}V${base}`} />
      <circle cx={x} cy={y} r={4.5} />
      <text x={Math.min(w - 34, Math.max(34, x))} y={Math.max(18, y - 14)} textAnchor="middle">{clock(from + hover * (to - from), view.timezone, hour12)}</text>
    </g>; })() : null}
  </svg>;
}

/* ───── rows ───── */

/* Each prayer's puddle takes the colour of its sky. */
const tints: Record<string, string> = { Fajr: "#7d74b3", Dhuhr: "#d9a441", Asr: "#dd8a45", Maghrib: "#b8506b" };

function Row({ p, view, accent, iqama, hour12 }: { p: Prayer; view: View; accent: string; iqama: boolean; hour12: boolean }) {
  const state = stateOf(p, view);
  const words = hour12 ? twelve(detail(p, view)) : detail(p, view);
  const inside = <>
    <InkBlot seed={p.name} tint={tints[p.name] ?? accent} className="kp-blot"><Line d={glyphs[p.name as keyof typeof glyphs]} /></InkBlot>
    <div className="kp-row-text">
      <span className="kp-name">{p.name}</span>
      {words ? <span className={state === "next" ? "kp-plate" : "kp-sub"}>{words}</span> : null}
    </div>
    <div className="kp-row-times">
      <span className="kp-time">{fmt(p.time, hour12)}</span>
      {iqama && p.iqama ? <span className="kp-iqama">Iqama {fmt(p.iqama, hour12)}</span> : null}
    </div>
  </>;
  return <li aria-current={state === "current" ? "time" : undefined}>
    {state === "current" ? <InkCard colour="currentColor" seed={p.id} className="kp-row kp-current">{inside}</InkCard> : <div className={cx("kp-row", `kp-${state}`)}>{inside}</div>}
  </li>;
}

function Night({ view, hour12 }: { view: View; hour12: boolean }) {
  const m = view.milestones;
  const items: [string, number, "midnight" | "lastThird" | "sunrise"][] = [["Islamic midnight", m.midnight, "midnight"], ["Last third", m.lastThird, "lastThird"], ["Sunrise", m.sunrise, "sunrise"]];
  return <section className="kp-nights" aria-label="Night and sunrise">
    <h2 className="kp-h">Night &amp; sunrise</h2>
    <ul>{items.map(([label, at, phase]) => {
      const on = m.phase === phase;
      return <li key={phase} className={cx("kp-tile", on && "kp-on")}>
        <Line d={glyphs[phase]} />
        <span className="kp-tile-name">{label}</span>
        <span className="kp-time">{clock(at, view.timezone, hour12)}</span>
        {on ? <span className="kp-plate">in {remaining(at, view.now)}</span>
          : m.active && at <= view.now ? <span className="kp-sub">Passed</span> : null}
      </li>;
    })}</ul>
  </section>;
}

/* ───── sheets ───── */

/*
 * Kimono's dialog, as the phone draws it: a sheet of paper with a wash of the
 * app's colour bled in from its top corner, the subject's mark in its own
 * puddle, and a Mincho title.
 */
function Sheet({ title: name, glyph, accent, onClose, children }: { title: string; glyph: string; accent: string; onClose: () => void; children: ReactNode }) {
  const uid = useId().replaceAll(":", "");
  const panel = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!panel.current?.contains(document.activeElement)) panel.current?.focus();
    const key = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", key);
    return () => window.removeEventListener("keydown", key);
  }, [onClose]);
  const bleed = useMemo(() => blotPath(inkRandom(seedOf(`sheet:${name}`)), 4, 2, 31), [name]);
  return <div className="kp-scrim" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
    <div ref={panel} className="kp-sheet" role="dialog" aria-modal="true" aria-label={name} tabIndex={-1}>
      <svg className="kp-bleed" viewBox="0 0 100 100" aria-hidden dangerouslySetInnerHTML={{ __html: `<defs>${inkFilters(uid, 13)}<radialGradient id="bleed-${uid}" gradientUnits="userSpaceOnUse" cx="0" cy="-2" r="34"><stop offset="0" class="kp-bleed-0"></stop><stop offset=".55" class="kp-bleed-1"></stop><stop offset=".9" class="kp-bleed-2"></stop><stop offset="1" class="kp-bleed-3"></stop></radialGradient></defs><path d="${bleed}" fill="url(#bleed-${uid})" filter="url(#ink-wash-${uid})"></path>` }} />
      <div className="kp-sheet-body">
        <header className="kp-sheet-top">
          <InkBlot seed={`sheet:${name}`} tint={accent}><Line d={glyph} /></InkBlot>
          <h2>{name}</h2>
          <button type="button" className="kp-round" aria-label="Close" onClick={onClose}><Line d={glyphs.close} /></button>
        </header>
        {children}
      </div>
    </div>
  </div>;
}

function Settings({ prefs, change, accent, onClose }: { prefs: Prefs; change: (p: Partial<Prefs>) => void; accent: string; onClose: () => void }) {
  const [link, setLink] = useState<{ link: string; connect: string } | null>(null);
  const [copied, setCopied] = useState(false);
  return <Sheet title="Settings" glyph={glyphs.settings} accent={accent} onClose={onClose}>
    <div className="kp-set">
      <span className="kp-set-name">Title shows</span>
      <div className="kp-pick" role="radiogroup" aria-label="Title shows">
        {([["next", "Next prayer"], ["left", "Time left"]] as const).map(([v, label]) => <button key={v} type="button" role="radio" aria-checked={prefs.mode === v} onClick={() => change({ mode: v })}>{label}</button>)}
      </div>
    </div>
    <div className="kp-set"><Joint profile="aikaki" label="Iqama times" checked={prefs.iqama} onChange={(iqama) => change({ iqama })} /></div>
    <div className="kp-set"><Joint profile="aikaki" label="12-hour clock" checked={prefs.hour12} onChange={(hour12) => change({ hour12 })} /></div>
    <div className="kp-set kp-menubar">
      <span className="kp-set-name">Menu bar app</span>
      {link ? <div className="kp-link">
        <Seal compact onClick={() => { window.location.href = link.connect; }}>Open in the app</Seal>
        <Seal compact tone="quiet" onClick={() => { void navigator.clipboard.writeText(link.link).then(() => setCopied(true)); }}>{copied ? "Copied" : "Copy link"}</Seal>
        <Seal compact tone="quiet" onClick={() => { if (confirm("Make a new link? The old one stops working.")) void call<{ link: string; connect: string }>("/link", { method: "POST" }).then((l) => { setLink(l); setCopied(false); }); }}>New link</Seal>
      </div> : <Seal compact tone="quiet" onClick={() => void call<{ link: string; connect: string }>("/link").then(setLink)}>Connect</Seal>}
    </div>
  </Sheet>;
}

/* ───── choosing a place ───── */

function Picker({ mine, canSearch, accent, onClose, onChosen }: { mine: Mine; canSearch: boolean; accent: string; onClose: () => void; onChosen: (m: Mine) => void }) {
  const [q, setQ] = useState("");
  const [found, setFound] = useState<Place[] | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [problem, setProblem] = useState<string | null>(null);

  const tz = Intl.DateTimeFormat().resolvedOptions().timeZone;
  const look = (params: string) => {
    setBusy("search"); setProblem(null);
    call<{ places: Place[] }>(`/search?${params}`).then((r) => setFound(r.places)).catch((e: Error) => setProblem(e.message)).finally(() => setBusy(null));
  };
  const submit = (e: React.FormEvent) => { e.preventDefault(); if (q.trim()) look(`q=${encodeURIComponent(q.trim())}&tz=${encodeURIComponent(tz)}`); };
  const here = () => {
    if (!navigator.geolocation) { setProblem("This browser can't tell where you are."); return; }
    setBusy("here"); setProblem(null);
    navigator.geolocation.getCurrentPosition(
      (pos) => look(`lat=${pos.coords.latitude.toFixed(4)}&lon=${pos.coords.longitude.toFixed(4)}&tz=${encodeURIComponent(tz)}`),
      () => { setBusy(null); setProblem("Location is off for this site."); },
      { maximumAge: 10 * 60_000, timeout: 15_000 },
    );
  };
  const pick = (p: Place) => {
    setBusy(p.id); setProblem(null);
    call<Mine>("", { method: "PUT", body: JSON.stringify({ id: p.id }) }).then(onChosen).catch((e: Error) => { setProblem(e.message); setBusy(null); });
  };

  const list = found ?? mine.recent;
  return <Sheet title="Your mosque" glyph={glyphs.dome} accent={accent} onClose={onClose}>
    <div className="kp-find">
      <form className="kp-search" onSubmit={submit}>
        <Line d={glyphs.search} />
        <input autoFocus value={q} onChange={(e) => setQ(e.target.value)} placeholder={canSearch ? "Mosque, city or link" : "Mawaqit or MasjidBox link"} aria-label="Search" enterKeyHint="search" />
        {busy === "search" ? <MorphLoader tone="plain" label="Searching" /> : null}
      </form>
      <Seal tone="quiet" busy={busy === "here"} disabled={busy !== null && busy !== "here"} onClick={here}>Near me</Seal>
    </div>
    {problem ? <p className="kp-note">{problem}</p> : null}
    {found && !found.length ? <p className="kp-note">Nothing found.</p> : null}
    {list.length ? <>
      {!found ? <h3 className="kp-h">Recent</h3> : null}
      <ul className="kp-results">{list.map((p) => { const on = mine.place?.id === p.id; return <li key={p.id}>
        <button type="button" className={cx("kp-result", on && "kp-on")} onClick={() => pick(p)} disabled={busy !== null}>
          <InkBlot seed={p.id} tint={p.kind === "calculated" ? "#d9a441" : accent} className="kp-blot"><Line d={p.kind === "calculated" ? glyphs.pin : glyphs.dome} /></InkBlot>
          <span className="kp-result-text"><b>{p.name}</b><small>{[p.detail, kindLabel[p.kind]].filter(Boolean).join(" · ")}</small></span>
          {busy === p.id ? <MorphLoader tone="plain" label="Choosing" /> : on ? <Line d={glyphs.check} /> : null}
        </button>
      </li>; })}</ul>
    </> : null}
  </Sheet>;
}

function Welcome({ accent, onPick }: { accent: string; onPick: () => void }) {
  return <div className="kp-welcome">
    <InkBlot seed="welcome" tint={accent} className="kp-welcome-mark"><Line d={glyphs.dome} /></InkBlot>
    <h1>Your mosque&apos;s prayer times</h1>
    <Seal onClick={onPick}>Choose a mosque</Seal>
  </div>;
}
