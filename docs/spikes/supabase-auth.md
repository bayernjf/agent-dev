# Supabase Auth Spike 记录

> 日期：2026-08-02
> 状态：前置阻塞，未执行项目写操作

## 1. 目标

验证每个 PR Preview 能否安全、幂等地管理 Supabase Auth Redirect URL，并在 PR 关闭后清理；同时明确应用 API 的精确 CORS 与 Supabase Auth Redirect 是两个不同的配置面。

## 2. 当前证据

- Supabase CLI `2.111.0` 已作为 `platform-preflight` 的局部依赖安装；
- 该 CLI 即使执行 `--version` 也会尝试创建 `~/.supabase` 和 telemetry；
- 提升权限的预检曾创建该目录，确认只含 `traces/`、`telemetry.json` 后已立即完整删除；
- 修正后的 Preflight 不再启动 Supabase CLI，只报告 `requires-out-of-workspace-local-state`；
- 未读取 Supabase Token，未列出项目，未修改 Auth、Redirect、Database 或 Secret；
- 因此 Supabase Auth 动态 Redirect 与清理尚无真实平台 Evidence。

## 3. 不能接受的做法

- 为了自动化而读取用户 Home 中的 Supabase Token；
- 要求用户把 Access Token、Service Role Key 粘贴到聊天或仓库；
- 把 Service Role Key 传给 Coding Agent；
- 用 `site_url=*`、开放 Redirect 或 CORS `*` 代替精确配置；
- PR 关闭后保留无限增长的 Preview Redirect；
- 把“CLI 已安装”写成“Supabase 集成已通过”。

## 4. v0.1 候选路径

### A. Local Daemon OAuth / Management API（推荐）

用户在浏览器完成 Supabase 授权，Daemon 只保存系统 Keychain 中的授权引用，通过 Management API 执行 `discover/plan/apply/verify/cleanup`。这最符合 Agent-Dev 的 Provider 边界，但需要核对官方 OAuth scope 和 Redirect 配置 API。

### B. 用户明确允许 Supabase CLI 标准状态目录

Agent-Dev 调用官方 CLI，但用户必须明确允许 `~/.supabase`，并由 Secret Boundary 保证 CLI 凭据不进入 Agent Runtime。这能更快完成 Spike，但与当前“产物只在 agent-dev”要求冲突，不能默认采用。

### C. Manual Action + 稳定 dev Redirect

首版不做每 PR Auth Redirect。Agent-Dev 展示最小人工步骤，使用一个稳定 dev 页面域名；涉及 Auth 回调变化的 PR 必须人工验证。实现成本最低，但降低 Preview 隔离度。

## 5. 继续验证所需 Gate

1. 用户选择 A、B 或 C；
2. 若选择 A，先核对官方 Management API/OAuth 契约；
3. 若选择 B，明确授权 CLI 状态目录，但仍不得授权读取凭据内容；
4. 指定一个可丢弃的 Supabase 项目；
5. Apply 前展示 Redirect 添加和清理 Diff；
6. 成功添加、真实登录回调、PR cleanup 和二次 cleanup 幂等均取得 Evidence 后，才能标记通过。
