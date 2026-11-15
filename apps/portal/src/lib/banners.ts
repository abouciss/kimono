import "server-only";

import { randomBytes } from "node:crypto";
import { mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { stateDir } from "./state";
import { bannerFileName, sanitizeBannerJpeg } from "./banner-jpeg";

export { bannerPath } from "./banner-jpeg";

/**
 * Where profile banners live. Like pictures (lib/pictures.ts), each upload
 * gets a new random name that is its address, so a public profile can show it
 * without a session and a replaced banner's old address stops working. Which
 * file is whose is kept on the profile (lib/friends, profiles.banner).
 */
const bannerDir = join(stateDir, "banners");

/** Keeps a cropped banner and answers its file name. */
export async function writeBanner(upload: Uint8Array): Promise<string> {
  const jpeg = sanitizeBannerJpeg(upload);
  const file = `${randomBytes(16).toString("base64url")}.jpg`;
  await mkdir(bannerDir, { recursive: true, mode: 0o700 });
  const temporary = join(bannerDir, `${file}.new`);
  await writeFile(temporary, jpeg, { mode: 0o600 });
  await rename(temporary, join(bannerDir, file));
  return file;
}

export async function dropBanner(file: string | null | undefined) {
  if (file && bannerFileName.test(file)) await rm(join(bannerDir, file), { force: true });
}

export async function readBannerFile(file: string): Promise<Uint8Array | null> {
  if (!bannerFileName.test(file)) return null;
  try {
    return new Uint8Array(await readFile(join(bannerDir, file)));
  } catch {
    return null;
  }
}
