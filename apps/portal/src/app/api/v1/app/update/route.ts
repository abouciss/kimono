import { portalOrigin } from "@/lib/account";
import { companionAndroid, readReleases } from "@/lib/app-releases";
import { updateFor } from "@/lib/app-updates";
import { syncTestflightIfDue } from "@/lib/testflight";

/**
 * Whether this phone's Kimono app should update: `?platform=android|ios&build=N`.
 * Open to phones that aren't signed in, so an update that's needed reaches
 * them before anything else does. It says only what's published.
 * `&app=watch`: Kimono Watch on a TV, which installs its own updates.
 */
export async function GET(request: Request) {
  const query = new URL(request.url).searchParams;
  const platform = query.get("platform");
  const build = Number(query.get("build"));
  if ((platform !== "android" && platform !== "ios") || !Number.isInteger(build) || build < 0) {
    return Response.json({ error: "Say which platform and build." }, { status: 400 });
  }
  if (query.get("app") === "watch") {
    if (platform !== "android") return Response.json({ error: "Kimono Watch updates itself on Android only." }, { status: 400 });
    const found = await companionAndroid("watch");
    const available = !!found && found.build !== undefined && found.build > build;
    return Response.json(available ? {
      available, required: false, version: found.version, build: found.build, notes: "", size: found.size ?? null, sha256: found.sha256, url: found.url,
    } : { available: false, required: false }, { headers: { "Cache-Control": "no-store" } });
  }
  /* iPhones ask here: a good moment to bring TestFlight in step, without making them wait for it. */
  if (platform === "ios") void syncTestflightIfDue().catch(() => {});
  const { releases, iosLink } = await readReleases();
  const update = updateFor(releases, platform, build);
  /* The Portal's public address: behind the proxy, the request's own is the container's. */
  const origin = portalOrigin();
  return Response.json({
    ...update,
    /* Android installs the package itself; an iPhone goes to TestFlight. */
    url: !update.available ? null : platform === "android" ? `${origin}/api/v1/app/packages/${update.build}` : iosLink,
  }, { headers: { "Cache-Control": "no-store" } });
}
