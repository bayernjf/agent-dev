# Agent-Dev Studio i18n 设计方案（中文/英文）

> 状态：已定稿，待实施（与双主题改造同批推进）
> 日期：2026-08-23
> 范围：仅 `apps/studio/` 前端 UI 文案；默认语言英文；技术术语保留英文

## 1. 背景与目标

Agent-Dev Studio 是产品的本地交付控制面板。当前 [App.tsx](../../apps/studio/src/App.tsx) 为 1519 行单文件，全部 UI 文案硬编码为英文（按钮、标题、placeholder、hint、状态文案），无 i18n 依赖，`index.html` 固定 `lang="en"`。

目标：为 Studio 引入 **英文/中文双语可切换**，默认英文；不触碰任何功能与数据结构。

## 2. 范围边界（硬约束）

- **只改** `apps/studio/` 前端：新增 i18n 基础设施、抽取文案、替换 JSX 中的硬编码字符串。
- **不改**：功能逻辑、API 契约、数据结构、`handoff.md` 等文档、`.agent-dev/apply/.../revision-*/` 下的生成产物。
- **不翻译**（数据与产物，非 UI 文案）：
  - 后端/API 返回的数据：activity 历史、Quality Gate 输出、Runtime 输出、报告内容、git 证据、commit 信息；
  - 文件名、URL、命令、代码、用户输入内容。
  - 理由：翻译会失真且有审计风险。

## 3. 已确认决策（用户拍板）

| 决策 | 结论 |
|---|---|
| 实现方式 | 轻量自建（React Context + 两语言字典），零依赖 |
| 默认语言 | 英文（`en`） |
| 术语策略 | 技术术语保留英文原文（Blueprint / Preview / Quality Gate / Runtime / Provider / Revision / Baseline 等），仅翻译功能性文案 |
| 实施顺序 | **先 i18n 后主题**（见第 9 节） |

## 4. 架构

```
apps/studio/src/i18n/
  i18n.tsx         # I18nProvider / useI18n() / t(key) / 切换函数
  locales/en.ts    # 英文字典（默认）
  locales/zh.ts    # 中文字典
```

- `main.tsx` 用 `I18nProvider` 包 `App`。
- `App.tsx` 硬编码文案 → `t('区域.组件.文案')`。
- 语言切换 UI 放侧边栏/顶部，与主题切换按钮相邻。
- `localStorage` key：`agent-dev.studio.locale`，默认 `en`。
- 切换时同步 `<html lang>` 与 `document.title`。

## 5. 文案抽取与 key 命名

- key 命名：`区域.组件.文案`（如 `project.create.title`、`button.approve`、`sidebar.workbench`）。
- 覆盖范围：按钮、标题、placeholder、hint、label、状态文案、aria-label、UI 层错误提示。
- 可翻译常量表字段：如 `PROVIDER_FIELDS` 的 `label` / `hint` / `tutorial` 文案。
- 提取后校验：全文件不再残留 UI 中文字段，也不残留应翻译的英文 UI 文案（抽检）。

## 6. 动态文案

- 模板插值：`t('project.summary', { name })` 支持 `{var}` 占位。
- 日期/时间：`formatDate` 已用 `Intl.DateTimeFormat(undefined, ...)`，locale 随当前语言。

## 7. 实施步骤

1. 建 i18n 基础设施（`i18n.tsx` + `locales/en.ts` + `locales/zh.ts`）。
2. 从 `App.tsx` 抽取英文文案 → `en.ts`（先保真迁移，不改变任何现有显示）。
3. 编写 `zh.ts` 中文翻译（功能性文案；术语保留英文）。
4. 替换 JSX 硬编码字符串为 `t(...)`，含可翻译常量表字段。
5. 语言切换 UI + `localStorage` 记忆 + `<html lang>` / `document.title` 同步。
6. 校验：`npm run typecheck`、`npm run build` 通过；切中文全面板无遗漏硬编码。

## 8. 验收清单

- [ ] 默认英文；切中文后全部功能性文案翻译、无遗漏硬编码（抽检 JSX 残留）。
- [ ] 刷新后语言记忆正确；`<html lang>` 随语言更新。
- [ ] 技术术语（Blueprint / Preview / Quality Gate / Runtime / Provider 等）保持英文原文。
- [ ] 数据/产物类文本（活动历史、gate 输出、runtime 输出、报告、commit 证据）未被误翻译。
- [ ] 动态插值（`{var}`）在两种语言下均正常渲染。
- [ ] 语言切换与主题切换并存互不干扰（同一侧边栏/顶部区域）。
- [ ] `npm run typecheck` + `npm run build` 通过。

## 9. 与双主题改造的关系

- 两项改造正交，但都动同一 `App.tsx` 与 `styles.css`。
- **先 i18n 后主题**：i18n 改动面更广（全文件文案抽取），先完成语言层；主题改造随后只关注样式 token，互不干扰、验收面清晰。
- 双主题方案见 [studio-theme-design.md](studio-theme-design.md)。
