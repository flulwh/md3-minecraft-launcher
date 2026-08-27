import { Logger } from "../../config/logger.js";

export interface VariableMap {
  [snakeCaseVar: string]: string | undefined;
}

/**
 * Replaces `${var}` placeholders in Minecraft argument templates.
 * Unknown variables become empty strings (official launcher behaviour) and
 * produce a warning so misconfiguration is visible in logs.
 */
export function substituteVariables(template: string, vars: VariableMap, logger?: Logger): string {
  return template.replace(/\$\{([^}]+)\}/g, (_match, rawName: string) => {
    const name = rawName.trim();
    const value = vars[name];
    if (value === undefined || value === null) {
      logger?.debug({ variable: name }, "unresolved template variable replaced with empty string");
      return "";
    }
    return value;
  });
}

/** Splits a legacy `minecraftArguments` string honouring double quotes. */
export function tokenizeArgumentString(input: string): string[] {
  const tokens: string[] = [];
  let current = "";
  let inQuotes = false;
  let sawContent = false;

  for (const ch of input) {
    if (ch === '"') {
      inQuotes = !inQuotes;
      sawContent = true;
      continue;
    }
    if (!inQuotes && ch === " ") {
      if (current.length > 0 || sawContent) tokens.push(current);
      current = "";
      sawContent = false;
      continue;
    }
    current += ch;
  }
  if (current.length > 0 || sawContent) tokens.push(current);
  return tokens;
}
