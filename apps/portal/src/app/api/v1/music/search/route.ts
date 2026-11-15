import { apiJson, apiUser, unauthorized } from "@/lib/api-v1";
import { music, search } from "@/lib/music";

export const dynamic = "force-dynamic";

/** `?q=` a song, an album or an artist. Answers `{ tracks, albums, artists }`. */
export async function GET(request: Request) {
  if (!(await apiUser())) return unauthorized();
  const q = new URL(request.url).searchParams.get("q") ?? "";
  return music(async () => apiJson(await search(q)));
}
