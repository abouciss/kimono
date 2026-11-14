import { redirect } from "next/navigation";

/* Kimono AI's feedback lives with the rest of it, under Applications. */
export default function Moved() { redirect("/admin/apps/kimono-code?view=feedback"); }
