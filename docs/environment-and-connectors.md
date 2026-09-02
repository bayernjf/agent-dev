# 环境变量与平台连接方案

> 状态：v0.1 Design  
> 范围：GitHub、Supabase、Cloudflare Pages、Vercel，以及未来 GA4/Clarity。

## 1. 设计目标

Agent-Dev 统一管理环境变量的契约、来源、权限、目标和同步状态，但默认不把所有生产 Secret 明文集中存入自己的数据库。

```text
Env Contract = 变量名称 + 分类 + 来源 + 使用环境 + 目标平台 + 验证方式
Secret Store = 官方平台、系统 Keychain，未来可选 Infisical/Doppler
```

## 2. 变量分类

| 分类 | 含义 | 例子 |
| --- | --- | --- |
| `public` | 可进入浏览器和前端构建 | `VITE_API_BASE_URL` |
| `secret` | 只能进入服务端、CI 或受控 Runner | `SUPABASE_SERVICE_ROLE_KEY` |
| `managed` | 由 Provider 创建后自动发现 | Supabase Project URL |
| `derived` | 由其他输出确定性生成 | Preview API URL |
| `manual` | 平台无法自动创建，需要用户提供 | 首版 Clarity Project ID |

`VITE_*`、`NEXT_PUBLIC_*` 等客户端暴露命名必须触发 public 校验，Secret 不得使用此类前缀。

## 3. Env Contract 示例

```yaml
variables:
  - name: VITE_API_BASE_URL
    classification: public
    source:
      kind: provider-output
      provider: vercel
      output: deployment.url
    environments: [preview, dev, production]
    targets: [cloudflare-pages]
    validation:
      kind: url-health-check

  - name: SUPABASE_SERVICE_ROLE_KEY
    classification: secret
    source:
      kind: secret-reference
      provider: supabase
    environments: [preview, dev, production]
    targets: [vercel]
    exposeToAgent: false
    exposeToBrowser: false
```

每个变量还应记录 owner、用途、是否必填、最后同步版本、最后验证时间和轮换策略。

## 4. 环境矩阵

```text
                 local       PR preview       dev           production
Frontend         localhost   CF Pages PR       CF dev        CF production
API              localhost   Vercel Preview    Vercel dev    Vercel production
Database/Auth    Supabase dev 或 local         Supabase dev   Supabase production
Approval         none        Preview UAT       integration    production Gate
```

首版可以让 PR Preview 和 dev 共用非生产 Supabase，但必须标注数据隔离限制。为每个 PR 创建独立数据库不属于 v0.1。

## 5. 平台变量边界

### Cloudflare Pages

允许：

- `VITE_API_BASE_URL`；
- `VITE_SUPABASE_URL`；
- Supabase publishable/anon key；
- 经过隐私批准的 GA4/Clarity ID。

禁止：

- Supabase Service Role；
- Provider API Token；
- 数据库密码；
- 可执行生产管理操作的凭据。

### Vercel API

允许保存服务端 Secret，包括 Supabase Service Role。Preview、dev 和 production 使用独立目标配置；`ALLOWED_ORIGINS` 由 Deployment Composer 根据 Pages 部署事实生成。

### GitHub Actions

只保存部署身份和必要资源 ID。首版至少需要 Cloudflare、Vercel 的受限部署凭据；preview 与 production 应通过不同 GitHub Environments 隔离。

## 6. Secret 存储策略

### v0.1

优先顺序：

1. 复用 Provider 官方 CLI/OAuth 登录态；
2. Secret 直接保存在目标平台；
3. 本地额外凭据进入系统 Keychain；
4. SQLite 只保存 Secret Reference、版本和哈希摘要。

禁止：

- 把明文写入 Blueprint、Markdown 或 SQLite；
- 在日志和错误消息中回显；
- 把生产 Secret 发送给 Coding Agent；
- 在 Cloudflare Pages 前端构建变量中保存服务端 Secret；
- 自动把 `.env` 提交到 Git。

### 后续版本

**Infisical Secret Backend Adapter 已实现（2026-09-01，凭证系统后端化集成）**：`AGENT_DEV_SECRET_BACKEND=infisical` 时凭证读写切换到 Infisical（默认 `local-file` 行为不变），详见 [凭证管理方案 §3.5](credential-management.md)。支持轮换；版本/审批/历史等后端未确认的字段如实省略而非伪造，审批走 Infisical 控制台。**真实 Infisical 云端验证待办**——`spikes/infisical-backend/probe.mjs --online` 是既定验证入口。Doppler 仍是后续选项，接口已留位。Agent-Dev 仍负责 Env Contract、Policy 和验证，不自己重造 Vault。

## 7. Connector 状态

```text
DISCONNECTED
-> NEEDS_USER_ACTION
-> AUTHORIZED
-> DISCOVERING
-> PLAN_READY
-> APPLYING
-> VERIFIED
-> DRIFTED | ERROR
```

连接成功不等于配置完成。只有权限满足、资源存在、变量同步且验证器通过，状态才可以是 `VERIFIED`。

## 8. 最小人工操作

| 平台 | 用户必须完成 | 系统自动完成 |
| --- | --- | --- |
| GitHub | 安装/授权 App 或确认 CLI 登录范围 | 仓库、PR、Checks、Ruleset 计划与状态读取 |
| Supabase | 授权账号，选择组织、区域和可能的费用 | 项目、Schema、Auth 配置和输出发现 |
| Vercel | 授权账号并选择 Team | API 项目、Preview、Env 同步和健康检查 |
| Cloudflare | 授权账号并选择 Account | Pages 项目、Preview、页面部署和 URL 验证 |
| DNS | 确认域名所有权和 DNS 修改 | 生成记录、应用受权变更、验证传播 |
| GA4 | Google 授权、账号选择和隐私确认 | 后续版本创建/选择 Property 并验证事件 |
| Clarity | 若无稳定管理接口则创建项目并提供 ID | 注入 ID、部署并验证脚本加载 |

Manual Action 必须包含：原因、外部深链、最多 3–5 个步骤、需要提交的最小信息、完成后的自动验证和过期时间。系统应主动轮询验证，而不是仅依赖用户点击“已完成”。

## 9. 权限原则

- GitHub：首版只申请仓库内容、PR、Checks、Deployments 和必要设置权限；
- Cloudflare：Pages 写权限与 DNS 权限分离，未使用自定义域名时不申请 DNS；
- Vercel：限制到选定 Team/Project 和 Deployment/Env 能力；
- Supabase：区分项目管理与运行时数据库权限；
- 分析工具：接入前必须确认数据收集和隐私说明；
- 权限扩大必须生成新 Plan 并人工批准。

## 10. 联合 Preview 同步

```text
Vercel API Preview URL
  -> Env Contract 生成 VITE_API_BASE_URL
  -> Cloudflare Pages 构建
  -> Pages Preview URL
  -> Vercel ALLOWED_ORIGINS
  -> Supabase Auth Redirect URLs
  -> Browser/API Smoke Test
```

同步步骤必须可重复执行并具备清理策略。PR 关闭后，应撤销临时 CORS/Redirect 规则并按平台能力删除或过期 Preview 资源。

## 11. Drift Detection

Agent-Dev 定期或在交付前比较：

- Blueprint 期望值；
- Provider 当前配置；
- GitHub workflow 和仓库内生成物；
- Secret Reference 版本；
- 实际域名、CORS 和 Redirect URL。

发现漂移时先展示 Diff，不应自动覆盖生产中的人工修改。用户可以选择接受外部状态、恢复 Blueprint 状态或创建自定义覆盖，并形成新的 Revision。
