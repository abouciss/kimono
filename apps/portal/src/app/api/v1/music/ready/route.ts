import { apiError, apiJson, apiUser, crossSite, readJson, unauthorized } from "@/lib/api-v1";
import { getReady, music } from "@/lib/music";

export const dynamic = "force-dynamic";

/** `{ keys }`: the next songs in the queue, fetched now so they start at once. */
export async function POST(request: Request) {
  const refused = crossSite(request);
  if (refused) return refused;
  const user = await apiUser();
  if (!user) return unauthorized();
  const read = await readJson(request);
  if ("response" in read) return read.response;
  const keys = (read.body as { keys?: unknown })?.keys;
  if (!Array.isArray(keys) || !keys.every((k) => typeof k === "string")) return apiError(400, "Which songs?");
  return music((config) => { void getReady(config, keys as string[]); return apiJson({ ok: true }, 202); });
}
