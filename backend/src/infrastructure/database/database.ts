import { PrismaClient } from "@prisma/client";
import { Logger } from "../../config/logger.js";

/**
 * Thin lifecycle wrapper around PrismaClient so services never import it directly.
 * The datasource URL is injected explicitly (absolute) instead of relying on
 * ambient env resolution, which breaks for relative SQLite paths at runtime.
 */
export class Database {
  private _client: PrismaClient | null = null;

  constructor(
    private readonly logger: Logger,
    private readonly datasourceUrl?: string,
  ) {}

  get client(): PrismaClient {
    if (!this._client) {
      this._client =
        this.datasourceUrl !== undefined
          ? new PrismaClient({ datasources: { db: { url: this.datasourceUrl } } })
          : new PrismaClient();
    }
    return this._client;
  }

  async connect(): Promise<void> {
    await this.client.$connect();
    this.logger.info("database connected");
  }

  async disconnect(): Promise<void> {
    if (!this._client) return;
    await this._client.$disconnect();
  }
}
