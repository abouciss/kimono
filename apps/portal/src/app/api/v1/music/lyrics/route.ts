import { apiJson, apiUser, unauthorized } from "@/lib/api-v1";
import { lyrics, music } from "@/lib/music";

export const dynamic = "force-dynamic";

/** `?key=dz:…`: a song's lyrics, timed to the line when they can be (`{ lyrics: null }` when there are none). */
export async function GET(request: Request) {
  if (!(await apiUser())) return unauthorized();
  const key = new URL(request.url).searchParams.get("key") ?? "";
  return music(async () => apiJson({ lyrics: await lyrics(key) }));
}
