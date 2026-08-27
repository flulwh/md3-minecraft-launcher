import Box from "@mui/material/Box";
import Chip from "@mui/material/Chip";
import FormControl from "@mui/material/FormControl";
import MenuItem from "@mui/material/MenuItem";
import Select from "@mui/material/Select";
import Typography from "@mui/material/Typography";
import type { ReactNode } from "react";
import type { MarketContentType, MarketSortIndex } from "../api/types";
import { useInstances } from "../hooks/queries";
import { marketStore } from "../stores/marketStore";

export interface EffectiveMarketFilters {
  instanceId: string | null;
  loader?: string;
  mcVersion?: string;
  categories: string[];
  sort: MarketSortIndex;
}

/** Loaders usable as Modrinth `categories` facets; '' = "auto (follow the instance)". */
const LOADER_CATEGORIES: string[] = ["", "fabric", "forge", "quilt", "neoforge"];

/** Modrinth content categories shown as filter chips. */
export const MARKET_CATEGORIES: { value: string; label: string }[] = [
  { value: "adventure", label: "冒险" },
  { value: "combat", label: "战斗" },
  { value: "optimization", label: "性能优化" },
  { value: "library", label: "库/前置" },
  { value: "technology", label: "科技" },
  { value: "magic", label: "魔法" },
  { value: "decoration", label: "装饰" },
  { value: "storage", label: "存储" },
  { value: "transportation", label: "交通" },
  { value: "movement", label: "移动" },
  { value: "armor", label: "装备" },
  { value: "food", label: "食物" },
  { value: "mechanisms", label: "机械" },
  { value: "worldgen", label: "世界生成" },
  { value: "multiplatform", label: "多平台" },
];

const SORT_OPTIONS: { value: MarketSortIndex; label: string }[] = [
  { value: "relevance", label: "相关度" },
  { value: "downloads", label: "下载量" },
  { value: "updated", label: "最近更新" },
];

/**
 * Derives the active market browsing context from the selected instance plus any
 * manual overrides. `type` gates whether the loader facet applies (mods/modpacks
 * carry a loader; resource/shader/world packs do not).
 */
export function useMarketFilters(type?: MarketContentType | "all"): EffectiveMarketFilters {
  const {
    instanceId,
    loader: manualLoader,
    version: manualVersion,
    categories,
    sort,
    clearVersion,
  } = marketStore();
  const { data: instances } = useInstances();
  const instance = instances?.find((i) => i.id === instanceId);

  const loaderDriven = type === "mod" || type === "modpack" || type === undefined || type === "all";
  const autoLoader = instance && instance.loader !== "vanilla" ? instance.loader : undefined;
  const loader = manualLoader !== "" ? manualLoader : loaderDriven ? autoLoader ?? "" : "";

  let mcVersion: string | undefined;
  if (clearVersion) mcVersion = manualVersion || undefined;
  else mcVersion = manualVersion || instance?.minecraftVersion || undefined;

  return {
    instanceId: instance?.id ?? null,
    loader: loader || undefined,
    mcVersion,
    categories,
    sort,
  };
}

export function MarketAdapterBar() {
  const { instanceId, setInstance, resetFilters } = marketStore();
  const { data: instances } = useInstances();
  const filters = useMarketFilters();

  return (
    <Box
      sx={{
        display: "flex",
        alignItems: "center",
        gap: 1.5,
        flexWrap: "wrap",
        mb: 2,
        p: 1.5,
        borderRadius: 2,
        border: "1px solid",
        borderColor: "outlineVariant",
        bgcolor: "surfaceContainerLow",
      }}
    >
      <FormControl size="small" sx={{ minWidth: 180 }}>
        <Select
          displayEmpty
          value={instanceId ?? ""}
          onChange={(e) => setInstance(e.target.value ? (e.target.value as string) : null)}
          renderValue={(v) => {
            if (!v) return <Typography color="text.secondary" sx={{ fontSize: 14 }}>选择适配的实例</Typography>;
            return instances?.find((i) => i.id === v)?.name ?? "已选实例";
          }}
          aria-label="选择适配实例"
        >
          <MenuItem value="">
            <em>不对接实例（浏览全部）</em>
          </MenuItem>
          {(instances ?? []).map((i) => (
            <MenuItem key={i.id} value={i.id}>
              {i.name}
            </MenuItem>
          ))}
        </Select>
      </FormControl>

      {instanceId ? (
        <>
          {filters.loader && (
            <Chip size="small" color="primary" label={`加载器 · ${filters.loader}`} />
          )}
          {filters.mcVersion && (
            <Chip size="small" color="primary" label={`版本 · ${filters.mcVersion}`} />
          )}
          <Box sx={{ flex: 1 }} />
          <Chip size="small" label="重置过滤" variant="outlined" onClick={resetFilters} clickable />
        </>
      ) : (
        <Typography variant="caption" color="text.secondary">
          选择本地实例后，市场内容将自动适配其游戏版本与加载器
        </Typography>
      )}
    </Box>
  );
}

export function SortSelect() {
  const { sort, setSort } = marketStore();
  return (
    <FormControl size="small" sx={{ minWidth: 120 }}>
      <Select
        value={sort}
        onChange={(e) => setSort(e.target.value as MarketSortIndex)}
        aria-label="排序方式"
        renderValue={(v) => SORT_OPTIONS.find((o) => o.value === v)?.label ?? v}
      >
        {SORT_OPTIONS.map((o) => (
          <MenuItem key={o.value} value={o.value}>
            {o.label}
          </MenuItem>
        ))}
      </Select>
    </FormControl>
  );
}

export function LoaderChips({ disabled }: { disabled?: boolean }) {
  const { loader, setLoader } = marketStore();
  return (
    <Box sx={{ display: "flex", alignItems: "center", gap: 1, flexWrap: "wrap" }}>
      {LOADER_CATEGORIES.map((l) => (
        <Chip
          key={l || "auto"}
          size="small"
          label={l === "" ? "随实例" : l}
          clickable
          disabled={disabled}
          color={loader === l ? "primary" : "default"}
          onClick={() => setLoader(l)}
        />
      ))}
    </Box>
  );
}

/** Multi-select Modrinth `categories` facet, each chip togglable. */
export function CategoryChips() {
  const { categories, toggleCategory } = marketStore();
  return (
    <Box sx={{ display: "flex", alignItems: "center", gap: 0.75, flexWrap: "wrap" }}>
      {MARKET_CATEGORIES.map((c) => {
        const active = categories.includes(c.value);
        return (
          <Chip
            key={c.value}
            size="small"
            clickable
            label={c.label}
            color={active ? "primary" : "default"}
            variant={active ? "filled" : "outlined"}
            onDelete={active ? () => toggleCategory(c.value) : undefined}
            onClick={() => toggleCategory(c.value)}
          />
        );
      })}
    </Box>
  );
}

/**
 * Summarizes the active filter context as individually-removable tags, so the
 * user can see exactly what is scoping the results and drop one at a time.
 */
export function ActiveFilterChips({ type }: { type?: MarketContentType | "all" }) {
  const {
    loader,
    setLoader,
    version,
    setVersion,
    setClearVersion,
    categories,
    toggleCategory,
    sort,
    setSort,
    resetFilters,
  } = marketStore();
  const filters = useMarketFilters(type);

  const chip = (
    key: string,
    label: string,
    onDelete?: () => void,
  ): ReactNode => (
    <Chip
      key={key}
      size="small"
      color="info"
      variant={onDelete ? "filled" : "outlined"}
      label={label}
      onDelete={onDelete}
    />
  );

  const tags: ReactNode[] = [];
  if (filters.mcVersion)
    tags.push(chip("mc", `版本 · ${filters.mcVersion}`, () => {
      setClearVersion(true);
      setVersion("");
    }));
  // If filtering by loader: manual override wins; otherwise show the inherited
  // instance loader as a passive (non-removable) tag.
  if (loader !== "") tags.push(chip("loader", `加载器 · ${loader}`, () => setLoader("")));
  else if (filters.loader) tags.push(chip("loader-auto", `随实例 · ${filters.loader}`));
  for (const c of categories)
    tags.push(chip(`cat-${c}`, MARKET_CATEGORIES.find((x) => x.value === c)?.label ?? c, () => toggleCategory(c)));
  if (sort !== "relevance")
    tags.push(chip("sort", `排序 · ${SORT_OPTIONS.find((o) => o.value === sort)?.label ?? sort}`, () => setSort("relevance")));

  if (tags.length === 0) return null;
  return (
    <Box
      sx={{
        display: "flex",
        alignItems: "center",
        gap: 0.75,
        flexWrap: "wrap",
        mb: 2,
        p: 1,
        borderRadius: 1.5,
        border: "1px dashed",
        borderColor: "outlineVariant",
      }}
    >
      <Typography variant="caption" sx={{ color: "text.secondary", mr: 0.5 }}>
        当前筛选
      </Typography>
      {tags}
      <Box sx={{ flex: 1 }} />
      <Chip size="small" variant="outlined" color="error" label="清除全部" onClick={resetFilters} />
    </Box>
  );
}