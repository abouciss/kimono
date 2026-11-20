"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { AppLockup, MorphLoader, type AppIdentity } from "@kimono/ui";
import { useTabTitle } from "@/components/tab-title";
import { build, clock, detail, nextSummary, remaining, rows, stateOf, title, type Mine, type Place, type Prayer, type TitleMode, type View } from "./schedule";

/*
 * 礼 Kimono Prayer on the web: the sky of the day with the sun (or the moon)
 * where it is, today's prayers lit the way the menu bar app lights them, and
 * the night's midnight, last third and sunrise. Your place is the same on
 * every device: changing it here changes it on the phone and its widgets.
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
  if (!res.ok) throw new Error((body as { error?: string }).error ?? "Prayer couldn't answer.");
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
  const [picking, setPicking] = useState(false);
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
  useTabTitle(line, "Prayer");

  const chosen = (m: Mine) => { setMine(m); setProblem(m.problem ?? null); setPicking(false); };

  return <div className="kp" style={{ ["--k-app-accent" as string]: app.accent }}>
    <header className="kp-top">
      <AppLockup identity={app} />
      {mine?.place ? <button type="button" className="kp-place" onClick={() => setPicking(true)}>
        <span className="kp-place-name">{mine.place.name}</span>
        <span className="kp-place-kind">{kindLabel[mine.place.kind]}</span>
        <Chevron />
      </button> : null}
    </header>

    {!mine ? <div className="kp-empty"><MorphLoader tone="plain" label="Loading" /></div>
      : !mine.place ? <Welcome onPick={() => setPicking(true)} />
      : !view ? <div className="kp-empty"><p>{problem ?? "Today's times aren't in yet."}</p><button className="kp-btn kp-tonal" onClick={() => void load()}>Try again</button></div>
      : <main className="kp-main">
        <Sky view={view} line={line} hour12={prefs.hour12} />
        {nextSummary(view) ? <p className="kp-summary">{nextSummary(view)}</p> : null}
        <section className="kp-card" aria-label="Today's prayers">
          <ol className="kp-rows">{rows(view).map((p) => <Row key={p.id} p={p} view={view} iqama={prefs.iqama} hour12={prefs.hour12} />)}</ol>
          {view.isFriday && view.jumua.length ? <p className="kp-jumua"><span>Jumu&apos;a</span>{view.jumua.map((t) => <b key={t}>{fmt(t, prefs.hour12)}</b>)}</p> : null}
        </section>
        <Night view={view} hour12={prefs.hour12} />
        {problem ? <p className="kp-note">{problem}</p> : null}
        <Settings prefs={prefs} change={change} />
      </main>}

    {picking && mine ? <Picker mine={mine} canSearch={canSearch} onClose={() => setPicking(false)} onChosen={chosen} /> : null}
  </div>;
}

const fmt = (hhmm: string, hour12: boolean) => {
  if (!hour12) return hhmm;
  const [h, m] = hhmm.split(":").map(Number);
  return `${((h + 11) % 12) + 1}:${String(m).padStart(2, "0")} ${h < 12 ? "AM" : "PM"}`;
};

/* ───── the sky ───── */

/*
 * The day as an arc from sunrise to Maghrib, the night as a lower arc from
 * Maghrib to Fajr: the sun rides the first, the moon the second, and each
 * prayer is a mark on the path.
 */
function Sky({ view, line, hour12 }: { view: View; line: string; hour12: boolean }) {
  const t = view.today;
  const [, sunrise, , , maghrib] = t;
  const m = view.milestones;
  const daytime = view.now >= sunrise.start && view.now < maghrib.start;
  const W = 640, H = 220, base = 168;
  const along = (from: number, to: number, at: number) => Math.min(1, Math.max(0, (at - from) / (to - from)));
  const arc = (f: number, lift: number) => ({ x: 40 + f * (W - 80), y: base - Math.sin(f * Math.PI) * lift });
  /* By day the sun's arc runs sunrise to Maghrib; by night the moon's runs Maghrib to sunrise. */
  const [from, to, lift] = daytime ? [sunrise.start, maghrib.start, 132] : [m.maghrib, m.sunrise, 112];
  const at = (when: number) => arc(along(from, to, when), lift);
  const body = at(view.now);
  const path = Array.from({ length: 49 }, (_, i) => { const p = arc(i / 48, lift); return `${i ? "L" : "M"}${p.x.toFixed(1)} ${p.y.toFixed(1)}`; }).join(" ");
  const marks: { key: string; label: string; when: number; on: boolean }[] = daytime
    ? t.filter((p) => p.name === "Dhuhr" || p.name === "Asr").map((p) => ({ key: p.id, label: p.name, when: p.start, on: stateOf(p, view) === "current" }))
    : [
      { key: "isha", label: "Isha", when: m.isha, on: view.now >= m.isha && view.now < m.midnight },
      { key: "midnight", label: "Midnight", when: m.midnight, on: m.phase === "lastThird" },
      { key: "third", label: "Last third", when: m.lastThird, on: view.now >= m.lastThird && view.now < m.fajr },
      { key: "fajr", label: "Fajr", when: m.fajr, on: view.now >= m.fajr && view.now < m.sunrise },
    ];
  return <section className={cx("kp-sky", daytime ? "kp-day" : "kp-night")} aria-label={line}>
    <div className="kp-hero">
      <p className="kp-date">{new Intl.DateTimeFormat("en-GB", { timeZone: view.timezone, weekday: "long", day: "numeric", month: "long" }).format(new Date(view.now))}</p>
      <h1 className="kp-title">{line}</h1>
      {view.current ? <p className="kp-now">{view.current.name} · until {clock(view.current.end!, view.timezone, hour12)}</p> : null}
    </div>
    <svg className="kp-arc" viewBox={`0 0 ${W} ${H}`} aria-hidden>
      <path d={path} className="kp-path-day" />
      <path d={`M40 ${base} L${W - 40} ${base}`} className="kp-horizon" />
      <path d={path} className="kp-path-lit" pathLength={1000} style={{ strokeDasharray: 1000, strokeDashoffset: 1000 * (1 - along(from, to, view.now)) }} />
      {marks.map(({ key, label, when, on }, i) => { const p = at(when); const below = !daytime && i % 2 === 1; return <g key={key} className={cx("kp-mark", on && "kp-mark-on")}>
        <circle cx={p.x} cy={p.y} r={5} /><text x={p.x} y={below ? p.y + 22 : p.y - 14} textAnchor="middle">{label}</text>
      </g>; })}
      <text x={40} y={base + 26} textAnchor="start" className="kp-edge">{clock(from, view.timezone, hour12)}</text>
      <text x={W - 40} y={base + 26} textAnchor="end" className="kp-edge">{clock(to, view.timezone, hour12)}</text>
      {daytime
        ? <g className="kp-sun" transform={`translate(${body.x} ${body.y})`}><circle r={22} className="kp-glow" /><circle r={11} /></g>
        : <g className="kp-moon" transform={`translate(${body.x} ${body.y})`}><circle r={20} className="kp-glow" /><path d="M4 -11 A12 12 0 1 0 10 7 A9.5 9.5 0 1 1 4 -11 Z" /></g>}
    </svg>
  </section>;
}

/* ───── rows ───── */

const icons: Record<string, string> = {
  Fajr: "M15 4a8 8 0 1 0 5 13 6.5 6.5 0 1 1-5-13Z",
  Dhuhr: "M12 7a5 5 0 1 0 0 10 5 5 0 0 0 0-10ZM12 2v2M12 20v2M4.2 4.2l1.4 1.4M18.4 18.4l1.4 1.4M2 12h2M20 12h2M4.2 19.8l1.4-1.4M18.4 5.6l1.4-1.4",
  Asr: "M12 9a4 4 0 1 0 0 8M12 9a4 4 0 0 1 4 4M3 17h18M5 20h14M12 4v2M5.6 7.6l1.4 1.4M18.4 7.6 17 9",
  Maghrib: "M7 17a5 5 0 0 1 10 0M3 17h18M5 20h14M12 8V4M9.5 6.5 12 4l2.5 2.5",
  Isha: "M15 4a8 8 0 1 0 5 13 6.5 6.5 0 1 1-5-13ZM19 3v3M17.5 4.5h3",
};

function Row({ p, view, iqama, hour12 }: { p: Prayer; view: View; iqama: boolean; hour12: boolean }) {
  const state = stateOf(p, view);
  const words = detail(p, view);
  return <li className={cx("kp-row", `kp-${state}`)} aria-current={state === "current" ? "time" : undefined}>
    <svg className="kp-icon" viewBox="0 0 24 24" aria-hidden><path d={icons[p.name]} /></svg>
    <div className="kp-row-text">
      <span className="kp-name">{p.name}</span>
      {state === "current" ? <span className="kp-sub">{words}</span> : null}
    </div>
    {state === "next" ? <span className="kp-chip">{words}</span> : state !== "current" ? <span className="kp-detail">{words}</span> : null}
    {iqama && p.iqama ? <span className="kp-iqama" title="Iqama">{fmt(p.iqama, hour12)}</span> : null}
    <span className="kp-time">{fmt(p.time, hour12)}</span>
  </li>;
}

function Night({ view, hour12 }: { view: View; hour12: boolean }) {
  const m = view.milestones;
  const items: [string, number, "midnight" | "lastThird" | "sunrise"][] = [["Islamic midnight", m.midnight, "midnight"], ["Last third", m.lastThird, "lastThird"], ["Sunrise", m.sunrise, "sunrise"]];
  return <section className="kp-card kp-night-card" aria-label="Night and sunrise">
    <h2>Night &amp; sunrise</h2>
    <ul>{items.map(([label, at, phase]) => {
      const on = m.phase === phase;
      return <li key={phase} className={cx(on && "kp-on")}>
        <span>{label}</span>
        {on ? <span className="kp-in">in {remaining(at, view.now)}</span>
          : m.active && at <= view.now ? <span className="kp-passed">Passed</span> : null}
        <span className="kp-time">{clock(at, view.timezone, hour12)}</span>
      </li>;
    })}</ul>
  </section>;
}

/* ───── settings ───── */

function Settings({ prefs, change }: { prefs: Prefs; change: (p: Partial<Prefs>) => void }) {
  const [link, setLink] = useState<{ link: string; connect: string } | null>(null);
  const [copied, setCopied] = useState(false);
  return <section className="kp-card kp-settings" aria-label="Settings">
    <div className="kp-set">
      <span>Title</span>
      <div className="kp-seg" role="radiogroup" aria-label="Title">
        {([["next", "Next prayer"], ["left", "Time left"]] as const).map(([v, label]) => <button key={v} role="radio" aria-checked={prefs.mode === v} className={cx(prefs.mode === v && "kp-on")} onClick={() => change({ mode: v })}>{label}</button>)}
      </div>
    </div>
    <label className="kp-set"><span>Iqama times</span><input type="checkbox" className="kp-switch" checked={prefs.iqama} onChange={(e) => change({ iqama: e.target.checked })} /></label>
    <label className="kp-set"><span>12-hour clock</span><input type="checkbox" className="kp-switch" checked={prefs.hour12} onChange={(e) => change({ hour12: e.target.checked })} /></label>
    <div className="kp-set kp-menubar">
      <span>Menu bar</span>
      {link ? <div className="kp-link">
        <button className="kp-btn kp-filled" onClick={() => { window.location.href = link.connect; }}>Open in the app</button>
        <button className="kp-btn kp-tonal" onClick={() => { void navigator.clipboard.writeText(link.link).then(() => setCopied(true)); }}>{copied ? "Copied" : "Copy link"}</button>
        <button className="kp-btn kp-text" onClick={() => { if (confirm("Make a new link? The old one stops working.")) void call<{ link: string; connect: string }>("/link", { method: "POST" }).then(setLink); }}>New link</button>
      </div> : <button className="kp-btn kp-tonal" onClick={() => void call<{ link: string; connect: string }>("/link").then(setLink)}>Connect</button>}
    </div>
  </section>;
}

/* ───── choosing a place ───── */

function Picker({ mine, canSearch, onClose, onChosen }: { mine: Mine; canSearch: boolean; onClose: () => void; onChosen: (m: Mine) => void }) {
  const [q, setQ] = useState("");
  const [found, setFound] = useState<Place[] | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  const field = useRef<HTMLInputElement>(null);
  const sheet = useRef<HTMLDivElement>(null);
  useEffect(() => {
    field.current?.focus();
    const key = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", key);
    return () => window.removeEventListener("keydown", key);
  }, [onClose]);

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
  return <div className="kp-scrim" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
    <div ref={sheet} className="kp-sheet" role="dialog" aria-modal="true" aria-label="Your mosque">
      <form className="kp-search" onSubmit={submit}>
        <svg viewBox="0 0 24 24" aria-hidden><circle cx="11" cy="11" r="6.5" /><path d="m16 16 4.5 4.5" /></svg>
        <input ref={field} value={q} onChange={(e) => setQ(e.target.value)} placeholder={canSearch ? "Mosque, city, or a Mawaqit or MasjidBox link" : "A Mawaqit or MasjidBox link"} aria-label="Search" />
        {busy === "search" ? <MorphLoader tone="plain" label="Searching" /> : null}
      </form>
      <button className="kp-here" onClick={here} disabled={busy !== null}>
        <svg viewBox="0 0 24 24" aria-hidden><path d="M12 21s-6-5.6-6-11a6 6 0 0 1 12 0c0 5.4-6 11-6 11Z" /><circle cx="12" cy="10" r="2.2" /></svg>
        {busy === "here" ? "Finding you…" : "Near me"}
      </button>
      {problem ? <p className="kp-note">{problem}</p> : null}
      {found && !found.length ? <p className="kp-note">Nothing found.</p> : null}
      {list.length ? <>
        {!found ? <h2 className="kp-sheet-h">Recent</h2> : null}
        <ul className="kp-results">{list.map((p) => <li key={p.id}>
          <button className={cx("kp-result", mine.place?.id === p.id && "kp-on")} onClick={() => pick(p)} disabled={busy !== null}>
            <span className="kp-result-text"><b>{p.name}</b>{p.detail ? <small>{p.detail}</small> : null}</span>
            <span className="kp-result-kind">{busy === p.id ? <MorphLoader tone="plain" label="Choosing" /> : kindLabel[p.kind]}</span>
          </button>
        </li>)}</ul>
      </> : null}
    </div>
  </div>;
}

function Welcome({ onPick }: { onPick: () => void }) {
  return <div className="kp-welcome">
    <svg viewBox="0 0 100 100" aria-hidden className="kp-welcome-mark"><path d="M57 35 A16 16 0 1 0 64 60 A13 13 0 1 1 57 35 Z" /><path d="M62 44 V50 M59 47 H65" /></svg>
    <h1>Your mosque&apos;s prayer times</h1>
    <button className="kp-btn kp-filled" onClick={onPick}>Choose a mosque</button>
  </div>;
}

const Chevron = () => <svg viewBox="0 0 24 24" aria-hidden className="kp-chev"><path d="m7 10 5 5 5-5" /></svg>;
