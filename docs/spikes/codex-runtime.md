# Codex Runtime Spike 记录

> 日期：2026-08-02
> 状态：受限 Execute 路径已实现，实际认证成功路径仍阻塞
> 实验代码：[`spikes/codex-runtime`](../../spikes/codex-runtime/)

## 1. 目标

验证 Agent-Dev v0.1 能否使用用户电脑内已存在的 Codex CLI，完成受限、非交互、结构化、可取消的代码任务，而无需读取或托管用户的 Codex 登录凭据。

## 2. 本机能力探测

最近探测到的实际安装版本：

```text
codex-cli 0.142.3
```

当前 CLI 明确提供：

- `codex exec`：非交互执行；
- `codex exec resume [SESSION_ID] [PROMPT]`：按 Session ID 恢复；
- `--json`：stdout 输出 JSONL事件；
- `--output-schema <FILE>`：约束最终响应 Schema；
- `--output-last-message <FILE>`：把最后消息写入文件；
- `--cd <DIR>`：限定主工作目录；
- `--sandbox read-only|workspace-write|danger-full-access`；
- `--ask-for-approval` 全局策略；
- `--ephemeral`：不保存 Session；
- `--ignore-user-config`：忽略用户 config，但继续使用 Codex 自身认证；
- `--skip-git-repo-check`：允许非 Git 目录，Agent-Dev 首版不使用；
- `review`：非交互代码审查入口。

CLI 能力检查成功，但实际请求返回认证失败，因此不能据此判断当前登录是否可用。本文档不记录认证类型、Token、局部 Key 或任何凭据内容。

## 3. 首版 Runtime 决策

### 采用

- 使用 `codex exec`，不解析交互式 TUI；
- 每个 Delivery Task 使用独立 Git worktree；
- 默认 `workspace-write`，只允许修改任务 worktree；
- 使用 `--json` 收集事件，使用 `--output-schema` 约束最终总结；
- 通过进程退出码、Git diff、质量命令和外部平台状态判断成功；
- 通过 `SIGTERM`/`SIGKILL` 实现本地取消；
- 初期可使用 ephemeral 模式完成独立任务。

### 禁止

- `danger-full-access`；
- `--dangerously-bypass-approvals-and-sandbox`；
- 读取 `$CODEX_HOME` 中的认证文件；
- 把生产 Secret 写入 Prompt 或工作区；
- 仅根据最终自然语言判断任务完成；
- 使用交互式终端屏幕文本作为稳定协议。

## 4. Adapter 输入与输出

建议输入：

```ts
type DeliveryTask = {
  runId: string;
  taskId: string;
  workspace: string;
  prompt: string;
  acceptanceCriteria: AcceptanceCriterion[];
  allowedPaths?: string[];
  forbiddenPaths: string[];
  qualityContract: QualityContract;
  timeoutMs: number;
};
```

建议输出：

```ts
type AgentSessionResult = {
  processExitCode: number | null;
  signal: string | null;
  timedOut: boolean;
  eventLogReference: string;
  finalStructuredOutput?: unknown;
  gitDiffEvidence: Evidence;
  qualityEvidence: Evidence[];
};
```

最终响应只作为摘要；Git diff、测试和 CI 才是交付事实。

## 5. Probe 设计

Probe 创建独立临时 Git 仓库并执行两种模式：

1. `read-only`：读取一个 README，输出结构化 JSON，不允许文件修改；
2. `workspace-write`：只创建内容固定的 `RESULT.txt`，脚本独立读取验证。

两种模式均：

- 使用 ephemeral Session；
- 忽略用户自定义配置；
- 不允许审批升级；
- 使用 JSONL事件；
- 使用最终输出 Schema；
- 设置 180 秒超时和两阶段终止；
- 对输出中的凭据形态进行脱敏。

## 6. 当前未决事项

- 本机 Codex 需要由用户自行恢复有效认证，之后才能完成真实执行验证；
- JSONL事件类型与字段是否有公开稳定性保证；
- 持久 Session 与 `exec resume` 的真实恢复行为；
- `SIGTERM` 后远端推理是否立即取消；
- 如何从事件中获得稳定 Session ID、Token/成本和 tool-call 证据；
- CLI升级后的能力探测和兼容策略；
- Runtime级 allowed-path 能否仅依赖 sandbox，或需要 Agent-Dev diff validator 二次限制。

## 7. 后续验证

Agent-Dev 当前已实现显式 `EXECUTE_RUNTIME_RUN` 路径：仅已批准 Feature Task、隔离 workspace、`workspace-write` sandbox、`--ask-for-approval never` 和环境变量白名单可以进入子进程执行。执行结果以退出码、超时、输出和 Git evidence 持久化；dry-run 仍是默认路径。该实现通过了注入式 Runtime Runner 测试，但没有把测试替代为真实模型成功证据。

已完成的只读 Probe 曾成功启动 CLI 并观察到 `thread.started`、`turn.started`、重试/错误和 `turn.failed` 事件，证明非交互入口与 JSONL 事件通道可用。请求随后因本机认证无效而失败，尚未产生符合 Schema 的最终输出。

2026-08-06 的追加只读 Probe 使用 `--ephemeral --sandbox read-only --json --cd <agent-dev>`。CLI 在发起模型请求前尝试打开 `~/.codex/state_5.sqlite`，但当前受限执行环境禁止写入该目录，因此以 `Operation not permitted` 停止。该结果不代表认证失败，也不代表任务代码失败；它只证明 Agent-Dev 不能通过受限运行环境验证 Codex 自身状态目录的写权限。Probe 未修改项目文件，也没有执行模型请求。

认证恢复后按以下顺序继续：

1. 重新运行只读 Probe，验证成功退出、最终 Schema 和零文件修改；
2. 运行受限写入 Probe，验证唯一允许的文件变更；
3. 记录成功路径的事件类型、退出码和最终输出；
4. 另建持久 Session fixture，验证 resume；
5. 用可控长任务验证取消；
6. 把已验证能力固化为 `RuntimeCapabilities`，未验证能力保持 false。

官方 Codex 文档页面在本轮访问中返回 `403`。本 Spike 的能力结论来自本机 CLI `--help` 和实际运行结果；实现合并前仍需用可访问的官方资料复核兼容承诺。
