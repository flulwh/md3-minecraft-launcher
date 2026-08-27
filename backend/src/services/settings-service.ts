import { z } from "zod";
import { Database } from "../infrastructure/database/database.js";

export const settingsSchema = z.object({
  downloadConcurrency: z.number().int().min(1).max(64).optional(),
  defaultMemoryMaxMb: z.number().int().min(256).max(65536).optional(),
  preferredJavaPath: z.string().max(512).nullable().optional(),
  extraJvmArgs: z.array(z.string()).max(128).optional(),
});

export type SettingsPayload = z.infer<typeof settingsSchema>;

/**
 * Key/value application settings persisted in the Setting table.
 */
export class SettingsService {
  constructor(private readonly db: Database) {}

  async getAll(): Promise<SettingsPayload> {
    const rows = await this.db.client.setting.findMany();
    const out: SettingsPayload = {};
    for (const row of rows) {
      try {
        const value: unknown = JSON.parse(row.value);
        if (row.key === "downloadConcurrency" && typeof value === "number") {
          out.downloadConcurrency = value;
        } else if (row.key === "defaultMemoryMaxMb" && typeof value === "number") {
          out.defaultMemoryMaxMb = value;
        } else if (row.key === "preferredJavaPath") {
          if (value === null || typeof value === "string") out.preferredJavaPath = value;
        } else if (row.key === "extraJvmArgs" && Array.isArray(value)) {
          out.extraJvmArgs = value.filter((v): v is string => typeof v === "string");
        }
      } catch {
        /* skip malformed */
      }
    }
    return out;
  }

  async update(patch: SettingsPayload): Promise<SettingsPayload> {
    const entries: Array<[string, unknown]> = [];
    if (patch.downloadConcurrency !== undefined) entries.push(["downloadConcurrency", patch.downloadConcurrency]);
    if (patch.defaultMemoryMaxMb !== undefined) entries.push(["defaultMemoryMaxMb", patch.defaultMemoryMaxMb]);
    if (patch.preferredJavaPath !== undefined) entries.push(["preferredJavaPath", patch.preferredJavaPath]);
    if (patch.extraJvmArgs !== undefined) entries.push(["extraJvmArgs", patch.extraJvmArgs]);

    for (const [key, value] of entries) {
      await this.db.client.setting.upsert({
        where: { key },
        create: { key, value: JSON.stringify(value) },
        update: { value: JSON.stringify(value) },
      });
    }
    return this.getAll();
  }
}
