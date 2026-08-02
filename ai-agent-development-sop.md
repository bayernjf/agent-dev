# AI Agent 全周期开发 SOP（交接文档）

> 状态：可作为两个现有项目的统一治理基线。本文区分已确认的流程事实、待补充的项目证据和建议方案，避免把假设当成复盘结论。

六个现有仓库的只读证据、差异与治理优先级见 [项目组合复盘](portfolio-development-review.md)。

## 1. 目的与边界

本 SOP 用于让 Claude、Codex、TRAE 等 AI coding agent 在同一套规则下交付功能。目标不是让 Agent 绕过人工，而是把人从重复执行中移出，保留产品决策、风险审批和最终体验验收。

适用范围：Web 应用、浏览器扩展、桌面端和移动端。各端的构建工具不同，但需求、规格、Git、CI、验收和发布门禁保持一致。

当前复盘依据是 SoftDesk 项目和已描述的发布过程。另一个项目不在本仓库，技术栈、部署和历史问题需要补充后再纳入正式复盘。

## 2. 核心原则

1. 规格先于代码：功能开始前先固定用户目标、范围、验收标准和非目标。
2. 一项功能一条证据链：需求、决策、任务、分支、PR、CI、人工验收和发布报告必须可以相互追溯。
3. 自动化只处理低风险、可验证的工作；高影响或不可逆决策必须询问人工。
4. Agent 不能为了“完成任务”改变发布链路、权限、分支策略或外部资源，除非需求明确授权。
5. CI 是合并门禁，不是事后排障工具；生产验收是交付门禁，不是 CI 成功的替代品。

## 3. 人工决策与 Agent 自动执行

| 类别 | Agent 行为 | 例子 |
| --- | --- | --- |
| 需求存在多种合理解释 | 询问，给出 2-3 个候选及影响 | 是否需要账号体系、数据保留策略、交互规则 |
| 架构或技术栈变更 | 询问 | 新增后端、数据库、支付、切换框架、引入跨平台方案 |
| 外部副作用或成本 | 询问 | 生产发布、发送通知、创建云资源、付费 API、删除数据 |
| 安全、隐私、权限 | 询问 | 新增埋点、处理用户数据、提高 GitHub Token 权限 |
| 已定义验收标准内的实现 | 自动 | 创建功能分支、写代码、补测试、运行本地检查、提交 PR 草案 |
| 可逆的代码质量工作 | 自动 | 格式化、类型检查、测试、构建、依赖漏洞扫描、代码审查报告 |

询问时必须附带：推荐方案、候选方案、主要取舍、对时间/成本/风险的影响，以及选择后会修改的范围。不要只问开放式问题，也不要把已经能从仓库找到的答案推回给人工。

## 4. 从 0 到 1 的交付链

```text
需求澄清
  -> 规格与验收标准
  -> 技术方案与任务拆分
  -> feature 分支实现
  -> 本地验证与 Agent 审查报告
  -> PR: feature -> dev（CI + Preview）
  -> 人工验收 dev Preview
  -> PR: dev -> main（CI + Production）
  -> 人工验收 Production
  -> 发布/交接报告与复盘
```

### 4.1 需求澄清

人工提供问题、目标用户、业务价值和已知约束。Agent 输出一页需求记录，至少包含：

- 用户场景和成功结果；
- 功能范围与明确非目标；
- 验收标准，使用可观察的 Given/When/Then 或检查清单；
- 待决策项，标记为“需要人工选择”；
- 风险：隐私、安全、成本、外部依赖和发布影响。

人工确认规格后，规格冻结到该功能发布完成；中途变更必须记录为新的需求变更，而不是混进实现。

### 4.2 技术方案与任务拆分

Agent 提供推荐方案和备选方案。人工只需决定存在真实取舍的事项，例如数据归属、框架、是否上线、是否收集数据。

确认后，Agent 将功能拆成能独立验证的任务。每项任务必须列出：修改文件、测试方式、验收点、回滚影响。不要把 UI、后端、配置、分析和无关重构塞进同一个提交。

### 4.3 实现与本地验证

1. 从最新 `dev` 创建 `feature/<short-name>` 或 `fix/<short-name>`。
2. Agent 按确认后的任务实现，不扩大范围。
3. 每个行为变更优先测试先行；纯配置、生成物或无法合理自动化的视觉细节，必须说明为什么使用替代验证。
4. 每次功能交付至少运行项目规定的 lint、类型检查、测试和构建。
5. Agent 先做代码审查，再提交实现报告；报告不是“测试通过”的同义词，必须列出残余风险和未自动化的验证项。

### 4.4 PR、预览与人工验收

| 阶段 | 分支与动作 | Agent 自动职责 | 人工职责 |
| --- | --- | --- | --- |
| 集成 | `feature/* -> dev` PR | 校验 diff、CI、Preview URL、审查报告 | 审查需求是否满足，测试 dev Preview |
| 修复 PR CI | 同一 feature 分支继续提交 | 读取失败日志、定位根因、提出或实施最小修复 | 仅在需要架构/权限/范围决策时介入 |
| dev 集成失败 | 新建 `fix/* -> dev` PR | 回归定位和修复，不直接改 dev | 确认修复范围 |
| 发布 | `dev -> main` PR | 生产前检查、发布说明、Production URL | 批准发布，测试生产环境 |
| 生产故障 | 回滚或 `fix/* -> dev -> main` | 提供影响、回滚选项和根因报告 | 选择回滚/修复方案并最终批准 |

PR 失败后不需要创建新的 feature PR：继续推送原 feature 分支，GitHub 会更新同一个 PR。只有功能已合并到 `dev` 后出现集成问题，才创建单独 `fix/*` 分支。

### 4.5 CI 责任边界

CI 需要分层，避免一个 job 同时构建、发布、提交文件和触发其他工作流：

1. **质量层**：安装依赖、lint、类型检查、单元/集成测试、构建。
2. **预览层**：在 PR 构建后部署临时环境，供人工验收。
3. **发布层**：仅在批准合并后部署 `dev` 或 `main`。
4. **发布验证层**：检查健康页、关键页面和必要的静态资源；失败必须报告，不应自行修改仓库或再触发部署。

SoftDesk 的 `dist/preview.png` 应作为生产部署产物生成后再上传，而不是由独立工作流提交图片并触发新的部署。这是“构建产物归构建链路、代码归代码提交”的边界实例。

### 4.6 GitHub 的强制门禁

GitHub 没有一套官方的“AI 全栈开发标准”，但提供了可以组合成强制流程的原生能力。`AGENTS.md`、`CLAUDE.md` 和 skills 是 Agent 的行为说明，不是 GitHub 的安全控制；真正不可绕过的规则应放在 GitHub：

- **Repository rulesets / branch protection**：禁止直接推送 `dev` 与 `main`，要求 PR、required status checks 和已解决的 review；
- **Environments**：把 staging 和 production 作为环境，production 配置人工批准与 Secrets，只允许对应部署 job 使用；
- **CODEOWNERS**：对 `.github/workflows/**`、安全、分析和部署文件指定人工审查者；
- **Issue 与 PR 模板**：强制呈现需求、验收、风险、验证证据和发布说明；
- **Reusable workflows**：把 quality、preview、release 的公共部分固化，减少每个项目复制后漂移；
- **Artifacts 与 deployment records**：保留可审计的构建产物、Preview URL 和发布记录。

这套组合解决“Agent 是否遵守”的问题：Agent 可以建议、实现和创建 PR，但无法绕过 required checks、环境审批与分支规则直接发布生产。

### 4.7 完成定义与交接报告

一个功能只有同时满足以下条件才算完成：

- 已批准的规格与验收标准全部有对应验证；
- feature PR 和 release PR 的 required CI 均成功；
- dev Preview 已人工测试；
- production 已人工测试；
- 没有未记录的高风险缺口；
- 交付报告已生成。

Agent 的交付报告模板：

```markdown
## 交付摘要
- 功能与用户价值：
- PR / commit：

## 验收对齐
| 验收标准 | 自动验证 | 人工验证 | 结果 |
| --- | --- | --- | --- |
| ... | 命令或测试 | 环境与步骤 | 通过 / 未通过 |

## 变更范围
- 代码：
- 配置 / CI：
- 数据、隐私和安全影响：无 / 说明

## 验证证据
- lint：
- 类型检查：
- 测试：
- 构建：
- dev Preview：
- production：

## 审查与残余风险
- 已发现并处理的问题：
- 未自动化项及原因：
- 后续建议：
```

## 5. 建议的仓库骨架

不要建立一个承载所有产品源码的“大而全”模板。建立一个轻量的工程治理模板，并为每种产品维护技术预设：

```text
project/
├── AGENTS.md                         # 跨 Agent 的硬约束
├── README.md                          # 本地启动、架构和环境说明
├── docs/
│   ├── product/                       # 规格、验收标准、决策记录
│   ├── delivery/                      # 发布与交接报告
│   └── adr/                           # 架构决策记录
├── .github/
│   ├── ISSUE_TEMPLATE/                # 功能、缺陷、发布模板
│   ├── PULL_REQUEST_TEMPLATE.md       # 验收与验证清单
│   └── workflows/                     # quality / preview / release
├── .agents/ or .codex/                # 可选：Agent 专属配置
└── src/ or apps/                      # 产品代码
```

统一的 `AGENTS.md` 只放不随产品变化的规则：分支、提交、测试、权限、Secrets、删除/生产操作、何时询问。产品技术细节放在产品目录的补充说明，避免一份超长提示词让不同 Agent 各自解释。

## 6. GitHub 和开源可复用基座

| 目标 | 推荐项目 | 适合程度 |
| --- | --- | --- |
| 需求到规格、计划、任务、实现、对齐检查 | [GitHub Spec Kit](https://github.com/github/spec-kit) | 首选。支持 30+ coding agent，能形成 `constitution -> specify -> plan -> tasks -> implement -> converge` 链路。先在一个功能上试点，不要立刻替换现有仓库规则。 |
| Agent 指令和可复用能力 | [Agent Skills 规范](https://github.com/agentskills/agentskills) | 用于封装“创建 PR”“生成报告”“运行验收”等单一能力；它不是项目管理流程本身。跨 Agent 的项目硬约束优先放在 `AGENTS.md`；Copilot 专属指令可放 `.github/copilot-instructions.md`。 |
| Copilot 的 instructions、agents、skills 样例 | [github/awesome-copilot](https://github.com/github/awesome-copilot) | 适合作为配置样例库，必须审查后再采用。 |
| CI 起步模板 | [actions/starter-workflows](https://github.com/actions/starter-workflows) | 适合搭建常规质量门禁，仍需按项目补部署与验收。 |
| 多应用仓库、任务图和 CI 缓存 | [Nx](https://github.com/nrwl/nx) | 多于两个活跃产品且共享 UI、配置或 API 后再引入；当前单项目不需要。 |
| Web 产品预设 | [Vite](https://vite.dev/) / [Astro](https://astro.build/) | 管理后台、SPA 选 Vite；内容型/SEO 主导站点优先评估 Astro。 |
| 浏览器扩展预设 | [Plasmo](https://github.com/PlasmoHQ/plasmo) | React/TypeScript 浏览器扩展的成熟起点。 |
| 桌面端预设 | [Tauri](https://github.com/tauri-apps/tauri) | Web 前端加原生桌面能力，体积和安全边界通常优于传统 Electron 方案。 |
| 移动端预设 | [Expo](https://github.com/expo/expo) | React Native 的 iOS、Android、Web 统一开发路径。 |

这些项目解决的是不同层次的问题：Spec Kit 是需求与任务流程，Agent Skills 是能力封装，GitHub Actions 是自动化执行，Nx 是多项目组织，Vite/Plasmo/Tauri/Expo 是平台技术基座。不要把它们视作互相替代的“万能脚手架”。

## 7. 分阶段落地建议

### 第一阶段：先治理，不换技术栈

在两个现有项目中统一引入：功能需求模板、PR 模板、交付报告模板、`AGENTS.md` 的“询问/自动”规则，以及 CI 的质量/预览/发布分层。目标是减少返工，不是增加工具。

### 第二阶段：把验收变成可追溯证据

为每个 PR 附上验收对齐表和 Preview URL；为 main 发布附上生产验证结果。把人工测试明确为必须执行的少数关键场景，而非笼统的“测一下”。

### 第三阶段：用一个功能试点 Spec Kit

在新功能使用 Spec Kit 生成规格、计划和任务；保留当前 Git 分支和 GitHub Actions，不迁移现有项目。试点完成后评估：需求返工次数、CI 返工次数、人工决策等待时间和交付报告完整性。

### 第四阶段：按需要抽取平台预设

只有当同类产品重复出现时才沉淀 `web-spa`、`browser-extension`、`desktop-tauri`、`mobile-expo` 等 starter。每个 starter 都应包含：运行命令、质量门禁、Preview/Release 流程、环境变量模板、Agent 指令和交付报告模板。

## 8. 两个项目的正式复盘方法

当前已确认的共同问题是：代码先在本地验证，随后经 `feature -> dev -> main` 推进；任何一层 CI 或环境验证失败都会造成返工。这个链路本身是合理的，效率低的来源通常是缺少提前验证、失败没有归类、以及每次返工都重新建立上下文。

不要凭印象评判“一个多月两个项目”是否低效。每个已完成项目以一个功能或发布为一行，收集下面的数据后再决定自动化投入点：

| 字段 | 记录方式 | 用途 |
| --- | --- | --- |
| 需求首次确认时间、生产验收时间 | Issue / PR / 发布记录 | 交付周期 |
| 人工等待时间 | 需求确认、PR review、环境批准分别累计 | 找出真正的瓶颈 |
| CI 失败次数和首次失败阶段 | 按 lint、测试、构建、Preview、部署分类 | 前移对应检查 |
| 返工原因 | 需求变更、实现缺陷、环境差异、依赖/权限、视觉验收 | 区分“该问未问”和“该自动未自动” |
| 修改范围 | 文件数、模块数、是否跨端/跨服务 | 识别任务拆分是否过大 |
| 验收未通过项 | 对应验收标准编号 | 补足自动化与规格 |
| 生产事故 / 回滚 | 影响、检测方式、恢复时长 | 调整发布门禁 |

复盘输出不是罗列事件，而是每个问题落到一个可验证改进项：例如“Preview 的环境变量缺失导致两次返工”应转成“PR workflow 增加 env schema 校验，失败信息指向缺失变量”，并指定负责人、完成日期和成功指标。建议先选择各项目最近 3 个功能，范围足够暴露重复问题，又不会因历史资料缺失而失真。

## 9. 让 Agent 可自治但受约束

### 9.1 单个功能的任务契约

人给 Agent 的最小输入不是“做一个页面”，而是一个可交付任务契约：

```markdown
## 目标
- 用户问题：
- 目标用户与成功结果：

## 范围
- 包含：
- 不包含：

## 验收标准
1. Given ... When ... Then ...
2. ...

## 已知约束
- 技术 / 兼容性 / 成本：
- 禁止变更：

## 授权
- Agent 可自动：创建分支、修改代码、运行本地/CI 检查、创建或更新 PR、部署 Preview。
- 必须询问：生产发布、权限或 Secret 变更、付费资源、数据迁移/删除、架构与依赖替换。
```

收到任务后，Agent 必须先输出：规格、验收映射、风险、实施计划和问题列表。不存在需要人工决定的问题时，明确写“无待决事项”并继续；不要为了走流程而阻塞。

### 9.2 可放入根目录的 `AGENTS.md` 基线

以下是跨 Claude、Codex 和 TRAE 均能理解的项目级约束。命令名称应替换为各项目真实命令，且 CI 必须运行相同检查，避免“本地通过、CI 失败”。

```markdown
# Agent 工作约束

## 开始前
- 阅读 README、相关 docs/、现有代码和本文件；不从未验证的假设开始实现。
- 需求存在业务、架构、安全、成本或发布取舍时，先给 2-3 个候选及推荐项，等待选择。
- 未有待决事项时，输出计划、验收映射和影响范围后继续执行。

## Git 与范围
- 从最新 dev 创建 feature/<issue>-<slug>；集成问题用 fix/<issue>-<slug>。
- 不直接推送 dev 或 main；不重写他人提交；不混入无关重构。
- 禁止提交 Secret、生成物或本地配置。修改 .github/workflows、权限、部署或依赖锁文件时在 PR 中单列说明。

## 验证
- 每个验收标准必须关联自动测试、人工步骤，或说明不能自动化的原因。
- 提交 PR 前运行：<lint>、<typecheck>、<test>、<build>。
- PR/CI 失败时读取日志，在原 PR 上最小化修复并补回归测试；不以关闭 PR 代替修复。

## 必须询问
- 生产发布、合并受保护分支、数据迁移或删除、外部通知、云资源/付费 API、权限/Secret 改动、收集或传输用户数据、框架或架构替换。

## 交付
- PR 描述必须包含：目标、验收对齐、变更、验证命令和结果、Preview、风险与回滚。
- 功能结束时生成 docs/delivery/<issue>-<slug>.md；不得把未执行的验证写成通过。
```

`AGENTS.md` 提供指令，不是权限系统。分支保护、required checks 和 Environment approval 才是防止所有 Agent 或人工误操作的最终控制面。Codex 的官方文档连接器在本次工作中已配置，但需要重启 Codex 后才能在新会话中加载；本段基线没有依赖其未核实的行为细节。

## 10. GitHub 实施蓝图

把门禁先配置成最小闭环，避免一开始引入过多工作流：

| 位置 | 规则 | 目的 |
| --- | --- | --- |
| `feature/* -> dev` PR | PR 必须通过 `quality`、构建、Preview；至少一位人工批准 | 尽早发现功能问题 |
| `dev` ruleset | 禁止直推、要求 PR 与 status checks、阻止 force push | 保护集成环境 |
| staging / Preview Environment | 限制可使用的 Secrets；部署后回填 URL | 验收可重复 |
| `dev -> main` PR | release checks、变更说明、人工批准 | 生产前冻结范围 |
| production Environment | Required reviewers + 独立 production Secrets | 人工控制生产发布 |
| `main` ruleset | 禁止直推、要求部署验证成功 | 保护生产版本 |
| `CODEOWNERS` | `.github/workflows/**`、安全、部署和数据迁移路径必须人工审查 | 避免 Agent 单独改变门禁 |

对于你描述的返工路径，执行规则应固定为：

```text
feature PR 的 CI 失败 -> 更新原 feature 分支和原 PR
feature 合入 dev 后发现集成问题 -> fix/* 从 dev 创建 -> PR 到 dev
dev 的预览验收通过 -> dev -> main 发布 PR
main 的 CI 或生产验证失败 -> 若未发布则修复后更新同一发布 PR；若已发布则按回滚决策或 fix/* -> dev -> main
```

不要让 Agent 在 CI 失败时自动合并、自动重试无限次或自行提升 GitHub token 权限。每次失败应生成结构化结论：失败 job、根因分类、受影响验收标准、修复 diff、复验结果和是否需要人工决策。

GitHub 的相关原生能力与官方入口：

- [Rulesets / branch protection](https://docs.github.com/repositories/configuring-branches-and-merges-in-your-repository/managing-rulesets/about-rulesets)：保护分支和要求状态检查。
- [Deployment environments](https://docs.github.com/actions/how-tos/deploy/configure-and-manage-deployments/manage-environments)：对环境设置审批人与 Secrets 边界。
- [CODEOWNERS](https://docs.github.com/repositories/managing-your-repositorys-settings-and-features/customizing-your-repository/about-code-owners)：指定敏感路径的人工 review。
- [Reusable workflows](https://docs.github.com/actions/sharing-automations/reusing-workflows)：把质量与部署规范跨项目复用。

## 11. 可复用父框架的设计

父框架应复用“治理层”，而不是强迫 Web、扩展、桌面和移动端共用源码结构。推荐维护一个 `product-governance-template`，再让每个端有独立 starter：

```text
product-governance-template/
├── AGENTS.md
├── docs/{product,adr,delivery}/
├── templates/{feature,delivery,adr}.md
├── .github/{ISSUE_TEMPLATE,PULL_REQUEST_TEMPLATE.md,workflows}/
├── scripts/verify-delivery.*
└── config/quality-contract.yml

starters/
├── web-vite/
├── extension-plasmo/
├── desktop-tauri/
└── mobile-expo/
```

每个 starter 只实现平台必需差异：构建命令、测试矩阵、Preview/分发方式、权限清单及发布产物。所有 starter 都应保留相同的需求模板、验收报告格式和 GitHub 门禁名称，才能让 Agent 的交接方式一致。

GitHub 没有一个能覆盖所有端且可直接套用的“官方 AI 全栈开发规范”。最接近上层流程的开源项目是 [GitHub Spec Kit](https://github.com/github/spec-kit)，适合把需求转成 `constitution -> specify -> plan -> tasks -> implement -> converge`；它应接入本 SOP，而不是取代分支规则和 CI。`AGENTS.md` / Agent Skills 是协作协议，GitHub rulesets / Environments / Actions 是强制执行机制，两层必须同时存在。

## 12. 30 天落地顺序与成功指标

| 时间 | 交付物 | 成功判定 |
| --- | --- | --- |
| 第 1 周 | 两项目复盘表、统一需求/PR/交接模板、根目录 `AGENTS.md` | 每个新功能有验收标准和风险记录 |
| 第 2 周 | `quality` workflow 与 dev/main rulesets；本地命令和 CI 对齐 | CI 的同类基础失败不再在合并后才出现 |
| 第 3 周 | Preview 与 production Environment 审批；标准化交付报告 | 每次发布可查到 URL、批准人与验收证据 |
| 第 4 周 | 选一个功能试点 Spec Kit，复盘并抽取治理模板 | 比较首轮通过率、返工原因和人工等待时间 |

初始指标不要只看“做了多少功能”。建议按月追踪：需求一次澄清通过率、PR 首次 CI 通过率、从 PR 创建到人工验收的中位时间、每功能返工次数、生产回滚数、以及有完整验收证据的发布比例。优化目标是缩短可控等待和减少可预防返工，不是取消人工验收。

## 13. 下一步需要补充的信息

1. 两个项目的仓库路径、技术栈、分支策略、CI 日志和最近三个功能的 PR；
2. 你希望 Agent 可自动执行的外部操作白名单，例如创建 PR、发布 Preview、合并 PR、创建 issue；
3. production 是否始终要求人工批准，或哪些低风险项目可自动发布；
4. 是否会共享账号、UI 组件、后端服务或设计系统。这决定是否需要 Nx monorepo；
5. 各端的发布渠道，例如 Vercel/Cloudflare、Chrome Web Store、macOS/Windows 分发、App Store/Google Play。
