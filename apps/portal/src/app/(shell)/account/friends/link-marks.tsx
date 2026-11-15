"use client";

import { Favicon } from "./widgets";
import type { LineIconName } from "@/components/line-icon";

/*
 * 印 What a link wears: the site's own icon (the default), one of these drawn
 * marks, or an emoji. Stored on the link as `icon`: "", a mark's name, or
 * "emoji:🍵".
 */

export const linkGlyphs: Record<string, { name: string; d: string }> = {
  globe: { name: "Website", d: "M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18Zm-9 9h18M12 3c2.5 2.6 3.7 5.6 3.7 9s-1.2 6.4-3.7 9c-2.5-2.6-3.7-5.6-3.7-9S9.5 5.6 12 3Z" },
  heart: { name: "Heart", d: "M12 20s-7-4.4-7-10a4 4 0 0 1 7-2.6A4 4 0 0 1 19 10c0 5.6-7 10-7 10Z" },
  star: { name: "Star", d: "m12 3.5 2.6 5.4 5.9.8-4.3 4.1 1 5.8L12 16.8l-5.2 2.8 1-5.8-4.3-4.1 5.9-.8Z" },
  sparkle: { name: "Sparkle", d: "M12 3c.6 4.6 2.4 6.4 7 7-4.6.6-6.4 2.4-7 7-.6-4.6-2.4-6.4-7-7 4.6-.6 6.4-2.4 7-7Zm7 12c.2 1.6.9 2.3 2.5 2.5-1.6.2-2.3.9-2.5 2.5-.2-1.6-.9-2.3-2.5-2.5 1.6-.2 2.3-.9 2.5-2.5Z" },
  mail: { name: "Email", d: "M4 6h16v12H4zM4 7l8 6 8-6" },
  music: { name: "Music", d: "M9 18V6l10-2v12M9 18a2.5 2.5 0 1 1-5 0 2.5 2.5 0 0 1 5 0Zm10-2a2.5 2.5 0 1 1-5 0 2.5 2.5 0 0 1 5 0Z" },
  mic: { name: "Podcast", d: "M12 3a3 3 0 0 0-3 3v5a3 3 0 0 0 6 0V6a3 3 0 0 0-3-3Zm-6 8a6 6 0 0 0 12 0M12 17v4m-3 0h6" },
  book: { name: "Writing", d: "M5 4.5A1.5 1.5 0 0 1 6.5 3H19v15H6.5A1.5 1.5 0 0 0 5 19.5v-15ZM5 19.5A1.5 1.5 0 0 0 6.5 21H19v-3" },
  pen: { name: "Blog", d: "M4 20l4-1L19 8a2.1 2.1 0 0 0-3-3L5 16l-1 4Zm10-13 3 3" },
  camera: { name: "Photos", d: "M4 8h3l2-2.5h6L17 8h3v11H4zM12 16.5a3.5 3.5 0 1 0 0-7 3.5 3.5 0 0 0 0 7Z" },
  film: { name: "Videos", d: "M4 5h16v14H4zM8 5v14M16 5v14M4 9.5h4m8 0h4M4 14.5h4m8 0h4" },
  palette: { name: "Art", d: "M12 3a9 9 0 0 0 0 18c1.2 0 1.8-.9 1.4-2-.5-1.3.3-2.5 1.7-2.5H18a3 3 0 0 0 3-3A9 9 0 0 0 12 3ZM7.5 12h.01M9.5 8h.01M14.5 8h.01M16.5 11h.01" },
  code: { name: "Code", d: "m8 8-4 4 4 4m8-8 4 4-4 4M13.5 5l-3 14" },
  game: { name: "Games", d: "M7 8h10a4 4 0 0 1 4 4v1.5a2.5 2.5 0 0 1-4.5 1.5L15 13H9l-1.5 2A2.5 2.5 0 0 1 3 13.5V12a4 4 0 0 1 4-4Zm1 2.5v3m-1.5-1.5h3M15.5 11h.01M17 13h.01" },
  bag: { name: "Shop", d: "M5 8h14l-1 12H6L5 8Zm4 0V7a3 3 0 0 1 6 0v1" },
  coffee: { name: "Support me", d: "M4 9h12v5a5 5 0 0 1-5 5H9a5 5 0 0 1-5-5V9Zm12 1h1.5a2.5 2.5 0 0 1 0 5H16M8 3c-.8 1 .8 2 0 3m4-3c-.8 1 .8 2 0 3" },
  gift: { name: "Wishlist", d: "M4 9h16v4H4zM5 13h14v8H5zM12 9v12M12 9C10 4 6.5 5 7.5 7.5 8.2 9 12 9 12 9Zm0 0c2-5 5.5-4 4.5-1.5C15.8 9 12 9 12 9Z" },
  calendar: { name: "Book a time", d: "M4 6h16v14H4zM4 10h16M8 3v4m8-4v4" },
  pin: { name: "Place", d: "M12 21s-6-5.6-6-11a6 6 0 0 1 12 0c0 5.4-6 11-6 11Zm0-8.5a2.5 2.5 0 1 0 0-5 2.5 2.5 0 0 0 0 5Z" },
  home: { name: "Home", d: "M4 11 12 4l8 7v9h-5v-6H9v6H4z" },
  phone: { name: "Call", d: "M6 3h3l1.5 4.5L8.5 9a11 11 0 0 0 6.5 6.5l1.5-2L21 15v3a3 3 0 0 1-3 3A15 15 0 0 1 3 6a3 3 0 0 1 3-3Z" },
  chat: { name: "Chat", d: "M4 5h16v11H9l-5 4V5Z" },
  rocket: { name: "Project", d: "M14 4c3-1 6-1 6-1s0 3-1 6l-6 6-4-4 5-7Zm-5 7-4 .5L3 14l4 1m6 2-.5 4L10 21l-1-4m6-8h.01" },
  leaf: { name: "Garden", d: "M5 19C5 10 11 5 20 4c-1 9-6 15-15 15Zm0 0 8-8" },
};

export const isEmojiIcon = (icon?: string) => Boolean(icon?.startsWith("emoji:"));

/** A link's mark: its chosen one, else the site's own icon. */
export function LinkMark({ url, icon, fallback = "link" }: { url: string; icon?: string; fallback?: LineIconName }) {
  if (icon && isEmojiIcon(icon)) return <span className="lk-emoji" aria-hidden="true">{icon.slice(6)}</span>;
  const g = icon ? linkGlyphs[icon] : undefined;
  if (g) return <svg className="lk-glyph" viewBox="0 0 24 24" aria-hidden="true"><path d={g.d} /></svg>;
  return <Favicon url={url} fallback={fallback} />;
}
