# Dual Preview Spike 记录

> 日期：2026-08-02
> 状态：已通过真实云端验证，部署编排已实现为正式产品代码
> 实验代码：[`spikes/dual-preview`](../../spikes/dual-preview/)
> 正式实现：[`packages/deployment-composer`](../../packages/deployment-composer/)
> 最近验证：2026-08-08，项目 `e2e-test-real`

## 1. 目标

验证首版固定部署组合不是两个互不相干的成功状态，而是一条有数据依赖的联合 Preview：

```text
derive exact Pages branch origin
-> create disposable Vercel project and disable preview protection for this project only
-> deploy Vercel API Preview with exact CORS
-> verify API and capture preview URL
-> inject API URL into frontend
-> deploy Cloudflare Pages preview branch
-> verify page source and cross-origin API
-> record Evidence
-> delete disposable projects
```

## 2. 安全设计

- 默认模式只输出 Plan；
- `--apply` 才执行外部写操作；
- 项目名包含用户批准的唯一 `run-id`；
- 禁用 Vercel telemetry 和 Wrangler 文件日志；
- 不读取 CLI 认证文件，不接收 Token 参数；
- 仅对专用临时项目关闭 Vercel Preview Protection，生产项目必须由 Blueprint Policy 决定；
- 只删除本次成功创建的精确项目名；
- 任一清理失败时运行失败，并输出最小 Manual Action；
- Evidence 不记录账号、组织和凭据。

## 3. 验收标准

1. API Preview `/api/health` 返回成功；
2. `Access-Control-Allow-Origin` 允许 Pages origin 跨域访问；
3. 前端构建内容包含该次 Vercel API URL；
4. Cloudflare Pages branch URL 可访问；
5. 以 Pages origin 请求 API 时联合 smoke 成功；
6. 临时云项目在验证完成后由用户决定保留或删除；
7. 未运行真实云端流程前，状态不能标记通过。

## 4. 与生产实现的差异

Spike 使用最小静态页面和 Vercel Function，只验证部署编排契约。Phase C/D 的正式模板仍使用 React/Vite + Hono，并把项目创建、部署、验证、清理实现为 Provider Adapter 的幂等 Step。

## 5. 实测结果

### 5.1 已通过的真实云端验证

验证项目 `e2e-test-real`，全部验收标准均已取得真实 Evidence：

- Vercel 临时项目创建；
- 通过官方 Vercel API（`PATCH /v9/projects/{name}`）将项目的 `ssoProtection`、`passwordProtection` 设为 `null`，解除公网访问限制；
- Vercel API 部署就绪，`/api/health` 公网返回 `{ service: 'e2e-test-real', status: 'ok' }`；
- Cloudflare Pages 项目创建与部署成功，页面公网可访问；
- 前端构建内容已注入 Vercel API URL；
- 以 Pages origin 请求 Vercel API 时联合 smoke 成功，跨域通信正常；
- 真实部署产物保留用于后续 Provider Adapter 端到端验证。

### 5.2 已解决的关键问题

本轮验证曾遇到并解决以下问题：

1. **Vercel SSO Protection 阻塞公网访问**：项目默认启用 SSO Protection，导致 `*.vercel.app` 公网访问超时。通过 Vercel API `PATCH /v9/projects/{name}` 将 `ssoProtection` 设为 `null` 解决。此前的公网超时并非 DNS 或断网，而是 Deployment Protection 策略。

2. **`vercel.json` 运行时配置不正确**：原配置使用无效的 `runtime: nodejs22.x`，改为使用 `@vercel/node` builder 的标准 `builds` + `routes` 配置。

3. **API Handler 与 Vercel 不兼容**：原 Hono 应用在 Vercel Serverless 环境下无法直接导出。改为 Vercel 兼容的 `export default function handler(req: VercelRequest, res: VercelResponse)` 形式。

4. **Vercel 部署目录错误**：从 workspace 根目录部署会包含整个 monorepo。改为从 `apps/api/` 目录部署，确保只包含 API 产物。

5. **Cloudflare Pages 构建未接收 API URL**：前端构建时未注入 Vercel API URL。通过在 Cloudflare Pages 构建时注入环境变量解决。

### 5.3 关键实现产物

验证使用的 API Handler（Vercel 兼容）：

```typescript
import type { VercelRequest, VercelResponse } from '@vercel/node';

export default function handler(req: VercelRequest, res: VercelResponse) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  if (req.method === 'OPTIONS') { res.status(204).end(); return; }
  if (req.url?.includes('/api/health')) {
    res.status(200).json({ service: 'e2e-test-real', status: 'ok' });
    return;
  }
  res.status(404).json({ error: 'Not found' });
}
```

验证使用的 `vercel.json`：

```json
{
  "version": 2,
  "builds": [
    { "src": "src/index.ts", "use": "@vercel/node" }
  ],
  "routes": [
    { "src": "/api/(.*)", "dest": "/src/index.ts" }
  ]
}
```

### 5.4 历史诊断记录

本轮诊断曾验证 `vercel curl` 的自动链接行为不适合作为 Provider 协议：在未链接目录中会隐式创建项目。两个由诊断意外创建的 `agent-dev`、`api` 项目均已立即删除，正式 Probe 已移除这条路径。

## 6. 结论

Dual Preview 联合部署编排契约已通过真实云端验证：Vercel API 部署、Cloudflare Pages 部署、跨域通信和数据依赖注入均已取得真实 Evidence。该验证结果已用于 Provider Adapter 端到端验证（详见 [交接文档](../../handoff.md)）。

2026-08-09，本 Spike 验证的部署编排已实现为正式产品代码 `packages/deployment-composer`：

- `DeploymentComposer` 按 7 步幂等编排（Vercel Preview → 关闭 SSO/Password Protection → API 健康验证 → URL 注入 → 前端构建 → Cloudflare Pages Preview → 联合 Smoke → Evidence）；
- Vercel SSO/Password Protection 关闭步骤已纳入正式代码：`deployVercelPreview` 成功后通过 Vercel REST API `PATCH /v9/projects/{name}` 将 `ssoProtection` 和 `passwordProtection` 设为 `null`，确保 `*.vercel.app` URL 公网可访问；
- 精确 CORS origin（`https://<branch>.<project>-web-<branch>.pages.dev`）已替换 Spike 中的 `*`；
- `cleanupPreviewProjects()` 支持删除 Vercel/Cloudflare 临时项目，失败时返回未清理项目名供 Manual Action；
- Daemon 提供 `POST /api/projects/:projectId/preview/deploy`、`GET .../preview/plan`、`POST .../preview/cleanup` 三个路由；部署传入 `pullRequestNumber` 时使用规范分支 `pr-<number>`；
- `POST /api/github/webhooks` 会验证 `GITHUB_WEBHOOK_SECRET` 的 HMAC SHA-256 签名，并仅处理 `pull_request.closed`。它按仓库名匹配唯一本地项目，以 `pr-<number>` 推导临时项目名后调用清理；无效签名或无关事件不会执行删除；
- Studio 在 Quality Gate 通过后展示 Dual Preview 部署区块；
- 10 个单元测试全部通过（含 SSO Protection 关闭路径的 mock fetch + `VERCEL_TOKEN` 环境变量注入）。

2026-08-09 已安装并授权 Wrangler，并进行了三次真实 Vercel 诊断/双 Preview 尝试：Vercel 控制面部署为 `READY`，保护字段已置空，但当前网络访问新建 `*.vercel.app` Deployment Domain 超时或 `ECONNREFUSED`；Vercel 临时项目均已清理，Cloudflare 项目未创建。下一步需在可访问 Vercel Deployment Domain 的网络重新运行；Composer 与 Spike 的健康检查已将传播重试窗口扩大到约 2 分钟。

2026-08-11 重新运行正式 Composer：网络与 CLI 认证均可用，修复后的模板已通过隔离 workspace 的 `npm run quality`，Vercel API 项目创建成功并开始部署；随后因未配置 `VERCEL_TOKEN` 无法调用 REST API 关闭 Deployment Protection，临时 Vercel 项目已删除，Cloudflare 项目未创建。下一步是配置 `VERCEL_TOKEN` 后重跑。
