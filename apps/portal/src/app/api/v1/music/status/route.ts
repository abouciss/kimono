import { apiJson, apiUser, unauthorized } from "@/lib/api-v1";
import { music, songStatus } from "@/lib/music";

export const dynamic = "force-dynamic";

/** `?key=dz:…`: where a song is on its way to playing (finding it, fetching it and how far, ready), for the first play's bar. */
export async function GET(request: Request) {
  if (!(await apiUser())) return unauthorized();
  const key = new URL(request.url).searchParams.get("key") ?? "";
  return music(() => apiJson(songStatus(key), 200));
}
