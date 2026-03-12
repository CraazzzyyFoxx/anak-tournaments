import React from "react";
import dynamic from "next/dynamic";

import { User } from "@/types/user.types";

const UserMapsExplorer = dynamic(() => import("@/app/(site)/users/components/UserMapsExplorer"));

const UserMapsPage = ({ user }: { user: User }) => {
  return <UserMapsExplorer userId={user.id} />;
};

export default UserMapsPage;
