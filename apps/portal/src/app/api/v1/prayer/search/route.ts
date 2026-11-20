import { apiJson, apiUser, unauthorized } from "@/lib/api-v1";
import { prayer, search } from "@/lib/prayer";

export const dynamic = "force-dynamic";

const number = (value: string | null) => value === null || value === "" ? undefined : Number(value);

/** `?q=` words, a Mawaqit or MasjidBox link, or `lat,lon`; or `?lat=&lon=&tz=` for where you are. Answers `{ places }`. */
export async function GET(request: Request) {
  const user = await apiUser();
  if (!user) return unauthorized();
  const params = new URL(request.url).searchParams;
  return prayer(async (config) => apiJson({ places: await search(config, {
    q: params.get("q") ?? undefined, lat: number(params.get("lat")), lon: number(params.get("lon")), tz: params.get("tz") ?? undefined,
  }) }));
}
