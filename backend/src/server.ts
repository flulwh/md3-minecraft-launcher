import { loadConfig, ensureDirectories } from "./config/env.js";
import { AppContainer } from "./container.js";
import { buildApp } from "./app.js";

async function main(): Promise<void> {
  const config = loadConfig();
  ensureDirectories(config);

  const container = new AppContainer(config);
  await container.db.connect();

  // Rebuild the download queue from tasks interrupted by a prior shutdown/crash.
  try {
    const resumed = await container.resumeDownloads();
    if (resumed > 0) container.logger.info({ resumed }, "download queue restored");
  } catch (err) {
    container.logger.error({ err }, "failed to resume interrupted downloads");
  }

  const app = await buildApp(container);

  const shutdown = async (signal: string): Promise<void> => {
    container.logger.info({ signal }, "shutting down");
    try {
      await app.close();
    } finally {
      process.exit(0);
    }
  };
  process.on("SIGINT", () => void shutdown("SIGINT"));
  process.on("SIGTERM", () => void shutdown("SIGTERM"));

  try {
    await app.listen({
      port: config.env.PORT,
      host: config.env.HOST,
    });
    container.logger.info(
      { host: config.env.HOST, port: config.env.PORT },
      `Launcher API ready — http://${config.env.HOST}:${config.env.PORT}/api/v1/health`,
    );
  } catch (err) {
    container.logger.error({ err }, "failed to start server");
    process.exit(1);
  }
}

void main();
