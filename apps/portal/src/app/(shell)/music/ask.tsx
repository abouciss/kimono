"use client";

import { useEffect, useRef, useState } from "react";
import { Seal } from "@kimono/ui";

/*
 * Music's two questions, in a raised dialog rather than the browser's own:
 * a name (a new playlist, a rename) and "are you sure" (deleting one).
 * `askName` and `askSure` answer as promises; <Asker /> draws whichever is open.
 */

type Question =
  | { kind: "name"; title: string; value: string; action: string; done: (v: string | null) => void }
  | { kind: "sure"; title: string; text: string; action: string; done: (v: boolean) => void };

let show: ((q: Question) => void) | null = null;

export const askName = (title: string, action: string, value = "") =>
  new Promise<string | null>((done) => (show ? show({ kind: "name", title, value, action, done }) : done(null)));

export const askSure = (title: string, text: string, action: string) =>
  new Promise<boolean>((done) => (show ? show({ kind: "sure", title, text, action, done }) : done(false)));

export function Asker() {
  const [q, setQ] = useState<Question | null>(null);
  const [value, setValue] = useState("");
  const box = useRef<HTMLDialogElement>(null);
  const answered = useRef(false);
  useEffect(() => { show = (next) => { answered.current = false; setValue(next.kind === "name" ? next.value : ""); setQ(next); }; return () => { show = null; }; }, []);
  useEffect(() => { if (q && !box.current?.open) box.current?.showModal(); }, [q]);
  const finish = (ok: boolean) => {
    if (!q || answered.current) return;
    answered.current = true;
    if (q.kind === "name") q.done(ok && value.trim() ? value.trim() : null); else q.done(ok);
    box.current?.close();
    setQ(null);
  };
  if (!q) return null;
  return <dialog ref={box} className="km-ask" aria-labelledby="km-ask-title" onClose={() => finish(false)} onClick={(e) => { if (e.target === box.current) finish(false); }}>
    <form method="dialog" onSubmit={(e) => { e.preventDefault(); finish(true); }}>
      <h2 id="km-ask-title" className="km-ask-title">{q.title}</h2>
      {q.kind === "name"
        ? <input className="km-ask-field" autoFocus value={value} maxLength={120} onChange={(e) => setValue(e.target.value)} aria-label={q.title} />
        : <p className="km-ask-text">{q.text}</p>}
      <div className="k-seal-group km-ask-actions">
        <Seal type="submit" tone={q.kind === "sure" ? "danger" : "primary"} disabled={q.kind === "name" && !value.trim()}>{q.action}</Seal>
        <Seal type="button" tone="quiet" onClick={() => finish(false)}>Cancel</Seal>
      </div>
    </form>
  </dialog>;
}
