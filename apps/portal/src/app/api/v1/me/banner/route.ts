import { friendly, saveBanner } from "@/lib/friends";
import { apiError, apiJson, apiUser, crossSite, readLimited, unauthorized } from "@/lib/api-v1";
import { bannerMaxBytes, sanitizeBannerJpeg } from "@/lib/banner-jpeg";

export const dynamic = "force-dynamic";

/** Puts up the signed-in person's profile banner, a 2400×800 JPEG sent as the body. Answers `{ banner }`. */
export async function PUT(request: Request) {
  const refused = crossSite(request);
  if (refused) return refused;
  const user = await apiUser();
  if (!user) return unauthorized();
  if (request.headers.get("content-type")?.split(";")[0].trim() !== "image/jpeg") return apiError(415, "Send the cropped banner as image/jpeg.");
  const upload = await readLimited(request, bannerMaxBytes);
  if (!upload) return apiError(413, "That banner is larger than 5 MB.");
  try { sanitizeBannerJpeg(upload); } catch (error) { return apiError(400, error instanceof Error ? error.message : "That banner is damaged."); }
  return friendly(async () => apiJson({ banner: (await saveBanner(user.username, upload)).banner }));
}

/** Takes the banner down: the profile's colour fills the band again. */
export async function DELETE(request: Request) {
  const refused = crossSite(request);
  if (refused) return refused;
  const user = await apiUser();
  if (!user) return unauthorized();
  return friendly(async () => apiJson({ banner: (await saveBanner(user.username, null)).banner }));
}
