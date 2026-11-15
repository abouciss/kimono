"use client";

import { InkWave } from "@kimono/ui";
import { useState, type ReactNode } from "react";
import { Crossing } from "./crossing";
import { LineIcon } from "./line-icon";
import { Book3D } from "@/app/(shell)/books/book3d";
import "./title-art.css";

/*
 * 品 One title, drawn the way its own app draws it, anywhere in Kimono: a book
 * as Books' 3D book, a film or show as Watch's poster, a song or album as
 * Music's sleeve with the record peeking out. Friends, profiles and sheets use
 * this rather than drawing covers of their own.
 *
 * Without a picture each still looks like itself: the book gets its cloth
 * binding, the poster its name set in Mincho, the sleeve a note.
 */

export type TitleThing = { app: string; itemId: string; title: string; subtitle?: string | null; cover?: string | null };
export type Rating = "love" | "up" | "down";

const ratedWord = { love: "Loved", up: "Liked", down: "Didn't like" } as const;

/** How someone rated it: a mark on the art's lower corner. */
export function RatingMark({ rating }: { rating: Rating }) {
  return <span className={`ta-rated ta-rated-${rating}`} title={ratedWord[rating]} aria-label={ratedWord[rating]}>
    {rating === "love"
      ? <svg viewBox="0 0 24 24" aria-hidden><path d="M12 20s-7-4.4-7-10a4 4 0 0 1 7-2.6A4 4 0 0 1 19 10c0 5.6-7 10-7 10Z" /></svg>
      : <svg viewBox="0 0 24 24" aria-hidden style={rating === "down" ? { transform: "rotate(180deg)" } : undefined}><path d="M7 11v9H4v-9h3Zm0 0 4-7c1.7 0 2.6 1.2 2.2 2.8L12.6 10H18a2 2 0 0 1 2 2.3l-1.1 6A2 2 0 0 1 17 20H7" /></svg>}
  </span>;
}

/** A picture, or the app's own stand-in when there isn't one (or it doesn't load). */
function Picture({ src, alt = "", none }: { src: string | null | undefined; alt?: string; none: ReactNode }) {
  const [broken, setBroken] = useState(false);
  if (!src || broken) return <>{none}</>;
  // eslint-disable-next-line @next/next/no-img-element -- each app's own image addresses
  return <img src={src} alt={alt} loading="lazy" decoding="async" onError={() => setBroken(true)} />;
}

/** The title's picture as its app draws it. `size`: "s" for a list row, "m" for a shelf. */
export function TitleArt({ item, size = "m", rating, progress }: { item: TitleThing; size?: "s" | "m"; rating?: Rating | null; progress?: number | null }) {
  const marks = <>{rating ? <RatingMark rating={rating} /> : null}</>;
  if (item.app === "books") {
    const author = item.subtitle?.split(" · ")[0]?.trim();
    return <span className={`ta ta-books ta-${size}`}>
      <Book3D book={{ key: item.itemId, title: item.title, authors: author ? [author] : [], cover: item.cover ?? null, pages: null }} size={size === "s" ? "sm" : "md"} progress={progress ?? undefined} still={size === "s"} />
      {marks}
    </span>;
  }
  if (item.app === "music") return <span className={`ta ta-music ta-${size}`}>
    <span className="ta-disc" aria-hidden="true"><i /></span>
    <span className="ta-sleeve"><Picture src={item.cover} none={<span className="ta-none"><LineIcon name="music" /></span>} /></span>
    {marks}
  </span>;
  /* Watch, and anything else with a poster. */
  return <span className={`ta ta-watch ta-${size}`}>
    <span className="ta-poster">
      <Picture src={item.cover} none={<span className="ta-none ta-named"><LineIcon name="film" /><b>{item.title}</b></span>} />
      {progress ? <InkWave className="ta-bar" value={progress} label="Watched" /> : null}
    </span>
    {marks}
  </span>;
}

/** A title on a shelf: its art, its name and line, a link to it in its app, and anything else under it. */
export function TitleCard({ item, href, rating, progress, children }: { item: TitleThing; href?: string | null; rating?: Rating | null; progress?: number | null; children?: ReactNode }) {
  const face = <>
    <TitleArt item={item} rating={rating} progress={progress} />
    <span className="ta-words"><b>{item.title}</b>{item.subtitle ? <small>{item.subtitle}</small> : null}</span>
  </>;
  return <div className={`ta-card ta-card-${item.app}`}>
    {href ? <Crossing kind="kakejiku" href={href} className="ta-link">{face}</Crossing> : <span className="ta-link">{face}</span>}
    {children}
  </div>;
}

/** A title in a list row: small art, its name, and a line under. */
export function TitleRow({ item, line, children }: { item: TitleThing; line?: ReactNode; children?: ReactNode }) {
  return <div className="ta-row">
    <TitleArt item={item} size="s" />
    <span className="ta-words"><b>{item.title}</b>{line ?? (item.subtitle ? <small>{item.subtitle}</small> : null)}</span>
    {children}
  </div>;
}
