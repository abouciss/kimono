"use client";

import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { InkBlot, InkPortraitFrame, Seal } from "@kimono/ui";
import { Crossing, CrossingSeal } from "@/components/crossing";
import { InkSheet } from "@/components/ink-sheet";
import { JointSwitch } from "@/components/joint-switch";
import { LineIcon, type LineIconName } from "@/components/line-icon";
import { Portrait } from "@/components/portrait";
import { SilkscreenBadge } from "./silkscreen";
import { Book3D } from "../../books/book3d";
import { Favicon, isSocial, WidgetBoard, type MusicExtras, type Widget } from "./widgets";

/*
 * 友 Friends, profiles and recommendations on the web (lib/friends has the
 * rules). The phone app has the same pages; Watch's title page sends
 * recommendations through RecommendSheet.
 */


/* Each app's colour and mark on a profile: moss for Books, lapis for Music, rose for Watch. */
const appTint = (app: string) => (app === "books" ? "#5c7150" : app === "music" ? "#2e5e8a" : "#a84d63");
const appIcon = (app: string) => (app === "books" ? "book" as const : app === "music" ? "music" as const : "film" as const);

export type Person = { username: string; name: string; picture: string | null };
export type ProfileColor = "suo" | "plum" | "moss" | "ai" | "kuchiba" | "sakura" | "sumi";
export type Item = { app: string; itemId: string; title: string; subtitle: string | null; cover: string | null; href?: string | null; progress?: number | null; rating?: "love" | "up" | "down" | null };
export type Recommendation = Item & { id: string; from: Person; to: Person | null; note: string | null; at: number; seen: boolean; appName: string };
export type Section = { app: string; appName: string; kind: string; title: string; items: Item[] };
/** Private until you're friends: then only `open: false` and who they are comes back (lib/friends/model.ts profileFor). */
export type Profile = Person & { you: boolean; link: "friends" | "asked" | "asking" | null } & (
  | { open: false }
  | { open: true; bio: string; pronouns: string; color: ProfileColor | null; links: { title: string; url: string }[]; widgets?: Widget[] | null; music?: MusicExtras; sections: Section[]; recommendations: Recommendation[]; friends: number; friendList?: Person[] | null; hidden?: string[]; kept?: string[]; privacy?: Privacy; off?: Off[]; kimonoRead?: { since: string } | null }
);
/** What you let friends see (your own profile only): lib/friends/model.ts privacyOf. */
export type Privacy = { invisible: boolean; friends: boolean; apps: { app: string; name: string; shown: boolean; rows: { kind: string; title: string; shown: boolean }[] }[] };
/** A title you took off a row of your profile, to put back (lib/friends/model.ts offProfileList). */
export type Off = Item & { appName: string; kind: string; rowTitle: string; at: number };
type FriendsList = { friends: (Person & { bio: string })[]; asked: Person[]; asking: Person[]; unseen: number };
type Inbox = { received: Recommendation[]; sent: Recommendation[]; profile: Recommendation[] };

async function call<T>(path: string, method = "GET", body?: unknown): Promise<T> {
  const response = await fetch(path, { method, headers: body === undefined ? undefined : { "Content-Type": "application/json" }, body: body === undefined ? undefined : JSON.stringify(body), cache: "no-store" });
  const json = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(typeof json.error === "string" ? json.error : "That didn't work.");
  return json as T;
}
const message = (error: unknown) => (error instanceof Error ? error.message : "That didn't work.");
const first = (p: Person) => (p.name || p.username).split(" ")[0];
/** Where a title opens in its app. */
const hrefOf = (i: Item) => i.href ?? (i.app === "watch" ? `/watch?t=${encodeURIComponent(i.itemId)}` : null);

function Face({ person, size = 44 }: { person: Person; size?: number }) {
  return <InkPortraitFrame seed={person.username} weight={size > 60 ? 3 : 5}><Portrait name={person.name} username={person.username} picture={person.picture} size={Math.round(size * .84)} /></InkPortraitFrame>;
}

/* A book is drawn as Books draws it, in 3D, with a cloth binding when there's no cover; anything else by its cover. */
function Face3D({ item }: { item: Item }) {
  const author = item.subtitle?.split(" · ")[0]?.trim();
  return <Book3D book={{ key: item.itemId, title: item.title, authors: author ? [author] : [], cover: item.cover, pages: null }} />;
}

function Cover({ item }: { item: Item }) {
  return <span className="fr-cover">
    {/* eslint-disable-next-line @next/next/no-img-element -- covers come from each app */}
    {item.cover ? <img src={item.cover} alt="" loading="lazy" /> : <span className="fr-cover-none">{item.title.slice(0, 1)}</span>}
  </span>;
}

/** How they rated it, as a mark on the cover's corner. */
const rated = { love: "Loved", up: "Liked", down: "Didn't like" } as const;
function RatingMark({ rating }: { rating: "love" | "up" | "down" }) {
  return <span className={`fr-rated fr-rated-${rating}`} title={rated[rating]} aria-label={rated[rating]}>
    {rating === "love"
      ? <svg viewBox="0 0 24 24" aria-hidden><path d="M12 20s-7-4.4-7-10a4 4 0 0 1 7-2.6A4 4 0 0 1 19 10c0 5.6-7 10-7 10Z" /></svg>
      : <svg viewBox="0 0 24 24" aria-hidden style={rating === "down" ? { transform: "rotate(180deg)" } : undefined}><path d="M7 11v9H4v-9h3Zm0 0 4-7c1.7 0 2.6 1.2 2.2 2.8L12.6 10H18a2 2 0 0 1 2 2.3l-1.1 6A2 2 0 0 1 17 20H7" /></svg>}
  </span>;
}

function Tile({ item, children }: { item: Item; children?: React.ReactNode }) {
  const href = hrefOf(item);
  const face = <><span className="fr-cover-wrap">{item.app === "books" ? <Face3D item={item} /> : <Cover item={item} />}{item.rating ? <RatingMark rating={item.rating} /> : null}</span>
    {item.progress ? <span className="fr-progress" role="progressbar" aria-valuenow={Math.round(item.progress * 100)} aria-valuemin={0} aria-valuemax={100}><i style={{ width: `${item.progress * 100}%` }} /></span> : null}
    <b>{item.title}</b>{item.subtitle ? <small>{item.subtitle}</small> : null}</>;
  return <div className="fr-tile">
    {href ? <Crossing kind="kakejiku" href={href}>{face}</Crossing> : <span>{face}</span>}
    {children}
  </div>;
}

/* ───── Recommending ───── */

/** Recommend a title: to friends (picked by their portraits), or onto your profile, with a note if you like. */
export function RecommendSheet({ item, onClose, onSent }: { item: Item; onClose: () => void; onSent?: (text: string) => void }) {
  const [friends, setFriends] = useState<Person[] | null>(null);
  const [to, setTo] = useState<string[]>([]);
  const [profile, setProfile] = useState(false);
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  useEffect(() => { call<FriendsList>("/api/v1/friends").then((l) => setFriends(l.friends), (e) => setProblem(message(e))); }, []);
  const toggle = (u: string) => setTo((was) => (was.includes(u) ? was.filter((x) => x !== u) : [...was, u]));
  const send = async () => {
    setBusy(true); setProblem(null);
    try {
      const snapshot = { app: item.app, itemId: item.itemId, title: item.title, subtitle: item.subtitle, cover: item.cover, note };
      if (to.length) await call("/api/v1/recommendations", "POST", { ...snapshot, to });
      if (profile) await call("/api/v1/recommendations", "POST", { ...snapshot, to: [] });
      const names = friends?.filter((f) => to.includes(f.username)).map(first) ?? [];
      onSent?.(names.length ? `Sent to ${names.length > 2 ? `${names.length} friends` : names.join(" and ")}` : "On your profile");
      onClose();
    } catch (error) { setProblem(message(error)); }
    setBusy(false);
  };
  return <InkSheet title="Recommend" icon="send" onClose={onClose} actions={<>
    <Seal tone="quiet" compact onClick={onClose}>Cancel</Seal>
    <Seal compact busy={busy} disabled={!to.length && !profile} onClick={() => void send()}>Send</Seal>
  </>}>
    <div className="fr-rec-item"><Cover item={item} /><span><b>{item.title}</b>{item.subtitle ? <small>{item.subtitle}</small> : null}</span></div>
    {friends === null ? <div className="fr-pick" aria-busy="true" /> : friends.length
      ? <div className="fr-pick" role="group" aria-label="Friends">{friends.map((f) =>
        <button key={f.username} type="button" className="fr-pick-one" aria-label={f.name || f.username} aria-pressed={to.includes(f.username)} onClick={() => toggle(f.username)}>
          <Face person={f} size={56} />{to.includes(f.username) ? <span className="fr-pick-mark"><LineIcon name="check" /></span> : null}
          <span>{first(f)}</span>
        </button>)}</div>
      : <p className="fr-quiet">No friends yet. <Crossing kind="kakejiku" href="/account/friends">Find friends</Crossing></p>}
    <label className="fr-toggle"><span>On my profile</span><JointSwitch name="profile" label="On my profile" defaultChecked={false} onChange={setProfile} /></label>
    <label className="field fr-note"><small>Note</small><textarea rows={3} maxLength={500} value={note} onChange={(e) => setNote(e.target.value)} /></label>
    {problem ? <p className="fr-problem" role="alert">{problem}</p> : null}
  </InkSheet>;
}

/* ───── Friends ───── */

export function FriendsView() {
  const [list, setList] = useState<FriendsList | null>(null);
  const [inbox, setInbox] = useState<Inbox | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  const [typed, setTyped] = useState("");
  const [found, setFound] = useState<Person[]>([]);
  const load = useCallback(() => {
    call<FriendsList>("/api/v1/friends").then(setList, (e) => setProblem(message(e)));
    call<Inbox>("/api/v1/recommendations").then(setInbox, () => {});
  }, []);
  useEffect(load, [load]);
  useEffect(() => {
    if (typed.trim().length < 2) return;
    const timer = setTimeout(() => { call<{ people: Person[] }>(`/api/v1/friends?q=${encodeURIComponent(typed.trim())}`).then((r) => setFound(r.people), () => {}); }, 200);
    return () => clearTimeout(timer);
  }, [typed, list]);
  const change = (type: "ask" | "yes" | "no" | "remove", username: string) =>
    call("/api/v1/friends", "POST", { type, username }).then(load, (e) => setProblem(message(e)));
  const putAway = (r: Recommendation) => {
    setInbox((was) => was && { ...was, received: was.received.filter((x) => x.id !== r.id) });
    void call(`/api/v1/recommendations/${r.id}`, "DELETE").catch(() => load());
  };

  return <div className="you fr">
    <div className="fr-top"><Crossing kind="kakejiku" className="fr-back" href="/account" aria-label="Back"><LineIcon name="back" /></Crossing><h1>Friends</h1></div>
    {problem ? <p className="fr-problem" role="alert">{problem}</p> : null}
    {list?.asked.length ? <>
      <div className="label">Asked to be friends</div>
      <div className="seg">{list.asked.map((p) => <div key={p.username} className="row">
        <Face person={p} /><span className="text"><b>{p.name}</b><small>@{p.username}</small></span>
        <Seal tone="quiet" compact onClick={() => void change("no", p.username)}>Not now</Seal>
        <Seal compact onClick={() => void change("yes", p.username)}>Accept</Seal>
      </div>)}</div>
    </> : null}

    {inbox?.received.length ? <>
      <div className="label">For you</div>
      <div className="fr-shelf k-inkbar">{inbox.received.map((r) => <Tile key={r.id} item={r}>
        <span className="fr-from"><Portrait name={r.from.name} username={r.from.username} picture={r.from.picture} size={20} />{first(r.from)}{r.seen ? null : <i className="fr-new" aria-label="New" />}</span>
        {r.note ? <q className="fr-tile-note">{r.note}</q> : null}
        <button type="button" className="fr-away" aria-label={`Put away ${r.title}`} onClick={() => putAway(r)}><LineIcon name="check" /></button>
      </Tile>)}</div>
    </> : null}

    <div className="label">Your friends</div>
    {!list ? <div className="seg"><div className="row fr-sk" /><div className="row fr-sk" /></div>
      : list.friends.length ? <div className="seg">{list.friends.map((f) =>
        <Crossing key={f.username} kind="kakejiku" className="row" href={`/account/people/${encodeURIComponent(f.username)}`}>
          <Face person={f} /><span className="text"><b>{f.name}</b><small>{f.bio || `@${f.username}`}</small></span><span className="go" />
        </Crossing>)}</div>
        : <p className="fr-quiet fr-pad">No friends yet.</p>}

    <div className="label">Add friends</div>
    <div className="seg">
      <label className="row fr-find"><InkBlot tint="#8a7c77" seed="find people"><LineIcon name="search" /></InkBlot>
        <input type="search" placeholder="Name" value={typed} onChange={(e) => setTyped(e.target.value)} aria-label="Find people" /></label>
      {(typed.trim().length < 2 ? [] : found).map((p) => <div key={p.username} className="row">
        <Face person={p} /><span className="text"><b>{p.name}</b><small>@{p.username}</small></span>
        <Seal compact onClick={() => void change("ask", p.username).then(() => setTyped(""))}>Ask</Seal>
      </div>)}
      {list?.asking.map((p) => <div key={p.username} className="row">
        <Face person={p} /><span className="text"><b>{p.name}</b><small>Asked</small></span>
        <Seal tone="quiet" compact onClick={() => void change("remove", p.username)}>Take back</Seal>
      </div>)}
    </div>
  </div>;
}

/* ───── A profile ───── */

/**
 * A profile as friends see it. Your own is also where you change it, in place: the portrait's camera,
 * the name and the bio are edited where they stand. `home` makes it the You page: no way back,
 * and a gear to Settings (email, password, devices, appearance, signing out).
 */
/* ── A profile ─────────────────────────────────────────────────────────── */

/** The colours a profile can wear (lib/friends/model.ts profileColors), each a pigment of the house. */
export const profileColors: { id: ProfileColor; name: string; hex: string }[] = [
  { id: "suo", name: "Suō", hex: "#a84d63" }, { id: "plum", name: "Plum", hex: "#4e2b37" }, { id: "moss", name: "Moss", hex: "#5c7150" },
  { id: "ai", name: "Indigo", hex: "#2e5e8a" }, { id: "kuchiba", name: "Kuchiba", hex: "#b8732c" }, { id: "sakura", name: "Sakura", hex: "#d77b8c" }, { id: "sumi", name: "Sumi", hex: "#3a3634" },
];
const colorOf = (id: ProfileColor | null | undefined) => profileColors.find((c) => c.id === id) ?? profileColors[0];

/* What a link is, from where it goes: a mark people recognise without any brand drawn. */
function linkMark(url: string): LineIconName {
  if (url.startsWith("mailto:")) return "send";
  const host = (() => { try { return new URL(url).hostname.replace(/^www\./, ""); } catch { return ""; } })();
  if (/instagram|flickr|vsco|500px|unsplash/.test(host)) return "camera";
  if (/youtube|youtu\.be|twitch|tiktok|vimeo|letterboxd|imdb/.test(host)) return "film";
  if (/spotify|soundcloud|bandcamp|music\.apple|last\.fm|deezer|tidal/.test(host)) return "music";
  if (/github|gitlab|codeberg|bitbucket|stackoverflow/.test(host)) return "laptop";
  if (/goodreads|storygraph|substack|medium/.test(host)) return "book";
  if (/twitter|x\.com|bsky|mastodon|threads|facebook|linkedin|discord/.test(host)) return "people";
  return "link";
}

/* What each row of a profile says, in plain words, for Who sees what. */
const rowWords: Record<string, string> = {
  "watch:watching": "What you're watching, and how far",
  "watch:watched": "What you've watched, and how you rated it",
  "watch:listed": "Your watchlist",
  "books:reading": "Books you're reading, and how far",
  "books:want": "Books you want to read",
  "books:read": "Books you've read, and how you rated them",
  "music:playing": "Songs you've been listening to, and what's on now",
  "music:loved": "Songs you love",
  "music:playlists": "Your playlists (friends can open and play them)",
};

export function ProfileView({ username, home = false }: { username: string; home?: boolean }) {
  const [profile, setProfile] = useState<Profile | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  const [asked, setAsked] = useState(0);
  const [removing, setRemoving] = useState(false);
  /* What the × is about to take off, waiting on a yes. */
  const [dropping, setDropping] = useState<{ s: Section; i: Item } | null>(null);
  const [unrecommending, setUnrecommending] = useState<Recommendation | null>(null);
  const [recommending, setRecommending] = useState<Item | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  const [privacyOpen, setPrivacyOpen] = useState(() => typeof window !== "undefined" && new URLSearchParams(location.search).get("sheet") === "privacy");
  const [editing, setEditing] = useState(false);
  /* Your own profile as a friend sees it. */
  const [asFriend, setAsFriend] = useState(false);
  /* Arranging the home screen's widgets (the board saves when it's done). */
  const [arranging, setArranging] = useState(false);
  /* What you took off your profile, open to put back. */
  const [offOpen, setOffOpen] = useState(false);
  const load = useCallback(() => call<Profile>(`/api/v1/profiles/${encodeURIComponent(username)}`).then(setProfile, (e) => setProblem(message(e))), [username]);
  useEffect(() => { void load(); }, [load]);
  const own = profile?.you ?? false;
  useEffect(() => { if (own) call<FriendsList>("/api/v1/friends").then((l) => setAsked(l.asked.length), () => {}); }, [own]);
  useEffect(() => { if (!toast) return; const t = setTimeout(() => setToast(null), 2600); return () => clearTimeout(t); }, [toast]);
  const change = (type: "ask" | "yes" | "no" | "remove") => call("/api/v1/friends", "POST", { type, username }).then(load, (e) => setProblem(message(e)));
  const takeBack = (r: Recommendation) => call(`/api/v1/recommendations/${r.id}`, "DELETE").then(load, (e) => setProblem(message(e)));

  if (!profile) return <div className="you fr">{problem ? <p className="fr-problem" role="alert">{problem}</p> : <div className="stack you-head"><span className="fr-sk-face" /></div>}</div>;
  const p = profile;
  const action = p.link === "friends" ? <Seal tone="quiet" compact onClick={() => setRemoving(true)}><LineIcon name="check" />Friends</Seal>
      : p.link === "asked" ? <><Seal tone="quiet" compact onClick={() => void change("no")}>Not now</Seal><Seal compact onClick={() => void change("yes")}>Accept</Seal></>
        : p.link === "asking" ? <Seal tone="quiet" compact onClick={() => void change("remove")}>Asked</Seal>
          : <Seal compact onClick={() => void change("ask")}>Ask to be friends</Seal>;

  const privacy = p.open ? p.privacy : undefined;
  const invisible = privacy?.invisible ?? false;
  /* Kept from friends: the whole app, or one row of it. */
  const appKept = (app: string) => p.open && (p.hidden?.includes(app) ?? false);
  const rowKept = (app: string, kind: string) => appKept(app) || (p.open && (p.kept?.includes(`${app}:${kind}`) ?? false));
  const friendsKept = p.open && p.you && (invisible || privacy?.friends === false);
  /* Seen as a friend: only what friends see is drawn. */
  const preview = p.you && asFriend;
  const sections = p.open ? p.sections.filter((s) => !preview || (!invisible && !rowKept(s.app, s.kind))) : [];
  const groups = Object.values(sections.reduce<Record<string, Section[]>>((by, s) => { (by[s.app] ??= []).push(s); return by; }, {}));
  /* Your own: one title off one row, for good until you put it back (lib/friends removeFromRow); it leaves at once and comes back if that fails. */
  const drop = (s: Section, i: Item) => {
    if (!p.open) return;
    const left = { ...p, sections: p.sections.map((x) => (x === s ? { ...x, items: x.items.filter((y) => y.itemId !== i.itemId) } : x)).filter((x) => x.items.length > 0) };
    setProfile(left);
    return call<{ off: Off[] }>("/api/v1/profile", "PATCH", { remove: { app: s.app, kind: s.kind, itemId: i.itemId, title: i.title, subtitle: i.subtitle, cover: i.cover } })
      .then((r) => { setProfile({ ...left, off: r.off }); setToast(`Off ${s.title}`); }, (e) => { setProblem(message(e)); void load(); });
  };
  const off = p.open ? p.off ?? [] : [];
  const friendList = p.open && !(preview && friendsKept) ? p.friendList ?? [] : [];
  const color = colorOf(p.open ? p.color : null);
  const onlyYou = <button type="button" className="fr-only" onClick={() => setPrivacyOpen(true)} title="Friends don't see this"><LineIcon name="lock" />Only you</button>;
  /* Invisible, seen as a friend: what they get is your name and portrait. */
  const closedToFriends = preview && invisible;

  return <div className={`you fr fr-profile fr-profile-v2${p.open && !closedToFriends ? "" : " is-closed"}`} style={{ "--fr-color": color.hex } as React.CSSProperties}>
    <header className="fr-hero">
      <div className="fr-band" aria-hidden="true" />
      {home && !p.you ? null : <div className="fr-top">
        {home ? <span /> : <Crossing kind="kakejiku" className="fr-back" href={p.you ? "/account" : "/account/friends"} aria-label="Back"><LineIcon name="back" /></Crossing>}
        {p.you ? <label className="fr-asfriend"><span>View as a friend</span><JointSwitch name="as-friend" label="View your profile as a friend sees it" defaultChecked={false} onChange={setAsFriend} /></label> : null}
      </div>}
      <div className="fr-hero-body">
        {p.you && !preview ? <Crossing kind="kakejiku" className="you-picture fr-hero-face" href="/account?sheet=picture" aria-label="Change your picture">
          <Face person={p} size={148} /><span className="you-camera"><LineIcon name="camera" /></span></Crossing>
          : <span className="you-picture fr-hero-face"><Face person={p} size={148} /></span>}
        <div className="fr-hero-words">
          <h1 className="fr-name">{p.name}{p.open && p.pronouns && !closedToFriends ? <small className="fr-pronouns">{p.pronouns}</small> : null}</h1>
          <p className="fr-handle">@{p.username}{p.open && !closedToFriends ? ` · ${p.friends === 1 ? "1 friend" : `${p.friends} friends`}` : ""}</p>
          {p.open && !closedToFriends && p.links.some((l) => isSocial(l.url)) ? <nav className="fr-socials" aria-label="Elsewhere">
            {/* eslint-disable-next-line no-restricted-syntax -- someone's own links leave Kimono, in a new tab */}
            {p.links.filter((l) => isSocial(l.url)).map((l, i) => <a key={l.url} href={l.url} target="_blank" rel="noopener noreferrer nofollow" title={l.title} aria-label={l.title} style={{ "--i": i } as React.CSSProperties}>
              <Favicon url={l.url} fallback={linkMark(l.url)} />
            </a>)}
          </nav> : null}
        </div>
        <div className="fr-actions">
          {p.you && !preview ? <>
            <Seal compact onClick={() => setEditing(true)}><LineIcon name="brush" />Edit profile</Seal>
            <Seal tone="quiet" compact onClick={() => setPrivacyOpen(true)}><LineIcon name="eye" />Who sees what</Seal>
            {p.open ? <Seal tone="quiet" compact onClick={() => setArranging(!arranging)}><LineIcon name={arranging ? "check" : "pin"} />{arranging ? "Done" : "Arrange"}</Seal> : null}
          </> : p.you ? null : action}
        </div>
      </div>
      <div className="fr-hero-more">
        {p.open && p.bio && !closedToFriends ? <p className="fr-bio">{p.bio}</p> : p.you && !preview && p.open ? <button type="button" className="fr-bio fr-bio-empty" onClick={() => setEditing(true)}>Add a few words about you</button> : null}
        {p.open && p.kimonoRead && !closedToFriends ? <SilkscreenBadge since={p.kimonoRead.since} you={p.you} name={p.name || p.username} /> : null}
        {p.you && invisible && !preview ? <button type="button" className="fr-only fr-only-big" onClick={() => setPrivacyOpen(true)}><LineIcon name="lock" />You&rsquo;re invisible: friends only see your name and picture</button> : null}
        {closedToFriends ? <p className="fr-quiet">You&rsquo;re invisible, so this is all friends see.</p> : null}
      </div>
    </header>
    {p.open && !closedToFriends ? <WidgetBoard
      data={{ person: p, sections, links: p.links, friends: friendList, music: p.music ?? null, color: color.hex }}
      widgets={p.widgets ?? null} editable={p.you && !preview} arranging={arranging && p.you && !preview} onArranging={setArranging}
      onSave={(widgets) => call<{ widgets?: Widget[] }>("/api/v1/profile", "PATCH", { widgets }).then(() => { setProfile({ ...p, widgets }); setToast("Saved"); }, (e) => setProblem(message(e)))} /> : null}
    {problem ? <p className="fr-problem" role="alert">{problem}</p> : null}

    {p.open && !closedToFriends ? <div className="fr-body">
      {p.recommendations.length ? <section className="fr-group fr-card">
        <div className="fr-app-head">
          <InkBlot tint="#a84d63" seed="recommends"><LineIcon name="send" /></InkBlot>
          <h2>Recommends</h2>
        </div>
        <div className="fr-shelf k-inkbar">{p.recommendations.map((r) => <Tile key={r.id} item={r}>
          {r.note ? <q className="fr-tile-note">{r.note}</q> : null}
          {p.you && !preview ? <button type="button" className="fr-away" aria-label={`Take ${r.title} off your profile`} onClick={() => setUnrecommending(r)}><LineIcon name="close" /></button>
            : p.you ? null : <button type="button" className="fr-away" aria-label={`Recommend ${r.title}`} onClick={() => setRecommending(r)}><LineIcon name="send" /></button>}
        </Tile>)}</div>
      </section> : null}

      {groups.map((rows) => {
        const app = rows[0].app;
        const kept = appKept(app) || invisible;
        return <section key={app} className={`fr-group fr-card fr-app-${app}${kept && p.you && !preview ? " is-kept" : ""}`}>
          <div className="fr-app-head">
            <InkBlot tint={appTint(app)} seed={`app:${app}`}><LineIcon name={appIcon(app)} /></InkBlot>
            <h2>{rows[0].appName}</h2>
            {p.you && !preview && kept ? onlyYou : null}
          </div>
          {rows.map((s) => {
            const only = p.you && !preview && !kept && rowKept(app, s.kind);
            return <div key={`${s.app}:${s.kind}`} className={only ? "is-kept" : undefined}>
              <div className="label fr-label">{s.title}{only ? onlyYou : null}</div>
              <div className="fr-shelf k-inkbar">{s.items.map((i) => <Tile key={i.itemId} item={i}>
                {p.you && !preview ? <button type="button" className="fr-away" aria-label={`Take ${i.title} off ${s.title}`} title="Take it off your profile" onClick={() => setDropping({ s, i })}><LineIcon name="close" /></button>
                  : p.you ? null : <button type="button" className="fr-away" aria-label={`Recommend ${i.title}`} onClick={() => setRecommending(i)}><LineIcon name="send" /></button>}
              </Tile>)}</div>
            </div>;
          })}
        </section>;
      })}

      {friendList.length || (p.you && !preview) ? <section className={`fr-group fr-card fr-friends${friendsKept && !preview ? " is-kept" : ""}`}>
        <div className="fr-app-head">
          <InkBlot tint="#74565c" seed="friends"><LineIcon name="people" /></InkBlot>
          <h2>Friends</h2>
          {p.you && !preview && friendsKept ? onlyYou : null}
        </div>
        {friendList.length ? <div className="fr-shelf fr-people k-inkbar">{friendList.slice(0, 12).map((f) =>
          <Crossing key={f.username} kind="kakejiku" className="fr-person" href={`/account/people/${encodeURIComponent(f.username)}`}>
            <Face person={f} size={64} /><span>{first(f)}</span>
          </Crossing>)}</div> : null}
        {p.you && !preview ? <div className="fr-more">
          {asked ? <CrossingSeal compact href="/account/friends"><i className="fr-new" />{asked} asking</CrossingSeal> : null}
          {friendList.length ? <CrossingSeal tone="quiet" compact href="/account/friends">All friends</CrossingSeal>
            : <CrossingSeal compact href="/account/friends"><LineIcon name="search" />Find friends</CrossingSeal>}
        </div> : null}
      </section> : null}
    </div> : null}

    {privacyOpen && privacy ? <WhoSeesWhat privacy={privacy} offCount={off.length} onClose={() => setPrivacyOpen(false)} onOff={() => { setPrivacyOpen(false); setOffOpen(true); }}
      onChanged={(r) => { if (p.open) setProfile({ ...p, privacy: r.privacy, hidden: r.hidden, kept: keptFrom(r.privacy) }); }} /> : null}
    {editing && p.open ? <EditProfileSheet profile={p} onClose={() => setEditing(false)} onSaved={(next) => { setProfile(next); setToast("Saved"); }} /> : null}
    {removing ? <InkSheet title={`Remove ${first(p)}?`} icon="people" onClose={() => setRemoving(false)} actions={<>
      <Seal tone="quiet" compact onClick={() => setRemoving(false)}>Keep</Seal>
      <Seal tone="danger" compact onClick={() => { setRemoving(false); void change("remove"); }}>Remove</Seal>
    </>}><p className="fr-quiet">You&rsquo;ll stop seeing each other&rsquo;s profiles and what you watch, read and listen to.</p></InkSheet> : null}
    {dropping ? <InkSheet title={`Take ${dropping.i.title} off ${dropping.s.title}?`} icon="trash" onClose={() => setDropping(null)} actions={<>
      <Seal tone="quiet" compact onClick={() => setDropping(null)}>Keep</Seal>
      <Seal tone="danger" compact onClick={() => { const d = dropping; setDropping(null); void drop(d.s, d.i); }}>Take off</Seal>
    </>}><p className="fr-quiet">{dropLoses(dropping.s)}</p></InkSheet> : null}
    {unrecommending ? <InkSheet title={`Take ${unrecommending.title} off your profile?`} icon="trash" onClose={() => setUnrecommending(null)} actions={<>
      <Seal tone="quiet" compact onClick={() => setUnrecommending(null)}>Keep</Seal>
      <Seal tone="danger" compact onClick={() => { const r = unrecommending; setUnrecommending(null); void takeBack(r); }}>Take off</Seal>
    </>}><p className="fr-quiet">{unrecommending.note ? "Your note goes with it." : "Friends stop seeing you recommend it."}</p></InkSheet> : null}
    {offOpen ? <OffSheet off={off} onClose={() => setOffOpen(false)}
      onBack={(r, i) => { setToast(`Back on ${i.rowTitle}`); if (!r.length) setOffOpen(false); void load(); }} onProblem={setProblem} /> : null}
    {recommending ? <RecommendSheet item={recommending} onClose={() => setRecommending(null)} onSent={setToast} /> : null}
    {toast ? <div className="fr-toast" role="status">{toast}</div> : null}
  </div>;
}

/* ── Who sees what ─────────────────────────────────────────────────────── */

/** Friends or only me, as two words side by side: what's chosen is filled. */
function Who({ friends, label, disabled, onChange }: { friends: boolean; label: string; disabled?: boolean; onChange: (friends: boolean) => void }) {
  return <span className="fr-who" role="radiogroup" aria-label={label}>
    <button type="button" role="radio" aria-checked={friends} disabled={disabled} className={friends ? "is-on" : undefined} onClick={() => onChange(true)}><LineIcon name="people" />Friends</button>
    <button type="button" role="radio" aria-checked={!friends} disabled={disabled} className={!friends ? "is-on" : undefined} onClick={() => onChange(false)}><LineIcon name="lock" />Only me</button>
  </span>;
}

/**
 * Every privacy choice in one place, in plain words: whether friends see your
 * profile at all, your friends list, and each app and each of its rows. Each
 * choice saves as it's made.
 */
function WhoSeesWhat({ privacy, offCount, onClose, onOff, onChanged }: { privacy: Privacy; offCount: number; onClose: () => void; onOff: () => void; onChanged: (r: { privacy: Privacy; hidden: string[] }) => void }) {
  const [now, setNow] = useState(privacy);
  const [problem, setProblem] = useState<string | null>(null);
  const change = (body: Record<string, unknown>) => call<{ privacy: Privacy; hidden: string[] }>("/api/v1/profile", "PATCH", body)
    .then((r) => { setNow(r.privacy); onChanged(r); setProblem(null); }, (e) => setProblem(message(e)));
  const hidden = now.invisible;
  return <InkSheet title="Who sees what" icon="eye" onClose={onClose} actions={<Seal compact onClick={onClose}>Done</Seal>}>
    <div className="fr-wsw">
      <p className="fr-wsw-lead">Only your friends ever see your profile. Everyone else on this Kimono sees your name and picture.</p>

      <div className="fr-wsw-modes" role="radiogroup" aria-label="Your profile">
        <button type="button" role="radio" aria-checked={!hidden} className={!hidden ? "is-on" : undefined} onClick={() => void change({ invisible: false })}>
          <LineIcon name="people" /><b>Friends see my profile</b><small>What you choose below</small>
        </button>
        <button type="button" role="radio" aria-checked={hidden} className={hidden ? "is-on" : undefined} onClick={() => void change({ invisible: true })}>
          <LineIcon name="lock" /><b>Invisible</b><small>Friends only see your name and picture, and none of your apps</small>
        </button>
      </div>

      <div className={`fr-wsw-rows${hidden ? " is-off" : ""}`}>
        <div className="fr-wsw-row"><span><b>Your friends list</b><small>Who you&rsquo;re friends with</small></span>
          <Who friends={now.friends} label="Your friends list" disabled={hidden} onChange={(f) => void change({ keep: "friends", shown: f })} /></div>
        {now.apps.map((a) => <section key={a.app} className={`fr-wsw-app fr-app-${a.app}`}>
          <div className="fr-wsw-row fr-wsw-apphead">
            <span className="fr-wsw-appname"><InkBlot tint={appTint(a.app)} seed={`app:${a.app}`}><LineIcon name={appIcon(a.app)} /></InkBlot><b>{a.name}</b></span>
            <Who friends={a.shown} label={`${a.name} on your profile`} disabled={hidden} onChange={(f) => void change({ app: a.app, shown: f })} />
          </div>
          {a.rows.map((r) => <div key={r.kind} className={`fr-wsw-row fr-wsw-sub${a.shown ? "" : " is-off"}`}>
            <span>{rowWords[`${a.app}:${r.kind}`] ?? r.title}</span>
            <Who friends={r.shown && a.shown} label={`${a.name}: ${r.title}`} disabled={hidden || !a.shown} onChange={(f) => void change({ keep: `${a.app}:${r.kind}`, shown: f })} />
          </div>)}
        </section>)}
      </div>

      {offCount ? <button type="button" className="fr-wsw-off" onClick={onOff}><LineIcon name="eye" /><span>Things you took off your profile<small>{offCount === 1 ? "1 thing" : `${offCount} things`}: put them back</small></span><LineIcon name="out" /></button> : null}
      {problem ? <p className="fr-problem" role="alert">{problem}</p> : null}
    </div>
  </InkSheet>;
}

/* ── Editing your profile ──────────────────────────────────────────────── */

type Look = { pronouns: string; color: ProfileColor | null; links: { title: string; url: string }[] };

/** Your name, pronouns, words, colour and links, in one place, saved together. */
function EditProfileSheet({ profile, onClose, onSaved }: { profile: Profile & { open: true }; onClose: () => void; onSaved: (p: Profile) => void }) {
  const router = useRouter();
  const [name, setName] = useState(profile.name);
  const [pronouns, setPronouns] = useState(profile.pronouns);
  const [bio, setBio] = useState(profile.bio);
  const [color, setColor] = useState<ProfileColor | null>(profile.color);
  const [links, setLinks] = useState(profile.links.length ? profile.links : [{ title: "", url: "" }]);
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const save = async () => {
    setBusy(true); setProblem(null);
    try {
      if (name.trim() && name.trim() !== profile.name) { await call("/api/v1/me", "PATCH", { name: name.trim() }); router.refresh(); }
      const look = await call<Look & { bio: string }>("/api/v1/profile", "PATCH", { pronouns, color, bio, links: links.filter((l) => l.url.trim()) });
      onSaved({ ...profile, name: name.trim() || profile.name, ...look });
      onClose();
    } catch (error) { setProblem(message(error)); }
    setBusy(false);
  };
  const setLink = (i: number, part: Partial<{ title: string; url: string }>) => setLinks((ls) => ls.map((l, j) => (j === i ? { ...l, ...part } : l)));
  return <InkSheet title="Edit profile" icon="brush" onClose={onClose} actions={<>
    <Seal tone="quiet" compact onClick={onClose}>Cancel</Seal>
    <Seal compact busy={busy} onClick={() => void save()}>Save</Seal>
  </>}>
    <div className="fr-edit">
      <div className="fr-edit-two">
        <label className="field"><small>Name</small><input value={name} maxLength={80} onChange={(e) => setName(e.target.value)} autoComplete="name" /></label>
        <label className="field"><small>Pronouns</small><input value={pronouns} maxLength={30} placeholder="they/them" onChange={(e) => setPronouns(e.target.value)} /></label>
      </div>
      <label className="field"><small>About you</small><textarea rows={3} maxLength={280} value={bio} onChange={(e) => setBio(e.target.value)} /></label>
      <div className="fr-edit-colors" role="radiogroup" aria-label="Colour">
        <small className="fr-edit-label">Colour</small>
        <div>{profileColors.map((c) => <button key={c.id} type="button" role="radio" aria-checked={(color ?? "suo") === c.id} aria-label={c.name} title={c.name}
          style={{ "--swatch": c.hex } as React.CSSProperties} className={(color ?? "suo") === c.id ? "is-on" : undefined} onClick={() => setColor(c.id)} />)}</div>
      </div>
      <div className="fr-edit-links">
        <small className="fr-edit-label">Links</small>
        {links.map((l, i) => <div key={i} className="fr-edit-link">
          <span className="fr-link-mark"><LineIcon name={l.url ? linkMark(/^[a-z]+:/i.test(l.url) ? l.url : `https://${l.url}`) : "link"} /></span>
          <input aria-label="Link address" placeholder="instagram.com/you" value={l.url} onChange={(e) => setLink(i, { url: e.target.value })} inputMode="url" />
          <input aria-label="Link title" placeholder="Title" value={l.title} maxLength={40} onChange={(e) => setLink(i, { title: e.target.value })} />
          <span className="fr-edit-move">
            <button type="button" aria-label="Move up" disabled={i === 0} onClick={() => setLinks((ls) => { const o = [...ls]; [o[i - 1], o[i]] = [o[i], o[i - 1]]; return o; })}><LineIcon name="up" /></button>
            <button type="button" aria-label="Move down" disabled={i === links.length - 1} onClick={() => setLinks((ls) => { const o = [...ls]; [o[i + 1], o[i]] = [o[i], o[i + 1]]; return o; })}><LineIcon name="down" /></button>
          </span>
          <button type="button" className="fr-edit-drop" aria-label="Remove this link" onClick={() => setLinks((ls) => ls.length > 1 ? ls.filter((_, j) => j !== i) : [{ title: "", url: "" }])}><LineIcon name="close" /></button>
        </div>)}
        {links.length < 8 ? <button type="button" className="fr-edit-add" onClick={() => setLinks((ls) => [...ls, { title: "", url: "" }])}><LineIcon name="plus" />Add a link</button> : null}
      </div>
      {problem ? <p className="fr-problem" role="alert">{problem}</p> : null}
    </div>
  </InkSheet>;
}

/** What taking a title off a row means, said before it's done (lib/friends removeFromRow): only the profile forgets it. */
const dropLoses = (s: Section) =>
  s.app === "books" && s.kind === "reading" ? "Your progress stays. Put it back from Taken off."
      : `It stays in ${s.appName}. Put it back from Taken off.`;

/** What you took off your profile, each with the row it came off; Put back returns it there. */
function OffSheet({ off, onClose, onBack, onProblem }: { off: Off[]; onClose: () => void; onBack: (left: Off[], back: Off) => void; onProblem: (problem: string) => void }) {
  const [left, setLeft] = useState(off);
  const back = (o: Off) => call<{ off: Off[] }>("/api/v1/profile", "PATCH", { restore: { app: o.app, kind: o.kind, itemId: o.itemId } })
    .then((r) => { setLeft(r.off); onBack(r.off, o); }, (e) => onProblem(message(e)));
  return <InkSheet title="Taken off" icon="eye" onClose={onClose} actions={<Seal compact onClick={onClose}>Done</Seal>}>
    <ul className="fr-off">{left.map((o) => <li key={`${o.app}:${o.kind}:${o.itemId}`}>
      <Cover item={o} />
      <span className="fr-off-words"><b>{o.title}</b><small>{o.appName} · {o.rowTitle}</small></span>
      <Seal tone="quiet" compact onClick={() => void back(o)}>Put back</Seal>
    </li>)}</ul>
  </InkSheet>;
}

const keptFrom = (privacy: Privacy) => [
  ...(privacy.friends ? [] : ["friends"]),
  ...privacy.apps.flatMap((a) => a.rows.filter((r) => !r.shown).map((r) => `${a.app}:${r.kind}`)),
];

/** Settings' privacy row: where you stand, and the way to Who sees what (on your profile). */
export function InvisibleRow() {
  const [me, setMe] = useState<{ username: string; invisible: boolean } | null>(null);
  useEffect(() => { call<Profile>("/api/v1/profile").then((p) => setMe({ username: p.username, invisible: p.open ? p.privacy?.invisible ?? false : false }), () => {}); }, []);
  return <Crossing kind="kakejiku" className="row you-invisible" href={me ? `/account/people/${encodeURIComponent(me.username)}?sheet=privacy` : "/account"}>
    <InkBlot tint="#74565c" seed="invisible"><LineIcon name={me?.invisible ? "lock" : "eye"} /></InkBlot>
    <span className="text"><b>Who sees what</b><small>{me === null ? " " : me.invisible ? "Invisible: friends only see your name and picture" : "Friends see your profile, as you choose"}</small></span>
    <LineIcon name="out" />
  </Crossing>;
}
