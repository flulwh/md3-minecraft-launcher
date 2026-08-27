import { CssBaseline, GlobalStyles, ThemeProvider } from "@mui/material";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { HashRouter, Navigate, Route, Routes } from "react-router-dom";
import { ApiError } from "./api/http";
import { AppShell } from "./layout/AppShell";
import { AccountsPage } from "./pages/AccountsPage";
import { DownloadsPage } from "./pages/DownloadsPage";
import { HomePage } from "./pages/HomePage";
import { InstanceDetailPage } from "./pages/InstanceDetailPage";
import { InstancesPage } from "./pages/InstancesPage";
import { MarketDetailPage } from "./pages/MarketDetailPage";
import { MarketplacePage } from "./pages/MarketplacePage";
import { MarketSearchPage } from "./pages/MarketSearchPage";
import { SettingsPage } from "./pages/SettingsPage";
import { theme } from "./theme/createAppTheme";

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      retry: (failureCount, error) => {
        if (error instanceof ApiError && error.httpStatus !== undefined && error.httpStatus < 500) {
          return false;
        }
        return failureCount < 2;
      },
      refetchOnWindowFocus: true,
    },
  },
});

export function App(): React.JSX.Element {
  return (
    <QueryClientProvider client={queryClient}>
      <ThemeProvider theme={theme} defaultMode="system">
        <CssBaseline enableColorScheme />
        <GlobalStyles
          styles={{
            "html, body, #root": { height: "100%" },
            body: { overscrollBehavior: "none" },
            "::selection": { bgcolor: "primary.container" },
            "*::-webkit-scrollbar": { width: 10, height: 10 },
            "*::-webkit-scrollbar-thumb": {
              background: "rgba(128,128,128,0.35)",
              borderRadius: 8,
              border: "2px solid transparent",
              backgroundClip: "content-box",
            },
            "*::-webkit-scrollbar-thumb:hover": { background: "rgba(128,128,128,0.55)", backgroundClip: "content-box", border: "2px solid transparent" },
            "*:focus-visible": {
              outline: `2px solid ${theme.palette.primary.main}`,
              outlineOffset: 2,
            },
          }}
        />
        <HashRouter>
          <Routes>
            <Route element={<AppShell />}>
              <Route path="/" element={<HomePage />} />
              <Route path="/instances" element={<InstancesPage />} />
              <Route path="/instances/:id" element={<InstanceDetailPage />} />
              <Route path="/marketplace" element={<MarketplacePage />} />
              <Route path="/marketplace/search" element={<MarketSearchPage />} />
              <Route path="/marketplace/item/:id" element={<MarketDetailPage />} />
              <Route path="/downloads" element={<DownloadsPage />} />
              <Route path="/accounts" element={<AccountsPage />} />
              <Route path="/settings" element={<SettingsPage />} />
              <Route path="*" element={<Navigate to="/" replace />} />
            </Route>
          </Routes>
        </HashRouter>
      </ThemeProvider>
    </QueryClientProvider>
  );
}
