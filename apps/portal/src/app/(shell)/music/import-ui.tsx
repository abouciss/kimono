"use client";

import { useEffect, useRef, useState } from "react";
import { InkWave, Seal } from "@kimono/ui";
import { useCrossTo } from "@/components/crossing";
import { InkSheet } from "@/components/ink-sheet";
import { forget, hrefOf } from "./api";

type Step =
  | { stage: "idle" }
  | { stage: "read"; name: string; total: number; cut: boolean }
  | { stage: "match"; name: string; done: number; found: number; total: number; cut: boolean }
  | { stage: "done"; playlist: { id: string; name: string }; found: number; total: number; missed: { title: string; artists: string[] }[] }
  | { stage: "error"; error: string };

const services = /spotify\.com|spotify:|music\.apple\.com|youtube\.com|youtu\.be/;

/** A playlist from Spotify, Apple Music or YouTube Music, made one here: the server reads it and finds each song, telling us as it goes. */
export function ImportSheet({ onClose }: { onClose: () => void }) {
  const [url, setUrl] = useState("");
  const [step, setStep] = useState<Step>({ stage: "idle" });
  const crossTo = useCrossTo();
  const field = useRef<HTMLInputElement>(null);
  useEffect(() => field.current?.focus(), []);
  const busy = step.stage === "read" || step.stage === "match";

  const start = async () => {
    if (!url.trim() || busy) return;
    setStep({ stage: "read", name: "", total: 0, cut: false });
    try {
      const res = await fetch("/api/v1/music/import", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ url: url.trim() }) });
      if (!res.ok || !res.body) {
        const body = await res.json().catch(() => null) as { error?: string } | null;
        setStep({ stage: "error", error: body?.error || "That playlist couldn't be brought in." });
        return;
      }
      const reader = res.body.pipeThrough(new TextDecoderStream()).getReader();
      let rest = "", name = "", cut = false, ended = false;
      for (;;) {
        const { value, done } = await reader.read();
        if (done) break;
        rest += value;
        const lines = rest.split("\n");
        rest = lines.pop() ?? "";
        for (const line of lines) {
          if (!line.trim()) continue;
          const said = JSON.parse(line) as Step & Record<string, unknown>;
          if (said.stage === "read") { name = said.name; cut = said.cut; setStep(said); }
          else if (said.stage === "match") setStep({ ...said, name, cut });
          else if (said.stage === "done") { ended = true; forget("me"); forget("playlists"); forget("home"); setStep(said); }
          else if (said.stage === "error") { ended = true; setStep(said); }
        }
      }
      if (!ended) setStep({ stage: "error", error: "The import stopped partway. Try again." });
    } catch {
      setStep({ stage: "error", error: "Music didn't answer. Try again in a moment." });
    }
  };

  const actions = step.stage === "done"
    ? <><Seal tone="quiet" compact onClick={onClose}>Close</Seal><Seal compact onClick={() => { onClose(); crossTo("kakejiku", hrefOf.playlist(step.playlist.id)); }}>Open it</Seal></>
    : <><Seal tone="quiet" compact onClick={onClose}>{busy ? "Hide" : "Cancel"}</Seal>{busy ? null : <Seal compact onClick={start} disabled={!services.test(url)}>Bring it in</Seal>}</>;

  return <InkSheet title="Bring a playlist in" icon="download" tint="#946c25" onClose={onClose} actions={actions}>
    {step.stage === "idle" || step.stage === "error"
      ? <form className="km-import" onSubmit={(e) => { e.preventDefault(); void start(); }}>
        <label className="field"><small>Playlist link</small>
          <input ref={field} value={url} onChange={(e) => setUrl(e.target.value)} placeholder="Spotify, Apple Music or YouTube Music" inputMode="url" autoComplete="off" spellCheck={false} />
        </label>
        {step.stage === "error" ? <p className="km-import-problem" role="alert">{step.error}</p> : null}
      </form>
      : step.stage === "done"
        ? <div className="km-import">
          <p className="km-import-name">{step.playlist.name}</p>
          <p className="km-import-count">{step.found === step.total ? `All ${step.total} songs` : `${step.found} of ${step.total} songs`}</p>
          {step.missed.length ? <details className="km-import-missed">
            <summary>{step.total - step.found} not in Music</summary>
            <ul>{step.missed.map((m, i) => <li key={i}><b>{m.title}</b>{m.artists.length ? <span>{m.artists.join(", ")}</span> : null}</li>)}</ul>
          </details> : null}
        </div>
        : <div className="km-import" aria-live="polite">
          <p className="km-import-name">{step.name || "Reading the playlist…"}</p>
          <InkWave className="km-import-wave" value={step.stage === "match" && step.total ? step.done / step.total : undefined} label="Finding songs" />
          <p className="km-import-count">{step.stage === "match" ? `Found ${step.found} of ${step.total}` : step.total ? `${step.total} songs` : " "}</p>
          {step.cut ? <p className="km-import-note">Only its first 100 songs came through.</p> : null}
        </div>}
  </InkSheet>;
}
