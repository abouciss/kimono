import { apiJson, apiUser, crossSite, readJson, unauthorized } from "@/lib/api-v1";
import { play, portalOrigin, watch, watchDb } from "@/lib/watch";
import { notePlayedOn, screenKind } from "@/lib/watch/model";

/**
 * Starts playback: `{ titleId, season?, episode?, version?, device }`, device
 * being what the screen and decoders can do (see lib/watch/releases.ts). The
 * answer's url is the stream; versions lists the others to switch to.
 */
export async function POST(request: Request) {
  const refused = crossSite(request);
  if (refused) return refused;
  const user = await apiUser();
  if (!user) return unauthorized();
  const read = await readJson(request);
  if ("response" in read) return read.response;
  const body = (read.body ?? {}) as Record<string, unknown>;
  return watch(async (cfg) => {
    const playing = await play(cfg, user.username, portalOrigin(request), body);
    /* The kind of screen it went on, for their profile: cast from here, it's on the TV. */
    const client = (body.device as { client?: unknown } | null | undefined)?.client;
    notePlayedOn(watchDb(), user.username, String(body.titleId ?? ""), body.cast ? "tv" : screenKind(client, request.headers.get("user-agent") ?? ""));
    return apiJson(playing);
  });
}
