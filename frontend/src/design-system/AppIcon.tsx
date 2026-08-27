import { styled } from "@mui/material/styles";
import { memo } from "react";

export interface AppIconProps {
  name: string;
  size?: number;
  filled?: boolean;
  weight?: number;
  className?: string;
}

const Glyph = styled("span", {
  shouldForwardProp: (prop) => !["iconSize", "iconFilled", "iconWeight"].includes(String(prop)),
})<{ iconSize: number; iconFilled: boolean; iconWeight: number }>(({ iconSize, iconFilled, iconWeight }) => ({
  fontFamily: '"Material Symbols Rounded"',
  fontWeight: "normal",
  fontStyle: "normal",
  lineHeight: 1,
  letterSpacing: "normal",
  textTransform: "none",
  whiteSpace: "nowrap",
  wordWrap: "normal",
  direction: "ltr",
  display: "inline-flex",
  alignItems: "center",
  justifyContent: "center",
  userSelect: "none",
  fontSize: iconSize,
  width: iconSize,
  height: iconSize,
  fontVariationSettings: `"FILL" ${iconFilled ? 1 : 0}, "wght" ${iconWeight}, "GRAD" 0, "opsz" ${iconSize}`,
}));

export const AppIcon = memo(function AppIcon({
  name,
  size = 20,
  filled = false,
  weight = 400,
  className,
}: AppIconProps) {
  return (
    <Glyph
      iconSize={size}
      iconFilled={filled}
      iconWeight={weight}
      className={className}
      aria-hidden="true"
    >
      {name}
    </Glyph>
  );
});
