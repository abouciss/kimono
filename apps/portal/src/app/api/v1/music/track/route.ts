import { apiError, apiJson, apiUser, unauthorized } from "@/lib/api-v1";
import { getTrack, music, ratingOf } from "@/lib/music";

export const dynamic = "force-dynamic";

/** `?key=dz:…`: a song, and how you rated it. */
export async function GET(request: Request) {
  const user = await apiUser();
  if (!user) return unauthorized();
  const key = new URL(request.url).searchParams.get("key") ?? "";
  return music(async () => {
    const track = await getTrack(key);
    return track ? apiJson({ track, rating: ratingOf(user.username, "track", key) }) : apiError(404, "No such song.");
  });
}
