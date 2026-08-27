/**
 * One-off repair script: runs the Forge binary-patcher against an already-installed
 * but currently-broken Forge instance to produce the missing patched client jar
 * (the one carrying the `.forge_patched_minecraft` marker).
 *
 * Usage:
 *   npx tsx scripts/patch-forge-client.ts [versionId]
 *
 * If no versionId is given, the script will scan all installed Forge/NeoForge
 * versions and patch any that are missing the client jar.
 */
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { execFile } from "node:child_process";
import { loadConfig } from "../src/config/env.js";
import yauzl from "yauzl";

const FORGE_PATCH_MARKER = ".forge_patched_minecraft";

/** Promise wrapper around yauzl.open(). */
function openZip(zipPath: string): Promise<yauzl.ZipFile> {
  return new Promise((resolve, reject) => {
    yauzl.open(zipPath, { lazyEntries: true, autoClose: false }, (err, zip) => {
      if (err) reject(err);
      else resolve(zip);
    });
  });
}

/** Reads a named text/binary entry from a zip (for the tool jar MANIFEST). */
async function readZipEntry(zipPath: string, name: string): Promise<Buffer | null> {
  const zip = await openZip(zipPath);
  try {
    return await new Promise<Buffer | null>((resolve) => {
      let found: Buffer | null = null;
      zip.on("error", () => resolve(null));
      zip.on("entry", (entry) => {
        if (entry.fileName !== name) {
          zip.readEntry();
          return;
        }
        const chunks: Buffer[] = [];
        zip.openReadStream(entry, (err, stream) => {
          if (err) {
            resolve(null);
            return;
          }
          stream.on("data", (c: Buffer) => chunks.push(c));
          stream.on("end", () => {
            found = Buffer.concat(chunks);
            resolve(found);
          });
          stream.on("error", () => resolve(null));
        });
      });
      zip.on("end", () => resolve(found));
      zip.readEntry();
    });
  } finally {
    try { zip.close(); } catch { /* ignore */ }
  }
}

function parseMavenName(name: string): {
  groupId: string;
  artifactId: string;
  version: string;
} | null {
  const m = /^([a-z0-9_.-]+):([a-z0-9_.-]+):([a-z0-9_.-]+)(?::([a-z0-9_.-]+))?$/i.exec(name);
  if (!m) return null;
  return {
    groupId: m[1]!,
    artifactId: m[2]!,
    version: m[3]!,
    ...(m[4] ? { classifier: m[4] } : {}),
  };
}

function mavenArtifactPath(c: {
  groupId: string;
  artifactId: string;
  version: string;
  classifier?: string;
}): string {
  const fname = c.classifier
    ? `${c.artifactId}-${c.version}-${c.classifier}.jar`
    : `${c.artifactId}-${c.version}.jar`;
  return `${c.groupId.replaceAll(".", path.sep)}${path.sep}${c.artifactId}${path.sep}${c.version}${path.sep}${fname}`;
}

function sha1File(file: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const hash = crypto.createHash("sha1");
    const stream = fs.createReadStream(file);
    stream.on("error", reject);
    stream.on("data", (d) => hash.update(d));
    stream.on("end", () => resolve(hash.digest("hex")));
  });
}

function manifestMainClass(manifest: Buffer): string | null {
  const m = /^Main-Class:\s*(.+)$/m.exec(manifest.toString("utf8"));
  return m ? m[1]!.trim() : null;
}

async function zipContainsEntry(zipPath: string, entryName: string): Promise<boolean> {
  try {
    return (await readZipEntry(zipPath, entryName)) !== null;
  } catch {
    return false;
  }
}

function pickJava(): string {
  // Prefer JAVA_HOME, then common install locations, then java on PATH.
  const candidates = [
    process.env.JAVA_HOME ? path.join(process.env.JAVA_HOME, "bin", "java.exe") : "",
    "C:\\Program Files\\Java\\jdk-21\\bin\\java.exe",
    "C:\\Program Files\\Java\\jdk-17\\bin\\java.exe",
    "C:\\Program Files\\Eclipse Adoptium\\jdk-21*\\bin\\java.exe",
    "C:\\Program Files\\Microsoft\\jdk-21*\\bin\\java.exe",
  ].filter(Boolean) as string[];
  for (const c of candidates) {
    if (fs.existsSync(c)) return c;
  }
  return "java";
}

function execJava(javaPath: string, args: string[]): Promise<void> {
  return new Promise<void>((resolve, reject) => {
    execFile(
      javaPath,
      args,
      { timeout: 20 * 60_000, windowsHide: true, maxBuffer: 16 * 1024 * 1024 },
      (err) => {
        if (err) reject(err);
        else resolve();
      },
    );
  });
}

interface PatchContext {
  versionId: string;
  minecraftVersion: string;
  installProfile: Record<string, unknown>;
  patchedJar: string;
  expectedSha: string | null;
}

function discoverTargets(config: ReturnType<typeof loadConfig>, requested?: string): PatchContext[] {
  const ctxs: PatchContext[] = [];
  const versionsDir = config.versionsDir;
  const entries = fs.readdirSync(versionsDir, { withFileTypes: true });
  for (const e of entries) {
    if (!e.isDirectory()) continue;
    const versionId = e.name;
    if (requested && requested !== versionId) continue;
    const versionDir = path.join(versionsDir, versionId);
    const ipPath = path.join(versionDir, "install_profile.json");
    if (!fs.existsSync(ipPath)) continue;
    // Must be Forge-family (has install_profile)
    let installProfile: Record<string, unknown>;
    try {
      installProfile = JSON.parse(fs.readFileSync(ipPath, "utf8"));
    } catch {
      continue;
    }
    const data = installProfile.data as Record<string, unknown> | undefined;
    const patchedRaw = data?.["PATCHED"] as { client?: string } | undefined;
    const shaRaw = data?.["PATCHED_SHA"] as { client?: string } | undefined;
    if (!patchedRaw?.client) continue;
    const clientCoordRaw = patchedRaw.client.replace(/^\[/, "").replace(/\]$/, "");
    const coords = parseMavenName(clientCoordRaw);
    if (!coords) continue;
    const patchedJar = path.join(config.librariesDir, mavenArtifactPath(coords));

    // Figure out the Minecraft version
    let minecraftVersion = versionId;
    const vjPath = path.join(versionDir, `${versionId}.json`);
    try {
      const vj = JSON.parse(fs.readFileSync(vjPath, "utf8"));
      if (typeof vj.inheritsFrom === "string") minecraftVersion = vj.inheritsFrom;
    } catch {
      const m = /(\d+\.\d+(?:\.\d+)?)/.exec(versionId);
      if (m) minecraftVersion = m[1]!;
    }

    const expectedSha = typeof shaRaw?.client === "string"
      ? shaRaw.client.replace(/^'|'$/g, "")
      : null;

    ctxs.push({ versionId, minecraftVersion, installProfile, patchedJar, expectedSha });
  }
  return ctxs;
}

async function patchOne(
  config: ReturnType<typeof loadConfig>,
  ctx: PatchContext,
): Promise<void> {
  const { versionId, minecraftVersion, installProfile, patchedJar, expectedSha } = ctx;

  // Skip if already present and matches sha.
  if (fs.existsSync(patchedJar)) {
    if (expectedSha) {
      try {
        const actual = await sha1File(patchedJar);
        if (actual === expectedSha) {
          console.log(`[skip] ${versionId}: already patched (sha1 OK)`);
          return;
        }
      } catch {
        /* fall through to repatch */
      }
    } else {
      if (await zipContainsEntry(patchedJar, FORGE_PATCH_MARKER)) {
        console.log(`[skip] ${versionId}: already patched (marker present)`);
        return;
      }
    }
  }

  // Find client.lzma
  const versionDir = path.join(config.versionsDir, versionId);
  const clientLzmaPath = path.join(versionDir, "client.lzma");
  if (!fs.existsSync(clientLzmaPath)) {
    console.log(`[skip] ${versionId}: no client.lzma in version dir`);
    return;
  }

  // Find the client processor
  const processors = (installProfile.processors as Array<Record<string, unknown>> | undefined) ?? [];
  const clientProcessor = processors.find((p) => {
    const sides = p.sides as string[] | undefined;
    return Array.isArray(sides) && sides.includes("client");
  });
  if (!clientProcessor) {
    console.log(`[skip] ${versionId}: no client-side processor in install_profile`);
    return;
  }

  // Resolve processor tool deps
  const jarName = clientProcessor.jar as string;
  const classpathNames = (clientProcessor.classpath as string[] | undefined) ?? [];
  const resolveJar = (name: string): string => {
    const coords = parseMavenName(name);
    if (!coords) return name;
    return path.join(config.librariesDir, mavenArtifactPath(coords));
  };
  const deps: string[] = [];
  const missed: string[] = [];
  for (const n of jarName ? [jarName, ...classpathNames] : classpathNames) {
    const p = resolveJar(n);
    if (fs.existsSync(p)) deps.push(p);
    else missed.push(n);
  }
  if (missed.length > 0) {
    console.log(`[warn] ${versionId}: missing deps: ${missed.join(", ")}`);
    // Still attempt if the main tool jar is present.
  }
  if (!deps[0]) {
    console.log(`[skip] ${versionId}: no processor jar available`);
    return;
  }
  const toolJar = deps[0];
  const classpath = deps.join(path.delimiter);

  // Main class
  let mainClass = "net.minecraftforge.binarypatcher.ConsoleTool";
  try {
    const manifest = await readZipEntry(toolJar, "META-INF/MANIFEST.MF");
    if (manifest) {
      const mc = manifestMainClass(manifest);
      if (mc) mainClass = mc;
    }
  } catch {
    /* keep default */
  }

  // Find clean jar
  const cleanJar = path.join(config.versionsDir, minecraftVersion, `${minecraftVersion}.jar`);
  if (!fs.existsSync(cleanJar)) {
    console.log(`[error] ${versionId}: clean jar ${cleanJar} missing; download vanilla first`);
    return;
  }

  // Modern (shim) Forge installers point the client binary-patcher at the
  // vanilla *jar* directly (`--clean {MINECRAFT_JAR}`), not an unpacked dir.
  const javaPath = pickJava();
  const args = [
    "-cp",
    classpath,
    mainClass,
    "--clean",
    cleanJar,
    "--output",
    patchedJar,
    "--apply",
    clientLzmaPath,
    "--data",
    "--unpatched",
    "--store",
    "--marker",
    FORGE_PATCH_MARKER,
  ];
  fs.mkdirSync(path.dirname(patchedJar), { recursive: true });
  console.log(`[patch] ${versionId}: running binary-patcher...`);
  console.log(`        java=${javaPath}`);
  console.log(`        output=${patchedJar}`);
  await execJava(javaPath, args);
  console.log(`[patch] ${versionId}: binary-patcher finished`);

  if (!fs.existsSync(patchedJar)) {
    console.log(`[error] ${versionId}: patch produced no output file`);
    return;
  }

  // Verify
  const markerOk = await zipContainsEntry(patchedJar, FORGE_PATCH_MARKER);
  if (!markerOk) {
    console.log(`[error] ${versionId}: patched jar missing ${FORGE_PATCH_MARKER} marker`);
    return;
  }
  if (expectedSha) {
    const actual = await sha1File(patchedJar);
    if (actual !== expectedSha) {
      console.log(
        `[warn] ${versionId}: sha1 mismatch expected=${expectedSha} actual=${actual} (marker OK though)`,
      );
    } else {
      console.log(`[ok] ${versionId}: sha1 match`);
    }
  }
  console.log(`[ok] ${versionId}: patched jar ready (${Math.round(fs.statSync(patchedJar).size / 1024 / 1024)}MB, marker OK)`);
}

async function main(): Promise<void> {
  const config = loadConfig();
  const requested = process.argv[2];
  const targets = discoverTargets(config, requested);
  if (targets.length === 0) {
    console.log("No Forge/NeoForge versions to patch.");
    return;
  }
  console.log(`Found ${targets.length} target(s): ${targets.map((t) => t.versionId).join(", ")}`);
  for (const t of targets) {
    try {
      await patchOne(config, t);
    } catch (err) {
      console.log(`[error] ${t.versionId}: ${err instanceof Error ? err.message : String(err)}`);
    }
  }
}

main().catch((err) => {
  console.error("Fatal:", err);
  process.exit(1);
});
