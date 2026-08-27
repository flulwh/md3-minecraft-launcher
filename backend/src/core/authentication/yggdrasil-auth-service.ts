import { HttpClient, HttpResult } from "../../infrastructure/http/http-client.js";
import { AuthError } from "../../errors/index.js";
import { Logger } from "../../config/logger.js";

/** A character/profile belonging to a Yggdrasil account. */
export interface YggdrasilProfile {
  id: string;
  name: string;
  /** texture / uploadable properties kept as raw JSON when present */
  properties?: unknown[];
}

export interface AuthenticateResult {
  accessToken: string;
  clientToken: string;
  profiles: YggdrasilProfile[];
}

export interface RefreshedSession {
  accessToken: string;
  clientToken: string;
  profileId: string;
}

const ENDPOINTS = {
  authenticate: "/authserver/authenticate",
  refresh: "/authserver/refresh",
  validate: "/authserver/validate",
};

/**
 * Yggdrasil (authlib-injector) authentication service.
 *
 * LittleSkin is the default provider; the base URL is read from configuration.
 * Standard Yggdrasil flow: authenticate with account e-mail + password to obtain
 * an accessToken / clientToken pair, then validate or refresh that pair on later
 * launches. Tokens are stored encrypted by AuthenticationService.
 */
export class YggdrasilAuthService {
  constructor(
    private readonly http: HttpClient,
    private readonly baseUrl: string,
    private readonly logger: Logger,
  ) {}

  /**
   * Authenticate against the auth server with account credentials.
   * Returns the token pair plus the available game characters.
   */
  async authenticate(username: string, password: string): Promise<AuthenticateResult> {
    const res = await this.__post<{
      accessToken?: string;
      clientToken?: string;
      selectedProfile?: YggdrasilProfile;
      availableProfiles?: YggdrasilProfile[];
      error?: string;
      errorMessage?: string;
    }>(ENDPOINTS.authenticate, {
      agent: { name: "Minecraft", version: 1 },
      username,
      password,
      requestUser: true,
    });

    if (res.status === 200 && res.body.accessToken && res.body.clientToken) {
      const profiles = res.body.selectedProfile
        ? [res.body.selectedProfile]
        : (res.body.availableProfiles ?? []);
      return {
        accessToken: res.body.accessToken,
        clientToken: res.body.clientToken,
        profiles,
      };
    }

    this.logger.warn({ status: res.status, error: res.body?.error }, "yggdrasil authenticate failed");
    throw this.__toAuthError(res, "Logging in to the auth server failed");
  }

  /**
   * Refresh an existing accessToken/clientToken pair, returning the renewed pair
   * bound to the same profile (falls back to `fallbackProfileId` when the server
   * omits the selectedProfile).
   */
  async refresh(
    accessToken: string,
    clientToken: string,
    fallbackProfileId: string,
  ): Promise<RefreshedSession> {
    const res = await this.__post<{
      accessToken?: string;
      clientToken?: string;
      selectedProfile?: YggdrasilProfile;
      error?: string;
      errorMessage?: string;
    }>(ENDPOINTS.refresh, { accessToken, clientToken, requestUser: true });

    if (res.status === 200 && res.body.accessToken) {
      return {
        accessToken: res.body.accessToken,
        clientToken: res.body.clientToken ?? clientToken,
        profileId: res.body.selectedProfile?.id ?? fallbackProfileId,
      };
    }

    this.logger.warn({ status: res.status, error: res.body?.error }, "yggdrasil refresh failed");
    throw this.__toAuthError(res, "Refreshing the access token failed");
  }

  /** true when the accessToken/clientToken pair is still accepted by the server. */
  async validate(accessToken: string, clientToken: string): Promise<boolean> {
    try {
      const res = await this.http.postJson<unknown>(this.baseUrl + ENDPOINTS.validate, {
        accessToken,
        clientToken,
      });
      return res.status === 204 || res.status === 200;
    } catch {
      return false;
    }
  }

  // ---------------------------------------------------------------- helpers

  private __post<T>(endpoint: string, body: Record<string, unknown>): Promise<HttpResult<T>> {
    return this.http.postJson<T>(this.baseUrl + endpoint, body, {
      accept: "application/json",
    });
  }

  private __toAuthError(
    res: HttpResult<{ error?: string; errorMessage?: string }>,
    fallback: string,
  ): AuthError {
    const detail =
      res.body?.errorMessage ??
      res.body?.error ??
      (res.status === 401 || res.status === 403
        ? "Incorrect username or password"
        : undefined);
    if (detail) return new AuthError(detail);
    return new AuthError(`${fallback} (HTTP ${res.status})`);
  }
}