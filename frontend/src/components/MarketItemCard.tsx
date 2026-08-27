import Box from "@mui/material/Box";
import Card from "@mui/material/Card";
import Chip from "@mui/material/Chip";
import Typography from "@mui/material/Typography";
import { useNavigate } from "react-router-dom";
import type { MarketItemSummary } from "../api/types";
import { AppIcon } from "../design-system/AppIcon";

const TYPE_LABELS: Record<string, string> = {
  mod: "Mod",
  modpack: "整合包",
  resourcepack: "资源包",
  shader: "光影",
  world: "存档",
};

function typeLabel(type: string): string {
  return TYPE_LABELS[type] ?? type;
}

export function MarketItemCard({ item }: { item: MarketItemSummary }) {
  const navigate = useNavigate();

  return (
    <Card
      onClick={() => navigate(`/marketplace/item/${encodeURIComponent(item.id)}`)}
      sx={{
        p: 1.75,
        display: "flex",
        gap: 1.75,
        cursor: "pointer",
        transition: (t) => t.transitions.create(["background-color", "border-color"]),
        "&:hover": {
          bgcolor: "surfaceContainerHigh",
          borderColor: "outline",
        },
      }}
    >
      {item.iconUrl ? (
        <Box
          component="img"
          src={item.iconUrl}
          alt=""
          loading="lazy"
          sx={{
            width: 52,
            height: 52,
            borderRadius: 2,
            flexShrink: 0,
            objectFit: "cover",
          }}
        />
      ) : (
        <Box
          sx={{
            width: 52,
            height: 52,
            borderRadius: 2,
            flexShrink: 0,
            bgcolor: "surfaceContainerHigh",
            color: "text.secondary",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
          }}
        >
          <AppIcon name="extension" size={24} />
        </Box>
      )}

      <Box sx={{ minWidth: 0, flex: 1 }}>
        <Box sx={{ display: "flex", alignItems: "center", gap: 0.75 }}>
          <Typography variant="subtitle1" noWrap sx={{ fontWeight: 600, flex: 1 }}>
            {item.name}
          </Typography>
          <Chip size="small" label={typeLabel(item.type)} sx={{ height: 20, fontSize: 11 }} />
        </Box>
        <Box
          sx={{
            typography: "body2",
            color: "text.secondary",
            mt: 0.25,
            display: "-webkit-box",
            WebkitLineClamp: 2,
            WebkitBoxOrient: "vertical",
            overflow: "hidden",
            minHeight: "2.5em",
          }}
        >
          {item.description || "暂无简介"}
        </Box>
        <Box sx={{ typography: "caption", color: "text.secondary", mt: 0.5, display: "flex", alignItems: "center", gap: 1.5 }}>
          <Box component="span" sx={{ display: "inline-flex", alignItems: "center", gap: 0.4 }}>
            <AppIcon name="download" size={14} />
            {item.downloads.toLocaleString("zh-CN")}
          </Box>
          {item.author && (
            <Typography component="span" noWrap sx={{ overflow: "hidden", textOverflow: "ellipsis" }}>
              {item.author}
            </Typography>
          )}
        </Box>
      </Box>
    </Card>
  );
}