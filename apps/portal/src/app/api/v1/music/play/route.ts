import { apiError, apiJson, apiUser, crossSite, readJson, unauthorized } from "@/lib/api-v1";
import { music, recordPlay } from "@/lib/music";

export const dynamic = "force-dynamic";

/** `{ key, seconds }`: a song you played, sent when it ends or you move on, with how much of it you heard. */
export async function POST(request: Request) {
  const refused = crossSite(request);
  if (refused) return refused;
  const user = await apiUser();
  if (!user) return unauthorized();
  const read = await readJson(request);
  if ("response" in read) return read.response;
  const body = (read.body ?? {}) as { key?: unknown; seconds?: unknown };
  if (typeof body.key !== "string" || typeof body.seconds !== "number") return apiError(400, "Which song, and how long?");
  return music(async () => { await recordPlay(user.username, body.key as string, body.seconds as number); return apiJson({ ok: true }); });
}
