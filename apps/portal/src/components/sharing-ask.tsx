"use client";

import { useEffect, useState } from "react";
import { Seal } from "@kimono/ui";
import { InkSheet } from "./ink-sheet";
import { JointSwitch } from "./joint-switch";

/*
 * 友 The first time you open Watch, Books or Music with a friend to share with,
 * it asks what of it your friends see. Until you answer, they see nothing of it;
 * each choice starts where it should, and Save makes them yours (lib/friends
 * decideSharing). Who sees what on your profile changes them after.
 */

type Ask = { key: string; says: string; on: boolean };

export function SharingAsk({ app, tint }: { app: "watch" | "books" | "music"; tint?: string }) {
  const [asks, setAsks] = useState<Ask[] | null>(null);
  const [on, setOn] = useState<Set<string>>(new Set());
  const [saving, setSaving] = useState(false);
  useEffect(() => {
    let live = true;
    fetch(`/api/v1/profile/sharing?app=${app}`).then((r) => (r.ok ? r.json() : null)).then((b: { ask: boolean; asks: Ask[] } | null) => {
      if (!live || !b?.ask) return;
      setAsks(b.asks);
      setOn(new Set(b.asks.filter((a) => a.on).map((a) => a.key)));
    }).catch(() => null);
    return () => { live = false; };
  }, [app]);
  if (!asks) return null;
  const save = (keys: string[]) => {
    setSaving(true);
    void fetch("/api/v1/profile", { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify({ share: app, on: keys }) })
      .finally(() => { setSaving(false); setAsks(null); });
  };
  return <InkSheet title="What your friends can see" icon="people" tint={tint} onClose={() => setAsks(null)} actions={<>
    <Seal tone="quiet" compact disabled={saving} onClick={() => save([])}>Share nothing</Seal>
    <Seal compact disabled={saving} onClick={() => save([...on])}>Save</Seal>
  </>}>
    <ul className="share-ask">
      {asks.map((a) => <li key={a.key}>
        <span>{a.says}</span>
        <JointSwitch name={`share-${a.key}`} label={a.says} defaultChecked={on.has(a.key)}
          onChange={(next) => setOn((was) => { const s = new Set(was); if (next) s.add(a.key); else s.delete(a.key); return s; })} />
      </li>)}
    </ul>
  </InkSheet>;
}
