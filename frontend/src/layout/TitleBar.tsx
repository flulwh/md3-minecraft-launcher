import Box from "@mui/material/Box";
import Divider from "@mui/material/Divider";
import IconButton from "@mui/material/IconButton";
import Tooltip from "@mui/material/Tooltip";
import { useEffect, useState } from "react";
import { AppIcon } from "../design-system/AppIcon";
import { APP_NAME, TITLEBAR_HEIGHT } from "../theme/tokens";

function WindowButton(props: {
  icon: string;
  label: string;
  danger?: boolean;
  onClick: () => void;
}): React.JSX.Element {
  return (
    <Tooltip title={props.label}>
      <IconButton
        aria-label={props.label}
        onClick={props.onClick}
        disableRipple
        sx={{
          borderRadius: 0,
          height: TITLEBAR_HEIGHT,
          width: 44,
          color: "text.secondary",
          "&:hover": { bgcolor: "action.hover", color: "text.primary" },
          ...(props.danger && { "&:hover": { bgcolor: "error.main", color: "error.contrastText" } }),
        }}
      >
        <AppIcon name={props.icon} size={18} />
      </IconButton>
    </Tooltip>
  );
}

export function TitleBar() {
  const ext = window.launcher;
  const [maximized, setMaximized] = useState(false);

  useEffect(() => {
    if (!ext) return;
    void ext.isMaximized().then(setMaximized);
    return ext.onMaximizedChange(setMaximized);
  }, [ext]);

  return (
    <Box
      sx={{
        height: TITLEBAR_HEIGHT,
        flexShrink: 0,
        display: "flex",
        alignItems: "center",
        pl: 1.5,
        bgcolor: "surfaceContainerLow",
        borderBottom: 1,
        borderColor: "divider",
        ...(ext ? { "-webkit-app-region": "drag" } : {}),
      }}
    >
      <AppIcon name="grass" size={18} filled />
      <Box sx={{ ml: 1, typography: "caption", fontWeight: 600, color: "text.secondary", userSelect: "none" }}>
        {APP_NAME}
      </Box>
      <Box sx={{ flexGrow: 1 }} />
      {ext && (
        <Box sx={{ display: "flex", ...(ext ? { "-webkit-app-region": "no-drag" } : {}) }}>
          <WindowButton icon="remove" label="最小化" onClick={() => void ext.minimize()} />
          <WindowButton
            icon={maximized ? "filter_none" : "crop_square"}
            label={maximized ? "还原" : "最大化"}
            onClick={() => void ext.maximizeToggle()}
          />
          <WindowButton icon="close" label="关闭" danger onClick={() => void ext.close()} />
        </Box>
      )}
      {!ext && <Divider flexItem orientation="vertical" sx={{ mr: 2 }} />}
    </Box>
  );
}
