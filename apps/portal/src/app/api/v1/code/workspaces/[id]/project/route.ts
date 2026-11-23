import { apiJson, apiUser, crossSite, readJson, unauthorized } from "@/lib/api-v1";
import { chatIntoProject, code, db, workspaceFor } from "@/lib/code";

type Context = { params: Promise<{ id: string }> };

/** Makes the chat a project, with its files: `{ name, offer? }` (offer: the agent's own, being answered), or `{ offer, decline: true }`. */
export async function POST(request: Request, { params }: Context) {
  const refused = crossSite(request);
  if (refused) return refused;
  const user = await apiUser();
  if (!user) return unauthorized();
  const read = await readJson(request);
  if ("response" in read) return read.response;
  const { id } = await params;
  return code(user, async (config) => {
    await chatIntoProject(config, workspaceFor(db(), id, user.username), user, read.body as { offer?: unknown; name?: unknown; decline?: unknown });
    return apiJson(workspaceFor(db(), id, user.username));
  });
}
