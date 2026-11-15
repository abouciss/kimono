import { apiError, apiJson, apiUser, crossSite, readJson, unauthorized } from "@/lib/api-v1";
import { addToPlaylist, deletePlaylist, music, renamePlaylist, setPlaylistTracks } from "@/lib/music";
import { playlistFor } from "@/lib/music/social";

export const dynamic = "force-dynamic";

type Params = { params: Promise<{ id: string }> };

/** A playlist: yours, or a friend's (read only) when they let friends see their playlists. */
export async function GET(_request: Request, { params }: Params) {
  const user = await apiUser();
  if (!user) return unauthorized();
  const { id } = await params;
  return music(async () => apiJson({ playlist: await playlistFor(user.username, id) }));
}

/** `{ name }` renames; `{ keys }` sets its songs in order; `{ add }` puts songs at the end (ones already in it stay where they are). */
export async function PATCH(request: Request, { params }: Params) {
  const refused = crossSite(request);
  if (refused) return refused;
  const user = await apiUser();
  if (!user) return unauthorized();
  const { id } = await params;
  const read = await readJson(request);
  if ("response" in read) return read.response;
  const body = (read.body ?? {}) as { name?: unknown; keys?: unknown; add?: unknown };
  const strings = (v: unknown) => Array.isArray(v) && v.every((k) => typeof k === "string") ? v as string[] : null;
  return music(async () => {
    if (typeof body.name === "string") return apiJson({ playlist: renamePlaylist(user.username, id, body.name) });
    const keys = strings(body.keys);
    if (keys) return apiJson({ playlist: await setPlaylistTracks(user.username, id, keys) });
    const add = strings(body.add);
    if (add) return apiJson({ playlist: await addToPlaylist(user.username, id, add) });
    return apiError(400, "Rename it, set its songs, or add some.");
  });
}

export async function DELETE(request: Request, { params }: Params) {
  const refused = crossSite(request);
  if (refused) return refused;
  const user = await apiUser();
  if (!user) return unauthorized();
  const { id } = await params;
  return music(() => { deletePlaylist(user.username, id); return apiJson({ ok: true }); });
}
