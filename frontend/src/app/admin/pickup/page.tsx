import { redirect } from "next/navigation";

export default function AdminPickupRedirect() {
  redirect("/balancer/pickup");
}
