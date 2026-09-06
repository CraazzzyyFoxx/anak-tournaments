import { redirect } from "next/navigation";

/** `/collectors` is a container, not a screen: its first section is Rank. */
export default function CollectorsIndexPage() {
  redirect("/admin/collectors/rank");
}
