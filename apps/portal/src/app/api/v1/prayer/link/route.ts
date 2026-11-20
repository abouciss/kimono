import { apiJson, apiUser, crossSite, unauthorized } from "@/lib/api-v1";
import { linkToken, prayer } from "@/lib/prayer";

export const dynamic = "force-dynamic";

const linkFor = (request: Request, token: string) => {
  const url = new URL(request.url);
  const host = request.headers.get("x-forwarded-host") ?? url.host;
  const proto = request.headers.get("x-forwarded-proto") ?? url.protocol.replace(":", "");
  return `${proto}://${host}/api/v1/prayer/feed/${token}`;
};

/** The menu bar app's link to your prayer place, and the address that hands it over. */
export async function GET(request: Request) {
  const user = await apiUser();
  if (!user) return unauthorized();
  return prayer(() => {
    const link = linkFor(request, linkToken(user.username));
    return apiJson({ link, connect: `mawaqit-kimono://connect?link=${encodeURIComponent(link)}` });
  });
}

/** A new link: the old one stops working. */
export async function POST(request: Request) {
  const refused = crossSite(request);
  if (refused) return refused;
  const user = await apiUser();
  if (!user) return unauthorized();
  return prayer(() => {
    const link = linkFor(request, linkToken(user.username, true));
    return apiJson({ link, connect: `mawaqit-kimono://connect?link=${encodeURIComponent(link)}` });
  });
}
