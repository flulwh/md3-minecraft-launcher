import Box from "@mui/material/Box";
import Card from "@mui/material/Card";
import LinearProgress from "@mui/material/LinearProgress";
import Typography from "@mui/material/Typography";
import { useInstance, useDeleteSummary } from "../hooks/queries";
import { fmtBytes } from "../lib/format";

/** Per-category label for the game-directory disk breakdown. */
const CATEGORY_LABELS: Record<string, string> = {
  saves: "存档",
  mods: "Mod",
  config: "配置",
  resourcepacks: "资源包",
  shaderpacks: "光影",
  screenshots: "截图",
  other: "其他",
};

export function DiskUsagePanel({ instanceId, scrollKey }: { instanceId: string; scrollKey: string }) {
  const instance = useInstance(instanceId);
  const summary = useDeleteSummary(instanceId);
  const breakdown = summary.data?.breakdown ?? [];
  const total = summary.data?.totalSizeBytes ?? 0;

  return (
    <Card id={scrollKey} sx={{ p: 2.5, scrollMarginTop: 10 }}>
      <Box sx={{ display: "flex", alignItems: "center", gap: 1, pb: 0.5 }}>
        <Box component="span" sx={{ display: "inline-flex", color: "text.secondary" }}>
          <svg width="22" height="22" viewBox="0 0 24 24" fill="none" aria-hidden="true">
            <path d="M4 7h10v10H4z" fill="currentColor" opacity="0.5" />
            <path d="M14 7h6v10h-6z" fill="currentColor" />
          </svg>
        </Box>
        <Typography variant="subtitle1" sx={{ flex: 1, fontWeight: 600 }}>
          磁盘占用
        </Typography>
        <Typography variant="body2" sx={{ fontWeight: 600 }}>
          {summary.isLoading ? "统计中…" : fmtBytes(total)}
        </Typography>
      </Box>

      {summary.isLoading ? (
        <Typography variant="caption" sx={{ color: "text.secondary" }}>
          正在统计各目录大小…
        </Typography>
      ) : breakdown.length === 0 ? (
        <Typography variant="caption" sx={{ color: "text.secondary" }}>
          实例尚未产生本地文件。
        </Typography>
      ) : (
        <Box sx={{ display: "grid", gap: 1, pt: 1 }}>
          {breakdown.map((b) => {
            const pct = total > 0 ? (b.sizeBytes / total) * 100 : 0;
            return (
              <Box key={b.name}>
                <Box sx={{ display: "flex", alignItems: "center", gap: 1, mb: 0.25 }}>
                  <Typography variant="body2" sx={{ width: 84, flexShrink: 0 }}>
                    {CATEGORY_LABELS[b.name] ?? b.name}
                  </Typography>
                  <LinearProgress
                    variant="determinate"
                    value={Math.min(pct, 100)}
                    sx={{ flex: 1, height: 6, borderRadius: 3 }}
                  />
                  <Typography variant="caption" sx={{ color: "text.secondary", width: 92, textAlign: "right", flexShrink: 0 }}>
                    {fmtBytes(b.sizeBytes)} · {b.fileCount}
                  </Typography>
                </Box>
              </Box>
            );
          })}
        </Box>
      )}

      <Typography variant="caption" sx={{ color: "text.secondary", display: "block", pt: 1.5 }}>
        统计范围：{instance.data?.gameDir ?? "实例游戏目录"}（不含共享库与资源文件）
      </Typography>
    </Card>
  );
}