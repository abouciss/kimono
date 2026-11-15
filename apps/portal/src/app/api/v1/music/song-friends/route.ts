import { apiJson, apiUser, unauthorized } from "@/lib/api-v1";
import { music } from "@/lib/music";
import { friendsOnSong } from "@/lib/music/social";

export const dynamic = "force-dynamic";

/** `?key=dz:…`: friends who played or love this song, as each lets friends see. */
export async function GET(request: Request) {
  const user = await apiUser();
  if (!user) return unauthorized();
  const key = new URL(request.url).searchParams.get("key") ?? "";
  return music(async () => apiJson({ friends: await friendsOnSong(user.username, key) }));
}
