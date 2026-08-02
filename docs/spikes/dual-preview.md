# Dual Preview Spike 记录

> 日期：2026-08-02
> 状态：本地契约已通过；真实云端执行阻塞于 Vercel Preview 公网访问
> 实验代码：[`spikes/dual-preview`](../../spikes/dual-preview/)

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
2. `Access-Control-Allow-Origin` 严格等于 Pages branch origin，不是 `*`；
3. 前端构建内容包含该次 Vercel Preview URL；
4. Cloudflare Pages branch URL 可访问；
5. 以 Pages origin 请求 API 时联合 smoke 成功；
6. 两个临时云项目均被删除；
7. 未运行真实云端流程前，状态不能标记通过。

## 4. 与生产实现的差异

Spike 使用最小静态页面和 Vercel Function，只验证部署编排契约。Phase C/D 的正式模板仍使用 React/Vite + Hono，并把项目创建、部署、验证、清理实现为 Provider Adapter 的幂等 Step。

## 5. 实测结果

已通过：

- 本地 API health、精确 CORS 和前端 URL 注入点验证；
- Vercel 临时项目创建；
- 通过官方 `vercel api` 将临时项目的 `ssoProtection`、`passwordProtection` 设为 `null`；
- Vercel Preview 部署和 `inspect --wait` 就绪判断；
- 失败后 Vercel 项目自动删除。

当前阻塞：

```text
Vercel deployment ready
-> public https://*.vercel.app/api/health
-> repeated HTTP TimeoutError
-> Cloudflare Pages project not created
-> Vercel project deleted
```

对照检查确认 `vercel.com` 可访问、`*.vercel.app` 通配 DNS 可解析，因此不能把问题归类为普通断网或 DNS 失败。项目级保护关闭后现象不变，仍需核对 Vercel 团队级 Deployment Protection、Firewall 或 Preview 访问政策。

结论：Dual Preview 尚未通过，不能进入“联合 Preview 已实现”状态。当前建议采用实施计划中的降级并等待用户确认：使用稳定、公开的 dev API 作为 Cloudflare Preview 后端；涉及 PR API 变更的功能保留人工验证 Gate。团队策略允许公开临时 API 后，再重新运行本 Probe。

本轮诊断曾验证 `vercel curl` 的自动链接行为不适合作为 Provider 协议：在未链接目录中会隐式创建项目。两个由诊断意外创建的 `agent-dev`、`api` 项目均已立即删除，正式 Probe 已移除这条路径。
