import { apiError, apiJson, apiUser, crossSite, readJson, unauthorized } from "@/lib/api-v1";
import { getQueue, music, saveQueue, type Queue } from "@/lib/music";

export const dynamic = "force-dynamic";

/** Your queue and place in it, as you left it on any device. */
export async function GET() {
  const user = await apiUser();
  if (!user) return unauthorized();
  return music(() => apiJson({ queue: getQueue(user.username) }));
}

/** `{ keys, index, position, shuffle, repeat, source, at }`: where you are now. An older `at` than what's kept is ignored. */
export async function PUT(request: Request) {
  const refused = crossSite(request);
  if (refused) return refused;
  const user = await apiUser();
  if (!user) return unauthorized();
  const read = await readJson(request);
  if ("response" in read) return read.response;
  const body = (read.body ?? {}) as Partial<Omit<Queue, "tracks">> & { keys?: unknown; at?: unknown };
  if (!Array.isArray(body.keys) || !body.keys.every((k) => typeof k === "string")) return apiError(400, "Which songs?");
  const at = typeof body.at === "number" && body.at <= Date.now() + 60_000 ? body.at : Date.now();
  return music(async () => apiJson({ queue: await saveQueue(user.username, {
    keys: body.keys as string[], index: Number(body.index) || 0, position: Number(body.position) || 0,
    shuffle: Boolean(body.shuffle), repeat: body.repeat ?? "off", source: body.source ?? null, playing: Boolean(body.playing),
  }, at) }));
}
