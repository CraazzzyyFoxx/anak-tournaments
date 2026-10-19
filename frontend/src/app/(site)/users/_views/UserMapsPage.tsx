import dynamic from "next/dynamic";

import { User } from "@/types/user.types";
import type { StatsScope } from "@/lib/site/stats-scope";
import type { WorkspaceAxis } from "@/lib/site/discipline-scope";

const MapsView = dynamic(() => import("@/app/(site)/users/components/maps/MapsView"));

const UserMapsPage = ({
  user,
  scope,
  discipline,
  axis
}: {
  user: User;
  scope: StatsScope;
  discipline: string;
  axis: WorkspaceAxis;
}) => {
  return <MapsView userId={user.id} scope={scope} discipline={discipline} axis={axis} />;
};

export default UserMapsPage;
