"use client";

import { useEffect, useState } from "react";
import { Choice, InkBlot } from "@kimono/ui";
import { LineIcon } from "./line-icon";

/* Light, dark, or as the device is: kept in this browser, and put on <html> before the page paints. */
const KEY = "kimono.appearance";

/** The script <head> runs first, so a dark page never flashes light. */
export const appearanceScript = `try{var t=localStorage.getItem("${KEY}");if(t==="dark"||t==="light")document.documentElement.dataset.theme=t}catch(e){}`;

/** One tap between light and dark, from whichever the page is in now; kept like the Appearance row. */
export function AppearanceFlip({ className }: { className?: string }) {
  const [dark, setDark] = useState<boolean | null>(null);
  useEffect(() => {
    const read = () => setDark(document.documentElement.dataset.theme ? document.documentElement.dataset.theme === "dark" : matchMedia("(prefers-color-scheme: dark)").matches);
    read();
    const media = matchMedia("(prefers-color-scheme: dark)");
    media.addEventListener("change", read);
    return () => media.removeEventListener("change", read);
  }, []);
  const flip = () => {
    const next = dark ? "light" : "dark";
    document.documentElement.dataset.theme = next;
    try { localStorage.setItem(KEY, next); } catch { /* kept for this page only */ }
    setDark(!dark);
  };
  return <button type="button" className={className} onClick={flip} aria-label={dark ? "Light" : "Dark"} title={dark ? "Light" : "Dark"}>
    <LineIcon name={dark ? "sun" : "moon"} />
  </button>;
}

/** You's Appearance row: As the device is, Light or Dark. */
export function AppearanceRow() {
  const [look, setLook] = useState("system");
  useEffect(() => { try { setLook(localStorage.getItem(KEY) ?? "system"); } catch { /* storage blocked: as the device is */ } }, []);
  const choose = (next: string) => {
    setLook(next);
    try { if (next === "system") localStorage.removeItem(KEY); else localStorage.setItem(KEY, next); } catch { /* kept for this page only */ }
    if (next === "system") delete document.documentElement.dataset.theme; else document.documentElement.dataset.theme = next;
  };
  return <div className="row you-appearance">
    <InkBlot tint="#8a7c77" seed="appearance"><LineIcon name="moon" /></InkBlot>
    <span className="text"><b>Appearance</b></span>
    <Choice compact aria-label="Appearance" value={look} onChange={choose} options={[{ value: "system", label: "As the device is" }, { value: "light", label: "Light" }, { value: "dark", label: "Dark" }]} />
  </div>;
}
