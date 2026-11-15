import { apiError, apiJson, apiUser, crossSite, readJson, unauthorized } from "@/lib/api-v1";
import { createPlaylist, music, playlists } from "@/lib/music";

export const dynamic = "force-dynamic";

/** Your playlists, last changed first. */
export async function GET() {
  const user = await apiUser();
  if (!user) return unauthorized();
  return music(() => apiJson({ playlists: playlists(user.username) }));
}

/** `{ name, keys? }`: a new playlist, with songs to start it with. */
export async function POST(request: Request) {
  const refused = crossSite(request);
  if (refused) return refused;
  const user = await apiUser();
  if (!user) return unauthorized();
  const read = await readJson(request);
  if ("response" in read) return read.response;
  const body = (read.body ?? {}) as { name?: unknown; keys?: unknown };
  if (typeof body.name !== "string") return apiError(400, "A playlist needs a name.");
  const keys = Array.isArray(body.keys) ? body.keys.filter((k): k is string => typeof k === "string") : [];
  return music(async () => apiJson({ playlist: await createPlaylist(user.username, body.name as string, keys) }, 201));
}
