import { apiJson, apiUser, unauthorized } from "@/lib/api-v1";
import { music, radio } from "@/lib/music";

export const dynamic = "force-dynamic";

/** `?seed=dz:…&skip=dz:…,dz:…`: songs like this one, to keep playing when the queue runs out. */
export async function GET(request: Request) {
  const user = await apiUser();
  if (!user) return unauthorized();
  const p = new URL(request.url).searchParams;
  const skip = (p.get("skip") ?? "").split(",").filter(Boolean).slice(0, 500);
  return music(async (config) => apiJson({ tracks: await radio(config, user.username, p.get("seed") ?? "", skip) }));
}
