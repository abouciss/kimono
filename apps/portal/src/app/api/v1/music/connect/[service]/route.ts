import { NextResponse } from "next/server";
import { apiError, apiJson, apiUser, crossSite, readJson, unauthorized } from "@/lib/api-v1";
import { music } from "@/lib/music";
import { developerToken, disconnect, keepAppleUser, signInUrl } from "@/lib/music/connect";
import type { Service } from "@/lib/music/imports";

export const dynamic = "force-dynamic";

type Context = { params: Promise<{ service: string }> };
const serviceOf = (s: string): Service | null => (s === "spotify" || s === "apple" || s === "youtube" ? s : null);

/** Spotify and YouTube: off to sign in. Apple Music: the developer token MusicKit signs in with, on the page. */
export async function GET(_request: Request, { params }: Context) {
  const user = await apiUser();
  if (!user) return unauthorized();
  const service = serviceOf((await params).service);
  if (!service) return apiError(404, "No such service.");
  return music((config) => service === "apple"
    ? apiJson({ developerToken: developerToken(config) })
    : NextResponse.redirect(signInUrl(config, user.username, service)));
}

/** Apple Music: `{ userToken }`, the sign-in MusicKit gave the page. */
export async function POST(request: Request, { params }: Context) {
  const refused = crossSite(request);
  if (refused) return refused;
  const user = await apiUser();
  if (!user) return unauthorized();
  if ((await params).service !== "apple") return apiError(404, "No such service.");
  const read = await readJson(request);
  if ("response" in read) return read.response;
  const token = (read.body as { userToken?: unknown } | null)?.userToken;
  if (typeof token !== "string") return apiError(400, "No sign-in came.");
  return music(() => { keepAppleUser(user.username, token); return apiJson({ ok: true }); });
}

export async function DELETE(request: Request, { params }: Context) {
  const refused = crossSite(request);
  if (refused) return refused;
  const user = await apiUser();
  if (!user) return unauthorized();
  const service = serviceOf((await params).service);
  if (!service) return apiError(404, "No such service.");
  return music(() => { disconnect(user.username, service); return apiJson({ ok: true }); });
}
