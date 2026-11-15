"use client";

import { useSyncExternalStore } from "react";
import type { AppIdentity } from "@kimono/ui";
import type { Home } from "./api";
import { BooksApp } from "./books-app";

/* Books reads where you are from the address, so it draws in the browser only. */
const never = () => () => {};
export function BooksEntry(props: { app: AppIdentity; you: { username: string; name: string; picture: string | null }; accent: string; firstName: string; home: Home | null }) {
  const here = useSyncExternalStore(never, () => true, () => false);
  if (!here) return <div className="kb" aria-busy="true" />;
  return <BooksApp {...props} />;
}

export function BooksOff() {
  return <div className="kb"><div className="kb-empty" style={{ minHeight: "100vh", alignContent: "center" }}><p>Books isn&apos;t switched on.</p></div></div>;
}
