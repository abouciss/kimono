import { AppShell, railApps } from "@/components/app-shell";
import { HomeApps } from "@/components/home-apps";
import { Crossing } from "@/components/crossing";
import { getPlatformSettings } from "@/lib/settings";
import { auth } from "@/auth";
import { redirect } from "next/navigation";
import { KimonoAppOffer } from "@/components/kimono-app-offer";
import { appOffer } from "@/lib/app-offer";
import { homeLines } from "@/lib/home-lines";
import { homeGlance } from "@/lib/home-glance";
import { categorize } from "@/lib/app-categories";
import { myApps } from "@/lib/my-apps";
import { AppBloom, InkBlot } from "@kimono/ui";
import { Portrait } from "@/components/portrait";
import { portalOrigin } from "@/lib/account";
import { activityOf, friendsList, type ActivityView } from "@/lib/friends";
import type { RailApp } from "@/components/rail";
import type { ReactNode } from "react";

/*
 * 家 Home, in three parts that don't run into each other: Your apps (the same
 * list as the rail and the phone's flower), Now (a few lines each from Kimono
 * AI, Drive and your devices, only those with something to say), and More
 * apps, every other app by what it's for. Friends' latest (lib/friends activityOf) is one of Now's glances,
 * and Friends, your people as portraits, sits between Your apps and Now.
 */
export default async function HomePage() {
  const session = await auth();
  if (!session?.user) redirect("/login");
  const user = session.user;
  const [settings, apps, offer, mine] = await Promise.all([getPlatformSettings(), railApps(user.username), appOffer(), myApps(user.username)]);
  const ids = apps.map((app) => app.id);
  const [glance, lines, recent, people] = [await homeGlance(user, ids), homeLines(user.username, ids), await activityOf(user.username, portalOrigin(), 24).then((a) => a.items).catch(() => [] as ActivityView[]), await friendsList(user.username).catch(() => null)];
  const activity = recent.slice(0, 4);
  const tiles = apps.map((app) => ({ ...app, line: lines[app.id] }));
  const groups = categorize(tiles).map((group) => ({ id: group.id, label: group.label, apps: group.apps.map((app) => app.id) }));
  const displayName = user.name?.split(" ")[0] || user.username || "home";
  const byId = new Map(apps.map((app) => [app.id, app]));
  const today = new Intl.DateTimeFormat("en-GB", { weekday: "long", day: "numeric", month: "long" }).format(new Date());

  return (
    <AppShell user={user} brandColors={settings.brand.colors} active="home">
      <div className="page home-page">
        <KimonoAppOffer android={Boolean(offer.android)} ios={offer.ios} place="top" />
        <header className="home-greeting">
          <p className="hero-kicker">{today}</p>
          <h1>Welcome home, <strong>{displayName}.</strong></h1>
        </header>
        <HomeApps apps={tiles} mine={mine} groups={groups}>
          {people ? <Friends people={people} recent={recent} /> : null}
          {glance.chats || glance.files || glance.devices?.length || activity.length ? <section className="home-section home-now">
          <h2 className="home-section-title">Now</h2>
          <div className="home-glances">
            {glance.chats ? <Glance app={byId.get("kimono-code")} title="Kimono AI" href="/code" note={glance.chatTotals?.working ? `${glance.chatTotals.working} working` : undefined}>
              {glance.chats.length ? glance.chats.slice(0, 3).map((chat) => <Line key={chat.id} href={`/code#w=${chat.id}`} mark={<span className={chat.working ? "home-dot is-live" : "home-dot"} />} title={chat.title} detail={[chat.project, chat.working ? "working" : ago(chat.at)].filter(Boolean).join(" · ")} />)
                : <Line href="/code" mark={<InkBlot seed="new-chat" tint="#a84d63"><span className="home-plus">+</span></InkBlot>} title="Start a chat" />}
            </Glance> : null}
            {glance.files ? <Glance app={byId.get("kimono-drive")} title="Recent in Drive" href="/drive?view=recent" note={glance.fileTotals?.today ? `${glance.fileTotals.today} today` : undefined}>
              {glance.files.length ? glance.files.slice(0, 3).map((file) => <Line key={file.id} href={`/drive?space=${encodeURIComponent(file.spaceId)}&file=${encodeURIComponent(file.id)}`} mark={<InkBlot seed={file.id} tint="#8a7c77"><span className="home-ext">{extension(file.name)}</span></InkBlot>} title={file.name} detail={[file.space, ago(file.at)].filter(Boolean).join(" · ")} />)
                : <Line href="/drive" mark={<InkBlot seed="drive-empty" tint="#a84d63"><span className="home-plus">+</span></InkBlot>} title="Add your first file" />}
            </Glance> : null}
            {activity.length ? <Glance title="Friends" href="/account/friends">
              {activity.map((a) => <FriendLine key={`${a.from.username}:${a.app}:${a.itemId}`} activity={a} />)}
            </Glance> : null}
            {glance.devices?.length ? <Glance app={byId.get("kimono-vpn")} title="Your devices" href="/vpn">
              {glance.devices.slice(0, 3).map((device) => <Line key={device.id} href="/vpn" mark={<span className={device.online ? "home-dot is-live" : "home-dot"} />} title={device.name} detail={device.online ? "Connected" : device.seen} />)}
            </Glance> : null}
          </div>
          </section> : null}
        </HomeApps>
        <KimonoAppOffer android={Boolean(offer.android)} ios={offer.ios} place="bottom" />
      </div>
    </AppShell>
  );
}

function Glance({ app, title, href, note, children }: { app?: RailApp; title: string; href: string; note?: string; children: ReactNode }) {
  return <section className="home-glance">
    <Crossing kind="kakejiku" href={href} className="home-glance-head">
      {app ? <AppBloom identity={{ id: app.id, name: app.name, accent: app.accent, glyph: app.glyph }} glyphHref={app.iconUrl || undefined} size="mark" /> : null}
      <h2>{title}</h2>
      {note ? <span className="home-glance-note">{note}</span> : null}
    </Crossing>
    <div className="home-glance-lines">{children}</div>
  </section>;
}

function Line({ href, mark, title, detail }: { href: string; mark: ReactNode; title: string; detail?: string }) {
  return <Crossing kind="kakejiku" href={href} className="home-line">
    <span className="home-line-mark">{mark}</span>
    <span className="home-line-text"><b>{title}</b>{detail ? <small>{detail}</small> : null}</span>
  </Crossing>;
}

type FriendsNow = Awaited<ReturnType<typeof friendsList>>;

/** Your friends as portraits: whoever's watching now first, then whoever did something last, then by name; a + to find more. */
function Friends({ people, recent }: { people: FriendsNow; recent: ActivityView[] }) {
  const live = new Set(recent.filter((a) => a.kind === "watching").map((a) => a.from.username));
  const last = new Map<string, number>();
  for (const a of recent) last.set(a.from.username, Math.max(last.get(a.from.username) ?? 0, a.at));
  const shown = [...people.friends].sort((a, b) => Number(live.has(b.username)) - Number(live.has(a.username)) || (last.get(b.username) ?? 0) - (last.get(a.username) ?? 0));
  const asked = people.asked.length;
  return <section className="home-section home-friends">
    <h2 className="home-section-title"><Crossing kind="kakejiku" href="/account/friends">Friends</Crossing>{asked ? <span className="home-friends-asked">{asked} asked you</span> : null}</h2>
    <div className="home-people">
      {shown.map((p) => <Crossing key={p.username} kind="kakejiku" href={`/account/people/${encodeURIComponent(p.username)}`} className="home-person" aria-label={p.name || p.username}>
        <span className="home-person-face">
          <Portrait name={p.name} username={p.username} picture={p.picture} size={64} />
          {live.has(p.username) ? <span className="home-dot is-live" /> : null}
        </span>
        <span className="home-person-name">{p.name?.split(" ")[0] || p.username}</span>
      </Crossing>)}
      <Crossing kind="kakejiku" href="/account/friends" className="home-person home-person-add" aria-label="Add friends">
        <span className="home-person-face"><InkBlot seed="add-friend" tint="#a84d63"><span className="home-plus">+</span></InkBlot></span>
        <span className="home-person-name">{shown.length ? "Add" : "Add friends"}</span>
      </Crossing>
    </div>
  </section>;
}

/** A friend's latest: their portrait opens their profile, the rest the title. */
function FriendLine({ activity: a }: { activity: ActivityView }) {
  const who = a.from.name.split(" ")[0] || a.from.username;
  const what = { watching: "is watching", watched: "watched", reading: "is reading", read: "finished", listening: "listened to", recommended: "recommends" }[a.kind];
  const detail = [`${who} ${what}`, a.kind === "watching" ? a.label : a.kind === "reading" && a.progress ? `${Math.round(a.progress * 100)}%` : ago(a.at)].filter(Boolean).join(" · ");
  return <div className="home-line home-friend">
    <Crossing kind="kakejiku" href={`/account/people/${encodeURIComponent(a.from.username)}`} className="home-line-mark" aria-label={a.from.name}>
      <Portrait name={a.from.name} username={a.from.username} picture={a.from.picture} size={36} />
    </Crossing>
    <Crossing kind="kakejiku" href={a.href ?? `/account/people/${encodeURIComponent(a.from.username)}`} className="home-line-text">
      <b>{a.title}</b><small>{a.kind === "watching" ? <span className="home-dot is-live" /> : null}{detail}</small>
    </Crossing>
  </div>;
}

const extension = (name: string) => (/\.([a-z0-9]{1,4})$/i.exec(name)?.[1] ?? "").toUpperCase() || "·";

function ago(at: number) {
  const minutes = Math.round((Date.now() - at) / 60_000);
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes}m ago`;
  if (minutes < 60 * 24) return `${Math.round(minutes / 60)}h ago`;
  const days = Math.round(minutes / (60 * 24));
  return days < 30 ? `${days}d ago` : new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "short" }).format(at);
}
