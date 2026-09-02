# Agent Runtime Catalog

> 状态：Key-Value Catalog、Studio 选择、Custom 持久化和只读 Capability Probe 展示已实现；多 Agent 执行 Adapter 仍按能力逐个验证
> 日期：2026-08-07

## 1. 目标

Agent-Dev 不绑定单一 coding agent。它提供统一的 Agent Runtime Catalog：内置 Agent 由框架提供识别规则和 Adapter，用户安装状态由本地 Daemon 自动检测；用户也可以用最少信息添加自定义 Agent。

维护者只维护简单的 Key-Value 内置目录；最终用户通过 Studio 弹窗填写名称和启动命令，不接触配置文件。复杂执行配置由代码和 Adapter 补全。

## 2. 三层模型

### 内置目录

Agent-Dev 发布已知 Agent 的简单目录，文件为 `packages/agent-runtime/agents.builtin.conf`：

```text
"Claude Code" = "claude"
"Codex" = "codex"
"Aider" = "aider"
"OpenCode" = "opencode"
"CodeBuddy" = "codebuddy"
"Pi" = "pi"
"Hermes" = "hermes"
"OpenClaw" = "openclaw"
```

`built-in` 表示“Agent-Dev 内置识别与适配规则”，不表示用户电脑一定已经安装。

### 本机发现

Daemon 读取目录后执行最小本地检查：

1. 检查命令是否存在；
2. 读取版本；
3. 检查帮助信息和非交互入口；
4. 运行只读 Capability Probe；
5. 记录能力、认证状态和失败原因。

发现结果必须区分：`missing`、`available`、`unauthorized`、`unsupported` 和 `error`。命令存在但 `--version` 失败时仍显示为已发现，并将版本标为未知，不能误判为未安装。

### 自定义 Agent

用户可以输入 Agent 名称和启动命令，Agent-Dev 自动生成内部描述、执行探测并保存为 `custom` Agent。用户不需要直接编辑配置文件。

内置 Agent 未检测到时隐藏；用户自定义 Agent 未检测到时保留并置灰，标记为 `Not installed`。

Agent Catalog 不做实时监控、文件监听或后台轮询。Studio 首次打开时执行一次检测，用户点击刷新按钮后主动重新检测。

## 3. 新手添加流程

```text
输入 Agent 名称 + 启动命令
  -> 检查命令存在
  -> 获取版本和帮助
  -> 运行只读 Probe
  -> 生成能力报告
  -> 用户确认识别结果
  -> 保存 Custom Agent
  -> 可选设为项目默认 Runtime
```

最小表单只有：

- Agent 名称，例如 `My Local Agent`；
- 启动命令，例如 `my-agent`，或选择本地可执行文件。

识别成功后 Studio 显示：

```text
My Local Agent
Custom
Available
Version: 1.2.0
Read-only: Supported
Workspace write: Unknown
Structured output: Unknown
```

未识别的能力显示 `Unknown`，不能被自动推断为支持。

### 3.1 发现只有两种结论（2026-08-26 补充，2026-09-01 改写）

| 结果 | 含义 | 是否缓存 |
| --- | --- | --- |
| `resolveExecutablePath()` 在 PATH × PATHEXT 上找不到 | 命令确实不在 PATH 上 | 缓存（结论确定） |
| 找到了但 `--version` 失败 / 超时 | Agent 存在，版本未知 | 缓存为 detected，版本 `null` |

本节以前还分三种结果，因为 PATH 查找是**外部命令 `which`**：它自己可能超时 / EAGAIN / ENOENT，而那种“没跑起来”曾会被当成“命令不存在”，一次失败的查找就可能把已装好的 Agent 在 Studio 里标成不可用、让 daemon 拒绝启动它并返回 409，且结论缓存到进程结束（缺陷 29）；当时的修法是两个预算各重试一次、未知结论不落缓存。

2026-09-01 把这类不确定整个去掉了：发现改为进程内用 `existsSync` 遍历 PATH 与 PATHEXT，无子进程、无超时，所以不存在“查找本身失败”这种状态。选型理由：Windows 根本没有 `which` 命令，那套重试在一个目标平台上永远走不通（本机此前能用，纯因 hermes 带了一个 MSYS 版 `which`）。Windows 下 PATHEXT 条目必须优先于无后缀名：npm 会同时留下 `claude`（POSIX sh 脚本）与 `claude.cmd`，把前者交给 shell 会挂到超时；探测传的是固定字面量参数，所以 win32 下 `--version` / `--help` 带 `shell: true`（与 `doctor.ts` 同样理由），不因此引入注入面。

### 3.2 “已检测”不等于“能执行”（2026-09-01 补充，2026-09-02 收紧）

`detected` 只回答“这个 CLI 本机装了没”，而能不能跑 Feature Task 取决于 `AGENT_ADAPTERS` 里的状态（`verified` / `candidate` / `unsupported`）：`verified` 是通过非交互执行契约实测过的；`candidate` 命令形态已知但没实测过；`unsupported` 根本没有 Adapter。两个事实不能混为同一个标签，所以 `/api/runtime/catalog`（GET 与 POST）除 `AgentDescriptor` 字段外额外带一个 `adapterStatus`，Studio 的徽章直接按它渲染 `Verified` / `Candidate`，不让浏览器从 `detected` 推断。该字段是 daemon 从 Adapter 注册表取的，与本机装了哪些 agent 无关。

2026-09-02 起，非 `verified` 的 Agent 在任何一层都拿不到计划：Studio 不让它被选中；`resolveRuntimeExecutor()` 只承认 `verified`，是“这个任务由谁执行”的唯一解析点（去 `local-` 命名空间、把 Agent Profile 解析到 base agent、再查注册表）；daemon 的两条 Runtime 路由与 storage 的两个写入点共用它，拒绝时返回 409 + `code: agent_not_executable` + `agentId`，绝不换一个 Agent 顶上。

同一天补上的是客户端那一半：Studio 也不代替用户挑执行者。加载 `/api/runtime/catalog` 只清除已经失效的选择（不在目录里且不是 Profile 才算失效），不写入任何新选择；Runtime 面板头部允许印出的名字只来自 `runtimeExecutorId()` 的一条链——已准备的运行记录、用户的显式选择、已批准 Blueprint 的 provider（去掉命名空间）。此前它会默认选中目录里第一个可运行的 Agent，于是一份指名 Claude Code 的项目在页面上写着 Codex，而 Prepare 真的发出了一次 Codex 运行。

同日还拆开了目录行上的两个意图：过去点一行会同时跑只读能力探测**和**把该 Agent 写成执行者，于是「看了一眼」与「派了活」是同一个动作。现在行本身只负责选定执行者（`canRunTasks` 不过就 `disabled`，理由仍写在行内），探测移到行右侧的独立按钮——任何已装上的 CLI 都可以探测，探测完不改变任何选择。`agent-selectability.test.ts` 钉住两点：`probeAgent` 函数体内不得出现 `setSelectedAgentId`，且全文件只有一个控件在 click 时调用探测。

此前 candidate 可以生成 dry-run 计划、只在执行阶段被 `buildAgentExecutionPlan` 拒——那次拒绝发生在用户已经看到计划之后，而计划里写着的是一条永远跑不起来的命令。更旧的行为更糟：解析不出来就回退 Codex，于是一份指名 Claude Code 的 Blueprint 会得到一份 Codex 的运行记录。409 同时被“还没有已批准任务”使用，所以两种事实必须靠 `code` 区分；Studio 侧因为浏览器不能 import 本包（顶层 `node:child_process`）镜像了同一个字面量，两边测试各自钉死该字符串。

### 3.3 探测读的是帮助输出，不是能力（2026-09-02 补充）

`probeAgentCapabilities()` 只做一件事：读进一页 CLI 的 help 输出，检查**我们自己的 Adapter 会传的那几个参数**在不在里面。它从不启动一次真实运行，因此：

- `nonInteractive: true` 的意思是“帮助输出把它要找的参数列为一项”，不是“这个 Agent 能非交互运行”。后一句由 `AGENT_ADAPTERS` 的 `verified` 记录，那是真跑过一次、退出码为 0 才写下的。
- `nonInteractive: false` 底下是两种事实，Studio 必须分开渲染（`apps/studio/src/lib/capability-verdict.ts`）：帮助输出答了而参数不在（`absent`）；帮助输出没答，或本来就没有参数可找（`inconclusive`）。此前两者都印成 `unknown`，等于对着“查过且没找到”说“没人查过”。OpenCode 2.0 属于后者——它的非交互路径是 driver 脚本里的 `opencode api POST /api/session`：本机实测它的 `--help` 连 `api` 这个词都不出现，所以旧表拿 `api` 当期望永远命中不了；而即使某一版帮助页列出了这个子命令，一个子命令名也说不清“这一趟运行不需要人应答”，那张期望表只会凭空白给出一份判定。
- 参数只有独立成一个 token 才算列出：`--json-lines` 不能替 `--json` 作证，`--permission-mode` 里含的 `-p` 也不是 Claude Code 的 `-p`。原子串匹配两处都会给出确认。
- help 只有在命令真的跑起来且退出码为 0 时才算答案。win32 下探测带 `shell: true`，一个不存在的命令也会由 cmd.exe 回一段“不是内部或外部命令”的文本；把它当帮助页读，就会对一个压根没装上的 Agent 得出“帮助输出说它不支持”这个反过来的结论。
- 问的是哪一层 help 由参数表决定：`codex --help` 根本不列 `--json`，`codex exec --help` 才列。此前只读顶层，于是把一个已实测过执行契约的 Agent 报成缺能力——假阴性出在问题问错了地方，而不是出在那个 Agent 上。

参数表在 `src/non-interactive-switches.ts`，每一条都必须是 `AGENT_ADAPTERS` 真正传的参数。两个表分处两个文件、曾经漂移过：aider 查的是 `--yes`（Adapter 传的是 `--yes-always`，靠子串侥幸命中），openclaw 查的是它并没有的 `exec` 子命令。`test/capability-probe.test.ts` 逐条比对二者，并用注入的假 help 输出覆盖上面每一条判据，不再依赖跑测试这台机器装了哪些 CLI。

探测行原来还有一枚 `workspace-write` chip 已删除：那个字段是名为 probe 的函数从 `BUILT_IN_CAPABILITIES` 的静态声明里抄来的，而同一行上一排 chip 展示的就是那份声明。探测不该为自己没测的东西作证；声明留在声明的位置。本机实测（`codex`/`claude`/`codebuddy`/`hermes` 四个）改造后全部为 `listed`，`opencode` 为 `inconclusive`，未安装的 `aider` 与超时的 `openclaw` 也是 `inconclusive`——改造前 `codex` 报的是 `unknown`。

### 3.4 发现的代价，以及测试因此要注入（2026-09-02 补充）

`discoverAgentRuntimes()` 是顺序探测：内置目录里 **8 个 Agent** 一个个查，`--version` 与 `--help` 的预算各 5 s（`src/catalog.ts`），最坏 40 s。而 vitest 单用例默认预算也是 5 s，所以**任何在测试里顺手调一次真发现的用例，都在赌这台机器当时有多闲**。2026-09-02 连跑 8 次全量量到 2 次超时（`apps/cli/test/mcp.test.ts` 的只读工具用例、`packages/agent-runtime/test/catalog.test.ts` 的内置过滤用例），红讯都是 `Test timed out in 5000ms`；`vitest.config.ts` 的 `fileParallelism: false` 只把这条不等式变缓，没有改变它。

两条纪律：

- **问接线的测试注入目录**：daemon 的 `DaemonDependencies.discoverRuntimes`（与 `isAgentDetected` 同一模式）让 MCP 桥那类用例只付自己那一份，链路仍是 MCP client → bridge → HTTP → daemon route → store 全程真跑。注入的目录是夹具，看不见 `POST /api/runtime/catalog` 刚追加的 custom Agent，要断言新条目就得走真发现。
- **问过滤的用例把 PATH 指到夹具目录**：`catalog.test.ts` 第一例只放一个内置命令的临时目录前置到 PATH，断言结果恰好是那一个。改之前它走真 PATH，而 `every()` 对空数组恒真——一台什么都没装的机器会让它绿着，测到的是本机装了什么，不是过滤器。另外 `detect()` 按命令缓存：这一跑会把其余七个内置名字缓存成「不在」，所以同文件后面的用例只能继续探自己的夹具命令，「期待某个真内置 Agent 被检出」的用例不能再加进这个文件。

`apps/daemon/test/app.test.ts` 是**故意**保留真发现的：它断言的是真路由契约（每条 agent 的 `adapterStatus === getAgentAdapterStatus(id)`、custom agent 为 `unsupported`），换成夹具就等于把契约本身换成夹具。代价是它仍带着同样的贴边风险。

### 3.5 本机逐个 Agent 的 Adapter 对账（2026-09-02）

交接文档 §8-11.2 一直挂着「仍需在各 Agent 实际安装环境逐个验证 Adapter」。这台机器实测**八个内置全在 PATH 上**，所以这一次把八份都对完了。方法全程只读：`discoverAgentRuntimes()` 给检出与版本，`buildAgentExecutionPlan(task, cwd, id, { execute: false })` 给**我们真正会传的 argv**（从公开 API 取，不抄我读到的源码），`probeAgentCapabilities()` 给探针判定；然后把 argv 里**每一个以 `-` 开头的 token** 用与探针同一条「必须独立成词」规则拿去问该 CLI 自己的帮助——先问参数表指定的那一层，再问顶层。除 `--version` 与 `--help`/`-h` 外没有向任何 agent CLI 传过参数，没有跑过任何一次任务。

| Agent | 本机版本 | Adapter | 探针 | Adapter 传的 flag 在帮助里独立成词 |
| --- | --- | --- | --- | --- |
| codex | `codex-cli 0.147.0` | verified | true | 4/4（`exec --help` 层：`--json` `--ephemeral` `--sandbox` `--cd`） |
| claude-code | `2.1.231 (Claude Code)` | candidate | true | 4/4（顶层：`-p` `--allowedTools` `--dangerously-skip-permissions` `--output-format`） |
| aider | `aider 0.86.2` | candidate | true | 2/2（`--message` `--yes-always`） |
| opencode | `opencode2 v0.0.0-beta-17823` | verified（走 driver） | false / 帮助答得出 | 不适用：argv 里唯一带 `-` 的 token 是**我们自己 driver 的** `--prompt=<临时文件>`，不是 opencode 的参数 |
| codebuddy | `2.142.0` | verified | true | 3/3（`-p` `--permission-mode` `--no-session-persistence`） |
| hermes | `Hermes Agent v0.20.6 (2026.8.27)` | verified | true | 3/3（`-z` `--in` `--yolo`） |
| openclaw | **答不出** | candidate | false / 帮助答不出 | 0/4，四个全是「帮助没答」 |
| pi | **答不出** | **无 Adapter** | 无期望条目 | — |

1. **六个能答的，Adapter 真传的 flag 全部有据**：一个都不缺，包括探针根本没去问的那些。顺带量出探针只查子集：探针问的是 1–2 个 flag，Adapter 真传的是 3–4 个（codex 只问 `--json`，却还传 `--ephemeral --sandbox --cd`；claude 只问 `-p`，却传 4 个）。所以 `nonInteractive` 为真**不等于整条 argv 有据**——本轮把没问的那些也核了，全绿。要不要把它们补进期望表是另一个决定：补全会让 CLI 帮助一改版就掉判定，而"问错层"的假阴性见 §3.3。
2. **openclaw 与 pi 在本机不可验证，原因是环境不是产品**：这台 shell 的 node 是 v20.20.2，openclaw 的启动器直接以 `Node.js >=22.22.3 <23, >=24.15.0 <25, or >=25.9.0 is required (current: v20.20.2).` 退出 1（stderr 167 字节，stdout 空）；pi 退出 1 并往 stderr 倒 57 KB 打包栈。而交接文档 §8-7 的 daemon PATH 配方**要求带上 fnm node20 全局 bin**（为了 `vercel`/`wrangler`），所以 daemon 起来后 openclaw 仍会在同一道门上挂——它的 candidate 状态在这台机器推不动，除非换 node。
3. **修掉一条假陈述**（`806d490`）：`--version` 没答出来的 Agent，`version` 字段此前装的是那段错误文本的第一行，于是 Studio 会把「Node.js >=22 才够」和一行 bundle 路径**当版本号印出来**（`App.tsx` 的 `{agent.version && …}`）。现在探测没答就没有版本，而 PATH 上存在这件事仍由 `detected` 表达（§3.1 的两分不变）——这条已沉淀成 [经验沉淀](real-world-lessons.md) §2 规则 8 的一般形式：**探测填的每个字段，没答出来就不能替它作答**。种植反证：把 guard 撤掉，新用例红在 `expected 'Example: Node.js >=22 is required (cu…' to be null`；改回来后本机重跑，pi 与 openclaw 的 `version` 均为 null，其余六个照旧。
4. **一处声明与测量的不一致，只记录不动**：`BUILT_IN_CAPABILITIES.pi` 声明 `version-detection`，而它连版本都答不出，Studio 那排 chip 展示的就是这份声明。这与 §3.3 里删掉的 `workspace-write` chip 同一形态，但处理它要先决定这份 capabilities 表整体算「声明」还是「测量」，属架构判断。
5. **一处文档过期**：§5.3（真实链路经验沉淀）写的是 homebrew codex `0.142.3`，实测现在解析到 `0.151.0`；而默认 PATH 上的 `codex` 仍是 fnm node20 全局 bin 里的 `0.147.0`，即那份记录里点名要避开的那版。0.147.0 与 `ark-code-latest` 不兼容这一条**今天没有重测**（要真跑一次模型调用），本轮只更新了版本号观测。

§3.3 结尾那句「本机实测（四个）…」已被本节的八份对账取代。

## 4. 专业模式

自动探测失败时，专业模式才允许补充完整执行参数：

```yaml
id: my-agent
name: My Local Agent
source: custom
command: /Users/me/bin/my-agent
versionCommand: ["--version"]
execute:
  command: ["run", "--workspace", "{{workspace}}", "--prompt", "{{prompt}}"]
capabilities:
  readOnly: true
  workspaceWrite: false
  structuredOutput: false
  cancel: false
  resume: false
environment:
  allow: [PATH, HOME, LANG]
```

这份结构由 Studio 生成和校验，不要求用户手工维护。当前本地实现将用户自定义 Key-Value 保存到当前 Agent-Dev 的 `.agent-dev/agents.conf`，不写入产品工作区或 Git 仓库；后续桌面安装版可迁移到用户级 `~/.agent-dev/agents.conf`。

## 5. Runtime 选择

Studio 提供三种选择层级：

1. 项目默认 Agent；
2. 单个 Feature Task 临时覆盖；
3. 失败后的人工选择备用 Agent。

Blueprint 只保存 Agent ID，不保存完整命令：

```yaml
runtime:
  provider: codex
```

命令、版本、能力和安全策略由 Catalog/Adapter 提供，避免每个项目重复复制执行细节。

## 6. 安全边界

无论内置还是自定义 Agent，都必须遵循同一套边界：

- 只允许访问已批准的 workspace；
- 环境变量使用白名单；
- 不读取、打印或上传 Agent 登录 Token；
- 生产 Secret 不进入 Prompt 或 Agent 环境；
- 自动执行前必须完成只读 Probe；
- 未知能力不能自动标记为可执行；
- 退出码、Git diff、Quality Gate 和人工验收才是交付事实。

用户输入一个命令并不等于 Agent-Dev 可以直接执行它。自定义 Agent 仍要经过能力探测和显式批准。

## 7. 分阶段实施

### 阶段 A：Catalog 和 Discovery（已完成）

- [x] 定义 `AgentDescriptor` 和 custom 输入契约；
- [x] 注册 Codex、Claude Code、OpenClaw、Pi Agent、CodeBuddy 内置目录；
- [x] 增加 Daemon `/api/runtime/catalog` 查询与 custom 登记 API；
- [x] 将 Catalog 接入 Studio 展示和 Runtime 选择。

### 阶段 B：自定义最小配置

- 名称 + 启动命令表单；
- 本地可执行文件选择；
- 自动版本检测和只读 Probe；
- 自动生成 `.agent-dev/agents.conf`；
- 专业模式补充命令模板和能力声明。

### 阶段 C：多 Runtime 交付

- Claude Code Adapter；
- OpenClaw、Pi Agent、CodeBuddy 按真实重复需求接入；
- 统一取消、恢复、输出解析和 Evidence Schema；
- 失败后备用 Agent 选择和恢复流程。

## 8. 当前实现边界

当前代码已提供本地 Agent Catalog API 和 Studio 面板：内置 Agent 来自 Key-Value 文件，本机未安装的内置 Agent 不显示；用户可以通过弹窗添加 custom Agent，未安装的 custom Agent 置灰并持久化到 `.agent-dev/agents.conf`。Capability Probe 现在返回明确的 Adapter 状态：`verified`（可执行）、`candidate`（命令形态已知，但未通过非交互执行验证，因此不能承接任务）或 `unsupported`（无 Adapter）。已完成隔离 workspace 真实执行验证的 Adapter 是 Codex、OpenCode、CodeBuddy 与 Hermes；`isAgentExecutable()` 只会为 `verified` Adapter 返回 `true`，而执行者解析（`resolveRuntimeExecutor()`）与它同一判据，见第 3.2 节。

## 9. Agent Profile（基于已有 Agent 创建变体）

除了添加全新的自定义 Agent，用户还可以基于已有的 verified Agent 创建 **Agent Profile**——命名变体，通过覆盖 system prompt、模型、温度、工具白名单、环境变量等配置来定制 Agent 行为。例如：

- `codex-frontend`：基于 Codex，system prompt 专注 React/TypeScript
- `codex-reviewer`：基于 Codex，禁用 Write/Edit 工具，只做代码审查

Profile 是用户级配置（存储在 `.agent-dev/agent-profiles.json`），继承底层 Agent 的执行契约和安全边界（工具只能收窄不能放宽，环境变量必须在白名单内）。在 Runtime 选择时，Profile 和内置 Agent、自定义 Agent 平级。

详见 [custom-agent-profiles.md](./custom-agent-profiles.md)。
