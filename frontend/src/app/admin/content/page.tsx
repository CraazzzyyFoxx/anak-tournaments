import { redirect } from "next/navigation";

/** The section root is not a screen: the first tab is. */
export default function GameContentIndex() {
  redirect("/admin/content/heroes");
}
