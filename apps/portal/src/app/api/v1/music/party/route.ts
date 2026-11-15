import { apiError, apiJson, apiUser, crossSite, readJson, unauthorized } from "@/lib/api-v1";
import { music } from "@/lib/music";
import { partiesFor, startParty } from "@/lib/music/party-live";

export const dynamic = "force-dynamic";

/** Listen parties you could be in now: yours, ones you were asked to, friends' open ones. */
export async function GET() {
  const user = await apiUser();
  if (!user) return unauthorized();
  return music(async () => apiJson({ parties: await partiesFor(user.username) }));
}

/** `{ keys, index, position, invite? }`: starts a party from your queue. Answers `{ id }`. */
export async function POST(request: Request) {
  const refused = crossSite(request);
  if (refused) return refused;
  const user = await apiUser();
  if (!user) return unauthorized();
  const read = await readJson(request);
  if ("response" in read) return read.response;
  const body = (read.body ?? {}) as { keys?: unknown; index?: unknown; position?: unknown; invite?: unknown };
  const strings = (v: unknown) => (Array.isArray(v) ? v.filter((k): k is string => typeof k === "string") : []);
  const keys = strings(body.keys);
  if (!keys.length) return apiError(400, "Play something first.");
  return music(async (config) => apiJson({ id: await startParty(config, user.username, keys, Number(body.index) || 0, Number(body.position) || 0, strings(body.invite)) }, 201));
}
