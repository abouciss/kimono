import { apiJson, apiUser, crossSite, unauthorized } from "@/lib/api-v1";
import { code, db, deploySite, requireProject, workspaceFor } from "@/lib/code";

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
    await deploySite(config, workspace);
    return apiJson(workspaceFor(db(), id, user.username));
  });
}
