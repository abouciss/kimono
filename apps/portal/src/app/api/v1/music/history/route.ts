import { apiJson, apiUser, unauthorized } from "@/lib/api-v1";
import { history, music } from "@/lib/music";

export const dynamic = "force-dynamic";

/** What you played lately, each song once, newest first. */
export async function GET() {
  const user = await apiUser();
  if (!user) return unauthorized();
  return music(() => apiJson({ tracks: history(user.username, 200) }));
}
