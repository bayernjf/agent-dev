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

当前代码已提供本地 Agent Catalog API 和 Studio 面板：内置 Agent 来自 Key-Value 文件，本机未安装的内置 Agent 不显示；用户可以通过弹窗添加 custom Agent，未安装的 custom Agent 置灰并持久化到 `.agent-dev/agents.conf`。Capability Probe 现在返回明确的 Adapter 状态：`verified`（可执行）、`candidate`（可生成 dry-run，但未实测执行）或 `unsupported`（无 Adapter）。当前仅 Codex Adapter 已完成隔离 workspace 的真实执行验证；其他 Agent 不能自动执行。`isAgentExecutable()` 只会为 `verified` Adapter 返回 `true`。
