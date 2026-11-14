import { apiError, apiJson, apiUser, crossSite, readJson, unauthorized } from "@/lib/api-v1";
import { books, noteDevice, setProgress } from "@/lib/books";

export const dynamic = "force-dynamic";

/** `{ key | isbn, fraction, at? }`: fraction from 0 to 1 (at the end, you've read it); `at`, epoch seconds when the reader was there, keeps a newer place. */
export async function POST(request: Request) {
  const refused = crossSite(request);
  if (refused) return refused;
  const user = await apiUser();
  if (!user) return unauthorized();
  const read = await readJson(request);
  if ("response" in read) return read.response;
  const body = (read.body ?? {}) as { key?: unknown; isbn?: unknown; fraction?: unknown; at?: unknown };
  const fraction = Number(body.fraction);
  if (!Number.isFinite(fraction)) return apiError(400, "How far in? A fraction from 0 to 1.");
  const ref = { key: typeof body.key === "string" ? body.key : undefined, isbn: typeof body.isbn === "string" ? body.isbn : undefined };
  if (!ref.key && !ref.isbn) return apiError(400, "Which book? A key or an ISBN.");
  const at = typeof body.at === "number" && Number.isFinite(body.at) && body.at > 0 ? body.at * 1000 : undefined;
  noteDevice(request, user.username);
  return books(async (config) => apiJson(await setProgress(config, user.username, ref, fraction, at)));
}
