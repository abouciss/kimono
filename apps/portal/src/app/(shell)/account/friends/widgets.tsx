"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { InkPortraitFrame, Seal } from "@kimono/ui";
import { Crossing } from "@/components/crossing";
import { InkSheet } from "@/components/ink-sheet";
import { LineIcon, type LineIconName } from "@/components/line-icon";
import { Portrait } from "@/components/portrait";
import { Book3D } from "../../books/book3d";

/*
 * 庭 A profile's home screen: widgets someone arranges and sizes as they
 * like (small, wide, large, the full row), drawn from what they do in
 * Kimono: the record on the turntable, the book on the go, their favourite
 * song, a note, their time of day. What friends can't see (Who sees what)
 * never reaches a widget: the server leaves it out of the profile.
 */

export type WidgetKind = "listening" | "song" | "album" | "reading" | "watching" | "artists" | "stats" | "note" | "status" | "clock" | "links" | "friends";
export type WidgetSize = "s" | "m" | "l" | "xl";
export type Widget = { id: string; kind: WidgetKind; size: WidgetSize; config?: Record<string, string> };

type Person = { username: string; name: string; picture: string | null };
type Item = { app: string; itemId: string; title: string; subtitle: string | null; cover: string | null; href?: string | null; progress?: number | null; at?: number | null };
type Section = { app: string; kind: string; title: string; items: Item[] };
type Track = { key: string; title: string; artists: { key: string; name: string }[]; album: { key: string; title: string; cover: string | null } | null };
export type MusicExtras = { listening: { track: Track; at: string; live: boolean } | null; plays: number; minutes: number; artists: { key: string; name: string; picture: string | null }[] } | null;

export type BoardData = {
  person: Person;
  sections: Section[];
  links: { title: string; url: string }[];
  friends: Person[];
  music: MusicExtras;
  color: string;
};

const kinds: { kind: WidgetKind; name: string; says: string; icon: LineIconName; sizes: WidgetSize[]; size: WidgetSize }[] = [
  { kind: "listening", name: "Now playing", says: "Your record on the turntable, spinning while you listen", icon: "music", sizes: ["s", "m", "l", "xl"], size: "l" },
  { kind: "song", name: "Favourite song", says: "One song to sum you up", icon: "music", sizes: ["s", "m", "l"], size: "m" },
  { kind: "album", name: "Favourite album", says: "The record you'd take to an island", icon: "archive", sizes: ["s", "m", "l"], size: "l" },
  { kind: "reading", name: "Reading", says: "The book you're in, and how far", icon: "book", sizes: ["s", "m", "l"], size: "m" },
  { kind: "watching", name: "Watching", says: "What's on, and how far", icon: "film", sizes: ["s", "m", "l"], size: "m" },
  { kind: "artists", name: "Top artists", says: "Who you've played most this month", icon: "people", sizes: ["m", "l", "xl"], size: "m" },
  { kind: "stats", name: "Your month", says: "Songs, hours and books", icon: "clock", sizes: ["s", "m"], size: "s" },
  { kind: "note", name: "A note", says: "A few words, on paper", icon: "brush", sizes: ["s", "m", "l"], size: "s" },
  { kind: "status", name: "Status", says: "How you are, in an emoji and a few words", icon: "bell", sizes: ["s", "m"], size: "s" },
  { kind: "clock", name: "Your time", says: "What time it is where you are", icon: "clock", sizes: ["s", "m"], size: "s" },
  { kind: "links", name: "Links", says: "Your links, at hand", icon: "link", sizes: ["m", "l", "xl"], size: "m" },
  { kind: "friends", name: "Friends", says: "Your friends' faces", icon: "people", sizes: ["m", "l"], size: "m" },
];
const kindOf = (k: WidgetKind) => kinds.find((x) => x.kind === k)!;
const sizeName: Record<WidgetSize, string> = { s: "Small", m: "Wide", l: "Large", xl: "Full" };

let made = 0;
const newId = () => `w${Date.now().toString(36)}${(made++).toString(36)}`;

/** A home screen for someone who hasn't arranged one: what they have, at sensible sizes. */
export function defaultWidgets(d: BoardData): Widget[] {
  const has = (app: string, kind: string) => d.sections.some((s) => s.app === app && s.kind === kind && s.items.length);
  const out: Widget[] = [];
  if (d.music?.listening) out.push({ id: "d-listening", kind: "listening", size: "l" });
  if (has("books", "reading")) out.push({ id: "d-reading", kind: "reading", size: "m" });
  if (has("watch", "watching")) out.push({ id: "d-watching", kind: "watching", size: "m" });
  if (d.music?.artists.length) out.push({ id: "d-artists", kind: "artists", size: "m" });
  if (d.links.length) out.push({ id: "d-links", kind: "links", size: d.links.length > 2 ? "l" : "m" });
  if (d.music?.plays) out.push({ id: "d-stats", kind: "stats", size: "s" });
  out.push({ id: "d-clock", kind: "clock", size: "s" });
  return out;
}

/* ── The board ─────────────────────────────────────────────────────────── */

export function WidgetBoard({ data, widgets, editable, onSave }: { data: BoardData; widgets: Widget[] | null; editable: boolean; onSave: (w: Widget[]) => Promise<void> }) {
  const shown = useMemo(() => widgets ?? defaultWidgets(data), [widgets, data]);
  const [arranging, setArranging] = useState(false);
  const [draft, setDraft] = useState<Widget[]>(shown);
  const [adding, setAdding] = useState(false);
  const [dragging, setDragging] = useState<string | null>(null);
  const list = arranging ? draft : shown;

  const start = () => { setDraft(shown); setArranging(true); };
  const done = async () => { await onSave(draft); setArranging(false); };
  const resize = (id: string, size: WidgetSize) => setDraft((ws) => ws.map((w) => (w.id === id ? { ...w, size } : w)));
  const drop = (id: string) => setDraft((ws) => ws.filter((w) => w.id !== id));
  const moveTo = (from: string, to: string) => setDraft((ws) => {
    const a = ws.findIndex((w) => w.id === from), b = ws.findIndex((w) => w.id === to);
    if (a < 0 || b < 0 || a === b) return ws;
    const out = [...ws]; const [w] = out.splice(a, 1); out.splice(b, 0, w); return out;
  });

  if (!list.length && !editable) return null;
  return <section className={`wg${arranging ? " is-arranging" : ""}`} aria-label="Home screen">
    {editable ? <div className="wg-tools">
      {arranging ? <>
        <Seal tone="quiet" compact onClick={() => setAdding(true)}><LineIcon name="plus" />Add widget</Seal>
        <Seal compact onClick={() => void done()}>Done</Seal>
      </> : <Seal tone="quiet" compact onClick={start}><LineIcon name="pin" />Arrange</Seal>}
    </div> : null}
    <div className="wg-grid">
      {list.map((w) => <div key={w.id} className={`wg-cell wg-${w.size} wg-k-${w.kind}${dragging === w.id ? " is-dragging" : ""}`}
        draggable={arranging} onDragStart={(e) => { setDragging(w.id); e.dataTransfer.effectAllowed = "move"; }}
        onDragOver={(e) => { if (arranging && dragging) { e.preventDefault(); moveTo(dragging, w.id); } }}
        onDragEnd={() => setDragging(null)}>
        <WidgetView w={w} d={data} />
        {arranging ? <div className="wg-edit">
          <button type="button" className="wg-x" aria-label={`Remove ${kindOf(w.kind).name}`} onClick={() => drop(w.id)}><LineIcon name="close" /></button>
          <span className="wg-sizes" role="group" aria-label="Size">
            {kindOf(w.kind).sizes.map((s) => <button key={s} type="button" aria-pressed={w.size === s} title={sizeName[s]} onClick={() => resize(w.id, s)}><i className={`wg-size-glyph wg-glyph-${s}`} /></button>)}
          </span>
        </div> : null}
      </div>)}
      {arranging ? <button type="button" className="wg-cell wg-s wg-add" onClick={() => setAdding(true)}><LineIcon name="plus" /><span>Add widget</span></button> : null}
      {!list.length && editable && !arranging ? <button type="button" className="wg-cell wg-m wg-add" onClick={() => { start(); setAdding(true); }}><LineIcon name="plus" /><span>Make this yours: add widgets</span></button> : null}
    </div>
    {adding ? <Gallery onClose={() => setAdding(false)} onPick={(w) => { setDraft((ws) => [...ws, w].slice(0, 16)); setAdding(false); if (!arranging) setArranging(true); }} /> : null}
  </section>;
}

/* ── Each widget ───────────────────────────────────────────────────────── */

const first = (name: string) => name.split(/\s+/)[0];
const itemOf = (d: BoardData, app: string, kind: string) => d.sections.find((s) => s.app === app && s.kind === kind)?.items[0] ?? null;
const songHref = (key: string) => `/music/song/${key.replace(/^dz:/, "")}`;
const albumHref = (key: string) => `/music/album/${key.replace(/^dz:/, "")}`;

function ago(iso: string) {
  const s = (Date.now() - Date.parse(iso)) / 1000;
  if (s < 3600) return `${Math.max(1, Math.round(s / 60))} min ago`;
  if (s < 86400) return `${Math.round(s / 3600)} hr ago`;
  if (s < 2 * 86400) return "yesterday";
  return `${Math.round(s / 86400)} days ago`;
}

function Empty({ icon, text }: { icon: LineIconName; text: string }) {
  return <div className="wg-empty"><LineIcon name={icon} /><span>{text}</span></div>;
}

function WidgetView({ w, d }: { w: Widget; d: BoardData }) {
  switch (w.kind) {
    case "listening": return <Turntable w={w} d={d} />;
    case "song": case "album": return <Favourite w={w} />;
    case "reading": return <Reading w={w} d={d} />;
    case "watching": return <Watching w={w} d={d} />;
    case "artists": return <Artists w={w} d={d} />;
    case "stats": return <Stats w={w} d={d} />;
    case "note": return <Note w={w} />;
    case "status": return <Status w={w} />;
    case "clock": return <Clock w={w} d={d} />;
    case "links": return <Links w={w} d={d} />;
    case "friends": return <Friends w={w} d={d} />;
  }
}

/** The record: a vinyl with the album for its label, spinning under the arm while they listen. */
function Turntable({ w, d }: { w: Widget; d: BoardData }) {
  const l = d.music?.listening;
  if (!l) return <div className="wg-card wg-turntable"><Deck cover={null} live={false} /><Empty icon="music" text="Nothing played yet" /></div>;
  const by = l.track.artists.map((a) => a.name).join(", ");
  return <Crossing kind="kakejiku" href={songHref(l.track.key)} className={`wg-card wg-turntable${l.live ? " is-live" : ""}`}>
    <Deck cover={l.track.album?.cover ?? null} live={l.live} />
    {w.size !== "s" ? <span className="wg-words">
      <small className="wg-kicker">{l.live ? <><i className="wg-live" />Listening now</> : `Last listened · ${ago(l.at)}`}</small>
      <b>{l.track.title}</b><em>{by}</em>
      {w.size === "xl" && l.track.album ? <em className="wg-album">{l.track.album.title}</em> : null}
    </span> : null}
  </Crossing>;
}

function Deck({ cover, live }: { cover: string | null; live: boolean }) {
  return <span className={`wg-deck${live ? " is-live" : ""}`} aria-hidden="true">
    <span className="wg-platter">
      <span className="wg-disc">
        <span className="wg-grooves" />
        {/* eslint-disable-next-line @next/next/no-img-element -- the album's own cover, as the record's label */}
        <span className="wg-label">{cover ? <img src={cover.replace(/\/(\d{2,4})x\1-/, "/250x250-")} alt="" /> : null}</span>
        <span className="wg-spindle" />
      </span>
    </span>
    <span className="wg-arm"><span className="wg-arm-head" /></span>
  </span>;
}

function Favourite({ w }: { w: Widget }) {
  const c = w.config ?? {};
  const album = w.kind === "album";
  return <Crossing kind="kakejiku" href={album ? albumHref(c.key) : songHref(c.key)} className={`wg-card wg-fav${album ? " wg-sleeve" : ""}`}>
    <span className="wg-fav-art">
      {album ? <span className="wg-fav-disc" aria-hidden="true" /> : null}
      {/* eslint-disable-next-line @next/next/no-img-element -- the cover from Music */}
      {c.cover ? <img src={c.cover} alt="" /> : <LineIcon name="music" />}
    </span>
    {w.size !== "s" ? <span className="wg-words"><small className="wg-kicker">{album ? "Favourite album" : "Favourite song"}</small><b>{c.title}</b><em>{c.subtitle}</em></span> : null}
  </Crossing>;
}

function Reading({ w, d }: { w: Widget; d: BoardData }) {
  const b = itemOf(d, "books", "reading");
  if (!b) return <div className="wg-card"><Empty icon="book" text="Not reading anything right now" /></div>;
  const author = b.subtitle?.split(" · ")[0]?.trim();
  return <Crossing kind="kakejiku" href={b.href ?? "/books"} className="wg-card wg-reading">
    <span className="wg-book"><Book3D book={{ key: b.itemId, title: b.title, authors: author ? [author] : [], cover: b.cover, pages: null }} /></span>
    {w.size !== "s" ? <span className="wg-words"><small className="wg-kicker">Reading</small><b>{b.title}</b>{author ? <em>{author}</em> : null}
      {b.progress ? <span className="wg-progress"><span className="wg-bar"><i style={{ width: `${b.progress * 100}%` }} /></span><small>{Math.round(b.progress * 100)}%</small></span> : null}</span> : null}
  </Crossing>;
}

function Watching({ w, d }: { w: Widget; d: BoardData }) {
  const t = itemOf(d, "watch", "watching");
  if (!t) return <div className="wg-card"><Empty icon="film" text="Not watching anything right now" /></div>;
  return <Crossing kind="kakejiku" href={t.href ?? `/watch?t=${encodeURIComponent(t.itemId)}`} className="wg-card wg-watching">
    {/* eslint-disable-next-line @next/next/no-img-element -- the poster from Watch */}
    {t.cover ? <img className="wg-poster" src={t.cover} alt="" /> : null}
    <span className="wg-watch-shade" />
    <span className="wg-words wg-on-image"><small className="wg-kicker">Watching</small><b>{t.title}</b>{t.subtitle && w.size !== "s" ? <em>{t.subtitle}</em> : null}
      {t.progress ? <span className="wg-progress"><span className="wg-bar"><i style={{ width: `${t.progress * 100}%` }} /></span></span> : null}</span>
  </Crossing>;
}

function Artists({ w, d }: { w: Widget; d: BoardData }) {
  const list = d.music?.artists ?? [];
  if (!list.length) return <div className="wg-card"><Empty icon="people" text="Top artists show up after some listening" /></div>;
  const n = w.size === "m" ? 3 : 6;
  return <div className="wg-card wg-artists">
    <small className="wg-kicker">Top artists</small>
    <span className="wg-artist-row">{list.slice(0, n).map((a, i) => <Crossing key={a.key} kind="kakejiku" href={`/music/artist/${a.key.replace(/^dz:/, "")}`} className="wg-artist" title={a.name}>
      <span className="wg-artist-face">
        {/* eslint-disable-next-line @next/next/no-img-element -- the artist's picture from Music */}
        {a.picture ? <img src={a.picture.replace(/\/(\d{2,4})x\1-/, "/250x250-")} alt="" /> : <b>{a.name.slice(0, 1)}</b>}
        <i>{i + 1}</i>
      </span>
      <small>{a.name}</small>
    </Crossing>)}</span>
  </div>;
}

function Stats({ w, d }: { w: Widget; d: BoardData }) {
  const year = new Date().getFullYear();
  const read = d.sections.find((s) => s.app === "books" && s.kind === "read")?.items.filter((i) => i.at && new Date(i.at).getFullYear() === year).length ?? 0;
  const hours = Math.round((d.music?.minutes ?? 0) / 6) / 10;
  const facts = [
    d.music?.plays ? { n: String(d.music.plays), unit: d.music.plays === 1 ? "song" : "songs" } : null,
    hours ? { n: hours >= 10 ? String(Math.round(hours)) : String(hours), unit: hours === 1 ? "hour" : "hours" } : null,
    read ? { n: String(read), unit: read === 1 ? `book in ${year}` : `books in ${year}` } : null,
  ].filter(Boolean) as { n: string; unit: string }[];
  if (!facts.length) return <div className="wg-card"><Empty icon="clock" text="A quiet month so far" /></div>;
  return <div className="wg-card wg-stats">
    <small className="wg-kicker">This month</small>
    <span className="wg-facts">{facts.slice(0, w.size === "s" ? 2 : 3).map((f) => <span key={f.unit}><b>{f.n}</b><small>{f.unit}</small></span>)}</span>
  </div>;
}

const tints: Record<string, string> = { suo: "#a84d63", plum: "#4e2b37", moss: "#5c7150", ai: "#2e5e8a", kuchiba: "#b8732c", sakura: "#d77b8c", sumi: "#3a3634" };
function Note({ w }: { w: Widget }) {
  const tint = tints[w.config?.tint ?? ""] ?? "#d77b8c";
  return <div className="wg-card wg-note" style={{ "--wg-tint": tint } as React.CSSProperties}>
    <span className="wg-tape" aria-hidden="true" />
    <p>{w.config?.text || "…"}</p>
  </div>;
}

function Status({ w }: { w: Widget }) {
  return <div className="wg-card wg-status">
    <span className="wg-emoji">{w.config?.emoji || "🌸"}</span>
    {w.config?.text ? <p>{w.config.text}</p> : null}
  </div>;
}

/** Their time of day: an ink clock face, and the hour in words. */
function Clock({ w, d }: { w: Widget; d: BoardData }) {
  const zone = w.config?.zone || undefined;
  const [now, setNow] = useState(() => new Date());
  useEffect(() => { const t = setInterval(() => setNow(new Date()), 20_000); return () => clearInterval(t); }, []);
  const parts = new Intl.DateTimeFormat("en", { timeZone: zone, hour: "numeric", minute: "2-digit", hour12: false }).formatToParts(now);
  const h = Number(parts.find((p) => p.type === "hour")?.value ?? 0) % 24, m = Number(parts.find((p) => p.type === "minute")?.value ?? 0);
  const said = new Intl.DateTimeFormat("en", { timeZone: zone, hour: "numeric", minute: "2-digit" }).format(now).toLowerCase();
  const night = h < 6 || h >= 20;
  return <div className={`wg-card wg-clock${night ? " is-night" : ""}`}>
    <svg className="wg-face" viewBox="0 0 100 100" aria-hidden="true">
      <circle cx="50" cy="50" r="44" className="wg-face-ring" />
      {Array.from({ length: 12 }, (_, i) => <line key={i} x1="50" y1="10" x2="50" y2={i % 3 ? "14" : "18"} transform={`rotate(${i * 30} 50 50)`} className="wg-tick" />)}
      <line x1="50" y1="50" x2="50" y2="28" className="wg-hour" transform={`rotate(${(h % 12) * 30 + m / 2} 50 50)`} />
      <line x1="50" y1="50" x2="50" y2="18" className="wg-minute" transform={`rotate(${m * 6} 50 50)`} />
      <circle cx="50" cy="50" r="3" className="wg-pin" />
    </svg>
    {w.size !== "s" ? <span className="wg-words"><small className="wg-kicker">{night ? "Night" : h < 12 ? "Morning" : h < 17 ? "Afternoon" : "Evening"} for {first(d.person.name)}</small><b>{said}</b>{zone ? <em>{zone.split("/").pop()?.replace(/_/g, " ")}</em> : null}</span>
      : <small className="wg-clock-says">{said}</small>}
  </div>;
}

function Links({ w, d }: { w: Widget; d: BoardData }) {
  if (!d.links.length) return <div className="wg-card"><Empty icon="link" text="Add links in Edit profile" /></div>;
  const n = w.size === "m" ? 2 : w.size === "l" ? 4 : 8;
  return <div className="wg-card wg-links">
    {/* eslint-disable-next-line no-restricted-syntax -- someone's own links leave Kimono, in a new tab */}
    {d.links.slice(0, n).map((l) => <a key={l.url} href={l.url} target="_blank" rel="noopener noreferrer nofollow"><LineIcon name="link" /><b>{l.title}</b><LineIcon name="out" /></a>)}
  </div>;
}

function Friends({ w, d }: { w: Widget; d: BoardData }) {
  if (!d.friends.length) return <div className="wg-card"><Empty icon="people" text="No friends to show" /></div>;
  return <div className="wg-card wg-friends">
    <small className="wg-kicker">{d.friends.length === 1 ? "1 friend" : `${d.friends.length} friends`}</small>
    <span className="wg-faces">{d.friends.slice(0, w.size === "l" ? 12 : 6).map((f) => <Crossing key={f.username} kind="kakejiku" href={`/account/people/${encodeURIComponent(f.username)}`} title={f.name}>
      <InkPortraitFrame seed={f.username} weight={3}><Portrait name={f.name} username={f.username} picture={f.picture} size={40} /></InkPortraitFrame>
    </Crossing>)}</span>
  </div>;
}

/* ── Adding one ────────────────────────────────────────────────────────── */

type Found = { key: string; title: string; subtitle: string; cover: string | null };

function Gallery({ onClose, onPick }: { onClose: () => void; onPick: (w: Widget) => void }) {
  const [kind, setKind] = useState<WidgetKind | null>(null);
  const k = kind ? kindOf(kind) : null;
  const plain = (kd: WidgetKind) => onPick({ id: newId(), kind: kd, size: kindOf(kd).size });
  return <InkSheet title={k ? k.name : "Add a widget"} icon="plus" onClose={onClose} actions={<Seal tone="quiet" compact onClick={k ? () => setKind(null) : onClose}>{k ? "Back" : "Cancel"}</Seal>}>
    {!k ? <div className="wg-gallery">{kinds.map((x) => <button key={x.kind} type="button" className="wg-pick"
      onClick={() => (["song", "album", "note", "status", "clock"].includes(x.kind) ? setKind(x.kind) : plain(x.kind))}>
      <span className="wg-pick-mark"><LineIcon name={x.icon} /></span><span><b>{x.name}</b><small>{x.says}</small></span>
    </button>)}</div>
      : kind === "song" || kind === "album" ? <MusicPicker album={kind === "album"} onPick={(f) => onPick({ id: newId(), kind, size: k.size, config: { key: f.key, title: f.title, subtitle: f.subtitle, cover: f.cover ?? "" } })} />
        : kind === "note" ? <NoteMaker onPick={(text, tint) => onPick({ id: newId(), kind: "note", size: "s", config: { text, tint } })} />
          : kind === "status" ? <StatusMaker onPick={(emoji, text) => onPick({ id: newId(), kind: "status", size: "s", config: { emoji, text } })} />
            : <ClockMaker onPick={(zone) => onPick({ id: newId(), kind: "clock", size: "s", config: { zone } })} />}
  </InkSheet>;
}

function MusicPicker({ album, onPick }: { album: boolean; onPick: (f: Found) => void }) {
  const [q, setQ] = useState("");
  const [found, setFound] = useState<Found[] | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  useEffect(() => {
    if (q.trim().length < 2) return;
    const t = setTimeout(() => {
      fetch(`/api/v1/music/search?q=${encodeURIComponent(q.trim())}`).then(async (r) => {
        if (!r.ok) { setProblem("Music isn't there to search."); return; }
        const b = await r.json() as { tracks: { key: string; title: string; artists: { name: string }[]; album: { cover: string | null } | null }[]; albums: { key: string; title: string; artist: { name: string } | null; cover: string | null }[] };
        setProblem(null);
        setFound(album ? b.albums.slice(0, 8).map((a) => ({ key: a.key, title: a.title, subtitle: a.artist?.name ?? "", cover: a.cover }))
          : b.tracks.slice(0, 8).map((t) => ({ key: t.key, title: t.title, subtitle: t.artists.map((a) => a.name).join(", "), cover: t.album?.cover ?? null })));
      }).catch(() => setProblem("Music didn't answer."));
    }, 250);
    return () => clearTimeout(t);
  }, [q, album]);
  const input = useRef<HTMLInputElement>(null);
  useEffect(() => input.current?.focus(), []);
  return <div className="wg-picker">
    <label className="field"><small>{album ? "Find an album" : "Find a song"}</small><input ref={input} value={q} onChange={(e) => setQ(e.target.value)} placeholder={album ? "Random Access Memories" : "Plastic Love"} /></label>
    {problem ? <p className="fr-problem">{problem}</p> : null}
    <div className="wg-found">{(q.trim().length >= 2 ? found ?? [] : []).map((f) => <button key={f.key} type="button" onClick={() => onPick(f)}>
      {/* eslint-disable-next-line @next/next/no-img-element -- covers from Music */}
      {f.cover ? <img src={f.cover} alt="" /> : <span className="wg-found-none" />}
      <span><b>{f.title}</b><small>{f.subtitle}</small></span>
    </button>)}</div>
  </div>;
}

function NoteMaker({ onPick }: { onPick: (text: string, tint: string) => void }) {
  const [text, setText] = useState("");
  const [tint, setTint] = useState("sakura");
  return <div className="wg-maker">
    <label className="field"><small>Your note</small><textarea rows={3} maxLength={160} value={text} onChange={(e) => setText(e.target.value)} placeholder="Ask me about city pop" /></label>
    <div className="fr-edit-colors"><div>{Object.entries(tints).map(([id, hex]) => <button key={id} type="button" aria-label={id} aria-pressed={tint === id} className={tint === id ? "is-on" : undefined} style={{ "--swatch": hex } as React.CSSProperties} onClick={() => setTint(id)} />)}</div></div>
    <Seal compact disabled={!text.trim()} onClick={() => onPick(text.trim(), tint)}>Add</Seal>
  </div>;
}

const statusEmoji = ["🌸", "🎧", "📚", "🍿", "☕", "😴", "🔥", "🌧️", "✈️", "💻", "🎮", "🍜"];
function StatusMaker({ onPick }: { onPick: (emoji: string, text: string) => void }) {
  const [emoji, setEmoji] = useState("🎧");
  const [text, setText] = useState("");
  return <div className="wg-maker">
    <div className="wg-emoji-pick">{statusEmoji.map((e) => <button key={e} type="button" aria-pressed={emoji === e} onClick={() => setEmoji(e)}>{e}</button>)}</div>
    <label className="field"><small>Status</small><input maxLength={60} value={text} onChange={(e) => setText(e.target.value)} placeholder="In a city pop phase" /></label>
    <Seal compact onClick={() => onPick(emoji, text.trim())}>Add</Seal>
  </div>;
}

/* Every time zone the browser knows, or at least this one. */
function allZones(here: string): string[] {
  try { return (Intl as unknown as { supportedValuesOf?: (k: string) => string[] }).supportedValuesOf?.("timeZone") ?? [here]; } catch { return [here]; }
}

function ClockMaker({ onPick }: { onPick: (zone: string) => void }) {
  const here = Intl.DateTimeFormat().resolvedOptions().timeZone;
  const [zones] = useState(() => allZones(here));
  const [zone, setZone] = useState(here);
  return <div className="wg-maker">
    <label className="field"><small>Where you are</small>
      <select value={zone} onChange={(e) => setZone(e.target.value)}>{zones.map((z) => <option key={z} value={z}>{z.replace(/_/g, " ")}</option>)}</select></label>
    <Seal compact onClick={() => onPick(zone)}>Add</Seal>
  </div>;
}
