import { apiJson, apiUser, unauthorized } from "@/lib/api-v1";
import { music } from "@/lib/music";
import { me } from "@/lib/music/social";

export const dynamic = "force-dynamic";

/** Your space: your month's listening, genres, artists, what you have on repeat, your playlists. */
export async function GET() {
  const user = await apiUser();
  if (!user) return unauthorized();
  return music(async (config) => apiJson(await me(config, user.username)));
}
