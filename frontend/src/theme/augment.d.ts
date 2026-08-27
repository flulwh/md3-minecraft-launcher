import "@mui/material/styles";

export interface TertiaryPalette {
  main: string;
  contrastText: string;
  container: string;
  onContainer: string;
}

declare module "@mui/material/styles" {
  interface SimplePaletteColorOptions {
    container?: string;
    onContainer?: string;
  }
  interface PaletteColor {
    container?: string;
    onContainer?: string;
  }
  interface Palette {
    tertiary: TertiaryPalette;
    outline: string;
    outlineVariant: string;
    surfaceContainerLowest: string;
    surfaceContainerLow: string;
    surfaceContainer: string;
    surfaceContainerHigh: string;
    surfaceContainerHighest: string;
  }
  interface PaletteOptions {
    tertiary?: TertiaryPalette;
    outline?: string;
    outlineVariant?: string;
    surfaceContainerLowest?: string;
    surfaceContainerLow?: string;
    surfaceContainer?: string;
    surfaceContainerHigh?: string;
    surfaceContainerHighest?: string;
  }
}
