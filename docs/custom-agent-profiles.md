# Custom Agent Profiles

> 状态：已落地（Profile CRUD + Runtime 配置合并 + Studio 管理界面 + 轻量串行流水线均已实现）
> 日期：2026-08-27（设计），2026-09 实现落地
> 前置文档：[agent-runtime-catalog.md](./agent-runtime-catalog.md)

## 1. 目标

当前 Agent Runtime Catalog 只支持"一个 agentId 对应一个固定 Adapter 配置"。用户无法基于同一个底层 Agent（如 Codex）创建多个不同定位的变体，例如：

| Profile 名称 | 底层 Agent | 差异配置 |
| --- | --- | --- |
| `codex-frontend` | codex | system prompt 专注 React/TypeScript，模型 `gpt-4o` |
| `codex-backend` | codex | system prompt 专注 Node.js/数据库，模型 `gpt-4o` |
| `codex-reviewer` | codex | 只做代码审查，禁用 Write/Edit 工具 |
| `claude-senior` | claude-code | system prompt 要求资深工程师视角，温度 0.2 |

本方案定义 **Agent Profile** 机制：用户基于已有的 verified 底层 Agent，通过覆盖部分配置（system prompt、模型、环境变量、工具白名单、温度等）创建命名变体，在 Runtime 选择时和内置 Agent 平级使用。

## 2. 与现有"自定义 Agent"的区别

现有 `agent-runtime-catalog.md` 定义的自定义 Agent 是"添加一个全新的 Agent"（输入名称和启动命令，框架不知道它的执行契约）。Agent Profile 是"基于已有 verified Agent 创建变体"，继承底层 Agent 的执行契约和安全边界，只覆盖声明式配置。

| 维度 | 自定义 Agent（现有） | Agent Profile（本方案） |
| --- | --- | --- |
| 底层执行 | 用户提供完整命令 | 继承 verified Adapter 的 buildCommand |
| 执行契约 | 未知，需逐个人工验证 | 继承底层 Agent 的 verified 状态 |
| 配置方式 | 名称 + 启动命令 + 专业模式参数 | 名称 + baseAgentId + 覆盖项 |
| 安全边界 | 需重新声明能力 | 继承底层 Agent，只能收窄不能放宽 |
| 典型场景 | 接入一个框架不认识的新 Agent | 给已知 Agent 换 system prompt / 模型 / 工具集 |

两者共存：Profile 在 Catalog 里显示为 `profile` 来源，和 `builtin`、`custom` 平级。

## 3. 数据模型

### 3.1 AgentProfile 结构

```typescript
type AgentProfile = {
  id: string;              // 唯一 ID，如 "codex-frontend"
  name: string;            // 显示名称，如 "Codex · 前端专家"
  description: string;     // 可选，一句话描述
  baseAgentId: string;     // 底层 Agent ID，必须是 verified 的 builtin 或 custom Agent
  icon?: string;           // 可选，emoji 或图标标识
  overrides: {
    systemPrompt?: string;      // 追加到默认 system prompt 之后
    model?: string;             // 模型 ID，如 "gpt-4o"、"claude-sonnet-4-20250514"
    temperature?: number;       // 0.0 - 2.0
    env?: Record<string, string>;  // 额外环境变量（白名单内）
    allowedTools?: string[];    // 工具白名单，不填则继承底层默认
    blockedTools?: string[];    // 工具黑名单，在白名单基础上再禁用
    maxTokens?: number;         // 最大输出 token
  };
  createdAt: string;
  updatedAt: string;
};
```

### 3.2 约束规则

1. `baseAgentId` 必须指向 `adapterStatus === 'verified'` 的 Agent；指向 candidate 或 unsupported 的 Agent 时创建被拒绝。
2. Profile 继承底层 Agent 的 `capabilities`，`overrides.allowedTools` 只能是底层 Agent 支持工具的子集，不能添加底层不支持的工具。
3. `overrides.env` 的 key 必须在安全白名单内（`PATH`、`HOME`、`LANG` 等 + 底层 Agent 声明的额外变量），不能注入任意环境变量。
4. Profile 本身不改变 `adapterStatus`：只要 baseAgentId 是 verified，Profile 就是可执行的；baseAgentId 降级为 candidate 时，依赖它的 Profile 同步降级。
5. Profile ID 全局唯一，不能和 builtin Agent ID 冲突。

## 4. 存储位置

Profile 是用户级配置，不属于某个具体项目。存储在 Agent-Dev 的数据目录下：

```
.agent-dev/
  agent-dev.sqlite          # 主数据库
  agent-profiles.json       # Profile 列表（JSON 数组，人类可读）
```

选择 JSON 文件而非数据库表的原因：
- Profile 数量通常很少（个位数到几十），不需要查询优化；
- JSON 文件方便用户备份、版本管理、手动编辑；
- 与现有 `.agent-dev/agents.conf` 自定义 Agent 存储方式一致。

后续桌面安装版可迁移到 `~/.agent-dev/agent-profiles.json`。

## 5. API 设计

所有 API 挂在 Daemon 的 `/api/runtime/profiles` 下。

### 5.1 列出 Profile

```
GET /api/runtime/profiles
```

返回所有 Profile，附带每个 Profile 的 baseAgent 状态和可执行性。

### 5.2 创建 Profile

```
POST /api/runtime/profiles
Body: { name, description?, baseAgentId, icon?, overrides }
```

校验：
- `baseAgentId` 存在且 verified；
- `overrides.allowedTools` 是底层 Agent 工具集的子集；
- `overrides.env` 的 key 在白名单内；
- `id` 自动生成（slugify name），冲突时返回 409。

### 5.3 更新 Profile

```
PUT /api/runtime/profiles/:profileId
Body: { name?, description?, overrides? }
```

`baseAgentId` 不可修改（修改等于创建新 Profile）。

### 5.4 删除 Profile

```
DELETE /api/runtime/profiles/:profileId
```

删除前检查：是否有项目的 Blueprint `runtime.provider` 指向这个 Profile。如果有，返回 409 并提示用户先切换项目默认 Agent。

### 5.5 测试 Profile（dry-run）

```
POST /api/runtime/profiles/:profileId/test
Body: { prompt: "say hello" }
```

在临时目录执行一次非交互调用，返回输出、退出码、耗时。用于用户验证 Profile 配置是否生效。

## 6. Runtime 执行时的配置合并

`prepareRuntimeRun` 和 `executeRuntimeAttempt` 在构建执行命令时，按以下优先级合并配置：

```
底层 Agent 默认配置（AGENT_ADAPTERS[baseAgentId]）
  ↓ 被 Profile overrides 覆盖
Profile 配置
  ↓ 被项目级 Blueprint.runtime 配置覆盖（如有）
项目级配置
  ↓ 被单次 Runtime 调用的参数覆盖（如有）
单次调用参数
```

具体合并规则：
- `systemPrompt`：底层默认 + Profile 追加 + 项目级追加（拼接，不覆盖）；
- `model`、`temperature`、`maxTokens`：直接覆盖（高优先级覆盖低优先级）；
- `env`：合并，高优先级的同名 key 覆盖低优先级；
- `allowedTools`：取交集（底层 ∩ Profile ∩ 项目级），任何一层声明的白名单都会收窄工具集；
- `blockedTools`：取并集，任何一层声明的黑名单都会禁用工具。

合并后的最终配置写入 `runtime-run.json` 的 `resolvedConfig` 字段，便于审计和调试。

## 7. Studio 界面设计

### 7.1 Agent 选择下拉

Runtime 选择下拉里，Profile 和内置 Agent 混排，用分组区分：

```
▼ 选择执行 Agent
  ─── 内置 Agent ───
  ● Codex (verified)
  ○ CodeBuddy (verified)
  ○ Claude Code (candidate)
  ─── 我的 Profile ───
  ○ Codex · 前端专家
  ○ Codex · 后端专家
  ○ Claude · 资深审查
  ─── 自定义 Agent ───
  ○ My Local Agent (custom)
```

Profile 显示名称 + 底层 Agent 标识（如 "Codex · 前端专家"），verified 状态继承自底层 Agent。

### 7.2 Profile 管理页面

Studio 新增 "Agent Profiles" 页面（或在现有 Agent Catalog 页面加 Tab）：

- 列表视图：名称、底层 Agent、模型、工具数、创建时间；
- 创建/编辑表单：
  - 名称（必填）
  - 描述（可选）
  - 底层 Agent（下拉，只列 verified 的）
  - 图标（可选，emoji 选择）
  - System Prompt（多行文本，提示"追加到默认 prompt 之后"）
  - 模型（下拉或自由输入，根据底层 Agent 支持的模型）
  - 温度（滑块 0.0-2.0）
  - 工具白名单（多选，从底层 Agent 支持的工具中选）
  - 环境变量（键值对，key 受限）
- 测试按钮：打开弹窗输入 prompt，显示执行结果；
- 删除按钮：有关联项目时提示。

### 7.3 项目级默认 Agent

Blueprint 创建/编辑时，`runtime.provider` 下拉包含内置 Agent + Profile。选择 Profile 后，项目的所有 Feature Task 默认用这个 Profile，用户仍可在单次 Runtime 调用时临时覆盖。

## 8. 安全边界

Profile 继承底层 Agent 的所有安全边界，额外约束：

1. **工具只能收窄不能放宽**：Profile 的 `allowedTools` 必须是底层 Agent 工具集的子集，不能添加底层不支持的工具；
2. **环境变量白名单**：`overrides.env` 的 key 必须在全局白名单内，白名单由框架维护，用户不能任意添加；
3. **system prompt 注入防护**：Profile 的 systemPrompt 追加到底层默认 prompt 之后，不能覆盖底层的安全指令（如"不要访问 secrets"）；
4. **执行审计**：每次 Runtime 执行的 `runtime-run.json` 记录使用的 Profile ID 和合并后的最终配置，便于追溯；
5. **baseAgent 降级联动**：底层 Agent 从 verified 降级为 candidate 时，所有依赖它的 Profile 同步标记为不可执行，Studio 显示警告。

## 9. 分阶段实施

### 阶段 A：数据模型和存储（1-2 天）

- [ ] 定义 `AgentProfile` TypeScript 类型和校验 schema（zod）；
- [ ] 实现 JSON 文件读写（`agent-profiles.json`）；
- [ ] 实现 Profile CRUD 的内存缓存和文件持久化；
- [ ] 单元测试：创建、更新、删除、校验规则。

### 阶段 B：API 层（1 天）

- [ ] `GET /api/runtime/profiles` 列表；
- [ ] `POST /api/runtime/profiles` 创建（含校验）；
- [ ] `PUT /api/runtime/profiles/:id` 更新；
- [ ] `DELETE /api/runtime/profiles/:id` 删除（含关联检查）；
- [ ] `POST /api/runtime/profiles/:id/test` 测试执行；
- [ ] API 集成测试。

### 阶段 C：Runtime 配置合并（1-2 天）

- [ ] 实现配置合并函数（按优先级合并 systemPrompt/model/temperature/env/tools）；
- [ ] 修改 `prepareRuntimeRun` 支持 Profile ID 作为 agentId；
- [ ] 修改 `executeRuntimeAttempt` 使用合并后的配置构建命令；
- [ ] `runtime-run.json` 增加 `resolvedConfig` 字段；
- [ ] 端到端测试：用 Profile 执行一个简单 Feature Task，验证配置生效。

### 阶段 D：Studio 界面（2-3 天）

- [ ] Agent 选择下拉增加 Profile 分组；
- [ ] Profile 管理页面（列表 + 创建/编辑表单）；
- [ ] 测试执行弹窗；
- [ ] Blueprint 创建/编辑时 runtime.provider 下拉包含 Profile；
- [ ] 关联项目删除警告。

### 阶段 E：文档和示例（0.5 天）

- [ ] 更新 `agent-runtime-catalog.md` 引用本方案；
- [ ] 提供 3 个示例 Profile（前端专家、后端专家、代码审查）；
- [ ] 更新用户文档。

## 10. 开放问题

1. **模型列表来源**：Profile 表单的模型下拉选项从哪来？底层 Agent 的配置文件？还是用户自由输入？建议第一版自由输入 + 常用模型预设，后续接入模型列表 API。
2. **Profile 导出/导入**：是否支持 Profile 的 JSON 导出/导入，方便团队共享？建议 v2 再做。
3. **项目级 Profile**：是否允许项目级 Profile（只在某个项目内可见）？建议第一版只做用户级 Profile，项目级后续按需扩展。
4. **Profile 版本化**：修改 Profile 后，历史 Runtime Run 引用的是修改前还是修改后的配置？建议 `runtime-run.json` 记录执行时的快照配置，不随 Profile 修改而变化。

## 11. 与现有代码的对接点

| 现有模块 | 需要修改的内容 |
| --- | --- |
| `packages/agent-runtime/src/catalog.ts` | `discoverAgentRuntimes` 增加 Profile 来源，返回时合并 builtin + custom + profile |
| `packages/agent-runtime/src/index.ts` | `buildAgentExecutionPlan` 增加 Profile 配置合并逻辑；`isAgentExecutable` 支持 Profile ID |
| `packages/storage/src/index.ts` | `prepareRuntimeRun` / `executeRuntimeAttempt` 支持 Profile ID；增加 Profile 存储读写 |
| `apps/daemon/src/app.ts` | 增加 `/api/runtime/profiles/*` 路由 |
| `apps/studio/` | Agent 选择下拉、Profile 管理页面、Blueprint 表单 |

## 12. 示例 Profile

以下是三个常用 Profile 的配置示例，可直接通过 API 或 Studio 创建。

### 12.1 前端专家（基于 Codex）

```json
{
  "name": "Codex · 前端专家",
  "baseAgentId": "codex",
  "description": "专注 React/TypeScript 前端开发，优先使用函数组件和 Hooks",
  "overrides": {
    "systemPrompt": "You are a senior frontend engineer specializing in React and TypeScript. Always use functional components with Hooks. Prefer Tailwind CSS for styling. Write accessible HTML with proper ARIA attributes. Keep components small and composable.",
    "model": "gpt-4o",
    "temperature": 0.3
  }
}
```

### 12.2 后端专家（基于 Codex）

```json
{
  "name": "Codex · 后端专家",
  "baseAgentId": "codex",
  "description": "专注 Node.js/数据库后端开发，强调错误处理和输入校验",
  "overrides": {
    "systemPrompt": "You are a senior backend engineer specializing in Node.js and PostgreSQL. Always validate all user input. Use proper error handling with meaningful error messages. Write database queries with parameterized statements to prevent SQL injection. Include logging for debugging.",
    "model": "gpt-4o",
    "temperature": 0.2
  }
}
```

### 12.3 代码审查员（基于 CodeBuddy）

```json
{
  "name": "CodeBuddy · 审查员",
  "baseAgentId": "codebuddy",
  "description": "只做代码审查，不修改文件。关注安全、性能和可维护性",
  "overrides": {
    "systemPrompt": "You are a strict code reviewer. Do NOT modify any files. Read the code and provide a detailed review covering: security vulnerabilities, performance issues, code maintainability, naming conventions, and test coverage. Output your findings as a structured list with severity levels (critical/warning/info).",
    "blockedTools": ["Write", "Edit", "Bash"]
  }
}
```

### 12.4 通过 API 创建

```bash
curl -X POST http://localhost:3737/api/runtime/profiles \
  -H "Content-Type: application/json" \
  -d '{
    "name": "Codex · 前端专家",
    "baseAgentId": "codex",
    "overrides": {
      "systemPrompt": "You are a senior frontend engineer...",
      "temperature": 0.3
    }
  }'
```

### 12.5 存储位置

创建后的 Profile 保存在：
```
.agent-dev/agent-profiles.json
```

这是一个 JSON 数组文件，可手动编辑、备份或版本管理。

## 13. 未来扩展：轻量串行流水线（v0.2/v0.3 候选）

### 13.1 定位

在一个 Feature Task 内定义多个执行步骤，每个步骤用不同的 Agent Profile，前一步的输出作为后一步的输入。实现"方案→实现→审查→修复"的自动闭环，而不需要用户手动拆分多个 Feature Task。

**明确不做**：真正的多 agent 并行协作、agent 间实时通信、主 agent 动态拆分任务。这些属于另一个产品品类（multi-agent framework），会让 agent-dev 从"交付控制平面"偏离定位。

### 13.2 典型场景

```
Task: "实现用户登录功能"
  Step 1 (profile: codex-architect): 输出技术方案 → 写入 docs/login-design.md
  Step 2 (profile: codex-frontend):  读取方案 → 实现前端登录页面
  Step 3 (profile: codebuddy-backend): 读取方案 → 实现后端 API
  Step 4 (profile: hermes-reviewer):  读取 git diff → 输出 code review 意见
  Step 5 (profile: codex-frontend):  读取 review 意见 → 修复问题
```

### 13.3 数据模型

```typescript
type PipelineStep = {
  id: string;
  name: string;
  profileId: string;           // 使用哪个 Profile
  inputPrompt: string;         // 该步骤的 prompt 模板，可引用前一步输出
  dependsOn?: string[];        // 依赖哪些步骤（默认依赖前一步）
  outputArtifact?: string;     // 输出产物路径（如 docs/design.md）
  continueOnFailure?: boolean;  // 失败后是否继续（默认 false）
};

type FeatureTaskPipeline = {
  steps: PipelineStep[];
  currentStepIndex: number;
  results: Array<{
    stepId: string;
    status: 'pending' | 'running' | 'completed' | 'failed' | 'skipped';
    output?: string;            // 该步骤的输出摘要
    runtimeRunId?: string;      // 关联的 RuntimeRun
    startedAt?: string;
    completedAt?: string;
  }>;
};
```

### 13.4 执行模型

1. **串行执行**：步骤按顺序执行，前一步完成后才开始后一步。
2. **上下文传递**：每一步的 prompt 可以引用前一步的输出（通过模板变量 `{{step:step-id.output}}`）。
3. **产物传递**：步骤可以指定 `outputArtifact`（如写入某个文件），后续步骤可以读取该文件。
4. **失败处理**：默认失败即停止，用户可以选择重试该步骤或跳过。`continueOnFailure: true` 的步骤失败后继续。
5. **人工 Gate**：可以在步骤之间插入人工确认点（如"方案确认后再实现"）。

### 13.5 与现有架构的关系

- 复用现有 `RuntimeRun` 机制：每个步骤本质上是一次 `prepareRuntimeRun` + `executeRuntimeRun`。
- 复用现有 Profile 机制：每个步骤指定一个 `profileId`，由 storage 层解析为 base agent + 配置合并。
- 扩展 `FeatureTask`：增加可选的 `pipeline` 字段，没有 pipeline 的 Task 保持当前单步执行行为（向后兼容）。
- 扩展 Studio UI：Task 详情页增加 Pipeline 编辑器（拖拽排序、选择 Profile、编辑 prompt 模板）和执行进度展示。

### 13.6 不做的边界

| 不做 | 原因 |
| --- | --- |
| 并行执行多个步骤 | 增加复杂度，且独立开发者通常不需要并行 |
| agent 间实时通信 | 属于 multi-agent framework 范畴，偏离定位 |
| 主 agent 动态拆分任务 | 任务拆分应由用户完成，保证可控性 |
| 跨项目的 agent 协作 | 超出单项目交付范围 |
| agent 投票/共识机制 | 增加复杂度，独立开发者不需要 |

### 13.7 进入条件

以下条件满足后再考虑实现：

1. v0.1 三个真实项目交付完成，单 agent 执行模型稳定可靠；
2. Agent Profile 功能经过真实使用验证，用户开始频繁创建多个 Profile；
3. 有用户反馈"同一个任务需要多次切换 Profile 手动执行"的痛点；
4. 外部 Pilot（v0.2）有至少 3 个用户表达了类似需求。

### 13.8 产品定位判断

**为什么不做重量多 agent 团队**：agent-dev 的核心价值是"交付控制平面"，不是"更聪明的 agent"。多 agent 并行协作是 Devin/Cognition 那类产品的赛道，做了就变成"又一个 AI 软件工程师"，失去差异化。

**为什么可以做轻量串行流水线**：它仍然是"交付控制平面"在编排执行步骤，本质上是把用户手动做的"创建多个 Task、选不同 Profile、手动传递上下文"自动化了，不改变产品定位，不引入 agent 间通信的复杂度。
