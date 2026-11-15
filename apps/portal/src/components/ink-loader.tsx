"use client";

import { MorphLoader } from "@kimono/ui";
import { usePathname } from "next/navigation";
import { musicGold } from "@/lib/music/model";

/* The page-change loader: Kimono's morphing shape, washed in suō (packages/ui/src/loading.tsx); in Music, in its gold. */
export function InkLoader() {
  const music = usePathname()?.startsWith("/music");
  return <MorphLoader ink={music ? musicGold : undefined} className="ink-loader" />;
}
