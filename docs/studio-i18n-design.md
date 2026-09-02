# Agent-Dev Studio i18n 设计方案（中文/英文）

> 状态：已实施（提交 `90696d4`，`apps/studio/src/i18n/`，默认英文）
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

### 6.1 枚举驱动的 key 必须由类型保证覆盖（2026-08-26 补充）

用 `t(\`前缀.${某个枚举值}\`)` 拼出来的 key 是 i18n 的高危区：字典漏一个成员，界面就把原始 key 显示给用户。此类缺陷已经发生两次（缺陷 20、27），且第一次的修法（改成显式 key 映射表）没有治住根。规则：

- **枚举来源要收紧到真实联合类型**，不要停在 `string`。例：`Project.state` 由 `string` 改为 `@agent-dev/workflow` 的 `DeliveryState`。
- **字典用 `satisfies Record<该联合类型, string>` 声明**，漏成员即编译失败。
- **禁止用 `as KeyPath` 断言把拼出来的 key 塞进 `t()`**——那正是把缺失藏到运行时的手段。类型对了断言自然不需要。
- **不要写"查不到就兜底"的代码**：`t()` 查不到时返回 key 本身，永远不是 `undefined`，所以 `t(k) ?? fallback` 是死代码，只会让人误以为有保护。

判据：删掉字典里任一枚举成员，`npm run typecheck` 必须报错（已实测：会在字典、译文、调用点同时报三处）。

### 6.2 算出来的 key 还要把 params 钉住（2026-09-02 补充）

6.1 管的是"key 存不存在"，typecheck 能治。但当调用点是 `t(notes.key, notes.params)`——key 和 params 都由一个函数算出来——还有第二种坏法，typecheck 完全看不见：key 存在、类型正确、句子通顺，只是它里面没有那个 `{var}`，于是用户看到裸露的 `{providers}`。占位符只是字符串里的字符，字典的 `string` 类型对它一无所知。规则：

- **占位集合与 params 键集合必须双向对上**，并且**在两本字典上都断言**（`test/key-resolution.ts` 的 `dictionaries` + `resolveKey`）。zh 漏一个占位符与 en 漏一个同样致命，只测 en 等于没测。
- **候选 key 的交换要单独钉**。两份文案都是合法句子，把 A 情形指向 B 的 key 在界面上看不出语法问题，只有一张按枚举逐个写死的期望表能发现。因此"这两句话语义不重叠"那类只读字典本身的用例**不能替代**期望表——它结构上就看不见交换。
- **不要用手写 `replace` 绕开 `t()` 的插值**，那会把占位符契约挪到断言之外的地方。
- 这类断言属于源码证据测试，仍要遵守 `test/source-evidence.ts` 的注释剥离规则（该模块的收敛理由记录在 [交接文档](../handoff.md)）。

判据（2026-09-02 实测，两次种植后均已回滚，Studio 12 文件 / 81 用例恢复全绿）：

1. 删掉 `en.ts` 中 `baselineNoteCloud` 的 `{providers}` → 两条用例红，且都点名 `en / blueprint.baselineNoteCloud`（"占位对不上" + "两句话语义不重叠"）。
2. 在 `baselineNoteFor` 里交换两个候选 key → "期望表" 与 "占位对不上" 两条红；而"两句话语义不重叠"那条**仍然绿**。这正是上一条规则要求保留期望表的证据。

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
- [ ] 由代码算出的 key，其 `params` 与**两本**字典里的 `{var}` 集合逐一对上；删掉任一占位符或交换任一候选 key 都会让测试红（见 6.2）。
- [ ] 枚举拼接出来的 key 全部由 `satisfies Record<联合类型, string>` 覆盖；删掉任一成员会编译失败（见 6.1）。
- [ ] 语言切换与主题切换并存互不干扰（同一侧边栏/顶部区域）。
- [ ] `npm run typecheck` + `npm run build` 通过。

## 9. 与双主题改造的关系

- 两项改造正交，但都动同一 `App.tsx` 与 `styles.css`。
- **先 i18n 后主题**：i18n 改动面更广（全文件文案抽取），先完成语言层；主题改造随后只关注样式 token，互不干扰、验收面清晰。
- 双主题方案见 [studio-theme-design.md](studio-theme-design.md)。
