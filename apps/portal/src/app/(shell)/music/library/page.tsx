import { Suspense } from "react";
import { LibraryView } from "../views";

export default function MusicLibrary() {
  return <Suspense><LibraryView /></Suspense>;
}
