import { apiError, apiJson, apiUser, crossSite, readJson, unauthorized } from "@/lib/api-v1";
import { choose, forget, mine, prayer } from "@/lib/prayer";

export const dynamic = "force-dynamic";

/** Your prayer place, its timetable from yesterday onwards, and the places you picked before. */
export async function GET() {
  const user = await apiUser();
  if (!user) return unauthorized();
  return prayer(async (config) => apiJson(await mine(config, user.username)));
}

/** `{ id }`, from a search: makes it your place, on every device. */
export async function PUT(request: Request) {
  const refused = crossSite(request);
  if (refused) return refused;
  const user = await apiUser();
  if (!user) return unauthorized();
  const read = await readJson(request);
  if ("response" in read) return read.response;
  const id = (read.body as { id?: unknown } | null)?.id;
  if (typeof id !== "string" || !id || id.length > 300) return apiError(400, "Which place?");
  return prayer(async (config) => apiJson(await choose(config, user.username, id)));
}

/** `?id=`: takes a place off your recent ones. */
export async function DELETE(request: Request) {
  const refused = crossSite(request);
  if (refused) return refused;
  const user = await apiUser();
  if (!user) return unauthorized();
  const id = new URL(request.url).searchParams.get("id") ?? "";
  if (!id) return apiError(400, "Which place?");
  return prayer(async (config) => { forget(user.username, id); return apiJson(await mine(config, user.username)); });
}
