import { http } from "./http";
import type { YggdrasilLoginInput, PublicAccount } from "./types";

export const accountsApi = {
  list: (): Promise<PublicAccount[]> => http.get("/api/v1/accounts"),
  get: (id: string): Promise<PublicAccount> => http.get(`/api/v1/accounts/${id}`),
  remove: (id: string): Promise<{ loggedOut: boolean }> =>
    http.del(`/api/v1/accounts/${id}`),
  createOffline: (username: string): Promise<PublicAccount> =>
    http.post("/api/v1/auth/offline", { username }),
  loginYggdrasil: (input: YggdrasilLoginInput): Promise<PublicAccount> =>
    http.post("/api/v1/auth/yggdrasil", input),
};