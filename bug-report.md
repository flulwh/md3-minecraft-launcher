# md3-minecraft-launcher 问题报告（安装 / 下载 / 启动 / UI 交互）

> 审查范围：`backend/src/installation/*`、`backend/src/core/download/*`、
> `backend/src/services/{download,instance,launch}-service.ts`、
> `backend/src/api/routes/instances.ts`，以及前端
> `stores/installStore.ts`、`layout/AppShell.tsx`、
> `components/{InstallProgressPanel,LaunchButton,InstanceCard}.tsx`、
> `lib/actions.ts`。
>
> 下面每一条都给出：文件位置、具体代码路径、问题现象、根因分析、修复建议。
> 请按“严重”→“中等”→“轻微”的顺序修复，前几条是导致“体验差 / 明显 bug”的主因。

---

## 🔴 严重（数据丢失 / 状态损坏 / 崩溃风险）

### 1. 删除实例会删除存档，但确认弹窗谎称“不会删除”

- **文件**：`backend/src/services/instance-service.ts` → `delete(id)`
  ```ts
  const dir = path.join(this.config.instancesDir, id);
  await fs.promises.rm(dir, { recursive: true, force: true });
  ```
- **对照**：`frontend/src/components/InstanceCard.tsx`（删除确认框文案）
  ```
  游戏目录中的存档与文件不会被删除：
  {instance.gameDir}
  ```
- **问题**：`gameDirectory()` 返回的正是 `instancesDir/<id>/.minecraft`，是被删除目录 `instancesDir/<id>`
  的子目录。也就是说删除实例时存档、截图、resourcepacks、mods 等**全部**会被物理删除，
  与 UI 文案“不会删除”完全相反。这是会让用户**永久丢失存档**的严重 bug。
- **修复建议**：
  1. 先明确产品意图：如果本意是“只删记录，保留文件”，`delete()` 就不应该 `rm` 整个
     `instancesDir/<id>`，应该只删 DB 行（或把目录移动/重命名到一个 `trash/` 位置）。
  2. 如果本意是“连同文件一起删除”（当前实现），必须修改确认弹窗文案，明确告知“存档、
     截图、模组等所有文件将被永久删除，且不可恢复”，并让确认按钮/复选框更醒目（例如要求
     输入实例名或勾选“我知道这会删除所有存档”）。
  3. 两种意图都建议保留“仅移除启动器记录，保留文件在磁盘”的独立选项。

### 2. 删除实例前不检查“正在安装”或“正在运行”

- **文件**：`backend/src/api/routes/instances.ts`
  ```ts
  app.delete("/api/v1/instances/:id", async (req, reply) => {
    ...
    await c.instances.delete(params.id);
  });
  ```
  `frontend/src/components/InstanceCard.tsx` 的“删除实例”菜单项也没有依据
  `installStore` 或 `launchStore` 的状态禁用。
- **问题**：
  - 如果实例正在安装（`InstallationManager` 持有一个活跃 session，正在写入
    `instancesDir/<id>/.minecraft/...`），此时删除会把安装进程正在写入/校验的目录
    整个 `rm -rf` 掉，安装线程会在下一次文件系统操作上抛出 `ENOENT` 之类的异常，
    产生一堆无意义的报错日志，且 `InstallationManager` 里对应的 session 永远不会
    正常进入 `CANCELLED/FAILED`（因为没人调用 `cancel()`），导致“僵尸安装会话”。
  - 如果 Minecraft 进程正在运行（`processes.isRunning(id)` 为 true），删除会在游戏
    运行时抹掉其游戏目录，可能导致游戏崩溃或存档损坏。
- **修复建议**：在 `InstanceService.delete()`（或路由层）里，删除前调用
  `installs.isInstalling(id)` 与 `processes.isRunning(id)`（需要把这两个依赖注入到
  `InstanceService`，或把校验逻辑上移到路由 handler），如果任一为真则拒绝删除并
  返回 409，提示“请先取消安装 / 停止游戏后再删除”。同时前端 `InstanceCard` /
  `InstanceDetailPage` 应据此禁用删除按钮并给出提示。

### 3. 安装状态机不支持“暂停后恢复”的中间阶段，导致 phase 卡死在 PAUSED

- **文件**：`backend/src/installation/state.ts`
  ```ts
  const ALLOWED: Record<InstallPhase, InstallPhase[]> = {
    ...
    PAUSED: ["DOWNLOADING", "CANCELLED", "FAILED"],
    ...
  };
  ```
  `backend/src/installation/manager.ts` → `setPhase()`
  ```ts
  try {
    transition(s.phase, phase);
  } catch (err) {
    this.logger.warn(...);
    return; // 静默跳过，不更新 s.phase，也不发布正确状态
  }
  ```
- **问题**：`resume()` 只是把 `control` 设回 `"run"` 并重新调用 `run(instanceId, s)`。
  但 `run()` **每次都从头执行**：`ANALYZING → PLANNING → PREPARING → DOWNLOADING`。
  当当前 `s.phase` 还是 `PAUSED` 时：
  - `setPhase(..., "ANALYZING")`、`setPhase(..., "PLANNING")`、
    `setPhase(..., "PREPARING")` 这三次调用，因为 `ALLOWED["PAUSED"]` 里根本没有
    这些目标状态，全部被 `transition()` 判定为非法转移，被 `setPhase` **静默吞掉**——
    `s.phase` 不会更新，快照也不会正确发布。
  - 直到执行到 `setPhase(..., "DOWNLOADING")` 时（`PAUSED → DOWNLOADING` 是合法的），
    `phase` 才会恢复正常。
  - 也就是说：**点击“继续安装”之后，只要该实例带 Forge/NeoForge 等 loader（会经过
    PREPARING 阶段构建 loader），前端看到的 `phase` 会一直显示 `PAUSED`**，而
    `message` 字段却在同时被 `setStage()` 更新成“构建加载器…已用时 Ns”，
    两者互相矛盾，用户会觉得“点了继续没反应，卡住了”。
  - 更严重的连带问题：因为 `run()` 每次都会重新执行 PREPARING 阶段的
    `adapter.install(...)`（loader 构建/二进制打补丁），**每次暂停/恢复都会把
    loader 重新构建一遍**，即使这一步在本次安装里早就做完了。如果该构建不是完全
    幂等、或者比较耗时，会明显拖慢“继续安装”的体验，甚至可能因为重复打补丁
    产生冲突文件。
- **修复建议**：
  1. 给 `resume()` 增加一个专门的恢复路径：记录暂停发生时的阶段
    （本设计里暂停只会发生在 `DOWNLOADING`），恢复时应直接从 `DOWNLOADING` 继续，
    而不是重新跑一遍 `ANALYZING/PLANNING/PREPARING`。
  2. 或者至少在 `ALLOWED` 表里把 `PAUSED` 能到达的中间状态也加进去
     （`ANALYZING/PLANNING/PREPARING`），并且让 `setPhase` 对非法转移不要静默
     `return`，而是记录一次性告警并允许状态继续推进，避免 UI 拿到过期的 `phase`。
  3. loader 构建步骤应加一层“本次安装会话内是否已构建过”的标记，避免恢复时重复执行。

### 4. 暂停/恢复会把安装进度重置为 0，再“瞬间跳回”

- **文件**：`backend/src/installation/manager.ts` → `run()`
  ```ts
  const plan = s.plan ?? (await this.plans.build(instance));
  s.plan = plan;
  s.pending = new Map(
    plan.tasks.filter((t) => !t.cached && t.kind !== "LOADER").map((t) => [t.path, t.size]),
  );
  s.completedBytes = 0;   // <- 每次 run() 都会清零
  ```
- **问题**：`t.cached` 是**建立安装计划那一刻**磁盘上是否已有文件的快照，并不是
  “本次安装会话里是否已经下载完成”。恢复安装时 `run()` 会重新执行这几行，
  把 `completedBytes` 清零，并把本次会话里**已经下载完成**的文件重新塞回
  `pending`（因为它们在建计划时不是 cached）。虽然这些文件实际不会重新联网下载
  （`DownloadTask.run()` 里 `finalFileValid()` 命中会直接标记为 completed），
  但仍然会：
  - 让进度条在“继续”的一瞬间跳回接近 0%，然后再快速跳回原来的进度，观感很差；
  - 对每一个已完成文件重新做一次 `finalFileValid()`（其中包含整文件哈希校验），
    在资源/依赖文件很多的整合包上会造成明显的、不必要的 CPU/IO 开销和卡顿。
- **修复建议**：`s.pending` / `s.completedBytes` 只应在**全新安装**（`CREATED`）时
  初始化一次；恢复时应复用暂停前的 `pending`/`completedBytes`，只对确实还没完成的
  任务重新入队。

---

## 🟠 高优先级（明显影响体验，但不丢数据）

### 5. “暂停”状态下无法取消安装

- **文件**：`frontend/src/components/InstallProgressPanel.tsx`
  ```ts
  const RUNNING_PHASES: InstallPhase[] = [
    "ANALYZING","PLANNING","PREPARING","DOWNLOADING",
    "INSTALLING","FINALIZING","RETRYING","CANCELLING",
  ]; // 不包含 "PAUSED"
  ...
  {running && !TERMINAL_PHASES.includes(snap.phase) && (
    <Button ...>取消</Button>
  )}
  ```
- **问题**：取消按钮的显示条件是 `running`（即 `phase` 在 `RUNNING_PHASES` 里），
  而 `PAUSED` 不在这个列表里，所以处于暂停状态时只会渲染“继续”按钮，用户**没有
  任何入口可以取消一个已暂停的安装**，只能先恢复安装再取消，体验上很别扭；
  同时后端 `cancel()` 是明确支持取消 `paused` 任务的。
- **修复建议**：取消按钮的显示条件应改为 `phase !== "READY"` 且不在
  `TERMINAL_PHASES` 中（即 `RUNNING_PHASES` 或 `PAUSED` 都应显示取消按钮）。

### 6. 下载失败信息只报告“第一个”失败项，其余全部丢弃

- **文件**：`backend/src/services/download-service.ts` → `runBatch()`
  ```ts
  const failures = results.filter((r) => r.status !== "completed");
  if (failures.length > 0) {
    const first = failures[0]!;
    throw new Error(`${failures.length} download(s) failed; first: ${first.snapshot.dest} — ...`);
  }
  ```
- **问题**：当一个批次里（比如几百个资源文件）有多个文件真实下载失败时，
  最终只把“第一个”失败的文件名/原因抛给上层，用户在“安装失败”提示里看到的
  永远只是其中一个文件的报错，无法判断到底是网络问题、镜像问题还是某个特定
  文件源失效，也不利于排查和重试。
- **修复建议**：把所有失败项（至少前 N 个）连同各自的 `dest`/`error` 一起
  收集进错误对象（例如自定义 `BatchDownloadError`，携带 `failures: Array<{dest, error}>`），
  让 `InstallationManager.fail()` 和前端都可以展示完整列表，而不是拼接进一句
  `message` 字符串里只保留第一条。

### 7. `DownloadManager` 把“暂停被打断”和“取消”混为同一种结果状态

- **文件**：`backend/src/core/download/download-manager.ts` → `executeNow()`
  ```ts
  if (err.reason === "paused") {
    this.events.emit("task-paused", task.snapshot());
    this.resolveDeferred(task, { status: "cancelled", snapshot: task.snapshot() }); // <- 用 "cancelled" 表示暂停
  } else {
    ...
    this.resolveDeferred(task, { status: "cancelled", snapshot: task.snapshot() });
  }
  ```
  以及 `TaskOutcome` 类型定义（`core/download/types.ts` 附近）根本没有 `"paused"`
  这个可能值。
- **问题**：`TaskOutcome` 语义上只有 `completed / failed / cancelled` 三种结果，
  暂停被强行套用 `cancelled`。目前之所以“能工作”，纯粹是因为
  `InstallationManager.run()` 是靠 `s.control` 这个外部标志位去猜测“这次
  provision() 抛错到底是暂停还是取消”，而不是通过 `provision()`/`runBatch()`
  返回的结果本身去判断。这是一种脆弱的隐性耦合：只要将来有人在别的调用点
  （比如“修复”功能、批量下载 API）里调用了同一批下载接口并触发暂停，得到的
  结果会被误判为“取消/失败”，且看不出真实原因。
- **修复建议**：给 `TaskOutcome` 增加显式的 `"paused"` 状态，`runBatch`/上层调用者
  应该显式区分“因为暂停中断”与“因为取消中断”与“真的失败”，而不是依赖调用方
  自己持有的外部状态位去猜。

### 8. 并发安装多个实例时，进度事件互相“串门”，造成大量多余的 WebSocket 广播

- **文件**：`backend/src/installation/manager.ts` → `onDownloadProgress`
  ```ts
  private onDownloadProgress = (instanceId: string) => {
    let timer: ... = null;
    return () => {           // <- 完全没有用到事件本身携带的数据，也没有按 instanceId 过滤
      if (!timer) {
        timer = setTimeout(() => {
          timer = null;
          const s = this.sessions.get(instanceId);
          if (s && s.phase === "DOWNLOADING") this.publish(instanceId, s);
        }, PROGRESS_FLUSH_MS);
      }
    };
  };
  ```
- **问题**：这个监听器订阅的是 `DownloadManager` 的全局 `"progress"` 事件（所有
  实例、所有任务共用同一个 `EventEmitter`），但回调完全没有检查这次 progress
  事件到底属于哪个任务/哪个实例。结果是：只要**任意一个**实例的**任意一个**
  文件在下载，所有正在安装的实例都会各自触发一次自己的 250ms 节流发布。
  如果用户同时安装/修复多个实例（常见于导入整合包合集），WebSocket 广播量会
  随并发安装数量线性增长而不是保持恒定，容易造成前端渲染抖动、卡顿。
- **修复建议**：progress 事件里应携带 `dest`/`taskId`，`onDownloadProgress` 内部
  按 `s.pending.has(dest)` 过滤后再决定是否要发布，和 `onTaskCompleted` 保持
  同样的过滤逻辑。

### 9. 快速连续点击“启动”可能并发触发两次启动流程

- **文件**：`backend/src/services/launch-service.ts` → `launch()`
  ```ts
  if (this.processes.isRunning(instance.id)) {
    throw new LaunchError("Instance already has a running process");
  }
  // 中间隔着一长串 await（版本解析、Java 解析、下载校验、鉴权…）
  ...
  await this.processes.start({ sessionId, instanceId: instance.id, command });
  ```
- **问题**：`isRunning` 检查和真正调用 `processes.start()` 之间隔着非常多个
  `await`（版本解析、Java 解析、`provision()` 完整性校验、拿 token 等），
  在这段时间窗口内 `processes` 里还没有登记这个实例的进程。如果同一实例被
  并发触发了两次 `launch()`（例如前端某个地方没有做好防抖/禁用，或用户在
  命令面板和实例卡片上几乎同时触发），两次调用都会通过 `isRunning` 检查，
  最终可能启动两个 Minecraft 进程。虽然前端 `LaunchButton`/`startLaunch` 对
  单一按钮做了 `busyPhases` 禁用，但这只防住了“同一个按钮的重复点击”，防不住
  “多个入口（卡片菜单、详情页按钮、快捷键 Ctrl+Enter）同时触发同一个实例”的
  情况。
- **修复建议**：在 `LaunchService` 内部维护一个“正在启动中”的实例 id 集合
  （进入 `launch()` 时立即加入，无论成功失败都在 `finally` 里移除），在最开头
  就做互斥检查，而不是只依赖 `processes.isRunning()`（那个只反映“进程已经
  spawn 成功”之后的状态，覆盖不到“正在准备启动”的窗口期）。

### 10. “启动中”状态没有超时兜底，WebSocket 抖动会导致按钮永久卡死

- **文件**：`frontend/src/lib/actions.ts` → `startLaunch()`
  ```ts
  launchStore.getState().patch(instanceId, { ..., phase: "launching" });
  if (!res.sessionId && res.preflight.success) {
    setTimeout(() => { ... }, 1500); // 只在 sessionId 为空时才有兜底
  }
  ```
- **问题**：正常启动流程里 `res.sessionId` 一定不为空（预检失败会直接抛异常被
  catch 处理，dry-run 不会走这个函数），所以这段 1500ms 兜底基本是死代码，
  真正需要兜底的场景（进入 `"launching"` 之后，等待后端 `minecraft.started` /
  `minecraft.exit` WebSocket 事件，如果连接短暂断开重连、或者事件丢失）完全
  没有超时保护。一旦对应事件没有送达，`LaunchButton` 会一直显示“启动中…”
  且按钮保持禁用，用户唯一的恢复手段是刷新整个应用。
- **修复建议**：进入 `"launching"` 后设置一个合理的超时（比如 30–60 秒），
  超时后主动调用一次“查询会话状态”的 API 校正 `launchStore`，而不是完全
  依赖 WebSocket 推送。

### 11. 安装计划早于用户确认时构建，实例创建后立刻后台自启动安装，用户没有确认/选择安装源的机会

- **文件**：`backend/src/api/routes/instances.ts`
  ```ts
  app.post("/api/v1/instances", async (req, reply) => {
    const instance = await c.instances.create(body);
    try {
      c.installs.start(instance.id); // 创建实例后立即自动开始安装
    } catch (err) { ... }
    return ok(reply, instance, 201);
  });
  ```
- **问题**：`InstallationManager` 明明设计了 `plan()`（“构建安装计划但不下载”，
  供 UI 提前确认体积/文件数）这个能力，但创建实例的路由完全没有使用它，
  而是创建成功后立刻调用 `start()` 开始真正下载。如果用户是在网络不稳定、
  或者想先确认要下载的总大小/是否有加载器版本冲突的场景下创建实例，
  完全没有“确认后再下载”的环节，一旦选错版本/加载器版本，只能等安装
  失败或者手动取消，白白浪费一次下载。
- **修复建议**：`CreateInstanceDialog` 提交时先调用 `/plan` 展示预计下载体积、
  文件数，用户确认后再调用 `/install` 开始下载；或者至少在创建实例的响应里
  返回 plan 摘要，前端弹一个"是否立即开始下载"的确认。

---

## 🟡 中等 / 细节问题

### 12. `verifyLoaderClientForgeMarker` 与 `runLoaderBuildWithCancel` 用轮询代替事件，250ms 的取消响应延迟

- **文件**：`backend/src/installation/manager.ts` → `runLoaderBuildWithCancel()`
  ```ts
  const poll = setInterval(() => {
    if (s.control === "cancel") { clearInterval(poll); resolve(true); }
  }, 250);
  ```
- **问题**：用轮询而不是事件/Promise 竞速来检测取消请求，本身能工作，但意味着
  “点击取消”到“安装管理器真正感知取消”之间总有最多 250ms 的延迟，且这个
  轮询在漫长的 loader 构建期间会一直占用一个定时器；不算致命问题，但代码
  层面属于可以用 `AbortController`/事件替代的技术债，建议顺手清理。

### 13. `pause()` 在非下载阶段点击没有任何用户可见反馈

- **文件**：`backend/src/installation/manager.ts` → `yieldIfStop()`
  ```ts
  if (s.control === "pause") {
    if (s.phase === "DOWNLOADING") { ...; return false; }
    // 其他阶段：什么也不做，pause 请求被静默无视，直到真正进入 DOWNLOADING 才生效
  }
  ```
- **问题**：如果用户在 `PREPARING`（构建 loader）或 `INSTALLING`（安装依赖）
  阶段点击“暂停”，请求会被静默保留、不会有任何提示，只有等流程自然走到
  `DOWNLOADING` 阶段才会真正暂停。而前端 `InstallProgressPanel` 只有在
  `snap.phase === "DOWNLOADING"` 时才显示“暂停”按钮，所以现在这个问题
  暴露面不大；但如果以后开放了在其它阶段暂停的入口，用户点了没反应会
  很困惑。建议至少在 `stage`/`message` 里加一句“已请求暂停，将在下载阶段
  生效”。

### 14. `InstanceService.create` 里如果 `installs.start()` 抛出非预期异常，只打日志，前端拿到的实例状态可能长期停留在 `CREATED`

- **文件**：`backend/src/api/routes/instances.ts`（同第 11 条代码块）
- **问题**：`c.installs.start(instance.id)` 失败时只是 `logger.warn` + 发布
  `PROVISIONING_FAILED` 事件，而实例本身的 `status` 字段并没有被设置为
  `BROKEN`/失败态（`InstallationManager.fail()` 才会调用
  `instances.setStatus(..., "BROKEN", ...)`，但这里抛错发生在 `start()`
  同步阶段，压根没进入 `run()`，所以不会调用 `fail()`）。前端如果只看
  `instance.status` 字段判断是否需要显示“重新安装”按钮，会一直显示
  `CREATED`（对应“尚未安装”），但又没有安装记录、也不会自动重试，
  用户需要手动点一次“开始安装”才能恢复，属于隐藏的“假死”状态。
- **修复建议**：`start()` 同步抛错时也应该把实例状态标记为 `BROKEN` 并写入
  `lastError`，保持和运行时失败一致的用户可见状态。

---

## 建议修复顺序

1. 先修 **#1（删除即丢存档 + 文案说谎）** 与 **#2（删除无状态保护）**——这是
   会让用户真金白银丢失游戏进度的问题，优先级最高。
2. 再修 **#3、#4（暂停/恢复状态机 & 进度重置）**——这两条基本可以解释
   “下载安装体验很差”的直接观感（卡在 PAUSED、进度条跳变、每次续传都要重建
   loader）。
3. 然后是 **#5、#6、#7、#9、#10**，都是会被用户明显感知到的交互/健壮性问题。
4. **#8、#11–#14** 可以放在下一轮迭代里作为体验优化/技术债处理。

如果需要，我可以针对以上任意一条给出具体的代码 diff（尤其是 #1/#2/#3/#4 这几条
高危项，建议优先安排改动）。
