import Dialog from "@mui/material/Dialog";
import DialogContent from "@mui/material/DialogContent";
import InputBase from "@mui/material/InputBase";
import List from "@mui/material/List";
import ListItemButton from "@mui/material/ListItemButton";
import ListItemIcon from "@mui/material/ListItemIcon";
import Typography from "@mui/material/Typography";
import { useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { AppIcon } from "../design-system/AppIcon";
import { useInstances } from "../hooks/queries";
import { loaderLabel } from "../lib/format";
import { startLaunch } from "../lib/actions";
import { uiStore } from "../stores/uiStore";

interface Command {
  id: string;
  icon: string;
  label: string;
  hint?: string;
  run: () => void;
}

export function CommandPalette() {
  const open = uiStore((s) => s.paletteOpen);
  const setOpen = uiStore((s) => s.setPaletteOpen);
  const [query, setQuery] = useState("");
  const [activeIndex, setActiveIndex] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const navigate = useNavigate();
  const instances = useInstances();

  const commands = useMemo<Command[]>(() => {
    const navCommands: Command[] = [
      { id: "nav-home", icon: "home", label: "前往首页", run: () => navigate("/") },
      { id: "nav-instances", icon: "widgets", label: "前往实例", run: () => navigate("/instances") },
      { id: "nav-downloads", icon: "download", label: "前往下载", run: () => navigate("/downloads") },
      { id: "nav-accounts", icon: "person", label: "前往账户", run: () => navigate("/accounts") },
      { id: "nav-settings", icon: "settings", label: "前往设置", run: () => navigate("/settings") },
    ];
    const instanceCommands: Command[] = (instances.data ?? []).map((i) => ({
      id: `inst-${i.id}`,
      icon: "play_arrow",
      label: `启动「${i.name}」`,
      hint: `Minecraft ${i.minecraftVersion} · ${loaderLabel(i.loader)}`,
      run: () => {
        void startLaunch(i.id);
        navigate(`/instances/${i.id}`);
      },
    }));
    return [...instanceCommands, ...navCommands];
  }, [instances.data, navigate]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return commands;
    return commands.filter(
      (c) => c.label.toLowerCase().includes(q) || (c.hint?.toLowerCase().includes(q) ?? false),
    );
  }, [commands, query]);

  useEffect(() => {
    if (open) {
      setQuery("");
      setActiveIndex(0);
      setTimeout(() => inputRef.current?.focus(), 50);
    }
  }, [open]);

  useEffect(() => {
    setActiveIndex(0);
  }, [query]);

  const runCommand = (command: Command | undefined): void => {
    if (!command) return;
    setOpen(false);
    command.run();
  };

  return (
    <Dialog
      open={open}
      onClose={() => setOpen(false)}
      maxWidth="sm"
      fullWidth
      slotProps={{ paper: { sx: { alignSelf: "flex-start", mt: "12vh" } } }}
      onKeyDown={(e) => {
        if (e.key === "ArrowDown") {
          e.preventDefault();
          setActiveIndex((i) => Math.min(i + 1, filtered.length - 1));
        } else if (e.key === "ArrowUp") {
          e.preventDefault();
          setActiveIndex((i) => Math.max(i - 1, 0));
        } else if (e.key === "Enter") {
          e.preventDefault();
          runCommand(filtered[activeIndex]);
        }
      }}
    >
      <DialogContent sx={{ p: 0 }}>
        <InputBase
          inputRef={inputRef}
          fullWidth
          placeholder="搜索实例或页面…"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          sx={{ px: 2.5, py: 1.75, borderBottom: 1, borderColor: "divider" }}
          inputProps={{ "aria-label": "命令搜索" }}
        />
        <List dense sx={{ maxHeight: 320, overflowY: "auto", py: 1 }} role="listbox">
          {filtered.length === 0 && (
            <Typography variant="body2" sx={{ color: "text.secondary", textAlign: "center", py: 3 }}>
              没有匹配的结果
            </Typography>
          )}
          {filtered.map((c, idx) => (
            <ListItemButton
              key={c.id}
              role="option"
              aria-selected={idx === activeIndex}
              selected={idx === activeIndex}
              onClick={() => runCommand(c)}
              onMouseEnter={() => setActiveIndex(idx)}
              sx={{ borderRadius: 2, mx: 1, mb: 0.25 }}
            >
              <ListItemIcon sx={{ minWidth: 36 }}>
                <AppIcon name={c.icon} size={20} />
              </ListItemIcon>
              <Typography variant="body2" sx={{ fontWeight: 500 }}>
                {c.label}
              </Typography>
              {c.hint && (
                <Typography variant="caption" sx={{ ml: "auto", color: "text.secondary" }}>
                  {c.hint}
                </Typography>
              )}
            </ListItemButton>
          ))}
        </List>
      </DialogContent>
    </Dialog>
  );
}
