import { apiJson, apiUser, unauthorized } from "@/lib/api-v1";
import { liked, music } from "@/lib/music";

export const dynamic = "force-dynamic";

/** Songs you rated up or love, newest first. */
export async function GET() {
  const user = await apiUser();
  if (!user) return unauthorized();
  return music(async () => apiJson({ tracks: await liked(user.username) }));
}
