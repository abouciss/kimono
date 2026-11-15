import { apiJson, apiUser, unauthorized } from "@/lib/api-v1";
import { music } from "@/lib/music";
import { accounts } from "@/lib/music/connect";

export const dynamic = "force-dynamic";

/** Which services you can sign in to for imports (the admin has set them up), and which you have. */
export async function GET() {
  const user = await apiUser();
  if (!user) return unauthorized();
  return music((config) => apiJson({ accounts: accounts(config, user.username) }));
}
