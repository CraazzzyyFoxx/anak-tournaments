import React from "react";

import { User } from "@/types/user.types";
import userService from "@/services/user.service";
import UserMapsTable from "@/app/users/components/UserMapsTable";

const UserMapsPage = async ({ user }: { user: User }) => {
  const maps = await userService.getUserTopMaps(user.id);
  return <UserMapsTable maps={maps} />;
};

export default UserMapsPage;
