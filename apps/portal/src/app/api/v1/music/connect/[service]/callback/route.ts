import { NextResponse } from "next/server";
import { apiUser, unauthorized } from "@/lib/api-v1";
import { portalOrigin } from "@/lib/account";
import { music, MusicProblem } from "@/lib/music";
import { finishSignIn } from "@/lib/music/connect";

export const dynamic = "force-dynamic";

/** Back from Spotify's or Google's sign-in: kept, then back to Your music with the import sheet open on that service. */
export async function GET(request: Request, { params }: { params: Promise<{ service: string }> }) {
  const user = await apiUser();
  if (!user) return unauthorized();
  const service = (await params).service;
  if (service !== "spotify" && service !== "youtube") return NextResponse.redirect(`${portalOrigin()}/music/you`);
  const url = new URL(request.url);
  const back = (problem?: string) => NextResponse.redirect(`${portalOrigin()}/music/you?bring=${service}${problem ? `&problem=${encodeURIComponent(problem)}` : ""}`);
  const code = url.searchParams.get("code"), state = url.searchParams.get("state");
  if (!code || !state) return back(url.searchParams.get("error") === "access_denied" ? undefined : "That sign-in didn't finish.");
  return music(async (config) => {
    try { await finishSignIn(config, service, state, code, user.username); return back(); }
    catch (error) { return back(error instanceof MusicProblem ? error.message : "That sign-in didn't finish."); }
  });
}
