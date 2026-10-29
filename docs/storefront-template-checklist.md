# Storefront 独立站模板清单（M2 模板化）

> 对齐 `agent-world/docs/template-checklist.md` 的登记惯例（分类 / 模板 id / 名称 / 状态 /
> 真实运行记录 / 评估发现）。本表登记的是 **独立站站点模板**，与 agent-world 的产线工作流
> 模板（`tpl-*`）是两个不同域：agent-world 35 个业务/工作流模板不在本表范围内。

模板实现位于 `@agent-dev/blueprint`：结构 = `productType=storefront`，行业差异由
`spec.product.storefrontProfile` 配置化，商品/主题/文案由 `spec.storefrontConfig` 注入。
生成器 `buildStorefront()` 产出与 commerce-os `front/src` 同构的 Astro SSR + React 岛骨架。

## 对账

| 维度 | 数量 | 说明 |
|------|------|------|
| 已实现 storefront 站点模板 | 3 | retail / cross-border / subscription（一个 storefront 结构 × 3 剖面） |
| 本表登记模板 | 3 | 与实现一一对应，无遗漏、无多余 |
| agent-world `tpl-*` 工作流模板 | 35 | 另一域，未改动 |

## 模板明细

| 分类 | 模板 id | 名称 | 状态 | 真实运行记录 | 评估发现 |
|------|---------|------|------|--------------|----------|
| 品牌零售 | `storefront/retail` | 品牌零售独立站 | ✅ 门绿 | 物化 23 产物；`build.mjs`+`smoke.mjs` 通过；`vitest` 37 例含契约 | Astro SSR 骨架同构 commerce-os；SSR-only `COMMERCE_API_BASE_URL`；无自带后端/库 |
| 跨境电商 | `storefront/cross-border` | 跨境多币种展示站 | ✅ 门绿 | 物化后 `build`+`smoke` 通过；多币种切换器 + `SUPPORTED_CURRENCIES`/`convertPrice` 断言 | 价格按 SKU 原币种展示；汇率为占位，价格货币化待支付通道，不静默当真换算 |
| 订阅电商 | `storefront/subscription` | 订阅周期订单站 | ✅ 门绿 | 物化后 `build`+`smoke` 通过；订阅方案卡 + `SUBSCRIPTION_PLANS`/`isRecurringOrder` 断言 | 周期订单为占位语义（checkout 标记 recurring）；真实续费/退订/扣款待计费通道 |

## 验收口径

- **模板可生成同构站**：三个剖面均能 `generateArtifacts` 物化出完整页面集并通过生成门。
- **模板→Blueprint 契约**：见 `packages/blueprint/test/index.test.ts`「TF-04 contract」
  （Cafe Noir：结构 + theme/tagline/seedProducts 配置端到端反映到生成站）。
- **GATE-L1 真实公网上线**：见 `handoff.md` TF-05 条目——本地门已绿，真实部署因生产授权 /
  线上 commerce-os 后端 / v0.3 方向未拍板而暂未发生，未伪造访问证据。
