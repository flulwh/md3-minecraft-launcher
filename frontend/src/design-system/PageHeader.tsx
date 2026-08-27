import Box from "@mui/material/Box";
import { AppIcon } from "./AppIcon";

export interface PageHeaderProps {
  title: string;
  description?: string;
  actions?: React.ReactNode;
}

export function PageHeader({ title, description, actions }: PageHeaderProps) {
  return (
    <Box
      sx={{
        display: "flex",
        alignItems: "flex-start",
        justifyContent: "space-between",
        gap: 2,
        mb: 3,
      }}
    >
      <Box sx={{ minWidth: 0 }}>
        <Box component="h1" sx={{ m: 0, typography: "h4", color: "text.primary" }}>
          {title}
        </Box>
        {description && (
          <Box component="p" sx={{ m: 0, mt: 0.5, typography: "body2", color: "text.secondary" }}>
            {description}
          </Box>
        )}
      </Box>
      {actions && (
        <Box sx={{ display: "flex", alignItems: "center", gap: 1, flexShrink: 0 }}>{actions}</Box>
      )}
    </Box>
  );
}

export interface SectionHeaderProps {
  title: string;
  trailing?: React.ReactNode;
  icon?: string;
}

export function SectionHeader({ title, trailing, icon }: SectionHeaderProps) {
  return (
    <Box sx={{ display: "flex", alignItems: "center", gap: 1, mb: 1.5 }}>
      {icon && <AppIcon name={icon} size={18} />}
      <Box sx={{ typography: "subtitle2", color: "text.secondary" }}>{title}</Box>
      {trailing && <Box sx={{ ml: "auto" }}>{trailing}</Box>}
    </Box>
  );
}
