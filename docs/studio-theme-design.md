# Agent-Dev Studio 双主题设计方案

> 状态：已实施（提交 `90696d4`，`apps/studio/src/theme/` + CSS token 双主题）
> 日期：2026-08-23
> 范围：仅 Agent-Dev 产品本身（`apps/studio/` 前端视觉）；功能、文案、导航标签、API、生成产物一律不动

## 1. 背景与目标

Agent-Dev Studio 是产品的本地交付控制面板（Blueprint → Feature Task → Quality Gate → Runtime → 验收 → Preview → 生产发布全链路）。当前视觉是「纯工具质感」：米白底 `#f6f7f3` + 深绿 `#286b43`，全站白卡片边框，信息密度高、层级节奏弱，品牌与 favicon 脱节。

目标：在不触碰任何功能的前提下，为 Studio 引入 **双主题（深色/浅色）可切换** 的 token 化视觉系统，统一品牌、提升层级与舒适度。

## 2. 范围边界（硬约束）

- **只改** `apps/studio/` 前端视觉（HTML/CSS 结构、样式、主题切换机制）。
- **不改**：功能逻辑、按钮文字、导航标签文案、API 契约、`handoff.md` 等审计/交接文档、`.agent-dev/apply/.../revision-*/` 下生成的 Runtime Run Report / DELIVERY_REPORT 等产物。
- 状态徽章统一为「色点 + 文字层级」，**不用**带边框/背景的 tag 样式。
- 错误/通知提醒统一为 **toast** 形式。
- 图标按钮足够大（建议 40px+），移动端保持原生适配（非缩放缩略版）。
- 导航标签与既有文案逐字一致（如「工作台」不改成「仪表盘」）。

## 3. 设计哲学

### 3.1 Token 三层架构

| 层 | 是什么 | 是否感知主题 |
|---|---|---|
| 组件层 | `Button / Card / Badge` 引用 `var(--accent)` 等语义 token | 否 |
| 语义层 | `--accent / --surface / --line / --text-1 / --status-*` 角色名 | 角色稳定 |
| 原始值层 | `light` / `dark` 两套具体色值 | **主题切换只发生在这一层** |

### 3.2 核心原则

1. **单一事实来源**：每个色值在代码中只出现一次（token 定义处）。组件不写 `#2E7D4F`，只写 `var(--accent)`。
2. **语义优先**：组件知道的是角色（accent=主强调、surface=卡片底），不是具体色值；角色不变，值可换。
3. **组件不感知主题**：切换 `data-theme` 只替换原始值层，语义 token 名与组件代码零改动。
4. **跨主题语义收敛**：状态色（通过/运行/失败/待处理）语义两主题一致；具体色相允许微调（深色下绿对比度不足，通过态改用 cyan）。

## 4. 主题机制

- 根元素挂 `data-theme="light" | "dark"`，`<style>` 内 `:root` 定义浅色原始值、`:root[data-theme="dark"]` 定义深色原始值，组件统一消费 `var(--*)`。
- 页面顶部（或侧边栏）放主题切换按钮（浅色 ⇄ 深色）。
- 偏好存 `localStorage`（key 建议 `agent-dev.studio.theme`）。
- **默认主题：深色**（用户已确认）。
- **防闪烁（FOUC）**：`<head>` 内联一小段脚本尽早读取 `localStorage` 并设置 `data-theme`，避免刷新时先闪默认主题。

## 5. 双主题 Token 定义（定稿）

### 5.1 浅色主题 · Warm Green（暖米白 + 翠绿）

| Token | 值 | 角色 |
|---|---|---|
| `--bg` | `#FAF8F3` | 画布基底（暖米白） |
| `--surface` | `#FDFCF8` | 卡片/面板（比 bg 稍白，柔和阴影分层，从暖米白底上微微浮起） |
| `--surface-muted` | `#F5F2EC` | 禁用/只读/嵌套表面（比 surface 略暖） |
| `--line` | `#E4DDD0` | 边框（暖沙色，保证白卡上可见） |
| `--text-1` | `#25312B` | 主文字（深暖墨） |
| `--text-2` | `#5C6B61` | 次文字 |
| `--text-3` | `#8A958C` | 弱文字/占位 |
| `--brand` | `#0891B2` | 品牌桥：logo 相关色，用于 logo mark、选中导航、焦点环、链接 hover |
| `--accent` | `#2F9D5C` | 主强调（翠绿，比初版提亮，避免沉闷） |
| `--accent-2` | `#3FA565` | hover/高亮 |
| `--accent-3` | `#C9A227` | 仅限 warning 标签、图表次要系列，不滥用 |
| `--status-ok` | `#4BBF6A` | 通过（两主题统一绿系；比按钮更亮，避免与可点击按钮混淆） |
| `--status-run` | `#D97706` | 运行中（琥珀） |
| `--status-fail` | `#D9534F` | 失败（暖珊瑚） |
| `--status-pending` | `#8A958C` | 待处理 |
| `--shadow-sm` | `0 1px 2px rgba(37,49,43,0.06)` | 浅层阴影 |
| `--shadow-md` | `0 4px 6px rgba(37,49,43,0.10)` | 卡片阴影 |
| `--shadow-lg` | `0 10px 16px rgba(37,49,43,0.16)` | 弹层/抽屉阴影 |

### 5.2 深色主题 · Graphite（石墨蓝灰 + logo 青蓝系）

| Token | 值 | 角色 |
|---|---|---|
| `--bg` | `#12161F` | 画布基底（石墨蓝灰，非纯黑） |
| `--surface` | `#1A212E` | 卡片/面板 |
| `--surface-muted` | `#1C2430` | 禁用/只读/嵌套表面 |
| `--elevated` | `#232C3C` | 悬浮/弹层 |
| `--line` | `#2E3A4E` | 边框 |
| `--text-1` | `#E9EDF2` | 主文字 |
| `--text-2` | `#A8B3C0` | 次文字 |
| `--text-3` | `#7A8695` | 弱文字/占位 |
| `--brand` | `#22D3EE`（cyan） | 品牌桥：logo 亮端，用于 logo mark、选中导航、焦点环、链接 hover |
| `--accent` | `#0EA5E9`（sky-cyan） | 主强调（比 `--brand` 更沉，降低刺眼感） |
| `--accent-2` | `#818CF8`（indigo） | 次级强调（logo 中段） |
| `--accent-3` | `#C084FC`（violet） | 强调尾；仅限 warning 标签、图表次要系列，不滥用 |
| `--status-ok` | `#4ADE80` | 通过（两主题统一绿系，深色底上高对比） |
| `--status-run` | `#F5A623` | 运行中（琥珀，与浅色同色相明度适配） |
| `--status-fail` | `#E86A4F` | 失败 |
| `--status-pending` | `#7A8695` | 待处理 |
| `--shadow-sm` | `0 1px 2px rgba(0,0,0,0.30)` | 浅层阴影 |
| `--shadow-md` | `0 4px 6px rgba(0,0,0,0.45)` | 卡片阴影 |
| `--shadow-lg` | `0 10px 16px rgba(0,0,0,0.60)` | 弹层/抽屉阴影 |

### 5.3 状态色（两主题共用语义）

| 状态 | 浅色色点 | 深色色点 | 语义 |
|---|---|---|---|
| passed / verified | 绿 `#4BBF6A` | 绿 `#4ADE80` | 通过（两主题统一绿系；状态文字用 `--text-1`，只让色点带色） |
| running | 琥珀 `#D97706` | 琥珀 `#F5A623` | 运行中（同一琥珀家族，明度适配深色底；建议呼吸动画） |
| failed / blocked | 珊瑚 `#D9534F` | 珊瑚 `#E86A4F` | 失败 |
| pending / missing | 灰 `#8A958C` | 灰 `#7A8695` | 待处理 |

## 6. 字体

- 正文/UI：Inter（现有，保留）。
- 代码/URL/命令/commit/产物路径：`ui-monospace` 等宽字体，与 CLI 及 favicon 的 `</>` 呼应；关键值可高亮。

## 7. 品牌

- **Logo**：保留现有 mark（深海军蓝 + cyan/indigo 渐变齿轮 `</>`），不做替换。
- **Favicon**：
  - 深色主题下 navy 渐变会融入 `#12161F` 底，加一圈 **1px `#7A8695`** 描边保证可辨识。
  - 浅色主题下 cyan 渐变在 `#FAF8F3` 底上可见，可保持无描边；如觉轻浮可加 **1px `#E4DDD0`** 极细阴影/描边。
  - 推荐做一个固定描边版本通吃两主题：1px `#7A8695` 描边在浅色底上偏灰、深色底上刚好，统一维护成本最低。
- 界面色板不照抄 logo 冷色渐变：深色主题用青蓝系呼应 logo，浅色主题用暖绿系保证舒适；`--brand` 在两主题中都是 cyan 方向，作为品牌桥梁贯穿 logo mark、选中导航、焦点环、链接 hover。

## 8. Studio 改造清单

1. `styles.css` 全站硬编码色值 → 语义 token（先全局扫描 hex/rgba，含内联 style、JS 动态状态色、SVG、图表系列色）。
2. 根元素 `data-theme` + 主题切换按钮 + `localStorage` 记忆 + `<head>` 内联防闪烁脚本。
3. 设置 `color-scheme: light / dark`，保证 `input/select/滚动条/checkbox` 等原生控件跟随主题；同时对所有原生表单元素显式设置 `background: var(--surface)`、`color: var(--text-1)`、`border-color: var(--line)`，覆盖系统控件默认色。
4. 项目表格：行 hover 高亮；状态徽章改「色点 + 文字」；状态文字统一用 `--text-1`，只让色点承载状态色。
5. 面板容器：浅色用柔和阴影分层，深色用 `--surface` + 弱描边。
6. Blueprint/Feature Task 的产物路径、commit、URL → 等宽字体 + 高亮。
7. 步骤流程 step-dot → 与「Pipeline 节点 + 连线」隐喻呼应。
8. 错误/通知 → toast。
9. icon-button 放大（40px+）。
10. 移动端侧边栏收窄为图标栏，两主题下均正常。
11. 导航标签、按钮文案、功能逻辑一律不动。

## 9. 实施注意事项（易翻车点）

1. **扫描范围**：硬编码颜色不止 `styles.css`，必须覆盖内联 `style`、JS 动态设置色、图表库系列色、SVG、favicon。
2. **`color-scheme`**：只改背景不设 `color-scheme`，原生表单控件会显示系统白/黑，深色主题下「白一块」。
3. **FOUC**：主题读取须在渲染前（`<head>` 内联脚本），否则刷新闪默认主题。
4. **对比度**：深色 `--status-ok #22D3EE` 作为文字色偏暗，badge 文字用更亮青或加粗；所有 hover/focus 环、文字压在状态色上的场景都要双主题验对比度。
5. **过渡动画**：不要给全部颜色加 `transition: all`，切主题会闪/卡；如加，只过渡背景与文字色，控制在 120ms 内。
6. **状态色语义**：running/failed/pending 两主题尽量同色相；`--status-ok` 的浅绿/深 cyan 是**有意微调**，需在文档中留痕避免被误改回。

## 10. 验收清单

- [ ] 深色、浅色两种主题下，全部面板（工作台/Blueprint/Feature Task/Runtime/验收/Preview/发布）截图对比，功能、文案、导航标签逐字未变。
- [ ] 原生表单控件（input/select/checkbox/滚动条）两主题颜色正确。
- [ ] 刷新页面无主题闪烁；切换后刷新记忆正确。
- [ ] 状态色两主题语义可读，对比度达标（badge、hover、focus）。
- [ ] favicon 深色下可辨识（浅描边生效）。
- [ ] 移动端视口两主题布局正常（侧边栏收窄、图标按钮可点）。
- [ ] `npm run check` + `npm run lint` + 既有前端测试全绿。

## 11. 决策记录

### 已确认（用户拍板）

| 决策 | 结论 |
|---|---|
| 改造范围 | 只改 Agent-Dev 产品本身（Studio 前端），不动产物/文档/API |
| 默认主题 | 深色（Graphite） |
| favicon/logo | 深色下加一圈浅描边，logo 保留现有 mark |

### 设计取舍（本方案确定，落地时遵循）

| 取舍 | 理由 |
|---|---|
| 浅色用暖绿而非 logo 冷色 | 冷色偏凉、久看不舒服；暖米白+翠绿最舒服且与现有 UI 接近 |
| 深色用青蓝系 | 与 logo 渐变统一，具开发者工具气质 |
| `--status-ok` 统一为绿系 | 两主题色相一致，避免用户切主题后状态语义混乱；深色用更亮的绿保证对比度 |
