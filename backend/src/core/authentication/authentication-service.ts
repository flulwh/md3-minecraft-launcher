import { Account } from "@prisma/client";
import { AppConfig } from "../../config/env.js";
import { Logger } from "../../config/logger.js";
import { Database } from "../../infrastructure/database/database.js";
import { AuthError, AccountNotFoundError } from "../../errors/index.js";
import { TokenCipher } from "./token-cipher.js";
import { YggdrasilAuthService, YggdrasilProfile } from "./yggdrasil-auth-service.js";
import { MinecraftProfileInfo, offlineUuidFor, normalizeUuid } from "./auth-types.js";

export interface PublicAccount {
  id: string;
  type: string;
  username: string;
  profiles: MinecraftProfileInfo[];
  hasStoredCredentials: boolean;
  readonly authServer: string;
}

/**
 * High-level authentication facade:
 *   - LittleSkin / Yggdrasil (authlib-injector) login with encrypted token storage
 *   - explicit offline accounts (clearly typed, never fakes online auth)
 *
 * Access tokens are validated / refreshed against the auth server on launch;
 * stored credentials (accessToken + clientToken) are AES-256-GCM sealed.
 */
export class AuthenticationService {
  /** accountId -> { token, name, uuid } in-memory cache (tokens are long-lived). */
  private readonly tokenCache = new Map<string, { token: string; name: string; uuid: string }>();

  constructor(
    private readonly config: AppConfig,
    private readonly db: Database,
    private readonly yggdrasil: YggdrasilAuthService,
    private readonly cipher: TokenCipher,
    private readonly logger: Logger,
  ) {}

  // ---------------------------------------------------------------- accounts

  async listAccounts(): Promise<PublicAccount[]> {
    const rows = await this.db.client.account.findMany({ include: { profiles: true } });
    return rows.map((row) => this.toPublic(row));
  }

  async getPublicAccount(id: string): Promise<PublicAccount> {
    const row = await this.db.client.account.findUnique({
      where: { id },
      include: { profiles: true },
    });
    if (!row) throw new AccountNotFoundError(id);
    return this.toPublic(row);
  }

  async createOfflineAccount(name: string): Promise<PublicAccount> {
    const sanitized = name.trim();
    if (sanitized.length === 0 || sanitized.length > 16 || !/^[A-Za-z0-9_ ]+$/.test(sanitized)) {
      throw new AuthError("Invalid offline player name");
    }
    const uuid = offlineUuidFor(sanitized);
    const row = await this.db.client.account.upsert({
      where: { username: `offline:${sanitized}` },
      update: {},
      create: {
        type: "offline",
        username: `offline:${sanitized}`,
        profiles: {
          create: [{ id: uuid, name: sanitized }],
        },
      },
      include: { profiles: true },
    });
    this.logger.info({ account: row.id }, "offline account created");
    return this.toPublic(row);
  }

  /**
   * Authenticate with LittleSkin credentials. When the account has multiple game
   * characters and none is requested, an error listing them is thrown.
   */
  async loginYggdrasil(username: string, password: string, profileName?: string): Promise<PublicAccount> {
    const auth = await this.yggdrasil.authenticate(username.trim(), password);

    if (auth.profiles.length === 0) {
      throw new AuthError("此账户名下没有可用的游戏角色，请先在 LittleSkin 创建角色");
    }
    const profile = this.selectProfile(auth.profiles, profileName);

    const existing = await this.db.client.account.findFirst({
      where: { profiles: { some: { id: normalizeUuid(profile.id) } } },
    });

    const row = existing
      ? await this.db.client.account.update({
          where: { id: existing.id },
          data: {
            type: "yggdrasil",
            accessToken: this.cipher.encrypt(auth.accessToken),
            clientToken: this.cipher.encrypt(auth.clientToken),
            accessTokenExpiresAt: null,
            profiles: {
              upsert: {
                where: { accountId_name: { accountId: existing.id, name: profile.name } },
                create: { id: normalizeUuid(profile.id), name: profile.name },
                update: { id: normalizeUuid(profile.id), name: profile.name },
              },
            },
          },
          include: { profiles: true },
        })
      : await this.db.client.account.create({
          data: {
            type: "yggdrasil",
            username: `yggdrasil:${profile.name}`,
            accessToken: this.cipher.encrypt(auth.accessToken),
            clientToken: this.cipher.encrypt(auth.clientToken),
            accessTokenExpiresAt: null,
            profiles: {
              create: [{ id: normalizeUuid(profile.id), name: profile.name }],
            },
          },
          include: { profiles: true },
        });

    this.tokenCache.delete(row.id);
    this.logger.info({ account: row.id }, "Yggdrasil account linked");
    return this.toPublic(row);
  }

  async logout(id: string): Promise<void> {
    const row = await this.db.client.account.findUnique({ where: { id } });
    if (!row) throw new AccountNotFoundError(id);
    this.tokenCache.delete(id);
    await this.db.client.account.delete({ where: { id } });
    this.logger.info({ account: id }, "account logged out");
  }

  // ---------------------------------------------------------------- tokens

  /**
   * Returns a guaranteed-valid access token for the Minecraft launch flow
   * (plus the player name / uuid). For Yggdrasil accounts the stored token is
   * validated against the auth server and refreshed if needed. NEVER fabricates
   * tokens: offline accounts use "0"; on refresh failure the caller receives an
   * AuthError and must re-login.
   */
  async getValidMcToken(accountId: string): Promise<{ token: string; name: string; uuid: string }> {
    const cached = this.tokenCache.get(accountId);
    if (cached) return cached;

    const row = await this.db.client.account.findUnique({
      where: { id: accountId },
      include: { profiles: true },
    });
    if (!row) throw new AccountNotFoundError(accountId);

    if (row.type === "offline") {
      const profile = row.profiles[0];
      if (!profile) throw new AuthError("Offline account has no profile");
      const token = { token: "0", name: profile.name, uuid: profile.id };
      this.tokenCache.set(accountId, token);
      return token;
    }

    if (!row.accessToken || !row.clientToken) {
      throw new AuthError("此账户没有已保存的凭据，请重新登录");
    }
    const profile = this.activeProfileRow(row.profiles);
    if (!profile) throw new AuthError("此账户没有可用的游戏角色");

    const accessToken = this.decryptToken(row.accessToken);
    const clientToken = this.decryptToken(row.clientToken);

    if (!(await this.yggdrasil.validate(accessToken, clientToken))) {
      const refreshed = await this.refreshAndPersist(row, accessToken, clientToken, profile.id);
      const token = { token: refreshed.token, name: profile.name, uuid: profile.id };
      this.tokenCache.set(accountId, token);
      return token;
    }

    const token = { token: accessToken, name: profile.name, uuid: profile.id };
    this.tokenCache.set(accountId, token);
    return token;
  }

  // ---------------------------------------------------------------- internals

  private async refreshAndPersist(
    row: Account & { profiles: Array<{ id: string; name: string }> },
    accessToken: string,
    clientToken: string,
    profileId: string,
  ): Promise<{ token: string }> {
    let refreshed;
    try {
      refreshed = await this.yggdrasil.refresh(accessToken, clientToken, profileId);
    } catch (err) {
      this.logger.warn({ account: row.id, err }, "yggdrasil refresh failed; login required");
      throw new AuthError("登录凭据已失效，请重新登录");
    }

    await this.db.client.account.update({
      where: { id: row.id },
      data: {
        accessToken: this.cipher.encrypt(refreshed.accessToken),
        clientToken: this.cipher.encrypt(refreshed.clientToken),
        accessTokenExpiresAt: null,
      },
    });
    if (refreshed.profileId && row.profiles.length > 1) {
      await this.db.client.account.update({
        where: { id: row.id },
        data: {
          profiles: {
            update: {
              where: { accountId_name: { accountId: row.id, name: row.profiles[0]!.name } },
              data: { id: normalizeUuid(refreshed.profileId), isActive: true },
            },
          },
        },
      });
    }
    return { token: refreshed.accessToken };
  }

  private selectProfile(profiles: YggdrasilProfile[], profileName?: string): YggdrasilProfile {
    if (profiles.length === 1) return profiles[0]!;
    if (profileName) {
      const match = profiles.find((p) => p.name === profileName);
      if (match) return match;
      throw new AuthError(
        `未找到角色「${profileName}」。可用角色：${profiles.map((p) => p.name).join("、")}`,
      );
    }
    throw new AuthError(
      `此账户有多个角色，请选择其中一个：${profiles.map((p) => p.name).join("、")}`,
    );
  }

  private activeProfileRow(
    rowProfiles: Array<{ id: string; name: string; isActive?: boolean | null }>,
  ): { id: string; name: string } | null {
    const profile = rowProfiles.find((p) => p.isActive) ?? rowProfiles[0];
    if (!profile) return null;
    return { id: normalizeUuid(profile.id), name: profile.name };
  }

  private decryptToken(encrypted: string): string {
    try {
      return this.cipher.decrypt(encrypted);
    } catch {
      throw new AuthError("保存的凭据无法解密，请重新登录");
    }
  }

  private toPublic(
    row: Account & { profiles: Array<{ id: string; name: string }> },
  ): PublicAccount {
    const display = row.username.replace(/^(yggdrasil|offline):/, "");
    return {
      id: row.id,
      type: row.type,
      username: display,
      authServer: this.config.env.YGG_BASE_URL,
      hasStoredCredentials: row.accessToken !== null,
      profiles: row.profiles.map((p) => ({ id: p.id, name: p.name })),
    };
  }
}