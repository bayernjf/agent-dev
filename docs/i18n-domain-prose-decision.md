# 领域文案 i18n 边界决策依据

> 状态：**待用户拍板**（handoff §9「领域文案的 i18n 边界」）
> 产出时间：2026-09-02
> 测量脚本：`.scratch/i18n-blast-radius.ts`、`.scratch/i18n-decision-matrix.ts`、`.scratch/artifact-ids.ts`（本地草稿，已 gitignore，不入库）
> 关联：[Studio i18n 设计](studio-i18n-design.md)、[handoff](../handoff.md) §9、2026-09-01/02 Studio 走查待办 1

## 1. 问题

决策卡 title/value/reason、dry-run summary、`automaticPreparation[]`、`manualActions[].title/reason/verification/steps`、baseline `summary` 与 `resource.reason` 的英文文案**硬写在 `packages/blueprint` 里随 API 下发**，Studio 只翻译自己的 chrome。结果：中文用户在**核心交付区**（决策台、基线计划、Dry Run、人工动作）看到整屏英文，而这不是漏翻 `zh.ts`——补 zh 也补不到，因为文案根本不经过 Studio 的 locale 表。

## 2. 影响范围实测（不是估算）

遍历全部答案组合（6 产品类型 × 2 desktop shell × 4 analytics 组合 × 3 owner 状态 × 2 模式 = 288 份 Blueprint），调用四个真实生产者，把产出字符串归一化（嵌入值与数字折叠为占位符）后去重：

| 生产者 | 原始字符串 | 归一化模板 | 固定静态 | 固定带参 | 按类型分叉 |
| --- | --- | --- | --- | --- | --- |
| `getBlueprintDecisions`（决策卡） | 37 | 37 | 24 | 2 | 11 |
| `createBaselinePlan`（基线计划） | 17 | 15 | 3 | 1 | 11 |
| `createDryRunPlan`（dry-run summary + automaticPreparation） | 24 | 4 | 3 | 1 | 0 |
| `manualActions`（人工动作四字段） | 37 | 37 | 18 | 1 | 18 |
| **非 artifact 合计** | **115** | **93** | **48** | **5** | **40** |
| artifact titles（生成物标题） | 85 | 85 | — | — | — |

两个关键事实：

1. **dry-run 看着 24 条，实际只有 4 个模板**——21 条是同一句 `This dry run prepares @ generated artifacts and @ manual actions…` 的参数化重复。真正要翻译的模板远少于字符串数。
2. **artifact titles 跨六类型只有 78 个唯一 id**（`product-standard`、`template-vite-config`、`mcp-server`…），且**后端已经在发稳定 `id`**——Studio 直接用 `artifact.${id}` 查 locale 即可，这一块后端零改动。

### 三类模板的翻译难度

- **48 个固定静态**（如 `Application baseline`、`Human approval required`、`Authorize GitHub access`）：所有类型/组合下文案相同，无参数——直接建 key，最简单，占非 artifact 的 52%。
- **5 个固定带参**（如 `This dry run prepares {count} generated artifacts and {actions} manual actions…`、`After approval, Agent-Dev may create the github repository in {owner}.`）：建 key + params，参数只有 owner 名、analytics 提供商标识、计数三类。
- **40 个按类型分叉**：几乎全部是「provider × 是否需要」矩阵——
  - baselinePlan 的 11 个全是 Supabase/Vercel/Cloudflare 资源创建授权；
  - manualActions 的 18 个全是三家 provider 的授权步骤（sign in / choose org / review plan…）；
  - decisions 的 11 个是各类型技术栈描述与云厂商清单（**这部分已有 SSOT**：`PRODUCT_TYPE_DESCRIPTORS`，`ebe7ec4` 已让两张卡读它）。

  因此 per-type 文案**不需要按「类型 × 文案」笛卡尔积建 key**：key 设计成 `provider.<vendor>.<action>.<field>`（如 `provider.supabase.authorize.title`），「这个类型要不要显示这条」由已有的 `baselineProvidersFor(type)` 决定。

## 3. 决定性约束：同一份 prose 有两个消费方

| 消费方 | 拿到什么 | 需要什么语言 |
| --- | --- | --- |
| **Studio**（人类用户） | daemon API → 界面渲染 | 用户选的语言（中/英） |
| **MCP 桥 → 外部 coding agent**（Codex/Claude 等） | `agent_dev_get_baseline_plan`、`agent_dev_dry_run` 原样下发 | **英文自然语言指令**（agent 靠它理解要授权什么、产物是什么） |

这条约束直接淘汰两个方案：后端若**只发 id/枚举**（方案①），MCP 桥就得自己把 id 渲染回英文，等于把文案又搬回后端，自相矛盾；后端若**按 locale 参数选文案**（方案③），领域包耦合语言，且 MCP 桥为了给 agent 英文还得固定传 `locale=en`，每加一种语言改一次领域包。

## 4. 三方案评估

| 维度 | ① 后端只发 id/枚举，文案全上移 Studio | ② plan 加 `*Key`(+params)，保留英文 prose 作 fallback | ③ 后端按 locale 选文案 |
| --- | --- | --- | --- |
| Studio 中文 | ✅ 真 i18n | ✅ key 查 locale，miss 回退英文 | ✅ |
| MCP 桥给外部 agent 英文指令 | ❌ 拿到 id 无法理解，需后端再渲染 | ✅ **继续读英文 prose，零改动** | ⚠️ 须固定传 en |
| 领域包语言耦合 | 无（语言无关） | 无（prose 仍是英文默认，key 是结构） | **有**（最不推荐） |
| 契约改动 | 大（删 prose，破坏性） | 中（**新增**字段，不破坏旧消费方） | 中（函数签名加 locale） |
| key 稳定性负担 | 93 个 id 要长期稳定 | 同，但英文 prose 是安全网 | 无 key |
| 回退安全性 | key miss 只能显示 id | **key miss 显示英文，不白屏** | locale miss 行为不定 |
| 渐进落地 | 必须一次切完 | **可逐桶迁移**（见 §6） | 一次切完 |
| artifact titles | 也要后端发 id（已发） | **直接用现有 id，零改动** | 也要走 locale 参数 |

## 5. 推荐：方案 ②，且 per-type 走 provider 维度而非类型维度

后端在保留现有英文 prose 的前提下，为每个 prose 字段**并行**发一个稳定 key（带参数的再发 params 对象）；Studio 用 key 查 en/zh locale，查不到回退该字段的英文 prose。MCP 桥与 storage 继续消费英文 prose，一行不改。

### 字段形状（示例）

```ts
// 现在
{ title: 'Application baseline', value: 'React/Vite on Cloudflare Pages | Hono on Vercel Functions', reason: '…' }
// 方案②后（新增 key/params，英文原字段全部保留）
{
  title: 'Application baseline', titleKey: 'decision.applicationBaseline.title',
  value: 'React/Vite on Cloudflare Pages | …', valueKey: 'baseline.stack.webApp',
  reason: '…', reasonKey: 'decision.applicationBaseline.reason',
}
// 带参
{ summary: 'This dry run prepares 12 generated artifacts and 4 manual actions…',
  summaryKey: 'dryRun.summary', summaryParams: { artifactCount: 12, actionCount: 4 } }
```

Studio 侧加一个 `domainT(field, key, params)`：优先 `t(key, params)`，locale miss / 无 key 时回退字段英文原文。这样**迁移期间**任何一桶没翻完，界面只是该处显示英文，不会破。

### key 的组织（把 93 收敛到更少的逻辑组）

- `decision.*`：决策卡（24 固定 + 2 带参 + 11 per-type；per-type 的技术栈/云清单复用 `PRODUCT_TYPE_DESCRIPTORS` 的派生，不新造类型枚举文案）
- `baseline.*`：基线计划 summary + 资源（3 固定 + 1 带参 + 11 provider 资源）
- `dryRun.*`：只有 4 个模板，最小一桶，**建议先做**
- `manualAction.<vendor>.*` / `manualAction.shared.*`：18 固定共享 + 18 provider 步骤（按 supabase/vercel/cloudflare/shared 分组）
- `artifact.<id>`：78 个，直接用后端已发的 artifact id，不进 blueprint 包

## 6. 建议的落地分批（每批独立可提交、可回退）

1. **第 1 批｜dryRun（4 模板，最小闭环）**：blueprint 给 dry-run summary 与 3 条 automaticPreparation 加 key/params；Studio locale 建 key + `domainT` helper + 回退；artifact titles 用现有 id 上 locale（78 个 en/zh，机械工作）。跑通「key 命中出中文、删掉 key 回退英文」两条测试。
2. **第 2 批｜decisions（37）**：固定 26 个先上；11 个 per-type 复用 `PRODUCT_TYPE_DESCRIPTORS` 派生 key。
3. **第 3 批｜baselinePlan（15）**：provider 资源按 `provider.<vendor>.*` 建 key。
4. **第 4 批｜manualActions（37）**：shared 19 + provider 18。
5. 每批都配「locale 表每个 key 在 en/zh 都能解析」的测试（沿用 `agent-copy.test.ts` 已立的纪律），并保留英文 prose 契约测试（保护 MCP 桥）。

## 7. 风险与未决

- **key 是长期契约**：一旦 MCP 桥之外出现第二个外部消费方，key 不能随意改名。缓解：key 用语义命名（`decision.applicationBaseline.title`）而非英文原文，测试锁 key 集合。
- **平行字段漂移**：prose 与 key 可能改一个忘一个。缓解：blueprint 内部用「key → 英文模板」一张表派生两者，而不是两处手写（与 `CONFIRMATIONS` 单一事实源同一原则）。
- **params 插值格式**：Studio 现有 `t()` 的占位语法要与后端 params 对齐（`{name}` 形式），落地第 1 批时定死。
- **不改变既有结论**：`ebe7ec4` 修的「决策卡不看 productType」是内容错误，已独立修完，与本 i18n 决策无关；本方案落地后两张卡下发的英文 prose 结构不变，只是多了 key。

## 8. 需要你拍板的点

1. 是否采用**方案 ②**（推荐）而非 ①/③；
2. 是否同意 per-type 文案按 **provider 维度**建 key（不按类型笛卡尔积）；
3. 是否按 §6 的四批顺序落地，第 1 批先做最小的 dryRun + 78 个 artifact title。
