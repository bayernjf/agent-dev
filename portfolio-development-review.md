# 现有项目组合开发流程复盘

> 复盘日期：2026-08-01
>
> 范围：只读检查 `bayjf`、`word-picker`、`word-base`、`soft-desk`、`pr-helper`、`tab-manager` 的本地仓库状态、`AGENTS.md`、交接文档、`package.json` 和 GitHub Actions。本文及其引用的 SOP 是唯一新增产物，均位于 `agent-dev`。GitHub 远端的 rulesets、分支保护、Environment 审批和 PR 实际状态未在本地可见，不能从仓库文件推断为已开启。

## 结论

现有项目已经具备比“AI 只写代码”更成熟的基础：六个仓库都有 Agent 指令与 CI，主要项目拥有交接文档、发布 workflow、单测，`tab-manager` 已引入 Spec Kit skills，`pr-helper` 已经在产品层实现 PR / 部署控制台。

目前的主要瓶颈不是缺少另一个技术脚手架，而是**同一流程在不同文件中有相互冲突的授权语义，且 GitHub 的强制门禁没有被本地证据确认**。优先统一治理规则与验证契约，再抽取平台 starter，能最快减少 feature 到 dev、dev 到 main 的返工。

## 1. 项目资产快照

| 项目 | 产品与技术形态 | 现有质量 / 发布资产 | 可复用价值 |
| --- | --- | --- | --- |
| `bayjf` | React + TypeScript + Vite；Hono/Vercel API；Cloudflare Pages | CI、双部署 workflow、手动 E2E、完整 `PULL_REQUEST_WORKFLOW.md` | 最清晰的双环境 PR、Preview、生产验收与失败修复闭环 |
| `word-picker` | Manifest V3 浏览器扩展；TypeScript；Chrome/Edge/Safari | CI、Release、Vitest、Playwright、`handoff.md` | 多浏览器构建、快照 release、扩展包交付 |
| `word-base` | npm workspaces；Web、Tauri 桌面、Expo 移动、API | CI、Web deploy、桌面 release、移动 OTA、rollback、交接与就绪度文档 | 多端质量矩阵、版本注入、平台发布差异 |
| `soft-desk` | Electron + Vite + TypeScript；macOS / Windows | CI、双端安装包 workflow、Release、迁移交接 | 桌面打包、签名与平台发行风险管理 |
| `pr-helper` | GitHub App + Vercel API + Supabase 的 PR / Release Control Tower | CI、双前端部署、回滚、reconciliation | 用 GitHub 真实状态驱动 Agent 任务、部署和审计报告 |
| `tab-manager` | 浏览器扩展；TypeScript | CI、Release、Vitest、Playwright、完整交接、Spec Kit skills | 最适合作为 Spec Kit 与 Agent Skills 的流程试点 |

所有项目均使用 npm 与 TypeScript 主栈，具备共享基础；但单体 Web、浏览器扩展、桌面应用及多端 monorepo 的构建、测试、预览和商店发布无法用同一套源码模板处理。

## 2. 已确认的共同能力与缺口

| 能力 | 观察结果 | 复盘判断 |
| --- | --- | --- |
| Agent 项目说明 | 六个项目都有 `AGENTS.md` | 已形成实践，但规则内容和授权级别不一致 |
| CI | 六个项目均有 `.github/workflows/ci.yml` | 已有基础门禁，但 required status checks 是否远端启用未确认 |
| 发布链路 | 每个项目都有 release 或 deploy workflow | 平台差异已分离，这是正确方向 |
| 交接 / 就绪资料 | 除 `pr-helper` 外均发现 handoff 或 readiness 文档；`pr-helper` 以 `docs/current-state.md` 为当前状态源 | 有文档意识，格式需要统一为验收证据 |
| 明确 PR 流程文件 | `bayjf`、`tab-manager` 有独立 `PULL_REQUEST_WORKFLOW.md` | 这类文件应抽成治理模板，而不是只放在个别仓库 |
| Spec 驱动能力 | `tab-manager` 有 `.agents/skills/speckit-*` 与 `.claude/skills/speckit-*` | 已有可验证试点，不需从零安装流程概念 |
| CodeGraph | 只在 `pr-helper`、`tab-manager` 发现 `.codegraph/` | 可作为大型或复杂仓库的定位加速器，不应成为所有 starter 的硬依赖 |

## 3. 关键发现与处理优先级

### P0：用 GitHub 配置而非 Agent 文本强制门禁

本地 `AGENTS.md` 能影响 Claude、Codex、TRAE 的行为，却不能阻止直接 push、跳过 review、绕过 check 或使用错误的 production Secret。以下项目证据只证明 workflow 存在，不证明它们是 required checks：

- 每个仓库的 CI workflow 均在 PR 或 `dev` / `main` push 上运行；
- 多个部署 workflow 也直接由 `dev` / `main` push 触发；
- GitHub rulesets、Branch protection、Environment required reviewers 和 CODEOWNERS 属于远端仓库设置，未写入这些本地仓库。

**处理：**为六仓库建立相同的远端基线：禁止直接 push 到 `dev` / `main`，要求 PR、`quality` check、至少一个人工 review；production Environment 设置人工批准与独立 Secrets；`.github/workflows/**`、数据库迁移与发布配置使用 CODEOWNERS。完成后把 Ruleset URL 或截图记录在各仓库 `docs/delivery/`，使交接报告可审计。

### P0：消除“创建 PR 后在本地合并”的绕过路径

`word-picker`、`word-base`、`soft-desk` 的 `AGENTS.md` 中，“提交代码并合并到 dev”都包含“`gh pr create` 后 checkout `dev`、本地 merge、push `dev`”的步骤。这会让 PR 只是记录，不保证 PR checks 或 review 真正通过后才进入 `dev`。

`tab-manager` 同时存在两套表述：其 `PULL_REQUEST_WORKFLOW.md` 要求真实 GitHub PR、等待 checks 并在 GitHub 合并；`AGENTS.md` 的快捷指令仍描述本地 merge。前者已声明为最高优先级，但冲突文本会使不同 Agent 采取不同路径。

**处理：**统一改为“创建 PR -> 等待 required checks -> 获得所需 review -> 使用 GitHub merge queue 或 `gh pr merge` 合并 -> 等待目标分支 post-merge workflow”。若希望 `dev` 低风险自动合并，也应在 GitHub 中启用 auto-merge / merge queue，并保留 checks，而不是本地 `git push dev`。生产分支继续人工批准。

### P1：将 CI 与部署从并发触发改为可证明的阶段依赖

目前多个仓库的 CI 和 deploy workflow 都由相同的 `push` 事件触发。单独 workflow 无法天然表达“CI 成功后才部署”；两者可能并发执行。BayJF 的流程文档已经要求先等待 CI 和 Preview/Production，但 workflow 触发方式本身不能提供这个顺序保证。

**处理：**每个端保留一条由 PR 触发的 `quality` workflow；部署 job 通过同一 workflow 的 `needs: quality`，或通过受控的 `workflow_call` reusable workflow 触发。部署后使用 `verify-deployment` job 运行健康检查和必要的 Playwright / 平台冒烟测试。不要让部署 workflow 提交代码、移动分支或自行修复失败。

### P1：Feature 分支长期存活，应量化并设置服务等级目标

本地快照中，feature 相对本地 `dev` 的提交差异分别为：BayJF 28、WordPicker 56、WordBase 71、SoftDesk 20、Tab Manager 156；`pr-helper` 本地没有 `dev` 分支，但存在 `origin/dev`。这些数字不是质量结论，因为可能含合并历史或远端未拉取状态；它们仍说明至少应把“分支陈旧度”和“与 dev 的差异”放进发布前检查。

**处理：**约定 feature 每日开始时 `fetch --prune` 并检查 `merge-base`，超过 5 个工作日或超过既定差异阈值时，Agent 自动输出“同步建议 + 冲突风险”，由人工决定 rebase / merge / 拆分 PR。不要把长期 feature 作为永久集成分支。

### P1：标准化质量契约，而不是强制一条 npm 命令

现有命令名称与含义不一致：BayJF 的 `lint` 是 TypeScript 检查，PR Helper 的 `lint` 是 production build，Tab Manager 的 `test` 会先 build，WordBase 需要跨四个 workspace 验证。这反映产品差异，不是错误；错误在于 Agent 和 CI 可能各自猜测“完成验证”意味着什么。

**处理：**每个仓库维护相同格式的 `config/quality-contract.yml`，声明该平台的 `typecheck`、`lint`、`unit`、`integration`、`e2e`、`build`、`manual`、`release` 命令及何时必跑。`AGENTS.md`、PR 模板和 CI 均引用同一契约，避免复制命令后漂移。

### P2：把交接文档从“状态说明”变成“发布证据”

现有 `word-base`、`tab-manager` 与 `word-picker` 的交接文档已经包含测试结果、架构、已知限制和下一步；这是值得保留的资产。统一格式还应加上需求/验收标准对齐、PR 和 commit、Preview/Production URL、人工验证人和时间、CI run、回滚方式、未验证项及风险等级。

**处理：**使用 SOP 的交付报告模板，将文件保存为 `docs/delivery/<issue>-<slug>.md`。项目级 `handoff.md` 只保留长期架构和当前状态；单功能交付报告不反复覆盖它。

## 4. 推荐的目标状态

```text
人工：目标、范围、验收标准、风险/成本/生产决策、最终体验验收
  -> Agent：规格 -> 计划 -> 任务 -> feature 实现 -> 本地验证 -> PR 与审查报告
  -> GitHub：ruleset + required checks + review + Environment approval
  -> Agent：读取 CI / 部署证据，修复同一 PR，生成交付报告
  -> 人工：dev Preview 验收、production 批准与验收
```

`pr-helper` 适合作为后续自动化编排层：读取 GitHub PR、checks、deployment 与 rollback 的真实状态，生成待处理工作和报告。但它不是门禁的替代品，必须服从 GitHub branch protection 与 Environment 保护。生产 merge、生产发布和回滚均保持显式人工动作。

## 5. 治理模板与平台预设的边界

建议创建一个新仓库 `product-governance-template`，并从本目录的 [AI Agent 全周期开发 SOP](ai-agent-development-sop.md) 复制治理资产：

```text
product-governance-template/
├── AGENTS.md
├── config/quality-contract.yml
├── docs/{product,adr,delivery}/
├── templates/{feature,pr,delivery}.md
└── .github/{PULL_REQUEST_TEMPLATE.md,workflows/quality.yml}
```

再分别维护 `web-vite`、`extension-webextension`、`desktop-electron`、`desktop-tauri`、`mobile-expo` 预设。平台预设只带构建、测试、发布和权限清单，不复制业务架构。`word-base` 的多端 workspace 结构应作为“多端产品”预设的参考，而不是所有项目的默认起点。

## 6. 落地顺序

1. 先在 `tab-manager` 试点：保留已有 Spec Kit skills，删除/修订冲突的本地合并指令，配置 GitHub required checks，并用一个小功能产出标准化交付报告。
2. 将 BayJF 的完整 PR 闭环抽成中性的 `PULL_REQUEST_WORKFLOW.md` 模板，去掉特定分支名和部署商，迁移到其余项目。
3. 在 WordPicker、WordBase、SoftDesk 将本地 push 合并路径改为 GitHub merge；为浏览器扩展与桌面应用补齐人工商店 / 安装包验证项。
4. 用 `pr-helper` 接入一个仓库的 read-only 观察模式，先只聚合 checks、部署、失败原因与交付报告；确认准确后再授权重跑 CI、创建 PR 等可逆动作。
5. 以两个发布周期的数据评估：PR 首次 green rate、CI 到 Preview 耗时、人工等待时间、返工原因、生产回滚和验收证据完整率。达到稳定后再推广为全仓库默认。

## 7. 证据索引

- `../bayjf/AGENTS.md`、`../bayjf/PULL_REQUEST_WORKFLOW.md`、`../bayjf/.github/workflows/`
- `../word-picker/AGENTS.md`、`../word-picker/handoff.md`、`../word-picker/.github/workflows/`
- `../word-base/AGENTS.md`、`../word-base/handoff.md`、`../word-base/.github/workflows/`
- `../soft-desk/AGENTS.md`、`../soft-desk/docs/handoff.md`、`../soft-desk/.github/workflows/`
- `../pr-helper/AGENTS.md`、`../pr-helper/docs/current-state.md`、`../pr-helper/.github/workflows/`
- `../tab-manager/AGENTS.md`、`../tab-manager/PULL_REQUEST_WORKFLOW.md`、`../tab-manager/handoff.md`、`../tab-manager/.github/workflows/`

本次未运行任何来源项目的测试、构建或部署，也未修改其文件、Git 状态、分支、远端或 GitHub 设置。所有测试结论均来自已存在的项目交接材料，而非本次重新执行。
