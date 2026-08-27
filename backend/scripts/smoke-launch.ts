/**
 * Smoke test: exercises the full launch chain (account -> instance -> version
 * resolution -> java detection -> library/native resolution -> classpath ->
 * JVM/Game args -> command assembly) in dry-run mode, without spawning a
 * real Minecraft process or touching the network for downloads.
 *
 * Run with: pnpm smoke:launch
 */
import fs from "node:fs";
import { loadConfig, ensureDirectories } from "../src/config/env.js";
import { AppContainer } from "../src/container.js";

const TARGET_VERSION = "1.16.5";

async function main(): Promise<void> {
  const config = loadConfig();
  ensureDirectories(config);
  const c = new AppContainer(config);
  await c.db.connect();

  // ---- Ensure an offline account exists
  const accounts = await c.auth.listAccounts();
  const account =
    accounts.find((a) => a.type === "offline") ?? (await c.auth.createOfflineAccount("Steve"));
  console.log(`[smoke] account: ${account.username} (${account.id})`);

  // ---- Ensure a vanilla 1.16.5 instance exists
  const instances = await c.instances.list();
  const instance =
    instances.find((i) => i.loader === "vanilla" && i.minecraftVersion === TARGET_VERSION) ??
    (await c.instances.create({
      name: `Smoke ${TARGET_VERSION}`,
      minecraftVersion: TARGET_VERSION,
      loader: "vanilla",
      memoryMaxMb: 2048,
    }));
  console.log(`[smoke] instance: ${instance.name} (${instance.id})`);

  // ---- Dry-run launch
  const result = await c.launch.launch({
    instanceId: instance.id,
    accountId: account.id,
    dryRun: true,
  });

  // ---- Assertions
  const failures: string[] = [];
  if (!result.preflight.success) failures.push("preflight reported failure");
  if (!result.command.javaPath || result.command.javaPath.length === 0)
    failures.push("javaPath is empty");
  if (!fs.existsSync(result.command.javaPath) && result.command.javaPath !== "java")
    failures.push(`javaPath does not exist: ${result.command.javaPath}`);
  if (result.command.args.length === 0) failures.push("launch args are empty");

  const classpathArg = result.command.args.find((a) => a.includes(".jar"));
  if (!classpathArg) failures.push("no classpath (.jar) entry in args");

  const mainClass = "net.minecraft.client.main.Main";
  if (!result.command.args.includes(mainClass))
    failures.push(`expected main class ${mainClass} in args`);

  const joined = result.command.args.join(" ");
  if (!joined.includes(account.username))
    failures.push("game args do not contain the player name substitution");

  // ---- Report
  console.log("[smoke] preflight checks:");
  for (const check of result.preflight.checks) {
    console.log(`  [${check.ok ? "x" : " "}] ${check.name}${check.detail ? ` — ${check.detail}` : ""}`);
  }
  console.log("[smoke] javaPath:", result.command.javaPath);
  console.log("[smoke] cwd:", result.command.cwd);
  console.log("[smoke] arg count:", result.command.args.length);
  console.log("[smoke] command preview:");
  console.log("  java", result.command.args.map((a) => (a.includes(" ") ? `"${a}"` : a)).join(" "));

  if (failures.length > 0) {
    console.error("[smoke] FAILED:");
    for (const f of failures) console.error("  - " + f);
    process.exit(1);
  }
  console.log("[smoke] OK — vanilla " + TARGET_VERSION + " launch chain assembled successfully");
}

main().catch((err) => {
  console.error("[smoke] ERROR:", err instanceof Error ? err.stack ?? err.message : err);
  process.exit(1);
});
