"use client";

import { useEffect, useImperativeHandle, useLayoutEffect, useRef, useState, type KeyboardEvent, type PointerEvent, type Ref } from "react";
import { LineIcon } from "@/components/line-icon";

/* How far in a photo can go, as on the phone. */
const maxZoom = 5;

export type Photo = { image: HTMLImageElement; url: string };
/** Draws what the frame keeps at the size asked, as a file to send. */
export type CropCut = (width: number, height: number, type: "image/png" | "image/jpeg", quality?: number) => Promise<Blob | null>;

type Place = { zoom: number; x: number; y: number };

/** Opens a picked file (or a fetched URL) as a photo to crop; rejects with a line to show. */
export function openPhoto(source: File | string, limitMb = 40): Promise<Photo> {
  return new Promise((resolve, reject) => {
    if (typeof source !== "string" && source.size > limitMb * 1024 * 1024) { reject(new Error(`That photo is over ${limitMb} MB. Choose a smaller one.`)); return; }
    const url = typeof source === "string" ? source : URL.createObjectURL(source);
    const image = new Image();
    image.onload = () => resolve({ image, url });
    image.onerror = () => { if (url.startsWith("blob:")) URL.revokeObjectURL(url); reject(new Error("This browser can't open that photo. Try a JPEG or PNG.")); };
    image.src = url;
  });
}

function fit(image: HTMLImageElement, p: Place, w: number, h: number) {
  const scale = Math.max(w / image.naturalWidth, h / image.naturalHeight) * p.zoom;
  const width = image.naturalWidth * scale, height = image.naturalHeight * scale;
  /* The frame stays covered, so the photo only moves as far as its spare edge. */
  const maxX = (width - w) / 2, maxY = (height - h) / 2;
  return { scale, width, height, x: Math.max(-maxX, Math.min(maxX, p.x)), y: Math.max(-maxY, Math.min(maxY, p.y)) };
}

/**
 * One cropper for the picture (round) and the banner (3:1 with thirds): drag
 * to move, pinch, wheel or slide to zoom, arrows to nudge. The photo always
 * covers the frame; [ref] draws what's kept. Key it by the photo so a new one starts afresh.
 */
export function PhotoCrop({ photo, aspect, round = false, label, ref }: { photo: Photo; aspect: number; round?: boolean; label: string; ref: Ref<CropCut> }) {
  const stage = useRef<HTMLDivElement>(null);
  const [size, setSizeState] = useState({ w: 600, h: 600 / aspect });
  const [place, setPlaceState] = useState<Place>({ zoom: 1, x: 0, y: 0 });
  const [moved, setMoved] = useState(false);
  /* Fingers (or the mouse) down on the frame, and where the gesture began. */
  const pointers = useRef(new Map<number, { x: number; y: number }>());
  const gesture = useRef<{ place: Place; mid: { x: number; y: number }; dist: number } | null>(null);
  /* Read by the wheel and pinch between renders, so quick events build on each other. */
  const live = useRef({ place, size });
  const setPlace = (next: Place) => { live.current.place = next; setPlaceState(next); };
  const setSize = (next: { w: number; h: number }) => { live.current.size = next; setSizeState(next); };

  useLayoutEffect(() => {
    const el = stage.current;
    if (!el) return;
    const measure = () => setSize({ w: el.clientWidth, h: el.clientWidth / aspect });
    measure();
    const watch = new ResizeObserver(measure);
    watch.observe(el);
    return () => watch.disconnect();
  }, [aspect]);

  const settle = (next: Place, s = live.current.size) => { const p = fit(photo.image, next, s.w, s.h); return { zoom: next.zoom, x: p.x, y: p.y }; };
  /* Zooms keeping the point under (px, py), measured from the frame's middle, where it is. */
  const zoomAbout = (from: Place, zoom: number, px: number, py: number): Place => {
    const z = Math.max(1, Math.min(maxZoom, zoom));
    const { w, h } = live.current.size;
    const k = fit(photo.image, { ...from, zoom: z }, w, h).scale / fit(photo.image, from, w, h).scale;
    return settle({ zoom: z, x: px - (px - from.x) * k, y: py - (py - from.y) * k });
  };
  const fromMiddle = (clientX: number, clientY: number) => {
    const r = stage.current!.getBoundingClientRect();
    return { x: clientX - r.left - r.width / 2, y: clientY - r.top - r.height / 2 };
  };

  useImperativeHandle(ref, () => async (outW, outH, type, quality) => {
    const { w, h } = live.current.size;
    const p = fit(photo.image, live.current.place, w, h);
    const canvas = document.createElement("canvas");
    canvas.width = outW; canvas.height = outH;
    const context = canvas.getContext("2d");
    if (!context) return null;
    context.imageSmoothingQuality = "high";
    context.drawImage(photo.image, (p.width / 2 - p.x - w / 2) / p.scale, (p.height / 2 - p.y - h / 2) / p.scale, w / p.scale, h / p.scale, 0, 0, outW, outH);
    return new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, type, quality));
  }, [photo]);

  /* Wheel and trackpad pinch (wheel + ctrl) zoom about the cursor; it has to be a non-passive listener to keep the page still. */
  useEffect(() => {
    const el = stage.current;
    if (!el) return;
    const wheel = (e: WheelEvent) => {
      e.preventDefault();
      const dy = e.deltaMode === 1 ? e.deltaY * 16 : e.deltaY;
      const from = live.current.place;
      const at = fromMiddle(e.clientX, e.clientY);
      setPlace(zoomAbout(from, from.zoom * Math.exp(-dy * (e.ctrlKey ? .01 : .002)), at.x, at.y));
      setMoved(true);
    };
    el.addEventListener("wheel", wheel, { passive: false });
    return () => el.removeEventListener("wheel", wheel);
  });

  /* A fresh baseline whenever a finger lands or lifts, so one finger drags and two pinch. */
  function begin() {
    const all = [...pointers.current.values()];
    if (!all.length) { gesture.current = null; return; }
    const mid = { x: all.reduce((s, p) => s + p.x, 0) / all.length, y: all.reduce((s, p) => s + p.y, 0) / all.length };
    const dist = all.length > 1 ? Math.hypot(all[0].x - all[1].x, all[0].y - all[1].y) : 0;
    gesture.current = { place: live.current.place, mid, dist };
  }
  function onPointerDown(e: PointerEvent<HTMLDivElement>) {
    pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
    try { e.currentTarget.setPointerCapture(e.pointerId); } catch { /* a pointer already gone */ }
    begin();
  }
  function onPointerMove(e: PointerEvent<HTMLDivElement>) {
    if (!pointers.current.has(e.pointerId)) return;
    pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
    const start = gesture.current;
    if (!start) return;
    const all = [...pointers.current.values()];
    const mid = { x: all.reduce((s, p) => s + p.x, 0) / all.length, y: all.reduce((s, p) => s + p.y, 0) / all.length };
    const panned = { ...start.place, x: start.place.x + mid.x - start.mid.x, y: start.place.y + mid.y - start.mid.y };
    if (all.length > 1 && start.dist > 0) {
      const at = fromMiddle(mid.x, mid.y);
      setPlace(zoomAbout(panned, start.place.zoom * Math.hypot(all[0].x - all[1].x, all[0].y - all[1].y) / start.dist, at.x, at.y));
    } else setPlace(settle(panned));
    setMoved(true);
  }
  function onPointerUp(e: PointerEvent<HTMLDivElement>) { pointers.current.delete(e.pointerId); begin(); }
  function onKeyDown(e: KeyboardEvent<HTMLDivElement>) {
    const step = e.shiftKey ? 32 : 8;
    const moves: Record<string, [number, number]> = { ArrowLeft: [step, 0], ArrowRight: [-step, 0], ArrowUp: [0, step], ArrowDown: [0, -step] };
    const d = moves[e.key];
    if (d) { e.preventDefault(); setPlace(settle({ ...live.current.place, x: live.current.place.x + d[0], y: live.current.place.y + d[1] })); setMoved(true); }
    else if (e.key === "+" || e.key === "=" || e.key === "-") { e.preventDefault(); setPlace(zoomAbout(live.current.place, live.current.place.zoom * (e.key === "-" ? 1 / 1.1 : 1.1), 0, 0)); setMoved(true); }
  }

  const placed = fit(photo.image, place, size.w, size.h);
  return <div className={`photo-crop${round ? " is-round" : ""}`}>
    <div ref={stage} className="photo-crop-stage" style={{ aspectRatio: String(aspect) }} tabIndex={0} role="group" aria-label={`${label}. Drag or use the arrow keys to move, pinch or + and − to zoom.`}
      onPointerDown={onPointerDown} onPointerMove={onPointerMove} onPointerUp={onPointerUp} onPointerCancel={onPointerUp} onKeyDown={onKeyDown}>
      {/* eslint-disable-next-line @next/next/no-img-element -- a local photo being cropped */}
      <img src={photo.url} alt="" draggable={false} style={{ width: placed.width, height: placed.height, transform: `translate(calc(-50% + ${placed.x}px), calc(-50% + ${placed.y}px))` }} />
      {round ? <span className="photo-crop-ring" aria-hidden="true" /> : <span className="photo-crop-thirds" aria-hidden="true" />}
      <span className={`photo-crop-hint${moved ? " is-gone" : ""}`} aria-hidden="true"><LineIcon name="move" />Drag to move · pinch to zoom</span>
    </div>
    <label className="photo-crop-zoom"><span>Zoom</span><input type="range" min={1} max={maxZoom} step={0.01} value={place.zoom} onChange={(e) => setPlace(zoomAbout(place, Number(e.target.value), 0, 0))} /></label>
  </div>;
}
