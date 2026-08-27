import path from "node:path";
import { SandboxViolationError } from "../errors/index.js";

export function resolveInside(base: string, ...segments: string[]): string {
  const resolvedBase = path.resolve(base);
  const target = path.resolve(resolvedBase, ...segments);
  if (target !== resolvedBase && !target.startsWith(resolvedBase + path.sep)) {
    throw new SandboxViolationError(target);
  }
  return target;
}

export function assertInside(base: string, target: string): void {
  const resolvedBase = path.resolve(base);
  const resolvedTarget = path.resolve(target);
  if (resolvedTarget !== resolvedBase && !resolvedTarget.startsWith(resolvedBase + path.sep)) {
    throw new SandboxViolationError(target);
  }
}

export function toPosix(p: string): string {
  return p.split(path.sep).join("/");
}
