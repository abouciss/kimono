import { apiJson, apiUser, unauthorized } from "@/lib/api-v1";
import { code, db, extraOf, allowedShare, usageOf } from "@/lib/code";
import { chatSpent, holdMediaBudget } from "@/lib/code/media";
import { portalOrigin } from "@/lib/account";

/** The signed-in person's use of the Claude plan behind Code (this 5-hour window and this week, as a fraction of what they may use), and of this month's Pro Tools allowance. */
export async function GET(request: Request) {
  const user = await apiUser();
  if (!user) return unauthorized();
  return code(user, async (config) => {
    const used = usageOf(db(), user.username), extra = extraOf(db(), user.username);
    const media = await holdMediaBudget(db(), config, user.username, portalOrigin()).catch(() => null);
    /* ?chat=<id>: also what that chat of theirs spent, so it can say so even under half the allowance. */
    const chat = new URL(request.url).searchParams.get("chat");
    const inChat = media && chat && /^[A-Za-z0-9_-]{1,80}$/.test(chat) && db().prepare("SELECT 1 FROM workspaces WHERE id = ? AND owner = ?").get(chat, user.username.toLowerCase()) ? chatSpent(db(), chat, user.username) : 0;
    const unlimited = user.role === "owner";
    const share = allowedShare(db(), config.shares, user.username);
    /*
     * Never the share itself: a person sees how much of what they may use is gone (share 1), so nobody
     * learns what anyone was given. The owner, who isn't limited, sees their use of the whole plan.
     */
    const own = (used: number, allowed: number) => unlimited ? used : allowed > 0 ? used / allowed : 1;
    return apiJson({
      model: "Opus 5.5",
      unlimited,
      reported: used.reported,
      /* The whole plan's use is the owner's business alone. */
      plan: unlimited ? used.plan : { fiveHour: null, week: null },
      fiveHourLimited: used.fiveHourLimited,
      fiveHour: { used: own(used.fiveHour.used, share.fiveHour + extra.fiveHour), share: 1, resetsAt: used.fiveHour.resetsAt },
      week: { used: own(used.week.used, share.week + extra.week), share: 1, resetsAt: used.week.resetsAt },
      media: media && media.budget > 0 ? { budget: media.budget, spent: media.spent, resetsAt: media.resetsAt, chatSpent: inChat } : null,
    });
  });
}
