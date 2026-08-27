import fs from "node:fs";
import path from "node:path";
import { z } from "zod";
import { AppConfig } from "../config/env.js";
import { Logger } from "../config/logger.js";
import { EventBus, Events } from "../websocket/events.js";
import { InstanceService, InstanceDto, instanceCreateSchema } from "../services/instance-service.js";
import { assertInside } from "../utils/paths.js";

type LoaderType = z.infer<typeof instanceCreateSchema>["loader"];

export interface DuplicateOptions {
  name?: string;
}

/**
 * Duplicates an instance on disk (deep copy of its isolated directory) and
 * registers a fresh DB row pointing at the copy. Existing libraries/natives are
 * reused via copy rather than re-downloaded, keeping the new instance instantly
 * launchable once files are in place.
 */
export class DuplicateManager {
  constructor(
    private readonly config: AppConfig,
    private readonly instances: InstanceService,
    private readonly bus: EventBus,
    private readonly logger: Logger,
  ) {}

  async duplicate(id: string, opts: DuplicateOptions = {}): Promise<InstanceDto> {
    const src = await this.instances.get(id);
    await this.instances.assertIdle(id);

    const created = await this.instances.create({
      name: (opts.name?.trim() || `${src.name} - 副本`),
      minecraftVersion: src.minecraftVersion,
      loader: src.loader as LoaderType,
      ...(src.loaderVersion ? { loaderVersion: src.loaderVersion } : {}),
      ...(src.javaPath ? { javaPath: src.javaPath } : {}),
      ...(src.memoryMinMb !== null ? { memoryMinMb: src.memoryMinMb } : {}),
      memoryMaxMb: src.memoryMaxMb,
      ...(src.jvmArgs.length > 0 ? { jvmArgs: src.jvmArgs } : {}),
      ...(Object.keys(src.gameArgs).length > 0 ? { gameArgs: src.gameArgs } : {}),
      ...(src.width !== null ? { width: src.width } : {}),
      ...(src.height !== null ? { height: src.height } : {}),
      fullscreen: src.fullscreen,
      ...(src.serverIp ? { serverIp: src.serverIp } : {}),
      ...(src.tags.length > 0 ? { tags: src.tags } : {}),
    });

    const srcDir = path.join(this.config.instancesDir, id);
    const dstDir = path.join(this.config.instancesDir, created.id);
    assertInside(this.config.instancesDir, srcDir);
    assertInside(this.config.instancesDir, dstDir);

    this.logger.info({ from: id, to: created.id }, "duplicating instance");
    fs.cpSync(srcDir, dstDir, { recursive: true });

    await this.instances.setStatus(created.id, "READY", { installedAt: new Date() });
    this.bus.publish(Events.INSTANCE_UPDATED, { id: created.id, action: "duplicated" }, created.id);
    return this.instances.get(created.id);
  }
}