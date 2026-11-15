import { apiError, apiJson, apiUser, unauthorized } from "@/lib/api-v1";
import { chart, genres, music } from "@/lib/music";

export const dynamic = "force-dynamic";

/** `?id=` one of Deezer's genres: its chart of songs, albums and artists. */
export async function GET(request: Request) {
  if (!(await apiUser())) return unauthorized();
  const id = Number(new URL(request.url).searchParams.get("id"));
  if (!Number.isSafeInteger(id) || id < 0) return apiError(400, "Which genre?");
  return music(async () => {
    const genre = (await genres()).find((g) => g.id === id);
    if (!genre) return apiError(404, "No such genre.");
    return apiJson({ genre, ...await chart(id) });
  });
}
