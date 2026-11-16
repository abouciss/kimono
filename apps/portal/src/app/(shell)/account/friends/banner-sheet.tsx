"use client";

import { useEffect, useRef, useState } from "react";
import { Seal } from "@kimono/ui";
import { InkSheet } from "@/components/ink-sheet";
import { LineIcon } from "@/components/line-icon";
import { useFileDrop } from "@/components/file-drop";
import { PhotoCrop, openPhoto, type CropCut, type Photo } from "./photo-crop";

/* What's kept: 3:1, drawn at 2400×800 (lib/banner-jpeg.ts checks it). */
const outW = 2400, outH = 800;

/**
 * The band across the top of your profile: a photo, placed by dragging and
 * zooming in a 3:1 frame, re-drawn in the browser (which also leaves its
 * metadata behind) and sent as a 2400×800 JPEG. Remove puts your colour back.
 */
export function BannerSheet({ banner, color, onClose, onSaved }: { banner: string | null; color: string; onClose: () => void; onSaved: (banner: string | null) => void }) {
  const input = useRef<HTMLInputElement>(null);
  const cut = useRef<CropCut | null>(null);
  const [photo, setPhoto] = useState<Photo | null>(null);
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);

  useEffect(() => () => { if (photo?.url.startsWith("blob:")) URL.revokeObjectURL(photo.url); }, [photo?.url]);

  const open = (source: File | string) => openPhoto(source).then(setPhoto, (e: Error) => setProblem(e.message));
  function choose(file: File | undefined) { setProblem(null); if (file) void open(file); }
  /* The banner you have, back in the frame to move or zoom. */
  async function adjust() {
    if (!banner) return;
    setProblem(null);
    try { const blob = await fetch(banner).then((r) => r.blob()); void open(URL.createObjectURL(blob)); } catch { setProblem("Your banner couldn't be opened."); }
  }
  useFileDrop(busy ? null : { label: "Drop to use as your banner", onDrop: (data) => {
    const file = Array.from(data.files).find((f) => f.type.startsWith("image/"));
    if (file) choose(file); else setProblem("That isn't a photo.");
  } });

  async function send(method: "PUT" | "DELETE", body?: Blob) {
    setBusy(true); setProblem(null);
    try {
      const response = await fetch("/api/v1/me/banner", { method, headers: body ? { "Content-Type": "image/jpeg" } : undefined, body });
      const reply = await response.json().catch(() => ({})) as { banner?: string | null; error?: string };
      if (!response.ok) throw new Error(reply.error || "Your banner could not be saved.");
      onSaved(reply.banner ?? null);
      onClose();
    } catch (error) { setProblem(error instanceof Error ? error.message : "Your banner could not be saved."); }
    setBusy(false);
  }
  async function save() {
    const blob = await cut.current?.(outW, outH, "image/jpeg", .86);
    if (!blob) { setProblem("Your browser couldn't prepare the banner."); return; }
    await send("PUT", blob);
  }

  return <InkSheet title="Banner" icon="camera" onClose={onClose} actions={photo ? <>
    <Seal tone="quiet" compact onClick={() => setPhoto(null)} disabled={busy}>Back</Seal>
    <Seal tone="quiet" compact onClick={() => input.current?.click()} disabled={busy}>Another photo</Seal>
    <Seal compact busy={busy} onClick={() => void save()}>Use this banner</Seal>
  </> : <>
    {banner ? <Seal tone="quiet" compact busy={busy} onClick={() => void send("DELETE")}>Remove</Seal> : null}
    {banner ? <Seal tone="quiet" compact onClick={() => void adjust()} disabled={busy}><LineIcon name="crop" />Crop</Seal> : null}
    <Seal compact onClick={() => input.current?.click()} disabled={busy}><LineIcon name="camera" />{banner ? "New photo" : "Choose a photo"}</Seal>
  </>}>
    <input ref={input} type="file" accept="image/*" hidden onChange={(e) => { choose(e.target.files?.[0]); e.target.value = ""; }} />
    <div className="fr-banner-edit">
      {photo ? <PhotoCrop photo={photo} aspect={3} label="Banner position" ref={cut} key={photo.url} />
        : <button type="button" className="fr-banner-stage is-current" style={{ backgroundColor: color, backgroundImage: banner ? `url(${banner})` : undefined }} onClick={() => (banner ? void adjust() : input.current?.click())} aria-label={banner ? "Crop your banner" : "Choose a photo for your banner"}>
          {banner ? null : <span><LineIcon name="camera" />Drop a photo, or choose one</span>}
        </button>}
      {problem ? <p className="fr-problem" role="alert">{problem}</p> : null}
    </div>
  </InkSheet>;
}
