import { apiJson, apiUser, unauthorized } from "@/lib/api-v1";
import { friendly, sharingAsk } from "@/lib/friends";

export const dynamic = "force-dynamic";

/** `?app=music`: whether that app should ask what you share with friends, and the choices (lib/friends sharingAsk). */
export async function GET(request: Request) {
  const user = await apiUser();
  if (!user) return unauthorized();
  const app = new URL(request.url).searchParams.get("app") ?? "";
  return friendly(async () => apiJson(sharingAsk(user.username, app)));
}
