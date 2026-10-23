import { redirect } from "next/navigation";

/** The questionnaire builder moved to Settings › Registration; old links land there. */
export default async function RegistrationFormRedirect({
  params
}: Readonly<{ params: Promise<{ id: string }> }>) {
  const { id } = await params;
  redirect(`/admin/tournaments/${id}/settings/registration`);
}
