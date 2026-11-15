/**
 * 幟 A profile banner, as Kimono keeps it.
 *
 * Like a picture, the browser crops and re-draws the photo before uploading,
 * so what arrives is a fresh 2400×800 JPEG. The server accepts only that
 * shape and rebuilds the file without its APP and comment segments, so no
 * EXIF, location or editor metadata survives into a banner anyone can load.
 */

export const bannerWidth = 2400;
export const bannerHeight = 800;
export const bannerMaxBytes = 5 * 1024 * 1024;

/* A kept banner's random file name (lib/banners.ts), and its public address. */
export const bannerFileName = /^[A-Za-z0-9_-]{22}\.jpg$/;
export const bannerPath = (file: string | null | undefined) => (file && bannerFileName.test(file) ? `/api/v1/banners/${file}` : null);

/* Start-of-frame markers carry the size; C4, C8 and CC share the range but aren't frames. */
const isFrame = (m: number) => m >= 0xc0 && m <= 0xcf && m !== 0xc4 && m !== 0xc8 && m !== 0xcc;
/* APP0–APP15 and COM describe the photo; nothing needed to draw it. */
const isDescription = (m: number) => (m >= 0xe0 && m <= 0xef) || m === 0xfe;

export function sanitizeBannerJpeg(input: Uint8Array): Uint8Array {
  if (input.byteLength > bannerMaxBytes) throw new Error("That banner is larger than 5 MB.");
  if (input.byteLength < 4 || input[0] !== 0xff || input[1] !== 0xd8) throw new Error("Upload the cropped banner as a JPEG.");
  const parts: Uint8Array[] = [input.subarray(0, 2)];
  let offset = 2;
  let sized = false;
  for (;;) {
    if (offset + 4 > input.byteLength || input[offset] !== 0xff) throw new Error("That banner is damaged.");
    const marker = input[offset + 1];
    if (marker === 0xff) { offset += 1; continue; }
    const length = (input[offset + 2] << 8) | input[offset + 3];
    const end = offset + 2 + length;
    if (length < 2 || end > input.byteLength) throw new Error("That banner is damaged.");
    if (isFrame(marker)) {
      if (length < 7) throw new Error("That banner is damaged.");
      const height = (input[offset + 5] << 8) | input[offset + 6];
      const width = (input[offset + 7] << 8) | input[offset + 8];
      if (width !== bannerWidth || height !== bannerHeight) throw new Error(`Banners are stored at ${bannerWidth}×${bannerHeight}.`);
      sized = true;
    }
    if (marker === 0xda) {
      if (!sized) throw new Error("That banner is damaged.");
      /* The scan runs to the end-of-image marker; anything after it is dropped. */
      let eoi = input.byteLength - 2;
      while (eoi > end && !(input[eoi] === 0xff && input[eoi + 1] === 0xd9)) eoi -= 1;
      if (eoi <= end) throw new Error("That banner is damaged.");
      parts.push(input.subarray(offset, eoi + 2));
      break;
    }
    if (!isDescription(marker)) parts.push(input.subarray(offset, end));
    offset = end;
  }
  const out = new Uint8Array(parts.reduce((n, p) => n + p.byteLength, 0));
  let at = 0;
  for (const p of parts) { out.set(p, at); at += p.byteLength; }
  return out;
}
