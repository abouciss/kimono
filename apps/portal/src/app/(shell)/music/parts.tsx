"use client";

import { Crossing, useCrossTo } from "@/components/crossing";
import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { cx, MorphLoader, Seal } from "@kimono/ui";
import { byline, clock, forget, hrefOf, musicApi, type Album, type Artist, type Playlist, type RatedKind, type Rating, type Track } from "./api";
import { askName } from "./ask";
import { Icon } from "./icons";
import { usePlayer, type Source } from "./player";

/* ── Pictures ──────────────────────────────────────────────────────────── */

/* Deezer draws a picture at any size its address asks for ("…/1000x1000-…"): a row's thumbnail needn't fetch the poster. */
export const sized = (src: string, px: number) => src.replace(/\/(\d{2,4})x\1-/, `/${px}x${px}-`);

/** An album's cover, or the note on a fold when there's none. `quality` is how large it can be drawn. */
export function Cover({ src, alt = "", size, quality, className, round }: { src: string | null | undefined; alt?: string; size?: number; quality?: "thumb" | "card" | "full"; className?: string; round?: boolean }) {
  const [broken, setBroken] = useState(false);
  const style = size ? { width: size, height: size } : undefined;
  if (!src || broken) return <span className={cx("km-cover km-cover-none", round && "km-round", className)} style={style} aria-hidden="true"><Icon name="note" /></span>;
  const px = (quality ?? (size && size <= 64 ? "thumb" : "card")) === "thumb" ? 120 : quality === "full" ? 1000 : 500;
  // eslint-disable-next-line @next/next/no-img-element -- Deezer's CDN sizes its own pictures
  return <img className={cx("km-cover", round && "km-round", className)} style={style} src={sized(src, px)} alt={alt} loading="lazy" decoding="async" onError={() => setBroken(true)} />;
}

/** Up to four covers as one square: a playlist's or a mix's face. */
export function Mosaic({ covers, className }: { covers: string[]; className?: string }) {
  if (covers.length < 4) return <Cover src={covers[0]} className={className} />;
  return <span className={cx("km-mosaic", className)} aria-hidden="true">{covers.slice(0, 4).map((c) => <Cover key={c} src={c} />)}</span>;
}

/* ── Waiting and failing ───────────────────────────────────────────────── */

export function Loading() {
  return <div className="km-loading"><MorphLoader label="Loading" className="ink-loader" /></div>;
}

export function Problem({ text, onRetry }: { text: string; onRetry?: () => void }) {
  return <div className="km-problem"><p>{text}</p>{onRetry ? <Seal tone="quiet" compact onClick={onRetry}>Try again</Seal> : null}</div>;
}

/* ── Ratings ───────────────────────────────────────────────────────────── */

const rates: [Rating, string][] = [["down", "Not for me"], ["up", "I like this"], ["love", "Love this"]];

/** The three marks, inline: pressing the one that's set takes it back. */
export function RateMarks({ kind, keyOf }: { kind: RatedKind; keyOf: string }) {
  const p = usePlayer();
  const rating = p.ratingOf(kind, keyOf);
  return <span className="km-rates" role="group" aria-label="Rate">
    {rates.map(([r, label]) => <button key={r} type="button" className={cx("km-rate", rating === r && "km-on", `km-rate-${r}`)} aria-pressed={rating === r} aria-label={label} title={label}
      onClick={(e) => { e.stopPropagation(); p.rate(kind, keyOf, rating === r ? null : r); }}><Icon name={r} /></button>)}
  </span>;
}

/* ── Menus ─────────────────────────────────────────────────────────────── */

type Item = { label: string; icon?: Parameters<typeof Icon>[0]["name"]; run?: () => void | Promise<void>; href?: string; sub?: () => Promise<Item[]>; danger?: boolean };

/** A menu that opens beside what it belongs to, raised over the page. */
export function Menu({ anchor, items, onClose }: { anchor: HTMLElement; items: Item[]; onClose: () => void }) {
  const box = useRef<HTMLDivElement>(null);
  const crossTo = useCrossTo();
  const [at, setAt] = useState<{ left: number; top: number } | null>(null);
  const [list, setList] = useState(items);
  const [title, setTitle] = useState<string | null>(null);
  useLayoutEffect(() => {
    const a = anchor.getBoundingClientRect();
    const w = box.current?.offsetWidth ?? 240, h = box.current?.offsetHeight ?? 200;
    const left = Math.min(Math.max(8, a.right - w), innerWidth - w - 8);
    const top = a.bottom + h + 8 > innerHeight ? Math.max(8, a.top - h - 6) : a.bottom + 6;
    setAt({ left, top });
  }, [anchor, list]);
  useEffect(() => {
    const away = (e: PointerEvent) => { if (!box.current?.contains(e.target as Node) && !anchor.contains(e.target as Node)) onClose(); };
    const esc = (e: KeyboardEvent) => { if (e.key === "Escape") { e.stopPropagation(); onClose(); } };
    document.addEventListener("pointerdown", away, true);
    document.addEventListener("keydown", esc, true);
    addEventListener("scroll", onClose, { passive: true });
    box.current?.querySelector<HTMLElement>("button, a")?.focus();
    return () => { document.removeEventListener("pointerdown", away, true); document.removeEventListener("keydown", esc, true); removeEventListener("scroll", onClose); };
  }, [anchor, onClose]);
  return createPortal(<div ref={box} className="km-menu" role="menu" style={at ? { left: at.left, top: at.top } : { visibility: "hidden" }}>
    {title ? <div className="km-menu-title">{title}</div> : null}
    {list.map((item) => <button key={item.label} type="button" role="menuitem" className={cx(item.danger && "km-danger")} onClick={async () => {
      if (item.sub) { setTitle(item.label); setList(await item.sub()); return; }
      onClose();
      if (item.href) crossTo("kakejiku", item.href);
      void item.run?.();
    }}>{item.icon ? <Icon name={item.icon} /> : <span className="km-menu-gap" />}<span>{item.label}</span>{item.sub ? <span className="km-menu-more">›</span> : null}</button>)}
  </div>, document.querySelector(".app-frame") ?? document.body);
}

/** "Add to playlist": your playlists, newest first, and a new one. */
export function playlistItems(keys: string[], say: (t: string) => void): () => Promise<Item[]> {
  return async () => {
    const { playlists } = await musicApi.playlists().catch(() => ({ playlists: [] as Playlist[] }));
    return [
      { label: "New playlist", icon: "add", run: async () => {
        const name = await askName("New playlist", "Make it");
        if (!name) return;
        musicApi.createPlaylist(name, keys).then(() => { forget("playlists"); forget("home"); forget("me"); say(`Made “${name}”`); }).catch(() => say("That playlist wasn't made."));
      } },
      ...playlists.map((pl): Item => ({ label: pl.name, icon: "playlist", run: () => {
        musicApi.addToPlaylist(pl.id, keys).then(() => { forget(`playlist:${pl.id}`); forget("playlists"); forget("me"); say(`Added to “${pl.name}”`); }).catch(() => say("That didn't go in."));
      } })),
    ];
  };
}

export function MoreButton({ label = "More", items, className }: { label?: string; items: () => Item[]; className?: string }) {
  const [open, setOpen] = useState<HTMLElement | null>(null);
  return <>
    <button type="button" className={cx("km-iconbtn", className)} aria-label={label} aria-haspopup="menu" aria-expanded={Boolean(open)}
      onClick={(e) => { e.stopPropagation(); setOpen(open ? null : e.currentTarget); }}><Icon name="more" /></button>
    {open ? <Menu anchor={open} items={items()} onClose={() => setOpen(null)} /> : null}
  </>;
}

function trackItems(t: Track, p: ReturnType<typeof usePlayer>, extra: Item[] = []): Item[] {
  return [
    { label: "Play next", icon: "next", run: () => p.playNext([t]) },
    { label: "Add to queue", icon: "queue", run: () => p.addToQueue([t]) },
    { label: "Add to playlist", icon: "playlist", sub: playlistItems([t.key], p.say) },
    { label: "Song radio", icon: "radio", run: () => { musicApi.radio(t.key, []).then(({ tracks }) => p.play([t, ...tracks], 0, { kind: "radio", id: t.key, title: `Like ${t.title}` })).catch(() => p.say("No radio for that one right now.")); } },
    ...(t.artists[0] ? [{ label: "Go to artist", icon: "back" as const, href: hrefOf.artist(t.artists[0].key) }] : []),
    ...(t.album ? [{ label: "Go to album", icon: "back" as const, href: hrefOf.album(t.album.key) }] : []),
    ...extra,
  ];
}

/* ── Songs ─────────────────────────────────────────────────────────────── */

export function ArtistLinks({ artists }: { artists: Track["artists"] }) {
  /* Songs kept before Deezer's repeated names were dropped may still carry one. */
  return <>{artists.filter((a, i, all) => all.findIndex((b) => b.key === a.key) === i).map((a, i) => <span key={a.key}>{i ? ", " : ""}<Crossing kind="kakejiku" href={hrefOf.artist(a.key)} onClick={(e) => e.stopPropagation()}>{a.name}</Crossing></span>)}</>;
}

/**
 * Songs as rows. Clicking one plays the list from there; the number becomes a
 * play mark on hover, and the song playing now says so in the accent.
 */
export function Songs({ tracks, source, numbered = false, art = true, album = true, rowExtra, className }: {
  tracks: Track[];
  source: Source;
  numbered?: boolean;
  art?: boolean;
  album?: boolean;
  /** More things the row's menu can do (a playlist's "Remove"). */
  rowExtra?: (t: Track, i: number) => Item[];
  className?: string;
}) {
  const p = usePlayer();
  if (!tracks.length) return null;
  return <ol className={cx("km-songs", !album && "km-songs-noalbum", className)}>
    {tracks.map((t, i) => {
      /* The song playing is marked wherever it's listed; pressing it there pauses it rather than starting it over. */
      const now = p.current?.key === t.key;
      const loved = p.ratingOf("track", t.key) === "love";
      return <li key={`${t.key}-${i}`} className={cx("km-song", now && "km-now")} onDoubleClick={() => p.play(tracks, i, source)}>
        <button type="button" className="km-song-play" aria-label={now && p.playing ? `Pause ${t.title}` : `Play ${t.title}`}
          onClick={() => (now ? p.toggle() : p.play(tracks, i, source))}>
          {numbered ? <span className="km-song-n">{now && p.playing ? <Bars /> : i + 1}</span> : null}
          {art ? <Cover src={t.album?.cover} size={44} className="km-song-art" /> : null}
          <Icon name={now && p.playing ? "pause" : "play"} className="km-song-mark" />
        </button>
        <div className="km-song-name">
          <span className="km-song-title">{t.title}{t.explicit ? <abbr className="km-explicit" title="Explicit">E</abbr> : null}</span>
          <span className="km-song-by"><ArtistLinks artists={t.artists} /></span>
        </div>
        {album ? <span className="km-song-album">{t.album ? <Crossing kind="kakejiku" href={hrefOf.album(t.album.key)}>{t.album.title}</Crossing> : null}</span> : null}
        <span className="km-song-end">
          {loved ? <Icon name="love" className="km-song-loved" /> : null}
          <span className="km-song-time">{clock(t.duration)}</span>
          <MoreButton label={`More for ${t.title}`} items={() => [
            ...rates.map(([r, label]): Item => ({ label: p.ratingOf("track", t.key) === r ? `${label} (undo)` : label, icon: r, run: () => p.rate("track", t.key, p.ratingOf("track", t.key) === r ? null : r) })),
            ...trackItems(t, p, rowExtra?.(t, i)),
          ]} />
        </span>
      </li>;
    })}
  </ol>;
}

/** The playing mark: three bars, still when paused. */
export function Bars() {
  return <span className="km-bars" aria-hidden="true"><i /><i /><i /></span>;
}

/* ── Cards ─────────────────────────────────────────────────────────────── */

/** A row of things to scroll sideways, under a name. */
export function Shelf({ title, href, children }: { title: string; href?: string; children: ReactNode }) {
  return <section className="km-shelf">
    <header><h2 className="k-heading">{title}</h2>{href ? <Crossing kind="kakejiku" className="km-shelf-all" href={href}>Show all</Crossing> : null}</header>
    <div className="km-shelf-row">{children}</div>
  </section>;
}

export function AlbumCard({ album, sub }: { album: Album; sub?: string }) {
  const p = usePlayer();
  return <div className="km-card">
    <div className="km-card-pic">
      <Crossing kind="kakejiku" href={hrefOf.album(album.key)} tabIndex={-1} aria-hidden="true"><Cover src={album.cover} className="km-card-art" /></Crossing>
      <PlayOver label={`Play ${album.title}`} onPlay={async () => {
        const { album: full } = await musicApi.album(album.key);
        p.play(full.tracks, 0, { kind: "album", id: album.key, title: album.title });
      }} />
    </div>
    <Crossing kind="kakejiku" href={hrefOf.album(album.key)} className="km-card-link">
      <span className="km-card-title">{album.title}</span>
      <span className="km-card-sub">{sub ?? [album.artist?.name, album.year].filter(Boolean).join(" · ")}</span>
    </Crossing>
  </div>;
}

export function ArtistCard({ artist }: { artist: Artist }) {
  return <Crossing kind="kakejiku" href={hrefOf.artist(artist.key)} className="km-card km-card-artist km-card-link">
    <span className="km-card-pic"><Cover src={artist.picture} round className="km-card-art" /></span>
    <span className="km-card-title">{artist.name}</span>
    <span className="km-card-sub">Artist</span>
  </Crossing>;
}

/** A list of songs shown as one thing (a mix, a playlist): its covers together. */
export function SetCard({ title, sub, covers, href, onPlay }: { title: string; sub: string; covers: string[]; href: string; onPlay?: () => void | Promise<void> }) {
  return <div className="km-card">
    <div className="km-card-pic">
      <Crossing kind="kakejiku" href={href} tabIndex={-1} aria-hidden="true"><Mosaic covers={covers} className="km-card-art" /></Crossing>
      {onPlay ? <PlayOver label={`Play ${title}`} onPlay={onPlay} /> : null}
    </div>
    <Crossing kind="kakejiku" href={href} className="km-card-link">
      <span className="km-card-title">{title}</span>
      <span className="km-card-sub">{sub}</span>
    </Crossing>
  </div>;
}

/** The play seal that rises over a card's picture on hover. */
function PlayOver({ label, onPlay }: { label: string; onPlay: () => void | Promise<void> }) {
  const [busy, setBusy] = useState(false);
  const p = usePlayer();
  return <button type="button" className="km-card-play" aria-label={label} disabled={busy}
    onClick={async () => { setBusy(true); try { await onPlay(); } catch { p.say("That won't play right now."); } finally { setBusy(false); } }}>
    <Icon name="play" />
  </button>;
}

/* ── A page's head ─────────────────────────────────────────────────────── */

export function Head({ kind, title, art, meta, children }: { kind: string; title: string; art: ReactNode; meta?: ReactNode; children?: ReactNode }) {
  return <header className="km-head">
    <div className="km-head-art">{art}</div>
    <div className="km-head-text">
      <span className="k-label km-head-kind">{kind}</span>
      <h1 className="km-head-title">{title}</h1>
      {meta ? <p className="km-head-meta">{meta}</p> : null}
      {children ? <div className="km-head-actions">{children}</div> : null}
    </div>
  </header>;
}

/** Play and shuffle, as a page's first actions. */
export function PlayActions({ tracks, source }: { tracks: Track[]; source: Source }) {
  const p = usePlayer();
  const here = p.source?.kind === source?.kind && p.source?.id === source?.id;
  return <>
    <Seal onClick={() => (here ? p.toggle() : p.play(tracks, 0, source))} disabled={!tracks.length}>
      <Icon name={here && p.playing ? "pause" : "play"} />{here && p.playing ? "Pause" : "Play"}
    </Seal>
    <Seal tone="quiet" onClick={() => p.play(tracks, Math.floor(Math.random() * tracks.length), source, { shuffle: true })} disabled={tracks.length < 2}>
      <Icon name="shuffle" />Shuffle
    </Seal>
  </>;
}

export { byline };
