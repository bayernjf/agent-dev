# 多产品类型交付方案

> 状态：规划基线
> 日期：2026-08-07

## 1. 目标

Agent-Dev 的产品对象是“可持续交付的产品”，不是某一种源码模板。Web SaaS 只是第一个已经选定的 Golden Path，用于验证 Blueprint、Policy、Runtime、Quality Gate、人工验收和 Delivery Report 这一套治理能力。

后续产品类型应复用治理层，但使用各自的模板、质量契约、平台连接器和发布流程。不同产品不能被强行归一成同一个仓库结构。

## 2. 共享层与类型层

所有产品类型共享：

- Product Blueprint、Revision 和决策边界；
- Feature Task、验收标准和人工 Approval；
- Agent Runtime Adapter；
- Git、质量门禁、Evidence 和 Delivery Report；
- 环境变量契约、Secret Boundary 和失败恢复；
- Provider Adapter 的 `discover -> plan -> apply -> verify -> detectDrift` 生命周期。

每种产品类型独立定义：

- 技术栈和项目模板；
- 本地开发命令和质量检查；
- Preview、分发或商店发布方式；
- 权限、隐私和平台审核要求；
- 必须由用户完成的 Manual Actions；
- 交付成功的外部 Evidence。

```text
Product Type
  -> Blueprint Modules
  -> Template + Quality Contract
  -> Provider/Distribution Adapters
  -> Runtime Task
  -> Type-specific Evidence
  -> Human Acceptance
```

## 3. 类型目录

| 类型 | 首选技术候选 | 关键交付证据 | 主要人工步骤 |
| --- | --- | --- | --- |
| Web SaaS | React/Vite + Hono + Supabase | Preview URL、API smoke、CI Checks | 云账号授权、Preview 验收、生产批准 |
| 落地页/内容站 | Astro 或 React/Vite + 静态托管 | Lighthouse、SEO 检查、埋点验证 | 域名、GA4/Clarity、发布批准 |
| 浏览器插件 | WXT/Plasmo + TypeScript | manifest 校验、打包产物、扩展 smoke | 权限确认、商店开发者账号、商店审核 |
| 桌面应用 | Tauri 或 Electron | macOS/Windows 构建、安装启动、签名状态 | 证书、签名、公证、分发批准 |
| 移动应用 | Expo/React Native | Android/iOS 构建、设备 smoke、商店包 | Apple/Google 账号、权限、商店提交 |
| API/内部工具 | Hono/Fastify 或既有栈 | OpenAPI、契约测试、部署健康检查 | 数据权限、域名、生产批准 |

## 4. 分阶段推进

### 阶段 A：完成 Web SaaS 闭环

当前阶段只扩展治理能力，不扩展产品类型。退出条件：真实 Codex 在隔离 workspace 中完成一个小功能；Quality Gate、Acceptance Gate 和 Delivery State 正式关联；连续三个项目完成基线，至少一个真实功能交付；并明确真实 GitHub/Preview/Provider 的降级路径。

### 阶段 B：落地页模板

选择理由：外部依赖少，能验证“按类型选择模板、质量契约和发布证据”的抽象。范围包括 `landing-page` Product Type、静态构建、Cloudflare Pages、SEO/Lighthouse、GA4/Clarity 验证器。域名和埋点仍是 Manual Action。

退出条件：非作者用户能从想法生成落地页，并完成一次 Preview 验收。

> **实现进度（2026-08-24）**：`landing-page` 已在 `packages/blueprint/src/generate.ts` 落地为真实模板引擎——`buildLandingPage` 产出 `package.json` / `scripts/build.mjs` / `src/index.html` / `src/styles.css` / `src/app.js` / `wrangler.toml` / GitHub quality 工作流，共享治理文档（PRODUCT_STANDARD / AGENTS / DELIVERY_WORKFLOW / Environment Contract / Handoff）由 `buildGovernanceArtifacts` 复用。质量门禁 `quality` 实际调用静态构建脚本并校验 `<main>` 地标。余下外部依赖（域名、GA4/Clarity 注入到部署时注入）仍为 Manual Action。

### 阶段 C：浏览器插件

优先参考 `word-picker`、`tab-manager`。范围包括 manifest、权限、浏览器兼容、本地打包、安装 smoke、商店包和商店提交清单。权限、隐私政策和商店审核必须人工批准。

退出条件：生成的插件可在本地安装，并能产生可审查的发布包。

> **实现进度（2026-08-24）**：`browser-extension` 已落地为真实模板引擎——`buildBrowserExtension` 产出 MV3 `manifest.config.ts`、Vite + `@crxjs/vite-plugin` 配置、popup/options/background/content 源码、tsconfig 与 quality 工作流。生成物已在临时目录真跑一次 `npm install && npm run quality`（`typecheck` + `vite build`），产出 `dist/manifest.json`，可 Load unpacked。商店图标（栅格 PNG）与商店提交/审核仍为人工步骤。

### 阶段 D：桌面应用与移动应用

桌面端优先参考 `soft-desk`，移动端优先参考 `word-base` 的跨端需求。范围包括 Tauri/Electron、Expo/React Native 模板、平台构建、签名、版本管理、设备 smoke 和安装包证据。证书、商店账号和最终提交始终是人工步骤。

退出条件：至少一个平台完成从功能任务到可安装包的完整交付。

> **实现进度（2026-08-24，桌面端）**：技术栈决策为**先 Tauri v2**，Electron 留作后续专业模式可选项（`soft-desk` 用的是 Electron，可作为迁移参考）。`buildDesktop` 产出 Vite/TypeScript webview（`index.html` / `src/main.ts` 通过 `invoke('app_version')` 真实走一次 IPC）、Rust 核心（`src-tauri/src/lib.rs` + `main.rs` + `build.rs` + `Cargo.toml`）、`tauri.conf.json`、占位图标生成脚本、`.gitignore`、以及带 Rust toolchain 和 Linux webview 依赖的 quality 工作流。
>
> 证据：生成物在 `/tmp/gen-check-desktop` 冷启动真跑一次 `npm install && npm run quality`（`typecheck` → `vite build` → `rust-check` = `cargo check`）全绿；并真跑 `npm run bundle` 产出 macOS `Gen Check.app` 与 `Gen Check_0.1.0_aarch64.dmg`（未签名、未公证）。生成的 GitHub 工作流已在真实 CI 执行过（见下方 2026-08-25 的记录）。签名、公证、Windows 代码签名、自动更新分发与商店提交仍是人工步骤。
>
> **实现进度（2026-08-24，补齐 Electron / 移动端 / api-tool）**：`desktop` 新增 `desktopShell: 'tauri' | 'electron'`（默认 tauri，Electron 面向需要 Node API 或已有 Electron 存量的团队）；Electron 分支产出 `electron/main.ts` + `electron/preload.ts` + Vite 渲染进程 + `electron-builder.yml`，渲染进程 `contextIsolation: true` / `nodeIntegration: false`，只能通过 preload 桥调用主进程。`mobile` 产出 Expo SDK 52 + expo-router 模板（`app/_layout.tsx` / `app/index.tsx` / `app.json` / `eas.json` / `babel.config.js`）。`api-tool` 产出 Hono on Vercel 的 API-first 单包（`/api/health` + `/api/echo`，`ALLOWED_ORIGIN` 显式白名单，无前端、不建 Cloudflare Pages）。
>
> 证据：三份生成物分别冷启动 `npm install` 后真跑自己的 `npm run quality` 全绿——api-tool `lint → typecheck → unit → build`、electron `typecheck(渲染+主进程两份 tsconfig) → build`、mobile `typecheck`（另用一行故意的类型错误确认它不是空跑）。**未做**：未启动 Electron 窗口、未跑 Expo 模拟器或 EAS Build。真跑暴露缺陷 23（渲染进程入口不是模块，`declare global` 触发 `TS2669`），修复为把桥接类型移入 `src/desktop.d.ts`。签名/公证/商店提交改为每个需打包类型产出 `generated/DISTRIBUTION.md`。
>
> **实现进度（2026-08-25，api-tool 由空壳改为 MCP server）**：原模板只有 `/api/health` + `/api/echo`，是 web-saas 去掉前端的子集，既没有真实内容也没有形态区分度。改为 MCP server 后它才有独立交付链路：`src/server.ts` 用 `registerTool` + zod `inputSchema` 注册工具，`src/index.ts` 带 shebang 走 `StdioServerTransport`，`package.json` 声明 `bin`，消费方是 MCP 客户端的配置文件而不是 URL。SDK API 形状不靠记忆——联网检索被拒（403）后改为从 registry 装 `@modelcontextprotocol/sdk@1.30.0` 实测其类型定义确认（`registerTool` 为当前 API，旧的 `tool()` 已 deprecated）。
>
> 证据：生成物冷启动 `npm install` 后 `npm run quality`（`lint → typecheck → unit(3 tests) → build`）全绿，其中单测用 `InMemoryTransport.createLinkedPair()` 连真实 `Client` 覆盖工具发现、真实调用与坏参数拒绝；再用 `StdioClientTransport` **真 spawn 一次 `node dist/index.js`**，确认 shebang 保留、`inputSchema` 正确暴露给客户端（`text,topWords`）、真实调用返回 `words: 5 / sentences: 2 / frequent: three (2), two (2)`、空 `text` 被判 `isError`，且诊断信息走 stderr 未污染 stdout 的 JSON-RPC 通道。**未做**：未在 Claude Desktop / Cursor 真实客户端里注册运行，未 `npm publish`。
>
> **实现进度（2026-08-25，七种生成物的 quality gate 在真实 Linux 上复现）**：此前所有验证都在 macOS/arm64 上做，而生成的工作流跑在 `ubuntu-latest`——这是唯一没被碰过的一条轴。改为按工作流声明的步骤（Node 22 → `npm install` → `npm run quality`）在容器里逐个复现：六类跑 `node:22-bookworm` on **linux/amd64**（与 `ubuntu-latest` 同架构），desktop-tauri 因需 Rust 工具链与 webview 依赖、amd64 模拟下 `cargo check` 代价过高，改在 linux/arm64 原生跑。
>
> 证据：七种全绿——`web-saas`、`landing-page`、`browser-extension`、`desktop-electron`、`mobile`、`api-tool` 于 linux/amd64（Node v22.23.2，`x86_64`）；`desktop-tauri` 于 linux/arm64（cargo 1.98.0，`cargo check` 冷编译 10m30s）。另单独用 `ubuntu:24.04` 容器验证 tauri 工作流的 apt 依赖清单在 `ubuntu-latest` 上仍然存在（`libwebkit2gtk-4.1-dev` / `libappindicator3-dev` / `librsvg2-dev` / `patchelf` 全部可安装——原先凭记忆以为 24.04 移除了 `libappindicator3-dev`，实测证伪）。**仍未做**：工作流本身没被 GitHub Actions 执行过，`actions/checkout@v5` / `actions/setup-node@v5` 的版本可用性、触发条件与权限仍未验证。
>
> 由此暴露两个 CI 质量问题：(1) 模板不产出 lockfile，工作流用 `npm install`，CI 的依赖版本是浮动的、不可复现（已于本日修掉，见下方「锁定安装」）；(2) tauri 工作流没有 Rust 缓存，实测冷编译 10m30s，每个 PR 都要重复付这个代价。
>
> **实现进度（2026-08-25，生成的工作流进真实 GitHub Actions）**：此前文档里"生成的工作流未在真实 CI 执行过"这句话是**陈旧的**——web-saas 早在 2026-08-23 的 `bayernjf/receipt-test` PR #1 就已经绿过，而且它的基线推送还真实失败过两次，错误正是 `Dependencies lock file is not found`（即缺陷 8），当时的修复是把 `setup-node` 的 cache 探测关掉（`cache: ''`）。其余六类从未进过 CI，现已补齐：把六份生成物逐个推入 `receipt-test` 的 `verify/generated-ci-*` 分支并开 PR（仅验证，不合并）。
>
> 证据：PR #2–#7 的 `quality` 全绿——landing-page 13s、browser-extension 23s、api-tool 42s、desktop-electron 46s、mobile 1m8s、desktop-tauri 3m45s（GitHub 的 x64 runner 比本地 arm64 容器的 10m30s 快得多）。至此 `actions/checkout@v5` / `actions/setup-node@v5` 的可用性、`pull_request` 触发与权限全部得到真实验证，七类生成物的工作流无一例外。
>
> 由此确认 lockfile 那条不是理论风险而是**已经真实咬过一次的缺陷**：`cache: ''` 压住的是症状（缓存探测要 lockfile），不是根因（模板不产出 lockfile）。方向定为交付时真跑一次 `npm install` 产出并提交 lockfile、工作流改 `npm ci`，缓存也随之可以开回来。

> **实现进度（2026-08-25，缺陷 8 从根因修掉：锁定安装）**：交付流程本来就有一步真跑 `npm install` 并把 `package-lock.json` 提交进去（`installDependencies`），但没有任何环节要求它先跑过，工作流也没利用它——所以 `cache: ''` 一直挂在那里。这次把两头接上：七类模板的 `quality.yml` 收敛成同一个 `qualityWorkflow()`（此前是七份逐字重复的 YAML，每改一次就是六次漏改机会），`npm install` → `npm ci`、`cache: ''` → `cache: npm`；`publishPullRequest` 加一条前置断言——`package-lock.json` 未被提交就拒绝推分支，理由写在错误信息里。这不是兜底而是不变量：走到开 PR 这一步的交付必然已经跑过 quality gate，也就必然装过依赖。
>
> 证据：`receipt-test` PR #8（api-tool）与 #9（landing-page）在真实 GitHub Actions 上全绿，日志确认 `cache: npm` 真的按 lockfile 哈希建了缓存（`Cache saved with the key: node-cache-Linux-x64-npm-4a59af…`）、`npm ci` 真的装了 245 个包，而不是被跳过。存储层测试新增「未提交 lockfile 时拒绝开 PR」的断言。**未做**：无。

> **实现进度（2026-08-25，tauri 工作流加 Rust 缓存）**：`desktop-tauri` 是唯一每个 PR 都要冷编译 Rust 的类型。工作流在 `dtolnay/rust-toolchain` 之后插入 `Swatinem/rust-cache@v2`，并显式给 `workspaces: src-tauri`——Cargo workspace 不在仓库根，用默认值它会去根目录找不存在的清单、什么都不缓存（这类"配了但没生效"的缓存比不配更危险，因为它看起来是绿的）。
>
> 证据：同一分支（`receipt-test` PR #10）推两次真实量出前后差。冷跑 `quality` 96s、结束时 `... Saving cache ...`；热跑 `Cache hit ... full match: true`，`quality` 降到 **6s**，整个 job 从 3m12s 降到 1m23s（缓存恢复本身花 9s）。回归测试断言模板同时含 `Swatinem/rust-cache@v2` 与 `workspaces: src-tauri`。

## 5. 选择规则

新手模式只展示产品类型和 3–5 个产品级问题，自动采用已验证模板。专业模式允许替换技术栈，但必须经过兼容性、能力和迁移校验。

当某类型尚无可验证模板时，Agent-Dev 必须明确显示“仅生成任务包/需人工交付”，不能把通用代码生成误报为完整交付。

产品类型扩展顺序由真实重复需求和交付完成率决定，优先级为：完成率 > 可靠性 > 可恢复性 > 易用性 > 覆盖范围。

## 6. 当前边界

已实现并可生成真实模板的产品类型：

- `web-saas`：React/Vite + Hono + Supabase 完整脚手架（Cloudflare Pages + Vercel）。
- `landing-page`：静态站点脚手架（Cloudflare Pages），无后端依赖；环境契约不含 Supabase/Vercel 密钥。
- `browser-extension`：MV3 + Vite/crxjs 脚手架，可本地 Load unpacked；商店图标与提交审核为人工步骤。
- `desktop`：默认 Tauri v2 脚手架（Vite webview + Rust 核心），可本地构建出安装包；专业模式可选 `desktopShell: 'electron'`，产出 main/preload/renderer 三层与 `electron-builder.yml`。
- `mobile`：Expo SDK 52 + expo-router 脚手架与 `eas.json` 构建 profile；质量闸门只做静态检查，真机/模拟器冒烟与 EAS Build 为人工步骤。
- `api-tool`：MCP（Model Context Protocol）server，通过 stdio 被 MCP 客户端当本地进程 spawn，产物是 npm 包/可执行入口——**不部署到任何 URL，不建云端项目**。这是唯一自带独立交付链路的 API-first 形态；webhook 接收器与 HTTP tool endpoint 走的仍是 web-saas 的 API workspace 那条已验证过的路，不另立形态。

六种类型都已生成真实模板，`notSupportedArtifact` 已删除。签名、公证、商店提交与证书类资产按设计保持人工：每个需要打包的类型都产出 `generated/DISTRIBUTION.md` 列出确切步骤。

每个已实现类型的 `spec.quality.required` 只声明该模板真实定义了脚本的检查项（`packages/blueprint/src/index.ts` 的 `QUALITY_CHECKS` / `qualityChecksFor()`）：多声明一项就会让生成物的 `npm run quality` 中途 `Missing script` 而永远无法通过 CI。

当某类型尚无可验证模板时，Agent-Dev 必须明确显示“仅生成任务包/需人工交付”，不能把通用代码生成误报为完整交付。
