# 凭证与环境变量管理方案

> 创建时间：2026-08-08
> 状态：Phase 1 本地文件/API 已实现；Phase 2 Studio 凭证面板已实现（当前面板增强形式：引导模式 + 验证 + Supabase 手动配置 + 自定义 Key）；真实 Supabase 自动 Adapter 按用户决策不做，保持 Manual 引导
> 前置依赖：Real Provider Adapter 已验证通过（GitHub、Vercel、Cloudflare 真实接入，Supabase Manual 降级）

## 1. 问题背景

### 1.1 用户痛点

当前方案存在三个核心问题：

1. **小白无法使用**：用户需要安装 4 个 CLI 工具（gh、vercel、wrangler、supabase）、完成 4 次认证、理解 owner/team/account 等概念。连 GitHub 都不知道的小白在第一步就卡死。

2. **项目资源 ID 散落丢失**：平台帮用户创建的 Cloudflare Account ID、Vercel Org ID/Project ID、Supabase URL/Key 等资源标识，当前没有统一存储。用户需要自己记忆和手动配置，换项目就丢失。

3. **凭证散落各处**：用户前几个项目中积累的各种 Token、API Key、环境变量散落在不同地方，没有统一管理入口。

### 1.2 设计目标

- 小白用户通过"填表单 + 看教程"完成凭证配置，无需安装 CLI 或理解技术概念
- 平台创建的所有项目资源 ID 自动记录，用户无需手动记忆
- 所有凭证只存在用户本地，绝不上传服务器
- 应用代码能直接使用凭证和资源信息，无需手动配置 .env

### 1.3 设计原则

- **本地优先**：凭证文件只存在用户本地，平台不持有
- **固定路径**：文件路径写死在代码里，不存数据库，用户无需指定
- **零服务端明文**：数据库只存"是否已连接"的布尔状态，不存凭证值
- **自动派生**：.env 文件从凭证文件和资源清单自动生成，无需手动维护
- **文件权限保护**：凭证文件权限 600，自动加入 .gitignore

## 2. 三层文件架构

### 2.1 文件分层

```
<agent-dev>/.agent-dev/
  credentials.txt              ← Layer 1：全局凭证（用户手填，跨项目通用）
  credentials.meta.json        ← Layer 1 元数据（哪些已连接，不含凭证值）

<workspace>/.agent-dev/
  project-resources.json       ← Layer 2：项目资源清单（平台创建，项目级）

<workspace>/.env               ← Layer 3：应用环境变量（自动生成，项目级）
<workspace>/.env.example       ← Layer 3：环境变量模板（提交到 Git，供参考）
```

### 2.2 各层职责

| 文件 | 谁写 | 存什么 | 作用域 | 上传服务端 |
|------|------|--------|--------|-----------|
| `~/.agent-dev/credentials.txt` | 用户填 | Token、API Key | 全局（跨项目） | 否 |
| `~/.agent-dev/credentials.meta.json` | 平台写 | 连接状态、更新时间 | 全局 | 是（只存布尔状态） |
| `<workspace>/.agent-dev/project-resources.json` | 平台写 | Project ID、URL、Org ID | 项目级 | 否 |
| `<workspace>/.env` | 平台自动生成 | 合并后的环境变量 | 项目级 | 否 |
| `<workspace>/.env.example` | 平台生成 | 变量名模板（无值） | 项目级 | 是（提交到 Git） |

### 2.3 数据流

```
用户在 UI 填写凭证（一次）
    ↓
daemon 接收（只在内存中，不写数据库）
    ↓
写入 ~/.agent-dev/credentials.txt
    ↓
daemon 丢弃内存中的明文
    ↓
数据库只存元数据（不含凭证值）：
  { github: { connected: true, updatedAt: "..." } }
    ↓
创建项目 → Apply → Provider 创建资源
    ↓
Provider 返回创建结果（project ID、URL、key 等）
    ↓
写入 <workspace>/.agent-dev/project-resources.json
    ↓
从 credentials.txt + project-resources.json 合并生成 .env
    ↓
Agent 运行时读取文件 → 注入环境变量 → CLI 使用
```

## 3. Layer 1：全局凭证文件

### 3.1 文件格式

路径：`<agent-dev>/.agent-dev/credentials.txt`（可通过 `AGENT_DEV_CREDENTIALS_PATH` 环境变量自定义；桌面安装版可迁移到用户级目录）

```ini
# Agent-Dev Credentials
# 生成时间：2026-08-08 02:30:00
# 警告：此文件包含敏感信息，请勿提交到 Git 或分享给他人
# 此文件由 Agent-Dev 自动生成和管理，手动修改可能导致不一致

# ===== Provider Tokens（部署用）=====

GITHUB_TOKEN=<your-github-token>
VERCEL_TOKEN=vercel_xxxxxxxxxxxxxxxxxxxxxxxxxxxx
CLOUDFLARE_API_TOKEN=cf_xxxxxxxxxxxxxxxxxxxxxxxxxxxx

# ===== Supabase（项目级，首次创建后回填）=====

SUPABASE_ACCESS_TOKEN=<your-supabase-token>

# ===== 第三方 API Keys（应用用）=====

OPENAI_API_KEY=<your-openai-key>
STRIPE_SECRET_KEY=<your-stripe-secret-key>
RESEND_API_KEY=<your-resend-key>
ANTHROPIC_API_KEY=<your-anthropic-key>

# ===== 自定义环境变量 =====

MY_CUSTOM_API_KEY=xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx
```

### 3.2 元数据文件

路径：`~/.agent-dev/credentials.meta.json`

```json
{
  "version": 1,
  "updatedAt": "2026-08-08T02:30:00Z",
  "providers": {
    "github": {
      "connected": true,
      "fields": ["GITHUB_TOKEN"],
      "lastVerifiedAt": "2026-08-08T02:30:00Z"
    },
    "vercel": {
      "connected": true,
      "fields": ["VERCEL_TOKEN"],
      "lastVerifiedAt": "2026-08-08T02:30:00Z"
    },
    "cloudflare": {
      "connected": true,
      "fields": ["CLOUDFLARE_API_TOKEN"],
      "lastVerifiedAt": "2026-08-08T02:30:00Z"
    },
    "supabase": {
      "connected": false,
      "fields": ["SUPABASE_ACCESS_TOKEN"],
      "lastVerifiedAt": null
    }
  },
  "customKeys": [
    { "key": "OPENAI_API_KEY", "label": "OpenAI API Key", "connected": true },
    { "key": "STRIPE_SECRET_KEY", "label": "Stripe Secret Key", "connected": true },
    { "key": "RESEND_API_KEY", "label": "Resend API Key", "connected": true }
  ]
}
```

### 3.3 安全措施

- 文件权限：`chmod 600 ~/.agent-dev/credentials.txt`（仅文件所有者可读写）
- 自动追加到 `.gitignore`：`.agent-dev/credentials.txt`
- 目录权限：`chmod 700 ~/.agent-dev/`
- daemon 接收凭证后立即写入文件，不在内存中保留明文超过写入周期
- 数据库永远不存储凭证值，只存布尔连接状态

### 3.4 自定义路径支持

```bash
# 默认（新手模式）
~/.agent-dev/credentials.txt

# 自定义（专业模式）
AGENT_DEV_CREDENTIALS_PATH=/my/custom/path/creds.txt
```

代码实现：

```typescript
const CREDENTIALS_PATH = process.env.AGENT_DEV_CREDENTIALS_PATH
  ?? join(process.env.HOME || process.env.USERPROFILE || '', '.agent-dev', 'credentials.txt');
```

## 4. Layer 2：项目资源清单

### 4.1 文件格式

路径：`<workspace>/.agent-dev/project-resources.json`

```json
{
  "version": 1,
  "projectName": "my-todo-app",
  "projectId": "1963c2f6-b77c-443f-950a-8600aa183730",
  "blueprintRevision": 2,
  "updatedAt": "2026-08-08T03:00:00Z",
  "providers": {
    "github": {
      "repository": "bayernjf/my-todo-app",
      "url": "https://github.com/bayernjf/my-todo-app",
      "owner": "bayernjf",
      "defaultBranch": "main",
      "integrationBranch": "dev",
      "requirePullRequest": true,
      "createdAt": "2026-08-08T03:00:00Z"
    },
    "vercel": {
      "projectId": "prj_abc123def456",
      "projectName": "my-todo-app",
      "orgId": "team_xxxxxxxxxxxx",
      "productionUrl": "https://my-todo-app-bayernjfs-projects.vercel.app",
      "previewUrl": "https://my-todo-app-git-dev-bayernjfs-projects.vercel.app",
      "createdAt": "2026-08-08T03:01:00Z"
    },
    "cloudflare": {
      "accountId": "23afa7f0233653f87dc9ceafd02eb79a",
      "accountName": "Jiangfengkxi@outlook.com's Account",
      "projectName": "my-todo-app",
      "pagesUrl": "https://my-todo-app.pages.dev",
      "deploymentId": "dep_abc123",
      "productionBranch": "main",
      "createdAt": "2026-08-08T03:02:00Z"
    },
    "supabase": {
      "projectRef": "abcdefghijkl",
      "projectName": "my-todo-app",
      "url": "https://abcdefghijkl.supabase.co",
      "anonKey": "<jwt-anon-key-placeholder>",
      "serviceRoleKey": "<jwt-service-role-placeholder>",
      "databaseUrl": "postgresql://postgres:password@db.abcdefghijkl.supabase.co:5432/postgres",
      "studioUrl": "https://supabase.com/dashboard/project/abcdefghijkl",
      "region": "ap-southeast-1",
      "createdAt": "2026-08-08T03:03:00Z"
    }
  }
}
```

### 4.2 写入时机

Provider Apply 成功后，立即将资源级事实写入此文件：资源 ID、URL 和非敏感元数据会被保留；无法由 CLI 确认的字段不得伪装为已验证事实。

```typescript
// Provider apply 返回值
const result = await adapter.apply(plan, approval);
// result.state 包含创建的资源信息
await writeProjectResources(workspacePath, providerId, result.state);
```

### 4.3 更新策略

- **幂等写入**：每次 Apply 都覆盖对应 provider 的字段，不影响其他 provider
- **保留历史**：旧值存入 `history` 数组（可选，用于审计）
- **与 Blueprint 关联**：记录 `blueprintRevision`，Blueprint 变更时可判断是否需要重新 Apply

### 4.4 安全措施

- 文件权限：`chmod 600 <workspace>/.agent-dev/project-resources.json`
- 自动加入 `.gitignore`：`.agent-dev/project-resources.json`
- 包含 `serviceRoleKey` 等高权限凭证，必须本地存储

## 5. Layer 3：应用环境变量

### 5.1 自动生成 .env

路径：`<workspace>/.env`

从 Layer 1（credentials.txt）和 Layer 2（project-resources.json）合并派生：

```ini
# .env（由 Agent-Dev 自动生成，请勿手动修改）
# 生成时间：2026-08-08 03:05:00

# ===== Provider Resource IDs（来自 project-resources.json）=====

# GitHub
GIT_REPOSITORY_URL=https://github.com/bayernjf/my-todo-app
GIT_OWNER=bayernjf
GIT_REPOSITORY=my-todo-app

# Vercel
VERCEL_PROJECT_ID=prj_abc123def456
VERCEL_ORG_ID=team_xxxxxxxxxxxx
VERCEL_PROJECT_NAME=my-todo-app
VERCEL_URL=https://my-todo-app-bayernjfs-projects.vercel.app
VERCEL_PREVIEW_URL=https://my-todo-app-git-dev-bayernjfs-projects.vercel.app

# Cloudflare
CLOUDFLARE_ACCOUNT_ID=23afa7f0233653f87dc9ceafd02eb79a
CLOUDFLARE_PROJECT_NAME=my-todo-app
CLOUDFLARE_PAGES_URL=https://my-todo-app.pages.dev

# Supabase
SUPABASE_URL=https://abcdefghijkl.supabase.co
SUPABASE_ANON_KEY=<jwt-anon-key-placeholder>
SUPABASE_PROJECT_REF=abcdefghijkl
DATABASE_URL=postgresql://postgres:password@db.abcdefghijkl.supabase.co:5432/postgres

# ===== Third-party API Keys（来自 credentials.txt）=====

OPENAI_API_KEY=<your-openai-key>
STRIPE_SECRET_KEY=<your-stripe-secret-key>
RESEND_API_KEY=<your-resend-key>

# ===== App Config =====

APP_NAME=my-todo-app
NODE_ENV=development
```

### 5.2 .env.example 模板

路径：`<workspace>/.env.example`（提交到 Git，供其他开发者参考）

```ini
# .env.example
# 复制此文件为 .env 并填入实际值
# 或使用 Agent-Dev 自动生成 .env

# GitHub
GIT_REPOSITORY_URL=
GIT_OWNER=
GIT_REPOSITORY=

# Vercel
VERCEL_PROJECT_ID=
VERCEL_ORG_ID=
VERCEL_PROJECT_NAME=
VERCEL_URL=
VERCEL_PREVIEW_URL=

# Cloudflare
CLOUDFLARE_ACCOUNT_ID=
CLOUDFLARE_PROJECT_NAME=
CLOUDFLARE_PAGES_URL=

# Supabase
SUPABASE_URL=
SUPABASE_ANON_KEY=
SUPABASE_PROJECT_REF=
DATABASE_URL=

# Third-party API Keys
OPENAI_API_KEY=
STRIPE_SECRET_KEY=
RESEND_API_KEY=

# App Config
APP_NAME=
NODE_ENV=development
```

### 5.3 生成时机

- Provider Apply 成功后自动生成
- 用户修改 credentials.txt 后可手动触发重新生成
- 项目创建时生成初始版本（只有 APP_NAME 和 NODE_ENV）

## 6. ProviderAdapter 改造

### 6.1 凭证读取模块

新增文件：`packages/provider-cli/src/credentials.ts`

```typescript
import { readFileSync, writeFileSync, existsSync, mkdirSync, chmodSync } from 'node:fs';
import { join, dirname } from 'node:path';

export type Credentials = Record<string, string>;

export const CREDENTIALS_PATH = process.env.AGENT_DEV_CREDENTIALS_PATH
  ?? join(process.env.HOME || process.env.USERPROFILE || '', '.agent-dev', 'credentials.txt');

export function loadCredentials(): Credentials {
  if (!existsSync(CREDENTIALS_PATH)) return {};
  const content = readFileSync(CREDENTIALS_PATH, 'utf-8');
  const creds: Credentials = {};
  for (const line of content.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const eqIndex = trimmed.indexOf('=');
    if (eqIndex === -1) continue;
    const key = trimmed.slice(0, eqIndex).trim();
    const value = trimmed.slice(eqIndex + 1).trim();
    if (value) creds[key] = value;
  }
  return creds;
}

export function saveCredentials(creds: Credentials): void {
  const dir = dirname(CREDENTIALS_PATH);
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  const lines = [
    '# Agent-Dev Credentials',
    `# 生成时间：${new Date().toISOString()}`,
    '# 警告：此文件包含敏感信息，请勿提交到 Git 或分享给他人',
    '# 此文件由 Agent-Dev 自动生成和管理，手动修改可能导致不一致',
    '',
  ];
  const grouped: Record<string, string[]> = {};
  for (const [key, value] of Object.entries(creds)) {
    const group = getGroup(key);
    if (!grouped[group]) grouped[group] = [];
    grouped[group].push(`${key}=${value}`);
  }
  for (const [group, entries] of Object.entries(grouped)) {
    lines.push(`# ===== ${group} =====`, ...entries, '');
  }
  writeFileSync(CREDENTIALS_PATH, lines.join('\n'), { mode: 0o600 });
  chmodSync(CREDENTIALS_PATH, 0o600);
}

export function injectCredentials(creds: Credentials): NodeJS.ProcessEnv {
  return { ...process.env, ...creds };
}

function getGroup(key: string): string {
  if (key.startsWith('GITHUB')) return 'Provider Tokens';
  if (key.startsWith('VERCEL')) return 'Provider Tokens';
  if (key.startsWith('CLOUDFLARE')) return 'Provider Tokens';
  if (key.startsWith('SUPABASE')) return 'Provider Tokens';
  if (['OPENAI_API_KEY', 'ANTHROPIC_API_KEY'].includes(key)) return 'AI API Keys';
  if (key.includes('STRIPE')) return 'Payment API Keys';
  return 'Custom API Keys';
}
```

### 6.2 项目资源清单模块

新增文件：`packages/provider-cli/src/project-resources.ts`

```typescript
import { readFileSync, writeFileSync, existsSync, mkdirSync, chmodSync } from 'node:fs';
import { join } from 'node:path';

export type ProjectResources = {
  version: number;
  projectName: string;
  projectId: string;
  blueprintRevision: number;
  updatedAt: string;
  providers: Record<string, Record<string, unknown>>;
};

export function loadProjectResources(workspacePath: string): ProjectResources | null {
  const filePath = join(workspacePath, '.agent-dev', 'project-resources.json');
  if (!existsSync(filePath)) return null;
  try {
    return JSON.parse(readFileSync(filePath, 'utf-8')) as ProjectResources;
  } catch {
    return null;
  }
}

export function writeProjectResources(
  workspacePath: string,
  projectName: string,
  projectId: string,
  blueprintRevision: number,
  providerId: string,
  state: Record<string, unknown>,
): void {
  const filePath = join(workspacePath, '.agent-dev', 'project-resources.json');
  const dir = join(workspacePath, '.agent-dev');
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });

  const existing = loadProjectResources(workspacePath);
  const resources: ProjectResources = existing ?? {
    version: 1,
    projectName,
    projectId,
    blueprintRevision,
    updatedAt: new Date().toISOString(),
    providers: {},
  };

  resources.providers[providerId] = {
    ...state,
    updatedAt: new Date().toISOString(),
  };
  resources.updatedAt = new Date().toISOString();

  writeFileSync(filePath, JSON.stringify(resources, null, 2) + '\n', { mode: 0o600 });
  chmodSync(filePath, 0o600);
}
```

### 6.3 .env 生成模块

新增文件：`packages/provider-cli/src/env-generator.ts`

```typescript
import { writeFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import type { Credentials } from './credentials.js';
import type { ProjectResources } from './project-resources.js';

export function generateEnvFile(
  workspacePath: string,
  creds: Credentials,
  resources: ProjectResources | null,
  appName: string,
): void {
  const lines: string[] = [
    '# .env（由 Agent-Dev 自动生成，请勿手动修改）',
    `# 生成时间：${new Date().toISOString()}`,
    '',
  ];

  if (resources) {
    lines.push('# ===== Provider Resource IDs =====', '');

    const github = resources.providers.github;
    if (github) {
      lines.push('# GitHub');
      lines.push(`GIT_REPOSITORY_URL=${github.url ?? ''}`);
      lines.push(`GIT_OWNER=${github.owner ?? ''}`);
      lines.push(`GIT_REPOSITORY=${github.repository ?? ''}`);
      lines.push('');
    }

    const vercel = resources.providers.vercel;
    if (vercel) {
      lines.push('# Vercel');
      lines.push(`VERCEL_PROJECT_ID=${vercel.projectId ?? ''}`);
      lines.push(`VERCEL_ORG_ID=${vercel.orgId ?? ''}`);
      lines.push(`VERCEL_PROJECT_NAME=${vercel.projectName ?? ''}`);
      lines.push(`VERCEL_URL=${vercel.productionUrl ?? ''}`);
      lines.push(`VERCEL_PREVIEW_URL=${vercel.previewUrl ?? ''}`);
      lines.push('');
    }

    const cloudflare = resources.providers.cloudflare;
    if (cloudflare) {
      lines.push('# Cloudflare');
      lines.push(`CLOUDFLARE_ACCOUNT_ID=${cloudflare.accountId ?? ''}`);
      lines.push(`CLOUDFLARE_PROJECT_NAME=${cloudflare.projectName ?? ''}`);
      lines.push(`CLOUDFLARE_PAGES_URL=${cloudflare.pagesUrl ?? ''}`);
      lines.push('');
    }

    const supabase = resources.providers.supabase;
    if (supabase) {
      lines.push('# Supabase');
      lines.push(`SUPABASE_URL=${supabase.url ?? ''}`);
      lines.push(`SUPABASE_ANON_KEY=${supabase.anonKey ?? ''}`);
      lines.push(`SUPABASE_PROJECT_REF=${supabase.projectRef ?? ''}`);
      lines.push(`DATABASE_URL=${supabase.databaseUrl ?? ''}`);
      lines.push('');
    }
  }

  const thirdPartyKeys = Object.entries(creds).filter(
    ([key]) => !key.startsWith('GITHUB_TOKEN')
      && !key.startsWith('VERCEL_TOKEN')
      && !key.startsWith('CLOUDFLARE_API_TOKEN')
      && !key.startsWith('SUPABASE_ACCESS_TOKEN'),
  );
  if (thirdPartyKeys.length > 0) {
    lines.push('# ===== Third-party API Keys =====', '');
    for (const [key, value] of thirdPartyKeys) {
      lines.push(`${key}=${value}`);
    }
    lines.push('');
  }

  lines.push('# ===== App Config =====', '');
  lines.push(`APP_NAME=${appName}`);
  lines.push('NODE_ENV=development');

  writeFileSync(join(workspacePath, '.env'), lines.join('\n') + '\n');
}
```

### 6.4 Registry 改造

`packages/provider-cli/src/registry.ts` 的 `checkCliAvailable` 改为优先查凭证：

```typescript
import { loadCredentials } from './credentials.js';

private async checkProviderAvailable(providerId: string): Promise<boolean> {
  const creds = loadCredentials();
  switch (providerId) {
    case 'github':
      return Boolean(creds.GITHUB_TOKEN);
    case 'vercel':
      return Boolean(creds.VERCEL_TOKEN);
    case 'cloudflare':
      return Boolean(creds.CLOUDFLARE_API_TOKEN);
    case 'supabase':
      return Boolean(creds.SUPABASE_ACCESS_TOKEN);
    default:
      return false;
  }
}
```

### 6.5 Adapter CLI 调用改造

每个 adapter 在调用 CLI 时注入对应的环境变量：

```typescript
// GitHub: gh CLI 支持 GITHUB_TOKEN 环境变量
const result = await this.runner('gh', ['repo', 'create', ...], {
  cwd: this.workspacePath,
  env: { ...process.env, GITHUB_TOKEN: creds.GITHUB_TOKEN },
});

// Vercel: vercel CLI 支持 VERCEL_TOKEN 环境变量
const result = await this.runner('vercel', ['deploy', '--prod', '--yes', '--no-wait'], {
  cwd: this.workspacePath,
  env: { ...process.env, VERCEL_TOKEN: creds.VERCEL_TOKEN, CI: 'true' },
});

// Cloudflare: wrangler 已支持 CLOUDFLARE_API_TOKEN 环境变量（无需改造）
// Supabase: supabase CLI 支持 SUPABASE_ACCESS_TOKEN 环境变量
```

### 6.6 Apply 后写入资源清单

```typescript
// registry.ts apply 方法改造
async apply(projectId: string, plans: ProviderPlan[], approval: { ... }): Promise<ProviderApplyResult[]> {
  const ctx = await this.resolveContext(projectId);
  if (!ctx) throw new Error('No workspace context.');

  const settled = await Promise.allSettled(
    plans.map(async plan => {
      const adapter = await this.createAdapter(plan.providerId, spec, ctx);
      const result = await adapter.apply(plan, approval);

      // 新增：写入项目资源清单
      writeProjectResources(
        ctx.workspacePath,
        ctx.projectName,
        projectId,
        plan.blueprintRevision,
        plan.providerId,
        result.state,
      );

      return result;
    }),
  );

  // 新增：生成 .env
  const creds = loadCredentials();
  const resources = loadProjectResources(ctx.workspacePath);
  generateEnvFile(ctx.workspacePath, creds, resources, ctx.projectName);

  // ... 返回结果
}
```

## 7. Daemon API

### 7.1 凭证管理路由

```typescript
// GET /api/credentials
// 返回凭证元数据（不含凭证值）
app.get('/api/credentials', context => {
  const meta = loadCredentialsMeta();
  return context.json({ meta });
});

// POST /api/credentials
// 接收凭证，写入本地文件，返回连接状态
app.post('/api/credentials', async context => {
  const body = await context.req.json();
  const existing = loadCredentials();
  const merged = { ...existing, ...body };
  saveCredentials(merged);
  saveCredentialsMeta(merged);
  return context.json({ success: true, meta: buildMetaFromCredentials(merged) });
});

// POST /api/credentials/verify
// 验证凭证是否有效（调用各 Provider 的 whoami）
app.post('/api/credentials/verify', async context => {
  const creds = loadCredentials();
  const results = await verifyAllCredentials(creds);
  return context.json({ results });
});

// DELETE /api/credentials/:key
// 删除单个凭证
app.delete('/api/credentials/:key', context => {
  const key = context.req.param('key');
  const creds = loadCredentials();
  delete creds[key];
  saveCredentials(creds);
  saveCredentialsMeta(creds);
  return context.json({ success: true });
});
```

### 7.2 项目资源路由

```typescript
// GET /api/projects/:projectId/resources
// 返回项目资源清单
app.get('/api/projects/:projectId/resources', context => {
  const project = store.getProject(context.req.param('projectId'));
  if (!project) return context.json({ error: 'Project not found.' }, 404);
  const run = store.getLatestApplyRun(project.id, project.blueprint.metadata.revision);
  if (!run) return context.json({ resources: null });
  const resources = loadProjectResources(run.workspacePath);
  return context.json({ resources });
});

// POST /api/projects/:projectId/env/regenerate
// 手动重新生成 .env
app.post('/api/projects/:projectId/env/regenerate', async context => {
  const project = store.getProject(context.req.param('projectId'));
  if (!project) return context.json({ error: 'Project not found.' }, 404);
  const run = store.getLatestApplyRun(project.id, project.blueprint.metadata.revision);
  if (!run) return context.json({ error: 'No workspace found.' }, 404);
  const creds = loadCredentials();
  const resources = loadProjectResources(run.workspacePath);
  generateEnvFile(run.workspacePath, creds, resources, project.name);
  return context.json({ success: true });
});
```

## 8. 用户引导流程

### 8.1 新手模式首次使用

```
用户首次进入 Agent-Dev
    ↓
[选择模式：新手 / 专业]
    ↓ 新手
[创建账号]（邮箱 + 密码 + 2FA）
    ↓
[凭证填写引导]
    ↓
┌─────────────────────────────────────────────┐
│  连接你的云服务                              │
│                                             │
│  以下凭证用于部署你的应用，只存在你的电脑上 │
│  不会上传到任何服务器。                     │
│                                             │
│  ── GitHub ──────────────────────────────   │
│  Token  [<your-github-token>          ]    │
│  👉 怎么获取？ 点击查看教程                  │
│  教程内容：                                  │
│    1. 打开 https://github.com/settings/tokens │
│    2. 点击 "Generate new token (classic)"   │
│    3. 勾选 repo 和 workflow                 │
│    4. 复制生成的 token                      │
│    5. 粘贴到上方输入框                       │
│                                             │
│  ── Vercel ──────────────────────────────   │
│  Token  [vercel_xxxxxxxxxxxxxxx        ]    │
│  👉 怎么获取？ 点击查看教程                  │
│  教程内容：                                  │
│    1. 打开 https://vercel.com/account/tokens │
│    2. 点击 "Create Token"                   │
│    3. Scope 选 Full Account                 │
│    4. 复制生成的 token                      │
│    5. 粘贴到上方输入框                       │
│                                             │
│  ── Cloudflare ─────────────────────────    │
│  API Token [cf_xxxxxxxxxxxxxxxxx       ]    │
│  👉 怎么获取？ 点击查看教程                  │
│  教程内容：                                  │
│    1. 打开 https://dash.cloudflare.com/profile/api-tokens │
│    2. 点击 "Create Token"                   │
│    3. 选择 "Edit Cloudflare Workers" 模板   │
│    4. 复制生成的 token                      │
│    5. 粘贴到上方输入框                       │
│                                             │
│  ── Supabase ───────────────────────────    │
│  Access Token [<your-supabase-token>  ]    │
│  👉 怎么获取？ 点击查看教程                  │
│  教程内容：                                  │
│    1. 打开 https://supabase.com/dashboard/account/tokens │
│    2. 点击 "Generate new token"             │
│    3. 复制生成的 token                      │
│    4. 粘贴到上方输入框                       │
│                                             │
│  ── 第三方 API（可选）──────────────────    │
│  OpenAI API Key  [<your-openai-key>    ]    │
│  Stripe Secret   [<your-stripe-key>    ]    │
│  + 添加自定义 API Key                        │
│                                             │
│  ☑ 我已了解凭证只存在本地                    │
│                                             │
│  [跳过未填写的]  [保存到本地]                │
└─────────────────────────────────────────────┘
    ↓
平台写入 <agent-dev>/.agent-dev/credentials.txt
平台写入 <agent-dev>/.agent-dev/credentials.txt.meta.json
    ↓
验证每个凭证是否有效
    ↓
显示连接状态：
  ✓ GitHub 已连接
  ✓ Vercel 已连接
  ✓ Cloudflare 已连接
  ✓ Supabase 已连接
  ✓ OpenAI API Key 已设置
    ↓
[开始创建应用]
```

### 8.2 后续使用

```
用户描述应用需求
    ↓
Agent 自动完成全部流程：
  - 创建 GitHub 仓库（用 GITHUB_TOKEN）
  - 部署 Vercel（用 VERCEL_TOKEN）
  - 部署 Cloudflare（用 CLOUDFLARE_API_TOKEN）
  - 配置 Supabase（用 SUPABASE_ACCESS_TOKEN）
    ↓
Provider Apply 返回资源信息
    ↓
自动写入 <workspace>/.agent-dev/project-resources.json
自动生成 <workspace>/.env
    ↓
应用上线，用户拿到 URL
    ↓
凭证留在本地，下次直接用
```

### 8.3 凭证管理面板

```
┌─────────────────────────────────────────────┐
│  凭证中心                                    │
│  所有凭证只存在你的电脑上，不上传服务器      │
│  文件位置：~/.agent-dev/credentials.txt     │
│                                             │
│  ── 平台凭证（部署用）────────────────────   │
│  GitHub Token     [✓ 已连接] [修改] [删除]   │
│  Vercel Token     [✓ 已连接] [修改] [删除]   │
│  Cloudflare Token [✓ 已连接] [修改] [删除]   │
│  Supabase Token   [✓ 已连接] [修改] [删除]   │
│                                             │
│  ── 第三方 API（应用用）─────────────────    │
│  OpenAI API Key   [✓ 已填写] [修改] [删除]   │
│  Stripe Secret    [  未填写 ] [添加]         │
│  Resend API Key   [  未填写 ] [添加]         │
│  + 添加自定义环境变量                        │
│                                             │
│  ── 当前项目资源 ────────────────────────    │
│  GitHub:  bayernjf/my-todo-app               │
│  Vercel:  prj_abc123 / my-todo-app          │
│  CF:      23afa7f0... / my-todo-app          │
│  Supabase: abcdefghijkl / my-todo-app        │
│  [查看完整资源清单]                          │
│                                             │
│  ── 当前项目环境变量 ────────────────────    │
│  DATABASE_URL     [已设置] [修改]            │
│  APP_NAME         [已设置] [修改]            │
│  + 添加项目变量                              │
│  [重新生成 .env]                             │
│                                             │
│  [导出凭证文件]  [从文件导入]                │
└─────────────────────────────────────────────┘
```

## 9. Supabase 真实接入方案

### 9.1 设计原则

Supabase 涉及数据库 + 认证，是**不可逆资源**，采用分阶段策略：

- **基础设施自动**：项目创建（Management API）、schema 迁移（supabase db push）
- **数据层人工**：RLS 策略、Auth Provider 配置、Secrets 管理

### 9.2 SupabaseAdapter 实现

新增文件：`packages/provider-cli/src/supabase.ts`

```typescript
export class SupabaseAdapter implements ProviderAdapter {
  readonly providerId = 'supabase';

  constructor(
    private owner: string,
    private projectName: string,
    private workspacePath: string,
    private runner: CommandRunner = defaultRunner,
  ) {}

  async discover(): Promise<ProviderState> {
    // 使用 supabase projects list 查询已存在的项目
    const result = await this.runner('supabase', ['projects', 'list'], {
      cwd: this.workspacePath,
      timeout: 30_000,
      env: { ...process.env, CI: 'true' },
    });
    if (!result.success) return { providerId: this.providerId, resources: [] };
    const output = result.stdout || result.stderr;
    const exists = output.split('\n').some(line => line.includes(this.projectName));
    if (!exists) return { providerId: this.providerId, resources: [] };

    // 获取项目详情
    const detailsResult = await this.runner(
      'supabase',
      ['projects', 'api-keys', '--project-ref', this.resolveProjectRef(output)],
      { cwd: this.workspacePath, timeout: 30_000 },
    );

    return {
      providerId: this.providerId,
      resources: [{
        id: 'supabase-project',
        kind: 'database-auth-project',
        owner: this.owner,
        createdAt: new Date().toISOString(),
      }],
    };
  }

  async apply(plan: ProviderPlan, approval: ProviderApproval): Promise<ProviderApplyResult> {
    for (const resource of plan.resources) {
      if (resource.action === 'noop') continue;

      // 创建 Supabase 项目
      const createResult = await this.runner(
        'supabase',
        ['projects', 'create', this.projectName, '--db-password', this.generateDbPassword()],
        { cwd: this.workspacePath, timeout: 60_000 },
      );
      if (!createResult.success) {
        throw new Error(`Supabase project creation failed: ${createResult.stderr || createResult.stdout}`);
      }

      // 解析返回的项目信息
      const projectRef = this.parseProjectRef(createResult.stdout);
      const apiKeys = await this.fetchApiKeys(projectRef);

      // 返回完整资源信息（会写入 project-resources.json）
      return {
        providerId: this.providerId,
        idempotencyKey: plan.idempotencyKey,
        applied: true,
        state: {
          providerId: this.providerId,
          resources: [{
            id: 'supabase-project',
            kind: 'database-auth-project',
            owner: this.owner,
            createdAt: new Date().toISOString(),
          }],
          // 扩展字段，写入 project-resources.json
          projectRef,
          url: `https://${projectRef}.supabase.co`,
          anonKey: apiKeys.anon,
          serviceRoleKey: apiKeys.serviceRole,
          databaseUrl: `postgresql://postgres:${password}@db.${projectRef}.supabase.co:5432/postgres`,
          studioUrl: `https://supabase.com/dashboard/project/${projectRef}`,
        },
      };
    }
    return {
      providerId: this.providerId,
      idempotencyKey: plan.idempotencyKey,
      applied: true,
      state: await this.discover(),
    };
  }
}
```

### 9.3 Registry 改造

```typescript
// registry.ts 中 supabase 不再直接返回 Manual
private async createAdapter(providerId: string, spec: ProviderResourceSpec, ctx: ProviderContext): Promise<ProviderAdapter> {
  const creds = loadCredentials();

  if (providerId === 'supabase') {
    if (creds.SUPABASE_ACCESS_TOKEN) {
      return new SupabaseAdapter(spec.owner, ctx.projectName, ctx.workspacePath, this.runner);
    }
    // 凭证不存在时降级为 Manual
    return new ManualProviderAdapter('supabase', 'Supabase access token not found. Add it in the Credentials panel.');
  }

  // ... 其他 provider 逻辑
}
```

### 9.4 降级理由修正

将 `DEFAULT_SUPABASE_REASON` 改为准确的描述：

```typescript
const DEFAULT_SUPABASE_REASON = 'Supabase manages irreversible data resources (database, auth, RLS). Without a Supabase access token, the project must be created manually through the dashboard. Add a token in the Credentials panel to enable automatic project creation.';
```

## 10. 安全分析

### 10.1 威胁模型

| 威胁 | 影响 | 缓解措施 |
|------|------|---------|
| 数据库被拖库 | 凭证不在数据库，无影响 | 凭证只存本地文件 |
| 本地文件被读取 | 凭证泄露 | 文件权限 600，目录权限 700 |
| 凭证提交到 Git | 凭证泄露 | 自动加入 .gitignore |
| 单个凭证泄露 | 单 Provider 受影响 | OAuth token 可在 Provider 端撤销 |
| Agent 越权操作 | 资源被误操作 | scope 限制 + 审计日志 + 敏感操作二次确认 |
| 用户密码泄露 | 本地文件可读 | 2FA（未来）+ 文件权限 |

### 10.2 与零知识加密方案的对比

| | 当前方案（明文本地文件） | 零知识加密方案 |
|--|---|---|
| 复杂度 | 低，1-2 天实现 | 高，2-3 周实现 |
| 安全性 | 文件权限保护 | AES-256 加密 + Argon2id 派生 |
| 本地被入侵 | 凭证泄露 | 凭证不可解（需密码） |
| 用户体验 | 填一次，后续自动 | 每次需输入密码解锁 |
| 适用阶段 | 验证期、单机使用 | 多租户 SaaS |

当前阶段（验证期、单机使用、单用户）明文本地文件 + 文件权限保护是可接受的。等走向多租户 SaaS 时升级到加密方案。

### 10.3 未来升级路径

```
当前：明文本地文件 + 文件权限
    ↓ 验证通过后
阶段 2：本地加密文件（AES-256 + 用户密码派生密钥）
    ↓ 多租户需求出现
阶段 3：零知识加密保险库（Argon2id + envelope encryption + OAuth 优先）
```

## 11. 实施计划

### 11.1 Phase 1：基础凭证管理（当前）

**目标**：实现凭证文件读写 + Provider 注入

**改动文件**：

| 文件 | 操作 | 内容 |
|------|------|------|
| `packages/provider-cli/src/credentials.ts` | 新增 | 凭证文件读写 |
| `packages/provider-cli/src/project-resources.ts` | 新增 | 项目资源清单读写 |
| `packages/provider-cli/src/env-generator.ts` | 新增 | .env 自动生成 |
| `packages/provider-cli/src/registry.ts` | 修改 | checkProviderAvailable 改为查凭证 |
| `packages/provider-cli/src/github.ts` | 修改 | 注入 GITHUB_TOKEN |
| `packages/provider-cli/src/vercel.ts` | 修改 | 注入 VERCEL_TOKEN |
| `packages/provider-cli/src/cloudflare.ts` | 修改 | 已支持，无需改动 |
| `packages/provider-cli/src/supabase.ts` | 新增 | 真实 Supabase adapter |
| `apps/daemon/src/app.ts` | 修改 | 新增凭证和资源路由 |
| `apps/daemon/src/providers.ts` | 修改 | 修正降级理由 |

**验收标准**：
- 用户通过 API 填写凭证 → 写入 `~/.agent-dev/credentials.txt`
- Provider Apply 时从凭证文件读取 token → 注入环境变量 → CLI 调用成功
- Apply 成功后资源信息写入 `project-resources.json`
- `.env` 自动生成，应用代码可直接使用
- Supabase 能真实创建项目（有 token 时）或降级为 Manual（无 token 时）

### 11.2 Phase 2：UI 凭证面板（已于 2026-08-08 完成）

**目标**：新手引导流程 + 凭证管理 UI

**实际实现**（与计划的文件结构有差异，采用当前面板增强形式而非独立页面）：

| 文件 | 操作 | 内容 |
|------|------|------|
| `packages/provider-cli/src/credentials.ts` | 修改 | 新增 `verifyCredentials()`，通过 CLI（gh/vercel/wrangler/supabase）验证 Token 有效性 |
| `apps/daemon/src/app.ts` | 修改 | 新增 `POST /api/credentials/verify` 路由 |
| `apps/studio/src/App.tsx` | 修改 | 凭证面板增强：首次引导模式、凭证验证、Supabase 手动配置区块、自定义第三方 API Key 管理 |
| `apps/studio/src/styles.css` | 修改 | 引导、验证、Supabase 手动配置、自定义 Key 样式 |

**验收标准达成情况**：
- ✅ 新手首次使用时进入凭证填写引导（无凭证时自动进入分步引导，可 Skip）
- ✅ 每个 Provider 旁边有教程链接
- ✅ 凭证面板可查看连接状态（验证）、修改、删除
- ✅ 可查看当前项目资源清单
- ✅ 可手动重新生成 .env
- ✅ 额外：Supabase 手动配置引导（4 步教程 + 填入 URL/Key，遵循用户决策不做自动化）
- ✅ 额外：自定义第三方 API Key 管理（key 名自动规范化，重名检查）

### 11.3 Phase 3：安全增强

**目标**：本地加密 + 审计日志

**改动文件**：

| 文件 | 操作 | 内容 |
|------|------|------|
| `packages/provider-cli/src/crypto.ts` | 新增 | AES-256 加解密 |
| `packages/provider-cli/src/credentials.ts` | 修改 | 加密存储 |
| `packages/provider-cli/src/audit-log.ts` | 新增 | 凭证使用审计 |
| `apps/daemon/src/app.ts` | 修改 | 敏感操作二次确认 |

## 12. CLI 工具凭证对照表

### 12.1 各 CLI 支持的环境变量

| CLI 工具 | 环境变量 | 说明 |
|----------|---------|------|
| `gh` (GitHub CLI) | `GITHUB_TOKEN` | 完全替代 `gh auth login` |
| `vercel` (Vercel CLI) | `VERCEL_TOKEN` | 替代 `vercel login`，需配合 `--token` 或环境变量 |
| `wrangler` (Cloudflare) | `CLOUDFLARE_API_TOKEN` | 已原生支持，无需 `wrangler login` |
| `supabase` (Supabase CLI) | `SUPABASE_ACCESS_TOKEN` | 替代 `supabase login` |

### 12.2 凭证获取教程

#### GitHub Token

1. 打开 https://github.com/settings/tokens
2. 点击 "Generate new token (classic)"
3. 勾选权限：`repo`、`workflow`
4. 设置过期时间（建议 90 天）
5. 复制生成的 token（`ghp_` 开头）

#### Vercel Token

1. 打开 https://vercel.com/account/tokens
2. 点击 "Create Token"
3. 名称随意填，Scope 选 "Full Account"
4. 复制生成的 token

#### Cloudflare API Token

1. 打开 https://dash.cloudflare.com/profile/api-tokens
2. 点击 "Create Token"
3. 选择 "Edit Cloudflare Workers" 模板
4. 复制生成的 token

#### Supabase Access Token

1. 打开 https://supabase.com/dashboard/account/tokens
2. 点击 "Generate new token"
3. 复制生成的 token（`sbp_` 开头）

## 13. 文件路径汇总

| 文件 | 路径 | 说明 |
|------|------|------|
| 全局凭证 | `~/.agent-dev/credentials.txt` | 用户手填的 Token 和 API Key |
| 凭证元数据 | `~/.agent-dev/credentials.meta.json` | 连接状态（可上传服务端） |
| 项目资源 | `<workspace>/.agent-dev/project-resources.json` | 平台创建的资源 ID 和 URL |
| 应用环境变量 | `<workspace>/.env` | 自动生成，给应用代码用 |
| 环境变量模板 | `<workspace>/.env.example` | 提交到 Git，供参考 |
| .gitignore 追加 | `<workspace>/.gitignore` | 忽略 .env 和 .agent-dev/ |

### .gitignore 自动追加内容

```gitignore
# Agent-Dev credentials and resources
.env
.agent-dev/credentials.txt
.agent-dev/project-resources.json
```
