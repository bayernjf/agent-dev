# Agent-Dev 项目交接

> 更新时间：2026-09-02
> 当前阶段：四个真实项目全部完整交付上线（`Receipt Test` 1/3、`Workspace Verify Fresh` 2/3、`Link Vault` 3/3、`MCP Word Tools` 4/4 首个非 web-saas 类型）——BluePrint → Preview → Production 全周期在真实云端跑通，4/4 验证目标达成；v0.2 P0-2/P0-3/P1-1/P1-3/P2-4 已完成（P2-4 无托管部署类型交付闭环于 2026-08-28 落地），P0-1（Claude Runtime 验证）已于 2026-08-29 由用户决策推迟（不阻塞 Pilot，恢复触发条件见 [v0.2 计划](docs/implementation-plan-v0.2.md) §3）；2026-08-28 新增 agent-dev MCP 桥、web-saas→web-app 类型重命名与 Studio 主题收尾，2026-08-29 MCP 桥完成化并扩至 21 工具（2026-08-31 随自更新端点移除减至 20），2026-08-31 完成全仓安全与质量审计（4 条高危，核心是 daemon 无鉴权监听所有网卡），审计整改 **P0 网络边界 §6.1 全部 4 项**、**P1 状态机 §6.2 全部 3 项**、**P2 §6.3 清理全部 6 项**与 **P3 §6.4 Windows 兼容全部 3 项**已于同日完成，**P4 §6.5 测试补齐全部 4 项已于同日完成**（storage pipeline resume/isStepApproved 4 例并修复 resume 未落盘缺陷、MCP 桥 20 工具全覆盖 +2 例、Studio 渲染冒烟 3 例 + vitest include/子路径 alias 收敛），**审计整改全部完成，当时全仓 220 例测试全绿**，方案与验收见 [审计文档](docs/audit-2026-08-31.md)；2026-09-01~02 的 Studio 界面走查与待办清理已连发 21 刀（第二轮 `e75a1ba`→`a072c55` 另清掉只读探测顺带改选择、能力探测语义与中英文标签大小写三项，`2e1440e` 再清掉 Runtime 路由的第二种拒绝与响应里那份 Codex 探测章，之后测试证据读取收敛为单一模块 `test/source-evidence.ts`），同日再关掉两项：`64c2a72` 把那条「未归因的间歇失败」归因为 **2 条**超时用例（根因是发现要顺序探测 8 个内置 Agent、每个版本探测预算 5 s，而 vitest 单用例默认预算也是 5 s），`ebe7ec4` 修掉「决策卡不看 productType」这条内容错误（两张卡与界面上那句基线注记改读 per-type 表），现全仓 351 例全绿
> 工作目录：仓库根目录

## 最近进度

- **领域文案 i18n 边界方案②五批全部落地（2026-09-02，4019905/ff5f664/caa3b07/6e1ee52/b22ec08；§9 决策项关闭）**：决策依据文档（`docs/i18n-domain-prose-decision.md`）实测 288 份答案组合后确认——非 artifact 共 93 个模板 + artifact titles 80 key，同一 prose 有两个消费方（Studio 要中文、MCP 桥要英文原文给外部 coding agent），据此淘汰方案①③，采用方案②：blueprint 保留英文 prose 作契约，并行发稳定 key+params，Studio 用 key 查 locale、miss 回退英文，MCP 桥零改动。
  - **第 1 批 dryRun（4 模板）**：`DryRunPlan` 加 `summaryKey/summaryParams/automaticPreparationKeys`；Studio 新建 `useDomainText()` hook（`lib/domain-text.ts`），key 命中出中文、两 locale 都 miss 回退后端英文 prose、无 key 返回原文（增量迁移安全）；locale 加 `dryRun.*` 段。
  - **第 2 批 decisions（37）**：`BlueprintDecision` 加 `titleKey/valueKey/valueParams/reasonKey`；枚举值（dataSensitivity/previewStrategy）和 analytics 列表参数化；per-type stack/provider 值暂留英文（从 `PRODUCT_TYPE_DESCRIPTORS` 派生，后续加 per-type key）。
  - **第 3 批 baselinePlan（15）**：`BaselinePlan` 加 `summaryKey/summaryParams`（ready/blocked 两种，blocked 带 `{count}`）；`BaselinePlanResource` 加 `titleKey/reasonKey/reasonParams`（四个 provider 各有 title/missingReason，hasOwner 带 `{title}/{owner}`）。
  - **第 4 批 manualActions（37）**：`ManualAction` 加 `titleKey/titleParams/reasonKey/stepsKeys/verificationKey`；七个 action family（github/supabase/cloudflare/vercel/privacyReview/analytics/custom）全覆盖；analytics title 带 `{provider}` 参数；provider 过滤保持原顺序（github→supabase→cloudflare→vercel）。
  - **第 5 批 artifact titles（80 key）**：`GeneratedArtifact` 加 `titleKey`，`generateArtifacts` 在唯一出口统一填充（不改每个 builder）。78 个唯一 id 中 76 个 title 跨类型固定，用 `artifact.${id}`；仅 `template-root-package` 和 `template-readme` 随类型变化，用 `artifact.${id}.${type}`。
  - **测试纪律**：每批都配「blueprint 断言 key/params 存在且与 prose 对齐」+「Studio 断言每个 emitted key 在 en/zh 都能解析」。`domain-text.test.tsx` 从 9 例扩到 173 例（dryRun 4 + decision 37 + baseline 11 + manualAction 42 + artifact 80）。踩坑：测试组件用 `key` 作 prop 名被 React 保留属性吞掉，改 `i18nKey`；locale 嵌套结构必须用对象嵌套（`reason: { none: ... }`），扁平的 `reason.none` 无法被 `getNestedValue` 按点号解析。
  - **全部完成**：五批覆盖 dryRun(4)、decisions(37)、baselinePlan(15)、manualActions(37)、artifact titles(80 key)。MCP 桥零改动，继续接收英文 prose。
  - **验证**：全仓 `npx vitest run` **35 files / 530 例全绿**；`npm run typecheck` 0 错；Studio `vite build` 干净。

- **决策卡与表单基线注记开始读产品类型：卡片不再和它自己的生成物对着说（2026-09-02，`ebe7ec4`；走查待办 2 与 §9 里并列的那条一并关闭）**：`getBlueprintDecisions` 此前不看 `productType`，两张卡对**每一种**类型都印 web-app 的那套：`Application baseline: React/Vite, Hono and npm workspaces` + 理由 `This is the tested v0.1 Web app golden path.`、`Cloud account connection: Supabase, Cloudflare Pages and Vercel Functions`。于是一个 MCP server 的决策台向用户索要 Supabase 组织与 Vercel team，而**同一个 Blueprint 自己生成的** `PRODUCT_STANDARD.md` 写着 `Frontend: None (MCP server; tools are the interface)` / `Data and auth: Not provisioned for this product type`。信卡片的用户会去授权一套这次交付根本不碰的云账户。
  - **两张卡都改读 `PRODUCT_TYPE_DESCRIPTORS` 与 `baselineProvidersFor(productType)`**——就是写 `PRODUCT_STANDARD.md` 与基线计划的那张表（缺陷 24 立的唯一事实源），所以卡片与文档只可能在「有一方不再读它」时才分歧。stack 卡的值是 `前端 | 后端`（分隔符用 `|` 而非 `;`，因为 api-tool 自己的前端串里就含分号）；云账户卡只列该类型真正供给的云 provider，`github` 按名排除——它是源码托管不是云账户，而这张卡的标题就叫「Cloud account connection」；四类不供给任何云资源的改印 `None — this product type provisions nothing outside its GitHub repository`。
  - **`mode` 一律保持 `manual`**：GitHub 授权仍然是人的动作，「没有云资源」不等于「没有闸门」——放掉这道门会让一份基线在零授权的情况下被批准。`CLOUD_PROVIDER_LABELS` 用 `satisfies Record<Exclude<BaselineProviderId, 'github'>, string>` 钉住：第五家 provider 不声明自己对用户叫什么，就编译不过。
  - **同一条假陈述在界面上还有第二处，一并修掉**：Blueprint 表单里那句 `blueprint.baselineNote`（`固定基线使用 React/Vite、Hono、Supabase、Cloudflare Pages 和 Vercel Functions`）就渲染在**用户挑产品类型的正下方**，对六种类型说着同一句话。拆成两个 key——`baselineNoteCloud`（插值 `{providers}`）与 `baselineNoteRepositoryOnly`——派生逻辑进 `apps/studio/src/lib/baseline-note.ts`（沿用 `lib/product-type.ts` 的显式表形状）。云 provider 名是专有名词、两种语言写法相同，所以只有**清单**在代码里拼，句子留在 locale 表里，`zh satisfies Translations` 与 key 解析测试才看得见它。§9 那条 i18n 边界**仍未拍板**，所以两张卡下发的照旧是后端英文串，`packages/blueprint` 的文案结构一行未动。
  - **证据（刻意不断言字符串，断言的是「卡片与文档说同一件事」）**：blueprint 新增 1 例，遍历 7 种类型/shell 组合，从 `createDryRunPlan(...).artifacts` 取出 `generated/PRODUCT_STANDARD.md`，用正则取回它自己写的 `- Frontend:` / `- Backend:` 两行，断言 stack 卡的值与之逐字相同；再对 supabase/vercel/cloudflare 逐家断言「卡片提到 ⟺ 该类型的 providers 里有它」，并断言每种类型的 `mode` 都是 `manual`。Studio 新增 `baseline-note.test.ts` 4 例：六种类型各自落到哪个 key、providers 串是什么；两个 key 在**两种** locale 都解析出真文案；每种 locale 的文案里 `{占位符}` 集合必须等于 `note.params` 的键集合（`t()` 对不认识的占位符原样印出，某一语言多写或漏写 `{providers}` 会把它直接印给用户，而别处不会红）；repository-only 那句不许含 `{providers}`、必须点名 GitHub（两句都是通顺的话，把 key 换过来在别处是隐形的）。渲染点接线用剔除注释后的源码证据钉住（`baselineNoteFor(answers.productType)` 与 `t(baselineNote.key, baselineNote.params)`）。
  - **这套断言自己也被种植验过（2026-09-02 补做，规则已沉淀到 [i18n 文档 §6.2](docs/studio-i18n-design.md)）**：① 删掉 `en.ts` 里 `baselineNoteCloud` 的 `{providers}` → 两条用例红，且都点名 `en / blueprint.baselineNoteCloud`；② 在 `baselineNoteFor` 里交换两个候选 key → 「六种类型各自落到哪个 key」与「占位集合等于 params 键集合」两条红，而「两句语义不重叠」**仍然绿**——它只读字典本身，结构上看不见交换，所以那张逐个类型的期望表不是冗余。两处种植均已逐字节回滚（`git status` 干净），Studio 12 files / 81 例、全仓 34 files / 351 例恢复全绿。
  - **记下来而不是顺手改掉的一处不精确**：`PRODUCT_TYPE_DESCRIPTORS.desktop.frontend` 不随 `desktopShell` 变，所以 tauri 与 electron 两种 Blueprint 的 stack 卡都印「Tauri v2 by default, Electron in professional mode」——`PRODUCT_STANDARD.md` 里是同一句同样的不精确。本轮取「卡片与文档一致」，没有去改生成物的措辞。
  - **本轮没有浏览器复验，原因说清楚**：Blueprint 表单不在首屏初始渲染里（要点「New Blueprint」才出现），`renderToString` 的 smoke 套件够不到那句话——我先写了一例断言初始渲染含插值后的注记，实测变红（HTML 里根本没有这张表单），随即删掉，没有为了让它绿而放宽断言；本仓库也没有 DOM 测试环境（jsdom/happy-dom 属需用户拍板的新增依赖）。所以「切换产品类型时那句话跟着变」这一步**只在派生函数与源码证据层面成立，没在真浏览器里看过**。
  - **验证**：全仓 `npx vitest run` **34 files / 351 例全绿**（起点 346：blueprint +1、Studio +4）；`npm run typecheck` 全部 workspace 0 错；Studio `vite build` 干净（440.86 kB / gzip 124.48 kB）。

- **那条「未归因的间歇失败」归因了：不是一条是两条，而且不是运气（2026-09-02，`64c2a72`，待办 a11 关闭）**：a15 那条把它记成「1 例红、日志没留、随后两次全绿」，所以这次连跑 **8 次全量、每次都留日志**：**6 绿 2 红**，两次红的是**不同**用例，红讯都是 `Test timed out in 5000ms`——RUN 7 `apps/cli/test/mcp.test.ts > covers the remaining read tools: runtime, connectors, release, release plan`（5239ms），RUN 8 `packages/agent-runtime/test/catalog.test.ts > returns only detected built-in runtimes`（6091ms）。
  - **根因是一条算得出来的不等式，不是偶发**：`discoverAgentRuntimes()` 顺序探测内置目录里的 **8 个 Agent**，`VERSION_PROBE_TIMEOUT_MS` 与 `HELP_PROBE_TIMEOUT_MS` 各 5 s（`packages/agent-runtime/src/catalog.ts`），最坏 40 s；而 vitest 单用例默认预算正是 **5 s**。机器一有负载，这条不等式就兑现成超时——`vitest.config.ts` 里的 `fileParallelism: false` 只让它变缓，没有改变它。两个用例都只是在问接线与过滤，却要自己掏钱去探本机八个 CLI。
  - **两处各自回到它真正要问的问题**：MCP 桥那例问的是「只读工具能不能经 HTTP 打到 daemon 路由」，于是 daemon 多一个注入口 `DaemonDependencies.discoverRuntimes`（沿用 `isAgentDetected` 的既有模式），测试注入只含 codex 的夹具目录，链路仍是 MCP client → bridge → HTTP → daemon route → store 全程真跑；这个 helper 的注释此前写着「without probing the machine」，而 `agent_dev_get_runtime` 打的正是 `/api/runtime/catalog`——注释是假的，一并改成真的（三个 stub：connector preflight / account discovery / runtime catalog）。catalog 那例问的是「没装的内置 Agent 不该出现在结果里」，改成把 PATH 指向只含一个内置命令的夹具目录、并断言结果恰好是它：原来那句 `agents.every(...)` 在一台什么都没装的机器上对**空数组**恒真，它量的是本机装了什么，不是过滤器。
  - **两条限制写在下一个作者会撞见的地方**：注入的目录是夹具，看不见 `POST /api/runtime/catalog` 刚追加的 custom Agent（要断言新条目就得走真发现）；`detect()` 按命令缓存，夹具 PATH 那一跑会把其余七个内置名字缓存成「不在」，所以同文件后面的用例只能继续探自己的夹具命令（本来也都是这样），「期待某个真内置 Agent 被检出」的用例不能再加进这个文件。
  - **`apps/daemon/test/app.test.ts` 故意仍走真探测**：它是唯一断言真路由契约的地方（每条 agent 的 `adapterStatus === getAgentAdapterStatus(id)`、custom agent 为 `unsupported`），换成夹具就等于把契约本身换成夹具。代价是它保留同样的贴边风险（那次 `GET /api/runtime/catalog` 仍要探八个内置命令），这部分**没有**关掉。
  - **修前修后都量过**：修后连跑 **10 次全量全绿**（8 次循环 + 前后各 1 次；前 9 次 350 例、最后一次 351 例），零 `Test timed out`。两个曾经超时的用例现在整文件分别 879ms 与 398ms，改写后的 catalog 用例 8 次里 324–536ms，对 5000ms 预算有约十倍余量。这 10 次都跑在同时带着上一条改动的树上，而那两个用例都不碰它。
  - **纪律落档**：发现的代价与它逼出的两条测试规则写进 [Agent Runtime Catalog](docs/agent-runtime-catalog.md) §3.4。

- **测试证据读取收敛为单一模块：一条规则只活在一个文件里（2026-09-02，`test/source-evidence.ts`）**：关掉 2026-09-01 第一轮走查留下的「剩下三个证据文件同类漏洞待办」（见下）。四个 Studio 测试文件各自维护一份**字节级相同**的「读源码做证据」辅助逻辑（`SRC` 常量 + `code()`/`sourceBlob()`/`sourceFiles()`），而第四个文件从未拿到整行注释剔除规则——一条规则放在四处就会漂移，这正是这套套件写出来要防的缺陷形态（两个文件里的两张 switch 表对 Codex 接受哪个 flag 意见不一）。
  - **三个用途不同的 helper**：`readSource(file)` 读单文件并剔除整行 `//` 注释（「此调用点存在」的正向证据，`agent-selectability`/`capability-verdict`/`runtime-executor` 用）；`componentSources()` 遍历 `src` 下全部 `.tsx`（排除 locale 表）**原文返回**（`owned-copy` 的负向扫描用——注释只能增加 finding 不能隐藏，注释掉一行就让它变红，复制不是通过态）；`renderedSourceBlob()` 拼全部 `.ts/.tsx` 并剔除整行注释（`approval-labels` 用——「某 key 被渲染过」是弱声明，只有去掉注释才诚实）。
  - **不只是 DRY，是一处行为修复**：`approval-labels` 原先读的是原文 blob，把最后一个调用点注释掉断言照样绿；改用 `renderedSourceBlob()` 后这条漏洞关闭——与第一轮「注释掉一行照样全绿」是同一类缺陷，这次从读取层根治。
  - **有意窄范围**：只剔除整行 `//` 注释；行尾注释、`/* */`、JSX `{/* */}` 仍算证据——关闭它们需要真 parser，没有 parser 却宣称已关闭，是这套规则要防止的另一种过度承诺。路径处理收敛进模块内部（`relativeToSrc`/`SRC` 单点），调用方不再自己拼路径。
  - **验证**：Studio **11 files / 77 例全绿**（收敛前后断言数不变）；全仓 typecheck 0 错。`vite build` 不受影响（仅测试文件）。
- **Runtime 路由的第二种拒绝有了名字：`agent_not_detected`，响应也不再盖 Codex 的章（2026-09-02，`2e1440e`，待办 a15 = 下一条「本轮新发现」里的 ④⑥）**：`POST runtime/run` 曾用六个手写分支再问一遍「这个 Agent 能不能跑任务」，而 resolver 已经答过一次，两份答案口径还不一致——预检查的是 catalog，而 catalog 只列本机装了的东西，于是「指名了但没装」被答成 404 not found；六个分支没有一个带 `code`，Studio 分不出两种事实，只能把后端英文句印在一个会说两种语言的界面上。
  - **两个 code，因为是两个事实**：`agent_not_executable` 由 Adapter 注册表回答，任何机器都成立；`agent_not_detected` 由本机 PATH 回答，装一下就变。合成一个会让注册表的答案取决于它跑在哪台机器上，也会让界面用一句话讲两件不同的事。预检整块删除，路由在 resolver 之后只问一个机器局部问题；`isAgentDetected` 进 `DaemonDependencies`（沿用既有注入模式），因为套件不许声称本机装了什么。
  - **两个响应都不再带 `probe: probeCodexRuntime()`**：那是一份关于 Codex 的健康报告，盖在一份 plan 和一条 run 上，而它们讲的是 resolver 指名的那个 Agent——一份 Claude Code 的计划曾带着别人的结论回来。回答 Codex 的路由是 `GET /api/runtime/probe`，它保留。
  - **证据**：daemon 新增 2 例（409 带 `code: agent_not_detected` 且未写运行记录 / 201 带 `planned` 且无 `probe` 字段）；既有的大生命周期用例改为注入 `isAgentDetected: () => true` 并注明「测的是生命周期，不是本机装了什么」，否则会引入只有装了 Codex 才绿的新机器依赖；Studio 分类器要求同一个 agentId 的两个 code 得出不同 kind，两种 locale 字典都必须插 `{agent}`，`prepareRuntime` 的新分支由源码证据钉住（读源码时剔除整行注释）。
  - **五次有效植入反证**（分两轮，每处只红自己的用例），另有**一次无效植入**：拒绝体去掉 `code` → daemon 409 例红（`expected { …(2) } to match object { code: 'agent_not_detected' … }`）；分类器删第二条分支 → `does not read the missing CLI as the missing contract` 红；App.tsx 删整条分支（退回后端英文句，即历史缺陷的形状）→ `guards the missing-CLI refusal` 红；两个响应把 `probe` 加回去 → 分别红在生命周期用例与 201 用例（红讯就是 `expected { command: 'codex', …(4) } to be undefined`）；删掉 `isAgentDetected` 守卫 → `expected 201 to be 409`。第六处植入（把包里那个常量的字面量改掉）**没有红任何东西**——没人 import 它，daemon 测试用的是自己的字面量，一行无行为可扰的代码不构成证据，已回滚且不计入反证。
  - **默认接线量过一次，不是靠猜**：路由问 catalog 那一行是唯一无法用套件覆盖的（覆盖它就得断言本机装了什么），所以用一次性脚本量：两个进程、同一套就绪夹具、只改一个事实——PATH 完好 → `201 planned/codex` 且落库；请求前一刻清空 PATH → `409 agent_not_detected` 且不落库；两腿都无 `probe` 字段。中途两个坑记在这里免得重犯：`detect()` 按命令缓存，所以「同进程先跑一次再清 PATH」会读到缓存里的 `detected: true`，A/B 必须跨进程；而一开始就清空 PATH 会把夹具本身打断（`apply` 要 shell 出 git），拿到的 plan 409 是「没有已批准任务」，与本路由无关。**本机四个 verified Agent 全都装着**，所以拒绝分支在真机上不可达，界面那句中文文案本轮**没有**在浏览器里见过；新句也没有渲染层测试（smoke 套件用 `renderToString`，无 DOM，驱动不了 `prepareRuntime`）。
  - **验证**：全仓 `npx vitest run` **33 files / 346 例全绿**（起点 341，daemon +2、Studio +3），连续两次；`npm run typecheck` 11 个 workspace 全 0 错；`vite build` 干净（439.87 kB / gzip 124.15 kB）。**一次未归因的间歇失败**：本轮全量第一次跑出 1 例红，日志未留存，因此不知道是哪条；随后两次全绿，`catalog.test.ts` 单跑三次亦稳（6 例 / 约 6.5s）。这条 flake 归入待办 a11（超时贴边）继续查，不当作已解决。（**2026-09-02 已归因，见上方「那条未归因的间歇失败归因了」那条进度**：它不是一条而是两条——又跑 8 次全量、每次留日志，6 绿 2 红，两次红的是不同用例且红讯都是 `Test timed out in 5000ms`（`apps/cli/test/mcp.test.ts` 的只读工具用例、`packages/agent-runtime/test/catalog.test.ts` 的内置过滤用例）；根因是目录发现要顺序探测 8 个内置 Agent、每个版本探测预算 5 s，而单用例预算也是 5 s。待办 a11 关闭。）

- **Studio 走查待办清理第二轮：只读动作不再兼职决策，探测不再为自己没测的东西作证（2026-09-02，`e75a1ba`→`a072c55` 共 3 刀）**：把上一条「本轮新发现」里**不需要架构决策的三项**（① ② ⑦）清完；④⑥ 已于同日由 a15（`2e1440e`，见本文第一条进度）清掉，剩下 ③ 落在待办 a10（Windows 执行路径）、⑤ 落在 a12（New Project 默认 `local-codex`）里。
  - **⑦ 一个搬运的拉丁标签在两种语言里两种大小写（`e75a1ba`）**：`runtime.eyebrow` 在 zh 里是 `Agent Runtime`、en 里是 `Agent runtime`。按同一形状扫全表又找出同类：`agents.eyebrow`（`Local Runtime`→`Local runtime`）、资源归属三个标签（`Supabase Organization` 等→小写通用名词）、`preview.branch` 与引用它的校验句 `preview.branchValidation`、`runtime.runMode.dryRun`（`Dry-run`→`Dry run`）。zh 里保持拉丁原样的文案等于没翻译，只是搬运，而搬运必须逐字一致——现在这是一条检查而不是记忆：`cross-locale-identity.test.ts` 摊平英文表，只比对**两边都不写 CJK** 的键，因此不会膨胀成对整个文案表的风格裁判（zh 真译的键按构造排除）。
  - **① 只读探测不再顺带任命执行者（`2048582`）**：点目录里一行同时做两件不相关的事——读该 CLI 的帮助输出，并在它恰好 verified 时把它写进执行者选择。读一台机器不等于给它派活，于是两个意图拆成两个控件（行负责选择，行右侧的按钮负责探测），且行仍是真 `<button>`：为只读动作加控件不该顺手让键盘失去一个原本就有的动作。`.agent-item:disabled` 改 `.agent-item.unavailable`——「CLI 没装」与「只能查看不能选」是两种状态，只有前者该变灰。证据表新增两条：`probeAgent` 函数体不得出现 `setSelectedAgentId`，且 App.tsx 里恰好一个控件在 click 里调探测（多一个是两个意图又被焊回去）。
  - **② 能力探测四处撒谎 + 一处伪测量（`a072c55`）**：期望参数表原本写在 `catalog.ts` 里、与真正定义命令的 `AGENT_ADAPTERS` 分处两文件且已经漂移（aider 查 `--yes` 而 Adapter 传 `--yes-always`，只因为前者是后者子串才没暴露；openclaw 查它根本没有的 `exec`）——现在两表都来自 `non-interactive-switches.ts`，测试拿 `buildAgentExecutionPlan` 真拼出的命令逐组比对，开关按拼写分组（同组任一变体命中即算）才使得「每组至少一个拼写真是 Adapter 传的 token」这条要求可执行；子串匹配改成 token 边界（`--json-lines` 不证 `--json`，`--permission-mode` 里的 `-p` 不是 Claude 的 `-p`）；codex/openclaw 的参数在下层子命令里，从没问过那一层（`probeHelp` 现接受 subcommand，本机 codex 从 `unknown` 变 `listed`）；win32 `shell: true` 下不存在的命令也会由 cmd.exe 回一段「不是内部或外部命令」，旧的 `output.length > 0` 把它当帮助页，于是对**根本没装的 aider** 得出了反向结论——现在只有退出码 0 才算答案。`workspaceWrite` 字段整个删除：它是名为 probe 的函数从 `BUILT_IN_CAPABILITIES` 抄来的静态声明，而它渲染的位置就在展示那份声明的 chip 下一行。
  - **`false` 是两种事实，只有一个关于 Agent**：help 答了而参数不在（`absent`）≠ help 没答或本来就没有参数可找（`inconclusive`，OpenCode 2.0 由脚本调本机 API，实测其 `--help` 连 `api` 这个词都不含）。daemon 无法区分，三态在 Studio `src/lib/capability-verdict.ts` 派生，线上契约只多了「删掉 workspaceWrite」这一项变化；三种文案都点名自己的证据是帮助输出，`capability-verdict.test.ts` 钉住这一点（chip 退回裸三元、判定漏掉 `helpAvailable` 两种植入都红）。
  - **五次植入反证**：去掉 codex subcommand → 2 红；aider 退回 `--yes` → 2 红（含 drift 例）；删退出码闸门 → 1 红（红讯正是「退出 1 且只写 stderr 被判成 nonInteractive: true」）；`documentsSwitch` 退回 `includes` → 2 红；chip 改回裸三元 → 1 红。本轮一开始三处同植（去 subcommand / aider 改 `--yes` / 删闸门）时，「退出码闸门」的红被同一用例里先红的 `--yes` 断言吞掉；回滚前两处、单独留闸门才拿到恰好 1 红，随后把一个 `it` 拆成两个，植入从此不互相掩蔽——与上一轮「注释掉一行照样全绿」是同一类教训的两个方向。fixture 用例改用临时目录 + PATH 前置（`.cmd` 与 sh 双写法、`chmod 0755`、`afterAll` 清理），使「跑起来且退出 0 的 help 才算答案」不依赖本机装了哪些 CLI。
  - **验证**：全仓 `npx vitest run` **33 files / 341 例全绿**（起点 317），Studio 11 files / 74 例；`npm run typecheck` 11 个 workspace 全 0 错（注意：仓库根 `npx tsc -p tsconfig.json --noEmit` 不是可用命令，根 tsconfig 不设 `jsx`，会把 Studio 全量误报）；Studio `vite build` 干净（439.34 kB / gzip 124.03 kB）。真机探测复验：codex / claude-code / codebuddy / hermes 均 `listed`，opencode / aider（本机未装）/ openclaw（超时）均 `inconclusive`。本轮未做浏览器复验：改动全部在只读面板与派生函数上，无写路径，结论取自真机 spawn 与 DOM 无关的源码断言。

- **Studio 走查待办清理第一轮：一个任务只有一个执行者，没有任何一层能悄悄换成 Codex（2026-09-02，`1bf1d65`→`8b1620e` 共 14 刀）**：清掉上一条 2026-09-01 走查待办里**不需要架构决策的全部条目**，并把「谁执行这个任务」这一个事实在四层收敛成一个答案。
  - **文案与标签（已修）**：项目列表表头改为「产品类型」并渲染已格式化的 `Web 端`/`Web app`（待办 4）；zh 下 `Ready for approval` 与 `Awaiting approval` 此前都叫「等待批准」，现拆为两个 key（待办 5，审批闸门的区分恢复）；项目详情页头补交付状态标签、Iteration 标签补「等待 Apply 完成」空态文案（待办 3）；页头 chrome `Export`/`Import`/`Show Diff`/主题 tooltip/`Profile` 徽章与 Runtime 面板裸枚举上提 locale（待办 6/7 的界面自有部分）；Pipeline 编辑器整块硬编码英文上提（待办 7b）。
  - **执行者契约（本轮核心）**：`isAgentExecutable(id) === (AGENT_ADAPTERS[id].status === 'verified')` 是唯一判据，`resolveRuntimeExecutor()` 是「谁执行」的唯一解析点，daemon 两条 Runtime 路由与 storage 两个写入点共用它，拒绝时返 409 + `code: agent_not_executable` + `agentId`，**绝不换一个 Agent 顶上**（`a4dd402`）。此前解析不出来就回退 Codex，一份指名 Claude Code 的 Blueprint 会得到一份 Codex 的运行记录。Studio 因浏览器不能 import 本包（顶层 `node:child_process`）在 `lib/runtime-executor.ts` 镜像同一个字面量，两边测试各自钉死（`d059309`）。
  - **`unsupported`/`candidate` Agent 不可被选中**（`8b435d2`，待办 8）：`adapterStatusOf()` 缺省按 `unsupported` 读，能力探测行、Blueprint 两组单选、Profile 行、Prepare 闸门共用 `canRunTasks`/`canProfileRunTasks`/`canRunSelectedAgent` 一个问句，不各自从 `detected` 推答案。
  - **客户端也不代替用户挑执行者（`8b1620e`）**：`loadAgents()` 曾把目录里第一个可运行 Agent 写进选择，于是迭代页 eyebrow 在 Blueprint 指名 Claude Code 时写着 `Codex`，点「准备」真的会发出一次 Codex 运行（而且 a8c 做的拒绝提示永远不可达）。`firstRunnableAgent()` 删除，目录加载只清除已失效选择；面板允许印出的名字只来自 `runtimeExecutorId()` 的一条链：已准备的运行记录 → 用户显式选择 → 已批准 Blueprint 的 provider（去命名空间）。
  - **Profile id 与 `local-` 命名空间撞车**：Profile slug 由用户命名，本身可能以 `local-` 开头。解析与显示统一改成「先按原样查 Profile，再按剥掉命名空间后查」；否则要么误拒一个合法 Profile（新行为），要么把旧运行记录里的 `local-codex` 原样上屏（旧行为是悄悄回退 Codex）。
  - **测试证据新纪律**：证据表读源码时必须剔除整行 `//` 注释。植入反证时发现「把一行接线注释掉」此前照样全绿，两个证据文件已改造（`agent-selectability.test.ts` / `runtime-executor.test.ts`），剩下三个证据文件同类漏洞待办。
  - **三次植入缺陷证明测试有效**：resolver 悄悄回退 codex → 5 红；删掉 `GET runtime/plan` 的拒绝 return → 新用例红（但邻的大用例从 17s 变成 31.8s 撞上 30s 超时，该机既有贴边风险）；把新加的状态清除注释掉 → 改造后如期变红。`8b1620e` 那一刀另外植入三个：给 `agent-selectability` 加一个 `preferredAgent()` 导出口 → `exports no helper that chooses an Agent on the user's behalf` 红；把 `runtimeExecutorId` 的兜底改成 `'codex'` → `names nobody that it cannot account for` 红；把目录加载重新写成 `payload.agents.find(a => a.detected)` 这种能过编译的默认选 → 「catalog load」证据行红（一次植入 3 例红；三个均已还原，还原后全仓 317 例全绿）。
  - **浏览器复验（真机、全新页面、中英各一次，零写操作）**：目标项目 `12a6dae4`（Blueprint 指名 `local-claude-code`）。eyebrow 为 `Agent Runtime · Claude Code`（不再写 Codex）；进入迭代页时 `GET runtime/plan` 的 409 被分类为 `agent-not-executable`，拒绝行**在点击之前**就显示：中文「Claude Code 无法执行该任务，系统也不会改用其他 Agent。请先选择一个已验证的 Agent 再准备。」/ 英文 `Claude Code cannot run this task, and no other Agent was substituted. Pick a verified Agent before preparing.`；「准备」按钮实测 `disabled=true`，全程 0 次 POST、`window.confirm` 0 次调用。HTTP 侧同项目 `POST runtime/run` 亦 409 同形。截图仍未拿到（Browser 窗口隐藏，`NATIVE_BROWSER_VIEWPORT_UNAVAILABLE`），本轮全部结论取自 DOM 原文。
  - **第一轮复验无效的教训**：子代理沿用了上一会话残留的标签页（HMR 未应用），旧模块仍以 `agentId: 'codex'` 发 POST 并拿到 201（daemon 接受一个 verified Agent 是正确行为），据此得出的「静默替换仍在」结论不成立。本轮以「无运行记录时 eyebrow 是否为 Claude Code」作为页面新鲜度判据，并要求先销毁旧 realm。
  - **本轮新发现（按影响排序；①②⑦ 已于同日第二轮清掉，④⑥ 已于同日 a15 清掉，见本文第一、二条进度；③⑤ 仍未动手）**：① `probeAgent` 点只读能力探测会顺带 `setSelectedAgentId(agent.id)`（`App.tsx:761`）——一个只读动作改变执行者语义状态（✅ 已修 `2048582`：行只负责选择，探测移到行右侧的按钮）；② 能力探测把 `nonInteractive: false` 渲染成 `non-interactive: unknown`，同一行上方 chips 与 Agent 描述又宣称支持非交互，三层对同一件事三个说法（且 win32 下 help 探测本身可能是假阴性）（✅ 已修 `a072c55`：假阴性当场坐实，cmd.exe 对未安装命令回的错误文本曾被当成帮助页；三态文案现在各自点名证据是帮助输出）；③ `probeCodexRuntime()`（`packages/agent-runtime/src/index.ts:97`）无 shell spawn `.cmd`，本机 `codex-cli 0.147.0` 确在 PATH 上却报 `Codex CLI is not available on PATH.`，并把任何 spawn 错误都写成同一句原因（即既定 Windows 路线的一个实例）；④ `POST runtime/run` 的 `body.agentId` 预检分支（`apps/daemon/src/app.ts:735-750`）返不带 `code` 的 409 与另一套英文散文，Studio 只能把后端原文上屏（✅ 已修 `2e1440e`：预检整块删除，机器局部的那一问改用新 code `agent_not_detected`）；⑤ New Project 表单 `runtimeProvider` 默认值写死 `local-codex`（`apps/studio/src/lib/utils.ts:13`）；⑥ Runtime 路由响应里的 `probe: probeCodexRuntime()` 与解析出的执行者无关（Studio 未消费，暂无可见谎言）（✅ 已修 `2e1440e`：plan 与 run 两个响应都去掉该字段，Codex 的健康报告只留在名字就叫 Codex 的 `GET /api/runtime/probe` 上）；⑦ 拉丁标签大小写不一致（✅ 已修 `e75a1ba`）。本条原记录把两个键说成了一个：实际缺陷是 `runtime.eyebrow`（zh `Agent Runtime` / en `Agent runtime`），而 `agents.eyebrow` 的 `Local Runtime` 与 en 的 `Agent runtime` 本来就是两份文案（它的大小写作为同类一并修了）。
  - **上一轮待办里仍未关闭的三项（原四项，待办 2 已于同日关闭）**：待办 1（后端英文文案无 i18n 边界，需用户拍板）、~~待办 2（决策卡不看 productType）~~（✅ 已于同日修掉，见「决策卡与表单基线注记开始读产品类型」那条进度）、待办 7 的「Release 标签名不副实」部分（本轮只修了它的 chrome 文案）、Windows 执行路径显式报错（上面③）。
  - **验证**：全仓 `npm test` **30 files / 317 例全绿**（本轮起点 310），Studio 9 files / 62 例；`tsc --noEmit` 全仓 0 错；`vite build` 干净（438.80 kB / gzip 123.82 kB）。

- **Studio 界面链路走查启动，修掉冷启动鉴权缺陷；发现 Windows 阻断项（2026-09-01）**：开始清 §8-11.1 那条 2026-08-14 至今的债。环境刻意选本机 Windows + `~/.agent-dev/` 全新，等价于外部用户首跑。
  - **冷启动鉴权竞态（已修复）**：`npm run dev` 用 concurrently 并发起 daemon 与 Vite，而 `vite.config.ts` 在**加载配置时一次性**读 `~/.agent-dev/daemon-token` 注入 `__DAEMON_TOKEN__`；daemon 只在首启生成该文件，所以**全新机器首跑必然**注入空串（实测：事后 token 文件长度 64、注入 define 长度 0、`injectedMatchesFile: false`）→ `daemon-auth.ts` 的 `if (token)` 整块跳过 → fetch 不包装 → 全部 `/api/*` 401 且界面无任何解释。§6.1-2 原记录把「Studio 需在 daemon 首启之后再启动」当作无新增约束，但这条顺序外部用户无法满足，本次更正。
  - **修复：bearer 从浏览器移到 dev proxy**。新增 `apps/studio/dev-proxy-auth.ts`（`daemonTokenPath` / `readDaemonToken` / `createDaemonAuthHandler`），`vite.config.ts` 在 `/api` proxy 的 `proxyReq` 钩子里**逐请求**读文件并 `setHeader('authorization', ...)`；删 `src/daemon-auth.ts`、`define`、`src/vite-env.d.ts` 及 `main.tsx` 导入；proxy target 改 `http://127.0.0.1:3737`（daemon 显式绑 127.0.0.1，Windows 下 `localhost` 可能先解析 `::1`）；补 `preview.proxy`，否则构建产物无 API 通道。
  - **顺带关掉一个 dev-only 泄露面**：Vite dev 模块带 inline source map 且端口零鉴权，`define` 注入的 token 任何本地进程都能从 `/@vite/env` 读到（走查过程中我自己触发过一次进日志，已当场轮换 token 使其失效）。改到 proxy 侧后 token 既不进浏览器也不进 `vite build` 产物——`0600` token 文件的边界重新成立。
  - **验证**：`apps/studio/test/dev-proxy-auth.test.ts` 5 例（token 在 handler 构造之后才落盘 → 下一请求即带上；逐请求重读 → 轮换生效；去尾换行；缺失读空串；`AGENT_DEV_DAEMON_TOKEN_PATH` 覆盖）。真机 HTTP 探针：Studio `/api/projects` 200、daemon 直连无 token 401、`/@vite/env` 与 index.html 均不再含 64 位 hex；`npm run build` 后扫描 `apps/studio/dist/assets/*` 亦无 64 位 hex 候选（构建产物侧证据）。全仓 **254/254 全绿**、typecheck 通过。
  - **走查第一阶段（只读）结论**：凭证面板渲染正确——状态行「Secret backend: local-file」、class `credential-backend connected`、note 正确指向本地文件、`GITHUB_TOKEN` 显示 Connected 且值完全不回显；控制台零 error/warning；`/events` SSE 建连，Activity 有事件；zh 切换无 i18n key 字面量泄漏。本机 Projects 为空（daemon 确返 `{"projects":[]}`），故项目详情各标签页本轮进不去，需先经 New Blueprint 建记录。小缺陷：zh 下「Supabase Configuration」标题未译（已修为 `Supabase 配置`）；导航「Agents」经核对**不是缺陷**——本项目中文文案把 Agent 当术语保留（`本地 Agent Runtime` / `Agent 目录` / `刷新 Agents`）；首屏 6 个 `/api` 请求各双发（疑 StrictMode，需确认生产不重复）。
  - **Windows 阻断项（证据已锁，修复路线待用户拍板）**：Agents 页 6 个已装 agent 里 5 个报「version probe failed」。实测根因是**无 shell 的 spawn 撞上 npm shim**：`spawnSync('codex'|'opencode'|'openclaw'|'codebuddy'|'claude', ['--version'])` 全部 **ENOENT / 29ms**，只有原生 `.exe` 的 `hermes` 成功；补 `shell: true` 后 codex/opencode/openclaw/codebuddy 立即出版本（耗时 0.4–4.2s）。次因：版本探测预算 500ms（codex 2s）低于真实耗时；`lookupOnPath` 依赖 `which`（Windows 无此命令，本机靠 hermes 附带的 MSYS `which` 才侥幸工作）。**同一模式存在于 `packages/agent-runtime/src/index.ts:runCodexProcess`，意味着 Windows 用户走 Apply → Feature Task 时 agent 根本起不来**；但该处 `shell: true` 会把 prompt 文本送进 cmd 命令行（注入面），故未擅自改动。
  - **同日已修（探测与发现路径，无注入面）**：`catalog.ts` 新增 `resolveExecutablePath()`——进程内走 PATH + PATHEXT，彻底去掉对外部 `which` 的依赖与每次探测一个子进程的开销；win32 下给 `--version` / `--help` 这两个**固定字面量参数**的探测加 `shell: true`（沿用 `doctor.ts` 已论证的理由，执行路径不照搬）；探测预算 500ms/2s 抬到 5s；PATHEXT 优先于无后缀文件（npm 会同时留 `claude` 与 `claude.cmd`，把前者交给 shell 正是之前挂满超时的原因）；顺手修掉 CRLF 导致的版本号尾部 `\r`。**本机实测：`/api/runtime/catalog` 从 1/6 个 agent 报版本变成 6/6**（claude 2.1.198 / codex-cli 0.147.0 / opencode 1.18.13 / codebuddy 2.136.0 / hermes / openclaw）。`catalog.test.ts` 重写为 6 例（新增 PATHEXT 优先序、无 `which` 依赖、真缺失与显式路径解析），agent-runtime 65/65、全仓 **256/256 全绿**，typecheck 与 build 通过。执行路径（`runCodexProcess`）仍待下面的决策。
  - **走查第二阶段（界面建 Blueprint → Apply 前，已完成）**：经 Studio 表单（professional 模式、`api-tool`、GitHub owner `bayernjf`）创建项目，四个标签页中英文各走一遍。副作用已逐项核：全程唯一写操作是 `POST /api/projects` → 201，其余全 GET；`GET .../apply` 确认为只读（`store.getLatestApplyRun`）；未点 Approve / Apply / Verify / Preflight / Save revision；状态停在 `NEEDS_INPUT`，**未产生任何远端资源**。本机留下一条走查记录 id `cca8ff99-d8bf-4536-b403-c6ebdbfad18d`（本地数据，非交付物，可随时删）。
  - **修掉：`VERIFIED` 徽章是硬编码的（本次走查最重要的发现，属诚实性问题）**：Runtime 卡片对**每一个**已检测 agent 写死 `agent-badge verified` + `t('blueprint.runtimeVerified')`（旧 `App.tsx:2131`），而 `AGENT_ADAPTERS`（`packages/agent-runtime/src/index.ts:115-152`）里 `claude-code` / `aider` / `openclaw` 只是 `candidate`，`buildAgentExecutionPlan` 对 candidate 执行直接抛错（同文件 172 行）。即：界面承诺了一个 daemon 会当场拒绝的保证。铁证：`blueprint.runtimeCandidate`（候选）这个 key 两个 locale 早就有，但**全仓零调用点**——徽章本来就该是动态的；而 §9 「Local Claude Runtime 验证」条目里用户明确定过 `claude-code` adapter 保持 `candidate`，硬编码的 VERIFIED 直接违背了该决策。修法：daemon 两条 catalog 路由把 `adapterStatus` 随响应带出（答案只存在于 Adapter 注册表，不让浏览器从 `detected` 猜），Studio 按字段渲染；新增 `.agent-badge.candidate`（用 `--status-pending`，故意不给绿色）。**验证**：真机 `/api/runtime/catalog` 现返 4 verified / 2 candidate；浏览器复验中英两语言下 Claude Code 与 OpenClaw 确实显示 `CANDIDATE` / `候选`；daemon 契约测试断言每条 agent 的 `adapterStatus === getAgentAdapterStatus(id)`（与装机无关）且 custom agent 为 `unsupported`。
  - **修掉：Runtime 卡片把原始 i18n key 当文字渲染上屏**：key 是拼出来的（`claude-code` → `agentClaudecodeDesc`），而 locale 里叫 `agentClaudeDesc`（名对不上）；`openclaw` 两个 locale 根本没这份 copy；`t()` miss 时**静默返回 key 本身且不打任何控制台告警**，所以直接上屏；`replace('-', '')` 只替首个连字符，三段式 id 必然再泄。修法：新增 `apps/studio/src/lib/agent-copy.ts` 显式 id→key 表，未知 id 返回 `undefined`（渲染空而不是 key），并用 `Object.hasOwn` 防 custom agent 的 launchCommand 命中原型属性；补 `agentOpenclawDesc`（en/zh）。**没补 OpenClaw 的 install 命令**：仓库里只记了它的启动命令、没记怎么安装，编一个等于让用户去跑不可验证的东西（已在代码注释里写明）。新测试 `apps/studio/test/agent-copy.test.ts` 3 例，锁住「表中每个 key 在**两个** locale 都能解析出真文案」（`zh satisfies Translations` 防不住动态拼的 key）。
  - **修掉：中文 `已验证` 徽章被压成竖排一字一行**（`.agent-badge` 是 flex 子项，长 agent 名会把它压到内容宽度以下；中文可在任意两字之间换行，就堆成了一字一行）——加 `white-space: nowrap`，浏览器复验已恢复横排单行。
  - **走查报告里被我推翻的两条子代理结论**（根因完全不同，修的地方也不同）：① 「Iteration 标签代码就是空的 `<>...</>`」不实——`App.tsx:2052-2056` 里有三大块内容，只是全部 gate 在 `applyRun?.status === 'completed'` / `featureTask?.status === 'approved'` 后面，**真实缺陷是没有空态文案**；② 「Web app 默认态渲染 4 个 ownership 输入框」是条件渲染的正常表现，不是缺陷。
  - **复验后确认不是缺陷的三件事**（免得下轮重查）：① 首屏 6 个 `/api` 各双发 = StrictMode dev 双调 effect（`main.tsx` 确用 `<StrictMode>`），生产构建无此行为；② 进入项目详情时控制台那 2 条 409 = `GET runtime/plan` 在无已批准 Feature Task 时的**正确**响应（实测 body：`Approve a Feature Task before preparing a Runtime plan.`），`App.tsx:407` 已显式吞掉不弹错误条；③ 首次打开白屏 + `useI18n must be used within an I18nProvider` 是我在页面开着时改了 `i18n/locales/*`，Vite HMR 换了 context 模块所致，刷新即消失（provider 只有一条挂载路径）。
  - **走查待办（按对 Pilot 的影响排序；处置结果见上面 2026-09-02 那条，此处原文保留为历史现场）**：
    1. **后端生成的英文文案没有 i18n 边界（架构级，中文用户在核心区看到整屏英文）**：决策卡 title/value/reason、dry-run summary、`automaticPreparation[]`、`manualActions[].title/reason/verification`、baseline `summary` 与 `resource.reason` 均来自 `packages/blueprint`（`index.ts:200-262`、`generate.ts:304-310,744-754`）与 provider 包，Studio 只翻译自己的 chrome——**这不是漏翻 `zh.ts`，补 zh 也补不到**。需用户拍板：后端只发 id/枚举、文案上移到 i18n key，还是给 plan 对象加本地化字段。
    2. **决策卡内容与产品类型自相矛盾（中高）**：`getBlueprintDecisions` 不看 productType，`api-tool` 项目照旧显示 `Application baseline: React/Vite, Hono and npm workspaces` + `This is the tested v0.1 Web app golden path.` 和 `Cloud account connection: Supabase, Cloudflare Pages and Vercel Functions`，而同一个 Blueprint 生成的 `PRODUCT_STANDARD.md` 写的是 `Frontend: None (MCP server…)` / `Data and auth: Not provisioned for this product type`。用户会被误导以为要开云资源。修法方向：用已存在的 `baselineProvidersFor(productType)` 驱动决策卡。（✅ 已修 2026-09-02：两张卡都改读 `PRODUCT_TYPE_DESCRIPTORS` 与 `baselineProvidersFor`，即写 `PRODUCT_STANDARD.md` 的那张表；无云资源的四类改印 `None — this product type provisions nothing outside its GitHub repository`，`mode` 仍是 `manual`，GitHub 授权这道人闸门不因「没有云资源」而消失。界面上同一条假陈述的第二处——Blueprint 表单里那句渲染在产品类型选择器正下方的基线注记——也一并拆成两个 key 按类型切换。详见「决策卡与表单基线注记开始读产品类型」那条进度。）
    3. Iteration 标签缺空态文案（根因已澄清，见上）；**项目详情页头完全没有状态标签**（`projectState.*` 仅在 `Dashboard.tsx:48` 用），用户在详情页看不出项目处于哪一步。
    4. 列表 `MODE` 列名与内容不符：表头是 Mode，单元格渲染的却是 `project.productType`（`Dashboard.tsx:47`），真正的 Beginner/Professional 在列表里完全看不到，且值是未格式化的 kebab-case。
    5. 中文审批徽章语义坍缩：EN 的 `Ready for approval` 与 `Awaiting approval` 两个不同状态，zh.ts:548/554 **都写成了 `等待批准`**——而这是审批闸门的关键区分。
    6. 内部枚举/id 直接上屏：`CREATE`、`github:github-repository:create`、`github-repository`、`local-codex`、`standard`、`per pull request`；大小写不一致 `Github` / `the github repository`；单复数错 `1 manual actions`（`generate.ts:747`）。
    7. Release 标签名不副实（内容全是 provider 模拟生命周期，无发布/预览证据区块，也无「尚未到发布阶段」的说明）；`Export` / `Import` / `Show Diff` 与主题按钮 tooltip 在中文下未译；`Profile` 徽章文字硬编码英文（`App.tsx:2147`）。
    8. custom agent 可被选中但 `adapterStatus` 是 `unsupported`（连 dry-run 都会在建计划时抛错）：`runtimeProviderSchema` 现已改为 `z.string()`，handoff 旧记录所称「只列 schema 认得的 id」那道过滤已失效。
- **P1-2 Infisical Secret Backend Adapter 代码完成（2026-09-01，真实云端验证延后）**：用户拍板「凭证系统后端化集成 + 真实验证延后」。`credentials.ts` 后端化——`AGENT_DEV_SECRET_BACKEND=infisical` 时读写在 Infisical 与本地文件间切换，默认 `local-file` **字节级不变**；读走进程内快照（daemon 启动水合 + 保存后重水合），25+ 个同步 `providerCredentialEnv()` 调用点无需异步化；后端不可用时大声失败、**不静默回退**。`InfisicalBackend` 重写为双认证路径（Service Token 走 REST API v4，写操作值进 JSON body 修复 S10；无 token 走 CLI 并如实声明 argv 限制）；删除伪造的 version/history/approval（`Secret` 类型对应字段改可选）；Windows `shell: 'win32'` 兼容。daemon 新增只读 `GET /api/credentials/backend`（无明文）+ Studio 凭证面板后端状态一行。测试全新编写：`secret-backend.test.ts` 19 例 + 凭证后端路由 5 例 + daemon 契约 1 例（**更正**：审计 §6.3-1 所称「26 个库测试保留」不实，secret-backend 此前零测试）。「禁止静默回退」已拿到磁盘哨兵证据（`index.test.ts`）：`AGENT_DEV_CREDENTIALS_PATH` 指向含 sentinel 的真实文件时，后端不可用则 `refreshCredentialCache()` 抛出原因、`loadCredentials()`/`providerCredentialEnv()` 仍抛 `not hydrated`、`getCredentialMeta()` 返回空 keys、失败后文件字节不变；含正向对照（不设后端时同一文件可读）。Studio 面板抽为 `components/CredentialBackendStatus.tsx`，`smoke.test.tsx` +4 例锁住 connected/unavailable 两分支与 noteInfisical 文案互斥；`apps/studio/tsconfig.json` include 补 `test`（Studio 测试此前完全不在 typecheck 范围内，也导致 `--jsx` 未设置）。补测后全仓 **249/249 全绿**，typecheck 与 build 通过。探测脚本 `spikes/infisical-backend/`（离线 + `--online` 回环）已就绪，本轮未跑在线探测；P1-2 状态「代码完成，真实验证待办」，不满足 ✅。
- **审计整改 §6.5：P4 测试补齐全部 4 项（2026-08-31）**：审计整改全部完成。
  - **§6.5-1 storage pipeline 执行测试**：新增「feature task pipeline execution」describe（`packages/storage/test/index.test.ts`）4 例——requiresApproval 步骤暂停且不执行（证明 `isStepApproved` 未批准时拦截）、resume 清除审批门并跑到 completed（断言项目状态推进 VERIFYING）、非 paused 状态 resume 抛错、步骤失败且 continueOnFailure 未设时 pipeline 失败且后续步骤不执行。**测试驱动修复真实缺陷**：`resumeFeatureTaskPipeline` 清除内存 step 的 `requiresApproval` 后未落盘，`executeFeatureTaskPipeline` 重读磁盘仍见审批门导致 resume 无法恢复——现已先 `saveFeatureTask` 落盘再执行。
  - **§6.5-2 MCP 桥 20 工具全覆盖**：新增 2 例覆盖此前仅注解检查的 5 个工具（`get_runtime`、`get_connectors`[注入 stub dependencies 避免真实 CLI 探测]、`get_release`、`get_release_plan`[409 门禁透传]、`revise_blueprint`[revision 2 + 404 透传]），20 工具全部有行为断言。
  - **§6.5-3 advanceDelivery 回归**：非法事件被拒 + 重放幂等此前已有，本轮完成其余项确认事务保障。
  - **§6.5-4 Studio 渲染冒烟**：新增 `apps/studio/test/smoke.test.tsx` 3 例——`renderToString` 渲染真实 `App`（包 ThemeProvider+I18nProvider），断言品牌/Projects/Loading/表头/New Blueprint；内存 `localStorage` stub 满足无 DOM 初始渲染。同步 vitest include 加 `.tsx`，补 `@agent-dev/policy/confirmations`、`@agent-dev/agent-runtime/failure-classification` 两个子路径 alias。
  - **验证**：全仓 typecheck 0 错误；`npm test` 全量 **220/220 全绿**（新增 9 例）；`npm run build` 通过。

- **审计整改 §6.3：清理与一致性剩余 5 项（2026-08-31）**：P2 除 secret-backend 外全部完成。
  - **§6.3-2 install.sh 双入口**：根目录遗留副本（153 行、无任何文档引用）删除，唯一入口收敛为 `scripts/install-macos.sh`。
  - **§6.3-3 死代码**：`buildCodexExecutionPlan`（已被 `buildAgentExecutionPlan` 取代，测试改用后者）、`isPipelineBlocked`（零消费者）删除；`formatDoctorSummary` 经核实被根 package.json `doctor` 脚本消费，**保留**（审计判断修正）；`detectDrift` 按既定决策保留。
  - **§6.3-4 确认字面量收敛**：新增 `packages/policy/src/confirmations.ts` 导出 `CONFIRMATIONS`（23 个字面量 + `ConfirmationLiteral` 类型）作为单一事实源；daemon `app.ts` 23 处 zod schema、Studio `App.tsx` 20 处请求体、MCP 桥 `mcp.ts` 1 处全部改为引用该常量，三处定义不再可能漂移。MCP 桥的防伪造语义不变（字面量仍固定在桥的调用点，调用方无法传入）。
  - **§6.3-5 文档版本对齐**：`handoff.md` ReleaseComposer 步数表述 7 步改 9 步（含真实步骤 id 与 `962932a` 演进说明）；`/api/health` 版本号改为从 `apps/daemon/package.json` 读取（与 MCP 桥同法）；**用户拍板版本号升 `0.2.0`**——全部 13 个 package.json（根 + 3 apps + 9 packages）同步。
  - **§6.3-6 rm -rf**：`storage/src/index.ts` 的 `execFileAsync('rm', ['-rf', ...])` 改为 `node:fs/promises` 的 `rm(path, { recursive: true, force: true })`，消除对 Unix `rm` 二进制的依赖。
  - **验证**：全仓 typecheck 11 个工作区 0 错误；`npm test` 全量 **211/211 全绿**（含此前偶发 flake 的 storage recovery 用例本轮全量并行也通过）。

- **审计整改 §6.4：Windows 兼容（2026-08-31）**：三项全部完成——npm/npx 四处调用点统一 `shell: win32`（注意 CVE-2024-27980 后不能直接 spawn `npm.cmd`，会 EINVAL）、信号用例平台分支断言、symlink 用例 EPERM skip。**Windows 全仓测试首次全绿**（storage 14/14 + agent-runtime 通过；全量并行时 storage recovery 用例偶发资源竞争 flake，单独运行稳定，非回归）。

- **审计整改 §6.3-1：secret-backend 去留决策落地（2026-08-31）**：用户拍板「移除路由、保留库」。daemon 全部 9 条 `/api/secret-backend/*` 管理路由删除（S4 明文出口消除）——核查确认零消费者（Studio 无 UI、管线走 `/api/credentials`、MCP 桥未暴露），双凭证系统并存问题随之消除。`packages/provider-cli/src/secret-backend/` 库保留作为 P1-2 Infisical Adapter 地基（P1-2 落地时库测试全新编写，见最近进度 2026-09-01 条目），P1-2 落地时路由随测试文档一起回归。回归测试：带合法 token 请求 `keys`/`:key` 均 404。daemon 27 + provider-cli 26 例全绿，typecheck 通过。

- **审计整改 §6.2：状态机与校验一致性（2026-08-31）**：P1 三项全部完成。
  - **`advanceDelivery`（§6.2-1）**：`deliveryRuns` + `projects` 两表写入包进同一 SQLite 事务；逐事件比较 send 前后状态——非法事件显式抛 `Event X is not allowed in delivery state Y`，不再被 xstate 静默吞掉。**重放幂等例外**：事件目标状态已是当前状态（恢复路径上 `BASELINE_CREATED` 重发）不抛错——实施中发现并修复了一个连带回归：恢复场景重放曾导致步骤全绿但 run 被误标 `failed`。新增 `workflow` 包 `isEventReplay()`（事件→目标状态映射，`PAUSE`/`RESUME`/`FAIL`/`RETRY` 不参与重放判定）。回归测试：非法事件拒绝且状态不变、重放幂等。
  - **runtime 路由 schema（§6.2-2）**：`runtime/run|execute|retry|cancel` 四条路由改用 zod schema + 确认字面量，`agentId` 加 trim/长度约束，手写 body 解析移除。
  - **未 await 的 persist（§6.2-3）**：`reviseBlueprint` 改 async 并 await persist（原先落库从未被等待），daemon 两处调用点补 await。
  - **验证**：daemon 27 例全绿、storage 新增状态机回归通过（storage 另有 2 例 Windows 符号链接权限失败为已知环境问题，见审计 §6.4-3）、typecheck 0 错误。审计文档补回了上次 commit 丢失的 §6.1-3/4 完成标记。

- **审计整改 §6.1-4：移除 daemon 自更新端点（2026-08-31）**：`POST /api/update`（`git pull` + `npm install` + `build` 的 RCE 面，S2/S12）与 `GET /api/update/check`（名义只读路由上执行 `git fetch`）整体删除，更新本仓库改为用户显式动作（停 daemon → `git pull` → 重启）。MCP 桥 `agent_dev_check_update` 工具随端点一并移除（21 → 20 工具），`docs/mcp-bridge.md` 工具清单与说明同步；Studio 确认无消费点、无需改动。daemon 测试新增「带合法 token 两路由均 404」回归（证明是移除而非仅靠 token 门控），MCP 工具清单断言同步；daemon 27 例 + MCP 5 例全绿，typecheck 通过。**至此审计 P0 网络边界（§6.1 全部 4 项）整改完成**；secret-backend 去留（§6.3-1）仍待决策。

- **审计整改 §6.1-3：URL scheme 白名单落地（2026-08-31）**：堵死 S3（`importRepositoryUrl` 经 `ext::` 协议的命令执行）与 S7（PR 证据 `javascript:` URL 存储型 XSS）。
  - **实现**：`app.ts` 新增 `httpUrlSchema(label)`——`z.string().url()` 之上用 `new URL()` 解析仅放行 `http:`/`https:`；套用到全部四处到达 git 或 UI 的 URL 输入：`importRepositoryUrl`（apply 导入）、PR 证据 `url`、Preview 证据 `apiUrl`/`webUrl`。daemon 源码不再有裸 `z.string().url()`；Studio 其余 `a.href` 核实均为 blob 下载链接，非注入面。
  - **关键顺序保证**：apply 路由 schema parse 在 `git clone` 之前，恶意 scheme 在 400 被拒、任何副作用都不发生。
  - **验证**：新增 4 个契约测试（`ext::`/`file://`/`git@`/`ssh://` 导入 URL 400、http(s) 通过 schema、`javascript:`/`data:` PR 证据 400 而 https 走到交付闸门 409、preview 证据双向拒绝）；daemon 26 例全绿、typecheck 通过。

- **审计整改 §6.1-2：本机 token 鉴权落地（2026-08-31）**：daemon 全部 `/api/*` 路由现要求 `Authorization: Bearer <token>`，未认证请求 401——关闭审计 S2/S3/S4 的「未认证」前提（路由本身仍需按 §6.1-3/4 整改），并缓解 S5 与浏览器 CSRF。
  - **token 生命周期**：`apps/daemon/src/auth.ts` 的 `loadOrCreateDaemonToken()`——首启生成 64 位 hex 随机数，持久化 `~/.agent-dev/daemon-token`（0600、目录 0700，`AGENT_DEV_DAEMON_TOKEN_PATH` 可覆盖）；token 复用不轮换，daemon 重启后 Studio/MCP 不需重新读取。
  - **中间件**：`createDaemonApp` 新增 `authToken` 选项（`startDaemon` 恒传入；不传则不启用，供测试直连 app）；timingSafeEqual 比较；显式豁免仅 `/api/health` 与 `/api/github/webhooks`（后者走自身 HMAC 签名），`/events` SSE 在 `/api/*` 之外（EventSource 无法带自定义头，仅承载事件元数据）。
  - **客户端接入**：Studio——`vite.config.ts` 启动时读 token 文件注入 `__DAEMON_TOKEN__` 常量，`src/daemon-auth.ts` 包装 `window.fetch` 对 `/api/*` 统一附加头（一处覆盖全部现有与未来调用点）；MCP 桥——`callDaemon` 携带 `authorization` 头，token 取自 `AGENT_DEV_DAEMON_TOKEN` 环境变量或同一 token 文件。**（2026-09-01 已变更：Studio 侧改为 Vite dev/preview proxy 逐请求附加，token 不再进浏览器——见「最近进度」同日期条目）**
  - **验证**：新增 6 个契约测试（无/错/畸形 token 401、合法 token 200、credentials/secret-backend/update 路由 401 回归、health/webhook 豁免走确定性 HMAC 路径、token 文件创建与复用）；daemon 22 例全绿、cli MCP 5 例全绿、全仓 typecheck 通过。（**2026-09-01 更正**：此处原文「注意：Studio 需在 daemon 首启之后再启动才能读到 token 文件（此前 proxy 也会失败，无新增约束）」并不成立——`npm run dev` 并发起两个进程，全新机器首跑必然读到空 token，这条顺序要求外部用户无法满足；已改为 proxy 侧逐请求读取，约束消除。）

- **全仓安全与质量审计完成，4 条高危缺口与整改方案落档（2026-08-31）**：三路并行——客观检查、安全审计、代码质量审计；安全高危结论逐一复核过源码，全文见 [审计文档](docs/audit-2026-08-31.md)。
  - **客观检查**：`npm run typecheck` 9 个工作区全部通过；`npm test` 199 例中 196 通过，3 个失败全是 Windows 平台问题（其中真问题：`execFileAsync('npm')` 未加 `shell: true` 导致质量门在 Windows 误判，`packages/storage/src/index.ts:777`）。
  - **四条高危（未认证 + 网络可达，Pilot 阻断项）**：① daemon 无鉴权监听 `0.0.0.0`（`apps/daemon/src/index.ts:45` `serve()` 未传 hostname，全文件无 auth 中间件）；② `POST /api/update` 直接 `git pull` + `npm install` + `build` 的未认证 RCE（`app.ts:257-279`）；③ `importRepositoryUrl` 仅 `z.string().url()` 校验后原样传给 `git clone`，`ext::` 协议可执行任意命令（`app.ts:41`、`:608`）；④ `GET /api/secret-backend/:key` 无鉴权返回凭证明文及历史版本（`app.ts:330-341`），直接违反"凭证不出本机"设计。这四条使确认字面量、审批门等上层设计在网络层失效；另有中危：审批门不验身份、`/api/runtime/catalog` 可注册任意命令被探测执行、`javascript:` URL 存储型 XSS。
  - **确认干净的面**：全库无硬编码密钥、无 eval/shell 拼接、无路径穿越/SSRF；所有子进程均为参数数组；MCP 21 工具边界（不暴露 approve 类、确认字面量服务端写死、凭证值不出本机）经逐工具核对与 `docs/mcp-bridge.md` 一致。
  - **质量发现**：`advanceDelivery` 非法事件静默吞掉且两表写入非事务（`storage/src/index.ts:1555-1573`，即此前「生产交付路径」条目记录的未验证边界）；4 条 runtime 门禁路由绕过 zod（`app.ts:819/850/863/876`）；secret-backend 子系统孤儿化（约 615 行 + 9 条路由，无 Studio/MCP/测试消费者，零测试，且是高危 ④ 的载体）；根目录 `install.sh` 与 `scripts/install-macos.sh` 双入口、前者无文档引用；`handoff.md` 称 ReleaseComposer 7 步、实为 9 步。
  - **整改方案**：五批（P0 网络边界 → P1 状态机与校验 → P2 清理一致性 → P3 Windows 兼容 → P4 测试补齐）含验收标准见审计文档 §6-7。**P0 完成前不把安装脚本分发给外部用户**。需用户决策：secret-backend 去留（默认建议移除）、版本号是否升 0.2.0。

- **agent-dev MCP 桥完成化：可启动、省 token、扩至 21 工具（2026-08-29）**：08-28 首版（提交 `f5bb602`，9 工具）之后连走三步，当前工具面与设计见 [mcp-bridge.md](docs/mcp-bridge.md)。
  - **可启动入口 + token 经济 + 超时预算 + 工具注解（提交 `2051e29`）**：全仓 noEmit 无构建产物，新增 `apps/cli/bin/agent-dev.mjs` shebang launcher——注册 tsx 后直接执行 TS 源码（不打 bundle：storage 用 `require.resolve` 定位 sql.js 的 wasm，ESM 打包会断），外部客户端从此有了可用入口（`node .../agent-dev.mjs mcp`）。`dry_run` 默认只回清单 `{id,title,path,bytes}` + `artifactCount`，传 `artifactId` 才回单文件全文；实测四种产品类型 revision-1 计划 9.6–17.8 KB → 3.7–6.1 KB（省 60–75%）。全部工具带 MCP annotations（`readOnlyHint`/`destructiveHint`/`idempotentHint`/`openWorldHint`），客户端据此决定是否要求人工确认。daemon 调用预算 30 秒（`AbortSignal.timeout`），「不可达」与「接受请求但不响应」分成两种错误文案；服务器版本号从 `apps/cli/package.json` 读取，不再是占位。
  - **设计文档落档（提交 `0ef61d9`）**：新建 `docs/mcp-bridge.md`，记录定位、客户端配置（mcpServers JSON）、工具清单、刻意不暴露清单与测试方式。
  - **工具面 9 → 21（提交 `a267b88`）**：新增 10 个只读工具——交付中间态 `get_apply`/`get_quality_gate`/`get_acceptance`/`get_delivery_report`（后者是 markdown 最终报告）与资源环境 `get_baseline_plan`/`get_release_plan`/`get_runtime`（catalog+profiles 合并）/`get_connectors`（preflight+discovery 合并）/`get_credentials_meta`（只抛 key 名，凭据值不出本机）/`check_update`（只跑 git fetch）；新增 2 个推进工具——`create_feature_task`（bridge 先 GET 项目取当前 `blueprintRevision` 注入，客户端无法伪造版本号）与 `submit_acceptance`（summary + criteriaConfirmed；验收不是批准，`approve` 类依旧一个不暴露）。`run_quality_gate` 刻意不做——它触发真实 runtime 执行，属外部副作用，与 Apply/Preview 部署同类。基线审批、Apply、Preview 部署、生产批准、凭据写入仍不走 MCP；`REQUEST_RELEASE` 确认字面量继续写死在 bridge 服务端。文档随本提交同步为 21 工具版；测试仍是真实 HTTP + 真实 daemon app + `InMemoryTransport` 全链路，断言工具清单不含 `approve` 类。

- **v0.2 P2-4 闭环 + agent-dev MCP + 类型重命名与主题收尾（2026-08-28）**：
  - **P2-4 无托管部署类型的交付状态机闭环（提交 `1436742`）**：08-27 项目 4 暴露的缺口正式用正常 API 关闭——状态机保持类型无关，`PR_OPEN` 增加 `REQUEST_RELEASE` 转移；daemon 校验只有无托管部署目标的蓝图可走捷径（托管产品在 PR_OPEN 仍被 preview gate 拒绝），此前 `preview/deploy` 与 `release/request`/`release/approve` 对 api-tool/landing-page 会因 `noHostedDeploymentReason` 返回 409。此类产品的 release 走 manual distribution：记录 single confirmation step（确认 generated/DISTRIBUTION.md 的人工分发步骤），evidence `distribution: "manual"`（无 URL、无 deploy 调用），请求/批准分离与署名批准人等人闸门保持原样。新增 127 行测试。至此无需再手动 `store.advanceDelivery` 推进。
  - **agent-dev MCP（提交 `f5bb602`）**：`apps/cli/src/mcp.ts` 新增 stdio bridge 到 daemon API，外部 Agent 可经 MCP 驱动 Agent-Dev 而不绕过其闸门。只暴露只读与进度工具；daemon 确认字面量在 bridge 服务端持有，任何客户端都无法伪造；批准/验收动作保持 Studio 人工；gate 冲突返回引导到 Studio 而非静默失败；凭据与部署端点不通过 MCP 上抛。133 行实现 + 128 行测试。
  - **web-saas → web-app 产品类型重命名 + 存量迁移（提交 `af9f83a` / `e99e912`）**：「Web SaaS」暗示的是商业模式而非交付表面，改名为「Web app」（Web 端），与 desktop/mobile 命名一致。enum id 改动覆盖 blueprint 生成、质量检查、provider 规划、Studio 文案与失败消息；新增 storage 迁移重写已持久化的 projects 与 blueprint revisions，保证 strict zod parsing 在存量库上继续工作（迁移测试 50 行）。同步更新 `docs/blueprint-spec.md`、`docs/multi-product-delivery-plan.md` 与 handoff 的引用，dated 规划文档保留 web-saas 原措辞作为历史记录。
  - **Studio 主题收尾（提交 `4c13d55` / `f425f33`）**：原生 input/select/textarea 此前没有共享样式、以浏览器默认渲染，且若干内联样式引用了设计系统里不存在的 token。现统一从 token 调色板取样式、select 使用 token 色 chevron，替换未定义的 `--error`/`--bg-secondary`/`--text-secondary` 引用；agent 徽章、diff 卡片、导入结果条、retryable 失败 pill 的硬编码 hex 颜色接入既有 color-mix pill 模式（暗色主题下生效），删除三个指向系统外颜色的死 `var()` 兜底。
  - **Analytics consent banner 默认隐藏（提交 `f40e1d4`）**：banner 内联样式带两条 `display` 声明，尾部 `display:flex` 生效导致每次加载都渲染（即使用户已接受或拒绝）。删除第二条声明，banner 初始隐藏、仅 consent 脚本可显示；新增生成 index.html 的回归测试。

- **v0.2 四项功能完成 + 项目 4 端到端交付（2026-08-27）**：
  - **P0-3 失败分类完善**：新增 7 种失败分类模式（生产分支不匹配、工作区需恢复、schema 迁移、云资源不匹配、外部 symlink 拦截、依赖安装失败、Node 版本），修复 agent CLI 模式双向匹配，新增 24 个单元测试，全量 155 测试通过。
  - **项目 4「MCP Word Tools」端到端交付完成（4/4，首个非 web-saas 类型 api-tool）**：Blueprint → 基线审批 → GitHub 仓库创建（`bayernjf/mcp-word-tools`）→ Apply → Feature Task（Add count_tokens tool）→ Runtime 执行 → Quality Gate（5/5 测试通过）→ Acceptance（approved by feng）→ PR #2 合并到 dev → dev 合并到 main → **DELIVERED**。**发现设计缺口**：api-tool/landing-page 等无托管部署类型无法通过正常 API 推进到 DELIVERED（preview/deploy 和 release API 因 noHostedDeploymentReason 返回 409），已记录为 P2-4，本次通过直接调用 store.advanceDelivery 手动推进。
  - **P0-2 一键 macOS 安装脚本**：`scripts/install-macos.sh` 自动安装 Homebrew → fnm → Node.js 22 → agent-dev 依赖 → build，配置代理环境变量（`~/.agent-dev/env`），创建 daemon launcher + launchd plist 实现登录自启和崩溃重启，安装后自动运行 doctor 验证。注册为 `npm run install:macos`。
  - **P1-1 导入现有 Git 仓库**：Apply API 支持 `importRepositoryUrl`，导入后自动确保 dev 集成分支存在，用 `.agent-dev-import` 标记导入仓库，executeApplyRun 检测后保留用户历史不做 wipe-and-reclone，新增冲突检测（比较 Blueprint 期望文件与现有文件，记录 conflicts/wouldAdd/keptExisting 到 apply-manifest.json），用户文件永不被覆盖。
  - **P1-3 Blueprint 升级 Review 提示**：新增 `GET /blueprint/revisions` 列出所有版本及元数据，新增 `POST /blueprint/revise` 验证并创建新版本后自动生成与上一版本的 diff，返回 reviewRequired 标志和变更列表，Studio 可在 Apply 前提示用户 Review。复用已有的 diffBlueprints 递归比较器。
  - **GitHub Actions 修复**：Vitest 的 `toBeGreaterThan` 不支持第二个参数（错误消息），那是 Jest API。修复为 `expect(value, message).toBeGreaterThan(0)`。

- **三个缺陷从根因修掉（2026-08-26，提交 `ec1de1a` / `2358b9d` / `f2e4278`）**：
  - **缺陷 26：Blueprint 不再声明并不存在的部署目标**（补完缺陷 24 的另一半）。`deployment.web.provider` / `deployment.api.provider` / `data.provider` / `data.auth` 是硬编码 `z.literal`，所以即使基线计划已经按类型停止索取这几家 provider，一个 MCP server 的 blueprint 仍然写着"Cloudflare Pages + Vercel Functions + Supabase Auth"——对交付事实的假陈述，而这几个字段正是最终报告和后续消费方判断"存在什么"的依据。四个字段放宽为含 `'none'` 的枚举，取值改由 `baselineProvidersFor(productType)` 决定（与基线计划同一事实源）。放宽前先量过影响面：这三个字段在测试之外没有读取点，composer/release 不受影响，也不会让任何 workspace 变成 `staleConfig`；放宽是枚举加成员，不能拒绝已持久化的行。证据：23 行持久化 blueprint 复验 `failing: 0`。
  - **缺陷 27：8 个交付状态没有 i18n 文案**（缺陷 20 的复发）。Dashboard 渲染 `t(\`projectState.${project.state}\`)`，字典只有 7 个成员，用户在界面上看到的是原始 key `projectState.NEEDS_INPUT`。上一次的修法（显式 key 映射表）没治住根因——真正的成因是 `as KeyPath` 断言把缺失藏到运行时，外加一个 `?? fallback` 死代码（`t()` 查不到时返回 key 本身，永不为 `undefined`）。这次改成类型强制：`Project.state` 从 `string` 收紧为 `DeliveryState`，两份字典 `satisfies Record<DeliveryState, string>`，断言与死兜底删除。实测删掉任一成员会在字典、译文、调用点同时编译报错。规则记入 [studio-i18n-design.md](docs/studio-i18n-design.md) 6.1。
  - **缺陷 28：错误横幅只有首页一个出口**。全局 `error` 状态由 Dashboard 渲染，实际影响比"凭证错误串到首页"更大：约 40 条错误路径里，项目详情页与发布页产生的错误在原地完全不可见，直到用户回到首页才看到。横幅上移到 shell 渲染，错误在产生它的视图里出现；清理时机按 `view.kind` 而非整个 view，切项目内 tab 不会吞掉还没读的消息。
  - **缺陷 29：PATH 探测超时被当成"命令不存在"**。`which` 没跑起来（超时 / EAGAIN / ENOENT）与 `which` 返回非零走了同一分支，都报 `Command not found on local PATH.` 并写进进程级缓存——于是一次负载抖动就把装好的 Agent 在 Studio 里标成不可用、daemon 拒绝启动它并返回 409，且一直错到进程结束。现在区分"探测完成说不存在"（可缓存）与"探测没跑完"（未知，永不缓存，在更长预算上重试一次）。这个 flake 在本轮全量测试里自己复现了两次。语义表记入 [agent-runtime-catalog.md](docs/agent-runtime-catalog.md) 3.1。
  - 全量 131 测试通过，typecheck 干净；界面实跑复验：10 个项目全部渲染真实文案（`rawKeys: []`），强制凭证校验失败时错误显示在 Credentials 视图并在离开后清除。

- **两个阻塞性缺陷从根因修掉（2026-08-25，提交 `25b3d9e` / `0a51cca`）**：都是"真跑一次非 web-saas 的端到端交付"暴露出来的，单测一个都测不到。
  - **缺陷 24：云资源清单按产品类型收敛**。生成物早就按类型分叉（api-tool 不产 `wrangler.toml`/`vercel.json`），供给层却没有：`createBaselinePlan` / `getManualActions` / `providerSpecsFromBlueprint` / Studio 归属表单四处各自硬编码同一份四家云清单，于是一个 MCP server 也要填 Supabase 组织和 Vercel team 才能过审批——而填了就会真被建出三个产品永不接触的云项目。清单收进 `PRODUCT_TYPE_DESCRIPTORS[type].providers` 当唯一事实源（web-saas 四家 / landing-page github+cloudflare / 其余四类仅 github），映射类型收紧为 `Record<ProductType, …>` 使第七种类型不填这行就编译不过。不用的 provider 键是**缺席**而非空数组（registry 对每个存在的键取 `resources[0]`，空数组会把 `undefined` 递给适配器）。`preview/deploy` / `preview/plan` / `preview/cleanup` / `resolveReleaseContext` 加 409 守卫：composer 的流水线固定跑 `apps/api`/`apps/web`，无托管目标的类型走进去会去部署从不生成的目录，且是在它已记下 `vercelProjectMayExist = true` 之后。证据见 [多产品交付计划](docs/multi-product-delivery-plan.md)。**未做**：~~`deployment.web`/`deployment.api` 的 `z.literal` 未放宽到 `'none'`，那会波及 composer 与已持久化 blueprint。~~ 已于 2026-08-26 补完（缺陷 26，提交 `ec1de1a`），实测不波及 composer，也不影响已持久化数据。
  - **缺陷 25：持久化 schema 缺默认值把老数据读死**。任何 pre-existing 项目的路由都返回 HTTP 500——`9e693c8` 往 `productBlueprintSchema` 加 `desktopShell` 时没给 `.default()`，`createBlueprint` 总会写它，但它存在之前写下的行没有，于是 `getProject` 里的 `parse` 对每行老数据抛 `ZodError`。字段清单不靠猜：探针遍历 `blueprint_revisions` 全部 safeParse，实测 23 行里 20 行读不出来。补上与旧实现语义一致的默认值（beginner / 空串 / tauri）——这是**读迁移**，不是放宽输入校验。修后同一探针 `rows: 23, failing: 0`，10 个项目全部恢复 200，含持有线上预览的 `Receipt Test` 与 `Workspace Verify Fresh`（它们的 cleanup 路由此前已不可达）。

- **Studio 交互与视觉打磨（i18n + 双主题 + 交互重构，2026-08-24）**：
  - **i18n + 双主题已实施**（提交 `90696d4`）：`apps/studio/src/i18n/`（en/zh 字典，默认英文，技术术语保留英文）+ `apps/studio/src/theme/`（ThemeProvider/useTheme + CSS token 双主题，`index.html` 防 FOUC 脚本，favicon 暗色描边 `#7A8695`）。设计文档 `docs/studio-i18n-design.md`、`docs/studio-theme-design.md` 状态已从「待实施」更新为「已实施」。
  - **视图状态系统**：`View` 类型（dashboard / project / credentials / agents / activity）+ `App.tsx` 按视图拆分；Dashboard 独立为 `views/Dashboard.tsx`，工具函数抽到 `lib/`；Credentials / Agents / Activity 独立视图复用右侧栏真实面板，替换 "Coming soon" 占位；项目详情页移除重复的项目列表。
  - **项目详情页阶段 Tab 化**：12 个交付区块按 `ProjectTab` 四阶段分组——Blueprint（规划：decisions + dry-run plan）、Delivery（交付：PR/Preview 证据 + baseline + quality gate + preview deploy）、Iteration（迭代：feature task + runtime + acceptance）、Release（发布：production + final report + provider simulation），一次只显示一个阶段，顶部 tab bar 切换；右栏移除 Credentials/Agents/Activity 面板，只留 Blueprint 表单 + Connections。
  - **纯桌面布局（不再适配移动端）**：移除全部移动端响应式断点；`.shell` 设 `min-width: 1200px` + `body overflow-x: auto`（窗口窄于 1200px 时横向滚动而非挤压内容），`.sidebar` `position: sticky; left: 0` 在滚动时固定左侧。见 `apps/studio/src/styles.css`。
  - **其他交互修正**：topbar 固定 `height: 76px`（切换 tab 顶部高度一致）；侧边栏 Logo 改为可点击按钮返回首页。
  - **遗留已知问题**：~~凭证加载失败的错误串到首页展示（全局 `error` 状态未按视图隔离）~~ 已于 2026-08-26 修掉，见上方缺陷 28。

- **项目 3（`Link Vault`）已完整交付上线（3/3，2026-08-24 完成）**。三个真实项目验证目标全部达成：
  - **Runtime 用 OpenCode 2.0 + 免费模型跑通**：Codex 因火山方舟套餐额度耗尽持续 429，改为 OpenCode 2.0 会话式执行。OpenCode 2.0 去掉了 v1 的 `-p --print`，非交互执行走 `api` 子命令 + `opencode2-driver.mjs`（会话创建 → 轮询 `message` 端点 → 按 `finish === 'stop'` 判定完成）。驱动在 `576b701` 提交（`fix(runtime): complete opencode runs on finish=stop and switch to nemotron-3-ultra-free`）。
  - **免费模型选型（实测结论）**：目录里挂着的免费模型 ≠ 网关实际可用。`ling-3.0-flash-free`/`deepseek-v4-flash-free` 实测 401/400（网关不认模型名或凭证无权）；`big-pickle` 实测 429 限流；`hy3-free` 已废弃。最终锁定 `nemotron-3-ultra-free`（内置 `opencode` provider 的免费模型，1M 上下文 / 128K 输出，工具调用可用），设为 OpenCode 默认模型。默认模型定义见 `packages/agent-runtime/src/index.ts` 的 `opencode.buildCommand`。
  - **功能与证据**：功能「API 保存并返回链接 + 页面表单与列表」。Quality Gate `passed`（lint/typecheck/5 单测/build/smoke），验收由 `feng` 批准（status=approved）。工作区提交链 `121deab`→`9ac2290`→`ab6fe73`→`640cee1`→`204f709`。
  - **真实云端交付**：PR #1（feature→dev，`quality` SUCCESS、MERGEABLE，merged）；Preview 7/7 步 completed（首跑联合 Smoke 因新建 Pages 域名生效延迟失败，重跑即过——已知环境问题，非代码缺陷），`pr-1.link-vault-web-pr-1.pages.dev` + `link-vault-api-pr-1`；生产发布从 `main` 独立 checkout（修复路径 `962932a` 验证），9/9 步 completed，evidence 记录观测值。**独立复验**：生产 API `https://link-vault-api.vercel.app/api/links` 200、生产页面 `https://link-vault-web.pages.dev` 200、POST `/api/links` 真实返回 `{link:{...}}`。
  - **生产发布卡点修复（首次尝试暴露并修掉第 9 个真实缺陷）**：`release/approve` 首跑第一步 `checkout-production-source` 失败——被验收提交 `640cee16` 不在 `main` 上（PR #1 只合到 `dev`，而生产从 `main` 发布）。修复：补开 PR #2（dev→main，`quality` SUCCESS、MERGEABLE，merged）把验收提交带上 `main` 后 `release/retry` 一次通过。**注意：`release/approve` 只校验「被验收提交是 `main` 祖先」，不会自动把 `dev` 合入 `main`——若 PR 目标分支是 `dev`，发布前需显式把 `dev` 提升到 `main`（对 `requirePullRequest: true` 即补开 dev→main PR）。**
  - **项目 3 产出**：仓库 `bayernjf/link-vault`（PR #1 feature→dev、PR #2 dev→main）；生产 API `link-vault-api.vercel.app`、生产页面 `link-vault-web.pages.dev`；批准人 `feng`。遗留 Preview 资源 `link-vault-api-pr-1`（Vercel）与 `link-vault-web-pr-1`（Cloudflare）可走 `preview/cleanup` 清理。

- **项目 2（`Workspace Verify Fresh`）已完整交付上线（2/3，2026-08-23 生产批准后完成）**。此前状态是 PR + Preview、生产停在人工批准前；用户批准后走 `release/request` + `release/approve`，生产从 `main` 独立 checkout 发布（修复路径 `962932a` 的第一次真实云端验证）。详情见下节（写于 2026-08-23）：
  - **归属修订**：旧 Blueprint 里四个归属字段全是 `test` 占位。发新 revision 3，把 `githubOwner`/`vercelTeam` 换成 `bayernjf`、`cloudflareAccount` 换成 `Jiangfengkxi@outlook.com's Account`、`supabaseOrganization` 换成 `jiangfengkx@163.com's Org`（前三个用 `gh api user`/`vercel whoami`/`wrangler whoami` 现场核实，与 `Receipt Test` 一致）。基线、Feature Task、交付验收三处闸门都按新规则具名 `feng` 通过——这是 Studio 新闸门输入框之外，通过 API 第一次验证「每个闸门都要求具名」。
  - **真实 Provider 接入**：`providers/apply` 创建私有仓库 `bayernjf/workspace-verify-fresh`；Vercel/Cloudflare 同名 Preview 项目已存在（上一轮 `workspace-verify-fresh-*` 按用户要求保留），noop 记录归属；Supabase 走 Manual noop。
  - **Feature Task + Codex 执行**：功能是「API 新增 `GET /api/version` 返回版本号，页面渲染 `API v1.0.0`」。Codex 改了 3 个文件 23 行（`apps/api/src/index.ts`、`apps/web/src/main.tsx`、`apps/api/src/health.test.ts`），本地 Quality Gate `passed`，人工验收批准后平台开 PR #1、状态 `PR_OPEN`。
  - **本轮修掉第 7 个真实缺陷（Codex 创建外部 symlink 绕过产物提交拦截）**：Codex 为了跑测试，把 `/private/tmp/scaffold-check3/node_modules` 以**绝对路径符号链接**挂进 workspace。生成器模板的 `.gitignore` 写的是 `node_modules/`（目录模式），而目录模式不匹配符号链接，于是平台把这个死链提交进了产品仓库——推上 GitHub 后任何 clone 都得到指向 `/private/tmp` 的无效链接。修复分两处：`commitAgentChanges` 新增「workspace 外部符号链接」拦截（`lstat` 识别 symlink，`readlink`+`resolve` 判断是否逃出 workspace，命中则 `git reset` 并把该次运行判 `failed`，与 `.env` 拦截同一套哲学）；生成器模板 `.gitignore` 从 `node_modules/` 改为 `node_modules`（同时匹配目录、文件和符号链接）。新增回归测试，`npm test` 110/110 全绿。当前 workspace 已同步 `.gitignore` 并把死链移出索引（提交 `1179738`），`.agent-dev/apply/.../revision-3` 干净。
  - **Codex 版本不兼容（环境问题，非产品缺陷）**：本机 PATH 上有三个 codex——`/opt/homebrew/bin`（0.142.3，handoff 验证过的版本）、fnm node20 全局（0.147.0）、`/usr/local/bin`（0.139.0）。原 Daemon 进程因 PATH 顺序解析到 0.147.0，该版本与 `~/.codex/config.toml` 的 `ark-code-latest` 模型不兼容：输出刷 `ERROR codex_core::util: ReasoningSummaryDelta without active item` 直到 15 分钟超时被 SIGKILL。重启 Daemon（homebrew 0.142.3 优先）后 retry 一次通过，功能提交 `24a5972`。**建议卸载或降级 npm global 的 codex 0.147.0**，否则任何依赖 PATH 顺序的工具都可能再踩。同时 Daemon 的 PATH 需同时含 node22（运行时）、homebrew（codex 0.142.3）和 fnm node20 全局 bin（`vercel`/`wrangler`），否则 Vercel 认证会报 `Vercel is not authenticated`。
  - **Preview 部署卡在联合 Smoke，是 Cloudflare 证书延迟，不是代码缺陷（已恢复并补跑通过）**：`preview/deploy` 前 6 步成功，仅最后联合 Smoke 需要 HTTPS 访问刚建的 preview 域名，被未就绪的证书挡住。诊断结论：全局两层 `*.pages.dev` 证书正常（生产 `receipt-test-web.pages.dev` → 200），但**项目级三层 `*.project.pages.dev` 证书走代理时返回 TLS `handshake failure`（alert 40）**——连 4 小时前 7/7 通过的 `pr-1.receipt-test-web-pr-1.pages.dev` 当时也 TLS 握手失败，说明是网络环境在此期间变化，而非部署代码问题。证书恢复后补跑，**7/7 步全部 `completed`**：`pagesUrlSource: cli-output`、精确 CORS `corsOrigin` 严格等于 `ALLOWED_ORIGIN`（`https://pr-1.workspace-verify-fresh-web-pr-1.pages.dev`），Evidence 写入 `.agent-dev/previews/workspace-verify-fresh-pr-1.json`。独立复验：页面 HTML 正确注入 API 域名、`GET /api/version` 真实返回 `{"version":"1.0.0"}` + 200。
  - **本轮修掉第 8 个真实缺陷（生成的 CI 在首个 PR 必然失败）**：脚手架模板 README 明说「首次 `npm install` 才生成 `package-lock.json`、之后由用户提交」，但生成的 `quality.yml` 用的 `actions/setup-node@v5` 默认开启依赖缓存，在仓库根搜不到 lock 文件就硬报 `Dependencies lock file is not found` 并失败——**第一个 PR 的 CI 永远跑不过，除非用户手动补 lock 文件**。项目 2 的 PR #1 `quality` 就因此 `FAILURE`。修复：模板 `quality.yml` 给 `setup-node` 加 `cache: ''`（禁用缓存探测），让 `npm install` 自己生成 lock 文件；同时对项目 2 workspace 真实 `npm install` 生成 `package-lock.json` 并提交推送（去掉此前 Codex 挂的 `/private/tmp` symlink）。重推后 PR #1 `quality` 转 `SUCCESS`、`MERGEABLE`。**2026-08-25 从根因收尾**：`cache: ''` 只压住了症状，真根因是模板不产出 lockfile。现在七类模板共用一个 `qualityWorkflow()`，工作流改 `npm ci` + `cache: npm`，并在 `publishPullRequest` 加前置断言——`package-lock.json` 未提交就拒绝推分支（交付流程里 `installDependencies` 本来就会真跑 `npm install` 并提交它）。已在 `receipt-test` PR #8/#9 的真实 Actions 上验证：`cache: npm` 按 lockfile 哈希建了缓存，`npm ci` 真装了 245 个包。
  - **项目 2 待办**：生产发布（`release/request` 后由用户本人 `release/approve`）——这将是「生产从生产分支 checkout 发布 + 要求被验收提交是该分支祖先」这条修复路径（`962932a`）的第一次真实云端验证。当前 PR #1 `quality` 已绿、`MERGEABLE`，待合并 PR 进 `dev` 后即可发起发布。

- **第一个真实项目已完整交付上线（`Receipt Test`，第 8 节第 7 项的 1/3）**。从 Blueprint 到生产全部走真实 Provider，状态机终点 `DELIVERED`，功能是「显示 API 连接状态的收据页面」。
  - **真实资源与证据**：仓库 `bayernjf/receipt-test`（PR #1 `feature/agent-dev/revision-5 → dev`，GitHub Actions `quality` 通过后合并，合并提交 `21d0e75`，`dev` 携带被验收的 `553a8e0`）；生产 API `https://receipt-test-api.vercel.app`，生产页面 `https://receipt-test-web.pages.dev`；批准人 `feng`。已在平台报告之外独立复验：API 返回 `200 application/json`，带正确 Origin 时回精确 `access-control-allow-origin`、带 `https://evil.example.com` 时**一个 CORS 头都不返回**；线上 JS bundle 里能找到本次功能的中文串（`管理个人收据`、`连接状态`、`已连接`、`连接失败`），证明上线的是功能而非脚手架。
  - **这一轮修掉 6 个真实缺陷，没有一个是单元测试自己能发现的**（全部由真实链路暴露）：
    1. **Agent 写的代码从来没被提交**（`874fd3c`）。流水线里每次 commit 都只 `git add` 自己刚写的报告文件，Agent 自己不提交，于是被推送、被评审的分支上只有脚手架——人工验收的那个功能根本不会上线。现在 Runtime 运行成功后由平台提交 Agent 的改动。
    2. **`git add -A` 会把密钥和 Provider 状态提交进产品仓库**（`7d3b6b0`）。生成脚手架此前不带 `.gitignore`，而 workspace 里有真实凭据的 `.env`、`.vercel/`、`.wrangler/`、`.agent-dev/`。补全生成的 `.gitignore`，并加一道拦截：暂存区出现 `.env` 时**不提交**，把该次运行降级为 `failed` 并说明原因（提交密钥不可事后修复；此处不能用 `throw`，运行状态已写成 `running`，抛错会把运行卡死且无法重试）。
    3. **新仓库没有 PR 的基线分支**（`5e38f69`）。`gh repo create --push` 只发布 feature 分支，架构第 10 节要求的 `feature/* -> dev -> main` 因此第一个 PR 就开不出来。改为在基线（root）提交上创建声明的 `dev`/`main` 并把 `main` 设为默认分支——用基线而不是当前 HEAD，是为了不让待评审的功能已经躺在生产分支上。
    4. **已存在的仓库永远补不到这两个分支**（`89b3585`）。上一条只在"新建仓库"分支里执行，而 `Receipt Test` 的仓库是修复前建的，重跑 `providers/apply` 也不会补。改为 apply 每次都确保声明的分支存在（容忍 `Reference already exists`）。这条就是被真实仓库逼出来的。
    5. **PR 只能靠人手抄 URL**（`a39be2b`）。新增 `POST /api/projects/:id/delivery/pull-request`（确认串 `OPEN_PULL_REQUEST`）：平台自己推送并开 PR，再回填证据。五道前置校验：Blueprint revision 一致、Feature Task 已批准、交付已验收、Apply 运行已完成、工作区干净；推送前校验 `origin` 必须等于资源清单里记录的仓库（否则会把产品发到没人记录的地方），并要求 HEAD **包含**被验收的提交（不是相等——验收之后平台还会提交自己的报告）。`POST .../delivery/pr-evidence` 保留为人工兜底。
    6. **生产发布用的是被保护的部署 URL**（`8afb9bd`）。`vercel deploy --prod` 回传的是不可变部署地址，它被 Deployment Protection 挡着（302 到 `vercel.com/sso-api`），于是健康检查把一个健康的 API 判成坏的；更严重的是下一步会把这个用户访问不到的地址写进 `VITE_API_BASE_URL`，**发出一个连不上自己 API 的生产前端**。改为 `vercel inspect --format=json` 取别名并使用最短的那个（长的带团队作用域，同样受保护）。这次失败恰好挡住了一次坏发布。
  - **本轮暴露的两处架构缺口已于 2026-08-23 修掉**（在项目 2 之前，`962932a`、`0dbd15c`）：
    1. **生产是从本地 workspace 发布的，不是从生产分支**（`962932a`）。`ReleaseComposer` 从不 checkout `main`，也不检查被验收的提交是否已合并，与架构第 10 节「生产从 `main` 出」矛盾——生产上跑的代码可能从未落到 `main`，无法从生产分支复现线上版本。现在发布前先 clone/fetch/reset 记录仓库的生产分支（每次尝试都 reset，避免重试发出上一次残留的位），校验被人工验收的提交是该分支 HEAD 的祖先（不是则拒绝并提示先合 PR），再在这个 checkout 上装依赖、跑质量门禁、构建和部署；Evidence 记下 `repository/branch/commit/acceptedCommit`。没有记录仓库或没有验收时，`release/plan` 直接给出原因、`release/request` 返回 409，Studio 把原因显示出来并禁用按钮，而不是静默发布 workspace。
    2. **人工闸门的身份口径不一致**（`0dbd15c`）。基线、Feature Task、交付验收三处的 `approvedBy` 会回落到字面量 `local-user`（revision 5 的验收报告就带这个占位名），而生产批准要求具名（`feng`）。现在四处统一：API 强制要求 approver，Studio 在每个闸门收集姓名并记在浏览器本地，输入为空时不发请求。
    - 两处都有测试覆盖（`npm test` 109 项全绿），但**尚未在真实云端跑过一遍**——真实验证要靠项目 2。Studio 的三个新输入框只做了类型与构建校验，尚未在浏览器里渲染过：现存项目都已越过这三个闸门，等项目 2 的新 revision 重新打开基线闸门时再看。已在浏览器里确认的只有发布区块的阻塞文案（现存项目没有记录仓库，显示"没有记录仓库…先 apply 真实 GitHub Provider"并禁用按钮）。
    - **规则本身也补进了文档**（`96fd261`）：架构第 9 节「dev 与 production」原先只说 `main` 即生产、没说发布来源，实现才得以偏离，现在明确写下「生产从生产分支的独立 checkout 发布，且该分支必须已带上被验收的提交」；`docs/implementation-plan-v0.1.md` 与 `README.md` 的生产链路状态同步为"真实云端跑通一次，但走的是修复前的路径"。
  - **遗留真实资源（未清理）**：Preview 侧 Vercel `receipt-test-api-pr-1`、Cloudflare Pages `receipt-test-web-pr-1`（清理入口 `POST .../preview/cleanup`，确认串 `CLEANUP_PREVIEW`）；生产侧 `receipt-test-api`、`receipt-test-web` 是交付物，不应清理。另有前一轮的 `workspace-verify-fresh-*` 两个 Preview 项目仍在账号里。
  - **环境前提（会被误判成产品缺陷）**：本机所有 `*.vercel.app` 对不走系统代理的进程都是 DNS 污染（连不存在的域名都能解析出地址），必须用系统代理，且 Node 的 `fetch` 需要 `NODE_USE_ENV_PROXY=1` 才读代理变量。Daemon 必须带 `https_proxy`/`http_proxy`/`no_proxy=localhost,127.0.0.1`/`NODE_USE_ENV_PROXY=1` 启动，否则 `verify-api-health`、`verify-joint-smoke` 会报 `fetch failed`。另外新建的 Cloudflare Pages 域名有几秒才生效，第一次联合 Smoke 失败、重跑即过（已确认是域名生效延迟，未误记为缺陷）。

- **生产交付路径与失败 workspace 恢复已实现**（本节写于 2026-08-21，当时真实云端未跑；真实云端已于 2026-08-23 跑通，见上一条）。此前 Daemon 只覆盖到 Preview，`handoff.md` 第 8 节第 7 项因此被阻塞；现在两条前置路径都在：
  - **生产发布**：新增 `ReleaseComposer`（`packages/deployment-composer/src/release.ts`），按架构第 10 节顺序编排 9 步：`checkout-production-source → install-release-dependencies → verify-release-quality → deploy-api-production → verify-api-production → build-web-production → deploy-web-production → verify-production-smoke → write-release-evidence`（其中前两步与生产分支校验是 2026-08-23 `962932a` 补上的，最初为 7 步）。它**故意不关闭 Vercel Deployment Protection**——那对一次性 Preview 站得住，对生产是错的，因此写成了一条负向断言测试防止将来被悄悄改回来。生产项目名不带分支后缀（一个产品只有一对生产项目），生产 Web origin 由 Cloudflare Pages 项目 apex 推导（Blueprint 里没有生产域名字段），这让 API 的 `ALLOWED_ORIGIN` 与被验证的 URL 在构造上必然相等。
  - **两道人工闸门**：新增 `release_runs` 表（migration 0005）与 `POST .../release/request`、`.../release/approve`、`.../release/retry`。`approve` 必须带 `approvedBy` 与 `summary`，空值被拒（错误信息要求说明"谁批准的"）；没有批准就调用 `approveRelease` 会被状态机拒在 `AWAITING_APPROVAL`，且不写任何日志行。Evidence 记录的是**观测值**（HTTP 状态、content-type、实测 CORS 响应头、页面字节数），不是 `passed` 这类判定常量——有一条测试断言序列化后的 observations 不含 `"passed"`。
  - **失败/过期 workspace 恢复**：`POST .../apply/recover` 不在原地修复，而是新建 `revision-N-recovery-M` 的干净 workspace，把旧的留在磁盘上并先报告它的 Git 状态（分支、HEAD、`status --short`、`diff --stat`）。workspace 可用时该接口返回 409，避免退化成常规重新 Apply。`apply_runs` 新增 `recovery_index` 让同一 revision 的多次运行有确定顺序（`created_at` 在同毫秒插入时做不到）。
  - **同时修掉四个真实缺陷**：Provider 项目名未 slug 化；`FAILED.RETRY` 固定回到 `VERIFYING`（失败的发布会被送错状态，现按失败处回到 `RELEASING`）；生成产品的 CI 钉在已废弃的 actions 版本；Preview Evidence 的判定字段是硬编码常量。**注意**：第三项让所有已存在的 workspace 立即变成 `staleConfig`——这正好是恢复路径的第一个真实用例，Daemon 测试就是这么验的。
  - **未验证边界**：`advanceDelivery` 的两次写入仍不在同一事务里（既有问题，本轮不扩大也不修复）。真实云端生产发布已于 2026-08-23 在 `Receipt Test` 上跑通（由用户本人按下批准，我不会代按），并暴露了「发布用被保护的部署 URL」这个缺陷。
- **CI 首次真实运行暴露一个环境依赖测试**：`quality` 在 PR #3 上失败，原因是 `apps/daemon/test/app.test.ts` 断言 runtime catalog 含 `id: 'codex'` 的内置 Agent，而 catalog 的设计是只返回 PATH 上真实存在的内置 Agent，runner 上没装 Codex CLI 因此返回空数组。这个测试只在装了 Codex 的机器上能通过，是测试依赖本机环境而非产品缺陷；已改为断言路由真正拥有的契约（200、数组、每项 detected 且有 launchCommand、内置项 source 正确）。修复方式经过 CI 条件复现验证：用剥掉 codex 的最小 PATH 跑，先确认 `which codex` 返回 1，再确认全部 74 个测试通过，排除同类环境依赖测试潜伏。同时把 `actions/checkout` 与 `setup-node` 升到 v5（v4 target 已废弃的 Node 20，被强制跑在 Node 24 上并告警）。PR #3 → `dev`、PR #4 → `main` 均已合并，`main` 上 `quality` 为绿。随后本节文档变更经 PR #5 → `dev`、PR #6 → `main` 合并，`main` 当前为 `23d4e6c`，`quality` 仍为绿。
- **Studio 启用产品 logo**：此前 Studio 完全没有 favicon，侧边栏用的是 lucide 通用 `Boxes` 图标，与 landing 站没有任何视觉一致性。logo 从 landing 站 `public/favicon.svg` 原样复制（保持两边字节一致），挂为 favicon 并替换侧边栏品牌位。注意：**未做浏览器肉眼验证**（本机无可用预览浏览器），仅验证了 dev server 下两个资源均 200、构建产物包含它们且 `index.html` 引用正确。
- **市场分析补入实证注记**（`docs/market-analysis.md` 6.1）：壁垒清单此前全部是判断，真实云端首跑为其中"真实 Gate 和证据链"一项提供了数据支撑，同时说明为何结论不是移除模板生成器——模板不构成壁垒但承载新手模式，该修的是它的冻结形态。
- **Dual Preview 真实云端端到端已跑通（7/7 步），过程中修掉 5 个真实缺陷**。最终 Evidence：`.agent-dev/previews/workspace-verify-fresh-preview.json`，`pagesUrlSource: cli-output`，`apiHealth` / `exactCors` / `pageContainsApiUrl` / `jointSmoke` 全部 passed。已在编排之外独立复验：分支别名与每次部署的哈希域名两个 Pages URL 都返回 200 且 HTML 中带正确的 API 域名，API 对别名 Origin 回精确 `access-control-allow-origin`。修掉的缺陷：
  1. **生成的 API 模板在 Vercel 上永久挂起**。`export default handle(app)` 返回 Web fetch 风格的 `Response`，但 Vercel 按传统 `(req, res) => void` 签名处理默认导出并丢弃返回值，请求永远拿不到响应（Vercel 运行时日志：`WARN: default export returned a Response`）。根路径能瞬间 404 而 `/api/health` 挂满 40 秒，正好排除了网络因素。改为按 HTTP 方法导出 fetch-style handler（`export const GET/POST/OPTIONS = handle(app)`）；本地 dev 的 `serve()` 守卫从宽泛的 `NODE_ENV !== 'production'` 改为精确的 `!process.env.VERCEL`，避免删掉 `serve()` 破坏 `npm run dev`。
  2. **生成的 API 模板没有 CORS 中间件**。Composer 一直注入 `ALLOWED_ORIGIN`，但模板从不读它，响应完全没有 `access-control-allow-origin`，而健康检查要求它精确等于 CORS origin。补上 `hono/cors`，`origin: process.env.ALLOWED_ORIGIN ?? '*'`。
  3. **生成的前端从不消费 `VITE_API_BASE_URL`**。Composer 注入了变量、写了 `.env.preview`，但模板里没有任何引用，构建产物里自然找不到该 URL，联合 Smoke 的"页面包含 API 地址"必然失败（该检查只读页面 HTML，即使 bundle 里有引用也不够）。`index.html` 增加 `<meta name="api-base-url" content="%VITE_API_BASE_URL%">` 走 Vite 的 HTML 变量替换，`main.tsx` 改为真的去 `fetch(${apiBaseUrl}/api/health)` 并渲染状态——这让 Golden Path 的"前端跨域调用 API"变成真实行为而非文档描述。
  4. **`WRANGLER_LOG: 'none'` 同时破坏了幂等性和 URL 解析**。Cloudflare 建项目那步的幂等判断依赖 stderr 里的 `already exists` 文本，而该环境变量把这句话压掉了（手工复现：带该变量时 wrangler 退出码 1 且无任何输出，不带时 stderr 明确给出 `A project with this name already exists ... [code: 8000002]`），导致第一次能建、之后每次重跑必挂；部署那步同样被压掉了 Wrangler 回传的真实 Pages URL，使 `pagesUrlSource` 永远退化成 `derived-fallback`。两处都移除该变量，并加了断言 create 调用 env 不含 `WRANGLER_LOG` 的回归测试——原有那条"已存在项目"测试直接 mock 出 `already exists` stderr，因此永远发现不了这个问题。
  5. **联合 Smoke 的 CORS 校验对象错了**。API 的 CORS 锁在**分支别名** `preview.<project>.pages.dev`，但 Smoke 拿 Wrangler 回传的**每次部署哈希域名**去校验，必然 mismatch。改为统一用别名校验：别名才是 Reviewer 打开的稳定链接，哈希域名每次部署都变。此前该检查只是因为 URL 解析失败退化成别名才"碰巧"通过——缺陷 4 修好、真实哈希域名第一次被解析出来后，这个矛盾才暴露。
  - **环境前提（非代码问题，但会阻塞复现）**：本机直连访问不了任何 `*.vercel.app`（TLS 连接被重置），必须走本机代理；Node 的 `fetch` 默认不读代理环境变量，Node 22.23 需要 `NODE_USE_ENV_PROXY=1` 才生效。另外 shell 默认 Node 20 会让 `wrangler` 直接拒绝运行（要求 ≥22）。代理链路本身有抖动，健康检查偶发 `fetch failed`，手工 curl 显示第一次 000、第二三次 200，重跑即过（未误记为代码缺陷）。
  - **免长期凭据路径已在真实环境确认**：真实 Vercel 项目在 `vercel api -X PATCH --input <file>` 后 `ssoProtection` 与 `passwordProtection` 均为 `null`，不再只是单元测试断言。
  - **现存真实资源**：Vercel 项目 `workspace-verify-fresh-api-preview`、Cloudflare Pages 项目 `workspace-verify-fresh-web-preview` 仍在账号里，未清理（清理入口 `POST .../preview/cleanup`，`confirmation: CLEANUP_PREVIEW`）。
- **Preview 部署前新增 workspace 产物校验，并修复状态库路径二义性**：
  - 新增 `verifyWorkspaceArtifacts()`（`packages/blueprint/src/workspace.ts`），在创建任何外部资源之前校验 Apply workspace。存在性检查覆盖全部生成产物；内容比对只覆盖部署配置产物（`vercel.json`、`wrangler.toml`、产品 CI），因为应用源码本就会被 Agent 的功能任务修改，全量比对会把正常改动误判为漂移。Daemon 的 `GET .../preview/plan` 与 `POST .../preview/deploy` 均已接入，不可用时返回 409。这挡住了一类真实故障：workspace 被冻结在生成它的那版 generator 上，后续 generator 修复不会回填，旧 workspace 会带着无效配置直接进入部署（且 `apply/retry` 只接受 `failed`，已完成的 Apply 没有受支持的重生成路径）。
  - 用真实数据验证有效：对 `Receipt Test` revision-2 workspace 返回 409、`staleConfig: ['apps/api/vercel.json']`、`missing: ['apps/web/src/main.tsx']`。追查后发现该 workspace 已被两次失败的 Codex 运行破坏（workspace git log 有两组 `runtime: start Codex execution` / `runtime: failed`，`git status` 显示 `D apps/web/src/main.tsx` 而 `index.html` 仍引用它）——这正是 `codex-runtime.md` 列为未验证的"失败 workspace 恢复"场景的真实实例，缺失的是产品源码而非配置，重生成配置无法修复。
  - 因此另建 project `Workspace Verify Fresh` 走一次本地 Apply（纯本地模拟器，`noExternalChanges: true`），得到当前模板的干净 workspace，`preview/plan` 返回 200、`usable: true`。上述真实云端端到端就是在这个 workspace 上跑通的。
  - 修复 Daemon 状态库路径二义性：`databasePath` 原先基于 `process.cwd()`，而 `npm run -w @agent-dev/daemon dev` 会把 cwd 设为包目录，导致 `apps/daemon/.agent-dev/` 与仓库根 `.agent-dev/` 两个数据库并存、项目状态被静默拆分（我自己就因此查错了库）。新增 `resolveWorkspaceRoot()` 向上寻找声明了 `workspaces` 的 `package.json` 作为锚点，并在启动日志打印实际使用的数据库路径。遗留数据已迁移到仓库根 `.agent-dev/`（88M，含两个 Apply workspace），`apply_runs.workspace_path` 里的两条绝对路径同步重写并验证目录存在；迁移前的空库保留为 `.agent-dev/agent-dev.sqlite.empty-pre-migration`，迁移前备份在 `/tmp/agent-dev.sqlite.premigration`。
  - 收尾时 `npm run build` 暴露一个由本次改动引入的真实回归：`workspace.ts` 用 `node:fs/promises` 读产物，而它被 blueprint 的 barrel 再导出，Studio 在浏览器里 import barrel，于是 `node:fs` 被拖进 Vite 打包并直接构建失败（`"readFile" is not exported by "__vite-browser-external"`）。typecheck 和 test 全绿也发现不了——只有 build 会。改为通过 `@agent-dev/blueprint/workspace` 子路径导出，barrel 不再引用它；Daemon 与其测试改走子路径，根 `vitest.config.ts` 的 alias 改为数组并把子路径规则排在前面（alias 是前缀匹配，裸包名规则会把子路径重写成不存在的目录）。这也正是上一条新增的 `quality.yml` 会拦住的那类问题。
- **`VERCEL_TOKEN` 硬依赖已移除，Composer 端到端阻塞解除**：`vercel api` 子命令能复用 CLI 现有登录态发认证请求（已用只读 `vercel api /v9/projects` 取得真实数据验证）。`disableVercelDeploymentProtection()` 现在分两条路径：设置了 `VERCEL_TOKEN` 走原 REST API `fetch`，未设置则走 `vercel api -X PATCH /v9/projects/{name} --input <body.json>`。请求体必须经 `--input` 文件传入，因为 `--field` 会把 `null` 强制成 `""`（已用 `--generate=curl` 干跑确认）。`deployVercelPreview` 的前置检查从"必须有 token"改为 `ensureVercelAuth()`：有 token 或 `vercel whoami` 成功即可。这也消除了原先的实现不一致——同文件其他步骤（`project add`、`deploy`、`project rm`）本就走 CLI 会话，只有这一步降级到裸 `fetch` 而需要长期凭据。两条路径均有单元测试，Composer 现有 15 个用例全部通过（另加 release 10 个）。注意 `vercel api` 标注为 beta；若将来要在 GitHub Actions 等无交互登录环境运行 Composer，仍需 token（v0.1 为 local-first，Daemon 跑在本机）。真实云端端到端已重跑通过（见本节首条）。
- **Agent-Dev 自身质量门禁已建立**：新增 `.github/workflows/quality.yml`（`npm ci` → `typecheck` → `test` → `build`，带 `concurrency` 取消旧运行）。此前项目为其生成的产品生成 CI，自己却没有任何 CI。同时修复了一个真实缺陷：`npm ci` 在 Node 20 下必然失败（`wrangler@4.120.0 → @cloudflare/kv-asset-handler@0.5.0` 要求 node ≥22，`.npmrc` 的 `engine-strict=true` 使其成为硬错误），而 `package.json` 仍声明 `>=20.20.0`。已新增 `.node-version`（`22`）作为本地 fnm 与 CI `actions/setup-node` 的唯一来源，并把 `engines.node` 提升为 `>=22.0.0`。
- **Dual Preview 部署编排已实现为正式产品代码**：新增 `packages/deployment-composer` 包，`DeploymentComposer` 按 7 步幂等编排 Vercel API Preview → 关闭 Vercel SSO/Password Protection → API 健康验证 → VITE_API_BASE_URL 注入 → 前端构建 → Cloudflare Pages Preview → 联合 Smoke → Evidence 写入。精确 CORS origin（`https://<branch>.<project>-web-<branch>.pages.dev`，替换 Spike 中的 `*`），临时项目清理 API 支持 PR 关闭后删除 Vercel/Cloudflare 项目。Daemon 新增 `POST /api/projects/:projectId/preview/deploy`、`GET .../preview/plan`、`POST .../preview/cleanup` 三个路由；Studio 在 Quality Gate 通过后显示 Dual Preview 部署区块。
- **PR 关闭自动清理已实现**：Daemon 的 `POST /api/github/webhooks` 仅接受 HMAC SHA-256 验证通过的 GitHub `pull_request.closed` 事件。部署请求传入 `pullRequestNumber` 时，Preview 分支固定为 `pr-<number>`；Webhook 使用该编号推导 Vercel/Cloudflare 临时项目名并执行清理。无效签名、非 PR 事件和未匹配本地项目不会触发删除。本地 API 测试覆盖成功清理、签名拒绝和事件忽略；真实云端清理仍需与 Composer 一起复验。
- **Deployment Composer 端到端阻塞已修复**：补上了 Spike 验证过但正式代码遗漏的 Vercel SSO Protection 关闭步骤——在 `deployVercelPreview` 成功后通过 Vercel REST API `PATCH /v9/projects/{name}` 将 `ssoProtection` 和 `passwordProtection` 设为 `null`，否则 `*.vercel.app` URL 被 Deployment Protection 挡住导致健康检查超时。`VERCEL_TOKEN` 获取路径改为 `providerCredentialEnv() ?? process.env.VERCEL_TOKEN` 双路获取。新增根级 `vitest.config.ts` 用 `resolve.alias` 解析 workspace 内部包依赖，修复了 vitest 无法解析 `file:` 协议 workspace link 的问题（此前 3 个测试文件因模块解析失败无法加载）。
- **Deployment Composer 端到端配置修复**：补上了 Spike 验证过但正式代码遗漏的 Vercel SSO Protection 关闭步骤，并修复生成模板的 Vercel runtime 配置；生成 API 现在使用 `@vercel/node` builder 和 Hono `hono/vercel` adapter。
- **Provider 与验证可靠性修复**：根级 `npm test` 现在直接执行一次 `vitest run`，与根级测试配置一致；所有 GitHub CLI 的发现和创建调用都注入 Agent-Dev 保存的 `GITHUB_TOKEN`；凭证保存或删除后会废弃 Provider CLI 可用性缓存。资源清单改为写入资源级事实（外部 ID、URL、非敏感元数据）而非原始通用状态。Cloudflare Preview 证据会优先记录 Wrangler CLI 回传的实际 Pages URL，并标识 `cli-output` 或 `derived-fallback` 来源。
- **凭证管理 Phase 2 已实现**：`verifyCredentials()` 通过 CLI（gh/vercel/wrangler/supabase）验证各 Provider Token 有效性；Studio 凭证面板新增首次引导模式（无凭证时自动进入分步引导）、Supabase 手动配置区块（遵循用户决策：Supabase 不做自动化，仅引导用户手动创建项目后填入 URL/Key）、自定义第三方 API Key 管理和凭证验证 UI。
- Dual Preview Spike 已通过真实云端验证：Vercel API 部署（`/api/health` 公网可访问）、Cloudflare Pages 部署、跨域通信和 API URL 注入均取得真实 Evidence。解决了 Vercel SSO Protection 阻塞公网访问、`vercel.json` 配置、API Handler 兼容性、部署目录和 Cloudflare 构建注入等问题。详见 [Dual Preview Spike](docs/spikes/dual-preview.md)。
- Supabase Auth Spike 已确认采用 Manual 降级路径（路径 C）：由用户手动完成 Supabase 项目创建和凭证管理，Agent-Dev 负责展示最小人工步骤和凭证注入，RealProviderRegistry 已实现自动降级为 ManualProviderAdapter。详见 [Supabase Auth Spike](docs/spikes/supabase-auth.md)。
- **Blueprint 多产品形态（M1/M3 推进中，提交 `62d4bba` / `336443f` 起）**：本地 Agent Runtime 选择已在 professional 模式开放——`runtimeProvider` 改为 enum（codex/opencode/claude/aider/openclaw/codebuddy），从 `/api/runtime/catalog` 检测到的 Agent 中挑，daemon plan/prepare 不再硬编码 `codex`；Studio 表单新增 Runtime 卡片。产品形态 `productType` 改为 enum（web-saas/landing-page/browser-extension/desktop/mobile/api-tool），表单可勾选，按路线图顺序逐个落地模板引擎：
  - **web-app / landing-page**：已生成真实代码（React/Vite + Hono 与静态站两条 Golden Path）。
  - **browser-extension（Stage C）**：已生成真实 MV3 脚手架（Vite + `@crxjs/vite-plugin`：manifest/popup/options/background/content + 应用商店发布交接 README），不接入 v0.1 Cloudflare/Vercel/Supabase 云管线，仅交付本地可构建产物。详见 `packages/blueprint/src/generate.ts` 的 `buildBrowserExtension`。**已真实验证「可构建」**：把生成物落到 `/tmp/ext-build-check` 后 `npm install` + `npm run quality`（`tsc --noEmit && vite build`）通过，产出 `dist/manifest.json`（MV3、service-worker-loader、content script 注入）。这一步真跑一次暴露并修掉两个必然失败的缺陷：(1) 生成的 `tsconfig.json` 没有 `lib: DOM`、没有 `skipLibCheck`、`types` 缺 `node`，`tsc --noEmit` 直接在 vite 自己的 `.d.ts` 上报错（`Cannot find name 'Buffer'`），第一个 PR 的 CI 必挂——与项目 2 缺陷 8 同一类；(2) manifest 引用了 `icons/icon128.png`，但产物是纯文本、生成器无法产出 PNG，`vite build` 报 `Could not load manifest asset`。修复：补 `lib`/`skipLibCheck`/`@types/node`，manifest 去掉 `default_icon` 并在 README 交接里要求发布前自行补齐图标。已加回归测试锁住这两点。
    - 另修掉 HEAD（`1a22754`）上两个已提交但 typecheck 就红的缺陷：Studio 产品形态单选框用的是不存在的 i18n key（`productType.<type>`，实际在 `blueprint.productTypeXxx`，界面上会渲染出原始 key），以及 Runtime 单选框把 catalog 的 `agent.id: string` 直接当成 `runtimeProvider` 枚举写入。现在形态标签走显式 key 映射表，Runtime 只列 `runtimeProviderSchema` 认得的 id。
  - **desktop（Stage D，Tauri v2）**：技术栈决策为**先 Tauri，Electron 留作专业模式可选**（参考项目 `soft-desk` 用的是 Electron）。`buildDesktop` 产出 Vite/TypeScript webview（`index.html` / `src/main.ts` 通过 `invoke('app_version')` 真实走一次 IPC，IPC 断了会立刻显形）、Rust 核心（`src-tauri/` 下 `lib.rs` / `main.rs` / `build.rs` / `Cargo.toml`）、`tauri.conf.json`、占位图标生成脚本、`.gitignore`，以及带 `dtolnay/rust-toolchain` 与 Linux webview 依赖的 quality 工作流。**已真实验证**：`/tmp/gen-check-desktop` 冷启动跑 `npm install` + `npm run quality`（`typecheck` → `vite build` → `rust-check`=`cargo check`）全绿，再跑 `npm run bundle` 产出 macOS `Gen Check.app` 与 `Gen Check_0.1.0_aarch64.dmg`（未签名、未公证）。生成的 GitHub 工作流已在真实 CI 跑过（`receipt-test` PR #7，3m45s 绿）。真跑暴露两个缺陷：(1) `tauri::generate_context!` 编译期就要 `src-tauri/icons/icon.png`，缺图标直接 `proc macro panicked`——和插件的图标问题同源，但桌面端删不掉，改为模板附带 `scripts/ensure-icon.mjs` 用 `node:zlib` 现场写占位 PNG 并挂在 `rust-check` 前；(2) 质量契约 `spec.quality.required` 对所有类型硬编码五项检查，落地页真跑到第二步就 `Missing script: "typecheck"`，现按类型收敛为 `QUALITY_CHECKS` / `qualityChecksFor()`（web-saas 五项 / landing-page `lint+build` / extension `typecheck+build` / desktop `typecheck+build+rust-check`），回归测试对每个已实现类型都校验声明与脚本一致。签名、公证、Windows 代码签名、自动更新分发与商店提交仍是人工步骤。
  - **mobile / api-tool / desktop-electron（Stage D 补齐）**：三类模板全部落地，`notSupportedArtifact` 随之删除——六种产品类型现在都生成真实脚手架。mobile 是 Expo SDK 52 + expo-router（`app/_layout.tsx` / `app/index.tsx` / `app.json` / `eas.json`，bundle id 去掉连字符）；api-tool 最初是 Hono on Vercel 的 API-first 单包，随后（2026-08-25）判定它只是 web-saas 去掉前端的子集、既无真实内容也无形态区分度，已改为 **MCP server**（见下一条）；desktop 加 `desktopShell: 'tauri' | 'electron'`（默认 tauri），Electron 分支产出 main/preload/renderer 三层（`contextIsolation: true` + `nodeIntegration: false`，渲染进程只能走 preload 桥）与 `electron-builder.yml`。**已真实验证**：三份生成物都冷启动 `npm install` 后跑通自己的 `npm run quality`（api-tool `lint→typecheck→unit→build`、electron `typecheck→build`、mobile `typecheck`，并用一行故意的类型错误确认 mobile 的 typecheck 不是空跑）。**未做**：未启动 Electron 窗口、未跑 Expo 模拟器、未跑 EAS Build（生成的工作流已在真实 CI 跑过，见第 8 条）。真跑暴露缺陷 23（`declare global` 在非模块文件里 → `TS2669`，桥接类型移入 `src/desktop.d.ts`）。签名/公证/商店提交改为每类模板产出 `generated/DISTRIBUTION.md`（Apple Developer ID + notarytool、Windows 代码签名、EAS credentials、App Store / Play / MS Store 提交），因为证书与账号天然是人工资产。
  - **api-tool 改为 MCP server（2026-08-25）**：原 `/api/health` + `/api/echo` 是空壳，且和 web-saas 走同一条 Git → CI → Vercel 链路，撑不起一个独立形态。改造后 `buildApiTool` 产出 MCP（Model Context Protocol）server：`src/server.ts` 用 `registerTool` + zod `inputSchema` 注册工具，`src/index.ts` 带 shebang 走 `StdioServerTransport`，`package.json` 声明 `bin` 与 `files`，消费方是 MCP 客户端（Claude Desktop / Cursor）的配置文件而**不是 URL**——不部署、不建云端项目，这才是它真正独立的交付链路。webhook 接收器与 HTTP tool endpoint 仍归 web-saas 的 API workspace，不另立形态。SDK API 形状**不靠记忆**：联网检索被拒（403，与 Codex 文档同类）后改为从 registry 装 `@modelcontextprotocol/sdk@1.30.0` 读其类型定义实测确认（`registerTool` 为当前 API，旧 `tool()` 已 deprecated；zod 4.4.3）。**已真实验证**：冷启动 `npm install` 后 `npm run quality`（`lint → typecheck → unit(3 tests) → build`）全绿，单测用 `InMemoryTransport.createLinkedPair()` 连真实 `Client` 覆盖工具发现/真实调用/坏参数拒绝；另用 `StdioClientTransport` 真 spawn 一次 `node dist/index.js`，确认 shebang 保留、`inputSchema` 正确暴露（`text,topWords`）、调用返回 `words: 5 / sentences: 2 / frequent: three (2), two (2)`、空 `text` 判 `isError`，诊断走 stderr 未污染 stdout 的 JSON-RPC 通道。**未做**：未在真实客户端里注册运行，未 `npm publish`。
  - 部署平台可组合（Cloudflare/Vercel 任意组合）仍是 M2 待做。详见 [可定制化方案](docs/customizable-blueprint-plan.md) 与 [多产品类型交付方案](docs/multi-product-delivery-plan.md)。
- 真实 Provider Adapter 端到端验证通过：GitHub 仓库创建、Vercel 部署、Cloudflare Pages 部署、Supabase 自动降级。验证项目 `e2e-test-real`，GitHub 仓库 `bayernjf/e2e-test-real`，Vercel URL `e2e-test-real-bayernjfs-projects.vercel.app`。
- `fix: resolve Vercel CLI non-TTY hanging and stderr output in adapter`：修复 Vercel CLI 在非交互环境挂起（添加 `--no-wait` + `CI=true`）和 stdout 为空（discover 改为 `stdout || stderr`）的问题。
- `feat: add real CLI-based Provider Adapters with auto-degradation`：新增基于 CLI 的 GitHub/Vercel/Cloudflare Provider Adapter，通过 RealProviderRegistry 统一编排，支持 CLI 可用性自动检测和 Manual 降级。
- 凭证与环境变量管理方案设计完成，详见 [凭证管理方案](docs/credential-management.md)。
- `823affa feat: add runtime retry history`：Runtime 失败运行现在保留 attempt 历史，提供显式 Retry API/UI，报告不会覆盖之前的失败证据。
- `35f7eaf feat: add local agent runtime catalog`：Daemon 已能探测内置 Agent，并接受名称 + 启动命令的 custom Agent 配置。
- 当前 Agent Catalog 已迁移为 Key-Value 配置：内置目录为 `packages/agent-runtime/agents.builtin.conf`，Custom 配置为 `.agent-dev/agents.conf`；内置未安装项隐藏，Custom 未安装项置灰。
- Agent 检测采用打开 Studio 时一次检测 + 用户点击刷新按钮主动检测，不做实时监控、文件监听或后台轮询。
- 当前本机 CLI 状态：`gh`、`vercel`、`codex`、项目本地 `wrangler@4.120.0` 已安装；`supabase` 未安装。Wrangler OAuth 已授权。
- 2026-08-09 真实双 Preview 尝试：Cloudflare OAuth 已授权；Vercel 临时项目可创建且部署状态为 `READY`，项目级 `ssoProtection/passwordProtection` 均已置空，但 `*.vercel.app` 公网域名在当前网络连续返回超时/ECONNREFUSED；每次 Vercel 临时项目均已自动清理，Cloudflare 项目未创建。需要在可访问 Vercel Deployment Domain 的网络重新验证。
- 2026-08-11 真实 Composer 重跑：网络和 Vercel/Cloudflare CLI 认证均可用；修复后的新 workspace 已通过 `npm run quality`，Vercel API 项目成功创建并开始部署；Composer 随后因未配置 `VERCEL_TOKEN` 无法关闭 Deployment Protection，临时 Vercel 项目已删除，Cloudflare 项目未创建。该 token 依赖已于 2026-08-13 移除（改用 `vercel api` 复用 CLI 登录态），可直接重跑。
- 2026-08-11 真实 Feature Task 验证：在新的隔离 workspace 中执行了一个要求修改 `apps/web/src/main.tsx` 的小功能，Codex 退出码为 0，Runtime 状态为 `completed`，Git evidence 记录 `1 insertion, 1 deletion`，Quality Gate `npm run quality` 通过，交付状态停在 `VERIFYING`。未代替用户执行 Human Acceptance，也未产生任何远程 Provider 写入。
- 2026-08-10 Acceptance Gate 与 Delivery State 已对齐：本地人工验收批准会使状态机从 `IMPLEMENTING` 经 `VERIFYING` 进入 `LOCAL_ACCEPTED`。该状态明确不代表 PR、Preview 或生产发布；这些仍需 Provider Evidence 和独立人工批准。
- 2026-08-10 Agent Capability Probe 已明确 Adapter 状态：`verified`、`candidate`、`unsupported`。当前仅 Codex 为 `verified`；其他已发现 Agent 只能生成 dry-run，不能执行。
- 2026-08-10 已增加交付证据推进 API：`POST /api/projects/:projectId/delivery/pr-evidence` 将 `LOCAL_ACCEPTED` 推进到 `PR_OPEN`；`POST .../delivery/preview-evidence` 将 `PR_OPEN` 推进到 `PREVIEW_READY`。两者都会在隔离 workspace 写入 JSON/Markdown 证据并提交本地 Git，不能代表生产发布。
- Studio 已接入上述两个证据阶段：仅在对应状态显示表单，提交后自动刷新项目状态、证据包和 Final Delivery Report。
- Studio 重新打开项目时会通过 `GET .../delivery/pr-evidence` 与 `GET .../delivery/preview-evidence` 恢复已记录证据，避免状态与展示脱节。
- 最近验证：`npm test`、`npm run typecheck`、`npm run build` 均已通过；`npm test` 最近一次为 13 个测试文件、61 个用例全通过。Vitest 文件级测试已串行执行，因为 Agent Catalog 会探测本机 CLI，并发探测会造成同步子进程超时假失败。本轮还覆盖 GitHub token 注入、Provider cache invalidation、Cloudflare CLI URL evidence、未验证 Agent 执行阻断和 Adapter 状态展示；真实云端尝试的完整边界见上一条。
- 当前工作分支：`feature/20260802`。2026-08-23 记录：本地 HEAD 为 `96fd261`，`origin/feature/20260802` 为 `c097d89`（本地领先 4 个提交，未推送），`origin/dev` 为 `c109792`，`origin/main` 为 `c696b74`。分支状态随时会变，提交前应重新 `git fetch` 确认，不要沿用本行记录。

## 1. 项目摘要

Agent-Dev 是面向 AI 产品创作者的 Agentic Product Delivery Platform。它位于 Codex、Claude Code 等 coding agent 上层，负责 Product Blueprint、Policy、平台连接、交付状态机、人工 Gate 和真实验收证据。

核心理念：

> 让人专注于产品为何存在，让 Agent 负责产品如何可靠地存在。

首版完成结果不是生成代码，而是交付一个归用户所有、可以访问、可以继续开发和维护的 Web 产品基线，并通过相同流程交付至少一个真实功能。Web SaaS 是当前验证类型，落地页与浏览器插件已生成真实模板（MV3 脚手架），桌面端、移动端与 API 工具属于后续独立 Product Type（暂为引导式交接）。详见 [多产品类型交付方案](docs/multi-product-delivery-plan.md)。

## 2. 当前真实状态

| 项目 | 状态 |
| --- | --- |
| 产品愿景和宪法 | 已完成 |
| 市场与竞争分析 | 已完成 |
| v0.1 PRD | 已完成 |
| 技术架构 | 已完成 |
| Blueprint 规范 | 已完成 |
| 环境变量与平台连接方案 | 已完成 |
| 实施计划和路线图 | 已完成 |
| 现有项目流程复盘/SOP | 已完成 |
| 六项目能力矩阵 | 已完成 |
| 技术 Spike | Workflow Resume、macOS Secret Boundary、Dual Preview 已通过；Codex 部分通过；Supabase Auth 已确认 Manual 降级路径 |
| Git 仓库 | 已初始化；Phase 0 提交已完成 |
| package.json / 代码骨架 | npm workspaces、Studio、Daemon、Blueprint、Policy、Provider Core、Provider CLI、Storage、Workflow 已实现 |
| 真实 Provider Adapter | GitHub/Vercel/Cloudflare 真实 CLI 接入已验证；Supabase Manual 降级已验证；RealProviderRegistry 统一编排，支持 CLI 可用性自动检测和 Manual 降级；Promise.allSettled 部分失败处理 |
| 凭证管理方案 | Phase 1 + Phase 2 已实现（详见 [凭证管理方案](docs/credential-management.md)）。凭证/元数据写入 Agent-Dev `.agent-dev` 目录，项目资源清单写入 workspace `.agent-dev`，自动生成 `.env`；Studio 凭证面板（引导模式 + 验证 + Supabase 手动配置 + 自定义 Key + Secret 后端状态展示）已完成；**Secret Backend 后端化已实现**（2026-09-01）：`AGENT_DEV_SECRET_BACKEND=infisical` 切换 Infisical 后端，默认 `local-file` 不变，真实 Infisical 云端验证待办 |
| Dual Preview 部署编排 | `packages/deployment-composer` 已实现：7 步幂等编排（含 Vercel SSO Protection 关闭）、精确 CORS origin、临时项目清理、Daemon Preview API 和 Studio 部署区块；证据会区分 Wrangler 实测 URL 与推导兜底 URL；真实云端 7/7 步已于 2026-08-14 跑通并独立复验，剩余未验证项是 PR 关闭后的清理链路 |
| 当前本地能力 | Blueprint Revision、Dry Run、Connector Preflight/Discovery、资源归属计划、本地审批、六类产品模板（Web SaaS / 落地页 / 浏览器插件 MV3 / 桌面端 Tauri v2 与 Electron / 移动端 Expo / API 工具）、隔离工作区 Git baseline、Feature Task 与人工 Approval、Codex Runtime dry-run/Execute/Retry、运行结果和 Git evidence、Acceptance Gate、Final Delivery Report、Local Quality Gate、Local Apply Simulator、XState 状态推进（含 `LOCAL_ACCEPTED`）、PR/Preview 证据推进 API、Fake Provider Adapter、真实 Provider Adapter（GitHub/Vercel/Cloudflare）及 Studio 展示、凭证管理 UI（含验证和引导）、Dual Preview 部署编排；Agent Catalog 已支持 Key-Value 内置目录、Studio 选择、Custom Agent 弹窗和 `.agent-dev/agents.conf` 持久化、刷新检测和只读 Capability Probe 展示；内置未安装项隐藏、custom 未安装项置灰；多 Agent 真实执行 Adapter、Supabase 真实自动接入尚未实现；签名/公证/商店提交按设计仍是人工步骤，每类模板内附 `generated/DISTRIBUTION.md` 清单 |
| 生产交付路径 | 已实现并**已在真实云端跑通**（2026-08-23 `Receipt Test` → `DELIVERED`，批准人 `feng`；2026-08-24 项目 3 `Link Vault` 同样从 `main` checkout 独立发布验证）：`ReleaseComposer` 9 步编排 + `release_runs` 日志 + Daemon `release/plan\|request\|approve\|retry` + Studio 发布区块。两道人工闸门（请求、具名批准）由状态机与 Schema 强制，Evidence 记录观测值而非判定常量，生产批准始终由用户本人给出。从记录仓库的生产分支 checkout 后发布，并要求该分支已带上被验收的提交（`962932a`），此前的"从本地 workspace 发布"缺口已修、并已真实跑过 |
| 失败步骤恢复（v0.1 验收） | ✅ 已闭环。**两类恢复均在真实链路验证**：(1) workspace 恢复 `POST .../apply/recover` 新建干净 workspace、保留旧的并报告其 Git 状态，`apply_runs.recovery_index` 保证顺序确定——`Receipt Test` 交付就跑在 `revision-5-recovery-1` 这个被 Codex 破坏后恢复出来的 workspace 上；(2) 发布失败恢复 `POST .../release/retry`——项目 3（`Link Vault`）缺陷 9 被验收提交不在 `main` 上导致发布被拒，补开 dev→main PR 后 `release/retry` 恢复成功。自动化侧：`apps/daemon/test/app.test.ts` 的 `release/retry` 端到端断言失败发布经 retry 回到 `RELEASING` 并最终 `DELIVERED`，且恢复不重开人工批准闸门；`packages/workflow` 状态机测试覆盖 `FAILED → RETRY → 原步骤 → 继续完成` 闭环 |
| 完整周期真实验证 | 3/3。`Receipt Test`（1/3）、`Workspace Verify Fresh`（2/3）、`Link Vault`（3/3）均已完成 Blueprint → Preview → Production 全周期；详见第 1 节项目条目 |
| 测试、构建和部署 | 本地单元测试与 Studio build 已通过；真实云端部署已通过 GitHub 仓库创建 + Vercel 部署 + Cloudflare Pages 部署验证 |

不要把文档中的设计描述为已实现能力。

## 3. 首版硬约束

### 目标用户

- 已经使用 GitHub 和 Codex 的独立开发者或一人产品团队；
- v0.1 不承担完全小白的零安装体验；
- 新手托管模式属于后续规划。

### 固定 Golden Path

```text
React/Vite + TypeScript -> Cloudflare Pages
Hono API                -> Vercel Functions
Supabase                -> Database/Auth
GitHub                  -> Repository/PR/Actions/Environments
Local Codex             -> Feature implementation
```

Cloudflare 和 Vercel 必须同时存在，分别承担页面与 API 托管，不得改回二选一。

### 自动化边界

- production 始终人工批准；
- 自动修复最多两次；
- 外部写操作先 Dry Run；
- Agent 不能访问生产 Secret；
- Agent 不能绕过 GitHub Rulesets 和 Environment Approval；
- 未取得真实 Evidence 的步骤不能标记完成。

### 文件边界

所有 Agent-Dev 产物只写入当前 `agent-dev`。同级的 `bayjf`、`word-picker`、`word-base`、`soft-desk`、`pr-helper`、`tab-manager`、`agent-dev-landing` 仅可只读参考，除非用户明确授权具体修改。

## 4. 关键架构决定

- v0.1 是 Local-first Web App，而非托管 SaaS；
- Studio 使用 React/Vite，本地服务使用 Node/Hono；
- SQLite/Drizzle 保存事实，XState 表达可恢复工作流；
- JSON Schema/RJSF 生成模块化问卷，Zod 校验运行数据；
- SSE 将执行状态推送到 UI；
- 系统 Git worktree 隔离 Agent 修改；
- Provider 统一实现 `discover/plan/apply/verify/detectDrift`；
- 环境变量统一管理契约和同步，生产 Secret 默认留在目标平台或系统 Keychain；
- Markdown 是 Blueprint 生成物，不是唯一事实源。

## 5. 联合 Preview 顺序

```text
quality
-> deploy Vercel API Preview
-> verify API
-> derive VITE_API_BASE_URL
-> build React/Vite
-> deploy Cloudflare Pages Preview
-> update exact CORS origin
-> update Supabase Auth Redirect URL
-> browser/API smoke test
-> write Evidence to PR
```

API 与页面不能无约束并发部署。两个部署和联合验证都成功后，才进入人工 Preview 验收。

## 6. 接手前必读

1. [README](README.md)
2. [产品愿景与宪法](docs/product-vision.md)
3. [v0.1 PRD](docs/prd-v0.1.md)
4. [技术架构](docs/technical-architecture-v0.1.md)
5. [v0.1 实施计划](docs/implementation-plan-v0.1.md)
6. [Blueprint 规范](docs/blueprint-spec.md)
7. [环境与连接方案](docs/environment-and-connectors.md)
8. [凭证与环境变量管理方案](docs/credential-management.md)
9. [对话决策记录](docs/decision-log.md)
10. [参考项目能力矩阵](docs/reference-project-blueprint-matrix.md)
11. [通用开发 SOP](ai-agent-development-sop.md)
12. [Agent Runtime Catalog](docs/agent-runtime-catalog.md)
13. [真实链路经验沉淀](docs/real-world-lessons.md)：四个真实项目、界面走查与模板引擎暴露的 31 个缺陷、11 条架构规则、免费模型选型、环境前提与遗留资源
14. [安全与质量审计（2026-08-31）](docs/audit-2026-08-31.md)：全仓审计发现（含 4 条高危安全缺口）与五批整改方案

市场判断和长期范围见 [市场分析](docs/market-analysis.md) 与 [路线图](docs/roadmap.md)。现有项目事实依据见 [项目组合复盘](portfolio-development-review.md)。

## 7. 阻塞性技术 Spike

五个阻塞性 Spike 已全部通过或明确降级（详见 [Phase 0 技术 Spike](docs/spikes/README.md)）：

1. **Codex Runtime**：✅ 已通过（非交互入口、结构化输出、真实功能任务写入）；
2. **Dual Preview**：✅ 已通过（Vercel API Preview URL 注入 Cloudflare Pages Build）；
3. **Supabase Auth**：✅ 已明确降级为 Manual 路径 C（动态 CORS、Redirect URL 与 PR 关闭清理）；
4. **Secret Boundary**：✅ 已通过（Provider CLI/OAuth、系统 Keychain、GitHub Secrets 最小复制路径，macOS）；
5. **Workflow Resume**：✅ 已通过（SQLite 持久化后从暂停 Gate 或失败 Step 恢复）。

Codex Runtime 已确认本机 `codex-cli 0.142.3` 提供非交互执行、JSONL 事件、最终输出 Schema、sandbox、超时终止和 resume 命令入口。2026-08-07 的只读探测已通过（exit 0，完整 `thread.started` → `turn.completed` 事件链），2026-08-11 已用一次真实功能任务验证写入与 Quality Gate。注意：早期 2026-08-06 的尝试曾因受限环境禁止 Codex 写入 `~/.codex/state_5.sqlite` 而在模型调用前停止，该记录已被后续验证取代；仍不要通过 Agent-Dev 绕过该状态目录边界。失败 workspace 恢复已实现为 `POST .../apply/recover`（新建干净 workspace，旧的保留待查），并已在一个真实被 Codex 破坏的 workspace 上跑过——`Receipt Test` 的完整交付就跑在恢复出来的 `revision-5-recovery-1` 上。剩余未验证项为真实 Codex 会话 resume 和可控取消。详见 [Codex Runtime Spike](docs/spikes/codex-runtime.md)。

Workflow Resume 与 macOS Secret Boundary 已通过真实本地 Probe。Dual Preview 已通过真实云端验证：Vercel API 部署、Cloudflare Pages 部署、跨域通信和 API URL 注入均取得真实 Evidence。Supabase Auth 已确认采用 Manual 降级路径（路径 C），由用户手动完成项目创建和凭证管理，RealProviderRegistry 已实现自动降级为 ManualProviderAdapter。完整状态见 [Phase 0 技术 Spike](docs/spikes/README.md)。

Dual Preview 的部署编排已实现为 `packages/deployment-composer`（精确 CORS origin、临时项目清理、Vercel SSO Protection 关闭和签名验证的 PR 关闭清理已包含）。下一动作是真实验证 PR 关闭后的清理链路（Composer 主链路已于 2026-08-14 在真实云端 7/7 通过，清理仍只有本地签名与事件测试覆盖）。Supabase 遵循用户决策保持 Manual 降级（不做自动化，仅引导用户手动操作）；Supabase Auth Redirect URL 更新仍为手动步骤。

OpenAI 官方 Codex 手册和页面在 2026-08-02 的核对请求中返回 `403`，此后仍未能访问。当前使用的 CLI 参数集来自本机 `codex-cli 0.142.3` 的实测（见 Codex Runtime Spike），不得基于未核实记忆扩展或修改；升级 CLI 版本后需重新实测。

## 8. 下一步执行顺序

1. ✅ ~~实现凭证管理 Phase 2~~：已于 2026-08-08 完成（Studio 凭证面板 + 引导模式 + 凭证验证 + Supabase 手动配置）；
2. ✅ ~~将 Dual Preview 部署编排实现为幂等 Step~~：已于 2026-08-09 完成（`packages/deployment-composer`，精确 CORS + 临时项目清理）；
3. ✅ ~~重跑 Deployment Composer 端到端~~：已于 2026-08-14 完成，真实云端 7/7 步通过并独立复验（Evidence 见 [Dual Preview](docs/spikes/dual-preview.md)）；**Studio 部署区块 → Daemon 这一段仍未走过界面**，本轮是直接调 Daemon API 触发的，资源清单外部 ID/URL 与 Provider 控制台的一致性也尚未逐项核对；
4. ✅ ~~为 Catalog 增加只读 Capability Probe~~：Daemon API 已提供探测结果，Studio 选择 Agent 后显示的是探测读到的东西——Adapter 要用的参数在不在该 CLI 的帮助输出里（列出 / 没列 / 帮助答不了三种分开印）以及 Adapter 状态；2026-09-02 去掉了原先那枚 `workspace-write` chip，它抄的是目录自己的声明而不是测量结果（详见 [Agent Runtime Catalog](docs/agent-runtime-catalog.md) §3.3）；仍需在各 Agent 实际安装环境逐个验证 Adapter；
5. ✅ ~~用一次必然产生 Git diff 的真实功能任务验证 Runtime 写入和 Quality Gate~~：已于 2026-08-11 完成；Human Acceptance 仍需由用户明确确认；
6. ✅ ~~将 Acceptance Gate 与正式 Delivery State 的实现/验证阶段关联~~：已于 2026-08-10 完成；本地批准进入 `LOCAL_ACCEPTED`，不代表生产交付；
7. ✅ ~~使用三个真实项目连续验证从 Blueprint 到 Preview/Production 的完整周期~~：**3/3 已完成**——`Receipt Test`（2026-08-23）、`Workspace Verify Fresh`（2026-08-23）、`Link Vault`（2026-08-24）都走完 Blueprint → Preview → Production 并上线，证据与三轮共修掉的缺陷见「最近进度」。遗留动作：
   - 三个项目的 Preview 资源仍在账号里（`receipt-test-*-pr-1`、`workspace-verify-fresh-*`、`link-vault-*-pr-1`），清理入口 `POST .../preview/cleanup`（`CLEANUP_PREVIEW`）；生产项目是交付物，不要清理。
   - `release/approve` 只校验「被验收提交是生产分支祖先」，不会自动把 `dev` 提升到 `main`；若 PR 目标是 `dev`，发布前需显式补开 dev→main PR。
   - 生产发布必须由用户本人批准，不能由 Agent 代按；Daemon 必须带代理变量与 `NODE_USE_ENV_PROXY=1` 启动，否则云端验证会假失败。
   - Daemon 的 PATH 需同时含 node22 运行时、homebrew（2026-09-02 实测解析到 codex `0.151.0`，此前记为 0.142.3；要点是 homebrew 排在前面，避免默认解析到 fnm node20 全局 bin 那版有兼容 bug 的 `0.147.0`）和 fnm node20 全局 bin（`vercel`/`wrangler`）。同一台机器的 ambient node 是 `v20.20.2`，它让 `openclaw` 与 `pi` 连 `--version` 都答不出，所以这两个 Agent 的探测与执行在本机推不动（逐 Agent 对账见 [Agent Runtime Catalog](docs/agent-runtime-catalog.md) §3.5）。
8. 多产品形态六种类型全部生成真实模板（web-saas / landing-page / browser-extension / desktop 双 shell / mobile / api-tool），每一类的生成物都在本地真跑过自己的 quality gate，desktop-tauri 还真产出了未签名的 .app/.dmg。签名、公证与商店提交按设计仍是人工步骤，模板内附 `generated/DISTRIBUTION.md`。七种生成物的 quality gate 已按工作流声明的步骤在真实 Linux 容器里复现全绿（六类于 linux/amd64，与 `ubuntu-latest` 同架构；desktop-tauri 于 linux/arm64，`cargo check` 冷编译 10m30s），tauri 工作流的 apt 依赖清单也在 `ubuntu:24.04` 上验证过仍可安装。生成的工作流也已在**真实 GitHub Actions** 上执行：`bayernjf/receipt-test` 的 PR #2–#7 分别推入六类生成物，`quality` 全绿（landing-page 13s / browser-extension 23s / api-tool 42s / desktop-electron 46s / mobile 1m8s / desktop-tauri 3m45s）；web-saas 早在 2026-08-23 的 PR #1 就已绿。未做：Electron 窗口/Expo 模拟器/EAS Build 未真跑、部署平台可组合（M2）。tauri 工作流已加 `Swatinem/rust-cache@v2`（`workspaces: src-tauri`），同分支两次真跑量出 `quality` 96s → 6s、整个 job 3m12s → 1m23s。
9. **非 web-saas 类型的端到端真实交付（已完成，2026-08-27）**。选 `api-tool`（项目 `397d8de0-06f6-4773-bf7b-9c26c13ff009`「MCP Word Tools」）因为它只需要 GitHub、不碰云端供给。两个阻塞缺陷（24 / 25）已修掉。全流程已跑通：Blueprint → 基线审批 → GitHub 仓库创建（`bayernjf/mcp-word-tools`）→ Apply → Feature Task（Add count_tokens tool）→ Runtime 执行 → Quality Gate（5/5 测试通过）→ Acceptance（approved by feng）→ PR #2 合并到 dev → dev 合并到 main → **DELIVERED**。
   - **已知设计缺口（已于 2026-08-28 闭环）**：对于 api-tool / landing-page 等无托管部署类型的项目，状态机曾无法通过正常 API 推进到 DELIVERED（当时通过直接调用 store 的 `advanceDelivery` 手动推进）。现在状态机保持类型无关、`PR_OPEN` 接受 `REQUEST_RELEASE`，daemon 只允许无托管部署目标的产品走该捷径（托管产品在 PR_OPEN 仍被 preview gate 拒绝），此类产品的发布审批记录 "manual distribution" 证据，人工双闸门不变。
10. **审计整改（2026-08-31 审计产出，发现与验收标准以 [审计文档](docs/audit-2026-08-31.md) 为准）**。按五批执行，**P0 是外部 Pilot 阻断项——完成前不分发安装脚本**：
    - **P0 网络边界**：`serve()` 绑回 `127.0.0.1`（`apps/daemon/src/index.ts:45`）；全部 `/api/*` 加本机随机 token 鉴权（daemon 启动生成、写入仅当前用户可读文件，Studio 与 MCP 桥携带）；`importRepositoryUrl` 与证据 URL 限制 `http(s)`（封 `ext::`/`file://`/`javascript:`）；移除或门控 `POST /api/update` 与 `GET /api/update/check`。
    - **P1 状态机与校验**：`advanceDelivery` 事务化 + 非法事件显式抛错（`packages/storage/src/index.ts:1555-1573`，即「最近进度」生产交付路径条目记录的未验证边界）；4 条 runtime 门禁路由补 zod（`app.ts:819/850/863/876`）。
    - **P2 清理与一致性（已完成，见「最近进度」§6.3 条目）**：secret-backend 移除路由保留库（用户拍板）；根目录遗留 `install.sh` 已删除；确认字面量已收敛到 `@agent-dev/policy` 的 `CONFIRMATIONS` 单一事实源；ReleaseComposer 步数表述已修正（9 步）、`/api/health` 版本号已改为从 package.json 读取；死代码已清理、`rm -rf` 已改 fs/promises；版本号已升 `0.2.0`（用户拍板）。
    - **P3 Windows 兼容**：`npm`/`npx` 调用处理 `.cmd`（`storage/src/index.ts:777`、`:844`、`agent-runtime/src/doctor.ts`）；信号与符号链接用例按平台适配。
    - **P4 测试补齐（已完成，见「最近进度」§6.5 条目）**：storage pipeline 执行（含 resume 未落盘缺陷修复）、MCP 20 工具全覆盖、`advanceDelivery` 回归、Studio 渲染冒烟。
    - 用户决策均已落定：secret-backend「移除路由、保留库」（2026-08-31）；版本号升 `0.2.0`（2026-08-31）。
11. **v0.2 收尾**。P1-2 代码已落地（2026-09-01），仅剩**真实云端验证待办**——在 Infisical 控制台建 scratch 项目，按 [spikes/infisical-backend/README](spikes/infisical-backend/README.md) 配置后跑 `npm run probe:online`，回环 `complete: true` 后把 P1-2 状态升级为已验证（同步 `docs/implementation-plan-v0.2.md` 与 [凭证管理方案 §3.5](docs/credential-management.md)）。

    **不要把本条读成“v0.2 只剩 P1-2”**——上面 §8-3/§8-4/§8-7 各自还挂着未闭环子项，按对 Pilot 的影响排序：

    1. **Studio 界面链路（§8-3 遗留，2026-08-14 起挂账，已于 2026-09-01 走完两阶段）**：历次端到端验证都是直接调 Daemon API，而外部用户只会点界面。现已用界面从「新建 Blueprint」走到 Apply 前（见「最近进度」2026-09-01 条目），冷启动鉴权缺陷正是走查时暴露的。**剩下的不再是「没走过」，而是走查查出的一串缺陷**：其中「决策卡内容与产品类型矛盾」已于 2026-09-02 修掉（那是内容错误，不是翻译问题），影响最大的仍是「后端生成文案无 i18n 边界」，需拍板（影响范围实测与三方案对比见 [领域文案 i18n 边界决策依据](docs/i18n-domain-prose-decision.md)，§9 决策表同步）。
    2. ~~**各 Agent 在实际安装环境的 Adapter 验证**（§8-4 遗留）~~：**已于 2026-09-02 完成**（`ecde9eb`）——八个内置 Agent 全量只读对账，六个能答且 Adapter flag 全部在帮助里有据；openclaw/pi 因 ambient node v20.20.2（启动器要求 ≥22）答不出，属环境而非产品缺陷。逐 Agent 明细见 [Agent Runtime Catalog](docs/agent-runtime-catalog.md) §3.5。
    3. **资源清单外部 ID/URL 与 Provider 控制台一致性逐项核对**（§8-3 遗留）。
    4. **Preview 遗留资源清理 + PR 关闭清理链路真实验证**（§8-7 与§7 段遗留；生产项目是交付物，不清理）。
    5. **Windows 上 agent 执行路径不通（探测部分已于 2026-09-01 修复）**：`agent-runtime` 的版本探测与 PATH 发现已修（见「最近进度」同日条目，本机 6/6 agent 可探）；**尚余执行路径**：`runCodexProcess` 仍以无 shell 方式 spawn，npm shim 类 CLI（codex / claude / opencode / openclaw / codebuddy）一律 ENOENT，Windows 用户走 Apply → Feature Task 时 agent 起不来。修法待决策表「Windows agent 启动方式」拍板（`install-macos.sh` 表明 Pilot 目标为 macOS，因此推荐先显式降级而非引入注入面）。

    走查进度：§8-11.1 已完成两个阶段——第一阶段（首屏 / 凭证面板 / Activity / zh 切换，只读）、第二阶段（界面建 Blueprint → 四个项目详情标签页中英各一遍 → Apply 前停手，无远端副作用）；冷启动鉴权缺陷已修复并验证；Windows 探测与发现路径已修。走查发现的具体缺陷与待办见「最近进度」2026-09-01 条目的「走查待办」子列。

    P1-2 的 Infisical 验证不改变外部用户的默认 `local-file` 路径，按 `docs/implementation-plan-v0.2.md` §1 的降权原则可后置。

## 9. 用户决策

| 决策 | 状态 | 值 |
| --- | --- | --- |
| 生产页面域名 | 已确认 | `app.example.com`，允许项目改为 apex |
| Supabase 环境 | 已确认 | dev 与 production 使用独立项目 |
| 模板最小业务能力 | 已确认 | 登录、基础用户资料、API health、示例受保护页面 |
| Analytics 默认 | 待确认 | 默认关闭，隐私确认后再接入 |
| GitHub Ruleset | 待确认 | 支持则自动计划；权限/套餐不足时生成 Manual Action |
| Blueprint 开源 | 待确认 | v0.1 稳定后再发布 v1alpha1 |
| Local Claude Runtime 验证 | 已推迟（2026-08-29） | v0.2 P0-1 暂缓；`claude-code` adapter 保持 `candidate`，不进 verified 列表。当前 Runtime 主力为 OpenCode 2.0 + `nemotron-3-ultra-free`。恢复触发条件：出现主力用 Claude 的 Pilot 用户 / 外部用户明确要求 / 免费模型额度或可用性出问题 |
| secret-backend 去留 | 已确认（2026-08-31） | 移除 daemon 9 条管理路由（消除 S4 明文出口）；`packages/provider-cli/src/secret-backend/` 库保留作 P1-2 Infisical Adapter 地基 |
| 版本号升级 | 已确认（2026-08-31） | 全部 13 个 package.json 从 `0.1.0-alpha.0` 升到 `0.2.0`，与 v0.2 Pilot 定位对齐 |
| P1-2 Infisical 集成方式 | 已确认（2026-09-01） | 凭证系统后端化（`credentials.ts` 经 `SecretBackend` 抽象切换，默认 `local-file` 字节级不变），不恢复独立 secret-backend 路由 |
| P1-2 真实验证时机 | 已确认（2026-09-01） | 延后：本轮交付代码 + 单元测试 + 探测脚本与配置指南；P1-2 标记「代码完成，真实验证待办」，不满足 ✅ |
| Windows agent 启动方式 | 待确认（2026-09-01） | **探测与 PATH 发现已修（同日，无争议部分先落地）**；待定的只剩**执行路径** `runCodexProcess`。候选：① 引入 cross-spawn（社区维护的 shim 解析 + cmd 参数转义）；② 自实现同等逻辑（无新依赖，但转义正确性要自己扛测试）；③ 从 npm `.cmd` shim 解析出 `node <entry.js>` 后无 shell 启动（无注入面，依赖 shim 格式，非 npm 安装需回退）；④ **推荐**：Windows 上检测到 shim 就显式报错 + 给可操作提示（改用原生 exe / 指到真实可执行 / 走 WSL），因为 `scripts/install-macos.sh` 说明 Pilot 目标是 macOS，目前没有 Windows Pilot；待出现真实 Windows 用户再升级到 ①/② |
| 领域文案的 i18n 边界 | ✅ 方案②五批全部落地（2026-09-02，4019905/ff5f664/caa3b07/6e1ee52/b22ec08） | 决策卡、dry-run 计划、manual actions、baseline plan、artifact titles 的英文文案**已全部并行发稳定 key+params**，Studio 用 key 查 locale、miss 回退英文，MCP 桥零改动。五批覆盖：dryRun(4)、decisions(37)、baselinePlan(15)、manualActions(37)、artifact titles(80 key，76 固定 + 2 可变×2 类型)。全量 530 测试绿。完整数据、字段形状、分批与风险见 [领域文案 i18n 边界决策依据](docs/i18n-domain-prose-decision.md)。 |

## 10. 交接完成定义

接手者在开始编码前应能明确回答：

- Agent-Dev 与 Codex 的责任边界是什么；
- 为什么首版采用 Local-first；
- 为什么 Cloudflare 和 Vercel 都是必选；
- 哪些操作必须人工批准；
- Blueprint、Markdown、Env Contract 和 Evidence 的关系；
- 哪五个 Spike 会影响架构；
- v0.1 需要用什么真实证据证明完成。
