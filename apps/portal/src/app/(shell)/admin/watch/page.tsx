import { redirect } from "next/navigation";

/* Screens are set on Kimono Watch's own page. */
export default function Moved() { redirect("/admin/apps/kimono-watch?view=people"); }
