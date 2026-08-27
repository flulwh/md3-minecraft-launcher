import { create } from "zustand";
import type { MinecraftLogData } from "../api/types";
import { LOG_BUFFER_LIMIT } from "../theme/tokens";

export interface LogLine {
  level: string;
  message: string;
  at: number;
}

interface LogStore {
  lines: Record<string, LogLine[]>;
  append: (instanceId: string, data: MinecraftLogData) => void;
  clear: (instanceId: string) => void;
  /** Remove the instance's key entirely (e.g. after the instance is deleted). */
  remove: (instanceId: string) => void;
}

const trim = (arr: LogLine[]): LogLine[] =>
  arr.length > LOG_BUFFER_LIMIT ? arr.slice(arr.length - LOG_BUFFER_LIMIT) : arr;

export const logStore = create<LogStore>((set) => ({
  lines: {},
  append: (instanceId, data) =>
    set((state) => ({
      lines: {
        ...state.lines,
        [instanceId]: trim([
          ...(state.lines[instanceId] ?? []),
          { level: data.level, message: data.message, at: Date.now() },
        ]),
      },
    })),
  clear: (instanceId) =>
    set((state) => ({ lines: { ...state.lines, [instanceId]: [] } })),
  remove: (instanceId) =>
    set((state) => {
      if (!(instanceId in state.lines)) return state;
      const { [instanceId]: _removed, ...rest } = state.lines;
      return { lines: rest };
    }),
}));
