import { apiError, apiJson, apiUser, unauthorized } from "@/lib/api-v1";
import { music } from "@/lib/music";
import { myPlaylists } from "@/lib/music/connect";

export const dynamic = "force-dynamic";

/** Your playlists on a service you've connected (liked songs first). */
export async function GET(_request: Request, { params }: { params: Promise<{ service: string }> }) {
  const user = await apiUser();
  if (!user) return unauthorized();
  const service = (await params).service;
  if (service !== "spotify" && service !== "apple" && service !== "youtube") return apiError(404, "No such service.");
  return music(async (config) => apiJson({ playlists: await myPlaylists(config, user.username, service) }));
}
