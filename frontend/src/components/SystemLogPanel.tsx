import Box from "@mui/material/Box";
import Button from "@mui/material/Button";
import Chip from "@mui/material/Chip";
import CircularProgress from "@mui/material/CircularProgress";
import Stack from "@mui/material/Stack";
import Switch from "@mui/material/Switch";
import Tooltip from "@mui/material/Tooltip";
import Typography from "@mui/material/Typography";
import { useEffect, useRef, useState } from "react";
import { logsApi, type SystemLogEntry, type SysLogLevel } from "../api/systemApi";
import { AppIcon } from "../design-system/AppIcon";
import { MONO_STACK } from "../theme/tokens";

interface FilterChip {
  value: "debug" | "info" | "warn" | "error";
  label: string;
  color: "default" | "error" | "warning" | "primary" | "success";
}

/** "show at least this severity" options (backend filters by minimum rank). */
const FILTERS: FilterChip[] = [
  { value: "debug", label: "调试", color: "success" },
  { value: "info", label: "信息", color: "primary" },
  { value: "warn", label: "警告", color: "warning" },
  { value: "error", label: "错误", color: "error" },
];

function levelColor(level: string): string {
  const l = level.toUpperCase();
  if (l === "FATAL" || l === "ERROR") return "error.main";
  if (l === "WARN") return "warning.main";
  if (l === "DEBUG" || l === "TRACE") return "primary.light";
  return "text.secondary";
}

function formatTime(t: number): string {
  const d = new Date(t);
  const p = (n: number, len = 2): string => String(n).padStart(len, "0");
  return `${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}.${p(d.getMilliseconds(), 3)}`;
}

const POLL_MS = 1500;
const TAIL_LIMIT = 600;

/**
 * Live, detailed backend log viewer (Settings → 日志). Polls the in-memory log
 * buffer via `GET /api/v1/system/logs`, appends only newly emitted entries, and
 * offers level filtering, auto-scroll, copy and clear.
 */
export function SystemLogPanel() {
  const [minLevel, setMinLevel] = useState<SysLogLevel | "all">("all");
  const [entries, setEntries] = useState<SystemLogEntry[]>([]);
  const [lastId, setLastId] = useState<number>(0);
  const [autoScroll, setAutoScroll] = useState(true);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const scrollRef = useRef<HTMLDivElement>(null);
  // Keep level filter for the running poll without re-subscribing.
  const levelRef = useRef<SysLogLevel | "all">("all");
  levelRef.current = minLevel;

  // Reset history when the active filter changes.
  useEffect(() => {
    setEntries([]);
    setLastId(0);
    setAutoScroll(true);
  }, [minLevel]);

  useEffect(() => {
    let alive = true;
    let timer: number | undefined;

    const poll = async (): Promise<void> => {
      try {
        const level = levelRef.current === "all" ? undefined : levelRef.current;
        const res = await logsApi.list({
          ...(level !== undefined ? { level } : {}),
          limit: TAIL_LIMIT,
          ...(lastId > 0 ? { afterId: lastId } : {}),
        });
        if (!alive) return;
        setError("");
        setLoading(false);
        // backfill when cursor is gone (e.g. after clear or first open)
        if (res.logs.length > 0) {
          setEntries((prev) => {
            if (lastId === 0) return res.logs;
            const last = prev.length ? prev[prev.length - 1]?.id ?? 0 : 0;
            const isAppend = res.logs.length > 0 && res.logs[0]!.id > last;
            return isAppend ? [...prev, ...res.logs] : res.logs;
          });
          setLastId((cur) => Math.max(cur, res.logs[res.logs.length - 1]!.id));
        }
      } catch {
        if (alive) {
          setError("日志接口不可用，请确认后端正在运行。");
          setLoading(false);
        }
      }
    };

    void poll();
    timer = window.setInterval(() => void poll(), POLL_MS);
    return () => {
      alive = false;
      if (timer !== undefined) window.clearInterval(timer);
    };
  }, [minLevel, lastId]);

  useEffect(() => {
    if (autoScroll && scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [entries, autoScroll]);

  const onScroll = (): void => {
    const el = scrollRef.current;
    if (!el) return;
    const nearBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 48;
    setAutoScroll(nearBottom);
  };

  const copyAll = async (): Promise<void> => {
    const text = entries.map((e) => `${formatTime(e.time)} [${e.level.toUpperCase()}]${e.module ? ` (${e.module})` : ""} ${e.text}`).join("\n");
    if (!text) return;
    await window.launcher?.writeText(text);
  };

  const clear = (): void => {
    void logsApi.clear().then(() => {
      setEntries([]);
      setLastId(0);
    });
  };

  return (
    <Box>
      <Stack direction="row" spacing={0.5} sx={{ alignItems: "center", flexWrap: "wrap", mb: 1 }}>
        <Chip label="级别" size="small" sx={{ mr: 0.5 }} />
        <Chip
          key="all"
          size="small"
          color="default"
          variant={minLevel === "all" ? "filled" : "outlined"}
          label="全部"
          onClick={() => setMinLevel("all")}
        />
        {FILTERS.map((f) => (
          <Chip
            key={f.value}
            size="small"
            color={f.color}
            variant={minLevel === f.value ? "filled" : "outlined"}
            label={`${f.label}+`}
            onClick={() => setMinLevel(f.value)}
          />
        ))}

        <Box sx={{ ml: "auto", display: "flex", alignItems: "center", gap: 0.5 }}>
          <Button size="small" startIcon={<AppIcon name="content_copy" size={16} />} onClick={() => void copyAll()}>
            复制
          </Button>
          <Button size="small" startIcon={<AppIcon name="delete_sweep" size={16} />} onClick={clear}>
            清空
          </Button>
          <Box sx={{ display: "flex", alignItems: "center", gap: 0.5 }}>
            <Typography variant="caption" sx={{ color: "text.secondary" }}>
              自动滚动
            </Typography>
            <Switch size="small" checked={autoScroll} onChange={(e) => setAutoScroll(e.target.checked)} />
          </Box>
        </Box>
      </Stack>

      <Box
        ref={scrollRef}
        onScroll={onScroll}
        role="log"
        aria-label="后端详细日志"
        tabIndex={0}
        sx={{
          height: 440,
          overflowY: "auto",
          bgcolor: "surfaceContainerLowest",
          border: 1,
          borderColor: "divider",
          borderRadius: 2,
          p: 1.5,
          fontFamily: MONO_STACK,
          fontSize: 12.25,
          lineHeight: 1.55,
        }}
      >
        {loading ? (
          <Stack direction="row" spacing={1} sx={{ alignItems: "center", py: 6, justifyContent: "center" }}>
            <CircularProgress size={18} />
            <Typography variant="body2" sx={{ color: "text.secondary" }}>
              正在读取后端日志…
            </Typography>
          </Stack>
        ) : error ? (
          <Box sx={{ color: "error.main", py: 4, textAlign: "center" }}>{error}</Box>
        ) : entries.length === 0 ? (
          <Box sx={{ color: "text.disabled", py: 6, textAlign: "center" }}>暂无日志。运行安装 / 下载 / 启动后，后端的详细日志会实时出现在这里。</Box>
        ) : (
          entries.map((e) => (
            <Box key={e.id} sx={{ whiteSpace: "pre-wrap", wordBreak: "break-all" }}>
              <Box component="span" sx={{ color: "text.disabled" }}>
                {formatTime(e.time)}
              </Box>{" "}
              <Box component="span" sx={{ fontWeight: e.level === "error" || e.level === "fatal" ? 700 : 400, color: levelColor(e.level) }}>
                [{e.level.toUpperCase()}]
              </Box>{" "}
              {e.module && (
                <Box component="span" sx={{ color: "text.disabled" }}>
                  ({e.module}){" "}
                </Box>
              )}
              <Box component="span" sx={{ color: levelColor(e.level) }}>
                {e.text}
              </Box>
            </Box>
          ))
        )}
      </Box>

      <Tooltip title="本面板展示后端进程的内存日志，最多保留 5000 条">
        <Typography variant="caption" sx={{ color: "text.disabled", display: "block", mt: 0.5 }}>
          后端详细日志（实时刷新，每 1.5 秒）· 完整历史写入 logs/launcher.log
        </Typography>
      </Tooltip>
    </Box>
  );
}