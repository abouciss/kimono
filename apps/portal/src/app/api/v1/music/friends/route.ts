import { apiJson, apiUser, unauthorized } from "@/lib/api-v1";
import { music } from "@/lib/music";
import { friendsListening } from "@/lib/music/social";

export const dynamic = "force-dynamic";

/** What your friends are listening to now, or last (as each lets friends see). */
export async function GET() {
  const user = await apiUser();
  if (!user) return unauthorized();
  return music(async () => apiJson({ friends: await friendsListening(user.username) }));
}
