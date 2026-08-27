import Box from "@mui/material/Box";
import Button from "@mui/material/Button";
import Switch from "@mui/material/Switch";
import { useEffect, useRef, useState } from "react";
import { AppIcon } from "../design-system/AppIcon";
import type { LogLine } from "../stores/logStore";
import { logStore } from "../stores/logStore";
import { MONO_STACK } from "../theme/tokens";

function levelColor(level: string): string {
  const l = level.toUpperCase();
  if (l.includes("ERROR") || l.includes("FATAL")) return "error.main";
  if (l.includes("WARN")) return "warning.main";
  return "text.secondary";
}

export function LogViewer({ instanceId }: { instanceId: string }) {
  const lines = logStore((s) => s.lines[instanceId]) as LogLine[] | undefined;
  const scrollRef = useRef<HTMLDivElement>(null);
  const [autoScroll, setAutoScroll] = useState(true);

  useEffect(() => {
    if (autoScroll && scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [lines, autoScroll]);

  const onScroll = (): void => {
    const el = scrollRef.current;
    if (!el) return;
    const nearBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 48;
    setAutoScroll(nearBottom);
  };

  const copyAll = async (): Promise<void> => {
    const text = (lines ?? []).map((l) => l.message).join("\n");
    await window.launcher?.writeText(text);
  };

  return (
    <Box>
      <Box sx={{ display: "flex", alignItems: "center", gap: 1, mb: 1 }}>
        <Button size="small" startIcon={<AppIcon name="content_copy" size={16} />} onClick={() => void copyAll()}>
          复制全部
        </Button>
        <Button
          size="small"
          startIcon={<AppIcon name="delete_sweep" size={16} />}
          onClick={() => logStore.getState().clear(instanceId)}
        >
          清空
        </Button>
        <Box sx={{ ml: "auto", display: "flex", alignItems: "center", gap: 0.5 }}>
          <Box component="span" sx={{ typography: "caption", color: "text.secondary" }}>
            自动滚动
          </Box>
          <Switch
            size="small"
            checked={autoScroll}
            onChange={(e) => setAutoScroll(e.target.checked)}
            slotProps={{ input: { "aria-label": "自动滚动到最新日志" } }}
          />
        </Box>
      </Box>

      <Box
        ref={scrollRef}
        onScroll={onScroll}
        role="log"
        aria-label="游戏日志"
        tabIndex={0}
        sx={{
          height: 420,
          overflowY: "auto",
          bgcolor: "surfaceContainerLowest",
          border: 1,
          borderColor: "divider",
          borderRadius: 2,
          p: 1.5,
          fontFamily: MONO_STACK,
          fontSize: 12.5,
          lineHeight: 1.55,
        }}
      >
        {(lines ?? []).length === 0 ? (
          <Box sx={{ color: "text.disabled", py: 6, textAlign: "center" }}>
            暂无日志。启动游戏后，实时输出将显示在这里。
          </Box>
        ) : (
          (lines ?? []).map((l, i) => (
            <Box key={i} sx={{ whiteSpace: "pre-wrap", wordBreak: "break-all", color: levelColor(l.level) }}>
              {l.message}
            </Box>
          ))
        )}
      </Box>

      <Box sx={{ mt: 0.75, typography: "caption", color: "text.secondary" }}>
        此视图记录本次打开期间收到的实时输出；完整历史日志位于游戏目录下的 launcher-output.log。
      </Box>
    </Box>
  );
}
