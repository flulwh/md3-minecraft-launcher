import path from "node:path";

export type ErrorCode =
  | "INTERNAL_ERROR"
  | "VALIDATION_ERROR"
  | "NOT_FOUND"
  | "CONFLICT"
  | "UNAUTHORIZED"
  | "FORBIDDEN"
  | "INSTANCE_NOT_FOUND"
  | "ACCOUNT_NOT_FOUND"
  | "VERSION_NOT_FOUND"
  | "JAVA_RUNTIME_NOT_FOUND"
  | "DOWNLOAD_FAILED"
  | "CHECKSUM_MISMATCH"
  | "LAUNCH_FAILED"
  | "PREFLIGHT_FAILED"
  | "AUTH_FAILED"
  | "AUTH_PENDING"
  | "LOADER_INSTALL_FAILED"
  | "LOADER_NOT_INSTALLED"
  | "FORGE_PATCH_FAILED"
  | "INSTALL_IN_PROGRESS"
  | "INSTALL_CANCELLED"
  | "INSTALLATION_CORRUPTED"
  | "PATH_ESCAPES_SANDBOX"
  | "OFFLINE_UNAVAILABLE"
  | "PROVIDER_NOT_CONFIGURED";

export class AppError extends Error {
  readonly code: ErrorCode;
  readonly httpStatus: number;
  readonly details: Record<string, unknown> | undefined;

  constructor(code: ErrorCode, message: string, httpStatus = 500, details?: Record<string, unknown>) {
    super(message);
    this.name = "AppError";
    this.code = code;
    this.httpStatus = httpStatus;
    this.details = details;
  }

  toJSON(): { code: ErrorCode; message: string; details?: Record<string, unknown> } {
    return this.details !== undefined
      ? { code: this.code, message: this.message, details: this.details }
      : { code: this.code, message: this.message };
  }
}

export class NotFoundError extends AppError {
  constructor(resource: string, id?: string) {
    super("NOT_FOUND", `${resource}${id ? ` '${id}'` : ""} not found`, 404);
  }
}

export class InstanceNotFoundError extends AppError {
  constructor(id: string) {
    super("INSTANCE_NOT_FOUND", `Instance '${id}' not found`, 404);
  }
}

export class AccountNotFoundError extends AppError {
  constructor(id: string) {
    super("ACCOUNT_NOT_FOUND", `Account '${id}' not found`, 404);
  }
}

export class VersionNotFoundError extends AppError {
  constructor(id: string) {
    super("VERSION_NOT_FOUND", `Minecraft version '${id}' not found`, 404);
  }
}

export class JavaRuntimeNotFoundError extends AppError {
  constructor(message: string) {
    super("JAVA_RUNTIME_NOT_FOUND", message, 409);
  }
}

export class ValidationError extends AppError {
  constructor(message: string, details?: Record<string, unknown>) {
    super("VALIDATION_ERROR", message, 400, details);
  }
}

export class AuthError extends AppError {
  constructor(message: string, code: ErrorCode = "AUTH_FAILED") {
    super(code, message, 401);
  }
}

export class DownloadError extends AppError {
  constructor(message: string, details?: Record<string, unknown>) {
    super("DOWNLOAD_FAILED", message, 502, details);
  }
}

export class ChecksumMismatchError extends AppError {
  constructor(target: string, expected?: string, actual?: string) {
    super(
      "CHECKSUM_MISMATCH",
      `Checksum mismatch for ${target}`,
      523,
      expected ? { expected, actual } : undefined,
    );
  }
}

export class LaunchError extends AppError {
  constructor(message: string, details?: Record<string, unknown>) {
    super("LAUNCH_FAILED", message, 409, details);
  }
}

export class PreflightError extends AppError {
  constructor(failures: string[]) {
    super("PREFLIGHT_FAILED", "Preflight checks failed", 409, { failures });
  }
}

export class SandboxViolationError extends AppError {
  constructor(target: string) {
    super("PATH_ESCAPES_SANDBOX", `Refusing to access path outside sandbox: ${target}`, 400);
  }
}

export class IntegrityVerificationError extends AppError {
  constructor(issues: Array<{ path: string; reason: string }>) {
    const sample = issues
      .slice(0, 3)
      .map((i) => ` ${path.basename(i.path)} (${i.reason})`)
      .join(",");
    super(
      "INSTALLATION_CORRUPTED",
      `安装完整性校验未通过：${issues.length} 个文件缺失或为空${sample ? `：${sample}` : ""}`,
      500,
      { issues },
    );
  }
}
