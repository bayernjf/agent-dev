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

### 阶段 C：浏览器插件

优先参考 `word-picker`、`tab-manager`。范围包括 manifest、权限、浏览器兼容、本地打包、安装 smoke、商店包和商店提交清单。权限、隐私政策和商店审核必须人工批准。

退出条件：生成的插件可在本地安装，并能产生可审查的发布包。

### 阶段 D：桌面应用与移动应用

桌面端优先参考 `soft-desk`，移动端优先参考 `word-base` 的跨端需求。范围包括 Tauri/Electron、Expo/React Native 模板、平台构建、签名、版本管理、设备 smoke 和安装包证据。证书、商店账号和最终提交始终是人工步骤。

退出条件：至少一个平台完成从功能任务到可安装包的完整交付。

## 5. 选择规则

新手模式只展示产品类型和 3–5 个产品级问题，自动采用已验证模板。专业模式允许替换技术栈，但必须经过兼容性、能力和迁移校验。

当某类型尚无可验证模板时，Agent-Dev 必须明确显示“仅生成任务包/需人工交付”，不能把通用代码生成误报为完整交付。

产品类型扩展顺序由真实重复需求和交付完成率决定，优先级为：完成率 > 可靠性 > 可恢复性 > 易用性 > 覆盖范围。

## 6. 当前边界

当前代码只实现 `web-saas` Product Type。本文是后续架构和产品规划，不代表落地页、插件、桌面端或移动端已经可用。
