import { z } from "zod";

const ruleOsSchema = z.object({
  name: z.string().optional(),
  arch: z.string().optional(),
  version: z.string().optional(),
});

export const ruleSchema = z.lazy(() =>
  z.object({
    action: z.enum(["allow", "disallow"]),
    os: ruleOsSchema.optional(),
    features: z.record(z.boolean()).optional(),
  }),
);

/**
 * Artifact download metadata. `url` may legally be an empty string: some
 * loaders (notably Forge) ship client artifacts that are produced locally by
 * the installer and carry no remote download URL.
 */
const artifactSchema = z.object({
  path: z.string().optional(),
  sha1: z.string(),
  size: z.number().int().nonnegative(),
  url: z.union([z.string().url(), z.literal("")]),
});

const librarySchema = z.object({
  name: z.string().optional(),
  downloads: z
    .object({
      artifact: artifactSchema.optional(),
      classifiers: z.record(artifactSchema).optional(),
    })
    .optional(),
  url: z.string().optional(),
  rules: z.array(ruleSchema).optional(),
  natives: z.record(z.string()).optional(),
  extract: z.object({ exclude: z.array(z.string()).optional() }).optional(),
  checksums: z.array(z.string()).optional(),
});

const argumentObjectSchema = z.lazy(() =>
  z.object({
    rules: z.array(ruleSchema).optional(),
    value: z.union([z.string(), z.array(z.string())]).optional(),
    values: z.union([z.string(), z.array(z.string())]).optional(),
    ref: z.string().optional(),
  }),
);

export const versionJsonSchema = z.object({
  id: z.string().min(1),
  type: z.string().optional(),
  time: z.string().optional(),
  releaseTime: z.string().optional(),
  inheritsFrom: z.string().optional(),
  jar: z.string().optional(),
  mainClass: z.string().min(1).optional(),
  arguments: z
    .object({
      game: z.array(z.union([z.string(), argumentObjectSchema])).optional(),
      jvm: z.array(z.union([z.string(), argumentObjectSchema])).optional(),
    })
    .optional(),
  minecraftArguments: z.string().optional(),
  libraries: z.array(librarySchema).optional(),
  downloads: z.record(artifactSchema).optional(),
  assetIndex: z
    .object({
      id: z.string(),
      sha1: z.string(),
      size: z.number().int().nonnegative(),
      totalSize: z.number().int().nonnegative(),
      url: z.string().url(),
      minorVersion: z.string().optional(),
    })
    .optional(),
  assets: z.string().optional(),
  javaVersion: z
    .object({ component: z.string(), majorVersion: z.number().int() })
    .optional(),
  logging: z
    .object({
      client: z
        .object({
          argument: z.string(),
          file: z.object({
            id: z.string(),
            sha1: z.string(),
            size: z.number().int().nonnegative(),
            url: z.string().url(),
          }),
          type: z.string(),
        })
        .optional(),
    })
    .optional(),
  complianceLevel: z.number().optional(),
  minimumLauncherVersion: z.number().optional(),
});
