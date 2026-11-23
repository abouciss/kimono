import { apiJson, apiUser, crossSite, unauthorized } from "@/lib/api-v1";
import { code, CodeProblem, db, deploySite, requireProject, workspaceFor } from "@/lib/code";

type Context = { params: Promise<{ id: string }> };

/** Puts a hosted repository's site up again from its branch's latest commit, now rather than within the minute. */
export async function POST(request: Request, { params }: Context) {
  const refused = crossSite(request);
  if (refused) return refused;
  const user = await apiUser();
  if (!user) return unauthorized();
  const { id } = await params;
  return code(user, async (config) => {
    const workspace = workspaceFor(db(), id, user.username);
    requireProject(user, workspace);
    if (!workspace.hosted) throw new CodeProblem("This isn't a hosted repository.", 400);
    /* It can take minutes when the site builds: the timeline says how it went. */
    void deploySite(config, workspace).catch(() => {});
    return apiJson(workspaceFor(db(), id, user.username));
  });
}
