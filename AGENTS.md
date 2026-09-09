# AGENTS.md — agent-dev

供 AI coding agents（Claude Code / Codex / Cursor / Copilot 等）在本仓库工作时自动读取。

## 项目概览
Agent-Dev：面向 AI 产品创作者的自主产品交付平台。不替代 Codex / Claude Code 等 coding agent，
而是在其上层管理产品规范、权限、交付状态、云平台连接、人工审批和验收证据。

v0.1 面向已使用 GitHub 和 Codex 的独立开发者，先提供一条固定的 Web SaaS Golden Path：

```text
React/Vite 前端 -> Cloudflare Pages
Hono API       -> Vercel Functions
Database/Auth  -> Supabase
Source/CI      -> GitHub / GitHub Actions
Agent Runtime  -> 用户电脑中的 Codex
```

## 技术栈
- npm workspaces 单体仓库（`apps/*`、`packages/*`）
- Node >= 22、npm >= 10.8.0（`packageManager: npm@10.8.2`）
- TypeScript 5.8、Vitest 3（根 `vitest.config.ts`）、wrangler 4

## 常用命令
```bash
npm install
npm run dev        # 并行启动 daemon + studio
npm run build      # typecheck + 各 workspace build
npm run typecheck
npm test           # vitest run
npm run doctor     # 运行环境自检
npm run install:macos / npm run update   # macOS 安装与升级脚本
```

## 约定
- 文档在 `docs/`：产品愿景与宪法、v0.1 PRD、对话决策记录、多产品类型交付方案等，
  动手前先读对应文档，避免与已确认的产品边界冲突。
- 仓库另有 `ai-agent-development-sop.md`、`portfolio-development-review.md`、`SECURITY.md`，
  涉及流程与安全时先查阅。
- 变更要按 workspace 划分，跨包改动同时更新类型与测试。

## 不要做的事
- 不要用 pnpm/yarn（仓库用 npm workspaces + `package-lock.json`）。
- 不要把用户电脑上的 Agent Runtime 职责搬到云端（v0.1 边界如此）。
- 不要提交 `.env`、密钥或任何凭证。
- 不要跳过 `git pull --rebase` 直接 push。
