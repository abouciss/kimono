"use client";

import { useEffect, useRef, useState } from "react";
import { Seal } from "@kimono/ui";
import { InkSheet } from "@/components/ink-sheet";
import { LineIcon } from "@/components/line-icon";
import { Favicon, hostOf, inLinks, isSocial, showOf, type LinkShow } from "./widgets";
import { isEmojiIcon, LinkMark, linkGlyphs } from "./link-marks";

/*
 * 鎖 Your links, edited as they'll look: paste an address and it's there,
 * named after the site; drag to put them in order; the star puts one first,
 * featured. Each link shows under your name, in your Links widget, or both
 * (open it to choose; social sites start in both). Each change saves.
 */

export type Link = { title: string; url: string; icon?: string; show?: LinkShow };

const shows: { value: LinkShow; label: string }[] = [{ value: "name", label: "Under your name" }, { value: "links", label: "In Links" }, { value: "both", label: "Both" }];

/** The last character typed, whole (an emoji with its joins and skin tone counts as one). */
const lastGrapheme = (v: string) => { const all = [...new Intl.Segmenter(undefined, { granularity: "grapheme" }).segment(v.trim())]; return all.length ? all[all.length - 1].segment : ""; };

/* What well-known sites are called, so a pasted address arrives named. */
const siteNames: [RegExp, string][] = [
  [/instagram\./, "Instagram"], [/(^|\.)x\.com$|twitter\./, "X"], [/bsky\./, "Bluesky"], [/threads\./, "Threads"], [/mastodon/, "Mastodon"],
  [/tiktok\./, "TikTok"], [/youtube\.|youtu\.be/, "YouTube"], [/twitch\./, "Twitch"], [/github\./, "GitHub"], [/gitlab\./, "GitLab"],
  [/linkedin\./, "LinkedIn"], [/facebook\./, "Facebook"], [/spotify\./, "Spotify"], [/soundcloud\./, "SoundCloud"], [/bandcamp\./, "Bandcamp"],
  [/letterboxd\./, "Letterboxd"], [/goodreads\./, "Goodreads"], [/discord\./, "Discord"], [/reddit\./, "Reddit"], [/pinterest\./, "Pinterest"],
  [/behance\./, "Behance"], [/dribbble\./, "Dribbble"], [/vimeo\./, "Vimeo"], [/last\.fm/, "Last.fm"], [/substack\./, "Substack"], [/medium\./, "Medium"],
];

/** An address as typed, made whole: "github.com/me" → https://github.com/me, "me@x.com" → mailto. Null when it isn't one. */
export function whole(raw: string): string | null {
  let url = raw.trim();
  if (!url) return null;
  if (!/^[a-z][a-z0-9+.-]*:/i.test(url)) url = url.includes("@") && !url.includes("/") ? `mailto:${url}` : `https://${url}`;
  try {
    const u = new URL(url);
    if (u.protocol === "mailto:") return /.+@.+\..+/.test(u.pathname) ? u.toString() : null;
    if (!["https:", "http:"].includes(u.protocol) || !u.hostname.includes(".")) return null;
    return u.toString();
  } catch { return null; }
}

/** What to call a link when nobody named it: the site's name, the handle after it when there is one. */
export function nameFor(url: string): string {
  if (url.startsWith("mailto:")) return "Email";
  const host = hostOf(url);
  const site = siteNames.find(([re]) => re.test(host))?.[1];
  const handle = (() => { try { return new URL(url).pathname.split("/").filter(Boolean)[0] ?? ""; } catch { return ""; } })();
  if (site) return handle && !/^(channel|user|c|in|p)$/i.test(handle) ? `${site} · ${handle.replace(/^@/, "@")}` : site;
  return host;
}

export function LinksEditor({ links: start, onClose, onSave }: { links: Link[]; onClose: () => void; onSave: (links: Link[]) => Promise<boolean> }) {
  const [links, setLinks] = useState<Link[]>(start);
  const [typed, setTyped] = useState("");
  const [open, setOpen] = useState<number | null>(null);
  const [dragging, setDragging] = useState<number | null>(null);
  const [saving, setSaving] = useState<"saved" | "saving" | "problem" | null>(null);
  const paste = useRef<HTMLInputElement>(null);
  useEffect(() => paste.current?.focus(), []);

  /* Each change saves a moment later, so typing a title doesn't save every letter; nothing changed, nothing saved. */
  const last = useRef(JSON.stringify(start));
  useEffect(() => {
    const now = JSON.stringify(links);
    if (now === last.current) return;
    const t = setTimeout(() => {
      last.current = now;
      setSaving("saving");
      void onSave(links.filter((l) => whole(l.url))).then((ok) => setSaving(ok ? "saved" : "problem"));
    }, 600);
    return () => clearTimeout(t);
  }, [links, onSave]);

  const ready = whole(typed);
  const add = () => {
    if (!ready || links.length >= 8) return;
    setLinks((ls) => [...ls, { title: nameFor(ready), url: ready }]);
    setTyped("");
    paste.current?.focus();
  };
  const set = (i: number, part: Partial<Link>) => setLinks((ls) => ls.map((l, j) => (j === i ? { ...l, ...part } : l)));
  const move = (from: number, to: number) => setLinks((ls) => { const o = [...ls]; const [l] = o.splice(from, 1); o.splice(to, 0, l); return o; });
  /* The first link in the Links widget is its featured one. */
  const featured = links.findIndex(inLinks);

  return <InkSheet title="Your links" icon="link" onClose={onClose} actions={<>
    <span className="le-saved" role="status">{saving === "saving" ? "Saving…" : saving === "saved" ? "Saved" : saving === "problem" ? "Not saved" : ""}</span>
    <Seal compact onClick={onClose}>Done</Seal>
  </>}>
    <div className="le">
      <form className={`le-paste${typed && !ready ? " is-wrong" : ""}`} onSubmit={(e) => { e.preventDefault(); add(); }}>
        <span className="le-paste-mark">{ready ? <Favicon url={ready} fallback="link" /> : <LineIcon name="link" />}</span>
        <input ref={paste} value={typed} onChange={(e) => setTyped(e.target.value)} placeholder="Paste a link: instagram.com/you" inputMode="url" aria-label="Add a link" disabled={links.length >= 8} />
        <button type="submit" className="le-add" disabled={!ready || links.length >= 8}><LineIcon name="plus" />Add</button>
      </form>
      {typed && !ready ? <p className="le-hint">That isn&rsquo;t a web address yet.</p>
        : ready ? <p className="le-hint">Adds as <b>{nameFor(ready)}</b>{isSocial(ready) ? ", under your name and in Links" : ", in Links"}</p>
          : links.length >= 8 ? <p className="le-hint">That&rsquo;s eight: take one away to add another.</p> : null}

      {links.length ? <ol className="le-list">
        {links.map((l, i) => {
          const ok = Boolean(whole(l.url));
          const linked = ok && inLinks(l);
          return <li key={i} className={`le-link${open === i ? " is-open" : ""}${dragging === i ? " is-dragging" : ""}${ok ? "" : " is-wrong"}`}
            draggable={open !== i} onDragStart={(e) => { setDragging(i); e.dataTransfer.effectAllowed = "move"; }}
            onDragOver={(e) => { if (dragging === null || dragging === i) return; e.preventDefault(); move(dragging, i); setDragging(i); }}
            onDragEnd={() => setDragging(null)} style={{ "--i": i } as React.CSSProperties}>
            <div className="le-row">
              <span className="le-grip" aria-hidden="true"><i /><i /><i /></span>
              <span className="le-mark">{ok ? <LinkMark url={whole(l.url)!} icon={l.icon} /> : <LineIcon name="link" />}</span>
              <button type="button" className="le-words" onClick={() => setOpen(open === i ? null : i)} aria-expanded={open === i}>
                <b>{l.title || nameFor(whole(l.url) ?? l.url)}</b>
                <small>{ok ? hostOf(whole(l.url)!) || l.url.replace(/^mailto:/, "") : "Not a web address"}</small>
              </button>
              {linked ? <button type="button" className={`le-star${i === featured ? " is-on" : ""}`} aria-pressed={i === featured} title={i === featured ? "First in Links" : "Put it first in Links"}
                onClick={() => { if (i !== featured) move(i, Math.max(0, featured)); }}>
                <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 17.27 18.18 21l-1.64-7.03L22 9.24l-7.19-.61L12 2 9.19 8.63 2 9.24l5.46 4.73L5.82 21z" /></svg>
              </button> : null}
              <span className="le-order">
                <button type="button" aria-label="Move up" disabled={i === 0} onClick={() => move(i, i - 1)}><LineIcon name="up" /></button>
                <button type="button" aria-label="Move down" disabled={i === links.length - 1} onClick={() => move(i, i + 1)}><LineIcon name="down" /></button>
              </span>
              <button type="button" className="le-drop" aria-label={`Remove ${l.title}`} onClick={() => { setLinks((ls) => ls.filter((_, j) => j !== i)); setOpen(null); }}><LineIcon name="close" /></button>
            </div>
            {open === i ? <div className="le-fields">
              <label className="field"><small>Title</small><input value={l.title} maxLength={40} onChange={(e) => set(i, { title: e.target.value })} autoFocus /></label>
              <label className="field"><small>Address</small><input value={l.url.replace(/^mailto:/, "")} inputMode="url" onChange={(e) => set(i, { url: e.target.value })} /></label>
              <div className="le-show" role="radiogroup" aria-label="Shows">
                <small>Shows</small>
                <span>{shows.map((o) => <button key={o.value} type="button" role="radio" aria-checked={showOf(l) === o.value} onClick={() => set(i, { show: o.value })}>{o.label}</button>)}</span>
              </div>
              <div className="le-icons" role="radiogroup" aria-label="Icon">
                <small>Icon</small>
                <div className="le-icon-grid">
                  <button type="button" role="radio" aria-checked={!l.icon} className="le-icon is-site" title="The site's own" onClick={() => set(i, { icon: undefined })}>
                    {ok ? <Favicon url={whole(l.url)!} fallback="link" /> : <LineIcon name="link" />}<span>Site</span>
                  </button>
                  {Object.entries(linkGlyphs).map(([key, g]) => <button key={key} type="button" role="radio" aria-checked={l.icon === key} className="le-icon" title={g.name} aria-label={g.name} onClick={() => set(i, { icon: key })}>
                    <svg viewBox="0 0 24 24" aria-hidden="true"><path d={g.d} /></svg>
                  </button>)}
                  <label className={`le-icon le-icon-emoji${isEmojiIcon(l.icon) ? " is-on" : ""}`} title="Any emoji">
                    <input value={isEmojiIcon(l.icon) ? l.icon!.slice(6) : ""} placeholder="🙂" aria-label="An emoji instead"
                      onChange={(e) => { const v = lastGrapheme(e.target.value); set(i, { icon: v ? `emoji:${v}` : undefined }); }} />
                  </label>
                </div>
              </div>
            </div> : null}
          </li>;
        })}
      </ol> : <div className="le-empty"><LineIcon name="link" /><p>Your Instagram, your site, your playlist: paste the first one above.</p></div>}
    </div>
  </InkSheet>;
}
