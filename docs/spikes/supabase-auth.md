# Supabase Auth Spike 记录

> 日期：2026-08-02
> 状态：已确认采用 Manual 降级路径（路径 C），项目写操作由用户手动完成
> 最近更新：2026-08-08

## 1. 目标

验证每个 PR Preview 能否安全、幂等地管理 Supabase Auth Redirect URL，并在 PR 关闭后清理；同时明确应用 API 的精确 CORS 与 Supabase Auth Redirect 是两个不同的配置面。

## 2. 当前证据

- Supabase CLI `2.111.0` 已作为 `platform-preflight` 的局部依赖安装；
- 该 CLI 即使执行 `--version` 也会尝试创建 `~/.supabase` 和 telemetry；
- 提升权限的预检曾创建该目录，确认只含 `traces/`、`telemetry.json` 后已立即完整删除；
- 修正后的 Preflight 不再启动 Supabase CLI，只报告 `requires-out-of-workspace-local-state`；
- 未读取 Supabase Token，未列出项目，未修改 Auth、Redirect、Database 或 Secret；
- Supabase Auth 动态 Redirect 与清理尚无真实平台 Evidence，当前由 Manual 降级路径覆盖。

## 3. 不能接受的做法

- 为了自动化而读取用户 Home 中的 Supabase Token；
- 要求用户把 Access Token、Service Role Key 粘贴到聊天或仓库；
- 把 Service Role Key 传给 Coding Agent；
- 用 `site_url=*`、开放 Redirect 或 CORS `*` 代替精确配置；
- PR 关闭后保留无限增长的 Preview Redirect；
- 把“CLI 已安装”写成“Supabase 集成已通过”。

## 4. 已确认的降级路径

### 路径 C：Manual Action + 稳定 dev Redirect（已确认采用）

经评估，Supabase CLI 写入项目边界外的状态（`~/.supabase`），缺乏幂等验证能力，且涉及数据库和 Auth 配置的数据安全风险。当前确认采用路径 C 作为 v0.1 的过渡方案：

**Agent-Dev 的职责：**

- 首版不做每 PR Auth Redirect 自动管理；
- Agent-Dev 展示最小人工步骤，指导用户手动创建 Supabase 项目并配置 Auth；
- 使用一个稳定 dev 页面域名作为 Redirect URL；
- 涉及 Auth 回调变化的 PR 必须人工验证；
- Supabase Provider 在 RealProviderRegistry 中自动降级为 ManualProviderAdapter。

**用户的手动步骤：**

1. 在 Supabase Dashboard 创建项目；
2. 配置 Auth Provider（Email/Password 等）；
3. 设置 Redirect URL 为稳定 dev 页面域名；
4. 将项目 URL 和 anon key 通过凭证管理面板录入；
5. Agent-Dev 生成 `.env` 时自动注入这些凭证。

**降级原因（详见 [项目记忆](../../handoff.md)）：**

- Supabase CLI 写入状态在项目边界之外（`~/.supabase`）；
- 缺乏幂等验证能力，重复执行可能产生副作用；
- 涉及数据库和 Auth 配置，数据安全风险需要人工确认。

### 未采用的候选路径

#### A. Local Daemon OAuth / Management API

用户在浏览器完成 Supabase 授权，Daemon 只保存系统 Keychain 中的授权引用，通过 Management API 执行 `discover/plan/apply/verify/cleanup`。这最符合 Agent-Dev 的 Provider 边界，但需要核对官方 OAuth scope 和 Redirect 配置 API。作为后续优化的目标路径保留。

#### B. 用户明确允许 Supabase CLI 标准状态目录

Agent-Dev 调用官方 CLI，但用户必须明确允许 `~/.supabase`，并由 Secret Boundary 保证 CLI 凭据不进入 Agent Runtime。与当前"产物只在 agent-dev"要求冲突，不采用。

## 5. 更优的分阶段方案（后续目标）

当前 Manual 降级是务实的过渡方案，但并非最优。后续建议实现分阶段方案：

1. **自动基础设施设置**：通过 Supabase Management API 和 CLI 完成项目创建和 schema 迁移；
2. **人工审批敏感配置**：RLS 策略、Auth Provider、Secrets 等敏感配置保留人工确认 Gate。

该方案兼顾自动化效率和数据安全，作为 v0.2+ 的目标。

## 6. 结论

Supabase Auth 在 v0.1 采用 Manual 降级路径，由用户手动完成项目创建和凭证管理，Agent-Dev 负责展示最小人工步骤和凭证注入。该降级已写入 v0.1 验收范围，RealProviderRegistry 已实现自动降级为 ManualProviderAdapter。

后续优化目标是实现 Management API 自动基础设施 + 人工敏感配置审批的分阶段方案。
