# Platform Preflight Probe

这个 Probe 只检查 Agent-Dev v0.1 所需本地工具及其登录可用性，不创建、修改或删除任何云端资源，也不输出账号身份和凭据。

## 离线检查

```bash
npm install
npm run probe
```

## 在线只读检查

```bash
npm run probe:online
```

在线模式分别使用各 CLI 的只读身份或项目列表命令，只返回认证是否成功。Codex 的真实认证仍由 Codex Runtime Probe 验证，因为 `codex --version` 只能证明 CLI 已安装。

`installed` 与 `usableWithinCurrentBoundary` 分开报告：工具存在但尝试向 `agent-dev` 之外写本地状态时，会显示已安装但当前边界不可用，并跳过在线认证。

当前 Supabase CLI 即使执行 `--version` 也会创建 `~/.supabase`。Probe 因此只解析其可执行文件位置，不启动它，并报告 `requires-out-of-workspace-local-state`。在找到官方状态目录覆盖方式前，不得绕过此保护。

这个 Probe 是未来 `agent-dev doctor` 的前置实验，不等同于 Dual Preview 或 Supabase Auth 已通过。
