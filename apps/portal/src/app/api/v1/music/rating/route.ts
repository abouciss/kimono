import { apiError, apiJson, apiUser, crossSite, readJson, unauthorized } from "@/lib/api-v1";
import { music, rate, type RatedKind, type Rating } from "@/lib/music";

export const dynamic = "force-dynamic";

const kinds: RatedKind[] = ["track", "album", "artist"];
const values: Rating[] = ["down", "up", "love"];

/** `{ kind, key, rating }`: a song, album or artist rated down, up or love (null takes it back). */
export async function PUT(request: Request) {
  const refused = crossSite(request);
  if (refused) return refused;
  const user = await apiUser();
  if (!user) return unauthorized();
  const read = await readJson(request);
  if ("response" in read) return read.response;
  const body = (read.body ?? {}) as { kind?: unknown; key?: unknown; rating?: unknown };
  if (!kinds.includes(body.kind as RatedKind) || typeof body.key !== "string") return apiError(400, "Rate which song, album or artist?");
  if (body.rating !== null && !values.includes(body.rating as Rating)) return apiError(400, "A rating is down, up or love.");
  return music(async (config) => { await rate(config, user.username, body.kind as RatedKind, body.key as string, body.rating as Rating | null); return apiJson({ rating: body.rating }); });
}
