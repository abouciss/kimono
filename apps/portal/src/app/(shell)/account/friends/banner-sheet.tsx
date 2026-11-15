"use client";

import { useEffect, useLayoutEffect, useRef, useState, type KeyboardEvent, type PointerEvent } from "react";
import { Seal } from "@kimono/ui";
import { InkSheet } from "@/components/ink-sheet";
import { LineIcon } from "@/components/line-icon";
import { useFileDrop } from "@/components/file-drop";

/* What's kept: 3:1, drawn at 2400×800 (lib/banner-jpeg.ts checks it). */
const outW = 2400, outH = 800;

type Crop = { image: HTMLImageElement; url: string; zoom: number; x: number; y: number };

function fit(crop: Crop, w: number, h: number) {
  const scale = Math.max(w / crop.image.naturalWidth, h / crop.image.naturalHeight) * crop.zoom;
  const width = crop.image.naturalWidth * scale, height = crop.image.naturalHeight * scale;
  /* The frame stays covered, so the photo only moves as far as its spare edge. */
  const maxX = (width - w) / 2, maxY = (height - h) / 2;
  return { scale, width, height, x: Math.max(-maxX, Math.min(maxX, crop.x)), y: Math.max(-maxY, Math.min(maxY, crop.y)) };
}

/**
 * The band across the top of your profile: a photo, placed by dragging and
 * zooming in a 3:1 frame, re-drawn in the browser (which also leaves its
 * metadata behind) and sent as a 2400×800 JPEG. Remove puts your colour back.
 */
export function BannerSheet({ banner, color, onClose, onSaved }: { banner: string | null; color: string; onClose: () => void; onSaved: (banner: string | null) => void }) {
  const input = useRef<HTMLInputElement>(null);
  const stage = useRef<HTMLDivElement>(null);
  const drag = useRef<{ x: number; y: number; startX: number; startY: number } | null>(null);
  const [crop, setCrop] = useState<Crop | null>(null);
  const [size, setSize] = useState({ w: 600, h: 200 });
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);

  useEffect(() => () => { if (crop?.url.startsWith("blob:")) URL.revokeObjectURL(crop.url); }, [crop?.url]);  
  useLayoutEffect(() => {
    const el = stage.current;
    if (!el) return;
    const measure = () => setSize({ w: el.clientWidth, h: el.clientWidth / 3 });
    measure();
    const watch = new ResizeObserver(measure);
    watch.observe(el);
    return () => watch.disconnect();
  }, [crop !== null]); // eslint-disable-line react-hooks/exhaustive-deps

  function open(url: string) {
    const image = new Image();
    image.onload = () => setCrop({ image, url, zoom: 1, x: 0, y: 0 });
    image.onerror = () => { if (url.startsWith("blob:")) URL.revokeObjectURL(url); setProblem("This browser can't open that photo. Try a JPEG or PNG."); };
    image.src = url;
  }
  function choose(file: File | undefined) {
    setProblem(null);
    if (!file) return;
    if (file.size > 40 * 1024 * 1024) { setProblem("That photo is over 40 MB. Choose a smaller one."); return; }
    open(URL.createObjectURL(file));
  }
  /* The banner you have, back in the frame to move or zoom. */
  async function adjust() {
    if (!banner) return;
    setProblem(null);
    try { const blob = await fetch(banner).then((r) => r.blob()); open(URL.createObjectURL(blob)); } catch { setProblem("Your banner couldn't be opened."); }
  }
  useFileDrop(busy ? null : { label: "Drop to use as your banner", onDrop: (data) => {
    const photo = Array.from(data.files).find((f) => f.type.startsWith("image/"));
    if (photo) choose(photo); else setProblem("That isn't a photo.");
  } });

  const place = (next: Crop) => { const p = fit(next, size.w, size.h); setCrop({ ...next, x: p.x, y: p.y }); };
  function onPointerDown(e: PointerEvent<HTMLDivElement>) {
    if (!crop) return;
    e.currentTarget.setPointerCapture(e.pointerId);
    drag.current = { x: e.clientX, y: e.clientY, startX: crop.x, startY: crop.y };
  }
  function onPointerMove(e: PointerEvent<HTMLDivElement>) {
    const start = drag.current;
    if (start && crop) place({ ...crop, x: start.startX + e.clientX - start.x, y: start.startY + e.clientY - start.y });
  }
  function onKeyDown(e: KeyboardEvent<HTMLDivElement>) {
    const step = e.shiftKey ? 32 : 8;
    const moves: Record<string, [number, number]> = { ArrowLeft: [step, 0], ArrowRight: [-step, 0], ArrowUp: [0, step], ArrowDown: [0, -step] };
    const d = moves[e.key];
    if (d && crop) { e.preventDefault(); place({ ...crop, x: crop.x + d[0], y: crop.y + d[1] }); }
  }

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
    if (!crop) return;
    const p = fit(crop, size.w, size.h);
    const canvas = document.createElement("canvas");
    canvas.width = outW; canvas.height = outH;
    const context = canvas.getContext("2d");
    if (!context) { setProblem("Your browser couldn't prepare the banner."); return; }
    context.imageSmoothingQuality = "high";
    context.drawImage(crop.image, (p.width / 2 - p.x - size.w / 2) / p.scale, (p.height / 2 - p.y - size.h / 2) / p.scale, size.w / p.scale, size.h / p.scale, 0, 0, outW, outH);
    const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/jpeg", .86));
    if (!blob) { setProblem("Your browser couldn't prepare the banner."); return; }
    await send("PUT", blob);
  }

  const placed = crop ? fit(crop, size.w, size.h) : null;
  return <InkSheet title="Banner" icon="camera" onClose={onClose} actions={crop ? <>
    <Seal tone="quiet" compact onClick={() => setCrop(null)} disabled={busy}>Back</Seal>
    <Seal tone="quiet" compact onClick={() => input.current?.click()} disabled={busy}>Another photo</Seal>
    <Seal compact busy={busy} onClick={() => void save()}>Use this banner</Seal>
  </> : <>
    {banner ? <Seal tone="quiet" compact busy={busy} onClick={() => void send("DELETE")}>Remove</Seal> : null}
    {banner ? <Seal tone="quiet" compact onClick={() => void adjust()} disabled={busy}><LineIcon name="crop" />Crop</Seal> : null}
    <Seal compact onClick={() => input.current?.click()} disabled={busy}><LineIcon name="camera" />{banner ? "New photo" : "Choose a photo"}</Seal>
  </>}>
    <input ref={input} type="file" accept="image/*" hidden onChange={(e) => { choose(e.target.files?.[0]); e.target.value = ""; }} />
    <div className="fr-banner-edit">
      {crop && placed ? <>
        <div ref={stage} className="fr-banner-stage" tabIndex={0} role="group" aria-label="Banner position. Drag, or use the arrow keys, to move the photo."
          onPointerDown={onPointerDown} onPointerMove={onPointerMove} onPointerUp={() => { drag.current = null; }} onPointerCancel={() => { drag.current = null; }} onKeyDown={onKeyDown}>
          {/* eslint-disable-next-line @next/next/no-img-element -- a local photo being cropped */}
          <img src={crop.url} alt="" draggable={false} style={{ width: placed.width, height: placed.height, transform: `translate(calc(-50% + ${placed.x}px), calc(-50% + ${placed.y}px))` }} />
          <span className="fr-banner-thirds" aria-hidden="true" />
          <span className="fr-banner-hint" aria-hidden="true"><LineIcon name="move" />Drag to move</span>
        </div>
        <label className="fr-banner-zoom"><span>Zoom</span><input type="range" min={1} max={4} step={0.01} value={crop.zoom} onChange={(e) => place({ ...crop, zoom: Number(e.target.value) })} /></label>
      </> : <button type="button" className="fr-banner-stage is-current" style={{ backgroundColor: color, backgroundImage: banner ? `url(${banner})` : undefined }} onClick={() => (banner ? void adjust() : input.current?.click())} aria-label={banner ? "Crop your banner" : "Choose a photo for your banner"}>
        {banner ? null : <span><LineIcon name="camera" />Drop a photo, or choose one</span>}
      </button>}
      {problem ? <p className="fr-problem" role="alert">{problem}</p> : null}
    </div>
  </InkSheet>;
}
