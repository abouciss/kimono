import { apiError, apiJson, apiUser, unauthorized } from "@/lib/api-v1";
import { prayer, timetable } from "@/lib/prayer";

export const dynamic = "force-dynamic";

/** `?id=`: any place's timetable, from yesterday onwards. */
export async function GET(request: Request) {
  const user = await apiUser();
  if (!user) return unauthorized();
  const id = new URL(request.url).searchParams.get("id") ?? "";
  if (!id) return apiError(400, "Which place?");
  return prayer(async (config) => apiJson(await timetable(config, id)));
}
