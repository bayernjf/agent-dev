# Phase 0 技术 Spike 状态

> 更新时间：2026-08-02
> 原则：未取得真实平台 Evidence 的项目不能标记通过。

| Spike | 当前状态 | 已取得证据 | 下一动作 |
| --- | --- | --- | --- |
| [Codex Runtime](codex-runtime.md) | 部分通过/认证阻塞 | CLI 非交互、JSONL、Schema、sandbox、resume 入口已确认；真实请求进入事件流后认证失败 | 用户恢复 Codex 认证，再跑只读、写入、resume、cancel |
| [Workflow Resume](workflow-resume.md) | 已通过 | XState 5.32.5 快照跨四个独立进程恢复，SQLite 历史连续 | Phase A 改用 Drizzle/正式驱动并补 lease、幂等和 crash 测试 |
| [Secret Boundary](secret-boundary.md) | 已通过（macOS） | 临时 Keychain、引用存储、Provider 单次注入、Agent allowlist、日志脱敏均实测 | 提取共享库，补 Windows/Linux Adapter |
| Dual Preview | 前置阻塞 | Vercel CLI 已安装且认证可用 | 安装/认证 Wrangler，指定可丢弃的 Vercel 与 Pages Spike 项目 |
| Supabase Auth | 前置阻塞 | 尚无真实平台 Evidence | 安装/认证 Supabase CLI，指定可丢弃项目并批准 Redirect/CORS 清理实验 |

## 当前本机前置状态

```text
Codex CLI      installed, authentication invalid for real execution
GitHub CLI     installed, authenticated
Vercel CLI     installed, authenticated
Wrangler       not installed
Supabase CLI   not installed
```

可重复检查：

```bash
node spikes/platform-preflight/probe.mjs
node spikes/platform-preflight/probe.mjs --online
```

在线检查不输出用户名、组织、项目列表或 Token。真实部署实验属于外部写操作，必须先展示 Plan，并由用户批准专用测试资源。

## 进入 Phase A 的 Gate

首版有两种可接受路径：

1. 五个 Spike 全部取得真实成功证据；
2. 对阻塞 Spike 采用实施计划中已经定义的明确降级，并把限制写入 v0.1 验收范围。

不得以“脚本已写”替代真实云端验证，也不得为了完成 Spike 要求用户把 Secret 粘贴到聊天或仓库。
