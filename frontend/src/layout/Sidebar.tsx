import Badge from "@mui/material/Badge";
import Box from "@mui/material/Box";
import Divider from "@mui/material/Divider";
import ListItemButton from "@mui/material/ListItemButton";
import ListItemIcon from "@mui/material/ListItemIcon";
import Stack from "@mui/material/Stack";
import Tooltip from "@mui/material/Tooltip";
import Typography from "@mui/material/Typography";
import { NavLink, useNavigate } from "react-router-dom";
import { AppIcon } from "../design-system/AppIcon";
import { useAccounts } from "../hooks/queries";
import { resolveAccount } from "../lib/actions";
import { SIDEBAR_WIDTH_EXPANDED, SIDEBAR_WIDTH_RAIL } from "../theme/tokens";
import { uiStore } from "../stores/uiStore";

interface NavItem {
  to: string;
  icon: string;
  label: string;
}

const NAV_ITEMS: NavItem[] = [
  { to: "/", icon: "home", label: "首页" },
  { to: "/instances", icon: "widgets", label: "实例" },
  { to: "/downloads", icon: "download", label: "下载" },
  { to: "/accounts", icon: "person", label: "账户" },
  { to: "/settings", icon: "settings", label: "设置" },
];

function initials(name: string): string {
  return name.trim().slice(0, 2).toUpperCase();
}

export function Sidebar() {
  const expanded = uiStore((s) => s.sidebarExpanded);
  const toggle = uiStore((s) => s.toggleSidebar);
  const navigate = useNavigate();
  const accounts = useAccounts();
  const current = resolveAccount() ?? accounts.data?.[0] ?? null;

  return (
    <Box
      component="nav"
      aria-label="主导航"
      sx={{
        width: expanded ? SIDEBAR_WIDTH_EXPANDED : SIDEBAR_WIDTH_RAIL,
        flexShrink: 0,
        bgcolor: "surfaceContainerLow",
        borderRight: 1,
        borderColor: "divider",
        display: "flex",
        flexDirection: "column",
        transition: (t) => t.transitions.create("width", { duration: t.transitions.duration.standard }),
        overflow: "hidden",
      }}
    >
      <Stack
        sx={{
          flex: 1,
          px: 1,
          py: 1.5,
          gap: 0.5,
          alignItems: expanded ? "stretch" : "center",
        }}
      >
        {NAV_ITEMS.map((item) => (
          <Tooltip key={item.to} title={expanded ? "" : item.label} placement="right" disableHoverListener={expanded}>
            <ListItemButton
              component={NavLink}
              to={item.to}
              end={item.to === "/"}
              sx={{
                borderRadius: RADIUS_FULL,
                minHeight: 44,
                justifyContent: expanded ? "flex-start" : "center",
                px: expanded ? 2 : 0,
                "&.active": {
                  bgcolor: "secondary.container",
                  color: "secondary.onContainer",
                  "& .MuiListItemIcon-root": { color: "secondary.onContainer" },
                },
              }}
            >
              <ListItemIcon sx={{ minWidth: expanded ? 36 : 0, justifyContent: "center" }}>
                <AppIcon name={item.icon} size={22} />
              </ListItemIcon>
              {expanded && (
                <Typography variant="body2" sx={{ fontWeight: 500 }}>
                  {item.label}
                </Typography>
              )}
            </ListItemButton>
          </Tooltip>
        ))}
      </Stack>

      <Divider />
      <Box sx={{ p: 1 }}>
        <Tooltip title={current ? `当前账户：${current.username}` : "未选择账户"} placement="right" disableHoverListener={expanded}>
          <ListItemButton
            onClick={() => navigate("/accounts")}
            sx={{ borderRadius: RADIUS_FULL, minHeight: 44, px: expanded ? 1.5 : 0, justifyContent: expanded ? "flex-start" : "center" }}
          >
            <Badge
              overlap="circular"
              anchorOrigin={{ vertical: "bottom", horizontal: "right" }}
              variant="dot"
              sx={{ ".MuiBadge-dot": { bgcolor: current ? "success.main" : "text.disabled", width: 10, height: 10 } }}
            >
              <Box
                sx={{
                  width: 30,
                  height: 30,
                  borderRadius: "50%",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  fontSize: 12,
                  fontWeight: 600,
                  color: "primary.contrastText",
                  bgcolor: "primary.main",
                }}
              >
                {current ? initials(current.username) : "?"}
              </Box>
            </Badge>
            {expanded && (
              <Box sx={{ ml: 1.5, minWidth: 0 }}>
                <Typography variant="body2" noWrap sx={{ fontWeight: 500 }}>
                  {current ? current.username : "添加账户"}
                </Typography>
                <Typography variant="caption" sx={{ display: "block", color: "text.secondary" }} noWrap>
                  {current ? (current.type === "yggdrasil" ? "LittleSkin 账户" : "离线账户") : "点击前往账户页"}
                </Typography>
              </Box>
            )}
          </ListItemButton>
        </Tooltip>
        <Tooltip title={expanded ? "收起导航" : "展开导航"} placement="right" disableHoverListener={expanded}>
          <ListItemButton
            onClick={toggle}
            aria-label={expanded ? "收起导航栏" : "展开导航栏"}
            sx={{ borderRadius: RADIUS_FULL, minHeight: 40, mt: 0.5, justifyContent: "center", px: 0 }}
          >
            <ListItemIcon sx={{ minWidth: 0, justifyContent: "center" }}>
              <AppIcon name={expanded ? "menu_open" : "menu"} size={22} />
            </ListItemIcon>
          </ListItemButton>
        </Tooltip>
      </Box>
    </Box>
  );
}

const RADIUS_FULL = 1000;
