import { apiJson, apiUser, unauthorized } from "@/lib/api-v1";
import { mix, music } from "@/lib/music";

export const dynamic = "force-dynamic";

/** `?id=` a mix from Home ("tag:french house", "artist:dz:27", "chart"). */
export async function GET(request: Request) {
  const user = await apiUser();
  if (!user) return unauthorized();
  const id = new URL(request.url).searchParams.get("id") ?? "";
  return music(async (config) => apiJson({ mix: await mix(config, user.username, id) }));
}
