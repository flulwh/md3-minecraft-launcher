import Box from "@mui/material/Box";
import Stack from "@mui/material/Stack";
import Typography from "@mui/material/Typography";
import type { SxProps, Theme } from "@mui/material/styles";

export interface FormRowProps {
  label: string;
  description?: string;
  htmlFor?: string;
  children: React.ReactNode;
  sx?: SxProps<Theme>;
}

export function FormRow({ label, description, htmlFor, children, sx }: FormRowProps) {
  return (
    <Stack
      direction={{ xs: "column", sm: "row" }}
      spacing={{ xs: 0.5, sm: 2 }}
      sx={{
        py: 1.5,
        alignItems: { sm: "center" },
        ...sx,
      }}
    >
      <Box sx={{ width: { sm: 220 }, flexShrink: 0 }}>
        <Typography component="label" htmlFor={htmlFor} variant="subtitle2">
          {label}
        </Typography>
        {description && (
          <Typography variant="caption" sx={{ display: "block", color: "text.secondary", mt: 0.25 }}>
            {description}
          </Typography>
        )}
      </Box>
      <Box sx={{ flex: 1, minWidth: 0 }}>{children}</Box>
    </Stack>
  );
}
