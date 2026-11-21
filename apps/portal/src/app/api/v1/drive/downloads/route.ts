import { apiError, apiJson, apiUser, crossSite, unauthorized } from "@/lib/api-v1";
import { db, drive, DriveProblem, nodeFor } from "@/lib/drive";
import { debridReady, driveDownloads, forgetDriveDownload, isMagnet, magnetName, startDriveDownload, type Ask } from "@/lib/drive/debrid";

export const dynamic = "force-dynamic";

/**
 * Downloads through Real-Debrid into a Drive folder (lib/drive/debrid.ts).
 *
 *   GET                       → { ready, downloads }  (ready: Watch is set up with Real-Debrid)
 *   POST { folder, magnet }   or a form with `folder` and a `torrent` file → the download, 202
 *   DELETE ?id=               → forgets a finished one
 */
export async function GET() {
  const user = await apiUser();
  if (!user) return unauthorized();
  return apiJson({ ready: Boolean(await debridReady()), downloads: driveDownloads(user.username) });
}

export async function POST(request: Request) {
  const refused = crossSite(request);
  if (refused) return refused;
  const user = await apiUser();
  if (!user) return unauthorized();
  if (!(await debridReady())) return apiError(409, "Downloads need Real-Debrid set up in Watch.");
  let folder: unknown, ask: Ask, name: string;
  if ((request.headers.get("content-type") ?? "").startsWith("multipart/form-data")) {
    const form = await request.formData().catch(() => null);
    const file = form?.get("torrent");
    folder = form?.get("folder");
    if (!(file instanceof File) || file.size > 20 * 1024 * 1024) return apiError(400, "Choose a .torrent file.");
    ask = { torrent: new Uint8Array(await file.arrayBuffer()) };
    name = file.name.replace(/\.torrent$/i, "") || "Download";
  } else {
    const body = await request.json().catch(() => ({})) as { folder?: unknown; magnet?: unknown };
    folder = body.folder;
    if (typeof body.magnet !== "string" || !isMagnet(body.magnet)) return apiError(400, "That isn't a magnet link.");
    ask = { magnet: body.magnet.trim() };
    name = magnetName(body.magnet) ?? "Download";
  }
  if (typeof folder !== "string" || !folder) return apiError(400, "Say which folder it goes in.");
  return drive(() => {
    const node = nodeFor(db(), folder as string, user.username, "editor");
    if (node.kind !== "folder") throw new DriveProblem("Downloads go into folders.");
    return apiJson(startDriveDownload(user.username, node.id, ask, name), 202);
  });
}

export async function DELETE(request: Request) {
  const refused = crossSite(request);
  if (refused) return refused;
  const user = await apiUser();
  if (!user) return unauthorized();
  forgetDriveDownload(user.username, new URL(request.url).searchParams.get("id") ?? "");
  return new Response(null, { status: 204 });
}
