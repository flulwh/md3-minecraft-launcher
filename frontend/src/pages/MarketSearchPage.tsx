import Box from "@mui/material/Box";
import Chip from "@mui/material/Chip";
import Stack from "@mui/material/Stack";
import TextField from "@mui/material/TextField";
import Typography from "@mui/material/Typography";
import { useState } from "react";
import { useSearchParams } from "react-router-dom";
import type { MarketContentType } from "../api/types";
import { MarketItemCard } from "../components/MarketItemCard";
import {
  ActiveFilterChips,
  CategoryChips,
  LoaderChips,
  SortSelect,
  useMarketFilters,
} from "../components/MarketFilters";
import { PageHeader } from "../design-system/PageHeader";
import { StateView } from "../design-system/StateView";
import { useMarketSearch } from "../hooks/queries";
import { marketStore } from "../stores/marketStore";

function loaderEnabled(type: MarketContentType | "all"): boolean {
  return type === "all" || type === "mod" || type === "modpack";
}

const TYPE_FILTERS: { value: MarketContentType | "all"; label: string }[] = [
  { value: "all", label: "全部" },
  { value: "mod", label: "Mod" },
  { value: "modpack", label: "整合包" },
  { value: "resourcepack", label: "资源包" },
  { value: "shader", label: "光影" },
  { value: "world", label: "存档" },
];

function FilterLabel({ children }: { children: React.ReactNode }) {
  return (
    <Typography variant="caption" sx={{ color: "text.secondary", flexShrink: 0 }}>
      {children}
    </Typography>
  );
}

function VersionChips() {
  const { version, setVersion, clearVersion, setClearVersion } = marketStore();
  const [text, setText] = useState("");
  const active = clearVersion ? "all" : version ? "manual" : "auto";
  const submit = (value: string) => {
    const v = value.trim();
    if (v) {
      setVersion(v);
      setClearVersion(false);
    }
  };
  return (
    <Box sx={{ display: "flex", alignItems: "center", gap: 1, flexWrap: "wrap" }}>
      <FilterLabel>版本</FilterLabel>
      <Chip
        size="small"
        label="随实例"
        clickable
        color={active === "auto" ? "primary" : "default"}
        onClick={() => {
          setClearVersion(false);
          setVersion("");
        }}
      />
      <Chip
        size="small"
        label="全部版本"
        clickable
        color={active === "all" ? "primary" : "default"}
        onClick={() => {
          setClearVersion(true);
          setVersion("");
        }}
      />
      <TextField
        size="small"
        value={text}
        onChange={(e) => setText(e.target.value)}
        onBlur={() => submit(text)}
        onKeyDown={(e) => {
          if (e.key === "Enter") {
            submit(text);
            (e.target as HTMLInputElement).blur();
          }
        }}
        placeholder={version || "输入版本号，如 1.20.1"}
        slotProps={{ input: { sx: { py: 0.4 } } }}
        sx={{ width: 200 }}
      />
      {active === "manual" && version && (
        <Chip
          size="small"
          label={`手动 · ${version}`}
          color="info"
          onDelete={() => {
            setVersion("");
            setClearVersion(true);
          }}
        />
      )}
    </Box>
  );
}

export function MarketSearchPage() {
  const [sp, setSp] = useSearchParams();
  const q = sp.get("q") ?? "";
  const type = (sp.get("type") as MarketContentType | null) ?? undefined;
  const [input, setInput] = useState(q);
  const activeType = type ?? "all";
  const filters = useMarketFilters(activeType);
  const { data, isLoading, error, refetch } = useMarketSearch({
    q,
    ...(activeType !== "all" ? { type: activeType as MarketContentType } : {}),
    loader: filters.loader,
    mcVersion: filters.mcVersion,
    categories: filters.categories,
    index: filters.sort,
    limit: 24,
  });

  return (
    <Box component="section">
      <PageHeader title="搜索结果" description={q ? `“${q}” 的搜索结果` : undefined} />

      <form
        onSubmit={(e) => {
          e.preventDefault();
          if (input.trim()) setSp({ q: input.trim() });
        }}
        role="search"
      >
        <TextField
          fullWidth
          value={input}
          onChange={(e) => setInput(e.target.value)}
          placeholder="继续搜索…"
          sx={{ mb: 2 }}
        />
      </form>

      <Stack direction="row" spacing={1} sx={{ mb: 2.5, flexWrap: "wrap", gap: 1 }}>
        {TYPE_FILTERS.map((f) => (
          <Chip
            key={f.value}
            label={f.label}
            clickable
            color={activeType === f.value ? "primary" : "default"}
            onClick={() => {
              const next = new URLSearchParams(sp);
              if (f.value === "all") next.delete("type");
              else next.set("type", f.value);
              setSp(next);
            }}
          />
        ))}
      </Stack>

      <ActiveFilterChips type={activeType} />

      <Box sx={{ display: "flex", flexDirection: "column", gap: 1, mb: 3 }}>
        <Box sx={{ display: "flex", alignItems: "center", gap: 1, flexWrap: "wrap" }}>
          <FilterLabel>加载器</FilterLabel>
          {loaderEnabled(activeType) ? (
            <LoaderChips />
          ) : (
            <Typography variant="caption" color="text.secondary">
              加载器仅适用于 Mod / 整合包
            </Typography>
          )}
        </Box>
        <Box sx={{ display: "flex", alignItems: "center", gap: 1, flexWrap: "wrap" }}>
          <VersionChips />
        </Box>
        <Box sx={{ display: "flex", alignItems: "center", gap: 1, flexWrap: "wrap" }}>
          <FilterLabel>分类</FilterLabel>
          <CategoryChips />
        </Box>
        <Box sx={{ display: "flex", alignItems: "center", gap: 1 }}>
          <FilterLabel>排序</FilterLabel>
          <SortSelect />
        </Box>
      </Box>

      <StateView
        loading={isLoading}
        error={error}
        onRetry={() => void refetch()}
        empty={data !== undefined && data.length === 0}
        emptyIcon="search_off"
        emptyTitle="没有找到相关项目"
        emptyDescription="换个关键词、类型或减少过滤条件再试试"
      >
        <Box sx={{ display: "grid", gridTemplateColumns: { xs: "1fr", md: "repeat(2, 1fr)" }, gap: 1.5 }}>
          {data?.map((item) => <MarketItemCard key={item.id} item={item} />)}
        </Box>
      </StateView>
    </Box>
  );
}