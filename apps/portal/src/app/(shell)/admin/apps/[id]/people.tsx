import type { ReactNode } from "react";
import { Choice } from "@kimono/ui";
import { PendingButton } from "@/components/pending-button";
import { Portrait } from "@/components/portrait";
import { portalOrigin } from "@/lib/account";
import { creditGrants, db, ownShare, usageGrants, usageOf } from "@/lib/code";
import { codeConfig } from "@/lib/code/config";
import { instantSpent } from "@/lib/code/composio";
import { monthOf } from "@/lib/code/media";
import { listAccounts, syncAccountsFromIdentity, type Account } from "@/lib/directory";
import { picturePaths } from "@/lib/pictures";
import { getPlatformSettings } from "@/lib/settings";
import { mostScreens, screenAsks, screensOf, watchDb } from "@/lib/watch";
import { answerScreens, changeScreens, changeShare, giveCredits, giveShare, takeBackGivenCredits, takeBackShare } from "./people-actions";

/* Shares are fractions of the whole plan: one person's use is often well under a percent, so small figures keep a decimal. */
const pct = (fraction: number) => {
  const n = fraction * 100;
  if (n <= 0) return "0%";
  if (n < 0.1) return "<0.1%";
  return n < 10 ? `${Number(n.toFixed(1))}%` : `${Math.round(n)}%`;
};
const credits = (dollars: number) => Math.round(dollars * 100).toLocaleString("en");
const until = (at: number) => new Date(at).toLocaleString("en", { weekday: "short", hour: "numeric", minute: "2-digit" });
const day = (at: number) => new Date(at).toLocaleDateString("en", { month: "long", day: "numeric", timeZone: "UTC" });
const shareChoices = [5, 10, 20, 30, 50, 75, 100];

/** What someone spent on Pro Tools this month, from the logs read at most every few minutes; null when they can't be read. */
async function spentThisMonth(composioKey: string, username: string) {
  const now = Date.now();
  return instantSpent(composioKey, username, portalOrigin(), monthOf(now).from, now, 300_000).catch(() => null);
}

type Person = { account: Account; key: string; line: string; badge?: ReactNode; body: ReactNode };

/** Everyone, with their pictures; refreshed so someone who just signed up is here at once. */
async function everyone() {
  await syncAccountsFromIdentity().catch(() => null);
  const [accounts, pictures] = await Promise.all([listAccounts(), picturePaths()]);
  return { accounts, pictures };
}

const hidden = (app: string, username: string) => <><input type="hidden" name="app" value={app} /><input type="hidden" name="username" value={username} /></>;

/** Kimono AI's People view: each person's use of the plan against their share, and their Pro Tools credits. */
export async function AiPeople({ me, open }: { me: { username: string; role?: string }; open?: string }) {
  const [{ accounts, pictures }, settings] = await Promise.all([everyone(), getPlatformSettings()]);
  const config = codeConfig(settings);
  const grants = usageGrants(db()), given = creditGrants(db());
  const spent = new Map(await Promise.all(accounts.map(async (a) => [a.username.toLowerCase(), config.composioKey ? await spentThisMonth(config.composioKey, a.username.toLowerCase()) : null] as const)));
  const hide = (username: string) => hidden("kimono-code", username);

  const people: Person[] = accounts.map((account) => {
    const key = account.username.toLowerCase();
    const owner = key === me.username.toLowerCase() && me.role === "owner";
    const used = usageOf(db(), key), own = ownShare(db(), key);
    const theirs = grants.filter((g) => g.username === key), theirCredits = given.filter((g) => g.username === key);
    const extra = (window: "week" | "five_hour") => theirs.filter((g) => g.window === window).reduce((total, g) => total + g.extra, 0);
    const week = (own.week ?? config.shares.week) + extra("week"), fiveHour = (own.fiveHour ?? config.shares.fiveHour) + extra("five_hour");
    const budget = config.mediaBudget + theirCredits.reduce((total, g) => total + g.dollars, 0);
    const mine = spent.get(key) ?? null;
    const shareForm = (window: "week" | "five_hour", set: number | null, everyone: number) => <form action={changeShare} className="person-give">{hide(account.username)}<input type="hidden" name="window" value={window} />
      <Choice compact name="share" aria-label={window === "week" ? "Share of the week" : "Share of each 5-hour window"} defaultValue={set == null ? "default" : String(Math.round(set * 100))}
        options={[{ value: "default", label: `Everyone's share (${pct(everyone)})` }, ...[...new Set([...shareChoices, ...(set == null ? [] : [Math.round(set * 100)])])].sort((a, b) => a - b).map((n) => ({ value: String(n), label: `${n}% share` }))]} />
      <PendingButton seal compact tone="quiet" pending="Saving…">Save</PendingButton>
    </form>;
    return {
      account: { ...account, name: account.name || account.username }, key,
      line: [
        owner ? `${pct(used.week.used)} of the plan this week` : `${pct(used.week.used)} of ${pct(week)} this week`,
        config.composioKey && budget > 0 ? `${mine == null ? "" : `${credits(mine)} of `}${credits(budget)} credits` : null,
      ].filter(Boolean).join(" · "),
      badge: own.week != null || own.fiveHour != null ? <span className="k-ink-dot">Own share</span> : null,
      body: <>
        <section className="person-part">
          <h3>This week</h3>
          <Meter used={used.week.used} share={owner ? null : week} resets={used.week.resetsAt} />
          {owner ? <p className="person-note">Your plan, so your use isn&rsquo;t limited.</p> : shareForm("week", own.week, config.shares.week)}
          {used.fiveHourLimited ? <>
            <h3>These 5 hours</h3>
            <Meter used={used.fiveHour.used} share={owner ? null : fiveHour} resets={used.fiveHour.resetsAt} />
            {owner ? null : shareForm("five_hour", own.fiveHour, config.shares.fiveHour)}
          </> : null}
          {theirs.map((g) => <form key={g.id} action={takeBackShare} className="person-grant">{hide(account.username)}<input type="hidden" name="grant" value={g.id} />
            <small>+{pct(g.extra)} {g.window === "week" ? "this week" : "these 5 hours"}, until {until(g.until)}</small>
            <PendingButton className="txt" pending="Taking back…">Take back</PendingButton>
          </form>)}
          {owner ? null : <form action={giveShare} className="person-give">{hide(account.username)}
            <Choice compact name="extra" aria-label="How much more" defaultValue="20" options={[10, 20, 50, 100].map((n) => ({ value: String(n), label: `+${n}%` }))} />
            <Choice compact name="window" aria-label="For" defaultValue="week" options={[{ value: "week", label: "This week" }, ...(used.fiveHourLimited ? [{ value: "five_hour", label: "These 5 hours" }] : [])]} />
            <PendingButton seal compact pending="Giving…">Give more</PendingButton>
          </form>}
        </section>
        {config.composioKey ? <section className="person-part">
          <h3>Pro Tools credits</h3>
          <Meter used={mine ?? 0} share={budget} unknown={mine == null} format={credits} resetsLabel="this month" />
          {theirCredits.map((g) => <form key={g.id} action={takeBackGivenCredits} className="person-grant">{hide(account.username)}<input type="hidden" name="grant" value={g.id} />
            <small>+{credits(g.dollars)} credits, until {day(g.until)}</small>
            <PendingButton className="txt" pending="Taking back…">Take back</PendingButton>
          </form>)}
          <form action={giveCredits} className="person-give">{hide(account.username)}
            <Choice compact name="credits" aria-label="How many credits" defaultValue="1000" options={[500, 1000, 2500, 5000].map((n) => ({ value: String(n), label: `+${n.toLocaleString("en")}` }))} />
            <PendingButton seal compact pending="Giving…">Give credits</PendingButton>
          </form>
        </section> : null}
      </>,
    };
  });
  return <PeopleWithPictures people={people} pictures={pictures} open={open} />;
}

/** Kimono Watch's People view: who's asking for more screens, and how many each may watch on at once. */
export async function WatchPeople({ open }: { open?: string }) {
  const { accounts, pictures } = await everyone();
  const watch = watchDb();
  const asks = screenAsks(watch);
  const hide = (username: string) => hidden("kimono-watch", username);
  const people: Person[] = accounts.map((account) => {
    const screens = screensOf(watch, account.username), ask = asks.find((a) => a.username === account.username);
    return {
      account: { ...account, name: account.name || account.username }, key: account.username.toLowerCase(),
      line: `${screens} screens at once${ask ? ` · asking for ${ask.want}` : ""}`,
      badge: ask ? <span className="k-ink-dot k-wants">Asking</span> : null,
      body: <section className="person-part">
        <h3>Screens at once</h3>
        {ask ? <div className="person-give">
          <small>Asking for {ask.want}</small>
          <form action={answerScreens}>{hide(account.username)}<input type="hidden" name="decision" value="decline" /><PendingButton className="txt person-txt" pending="Declining…">Decline</PendingButton></form>
          <form action={answerScreens}>{hide(account.username)}<input type="hidden" name="decision" value="approve" /><PendingButton seal compact pending="Approving…">Approve</PendingButton></form>
        </div> : null}
        <form action={changeScreens} className="person-give">{hide(account.username)}
          <Choice compact name="screens" aria-label="Screens at once" defaultValue={String(screens)} options={Array.from({ length: mostScreens - 1 }, (_, i) => i + 2).map((n) => ({ value: String(n), label: `${n} screens` }))} />
          <PendingButton seal compact tone="quiet" pending="Saving…">Save</PendingButton>
        </form>
      </section>,
    };
  }).sort((a, b) => Number(Boolean(b.badge)) - Number(Boolean(a.badge)));
  return <PeopleWithPictures people={people} pictures={pictures} open={open} />;
}

function PeopleWithPictures({ people, pictures, open }: { people: Person[]; pictures: Record<string, string | undefined>; open?: string }) {
  const withPictures = people.map((p) => ({ ...p, account: { ...p.account, picture: pictures[p.key] } }));
  return <PeopleRows people={withPictures} open={open} />;
}

/** One row a person: a line of what they have, opened to change it. */
function PeopleRows({ people, open }: { people: (Person & { account: Account & { picture?: string } })[]; open?: string }) {
  if (!people.length) return <p className="lead">Nobody has signed in yet.</p>;
  return <div className="people">
    {people.map((p) => <details className="person" key={p.key} id={`p-${p.key}`} open={open === p.key}>
      <summary className="person-row">
        <Portrait name={p.account.name} username={p.account.username} picture={p.account.picture} size={40} />
        <span className="text"><b>{p.account.name}</b><small>@{p.account.username}{p.line ? ` · ${p.line}` : ""}</small></span>
        {p.badge}
        <span className="go" />
      </summary>
      <div className="person-body">{p.body}</div>
    </details>)}
  </div>;
}

/** How much of something a person has used, against what they may (none: not limited), as a line and a bar. */
function Meter({ used, share, resets, unknown, format = pct, resetsLabel }: { used: number; share: number | null; resets?: number | null; unknown?: boolean; format?: (n: number) => string; resetsLabel?: string }) {
  const filled = share ? Math.min(1, used / share) : 0;
  const words = unknown ? `${format(share ?? 0)} to spend` : share == null ? `${format(used)} of the plan` : `${format(used)} of ${format(share)}`;
  return <div className="person-meter">
    <small>{words}{resetsLabel ? ` ${resetsLabel}` : ""}{resets ? ` · resets ${until(resets)}` : ""}</small>
    {share != null && !unknown ? <span className={filled >= 1 ? "bar is-full" : "bar"} role="meter" aria-valuemin={0} aria-valuemax={1} aria-valuenow={filled}><i style={{ width: `${filled * 100}%` }} /></span> : null}
  </div>;
}
