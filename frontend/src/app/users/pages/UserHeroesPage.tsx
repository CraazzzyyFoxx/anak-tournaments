import React from "react";

import { User } from "@/types/user.types";
import userService from "@/services/user.service";
import UserHeroes from "@/app/users/components/UserHeroes";

const UserHeroesPage = async ({ user }: { user: User }) => {
  const heroes = await userService.getUserHeroes(user.id);
  return <UserHeroes heroes={heroes.results} />;
};

export default UserHeroesPage;
