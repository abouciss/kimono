"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Seal } from "@kimono/ui";
import { InkSheet } from "@/components/ink-sheet";
import { LineIcon } from "@/components/line-icon";
import { useFileDrop } from "@/components/file-drop";
import { Portrait } from "@/components/portrait";
import { useCrossTo } from "@/components/crossing";
import { PhotoCrop, openPhoto, type CropCut, type Photo } from "./photo-crop";

/* What's kept: the circle's square, drawn at 512×512 (lib/picture-png.ts checks it). */
const out = 512;

/**
 * Your picture: a photo placed by dragging and zooming in a round frame,
 * re-drawn in the browser (which leaves its metadata behind) and sent as a
 * 512×512 PNG. Remove puts your initials back.
 */
export function PictureSheet({ name, username, picture, onClose, onSaved }: { name: string; username: string; picture: string | null; onClose: () => void; onSaved?: (picture: string | null) => void }) {
  const router = useRouter();
  const input = useRef<HTMLInputElement>(null);
  const cut = useRef<CropCut | null>(null);
  const [photo, setPhoto] = useState<Photo | null>(null);
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);

  useEffect(() => () => { if (photo?.url.startsWith("blob:")) URL.revokeObjectURL(photo.url); }, [photo?.url]);

  const open = (source: File | string) => openPhoto(source).then(setPhoto, (e: Error) => setProblem(e.message));
  function choose(file: File | undefined) { setProblem(null); if (file) void open(file); }
  async function adjust() {
    if (!picture) return;
    setProblem(null);
    try { const blob = await fetch(picture).then((r) => r.blob()); void open(URL.createObjectURL(blob)); } catch { setProblem("Your picture couldn't be opened."); }
  }
  useFileDrop(busy ? null : { label: "Drop to use as your picture", onDrop: (data) => {
    const file = Array.from(data.files).find((f) => f.type.startsWith("image/"));
    if (file) choose(file); else setProblem("That isn't a photo.");
  } });

  async function send(method: "PUT" | "DELETE", body?: Blob) {
    setBusy(true); setProblem(null);
    try {
      const response = await fetch("/api/v1/me/picture", { method, headers: body ? { "Content-Type": "image/png" } : undefined, body });
      const reply = await response.json().catch(() => ({})) as { picture?: string | null; error?: string };
      if (!response.ok) throw new Error(reply.error || "Your picture could not be saved.");
      onSaved?.(reply.picture ?? null);
      router.refresh();
      onClose();
    } catch (error) { setProblem(error instanceof Error ? error.message : "Your picture could not be saved."); }
    setBusy(false);
  }
  async function save() {
    const blob = await cut.current?.(out, out, "image/png");
    if (!blob) { setProblem("Your browser couldn't prepare the picture."); return; }
    await send("PUT", blob);
  }

  return <InkSheet title="Picture" icon="camera" onClose={onClose} actions={photo ? <>
    <Seal tone="quiet" compact onClick={() => setPhoto(null)} disabled={busy}>Back</Seal>
    <Seal tone="quiet" compact onClick={() => input.current?.click()} disabled={busy}>Another photo</Seal>
    <Seal compact busy={busy} onClick={() => void save()}>Use this picture</Seal>
  </> : <>
    {picture ? <Seal tone="quiet" compact busy={busy} onClick={() => void send("DELETE")}>Remove picture</Seal> : null}
    {picture ? <Seal tone="quiet" compact onClick={() => void adjust()} disabled={busy}><LineIcon name="crop" />Crop</Seal> : null}
    <Seal compact onClick={() => input.current?.click()} disabled={busy}><LineIcon name="camera" />{picture ? "New photo" : "Choose a photo"}</Seal>
  </>}>
    <input ref={input} type="file" accept="image/*" hidden onChange={(e) => { choose(e.target.files?.[0]); e.target.value = ""; }} />
    <div className="fr-picture-edit">
      {photo ? <PhotoCrop photo={photo} aspect={1} round label="Picture position" ref={cut} key={photo.url} />
        : <button type="button" className="fr-picture-current" onClick={() => (picture ? void adjust() : input.current?.click())} aria-label={picture ? "Crop your picture" : "Choose a photo for your picture"}>
          <Portrait name={name} username={username} picture={picture} size={200} />
          {picture ? null : <span className="fr-picture-hint"><LineIcon name="camera" />Drop a photo, or choose one</span>}
        </button>}
      {problem ? <p className="fr-problem" role="alert">{problem}</p> : null}
    </div>
  </InkSheet>;
}

/** The same sheet at /account?sheet=picture, closed back to the page. */
export function PictureSheetRoute(props: { name: string; username: string; picture: string | null }) {
  const crossTo = useCrossTo();
  return <PictureSheet {...props} onClose={() => crossTo("kakejiku", "/account")} />;
}
