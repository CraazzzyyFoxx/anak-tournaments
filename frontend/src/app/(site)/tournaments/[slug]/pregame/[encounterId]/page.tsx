import { PregameRoom } from "./_components/PregameRoom";

export default async function PregameRoomPage(props: {
  params: Promise<{ slug: string; encounterId: string }>;
}) {
  const { encounterId } = await props.params;
  return <PregameRoom encounterId={Number(encounterId)} />;
}
