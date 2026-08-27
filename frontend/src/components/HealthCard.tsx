import Box from "@mui/material/Box";
import Button from "@mui/material/Button";
import Card from "@mui/material/Card";
import Chip from "@mui/material/Chip";
import CircularProgress from "@mui/material/CircularProgress";
import Divider from "@mui/material/Divider";
import Typography from "@mui/material/Typography";
import type { HealthStatus } from "../api/types";
import { AppIcon } from "../design-system/AppIcon";
import { useInstanceHealth, useRepairInstance } from "../hooks/queries";
import { toast } from "../stores/toastStore";

const STATUS_META: Record<HealthStatus, { color: string; icon: string; label: string }> = {
  ok: { color: "#4caf50", icon: "check_circle", label: "正常" },
  warn: { color: "#f9a825", icon: "warning", label: "注意" },
  issue: { color: "#f44336", icon: "error", label: "异常" },
};

export function HealthCard({ instanceId, scrollKey }: { instanceId: string; scrollKey: string }) {
  const health = useInstanceHealth(instanceId);
  const repair = useRepairInstance(instanceId);
  const report = health.data;

  const overall = report?.overall ?? "healthy";
  const statusColor =
    overall === "healthy" ? "#4caf50" : overall === "not_installed" ? "#9e9e9e" : "#f9a825";

  return (
    <Card id={scrollKey} sx={{ p: 2.5, scrollMarginTop: 10 }}>
      <Box sx={{ display: "flex", alignItems: "center", gap: 1, pb: 1.5 }}>
        <AppIcon name="health_and_safety" size={22} />
        <Typography variant="subtitle1" sx={{ flex: 1, fontWeight: 600 }}>
          实例健康状态
        </Typography>
        {health.isRefetching && <CircularProgress size={16} />}
      </Box>

      {!report ? (
        <Typography variant="body2" sx={{ color: "text.secondary" }}>
          正在检查…
        </Typography>
      ) : (
        <>
          <Box sx={{ display: "flex", alignItems: "center", gap: 1.5, pb: 1.5 }}>
            <Box
              sx={{
                width: 44,
                height: 44,
                borderRadius: "50%",
                display: "grid",
                placeItems: "center",
                color: "#fff",
                bgcolor: statusColor,
              }}
            >
              <AppIcon
                name={overall === "healthy" ? "check" : overall === "not_installed" ? "info" : "warning_amber"}
                size={26}
              />
            </Box>
            <Box>
              <Typography variant="subtitle1" sx={{ fontWeight: 700, lineHeight: 1.2 }}>
                {overall === "healthy" ? "实例状态健康" : overall === "not_installed" ? "尚未安装" : "发现需要处理的问题"}
              </Typography>
              <Typography variant="caption" sx={{ color: "text.secondary" }}>
                最后检查：{new Date(report.at).toLocaleTimeString()}
              </Typography>
            </Box>
          </Box>

          <Box sx={{ display: "grid", gap: 0.5 }}>
            {report.categories.map((c) => {
              const meta = STATUS_META[c.status];
              return (
                <Box
                  key={c.id}
                  sx={{ display: "flex", alignItems: "center", gap: 1, px: 1, py: 0.5, borderRadius: 1.5, bgcolor: "surfaceContainerLow" }}
                >
                  <Box component="span" sx={{ display: "inline-flex", color: meta.color }}>
                    <AppIcon name={meta.icon} size={16} />
                  </Box>
                  <Typography variant="body2" sx={{ fontWeight: 600, width: 110 }}>
                    {c.label}
                  </Typography>
                  <Typography variant="body2" noWrap sx={{ flex: 1, color: "text.secondary" }}>
                    {c.message}
                  </Typography>
                  <Chip size="small" label={meta.label} />
                </Box>
              );
            })}
          </Box>

          {report.corruptFiles.length > 0 && (
            <>
              <Divider sx={{ my: 1.5 }} />
              <Typography variant="body2" sx={{ color: "error.main", pb: 1 }}>
                检测到 {report.corruptFiles.length} 个异常文件
              </Typography>
              <Box sx={{ maxHeight: 140, overflow: "auto", display: "grid", gap: 0.25 }}>
                {report.corruptFiles.map((f, i) => (
                  <Typography key={i} variant="caption" noWrap sx={{ color: "text.secondary", fontFamily: "monospace" }}>
                    {f.reason} · {f.file}
                  </Typography>
                ))}
              </Box>
            </>
          )}

          {overall !== "healthy" && overall !== "not_installed" && (
            <Box sx={{ display: "flex", gap: 1, pt: 1.5 }}>
              <Button
                size="small"
                variant="contained"
                color="error"
                startIcon={<AppIcon name="build" size={16} />}
                onClick={() =>
                  repair.mutate(undefined, {
                    onSuccess: () => {
                      toast.success("修复完成");
                      void health.refetch();
                    },
                    onError: (err) => toast.error(err instanceof Error ? err.message : "修复失败"),
                  })
                }
                disabled={repair.isPending}
              >
                {repair.isPending ? "修复中…" : "一键修复"}
              </Button>
              <Button
                size="small"
                variant="outlined"
                startIcon={<AppIcon name="sync" size={16} />}
                onClick={() => health.refetch()}
                disabled={health.isFetching}
              >
                重新检查
              </Button>
            </Box>
          )}
        </>
      )}
    </Card>
  );
}