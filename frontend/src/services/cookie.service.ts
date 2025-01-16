import Cookies from "js-cookie";
import { User } from "@/types/user.types";

export enum EnumTokens {
  "ACCESS_TOKEN" = "accessToken",
  "USER" = "user"
}

export const getAccessToken = () => {
  const accessToken = Cookies.get(EnumTokens.ACCESS_TOKEN);
  return accessToken || null;
};

export const saveTokenStorage = (accessToken: string) => {
  Cookies.set(EnumTokens.ACCESS_TOKEN, accessToken, {
    domain: process.env.NEXT_PUBLIC_COOKIE_URL,
    sameSite: "strict",
    expires: 0.0416
  });
};

export const removeFromStorage = () => {
  Cookies.remove(EnumTokens.ACCESS_TOKEN);
};

export const saveUserStorage = (user: User) => {
  Cookies.set(EnumTokens.USER, JSON.stringify(user), {
    domain: process.env.NEXT_PUBLIC_COOKIE_URL,
    sameSite: "strict"
  });
};

export const getUserFromStorage = () => {
  const user = Cookies.get(EnumTokens.USER);
  return user ? JSON.parse(user) : null;
};
