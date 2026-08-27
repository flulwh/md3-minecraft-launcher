import { createTheme } from "@mui/material/styles";
import type { Theme, ThemeOptions } from "@mui/material/styles";
import type { Palette } from "@mui/material/styles";
import { FONT_STACK, MONO_STACK, MOTION, RADIUS } from "./tokens";

export const pal = (theme: Theme): Palette => {
  const vars = (theme as Theme & { vars?: { palette: Palette } }).vars;
  return vars?.palette ?? theme.palette;
};

const typography: ThemeOptions["typography"] = {
  fontFamily: FONT_STACK,
  h1: { fontSize: "2rem", fontWeight: 600, lineHeight: 1.2 },
  h2: { fontSize: "1.75rem", fontWeight: 600, lineHeight: 1.25 },
  h3: { fontSize: "1.5rem", fontWeight: 600, lineHeight: 1.3 },
  h4: { fontSize: "1.375rem", fontWeight: 600, lineHeight: 1.3 },
  h5: { fontSize: "1.25rem", fontWeight: 600, lineHeight: 1.35 },
  h6: { fontSize: "1.125rem", fontWeight: 600, lineHeight: 1.4 },
  subtitle1: { fontSize: "0.9375rem", lineHeight: 1.5 },
  subtitle2: { fontSize: "0.875rem", fontWeight: 500, lineHeight: 1.45 },
  body1: { fontSize: "0.9375rem", lineHeight: 1.55 },
  body2: { fontSize: "0.875rem", lineHeight: 1.5 },
  button: { textTransform: "none", fontWeight: 500 },
  caption: { fontSize: "0.8125rem", lineHeight: 1.4 },
  overline: { fontSize: "0.75rem", fontWeight: 500, letterSpacing: "0.08em" },
};

export const createAppTheme = (): Theme =>
  createTheme({
    cssVariables: { colorSchemeSelector: "class" },
    colorSchemes: {
      light: {
        palette: {
          mode: "light",
          primary: {
            main: "#3f6837",
            contrastText: "#ffffff",
            container: "#bff0ae",
            onContainer: "#0b2104",
          },
          secondary: {
            main: "#57634a",
            contrastText: "#ffffff",
            container: "#dbe7c8",
            onContainer: "#151e0b",
          },
          tertiary: {
            main: "#00696d",
            contrastText: "#ffffff",
            container: "#9cf1f5",
            onContainer: "#002021",
          },
          error: {
            main: "#ba1a1a",
            contrastText: "#ffffff",
            container: "#ffdad6", onContainer: "#410002",
          },
          success: {
            main: "#386a20",
            contrastText: "#ffffff",
            container: "#c6efa7", onContainer: "#072100",
          },
          warning: {
            main: "#8b5900",
            contrastText: "#ffffff",
            container: "#ffddb3", onContainer: "#2b1700",
          },
          info: { main: "#00696d", contrastText: "#ffffff" },
          background: { default: "#f9faef", paper: "#f3f4e9" },
          surfaceContainerLowest: "#ffffff",
          surfaceContainerLow: "#f3f4e9",
          surfaceContainer: "#edefe3",
          surfaceContainerHigh: "#e7e8de",
          surfaceContainerHighest: "#e2e3d8",
          outline: "#73796d",
          outlineVariant: "#c3c8ba",
          divider: "#c3c8ba",
          text: {
            primary: "#1a1c16",
            secondary: "#43483f",
            disabled: "rgba(26, 28, 22, 0.38)",
          },
        },
      },
      dark: {
        palette: {
          mode: "dark",
          primary: {
            main: "#a4d489",
            contrastText: "#1b3703",
            container: "#2c4f15",
            onContainer: "#bff0ae",
          },
          secondary: {
            main: "#bfcbad",
            contrastText: "#2a331f",
            container: "#404a34",
            onContainer: "#dbe7c8",
          },
          tertiary: {
            main: "#80d4d8",
            contrastText: "#003639",
            container: "#1f4f52",
            onContainer: "#9cf1f5",
          },
          error: {
            main: "#ffb4ab",
            contrastText: "#690005",
            container: "#93000a", onContainer: "#ffdad6",
          },
          success: {
            main: "#96d47f",
            contrastText: "#0d3900",
            container: "#1f4907", onContainer: "#c6efa7",
          },
          warning: {
            main: "#ffb951",
            contrastText: "#4b2800",
            container: "#5f4200", onContainer: "#ffddb3",
          },
          info: { main: "#80d4d8", contrastText: "#003639" },
          background: { default: "#12140e", paper: "#1a1c16" },
          surfaceContainerLowest: "#0c0f09",
          surfaceContainerLow: "#1a1c16",
          surfaceContainer: "#1e201a",
          surfaceContainerHigh: "#282b24",
          surfaceContainerHighest: "#33362e",
          outline: "#8d9385",
          outlineVariant: "#43483f",
          divider: "#43483f",
          text: {
            primary: "#e2e3d8",
            secondary: "#c3c8ba",
            disabled: "rgba(226, 227, 216, 0.35)",
          },
        },
      },
    },
    typography,
    shape: { borderRadius: RADIUS.md },
    transitions: {
      duration: { short: MOTION.short, standard: MOTION.std, complex: MOTION.long },
      easing: { easeInOut: MOTION.easing, easeOut: MOTION.decel },
    },
    components: {
      MuiButton: {
        styleOverrides: {
          root: {
            borderRadius: RADIUS.full,
            textTransform: "none",
            fontWeight: 500,
          },
          sizeLarge: {
            height: 48,
            fontSize: "0.9375rem",
            paddingInline: 28,
          },
          sizeSmall: { paddingInline: 14 },
        },
      },
      MuiIconButton: {
        defaultProps: { size: "small" },
      },
      MuiPaper: {
        defaultProps: { elevation: 0 },
        styleOverrides: {
          rounded: ({ theme }) => ({ borderRadius: RADIUS.md }),
        },
      },
      MuiCard: {
        styleOverrides: {
          root: ({ theme }) => ({
            backgroundImage: "none",
            border: `1px solid ${pal(theme).outlineVariant}`,
            borderRadius: RADIUS.md,
          }),
        },
      },
      MuiDialog: {
        styleOverrides: {
          paper: ({ theme }) => ({
            backgroundImage: "none",
            borderRadius: RADIUS.xl,
            backgroundColor: pal(theme).surfaceContainerHigh,
          }),
        },
      },
      MuiMenu: {
        styleOverrides: {
          paper: ({ theme }) => ({
            backgroundImage: "none",
            borderRadius: RADIUS.lg,
            backgroundColor: pal(theme).surfaceContainerHigh,
            minWidth: 180,
          }),
        },
      },
      MuiOutlinedInput: {
        styleOverrides: {
          root: { borderRadius: RADIUS.sm },
        },
      },
      MuiLinearProgress: {
        styleOverrides: {
          root: { borderRadius: RADIUS.full, height: 6 },
          bar: { borderRadius: RADIUS.full },
        },
      },
      MuiChip: {
        styleOverrides: {
          sizeSmall: { height: 22 },
        },
      },
      MuiTab: {
        styleOverrides: { root: { textTransform: "none" } },
      },
      MuiTooltip: {
        defaultProps: { arrow: true },
      },
    },
  });

export const theme = createAppTheme();
