"use client";

import { Crossing } from "@/components/crossing";
import { useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import { createPortal } from "react-dom";
import { cx, InkWave } from "@kimono/ui";
import { byline, clock, hrefOf, musicApi, type Lyrics } from "./api";
import { Asker } from "./ask";
import { Icon } from "./icons";
import { ArtistLinks, Bars, Cover, RateMarks } from "./parts";
import { usePlayer, usePosition } from "./player";

/*
 * What stays on screen while you browse: the bar along the bottom, and the
 * two things it opens: the song in full with its lyrics, and the queue. They
 * live on the body, beside the page rather than in it, so they hold still
 * while pages slide past.
 */
const never = () => () => {};
export function PlayerChrome() {
  /* Only in the browser: it's drawn on the body, which the server doesn't have. */
  const ready = useSyncExternalStore(never, () => true, () => false);
  if (!ready) return null;
  /* In the app's frame, which carries Music's colour, but beside the page that slides. */
  return createPortal(<><NowPlaying /><QueuePanel /><Bar /><Toast /><Asker /></>, document.querySelector(".app-frame") ?? document.body);
}

/* ── A slider: the song's place, and the volume ────────────────────────── */

function Slider({ value, max, onChange, onCommit, label, format, className }: {
  value: number; max: number; onChange?: (v: number) => void; onCommit: (v: number) => void; label: string; format?: (v: number) => string; className?: string;
}) {
  const track = useRef<HTMLDivElement>(null);
  const [drag, setDrag] = useState<number | null>(null);
  const shown = drag ?? value;
  const at = (x: number) => {
    const r = track.current!.getBoundingClientRect();
    return Math.max(0, Math.min(1, (x - r.left) / r.width)) * max;
  };
  return <div ref={track} className={cx("km-slider", drag !== null && "km-dragging", className)} role="slider" tabIndex={0}
    aria-label={label} aria-valuemin={0} aria-valuemax={Math.round(max)} aria-valuenow={Math.round(shown)} aria-valuetext={format?.(shown)}
    style={{ "--km-fill": `${max ? (shown / max) * 100 : 0}%` } as React.CSSProperties}
    onPointerDown={(e) => { if (!max) return; e.currentTarget.setPointerCapture(e.pointerId); const v = at(e.clientX); setDrag(v); onChange?.(v); }}
    onPointerMove={(e) => { if (drag === null) return; const v = at(e.clientX); setDrag(v); onChange?.(v); }}
    onPointerUp={(e) => { if (drag === null) return; const v = at(e.clientX); setDrag(null); onCommit(v); }}
    onPointerCancel={() => setDrag(null)}
    onKeyDown={(e) => {
      const step = max > 2 ? 5 : 0.05;
      if (e.key === "ArrowRight" || e.key === "ArrowUp") { e.preventDefault(); e.stopPropagation(); onCommit(Math.min(max, value + step)); }
      if (e.key === "ArrowLeft" || e.key === "ArrowDown") { e.preventDefault(); e.stopPropagation(); onCommit(Math.max(0, value - step)); }
    }}>
    <span className="km-slider-rail"><span className="km-slider-fill" /></span>
    <span className="km-slider-knob" />
  </div>;
}

/* ── The bar ───────────────────────────────────────────────────────────── */

function Bar() {
  const p = usePlayer();
  const { position, duration } = usePosition();
  const [scrub, setScrub] = useState<number | null>(null);
  const t = p.current;
  if (!t) return null;
  const arriving = p.arriving;
  const arrivingText = arriving?.stage === "finding" ? "Finding the song" : "Getting it ready";
  return <div className={cx("km-bar", p.nowPlaying && "km-bar-open", arriving && "km-bar-arriving")} role="region" aria-label="Player">
    <div className="km-bar-song">
      <button type="button" className="km-bar-art" aria-label={p.nowPlaying ? "Close the song" : "Open the song"} onClick={() => p.setNowPlaying(!p.nowPlaying)}>
        <Cover src={t.album?.cover} size={52} />
        <Icon name={p.nowPlaying ? "collapse" : "expand"} className="km-bar-art-mark" />
      </button>
      <div className="km-bar-name">
        <button type="button" className="km-bar-title" onClick={() => p.setNowPlaying(!p.nowPlaying)}>{t.title}</button>
        <span className="km-bar-by">{arriving ? <span className="km-arriving-short">{arrivingText}…</span> : null}<span className="km-bar-artists"><ArtistLinks artists={t.artists} /></span></span>
      </div>
      <span className="km-bar-rate"><RateMarks kind="track" keyOf={t.key} /></span>
    </div>

    <div className="km-bar-middle">
      <div className="km-transport">
        <button type="button" className={cx("km-iconbtn km-small", p.shuffle && "km-on")} aria-pressed={p.shuffle} aria-label="Shuffle" title="Shuffle" onClick={() => p.setShuffle(!p.shuffle)}><Icon name="shuffle" /></button>
        <button type="button" className="km-iconbtn" aria-label="Previous" title="Previous" onClick={p.prev}><Icon name="prev" /></button>
        <button type="button" className={cx("km-playbtn", p.waiting && "km-waiting")} aria-label={p.playing ? "Pause" : "Play"} onClick={p.toggle}>
          <Icon name={p.playing ? "pause" : "play"} />
        </button>
        <button type="button" className="km-iconbtn" aria-label="Next" title="Next" onClick={p.next}><Icon name="next" /></button>
        <button type="button" className={cx("km-iconbtn km-small", p.repeat !== "off" && "km-on")} aria-label={p.repeat === "one" ? "Repeating this song" : p.repeat === "all" ? "Repeating the queue" : "Repeat"} title="Repeat" onClick={p.cycleRepeat}>
          <Icon name={p.repeat === "one" ? "repeatOne" : "repeat"} />
        </button>
      </div>
      {arriving
        /* The first time anyone plays a song, the server fetches it: the wave fills as it comes in. */
        ? <div className="km-seek km-arriving" role="status">
          <span className="km-arriving-label">{arrivingText}</span>
          <InkWave value={arriving.stage === "fetching" && arriving.fraction > 0 ? arriving.fraction : undefined} label={arrivingText} className="km-arriving-wave" />
        </div>
        : <div className="km-seek">
          <span className="km-time">{clock(scrub ?? position)}</span>
          <Slider label="Place in the song" value={position} max={duration} format={(v) => `${clock(v)} of ${clock(duration)}`} onChange={setScrub} onCommit={(v) => { setScrub(null); p.seek(v); }} />
          <span className="km-time">{clock(duration)}</span>
        </div>}
    </div>

    <div className="km-bar-end">
      <button type="button" className={cx("km-iconbtn km-small", p.nowPlaying && "km-on")} aria-pressed={p.nowPlaying} aria-label="Lyrics" title="Lyrics" onClick={() => p.setNowPlaying(!p.nowPlaying)}><Icon name="lyrics" /></button>
      <button type="button" className={cx("km-iconbtn km-small", p.panel === "queue" && "km-on")} aria-pressed={p.panel === "queue"} aria-label="Queue" title="Queue" onClick={() => p.setPanel(p.panel === "queue" ? null : "queue")}><Icon name="queue" /></button>
      <span className="km-volume">
        <button type="button" className="km-iconbtn km-small" aria-label={p.muted ? "Unmute" : "Mute"} title={p.muted ? "Unmute" : "Mute"} onClick={() => p.setMuted(!p.muted)}><Icon name={p.muted || p.volume === 0 ? "muted" : "volume"} /></button>
        <Slider label="Volume" value={p.muted ? 0 : p.volume} max={1} format={(v) => `${Math.round(v * 100)}%`} onChange={p.setVolume} onCommit={p.setVolume} className="km-volume-slider" />
      </span>
    </div>
    {/* On a phone the bar is one line, with the song's place drawn along its top. */}
    <span className={cx("km-bar-line", arriving && "km-bar-line-arriving")} style={{ width: `${arriving ? (arriving.stage === "fetching" ? Math.max(4, arriving.fraction * 100) : 4) : duration ? (position / duration) * 100 : 0}%` }} />
  </div>;
}

/* ── The song in full, with its lyrics ─────────────────────────────────── */

function NowPlaying() {
  const p = usePlayer();
  const t = p.current;
  const open = p.nowPlaying && Boolean(t);
  /* Kept drawn a moment after closing, so it can slide away. */
  const [shown, setShown] = useState(open);
  if (open && !shown) setShown(true);
  useEffect(() => { if (open) return; const timer = setTimeout(() => setShown(false), 220); return () => clearTimeout(timer); }, [open]);
  if (!shown || !t) return null;
  return <section className={cx("km-np", open ? "km-np-in" : "km-np-out")} aria-label="Now playing">
    <button type="button" className="km-iconbtn km-np-close" aria-label="Close" onClick={() => p.setNowPlaying(false)}><Icon name="collapse" /></button>
    <div className="km-np-song">
      <Cover src={t.album?.cover} quality="full" className="km-np-art" alt={t.album?.title ?? ""} />
      <div className="km-np-name">
        <h2 className="km-np-title">{t.title}</h2>
        <p className="km-np-by"><ArtistLinks artists={t.artists} />{t.album ? <> · <Crossing kind="kakejiku" href={hrefOf.album(t.album.key)} onClick={() => p.setNowPlaying(false)}>{t.album.title}</Crossing></> : null}</p>
        <RateMarks kind="track" keyOf={t.key} />
      </div>
    </div>
    <LyricsView key={t.key} trackKey={t.key} />
  </section>;
}

function LyricsView({ trackKey }: { trackKey: string }) {
  const p = usePlayer();
  const [lyrics, setLyrics] = useState<Lyrics | null | undefined>(undefined);
  useEffect(() => {
    let live = true;
    musicApi.lyrics(trackKey).then((r) => { if (live) setLyrics(r.lyrics); }).catch(() => { if (live) setLyrics(null); });
    return () => { live = false; };
  }, [trackKey]);
  const lines = lyrics?.synced ?? null;
  const { position } = usePosition(Boolean(lines));
  const here = useMemo(() => {
    if (!lines) return -1;
    let i = -1;
    /* A touch early, so the line lights as it's sung rather than after. */
    for (let k = 0; k < lines.length; k++) { if (lines[k].at <= position + 0.25) i = k; else break; }
    return i;
  }, [lines, position]);
  const box = useRef<HTMLDivElement>(null);
  /* The sung line keeps to a third of the way down, unless you've scrolled to read ahead. */
  const reading = useRef(0);
  useEffect(() => {
    if (here < 0 || Date.now() - reading.current < 4000) return;
    const el = box.current?.querySelector<HTMLElement>(`[data-line="${here}"]`);
    if (el && box.current) box.current.scrollTo({ top: el.offsetTop - box.current.clientHeight / 3, behavior: "smooth" });
  }, [here]);

  if (lyrics === undefined) return <div className="km-lyrics km-lyrics-quiet" />;
  if (!lyrics || (!lines && !lyrics.plain)) return <div className="km-lyrics km-lyrics-quiet"><p>{lyrics?.instrumental ? "Instrumental" : "No lyrics for this song."}</p></div>;
  if (!lines) return <div className="km-lyrics km-lyrics-plain">{lyrics.plain!.split(/\n/).map((l, i) => <p key={i}>{l || " "}</p>)}</div>;
  return <div ref={box} className="km-lyrics" onWheel={() => { reading.current = Date.now(); }} onTouchMove={() => { reading.current = Date.now(); }}>
    {lines.map((l, i) => <button type="button" key={i} data-line={i} className={cx("km-line", i === here && "km-line-now", i < here && "km-line-past", !l.line && "km-line-gap")}
      onClick={() => { reading.current = 0; p.seek(l.at); if (!p.playing) p.toggle(); }}>
      {l.line || <Bars />}
    </button>)}
  </div>;
}

/* ── The queue ─────────────────────────────────────────────────────────── */

function QueuePanel() {
  const p = usePlayer();
  const [drag, setDrag] = useState<number | null>(null);
  const [over, setOver] = useState<number | null>(null);
  if (p.panel !== "queue") return null;
  const next = p.tracks.slice(p.index + 1).map((t, k) => ({ t, at: p.index + 1 + k }));
  return <aside className="km-queue" aria-label="Queue">
    <header>
      <h2 className="k-heading">Queue</h2>
      <button type="button" className="km-iconbtn" aria-label="Close the queue" onClick={() => p.setPanel(null)}><Icon name="close" /></button>
    </header>
    {p.current ? <>
      <h3 className="k-label km-queue-label">Now playing</h3>
      <div className="km-qrow km-now">
        <Cover src={p.current.album?.cover} size={44} />
        <span className="km-qrow-name"><span>{p.current.title}</span><span className="km-qrow-by">{byline(p.current)}</span></span>
        {p.playing ? <Bars /> : null}
      </div>
    </> : null}
    <h3 className="k-label km-queue-label">{p.source ? `Next from ${p.source.title}` : "Next"}</h3>
    {next.length ? <ol className="km-queue-list">
      {next.map(({ t, at }) => <li key={`${t.key}-${at}`} className={cx("km-qrow", drag === at && "km-dragging", over === at && drag !== null && drag !== at && "km-over")}
        draggable onDragStart={(e) => { setDrag(at); e.dataTransfer.effectAllowed = "move"; }}
        onDragOver={(e) => { e.preventDefault(); setOver(at); }}
        onDrop={(e) => { e.preventDefault(); if (drag !== null) p.move(drag, at); setDrag(null); setOver(null); }}
        onDragEnd={() => { setDrag(null); setOver(null); }}>
        <Icon name="drag" className="km-qrow-grip" />
        <button type="button" className="km-qrow-main" onClick={() => p.jump(at)} aria-label={`Play ${t.title}`}>
          <Cover src={t.album?.cover} size={44} />
          <span className="km-qrow-name"><span>{t.title}</span><span className="km-qrow-by">{byline(t)}</span></span>
        </button>
        <button type="button" className="km-iconbtn km-small" aria-label={`Take ${t.title} out of the queue`} onClick={() => p.remove(at)}><Icon name="close" /></button>
      </li>)}
    </ol> : <p className="km-queue-empty">When this ends, songs like it play on.</p>}
  </aside>;
}

function Toast() {
  const p = usePlayer();
  return <div className={cx("km-toast", p.toast && "km-on")} role="status" aria-live="polite">{p.toast?.text}</div>;
}
