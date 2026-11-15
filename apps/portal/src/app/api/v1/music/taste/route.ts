import { apiJson, apiUser, unauthorized } from "@/lib/api-v1";
import { music, taste } from "@/lib/music";

export const dynamic = "force-dynamic";

/** Your genres and artists as Music has worked them out from your listening. Yours alone. */
export async function GET() {
  const user = await apiUser();
  if (!user) return unauthorized();
  return music(async (config) => { const t = await taste(config, user.username); return apiJson({ plays: t.plays, artists: t.artists, tags: t.tags }); });
}
