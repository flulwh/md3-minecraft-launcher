# Minecraft Launcher UI

Electron + React 19 + TypeScript + MUI(Material Design 3)桌面客户端，对接 `../backend` 的 Fastify 启动器后端。

## 快速开始

```bash
# 终端 1：后端（默认 http://127.0.0.1:8787）
cd ../backend && corepack pnpm dev

# 终端 2：本应用（自动拉起 Electron 窗口）
corepack pnpm dev
```

生产构建：`corepack pnpm build`，产物在 `dist/`（渲染层）与 `dist-electron/`（主进程/preload）。

## 环境与镜像

- 后端地址可用 `.env` 覆盖：`VITE_API_BASE_URL=http://127.0.0.1:8787`
- Electron 二进制走 npmmirror（见 `.npmrc`），国内网络可直接安装

## 结构

```
electron/    主进程（无边框窗口、窗口控制 IPC、shell 打开目录/外链）
src/
  theme/     Material 3 tokens：双 scheme 调色板、字体、圆角、动效
  api/       REST 层：http.ts 解包 {success,data} 信封；类型逐字对齐后端 DTO
  ws/        WebSocket 客户端：指数退避重连、心跳 ping、事件分发
  stores/    zustand：ui(主题/账户)、launch(启动状态机)、download/log/repair/toast
  hooks/     TanStack Query 封装 + WS→缓存失效映射
  design-system/  无业务原语：AppIcon/StateView/PageHeader/FormRow/ConfirmDialog…
  components/     业务组件：LaunchButton 状态机按钮、InstanceCard、LogViewer…
  layout/    TitleBar / Sidebar(NavigationRail) / StatusBar / CommandPalette(Ctrl+K)
  pages/     Home / Instances / InstanceDetail / Downloads / Accounts / Settings
```

## 与后端的对应关系

| 页面 | 数据源 |
| --- | --- |
| 首页 | `/instances` + `/accounts` + `/launch/sessions?live=1` + WS `minecraft.*` |
| 实例 | `/instances` CRUD、`/versions?type=`、`/loaders/:loader/versions?minecraft=`、`/java/*` |
| 详情 | 详情 PATCH、`/instances/:id/repair`（进度走 WS `repair.progress`）、WS 日志流 |
| 下载 | `/downloads`(stats+tasks)、`POST /downloads/:taskId/pause\|resume\|cancel`、WS `download.*` |
| 账户 | `/auth/offline`、MSA 设备码 `/auth/msa/devicecode` + `/poll`、`/accounts` 增删 |
| 设置 | `GET/PUT /settings`、Java 运行时列表与扫描 |

快捷键：`Ctrl+K` 命令面板 · `Ctrl+Enter` 启动最近实例 · `Esc` 关闭对话框。

## 说明

- Mod / 资源包 / 世界 / 截图功能已按决策砍除（后端无对应 API）。
- 主题偏好存本地（zustand persist）；其余设置经 `PUT /settings` 持久化到后端。
