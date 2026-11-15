import { apiError, apiJson, apiUser, unauthorized } from "@/lib/api-v1";
import { getAlbum, music, ratingOf } from "@/lib/music";

export const dynamic = "force-dynamic";

/** `?key=dz:…`: an album and its songs, and how you rated it. */
export async function GET(request: Request) {
  const user = await apiUser();
  if (!user) return unauthorized();
  const key = new URL(request.url).searchParams.get("key") ?? "";
  return music(async () => {
    const album = await getAlbum(key);
    return album ? apiJson({ album, rating: ratingOf(user.username, "album", key) }) : apiError(404, "No such album.");
  });
}
