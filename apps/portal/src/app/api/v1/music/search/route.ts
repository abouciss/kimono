import { apiJson, apiUser, unauthorized } from "@/lib/api-v1";
import { music, search } from "@/lib/music";

export const dynamic = "force-dynamic";

/** `?q=` a song, an album, an artist or a genre. Answers `{ tracks, albums, artists, genre }` (`genre` null unless it names one). */
export async function GET(request: Request) {
  if (!(await apiUser())) return unauthorized();
  const q = new URL(request.url).searchParams.get("q") ?? "";
  return music(async (config) => apiJson(await search(q, config)));
}
