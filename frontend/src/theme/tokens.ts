export const APP_NAME = "Minecraft Launcher";
export const APP_VERSION = "0.1.0";

export const SPACING = { xs: 4, sm: 8, md: 16, lg: 24, xl: 32 } as const;

export const RADIUS = { sm: 8, md: 12, lg: 16, xl: 24, full: 1000 } as const;

export const MOTION = {
  short: 150,
  std: 200,
  long: 250,
  easing: "cubic-bezier(0.2, 0, 0, 1)",
  decel: "cubic-bezier(0.05, 0.7, 0.1, 1)",
} as const;

export const FONT_STACK =
  'roboto, "Segoe UI", "Microsoft YaHei UI", "Microsoft YaHei", "PingFang SC", system-ui, -apple-system, sans-serif';

export const MONO_STACK = '"Cascadia Code", "JetBrains Mono", Consolas, "Courier New", monospace';

export const LOG_BUFFER_LIMIT = 2000;

export const SIDEBAR_WIDTH_EXPANDED = 232;
export const SIDEBAR_WIDTH_RAIL = 72;
export const TITLEBAR_HEIGHT = 40;
export const STATUSBAR_HEIGHT = 28;

export const MEMORY_PRESETS_MB = [1024, 2048, 4096, 8192] as const;
