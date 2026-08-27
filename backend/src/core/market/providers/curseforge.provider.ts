import { Logger } from "../../../config/logger.js";
import { AppError } from "../../../errors/index.js";
import type { MarketContentType } from "../models/market-item.js";
import type { MarketVersion } from "../models/market-version.js";
import type { MarketHomeOptions, MarketProvider, MarketSearchParams, MarketHome } from "./provider.interface.js";

/**
 * Placeholder for the CurseForge provider (requires an API key). Registered in
 * the provider map so a single flag flips it on later — no core changes needed.
 */
export class CurseForgeProvider implements MarketProvider {
  readonly id = "curseforge";

  constructor(private readonly logger: Logger) {}

  private unavailable(): never {
    this.logger.warn("curseforge provider invoked but not configured");
    throw new AppError(
      "PROVIDER_NOT_CONFIGURED",
      "CurseForge requires an API key; it is not enabled in this build.",
      501,
    );
  }

  search(_params: MarketSearchParams): Promise<never> {
    return Promise.reject(this.unavailable());
  }

  getProject(_id: string, _type?: MarketContentType): Promise<never> {
    return Promise.reject(this.unavailable());
  }

  getVersions(_id: string): Promise<never> {
    return Promise.reject(this.unavailable());
  }

  getHome(_options?: MarketHomeOptions): Promise<never> {
    return Promise.reject(this.unavailable());
  }
}