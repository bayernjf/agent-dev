# Secret Boundary Spike

这个 Spike 验证 Agent-Dev 的本地 Secret 边界：状态数据库只保存引用，Provider 执行时按需解析，Coding Agent 使用严格环境白名单，所有日志经过脱敏。

## 运行

```bash
node spikes/secret-boundary/probe.mjs
```

Probe 会在忽略的 `tmp/` 下创建一个随机、独立的 macOS Keychain 和 SQLite 数据库。实验结束后两者都会被删除，不写用户默认 Keychain。

## 验证内容

- 临时 Keychain 能存取随机 Provider Secret；
- SQLite 仅保存 `keychain://agent-dev/provider/environment` 引用；
- SQLite 文件字节中不存在 Secret；
- Provider fixture 能在单次子进程环境中使用 Secret；
- Agent fixture 仅接收白名单变量，敏感名称或包含已知 Secret 的伪装值即使被列入也会被拒绝；
- 日志能按已知 Secret 值和常见 Token 形态脱敏。

## 边界

生产实现不能在命令参数、日志、Prompt、GitHub Artifact 或 Blueprint 中传输 Secret。这个 Spike 的随机 Keychain 密码和随机 Provider Secret 都是短期实验值，不代表生产凭据交互方式。
