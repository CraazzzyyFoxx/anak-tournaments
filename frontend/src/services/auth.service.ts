import { axiosClassic, axiosWithAuth } from "@/lib/interceptors";
import { saveTokenStorage } from "./cookie.service";
import { IAuthResponse } from "@/types/auth.types";

export const authService = {
  async getNewTokensWithSave() {
    const response = await axiosClassic.post<IAuthResponse>("/auth/refresh-token");

    if (response.data.access_token) saveTokenStorage(response.data.access_token);

    return response;
  },
  async getNewTokens() {
    return await axiosWithAuth.post<IAuthResponse>("/auth/refresh-token");
  },
  async getNewTokensServer() {
    return await axiosWithAuth.post<IAuthResponse>("/auth/refresh-token");
  }
};
