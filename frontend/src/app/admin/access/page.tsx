import { redirect } from "next/navigation";

export default function AccessAdminIndexPage() {
  redirect("/admin/access/users");
}
