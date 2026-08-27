import Box from "@mui/material/Box";
import InputAdornment from "@mui/material/InputAdornment";
import TextField from "@mui/material/TextField";
import Typography from "@mui/material/Typography";
import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import type { MarketItemSummary } from "../api/types";
import { MarketItemCard } from "../components/MarketItemCard";
import {
  ActiveFilterChips,
  CategoryChips,
  MarketAdapterBar,
  SortSelect,
  useMarketFilters,
} from "../components/MarketFilters";
import { AppIcon } from "../design-system/AppIcon";
import { PageHeader } from "../design-system/PageHeader";
import { StateView } from "../design-system/StateView";
import { useInstances, useMarketHome } from "../hooks/queries";
import { marketStore } from "../stores/marketStore";

function FeedSection({
  title,
  icon,
  items,
}: {
  title: string;
  icon: string;
  items: MarketItemSummary[] | undefined;
}) {
  return (
    <section aria-label={title}>
      <Box sx={{ display: "flex", alignItems: "center", gap: 1, mb: 1.5 }}>
        <AppIcon name={icon} size={18} />
        <Typography variant="subtitle2" sx={{ color: "text.secondary" }}>
          {title}
        </Typography>
        <Typography variant="caption" sx={{ color: "text.disabled", ml: "auto" }}>
          {items ? `${items.length} 项` : ""}
        </Typography>
      </Box>
      <Box sx={{ display: "grid", gridTemplateColumns: { xs: "1fr", md: "repeat(2, 1fr)" }, gap: 1.5 }}>
        {items?.map((item) => <MarketItemCard key={item.id} item={item} />)}
      </Box>
    </section>
  );
}

export function MarketplacePage() {
  const navigate = useNavigate();
  const [q, setQ] = useState("");
  const store = marketStore();
  const { data: instances } = useInstances();

  // Open market adapted to a local instance: auto-select the first one once.
  useEffect(() => {
    const first = instances && instances.length > 0 ? instances[0] : undefined;
    if (!store.instanceId && first) {
      store.setInstance(first.id);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [instances, store.instanceId]);

  const filters = useMarketFilters();
  const { data, isLoading, error, refetch } = useMarketHome({
    mcVersion: filters.mcVersion,
    loader: filters.loader,
    categories: filters.categories,
  });

  return (
    <Box component="section">
      <PageHeader
        title="市场"
        description="浏览 Mod、资源包与光影包，内容会按所选实例的游戏版本与加载器适配"
      />

      <MarketAdapterBar />

      <form
        onSubmit={(e) => {
          e.preventDefault();
          if (q.trim()) navigate(`/marketplace/search?q=${encodeURIComponent(q.trim())}`);
        }}
        role="search"
      >
        <TextField
          fullWidth
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="搜索 Mod / 整合包 / 资源包…"
          slotProps={{
            input: {
              startAdornment: (
                <InputAdornment position="start">
                  <AppIcon name="search" size={20} />
                </InputAdornment>
              ),
              endAdornment:
                q.trim().length > 0 ? (
                  <InputAdornment position="end">
                    <AppIcon name="arrow_forward" size={18} />
                  </InputAdornment>
                ) : undefined,
            },
          }}
          sx={{ mb: 3 }}
        />
      </form>

      <ActiveFilterChips />

      <Box sx={{ display: "flex", alignItems: "center", gap: 1, flexWrap: "wrap", mb: 3 }}>
        <Typography variant="body2" color="text.secondary" sx={{ flexShrink: 0 }}>
          分类
        </Typography>
        <Box sx={{ display: "flex", alignItems: "center", gap: 0.75, flexWrap: "wrap" }}>
          <CategoryChips />
        </Box>
        <Box sx={{ flex: 1 }} />
        <SortSelect />
      </Box>

      <StateView loading={isLoading} error={error} onRetry={() => void refetch()}>
        <Box sx={{ display: "grid", gap: 3 }}>
          <FeedSection title="精选" icon="star" items={data?.featured} />
          <FeedSection title="最热" icon="whatshot" items={data?.popular} />
          <FeedSection title="最近更新" icon="update" items={data?.updated} />
        </Box>
      </StateView>
    </Box>
  );
}