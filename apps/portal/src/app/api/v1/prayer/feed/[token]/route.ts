import { apiError, apiJson, readJson } from "@/lib/api-v1";
import { choose, linkOwner, mine, prayer, search } from "@/lib/prayer";

export const dynamic = "force-dynamic";

/*
 * The menu bar app's door: the link someone copied from Kimono Times stands
 * in for signing in, and reaches only their prayer place.
 */
type Context = { params: Promise<{ token: string }> };
const gone = () => apiError(401, "This link no longer works. Connect again from Kimono Times.");
const number = (value: string | null) => value === null || value === "" ? undefined : Number(value);

/** Your place and its timetable; with `?q=` (or `?lat=&lon=&tz=`), a search instead, answering `{ places }`. */
export async function GET(request: Request, { params }: Context) {
  const username = linkOwner((await params).token);
  if (!username) return gone();
  const query = new URL(request.url).searchParams;
  const q = query.get("q"), lat = number(query.get("lat")), lon = number(query.get("lon"));
  return prayer(async (config) => q !== null || lat !== undefined
    ? apiJson({ places: await search(config, { q: q ?? undefined, lat, lon, tz: query.get("tz") ?? undefined }) })
    : apiJson(await mine(config, username)));
}

/** `{ id }`: makes it your place, everywhere. */
export async function PUT(request: Request, { params }: Context) {
  const username = linkOwner((await params).token);
  if (!username) return gone();
  const read = await readJson(request);
  if ("response" in read) return read.response;
  const id = (read.body as { id?: unknown } | null)?.id;
  if (typeof id !== "string" || !id || id.length > 300) return apiError(400, "Which place?");
  return prayer(async (config) => apiJson(await choose(config, username, id)));
}
