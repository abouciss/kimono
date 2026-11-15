import { apiJson, apiUser, unauthorized } from "@/lib/api-v1";
import { music, ratings } from "@/lib/music";

export const dynamic = "force-dynamic";

/** Everything you've rated, newest first. */
export async function GET() {
  const user = await apiUser();
  if (!user) return unauthorized();
  return music(() => apiJson({ ratings: ratings(user.username) }));
}
