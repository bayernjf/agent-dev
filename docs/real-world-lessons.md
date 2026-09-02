# Agent-Dev 真实链路经验沉淀

> 来源：四个真实项目（`Receipt Test` 1/3、`Workspace Verify Fresh` 2/3、`Link Vault` 3/3、`MCP Word Tools` 4/4，首个非 web-app 类型端到端上线）从 Blueprint 到 Preview/Production 的完整周期验证，以及六种产品类型生成物的真跑与非 web-saas 类型的端到端交付尝试。
> 用途：记录只有真实云端链路才能暴露的缺陷、由缺陷沉淀的架构规则、以及环境前提——避免把环境问题误判为产品缺陷。
> 更新时间：2026-09-02（缺陷 30/31 与规则 11 来自 Studio 界面走查与间歇失败归因，不是云端链路）

## 1. 真实缺陷清单

以下缺陷**没有一个是既有单元测试能发现的**，全部由真实链路、真跑一次生成物、或在界面上真走一遍暴露。每条含：表现 → 根因 → 修复（提交）。

### 1.1 项目 1（`Receipt Test`）暴露的 6 个

| # | 缺陷 | 提交 | 关键教训 |
| --- | --- | --- | --- |
| 1 | **Agent 写的代码从来没被提交** | `874fd3c` | 流水线每次 commit 只 `git add` 自己刚写的报告文件，Agent 自己不提交，被推送/被评审的分支上只有脚手架。现在 Runtime 成功后由平台提交 Agent 改动。 |
| 2 | **`git add -A` 把密钥和 Provider 状态提交进产品仓库** | `7d3b6b0` | workspace 有真实凭据的 `.env`/`.vercel/`/`.wrangler/`/`.agent-dev/`。补全 `.gitignore` 并加拦截：暂存区出现 `.env` 时不提交、判 `failed`（此处不能用 `throw`，运行状态已写 `running`，抛错会卡死无法重试）。 |
| 3 | **新仓库没有 PR 的基线分支** | `5e38f69` | `gh repo create --push` 只发布 feature 分支，`feature/* -> dev -> main` 第一个 PR 开不出来。改为在基线（root）提交上创建 `dev`/`main` 并把 `main` 设为默认分支（用基线而非 HEAD，避免待评审功能躺在生产分支）。 |
| 4 | **已存在的仓库永远补不到这两个分支** | `89b3585` | 上一条只在"新建仓库"分支执行，修复前建的仓库重跑 apply 也不补。改为 apply 每次都确保声明分支存在（容忍 `Reference already exists`）。 |
| 5 | **PR 只能靠人手抄 URL** | `a39be2b` | 新增 `POST .../delivery/pull-request`（`OPEN_PULL_REQUEST`）：平台自己推送并开 PR 再回填证据。前置校验：revision 一致、任务已批准、已验收、apply 已完成、工作区干净；推送前校验 `origin` 必须等于资源清单记录的仓库，并要求 HEAD **包含**被验收提交（不是相等——验收后平台还会提交报告）。 |
| 6 | **生产发布用的是被保护的部署 URL** | `8afb9bd` | `vercel deploy --prod` 回传不可变部署地址，被 Deployment Protection 挡着（302 到 SSO），健康检查把健康 API 判坏，且会把用户访问不到的地址写进 `VITE_API_BASE_URL`。改为 `vercel inspect --format=json` 取最短别名。 |

### 1.2 项目 2（`Workspace Verify Fresh`）暴露的缺陷

| # | 缺陷 | 提交 | 关键教训 |
| --- | --- | --- | --- |
| 7 | **Codex 创建外部 symlink 绕过产物提交拦截** | `1179738` 前 | Codex 为了跑测试把 `/private/tmp/.../node_modules` 以**绝对路径符号链接**挂进 workspace。`.gitignore` 的 `node_modules/`（目录模式）不匹配符号链接，死链被提交进产品仓库。修复：`commitAgentChanges` 加「workspace 外部符号链接」拦截（`lstat`+`readlink`+`resolve` 判断是否逃出 workspace）；模板 `.gitignore` 从 `node_modules/` 改为 `node_modules`（同时匹配目录、文件、符号链接）。 |
| 8 | **生成的 CI 在首个 PR 必然失败** | `e0b2d7d` | `actions/setup-node@v5` 默认开启依赖缓存，仓库根没有 lock 文件就硬报 `Dependencies lock file is not found`。模板 `quality.yml` 给 `setup-node` 加 `cache: ''`（禁用缓存探测），让 `npm install` 自己生成 lock 文件。 |

### 1.3 项目 3（`Link Vault`）暴露的缺陷

| # | 缺陷 | 修复方式 | 关键教训 |
| --- | --- | --- | --- |
| 9 | **被验收提交不在 `main` 上导致生产发布被拒** | 补开 dev→main PR #2 后 `release/retry` | `release/approve` 只校验「被验收提交是 `main` 祖先」，不会自动把 `dev` 合入 `main`。**若 PR 目标分支是 `dev`，发布前需显式把 `dev` 提升到 `main`**（`requirePullRequest: true` 即补开 dev→main PR）。 |

### 1.4 Dual Preview 编排（`packages/deployment-composer`）暴露的 5 个

| # | 缺陷 | 关键教训 |
| --- | --- | --- |
| 10 | **生成的 API 模板在 Vercel 上永久挂起** | `export default handle(app)` 返回 Web fetch 风格 `Response`，Vercel 按传统 `(req,res)=>void` 处理默认导出并丢弃返回值。改为按 HTTP 方法导出 fetch-style handler（`export const GET/POST/OPTIONS = handle(app)`）；本地 `serve()` 守卫改为精确的 `!process.env.VERCEL`。 |
| 11 | **生成的 API 模板没有 CORS 中间件** | Composer 一直注入 `ALLOWED_ORIGIN` 但模板从不读它。补 `hono/cors`：`origin: process.env.ALLOWED_ORIGIN ?? '*'`。 |
| 12 | **生成的前端从不消费 `VITE_API_BASE_URL`** | 注入变量但模板无引用，构建产物找不到该 URL。`index.html` 加 `<meta name="api-base-url" content="%VITE_API_BASE_URL%">` 走 Vite HTML 变量替换，`main.tsx` 真的 `fetch(${apiBaseUrl}/api/health)` 并渲染状态。 |
| 13 | **`WRANGLER_LOG: 'none'` 破坏幂等性和 URL 解析** | 幂等判断依赖 stderr 的 `already exists` 文本、URL 解析依赖 Wrangler 回传的真实 URL，该变量把两者都压掉。移除该变量并加断言 create 调用 env 不含 `WRANGLER_LOG` 的回归测试。 |
| 14 | **联合 Smoke 的 CORS 校验对象错了** | API 的 CORS 锁在**分支别名** `preview.<project>.pages.dev`，但 Smoke 拿每次部署的**哈希域名**校验。统一用别名（Reviewer 打开的稳定链接）。此前只是因 URL 解析失败退化才"碰巧"通过。 |

### 1.5 平台自身与 CI 的缺陷

| # | 缺陷 | 关键教训 |
| --- | --- | --- |
| 15 | **`npm ci` 在 Node 20 下必然失败** | `wrangler@4.120.0` 要求 node ≥22，`.npmrc` 的 `engine-strict=true` 使其成为硬错误。新增 `.node-version`（`22`）作为 fnm 与 CI `actions/setup-node` 唯一来源，`engines.node` 提升为 `>=22.0.0`。 |
| 16 | **CI 测试依赖本机环境而非产品契约** | 有测试断言 runtime catalog 含 `id:'codex'`，但 catalog 只返回 PATH 上真实存在的 Agent，runner 没装 Codex 就返回空数组。改为断言路由真正拥有的契约。用最小 PATH 复现验证，排除同类环境依赖测试潜伏。 |
| 17 | **`workspace.ts` 用 `node:fs` 被拖进 Vite 打包** | blueprint 的 barrel 再导出 `workspace.ts`，Studio 浏览器 import barrel 时 `node:fs` 进 Vite 打包直接构建失败（`"readFile" is not exported by "__vite-browser-external"`）。typecheck/test 全绿也发现不了——只有 build 会。改为子路径 `@agent-dev/blueprint/workspace` 导出；alias 是前缀匹配，子路径规则要排在裸包名前。 |
| 18 | **生成的浏览器插件 `tsconfig` 让自己的 quality gate 必挂** | 没有 `lib: DOM`、没有 `skipLibCheck`、`types` 缺 `node`，`tsc --noEmit` 直接在 vite 自己的 `.d.ts` 上报 `Cannot find name 'Buffer'`——与缺陷 8（生成的 CI 在首个 PR 必然失败）同一类：**模板的 quality 脚本必须真跑过一次**，光有单测断言产物存在是不够的。修复：补 `lib`/`skipLibCheck`/`@types/node`，并加回归测试锁住。 |
| 19 | **manifest 引用了生成器产不出的 PNG** | 生成的 MV3 manifest 写了 `default_icon: 'icons/icon128.png'`，但产物全是文本、生成器无法产出 PNG，`vite build` 报 `Could not load manifest asset`。修复：manifest 去掉 `default_icon`，把「发布前自行补齐图标」写进交接 README（诚实边界而不是假装有图标）。 |
| 20 | **Studio 用了不存在的 i18n key，且把 catalog 的 string 当枚举** | 产品形态单选框调 `t('productType.<type>')`，而字典里在 `blueprint.productTypeXxx`，界面会渲染出原始 key；Runtime 单选框把 `agent.id: string` 直接写进 `runtimeProvider` 枚举。**两处在已提交的 HEAD 上 typecheck 就是红的**——提交前没跑全量 typecheck。改为显式 key 映射表 + 只列 `runtimeProviderSchema` 认得的 id。 |
| 21 | **质量契约按类型硬编码，落地页 gate 中途死掉** | `spec.quality.required` 对所有产品类型都写死 `lint/typecheck/unit/build/smoke`，但落地页模板只定义了 `build` 和 `lint`——真跑 `npm run quality` 到第二步就 `npm error Missing script: "typecheck"`，CI 永远无法转绿（与缺陷 8/18 同类）。修复：`QUALITY_CHECKS` + `qualityChecksFor()` 让契约按类型只声明模板真实定义了脚本的检查项，回归测试对**每个**已实现类型都校验「声明的每一项都有真脚本、且都在 `quality` 链里」。 |
| 22 | **Tauri 不给图标就编不过，而生成器只能产文本** | `tauri::generate_context!` 在编译期读 `bundle.icon`，缺 `src-tauri/icons/icon.png` 直接 `proc macro panicked`；跟缺陷 19 同样撞上「文本生成器产不出 PNG」，但这次不能靠删配置绕过——桌面应用没有图标就无法编译。修复：模板附带 `scripts/ensure-icon.mjs`（用 `node:zlib` 现场写一张占位 PNG）并挂在 `rust-check` 前面，真实图标仍是发布前的人工步骤。 |
| 23 | **`declare global` 写在非模块文件里，Electron 渲染进程 typecheck 直接红** | 渲染进程入口 `src/main.ts` 没有任何 import/export，因此不是模块，里面的 `declare global { interface Window { desktop … } }` 被 TS 判为 `TS2669`，连带 `window.desktop` 报未定义——真跑生成物的 `npm run quality` 第一步就暴露。修复：桥接类型移到独立的 ambient 文件 `src/desktop.d.ts`。同一次真跑还发现主进程必须是 CommonJS（package.json 不能写 `type: module`），于是 Vite 配置改名 `vite.config.mts` 才不走已废弃的 CJS 配置加载路径。 |
| 24 | **云资源清单对所有产品类型写死四家，MCP server 永远过不了审批**（`25b3d9e`） | 生成物早就按类型分叉（api-tool 不产 `wrangler.toml`/`vercel.json`），供给层却没有：`createBaselinePlan` / `getManualActions` / `providerSpecsFromBlueprint` / Studio 归属表单**四处各自硬编码同一份清单**，于是一个 stdio MCP server 也要填 Supabase 组织和 Vercel team 才能过闸门——而填了就会真被建出三个产品永不接触的云项目。修复：清单收进 `PRODUCT_TYPE_DESCRIPTORS[type].providers` 当唯一事实源，映射类型收紧为 `Record<ProductType, …>`，第七种类型不填这一行就编译不过。两处细节：把 Supabase 称作"可选"的类型故意不列入（**可选项不该卡审批**）；不用的 provider 键是**缺席**而非空数组，因为 registry 对每个存在的键取 `resources[0]`，空数组会把 `undefined` 递给适配器、在下游某处才炸。 |
| 25 | **持久化 schema 加字段没给默认值，把所有历史数据读死**（`0a51cca`） | 任何 pre-existing 项目的路由都返回 HTTP 500。根因是往 `productBlueprintSchema` 加 `desktopShell` 时没给 `.default()`——`createBlueprint` 总会写它，但**它存在之前写下的行没有**，于是 `AgentDevStore.getProject` 里的 `parse` 对每行老数据抛 `ZodError`。字段清单不靠猜：写探针遍历 `blueprint_revisions` 全部 safeParse 并按 issue path 汇总，实测 23 行里 20 行读不出来。修复是补上与旧实现语义一致的默认值——这是**读迁移**，不是放宽输入校验（`blueprintAnswersSchema` 早就有这四个默认值，缺的只有持久化那份）。教训：**持久化 schema 的必填字段是一次数据迁移**，加字段前先问"已经写下的行长什么样"。 |
| 26 | **blueprint 声明了自己没有的部署目标**（`ec1de1a`） | 缺陷 24 只修了"要不要问用户"，没修"记下来的是什么"：`deployment.web.provider` / `api.provider` / `data.provider` 是写死的 `z.literal`，所以一个 MCP server 的 blueprint 仍然声明着 `cloudflare-pages` + `vercel-functions` + `supabase`。这些字段是交付记录本身，写着不存在的目标就是假声明。修复：字面量放宽为含 `'none'` 的枚举，取值由 `baselineProvidersFor` 决定（与基线计划同源）。**枚举放宽不会读死老数据**——旧值仍在枚举里，23 行持久化数据复验全部通过（与缺陷 25 相反方向的验证）。 |
| 27 | **交付状态少了 8 个标签，界面渲染出原始 key**（`2358b9d`） | 项目列表显示 `projectState.NEEDS_INPUT`：字典只覆盖状态机 15 个状态里的 7 个。**与缺陷 20 同类且是其复发**，说明"改成显式 key 映射表"这个修法治不住根——真正的根因是 `as KeyPath` 断言把缺失从编译器眼前藏了起来，而它后面那个 `?? project.state.replaceAll(…)` 兜底**是死代码**（`t()` 查不到时返回 key 本身，永远不是 `undefined`）。修复：`Project.state` 从 `string` 收紧为 `DeliveryState`，字典 `satisfies Record<DeliveryState, string>`，断言与死兜底一并删除。已实测有效：删掉任一标签会同时在字典、译文、调用点报三处编译错误。 |
| 28 | **错误横幅长在首页组件里，成了唯一的错误出口**（`2358b9d`） | 横幅写在 `Dashboard` 内部，而全应用约 40 处 `setError` 共用一个全局 state——于是凭证加载失败的消息**串到首页展示**，而项目详情页里发布失败的消息**在用户回到首页之前根本看不见**。修复：横幅上移到 shell（每个视图都可见），并在视图切换时清空；清空键为 `view.kind` 而非整个 view，这样项目内切 tab 不会抹掉用户还没读的消息。 |
| 29 | **探测超不过时限就谎报 Agent 未安装**（`f2e4278`） | `which` 退出码非 0 是"确实不在 PATH 上"的证据，`which` **跑不起来**不是——但两者走同一分支，于是 300ms 超时（或进程表满时的 EAGAIN）会报 `Command not found on local PATH.` **并缓存**，让 Studio 把装好的 Agent 标成 missing、daemon 用 409 拒绝启动它，且在进程剩余生命周期里一直如此。这与函数自己下一分支的注释直接矛盾（"版本探测失败不得隐藏已安装的 Agent"）。本会话全量测试**两次自发复现**这个 flake，才定位到它。修复：不确定的探测改用更长预算重试且**永不缓存**，让下一次调用有机会给出结论。回归测试把 PATH 清空使 `which` 自身不可解析——与超时同一失败形态，但没有时序依赖（已验证该测试在修复前必红）。 |
| 30 | **唯一事实源已经立了，两处界面文案还没接上**（`ebe7ec4`） | 缺陷 24 把"这个类型用哪几家云"收进 `PRODUCT_TYPE_DESCRIPTORS[type].providers`，但仍有两处把 web-app 那套说给**所有**类型听：`getBlueprintDecisions` 的两张决策卡（`Application baseline: React/Vite, Hono and npm workspaces` + `Cloud account connection: Supabase, Cloudflare Pages and Vercel Functions`），以及 Studio 表单里渲染在**产品类型选择框正下方**的那句 `blueprint.baselineNote`。于是一个 MCP server 的决策台向用户索要它这次根本不碰的云账户，而**同一个 Blueprint 自己生成的** `PRODUCT_STANDARD.md` 写着 `Data and auth: Not provisioned for this product type`。教训：**SSOT 只在被读到的地方生效**，收敛清单的判据必须写成"每个把基线说给用户听的位置都读它"，不是"当前四个调用点读它"。修复：两张卡与注记都改读同一张表；`mode` 一律保持 `manual`（没有云资源 ≠ 没有闸门，放掉这道门会让一份基线在零授权下被批准）。回归测试不断言字符串，而是断言卡片值等于该类型生成物 `PRODUCT_STANDARD.md` 里自己写的 `Frontend:` / `Backend:` 行，并逐个类型钉住"该看到哪句注记"的期望表。**未修**：`desktop.frontend` 不随 `desktopShell` 变化（electron/tauri 显示同一串）。 |
| 31 | **两条用例的判决由八个 CLI 探测决定**（`64c2a72`） | 一条挂着"未归因"标签的间歇失败，根因不是运气而是不等式：`discoverAgentRuntimes()` 顺序探测 8 个内置 Agent，每个版本探针预算 `VERSION_PROBE_TIMEOUT_MS = 5 s` → 最坏 40 s，而 vitest 单用例默认预算也是 5 s；`fileParallelism: false` 只缓解不解决。测前实测 8 次全量跑 6 绿 2 红，两条红都是 `Test timed out in 5000ms`（实测耗时 5239 ms / 6091 ms）。修复：给 daemon 加 `discoverRuntimes` 注入接缝（沿用已有 `isAgentDetected` 的形状），MCP 测试注入单 Agent fixture；catalog 测试把 PATH 指向只放一个可执行文件的临时目录——判决不再取决于装了几 CLI。测后连续 10 次全量绿，两文件分别 879 ms / 398 ms。**已知残留**：`apps/daemon/test/app.test.ts` 故意保留真实发现（它断言的就是路由与真实 catalog 的契约），同样时序风险仍在；fixture 看不见 `POST /api/runtime/catalog` 追加的自定义 Agent，那条断言只能用真实发现。 |

## 2. 由缺陷沉淀的架构规则

以下规则在真实链路中反复被违反过，现为强制约束（绝大多数有测试覆盖；无自动化护栏的规则在自己的正文里明写）：

1. **生产从生产分支的独立 checkout 发布，且该分支必须已带上被验收的提交**（`962932a`）。`ReleaseComposer` 发布前先 clone/fetch/reset 记录仓库的生产分支，校验被人工验收的提交是该分支 HEAD 的祖先（不是则拒绝并提示先合 PR），再在这个 checkout 上装依赖、跑质量门禁、构建和部署；Evidence 记下 `repository/branch/commit/acceptedCommit`。没有记录仓库或没有验收时，`release/plan` 给出原因、`release/request` 返回 409。
2. **每个人工闸门都必须具名批准**（`0dbd15c`）。基线、Feature Task、交付验收、生产批准四处统一：API 强制要求 approver，Studio 收集姓名记在浏览器本地，输入为空不发请求。**生产批准始终由用户本人给出，Agent 不代按。**
3. **Evidence 记录观测值，不记录判定常量**（如 `passed`）。观测值指 HTTP 状态、content-type、实测 CORS 响应头、页面字节数、`acceptedCommit`。有一条测试断言序列化后的 observations 不含 `"passed"`。
4. **Agent 运行成功后由平台提交 Agent 的改动**（`874fd3c` 修复后）。提交前拦截 `.env` 与 workspace 外部符号链接。
5. **每个闸门/步骤必须能证明自己**：外部写操作先 Dry Run；未取得真实 Evidence 的步骤不能标记完成；自动修复最多两次。
6. **幂等性优先**：Provider 建项目、部署、发布都带幂等键；重试不能发出上一次残留的位（发布每次尝试都 reset）。
7. **按产品类型分叉的事实只允许有一个来源**（缺陷 24/26/30）。"这个类型用哪几家云"写在 `PRODUCT_TYPE_DESCRIPTORS[type].providers`，审批清单、人工授权项、daemon 的 provider specs、Studio 表单、blueprint 里记的部署目标、决策台的两张卡、表单里那句基线注记全部读它。判据：加第七种产品类型时只需填一行，而不是记住这一串调用点；映射用 `Record<ProductType, …>` 保证漏填即编译失败。
8. **"探测不出来"与"不存在"必须分开表达**（缺陷 29）。探测完成并给出否定结论才可缓存为否定；探测本身没跑完只能报"未知"且不得缓存。同理，能力探测失败不得隐藏已发现的对象。
9. **持久化 schema 加必填字段等于一次数据迁移**（缺陷 25）。加字段前先回答"已经写下的行长什么样"；给出与旧实现语义一致的 `.default()` 属于读迁移，与放宽输入校验是两件事——输入校验仍可严格。放宽枚举安全（旧值仍合法），收紧或新增必填不安全。
10. **界面上"不可能出现"的分支不要用断言绕过类型检查**（缺陷 20/27）。`as SomeKey` 会把缺失藏到运行时，写在它后面的兜底往往是死代码。把来源类型收紧到真实枚举，让缺失在编译期暴露。
11. **一个用例的时间预算不能被它不关心的本机探测吃掉**（缺陷 31，`64c2a72`）。任何探测本机命令行的函数都要有注入接缝（`discoverRuntimes` / `isAgentDetected`）或能让调用方改写 `PATH`：内置目录有 8 个命令、逐个同步探测、每个探针预算 5 s，最坏 40 s 而 vitest 单用例默认预算 5 s——这条不等式没解决之前，"间歇失败"就永远归因不清。两种合规写法：注入 fixture 目录，或把 `PATH` 指向只放一个可执行文件的临时目录。**故意保留的例外**：`apps/daemon/test/app.test.ts` 断言的就是路由与真实 catalog 的契约，只能用真发现，也因此仍带同样的时序风险。本条**没有自动化护栏**（写不出一个能发现"将来某条测试没注入"的测试），它是代码评审时的问题：新增用例若触到发现/探测路径，先回答它花的每一秒是不是它断言的东西。

## 3. 免费模型选型（Runtime 实测结论）

> 适用：OpenCode 2.0 通过 `api` 子命令 + `opencode2-driver.mjs` 执行时的模型选择。

- **目录里挂着的免费模型 ≠ 网关实际可用**。免费模型由网关动态提供，模型目录不会实时同步可用状态。
- `ling-3.0-flash-free` / `deepseek-v4-flash-free`：实测 401/400——401 是网关拒绝凭证对该模型访问，400 是模型名已不被后端识别（可能下线/改名）。
- `big-pickle`：实测 429 限流（免费额度限制）。
- `hy3-free`：已废弃。
- **最终选定 `nemotron-3-ultra-free`**（内置 `opencode` provider 的免费模型，1M 上下文 / 128K 输出，工具调用可用）。默认模型定义见 `packages/agent-runtime/src/index.ts` 的 `opencode.buildCommand`。

## 4. OpenCode 2.0 驱动经验

OpenCode 2.0 去掉了 v1 的 `-p --print`，非交互执行走 `api` 子命令 + `opencode2-driver.mjs`（会话创建 → 轮询 `message` 端点 → 按 `finish === 'stop'` 判定完成）：

- **`history` 端点分页失效**：`limit`/`after` 参数被忽略，总是返回前 50 个事件。改用 `message` 端点。
- **完成判定**：最新 assistant 消息的 `finish === 'stop'` 才是可靠终态；`tool-calls` 表示仍在工作。基于内容启发式会误判（只读到第一条文本就"完成"）。调试日志写到 `<workspace>/.agent-dev/opencode-driver-<ts>.json`（`OPENCODE_DRIVER_LOG` 开启）。

## 5. 环境前提（会被误判成产品缺陷）

### 5.1 网络与代理

- 本机所有 `*.vercel.app` 对不走系统代理的进程都是 DNS 污染（连不存在的域名都能解析出地址），或 TLS 连接被重置。必须用系统代理，且 Node 的 `fetch` 需要 `NODE_USE_ENV_PROXY=1` 才读代理变量。
- **Daemon 必须带 `https_proxy`/`http_proxy`/`no_proxy=localhost,127.0.0.1`/`NODE_USE_ENV_PROXY=1` 启动**，否则 `verify-api-health`、`verify-joint-smoke` 会报 `fetch failed`。
- 代理链路本身有抖动，健康检查偶发 `fetch failed`，手工 curl 显示第一次 000、第二三次 200，重跑即过。

### 5.2 Cloudflare Pages 域名生效延迟

- 新建的 Cloudflare Pages 域名有几秒才生效，**第一次联合 Smoke 失败、重跑即过**（`preview/deploy` 幂等键一致，可直接重跑）。已确认是域名生效延迟，不是代码缺陷。

### 5.3 CLI 版本与 PATH

- 本机 PATH 上有多个 codex。**codex 0.147.0 与 `~/.codex/config.toml` 的 `ark-code-latest` 模型不兼容**（刷 `ERROR codex_core::util: ReasoningSummaryDelta without active item` 直到超时）。建议卸载或降级 npm global 的 codex 0.147.0。
- **Daemon 的 PATH 需同时含**：node22（运行时）、homebrew（codex 0.142.3）、fnm node20 全局 bin（`vercel`/`wrangler`），否则出现 codex 超时或 `Vercel is not authenticated`。
- shell 默认 Node 20 会让 `wrangler` 直接拒绝运行（要求 ≥22）。`.node-version` 为 `22`。
- 所有 GitHub CLI 调用注入 Agent-Dev 保存的 `GITHUB_TOKEN`；凭证保存/删除后废弃 Provider CLI 可用性缓存。

## 6. 遗留真实资源（未清理）

以下 Preview 资源仍留在账号里，清理入口 `POST .../preview/cleanup`（确认串 `CLEANUP_PREVIEW`）：

- `receipt-test-api-pr-1`（Vercel）、`receipt-test-web-pr-1`（Cloudflare）
- `workspace-verify-fresh-api-preview`（Vercel）、`workspace-verify-fresh-web-preview`（Cloudflare）
- `link-vault-api-pr-1`（Vercel）、`link-vault-web-pr-1`（Cloudflare）

生产侧项目是交付物，**不应清理**：`receipt-test-api`/`receipt-test-web`、`workspace-verify-fresh-api`/`workspace-verify-fresh-web`、`link-vault-api`/`link-vault-web`。
