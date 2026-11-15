import { apiJson, apiUser, unauthorized } from "@/lib/api-v1";
import { friendly, isPublicProfile, profileOf } from "@/lib/friends";
import { portalOrigin } from "@/lib/watch";

export const dynamic = "force-dynamic";

type Context = { params: Promise<{ username: string }> };

/**
 * Someone's profile: name, portrait and whether you're friends for anyone; bio, sections and recommendations for friends.
 * Signed out: only a public profile, as a friend would see it.
 */
export async function GET(request: Request, { params }: Context) {
  const user = await apiUser();
  const { username } = await params;
  const name = decodeURIComponent(username);
  if (!user) return isPublicProfile(name) ? friendly(async () => apiJson(await profileOf("", name, portalOrigin(request)))) : unauthorized();
  return friendly(async () => apiJson(await profileOf(user.username, name, portalOrigin(request))));
}
