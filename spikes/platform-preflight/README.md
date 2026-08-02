# Platform Preflight Probe

这个 Probe 只检查 Agent-Dev v0.1 所需本地工具及其登录可用性，不创建、修改或删除任何云端资源，也不输出账号身份和凭据。

## 离线检查

```bash
node spikes/platform-preflight/probe.mjs
```

## 在线只读检查

```bash
node spikes/platform-preflight/probe.mjs --online
```

在线模式分别使用各 CLI 的只读身份或项目列表命令，只返回认证是否成功。Codex 的真实认证仍由 Codex Runtime Probe 验证，因为 `codex --version` 只能证明 CLI 已安装。

这个 Probe 是未来 `agent-dev doctor` 的前置实验，不等同于 Dual Preview 或 Supabase Auth 已通过。
