import Alert from "@mui/material/Alert";
import Box from "@mui/material/Box";
import Button from "@mui/material/Button";
import Skeleton from "@mui/material/Skeleton";
import { AppIcon } from "./AppIcon";

export interface StateViewProps {
  loading: boolean;
  error?: unknown;
  empty?: boolean;
  onRetry?: () => void;
  skeleton?: React.ReactNode;
  emptyIcon?: string;
  emptyTitle?: string;
  emptyDescription?: string;
  emptyAction?: React.ReactNode;
  children: React.ReactNode;
}

const DefaultSkeleton = (
  <Box sx={{ display: "grid", gap: 1.5 }}>
    <Skeleton variant="rounded" height={56} />
    <Skeleton variant="rounded" height={40} />
    <Skeleton variant="rounded" height={40} width="80%" />
  </Box>
);

export function StateView({
  loading,
  error,
  empty,
  onRetry,
  skeleton,
  emptyIcon = "inbox",
  emptyTitle = "暂无内容",
  emptyDescription,
  emptyAction,
  children,
}: StateViewProps) {
  if (loading) return <>{skeleton ?? DefaultSkeleton}</>;

  if (error !== undefined && error !== null) {
    const message = error instanceof Error ? error.message : String(error);
    return (
      <Alert
        severity="error"
        icon={<AppIcon name="error" size={22} />}
        action={
          onRetry && (
            <Button color="inherit" size="small" onClick={onRetry}>
              重试
            </Button>
          )
        }
        sx={{ borderRadius: 2 }}
      >
        {message}
      </Alert>
    );
  }

  if (empty) {
    return (
      <Box
        role="status"
        sx={{
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          justifyContent: "center",
          textAlign: "center",
          py: 8,
          px: 3,
          gap: 1,
        }}
      >
        <Box
          sx={{
            width: 64,
            height: 64,
            borderRadius: "50%",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            bgcolor: "surfaceContainerHigh",
            color: "text.secondary",
            mb: 1,
          }}
        >
          <AppIcon name={emptyIcon} size={30} />
        </Box>
        <Box sx={{ typography: "h6" }}>{emptyTitle}</Box>
        {emptyDescription && (
          <Box sx={{ typography: "body2", color: "text.secondary", maxWidth: 360 }}>
            {emptyDescription}
          </Box>
        )}
        {emptyAction && <Box sx={{ mt: 2 }}>{emptyAction}</Box>}
      </Box>
    );
  }

  return <>{children}</>;
}
