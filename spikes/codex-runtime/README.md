# Codex Runtime Spike

这个 Spike 验证 Agent-Dev 能否通过本机 Codex CLI 建立最小、可审计的 Runtime Adapter。它只在系统临时目录创建隔离 Git 仓库，不读取同级产品代码，也不打印登录凭据。

## 前置条件

- Node.js 20+；
- Git；
- 已安装并登录的 Codex CLI；
- 当前 Codex 版本支持 `codex exec`、`--json`、`--output-schema` 和 `--output-last-message`。

## 只读 Probe

```bash
node spikes/codex-runtime/probe.mjs
```

预期：Codex 只读取 fixture 的 `README.md`，输出 JSONL事件和符合 Schema 的最终 JSON，不修改文件。

## 受限写入 Probe

```bash
node spikes/codex-runtime/probe.mjs --write
```

预期：Codex 仅在临时 fixture 中创建内容固定的 `RESULT.txt`。脚本独立读取文件验证结果，不信任 Agent 自述。

## 输出

运行记录保存在 `spikes/codex-runtime/output/`，该目录被 Git 忽略：

- `read-events.jsonl` / `write-events.jsonl`；
- `read-final.json` / `write-final.json`；
- `read-stderr.log` / `write-stderr.log`。

Probe 输出只汇总版本、退出码、信号、事件类型、最终结构化响应和确定性写入验证。

## 安全边界

- 使用 `--ask-for-approval never`，不允许命令升级权限；
- 只读模式使用 `--sandbox read-only`；
- 写入模式使用 `--sandbox workspace-write`，工作目录是新建临时仓库；
- 使用 `--ephemeral`，不保存可恢复 Session；
- 使用用户当前 Codex 配置和认证状态；Probe 不读取或打印认证凭据；
- 不使用 `--dangerously-bypass-approvals-and-sandbox`；
- 180 秒后发送 `SIGTERM`，5 秒后仍未退出才发送 `SIGKILL`；
- 输出中对形似 OpenAI API Key 的内容进行脱敏。

## 未覆盖

- Session 持久化与 `codex exec resume` 的真实恢复；
- 长任务取消后的服务端状态和计费；
- 多 Runtime 并发；
- tool-call 级 Policy；
- Codex CLI 事件 Schema 的跨版本兼容承诺。
