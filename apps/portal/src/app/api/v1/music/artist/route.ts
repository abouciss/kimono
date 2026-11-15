import { apiError, apiJson, apiUser, unauthorized } from "@/lib/api-v1";
import { getArtist, music, ratingOf } from "@/lib/music";

export const dynamic = "force-dynamic";

/** `?key=dz:…`: an artist, their top songs, their albums and artists like them. */
export async function GET(request: Request) {
  const user = await apiUser();
  if (!user) return unauthorized();
  const key = new URL(request.url).searchParams.get("key") ?? "";
  return music(async (config) => {
    const page = await getArtist(config, key);
    return page ? apiJson({ ...page, rating: ratingOf(user.username, "artist", key) }) : apiError(404, "No such artist.");
  });
}
