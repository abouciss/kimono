import { apiJson, apiUser, unauthorized } from "@/lib/api-v1";
import { homeFor, music } from "@/lib/music";

export const dynamic = "force-dynamic";

/** Home: what you played lately, mixes from your taste, charts, genres and your playlists. */
export async function GET() {
  const user = await apiUser();
  if (!user) return unauthorized();
  return music(async (config) => apiJson(await homeFor(config, user.username)));
}
