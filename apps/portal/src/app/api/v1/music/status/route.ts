import { apiError, apiJson, apiUser, crossSite, readJson, unauthorized } from "@/lib/api-v1";
import { music, onServer, songStatus } from "@/lib/music";

export const dynamic = "force-dynamic";

/** `?key=dz:…`: where a song is on its way to playing (finding it, fetching it and how far, ready), for the first play's bar. */
export async function GET(request: Request) {
  if (!(await apiUser())) return unauthorized();
  const key = new URL(request.url).searchParams.get("key") ?? "";
  return music(() => apiJson(songStatus(key), 200));
}

/**
 * `{ keys }`: which of them the server already has (`{ here }`), so a phone
 * downloading a long list takes those while the rest wait their turn.
 */
export async function POST(request: Request) {
  const refused = crossSite(request);
  if (refused) return refused;
  if (!(await apiUser())) return unauthorized();
  const read = await readJson(request);
  if ("response" in read) return read.response;
  const keys = (read.body as { keys?: unknown })?.keys;
  if (!Array.isArray(keys) || !keys.every((k) => typeof k === "string")) return apiError(400, "Which songs?");
  return music(() => apiJson({ here: (keys as string[]).slice(0, 2000).filter(onServer) }, 200));
}
