# Product Blueprint 规范

> 状态：Conceptual Schema v0.1  
> 目的：定义 Agent-Dev 中规范、问卷、候选项、覆盖和生成物的单一事实源。

## 1. 基本原则

Markdown 是给人和 Agent 阅读的生成物，不是可执行事实源。Agent-Dev 必须从结构化 Product Blueprint 生成规范文档、环境变量契约、模板参数、Policy 和交付流程。

```text
Template Defaults
  -> Organization Policy（未来）
  -> Project Answers
  -> Environment Overrides
  -> Resolved Blueprint
  -> Validation / Plan / Generated Artifacts
```

每一层只表达覆盖项；Resolved Blueprint 必须记录每个最终值来自哪一层。

## 2. 文件角色

| 文件 | 角色 | 是否手工编辑 |
| --- | --- | --- |
| `agent-dev.yaml` | 项目规范事实源 | 专业模式可以 |
| `agent-dev.lock.yaml` | 模块、模板和 Adapter 版本锁定 | 否 |
| `config/env.contract.yaml` | 环境变量名称、分类、来源和目标 | 受控编辑 |
| `generated/PRODUCT_STANDARD.md` | 人类可读规范 | 否 |
| `generated/AGENTS.md` | Agent 执行约束 | 否 |
| `generated/DELIVERY_WORKFLOW.md` | 交付和 Gate 说明 | 否 |
| `docs/adr/*.md` | 人工覆盖和架构决策 | 是 |

生成文件必须带有来源版本和“请勿直接修改”标识。用户在 UI 中修改答案后重新生成，避免 Markdown 与执行状态漂移。

## 3. 模块模型

规范由可组合模块构成。首版内置：

- `product`：产品类型、目标用户和数据敏感度；
- `source-control`：GitHub、分支、PR 和 Ruleset；
- `frontend`：React/Vite；
- `api`：Hono/Vercel Functions；
- `data`：Supabase Database/Auth；
- `deployment-web`：Cloudflare Pages；
- `deployment-api`：Vercel；
- `quality`：lint、typecheck、unit、build、smoke；
- `analytics`：首版仅生成 none/GA4/Clarity/both 的接入计划；
- `delivery`：Preview、人工验收、生产 Gate 和报告；
- `agent-runtime`：Local Codex。

一个模块至少包含：

```yaml
id: deployment-web
version: 0.1.0
title: 页面托管
questions: []
defaults: {}
constraints: []
outputs:
  blueprintPaths: []
  envContract: []
  generatedFiles: []
actions: []
migrations: []
```

## 4. 问题模型

```yaml
id: analytics.providers
title: 是否收集产品使用数据
type: multi-select
required: true
default: []
options:
  - value: ga4
    title: GA4
    impact: 跨渠道分析，需要 Google 授权和隐私说明
  - value: clarity
    title: Clarity
    impact: 会话和热图分析，需要用户数据告知
allowCustom: true
customSchema:
  providerName: string
  projectIdVariable: string
  verificationMethod: string
risk: privacy
approval: required
```

每个问题需要提供：推荐答案、适用场景、成本/隐私/迁移影响、依赖条件和验证方式。不能只提供一个无上下文下拉框。

## 5. 自定义答案

“自定义”不能只保存自然语言。至少包含：

- 机器可识别的类型和值；
- 用户说明；
- 负责人；
- 所需环境变量；
- 验证命令或人工验证方式；
- 风险和审批要求；
- 不受 Agent-Dev 支持的能力声明。

无法自动执行的自定义答案可以进入 Blueprint，但必须生成 `Manual Action`，并将自动化级别标记为 `manual` 或 `assisted`。

## 6. 首版 Blueprint 示例

```yaml
apiVersion: agent-dev.io/v1alpha1
kind: ProductBlueprint
metadata:
  name: example-product
  revision: 1
spec:
  product:
    type: web-app
    dataSensitivity: standard
  stack:
    frontend: react-vite
    api: hono
    packageManager: npm
  sourceControl:
    provider: github
    integrationBranch: dev
    productionBranch: main
    requirePullRequest: true
  data:
    provider: supabase
    auth: supabase-auth
  deployment:
    web:
      provider: cloudflare-pages
    api:
      provider: vercel-functions
    previewStrategy: per-pull-request
  analytics:
    providers: []
  runtime:
    provider: local-codex
  policy:
    productionApproval: required
    maxAutomaticFixAttempts: 2
    secretChangesRequireApproval: true
  quality:
    required:
      - lint
      - typecheck
      - unit
      - build
      - smoke
```

## 7. 校验层级

1. **Schema 校验**：字段、类型、枚举和必填项；
2. **模块校验**：单个选择是否满足模块要求；
3. **兼容性校验**：跨模块组合是否成立；
4. **能力校验**：当前 Adapter 是否真正支持该配置；
5. **Policy 校验**：是否触发人工 Gate；
6. **环境校验**：用户账号、套餐、权限和区域是否满足；
7. **运行验证**：Apply 后从外部平台读取事实确认结果。

例如选择 Cloudflare Pages + Vercel API 时，兼容性校验必须要求 API URL 注入、CORS、Auth Redirect 和联合冒烟测试，不能只验证两个 provider 名称合法。

## 8. 新手与专业模式

### 新手模式

- 先选择产品模板；
- 展示 3–5 个产品级关键问题；
- 使用模板默认值填充工程细节；
- 仅在阻塞或高风险时显示额外问题；
- 最终显示“你将得到什么”，而不是 YAML。

### 专业模式

- 显示所有模块和覆盖来源；
- 支持 YAML 与表单双向编辑；
- 显示模块依赖、配置 Diff 和生成物；
- 允许新增自定义模块和验证器；
- 不允许跳过不可覆盖的组织 Policy。

## 9. 版本与切换

规范修改流程：

```text
复制当前 Revision
-> 修改答案
-> Schema/兼容性/能力校验
-> 生成 Plan 与资源 Diff
-> 标记迁移、费用、数据和停机风险
-> 人工批准
-> Apply
-> Verify
-> 新 Revision Active
```

旧 Revision 在新版本验证成功前保持 Active。涉及数据库、认证、域名或生产环境的变更必须提供迁移/回滚计划；缺少实现时只能进入 Manual Action，不能伪装成一键切换。

## 10. 生成物

Resolved Blueprint 可以生成：

- 产品规范和技术栈说明；
- `AGENTS.md` 或其受控片段；
- Quality Contract；
- GitHub PR/Issue 模板；
- GitHub Actions 参数；
- Env Contract；
- Provider Plan；
- Manual Actions；
- ADR 草稿；
- Delivery Report 骨架。

每个生成物必须记录 Blueprint Revision、生成器版本和输入哈希，便于检测用户手工修改和配置漂移。
