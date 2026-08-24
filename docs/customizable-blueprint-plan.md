# Blueprint 可定制化方案：让用户真正可选 Agent / 部署平台 / 产品形态

> 起草时间：2026-08-24
> 状态：方案，待评审
> 触发：用户对定制化能力的需求 —— "专业用户能选埋点、Agent、部署平台，流水线式出 MVP"

## 0. 目标与边界

**目标**：把当前 Blueprint 里写死的 `runtime` / `deployment` / `product.type` 三块扩展为可选项，让专业用户在 Studio 配置面板里直接挑，并由 Blueprint 生成器按选择产出对应的模板、Manual Action 和交付工作流。

**不做什么**：
- 不重写 Blueprint 决策模型（沿用现有 `mode: beginner|professional` + `Decision.mode: auto|ask|manual`）。
- 不展开 multi-product 阶段 B-D 的模板（落地页/插件/桌面/移动端形态枚举化即可，实际模板留待后续阶段）。
- 不改 Runtime Adapter 内部实现（`AGENT_ADAPTERS` 已存在，本方案只把它接到 Blueprint 表面）。

## 1. 现状盘点（避免方案脱离代码）

已查证：
- `packages/agent-runtime/src/index.ts` 的 `AGENT_ADAPTERS` 已有 6 个 Adapter：
  - `codex`（verified）、`claude-code`（candidate）、`aider`（candidate）、`opencode`（verified）、`openclaw`（candidate）、`codebuddy`（verified）。
  - 选择机制已存在：`buildAgentExecutionPlan(task, ws, agentId, ...)` 按 `agentId` 走对应 Adapter，未验证的 Adapter 拒绝 `execute`（仅允许 `dry-run`）。
  - **所以任务 1 的活儿不是写新 Adapter，而是把选择权从 daemon 内部上移到 Blueprint Schema。**
- `packages/blueprint/src/index.ts` 写死的字段：
  - `runtime: { provider: z.literal('local-codex') }`
  - `deployment.web.provider: z.literal('cloudflare-pages')`
  - `deployment.api.provider: z.literal('vercel-functions')`
  - `product.type: z.literal('web-saas')`
  - `stack.frontend: z.literal('react-vite')`
  - `stack.api: z.literal('hono')`
- `packages/blueprint/src/generate.ts` 的产物是 22 个 `GeneratedArtifact`：
  - 模板字段如 `template-cloudflare`、`template-api-vercel`、`template-api-index`、`template-api-test`、`template-api-package` 都是按当前默认组合写死内容。
  - `product-standard.md` / `delivery-workflow.md` / `agent-instructions.md` 也硬编码了 "Vercel Functions / Cloudflare Pages / Codex"。
- `analytics.providers: z.enum(['ga4','clarity'])` —— **已有，问卷已包含**。

## 2. 总体策略

按决策树模型扩展，不重写：
1. **Schema 枚举化**：把字面量扩为 `z.enum([...])`，保留 `v1alpha1` 兼容性。
2. **生成器条件化**：把硬编码文件改成"按 provider 选模板内容"，组合校验由 Schema guard 兜底。
3. **问卷与 Studio 面板**：把 `mode='professional'` 的 Decision 暴露为可选项；beginner 模式自动选默认（保持向后兼容）。
4. **真实云端验证**：每加一种 provider 组合，必须跑一次真实 Preview 端到端，不靠"声明即支持"。

## 3. 任务 1：Runtime 可选（最易、ROI 最高）

### 3.1 Schema 改动（`packages/blueprint/src/index.ts`）

```ts
// 改前
runtime: z.object({ provider: z.literal('local-codex') })

// 改后
runtime: z.object({
  provider: z.enum([
    'local-codex',
    'local-opencode',
    'local-claude',
    'local-aider',
    'local-codebuddy',
    'local-openclaw',
  ]),
})
```

迁移策略：为 `v1alpha1` 旧 Blueprint 保留字面量兼容（用 `z.union([z.literal('local-codex'), z.enum([...])])`，或在迁移函数里把 `'local-codex'` 视作合法值）。

### 3.2 问卷与决策

- 新增 `runtimeProvider: BlueprintAnswers['runtimeProvider']`，初值 `'local-codex'`。
- 对应 Decision：`id='runtime'`, `mode='auto'`（beginner 保持 codex 默认）/ `mode='ask'`（professional 问）。
- **关键守门**：选项必须是 `getAgentAdapterStatus(id) !== 'unsupported'`（即在 `AGENT_ADAPTERS` 中存在），且默认推荐 `status === 'verified'` 的 Adapter（`codex`、`opencode`、`codebuddy`）。`claude-code`/`aider`/`openclaw` 在状态升到 `verified` 之前，专业用户可看见但仅能选 dry-run（与 Runtime 现有契约一致：未验证的 Adapter 执行阶段直接抛错）。

### 3.3 Generator 改动（`generate.ts`）

- `product-standard.md` 段：`- Frontend: ${frontendLabel}`、`- API: ${apiLabel}` 后面增加 `- Runtime: ${blueprint.spec.runtime.provider}`。
- `agent-instructions.md`：把硬编码 "Use Codex in this task workspace" 改为引用 `blueprint.spec.runtime.provider`，并保留 v0.1 已验证的危险路径清单（`.env`、`.git/config`、`production secrets` 等与 Runtime 无关）。
- `delivery-workflow.md`：第 2 步起引用 `${provider}` 的本地命令模板（如 `codex exec --json ...`、`opencode ...`、`claude -p ...`），由 Adapter 自身负责命令构造，Blueprint 写"Runtime adapter uses AGENT_ADAPTERS registry"。
- Quality contract 与 Runtime 解耦，保持不变。

### 3.4 Apply 链路

- `apply_runs.runtime_provider` 字段新增（daemon 端），存储 Blueprint 选定的 provider。
- `agent-runtime` 现有 `buildAgentExecutionPlan(task, ws, agentId, ...)` 直接用，不需要新代码。
- 唯一新增：daemon 在创建 task plan 时校验 `isAgentExecutable(provider)`，未验证的 provider 在 plan 阶段标红但仍允许 dry-run。

### 3.5 Studio 与 e2e

- Studio：在 Professional Mode 新增"Runtime"卡片，列出本机探测到的 Adapter 及其状态（verified/candidate）。
- 真实验证：用 `local-opencode` 跑一个项目全周期（已实测，v0.1 项目 3 即走 opencode，可作为对照组）；再用 `local-claude` 跑一次全周期，把 `claude-code` adapter 从 candidate 升到 verified（**顺便兑现 v0.2 P0-1**）。

## 4. 任务 2：部署平台可组合（工作量最大）

这是三件事里最重的一块。Generator 现在按 `template-cloudflare` / `template-api-vercel` 等写死文件，需要改成"按组合选模板"。

### 4.1 Schema 改动

```ts
deployment: z.object({
  web: z.object({
    provider: z.enum(['cloudflare-pages', 'vercel-static']).default('cloudflare-pages'),
    account: z.string().max(120).default(''),
  }),
  api: z.object({
    provider: z.enum(['vercel-functions', 'cloudflare-workers', 'none']).default('vercel-functions'),
    team: z.string().max(120).default(''),
  }),
  previewStrategy: z.enum(['per-pull-request', 'stable-dev-api']).default('per-pull-request'),
})
```

### 4.2 组合矩阵（共 6 种，落地目标 4 种）

| 编号 | web | api | 是否在 v0.1 验过 | Generator 动作 |
| --- | --- | --- | --- | --- |
| C1 | cloudflare-pages | vercel-functions | ✅（现状默认） | 不变 |
| C2 | vercel-static | vercel-functions | ⬜ 新 | 都用 Vercel，Composer 跨 project 验证 |
| C3 | cloudflare-pages | cloudflare-workers | ⬜ 新 | 都用 Cloudflare，Composer Pages→Workers |
| C4 | cloudflare-pages | none | ⬜ 新 | 跳过所有 api 模板，product-standard 改 "static site" |
| C5 | vercel-static | none | ⬜ 新 | 同上，仅前端 |
| C6 | vercel-static | cloudflare-workers | ⬜ 新 | 跨平台组合，文档说明 "非典型" |

C2、C3 是高价值新组合（C1 的两个同质替代）。C4、C5 是"无后端 MVP"场景。C6 留给后续。

### 4.3 Generator 重构

引入"模板按 provider 分组"机制：

```ts
const TEMPLATES_BY_PROVIDER = {
  web: {
    'cloudflare-pages': [/* wrangler.toml, CF Pages 配置 */],
    'vercel-static':   [/* vercel.json web 段, build 输出目录 */],
  },
  api: {
    'vercel-functions':   [/* apps/api/**, vercel.json api 段 */],
    'cloudflare-workers': [/* apps/api/wrangler.toml, worker 入口 */],
    'none':               [], // 跳过 api 模板
  },
};
```

具体产物规则：
- `template-cloudflare`（v0.1 wrangler.toml）只在 web=cloudflare-pages 或 api=cloudflare-workers 时产出（且分两份：`web/wrangler.toml` 与 `api/wrangler.toml`）。
- `template-api-vercel`（apps/api/vercel.json）只在 api=vercel-functions 时产出。
- `template-api-index/test/package` 等只在 api != none 时产出。
- web=vercel-static 时产出 `apps/web/vercel.json`；web=cloudflare-pages 时产出 `wrangler.toml`。
- `product-standard.md` / `delivery-workflow.md` 按组合动态渲染步骤（如"全 Vercel"少一步 Cloudflare 部署）。

### 4.4 Composer 改动

`packages/deployment-composer` 现状编排严格按 "Vercel API → Cloudflare Pages → 联合 Smoke"，需改造为：
- 步骤集合按 `deployment.{web,api}.provider` 动态选。
- "联合 Smoke" 语义按组合：C1 跨平台；C2 同 Vercel project 内；C3 跨 Pages/Workers（同一 Cloudflare account）；C4/C5 跳过 Smoke。
- Idempotency key 需纳入 `provider` 哈希，避免不同组合互相串。

### 4.5 真实验证（不可省）

- C2：拿一个新项目用 "全 Vercel" 跑 Preview 端到端。
- C3：拿一个新项目用 "全 Cloudflare" 跑 Preview 端到端。
- C4：拿一个 landing page 类项目跑无后端 MVP。
- Composer 每种组合至少 1 个端到端测试（不是单元测试，是真实 Preview）。

### 4.6 风险

- **账号/团队字段语义**：web=cloudflare-pages 用 `account`；web=vercel-static 用 `team`（与 api 共用）。需要 schema guard：web=vercel-static 且 api=vercel-functions 时 `team` 字段被两边共享。
- **Manual Actions**：不同组合的账号授权步骤不同（Cloudflare Pages vs Vercel Static 的权限边界），需为每组合单独生成。
- **质量契约差异**：某些组合对构建/环境变量的要求不同，初版可保持不变（如需调整，先列清单再迭代）。

## 5. 任务 3：产品形态（枚举化，本阶段不展开模板）—— ✅ 已实现

### 5.1 Schema 改动

```ts
productTypeSchema = z.enum(['web-saas', 'landing-page', 'browser-extension', 'desktop', 'mobile', 'api-tool'])
```
新增 `answers.productType`（默认 `'web-saas'`），`createBlueprint` 透传到 `spec.product.type`，向后兼容 v0.1 Golden Path。

### 5.2 Generator 守门（已实现）

- `web-saas`：现有 22 个模板全产（保持 v0.1 兼容）。
- 其他形态：Generator 不抛错，而是返回**单一 `generated/DELIVERY_HANDOFF.md` 任务包**（含 roadmap 阶段、明确"Agent-Dev 不为该形态生成代码，需人工交付"），与 `multi-product-delivery-plan.md` 的边界一致。不假装交付。
- 测试覆盖：`web-saas` 仍产出完整脚手架；5 种非 web-saas 类型各自返回恰好 1 个 handoff artifact 且不含任何 Web 文件。

### 5.3 Studio 卡片（已实现）

- Blueprint 表单新增产品形态单选组（对所有模式可见），未支持的形态在表单中明确提示"当前仅 Web SaaS 提供自动模板"。

## 6. 落地顺序与里程碑

| 里程碑 | 内容 | 验收 | 工作量 |
| --- | --- | --- | --- |
| M1 | 任务 1：Runtime 可选 | Schema 测试 + Generator 引用替换 + 用 `local-opencode` 与 `local-claude` 各跑一个真实项目（同时把 claude-code 升 verified） | 1-2 天 |
| M2 | 任务 2：部署平台可组合 | Generator 重构为模板表 + 组合校验 + C2/C3/C4 各跑一次真实 Preview | 3-5 天 |
| M3 | 任务 3：产品形态枚举化 | Schema enum + 未支持形态降级到任务包提示 | 0.5 天 |
| M4 | Studio 统一配置面板 | 把 Runtime / 部署 / 形态整合到 Professional Mode 同一面板，实时反映在 Blueprint 摘要 | 1 天 |
| M5 | 文档与示例 | 至少 1 个 Blueprint 预设（preset）示例 + 用户文档 | 0.5 天 |

总计：~7-10 天连续工作。

## 7. 验收标准

1. **Schema 测试**：3 个枚举字段的所有合法值组合都通过校验；v0.1 三个真实项目的 Blueprint（web-saas + codex + C1）解析后产物与现状 1:1 一致（向后兼容）。
2. **Generator 测试**：C1/C2/C3/C4 各跑一次生成，文件清单、Manual Actions、delivery-workflow 步骤与预期一致。
3. **真实云端验证**：M1 至少 2 个项目跑通不同 Runtime；M2 至少 3 个新组合的真实 Preview 端到端。
4. **Studio 体验**：Professional Mode 在同一面板可改 Runtime / 部署 / 形态 / 埋点，Blueprint 摘要实时更新。
5. **未支持形态**：选 `landing-page` / `desktop` 等时给出明确"任务包/需人工交付"提示，不假装交付。

## 8. 与现有架构的衔接

- **决策模型不变**：沿用 `mode: beginner|professional` + `Decision.mode: auto|ask|manual`，不引入新概念。
- **状态机不变**：本方案不触碰 `delivery-machine`，所有改动在 Schema/Generator/Studio 层。
- **Adapter 系统不变**：`AGENT_ADAPTERS` 已是 registry，本方案只暴露它。
- **隐私边界不变**：用户填的 `cloudflareAccount` / `vercelTeam` / `githubOwner` 与现状一致，由用户自己持有，不上传。

## 9. 不在本次方案内（明确划界）

- multi-product 阶段 B-D 的具体模板（落地页/插件/桌面/移动）。
- 流水线级吞吐能力中的"自动化节拍/并发队列/预设化"（v0.2 P0 议题），可在本方案落地后另开。
- 失败分类与可读修复建议（v0.2 P0-3）。
- 一键安装包（v0.2 P0-2）。