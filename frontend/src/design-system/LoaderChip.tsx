import Chip from "@mui/material/Chip";
import { AppIcon } from "./AppIcon";

const LOADER_STYLE: Record<
  string,
  { icon: string; fg: "success" | "secondary" | "error" | "info" | "warning" }
> = {
  vanilla: { icon: "grass", fg: "success" },
  fabric: { icon: "bolt", fg: "info" },
  forge: { icon: "local_fire_department", fg: "error" },
  neoforge: { icon: "whatshot", fg: "warning" },
  quilt: { icon: "grid_view", fg: "secondary" },
};

export function LoaderChip({ loader, version }: { loader: string; version?: string | null }) {
  const style = LOADER_STYLE[loader] ?? { icon: "extension", fg: "secondary" as const };
  const label = [loader === "vanilla" ? "原版" : loader, version].filter(Boolean).join(" ");
  void style.icon;
  return (
    <Chip
      size="small"
      color={style.fg}
      variant={loader === "vanilla" ? "outlined" : "filled"}
      label={
        <span style={{ display: "inline-flex", alignItems: "center", gap: 4 }}>
          <AppIcon name={style.icon} size={13} filled />
          {label}
        </span>
      }
      sx={{ ".MuiChip-label": { px: 0.75 } }}
    />
  );
}
