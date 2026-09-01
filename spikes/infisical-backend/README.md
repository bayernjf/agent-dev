# Infisical Secret Backend Probe

P1-2 的 Infisical 适配器（`packages/provider-cli/src/secret-backend/infisical.ts`）按官方 OpenAPI 参考实现并通过了单元测试，但端点形状与 CLI JSON 输出**尚未对真实 Infisical 云端验证**（用户决策：真实验证延后，P1-2 状态为「代码完成，真实验证待办」）。本 Probe 就是补上这一步的既定工具。

## 配置步骤

1. 安装 CLI（仅 CLI 路径需要；配了 Service Token 则走 API 路径，无需 CLI）：

   ```bash
   npm install -g infisical
   ```

2. 登录并创建（或选择）一个项目：

   ```bash
   infisical login
   infisical projects create agent-dev-scratch   # 或在控制台创建
   ```

3. 配置环境变量：

   | 变量 | 必填 | 说明 |
   | --- | --- | --- |
   | `INFISICAL_PROJECT_ID` | 是 | 项目 ID（控制台 Project Settings 可见） |
   | `INFISICAL_SERVICE_TOKEN` | 可选 | 设置后走 REST API 路径（写操作值进 JSON body，不进 argv）；不设则走 CLI 路径 |
   | `INFISICAL_ENVIRONMENT` | 可选 | 默认 `dev` |
   | `INFISICAL_API_URL` | 可选 | 默认 `https://us.infisical.com` |
   | `AGENT_DEV_SECRET_BACKEND` | 可选 | 设为 `infisical` 让 agent-dev 凭证系统走 Infisical 后端（默认 `local-file`） |

## 离线检查

```bash
npm run probe
```

只检查 CLI 是否安装、配置变量是否就位（只报告布尔值，不输出任何密钥内容），不发起网络请求。

## 在线回环（真实验证）

```bash
npm run probe:online
```

对项目中的一个 scratch key（`AGENT_DEV_PROBE_SCRATCH`）执行真实的 `set → get → list → rotate → delete → 验证已消失` 回环，输出 Evidence JSON。

- 优先 API 路径（有 `INFISICAL_SERVICE_TOKEN` 时），否则 CLI 路径。
- scratch 值为随机一次性内容；Probe 从不打印密钥值，只输出每一步的布尔结果。
- CLI 路径的 `secrets set KEY=VALUE` 会把值放进 argv（审计 S10 已声明的 CLI 限制），因此仅用随机 throwaway 值执行。
- 回环 `complete: true` 即可把 P1-2 的「真实验证待办」升级为已验证，并同步 `docs/implementation-plan-v0.2.md` 的状态。

本轮（2026-09-01）按用户决策**未执行**在线探测。
