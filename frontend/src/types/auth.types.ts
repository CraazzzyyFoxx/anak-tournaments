import { User } from "@/types/user.types";

export interface IAuthForm {
  email: string;
  password: string;
}

export interface IAuthResponse {
  access_token: string;
  user: User;
}

export type TypeUserForm = Omit<User, "id"> & { password?: string };

export interface IRegisterForm {
  email: string;
  password: string;
  name: string;
}
