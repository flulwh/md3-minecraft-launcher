import Box from "@mui/material/Box";

export function SectionHeader({ title, trailing }: { title: string; trailing?: React.ReactNode }) {
  return (
    <Box sx={{ display: "flex", alignItems: "center", mb: 1.5 }}>
      <Box sx={{ typography: "subtitle2", color: "text.secondary" }}>{title}</Box>
      {trailing && <Box sx={{ ml: "auto" }}>{trailing}</Box>}
    </Box>
  );
}
