import axios, { AxiosResponse, type CreateAxiosDefaults } from "axios";
import JSONbigint from "json-bigint";
import { IAuthResponse } from "@/types/auth.types";
import { getAccessToken, removeFromStorage, saveTokenStorage } from "@/services/cookie.service";
import { authService } from "@/services/auth.service";

export const PUBLIC_API_URL = process.env.NEXT_PUBLIC_API_URL;
export const API_URL = process.env.NEXT_PUBLIC_API_URL;

const options: CreateAxiosDefaults = {
  baseURL: API_URL,
  headers: {
    "Content-Type": "application/json"
  },
  withCredentials: true,
  transformResponse: [
    (data) => {
      try {
        return JSONbigint.parse(data);
      } catch (error) {
        return data;
      }
    }
  ]
};

function isUnauthorizedError(error: any) {
  const {
    response: { status }
  } = error;
  return status === 401;
}

let refreshingFunc: Promise<AxiosResponse<IAuthResponse>> | undefined = undefined;

const axiosClassic = axios.create(options);
const axiosWithAuth = axios.create(options);

axiosWithAuth.interceptors.request.use((config) => {
  const accessToken = getAccessToken();

  if (config?.headers && accessToken) config.headers.Authorization = `Bearer ${accessToken}`;

  return config;
});

axiosWithAuth.interceptors.response.use(
  (config) => config,
  async (error) => {
    const originalConfig = error.config;

    if (!isUnauthorizedError(error)) {
      return Promise.reject(error);
    }
    removeFromStorage();
    try {
      if (!refreshingFunc) refreshingFunc = authService.getNewTokens();

      const newToken = await refreshingFunc;

      saveTokenStorage(newToken.data.access_token);
      originalConfig.headers.Authorization = `Bearer ${newToken.data.access_token}`;

      try {
        return await axios.request(originalConfig);
      } catch (innerError) {
        if (isUnauthorizedError(innerError)) {
          throw innerError;
        }
      }
    } catch (err) {
      removeFromStorage();
    } finally {
      refreshingFunc = undefined;
    }
  }
);

export { axiosClassic, axiosWithAuth };
