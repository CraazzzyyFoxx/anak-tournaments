import { redirect } from "next/navigation";

// D10: rank collection config and rank mapping moved to /admin/rank (Settings tab).
export default function AdminSettingsRedirect() {
  redirect("/admin/rank");
}
