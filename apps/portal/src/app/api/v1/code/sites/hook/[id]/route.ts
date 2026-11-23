import { pushedTo } from "@/lib/code";

type Context = { params: Promise<{ id: string }> };

/**
 * Kimono Git's push notice for a hosted repository. Nobody is signed in: the notice is taken only when it is
 * signed with the site's own secret, and it only ever puts that site up again from its branch.
 */
export async function POST(request: Request, { params }: Context) {
  const { id } = await params;
  const length = Number(request.headers.get("content-length") ?? 0);
  if (length > 5 * 1024 * 1024) return new Response(null, { status: 413 });
  const body = await request.text();
  const signature = request.headers.get("x-forgejo-signature") ?? request.headers.get("x-gitea-signature") ?? request.headers.get("x-hub-signature-256");
  const taken = await pushedTo(id, body, signature).catch(() => false);
  return new Response(null, { status: taken ? 202 : 404 });
}
