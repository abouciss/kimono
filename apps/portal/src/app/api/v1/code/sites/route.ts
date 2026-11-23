import { apiJson, apiUser, crossSite, readJson, unauthorized } from "@/lib/api-v1";
import { code, hostRepository } from "@/lib/code";

/**
 * Hosts a Kimono Git repository as it is: `{ owner, name, branch? }`. Its site goes up from what's on the branch
 * (the repository's main one unless said), and follows every push to it. Answers with its workspace, whose
 * `preview.url` is the link. Asking again for one already hosted puts it up again.
 */
export async function POST(request: Request) {
  const refused = crossSite(request);
  if (refused) return refused;
  const user = await apiUser();
  if (!user) return unauthorized();
  const read = await readJson(request);
  if ("response" in read) return read.response;
  return code(user, async (config) => apiJson(await hostRepository(config, user, read.body as { owner?: unknown; name?: unknown; branch?: unknown }), 201));
}
