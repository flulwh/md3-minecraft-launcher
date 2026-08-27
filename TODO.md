# TODO

## Forge 安装问题修复

### 问题描述
Forge 版本只能创建实例，无法触发下载，文件是空的。

### 原因分析
1. Forge installer 的 `--installClient` 模式直接从 Mojang 服务器下载文件
2. 在中国网络环境下，Mojang 服务器经常无法访问
3. 安装器失败后创建空文件/存根文件
4. `validate()` 方法只检查文件是否存在，不检查内容是否有效

### 修复方案
1. 当 `--installClient` 失败时，回退到解析 installer JAR (zip) 方式
2. 从 zip 中提取 `version.json` 和 `install_profile.json`
3. 直接保存 version JSON，让 repair 管线通过镜像系统下载库文件
4. 添加更严格的验证，确保 version JSON 有效

### 已完成
- [x] 实现 `installViaZipExtraction()` 回退方法
- [x] 安装 `adm-zip` 依赖
- [x] 增强 `validate()` 方法验证 version JSON 内容

### 待完成
- [ ] 运行 `npx prisma generate` 解决 Prisma 类型错误
- [ ] 修复 TypeScript 编译错误 (authentication-service.ts, content-service.ts 等)
- [ ] 运行测试验证修复
- [ ] 测试 Forge 安装流程

### 相关文件
- `backend/src/core/loaders/installer-adapters.ts` - Forge/NeoForge 安装适配器
- `backend/src/core/version/version-metadata-store.ts` - 版本 JSON 验证
- `backend/src/core/libraries/library-resolver.ts` - 库文件解析
- `backend/src/services/repair-service.ts` - 修复/下载管线

### 参考文档
https://zh.minecraft.wiki/w/Tutorial:%E7%BC%96%E5%86%99%E5%90%AF%E5%8A%A8%E5%99%A8#%E6%94%AF%E6%8C%81Mod%E5%8A%A0%E8%BD%BD%E5%99%A8
