# Agent-Dev v0.2 实施计划草案（外部 Pilot）

> 起草时间：2026-08-24
> 状态：草案，待评审
> 上游：v0.1 已完成（连续三个真实项目交付，失败恢复验收闭环）
> 来源：roadmap.md 第 37-52 行 v0.2 候选范围

## 1. v0.2 的核心目标与退出条件

v0.1 验证的是「作者本人能跑通整条流水线」。v0.2 验证的是**非作者用户能否独立完成流程**——这是 v0.1 没回答的根本问题。

**退出条件（来自 roadmap，硬指标）**：

* 10 名外部用户中至少 **7 名**完成首次交付；

* 至少 **5 名**完成第二次交付（证明可重复性，不是一次运气）；

* 确认愿意连接平台、愿意付费的用户比例。

因此 v0.2 的优先级排序原则是：**凡是不解决「外人能否跑通」的，一律降权或后置**。功能堆砌不是目标，外部可用性才是。

## 2. 当前代码已具备 vs 缺口（起草依据）

起草前已核对现状，避免草案脱离实际：

| 能力                                                                   | v0.2 关联                 | 当前状态                                                                                                                                                                                                          |
| -------------------------------------------------------------------- | ----------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `claude-code` Runtime Adapter                                        | 候选：Local Claude Runtime | **代码已存在**，`packages/agent-runtime/src/index.ts` 的 `AGENT_ADAPTERS` 含 `claude-code`（status=`candidate`，buildCommand 走 `claude -p`）。差的是**真实验证**到 `verified`，并确认 Feature Task / 产物提交守卫 / 失败恢复在 Claude 下同样成立      |
| Agent Catalog / Discovery / 自定义 Agent 持久化                            | 候选：Studio 选择器与持久化       | 阶段 A API 已落地；`.agent-dev/agents.conf` 持久化、Studio 选择器**已在 v0.1 后期实现**（见 handoff §2「当前本地能力」）。v0.2 仅需补外部用户视角的引导与报错可读性                                                                                            |
| Agent Profile（基于 verified Agent 的命名变体：systemPrompt/model/温度/工具集/env） | 候选                      | **已完成（2026-08-28）**：daemon `/api/runtime/profiles` CRUD API + `ProfileStore` 持久化（`agent-profiles.json`）+ Studio 创建/编辑/测试/导出/导入 UI + i18n（en/zh）。安全边界：env 只放行代理/区域白名单键，Secret 走凭证系统注入。配套 28 个单测 + 6 个 API 契约测试 |
| Infisical Adapter                                                    | 候选：Secret Backend       | **完全空白**。仅 `environment-and-connectors.md` 第 114 行声明为后续版本。需新建 Secret Backend Adapter 抽象 + Infisical 实现                                                                                                        |
| 导入现有仓库                                                               | 候选                      | v0.1 只支持从零建仓。Apply 当前假设 baseline 在新建仓；导入需支持「已有 Git 仓库 + 已有文件」的合并/对齐而非覆盖                                                                                                                                       |
| 失败分类与修复建议                                                            | 候选                      | v0.1 暴露 17 个真实缺陷，但报错面向作者。需把失败原因结构化 + 给外部用户可读的修复步骤                                                                                                                                                             |
| Blueprint 分享 / 升级提示                                                  | 候选                      | 空白                                                                                                                                                                                                            |
| macOS 安装 / 诊断 / 自动更新                                                 | 候选                      | 当前靠 `npm` 手动跑；外部用户需要一键包 + `doctor` 诊断增强 + 更新机制                                                                                                                                                                |
| GA4 / Clarity + 隐私 Gate                                              | 候选                      | Manual Action 占位，无自动接入                                                                                                                                                                                        |

## 3. 建议的优先级（P0 > P1 > P2）

### P0 — 决定 Pilot 能否成立的「门槛项」（必须先做）

1. **P0-1 Local Claude Runtime 验证** ⏸️ **已推迟（2026-08-29 用户决策）**

   * 把 `claude-code` adapter 从 `candidate` 实测到 `verified`：跑通至少一次真实 Feature Task、产物提交守卫（`.env`/外部 symlink 拦截）、`apply/recover`、`release/retry` 在 Claude 下同样成立。

   * 复用 v0.1 的项目 4（拿一个新真实项目用 Claude 跑全周期）作为验证载体。

   * 交付：adapter status → `verified`；补充 runtime 契约测试（断言 claude 在 PATH 上才返回，避免 v0.1 缺陷 16 同类环境依赖测试）。

   * 依赖：无。

   * **推迟理由**：当前 Runtime 主力已切到 OpenCode 2.0 + `nemotron-3-ultra-free`（项目 3、4 均跑通完整交付），Claude 不是 Pilot 首交付的必需路径；且 §5 已标注 Claude 凭证路径与「不读取/上传 Claude 登录 Token」的隐私边界存在待澄清冲突。**推迟不构成 Pilot 阻塞**：v0.2 退出条件（10 人中 7 人首交付）不绑定特定 Runtime。

   * **推迟期间的状态**：`claude-code` adapter 保持 `candidate`——不进 verified Runtime 列表，Studio 不引导用户选它。

   * **恢复触发条件**（任一命中即重启该 P0）：① Pilot 招募中出现主力用 Claude 的用户；② 有外部用户明确要求 Claude Runtime；③ `nemotron-3-ultra-free` 额度或可用性出问题，需要备用 Runtime。

2. **P0-2 一键 macOS 安装 + 诊断增强** ✅（2026-08-27 完成）

   * 外部用户不会手动配 Node22 / fnm / PATH / 代理。需：安装包（或 `brew`/脚本）固化 `.node-version`、Daemon 启动注入 `https_proxy`/`NODE_USE_ENV_PROXY=1`；`doctor` 把 v0.1 真实经验（代理、Cloudflare 域名延迟、CLI 版本冲突）做成可诊断项。

   * 已完成：`scripts/install-macos.sh` 一键安装（Homebrew→fnm→Node22→依赖→build），`~/.agent-dev/env` 代理配置，launchd 自启，doctor 诊断已有。

   * 依赖：无，但应早于外部用户招募。

3. **P0-3 失败分类与可读性修复建议** ✅（2026-08-27 完成）

   * 将 v0.1 的 17 个真实缺陷归类为「环境类 / 配置类 / 平台类 / 产品类」，每个失败状态机步骤产出：原因 + 给外部用户的修复步骤（深链）+ 是否可自动重试。

   * 已完成：`packages/agent-runtime/src/failure-classification.ts` 覆盖 19 种失败模式（含本轮新增 7 种），24 个单元测试，Studio FailureDisplay 组件已有。

   * 依赖：无。

### P1 — 扩大可交付范围（Pilot 中期）

1. **P1-1 导入现有仓库** ✅（2026-08-27 完成）

   * Apply 支持「已有 Git 仓库」：检测远端、对齐 baseline、不覆盖用户文件、冲突走 Manual Gate。

   * 已完成：Apply API 支持 `importRepositoryUrl`，导入后自动确保 dev 分支存在，`.agent-dev-import` 标记，保留用户历史不 wipe-and-reclone，冲突检测（conflicts/wouldAdd/keptExisting 记录到 apply-manifest.json）。

   * 依赖：P0-3（导入冲突需复用失败分类）。

2. **P1-2 Infisical Secret Backend Adapter**

   * 抽象 `SecretBackend`（平台 / Keychain / Infisical / Doppler），v0.1 仅前两者。Infisical 实现：版本、审批、轮换、跨平台同步；Agent-Dev 仍只持有引用不存明文。

   * 基础代码已写（local-file + Infisical 基础），未连真实 Infisical 验证。

   * 依赖：无硬依赖，但建议与 P1-1 之后做，避免同时动 Secret 与导入两条链路。

3. **P1-3 Blueprint 分享 + 升级提示** ✅（2026-08-27 完成）

   * 导出/导入 `agent-dev.yaml`、版本升级时提示 Review（复用 Blueprint 漂移检测能力）。

   * 已完成：导出/导入 API 已有，新增 `GET /blueprint/revisions` 版本列表，`POST /blueprint/revise` 升级时自动生成 diff 并返回 reviewRequired 标志。

### P2 — 增强项（Pilot 后期或视反馈）

1. **P2-1 GA4 / Clarity 自动接入 + 隐私 Gate** ✅（2026-08-26 完成）
2. **P2-2 自动更新机制** ✅（2026-08-26 完成，`scripts/update.sh`）
3. **P2-3 Agent Catalog 外部用户引导文案** ✅（2026-08-26 完成）
4. **P2-4 无托管部署类型的交付状态机闭环** ✅（2026-08-27 项目 4「MCP Word Tools」验证发现，2026-08-28 闭环）

   * 问题：api-tool / landing-page 等无托管部署类型的项目，状态机无法通过正常 API 推进到 DELIVERED。`preview/deploy` 和 `release/request` / `release/approve` 都会因 `noHostedDeploymentReason` 返回 409。

   * 实现：状态机保持类型无关，`PR_OPEN` 增加 `REQUEST_RELEASE` 转移；daemon 校验只有无托管部署目标的产品可走该捷径（托管产品在 PR\_OPEN 仍被 preview gate 拒绝）。此类产品的 release 审批记录 "manual distribution" 证据（确认 generated/DISTRIBUTION.md 的人工分发步骤，无 URL、无 deploy 调用），请求/批准分离与署名批准人等人工闸门保持不变。

   * 依赖：无。

### 已完成候选项（2026-08-28，独立于原 P0-P2 编号）

1. **Agent Profile** ✅（2026-08-28 完成）

   * roadmap v0.2 候选：基于 verified Agent 创建命名变体，覆盖 systemPrompt / model / 温度 / 工具集 / env。

   * 实现：daemon `/api/runtime/profiles` CRUD（创建时锁定基础 Agent，env 只放行代理/区域白名单键）+ `ProfileStore` 持久化 + Studio 创建/编辑/测试/导出/导入 UI + i18n。

   * 质量：28 个单测（slugify/唯一 ID/安全 env 过滤/配置合并/工具与 env 校验）+ 6 个 API 契约测试 + 全量 typecheck 通过。

   * 关联：roadmap 的「多 Profile 串行流水线」候选直接建立在 Profile 建模之上，Pilot 反馈需要时可叠加，无需重做基础层。

## 4. 里程碑与节奏（建议）

* **M1（P0 完成）**：~~Claude 验证~~（2026-08-29 用户决策推迟，见 §3 P0-1）+ 安装包 + 失败分类。**M1 视为达成**：剩余两项已完成，推迟的 P0-1 按其恢复触发条件判定、不阻塞灰度。内部可先对 2-3 名友好外部用户灰度。

* **M2（P1 完成）**：导入仓库 + Infisical + Blueprint 分享。开始正式招募 10 人。

* **M3（退出条件达成）**：10 人中 7 人首交付、5 人二次交付，回收付费意愿数据。

## 5. 风险与前提

* **Claude 额度/凭证**：v0.1 因火山方舟额度耗尽弃 Codex 选 OpenCode 免费模型。Claude Runtime 验证需确认外部用户的 Claude 凭证路径不与「不读取/上传 Claude 登录 Token」的隐私边界冲突（decision-log 项目边界）。

* **Pilot 用户获取**：退出条件依赖真实外部用户，这是 v0.2 最大不确定性，需提前规划招募渠道，不能等到代码写完。招募对象画像、渠道与节奏见 §7。

* **不重造 Vault**：Infisical 只做 Backend Adapter，Env Contract / Policy / 验证仍由 Agent-Dev 负责（environment-and-connectors.md 第 114 行）。

## 6. 与 v0.1 完成标准的衔接

v0.1 的「失败恢复」验收已闭环（implementation-plan-v0.1 §10）。v0.2 的 P0-3 是把它从「作者可读」升级为「外人可读」，不是重新验证恢复能力本身。

## 7. Pilot 招募准备

> 招募是 v0.2 最大的非代码不确定性：退出条件（10 人中 7 人首交付、5 人二次交付、付费意愿）全部依赖真实外部用户。代码做到 M2 前就应启动渠道，不要等代码全部写完。

### 7.1 招募对象画像

* **必备**：macOS（P0-2 一键安装覆盖）+ 愿意安装 Node22/启动本地 Daemon；有**真实待交付项目**（不是 Demo，避免"生成后无第二个功能"的路线图约束陷阱）；愿意授权平台连接 GitHub 等（v0.2 要回收"愿意连接平台"数据）。

* **优先**：独立开发者、2-5 人小团队；有 GitHub 仓库或明确的产品想法；之前用过 CLI 类工具（Codex/Claude Code/Cursor）更易上手。

* **排除**：不接受本地 Agent 运行、不接受连接授权、无真实交付目标者，避免污染 7/5 完成率与付费意愿数据。

### 7.2 渠道（按优先级）

1. **作者已有触达圈**：前序真实项目（Receipt Test / Workspace Verify Fresh / Link Vault）的使用者、GitHub 联系人、技术群——转化率最高，优先启动。
2. **开发者社区**：V2EX、掘金、少数派；Twitter/X 的 #buildinpublic / AI 编程话题；Product Hunt（v0.2 中期，需先有可演示入口）。
3. **AI 编程工具社群**：Codex / Claude Code / Cursor 用户群、相关 Discord/Telegram——用户已被教育，学习成本低。
4. **开源/内容**：GitHub 开源仓库 + README 引导、一篇"用 Agent-Dev 交付一个真实项目"的实操文章引流。

### 7.3 激励与支持

* **激励**：Pilot 期内免费使用；完成二次交付并给反馈的用户可获更长试用或书面致谢/署名。付费意愿通过退出问卷回收，不提前收费。

* **支持通道**：Feedback 表单 + Issue 模板 + 远程诊断（复用 `doctor` 报告深链）；招募文档里写清楚「Agent 不读取/上传 Claude 登录 Token」等隐私边界，避免 Pilot 用户在凭证安全上流失。

* **节奏对齐**：M1 后先灰度 2-3 名友好用户（验证安装/诊断/失败分类在真人手上成立），再按 §4 M2 正式招募 10 人。

