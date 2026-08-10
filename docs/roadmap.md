# Agent-Dev 产品路线图

> 日期：2026-08-02  
> 原则：以验证门槛决定扩张，不以功能数量或时间承诺代替产品证据。

## 阶段 0：设计与 Spike

目标：消除会改变 v0.1 架构的关键不确定性。

交付：

- 产品宪法、PRD、Blueprint Schema 和技术架构；
- Codex Runtime 官方接入 Spike；
- Cloudflare Pages + Vercel API 联合 Preview Spike；
- Supabase Auth Redirect/CORS Spike；
- SQLite 状态机暂停恢复 Spike；
- Secret 边界和最小权限清单。

退出条件：五个 Spike 均有可运行原型或明确的 Manual Action 降级方案。

## v0.1：Local Web SaaS Golden Path

预计开发周期：8–10 周，实际以完成条件为准。

范围：

- Local Blueprint Studio；
- React/Vite + Hono + Supabase 固定模板；
- Cloudflare Pages 页面托管；
- Vercel Functions API 托管；
- GitHub、PR、Actions、联合 Preview；
- Local Codex Runtime；
- Env Contract、Dry Run、人工 Gate、Evidence 和 Delivery Report。

退出条件：连续三个真实项目完成产品基线和至少一个真实功能交付，且没有明文 Secret 泄漏或绕过门禁的路径。

## v0.2：外部 Pilot

目标：验证非作者用户能否独立完成流程。

候选范围：

- 导入现有仓库；
- Local Claude Runtime；
- Agent Runtime Catalog、内置 Agent Discovery 和自定义 Agent 最小配置（阶段 A API 已提前落地，Studio 选择器与持久化仍属于 v0.2）；
- GA4、Clarity接入与隐私 Gate；
- Infisical Adapter；
- 更完善的失败分类和修复建议；
- Blueprint 分享和升级提示；
- macOS 安装、诊断和自动更新。

退出条件：十名外部用户中至少七名完成首次交付，至少五名完成第二次交付；确认愿意连接平台和愿意付费的用户比例。

## v0.5：托管控制面

目标：让用户跨设备查看项目，并为团队和新手体验建立基础。

候选范围：

- 用户账号、组织和云端项目面板；
- Local Runner 注册、心跳和加密事件同步；
- 托管 Blueprint、运行状态和 Evidence；
- 团队协作、Approval、审计和通知；
- Secret Backend 集成；
- Adapter 能力目录和版本兼容；
- 订阅和基础用量计量。

退出条件：本地 Runner 断开、恢复和跨设备审批可靠；团队权限和 Secret 威胁模型通过独立评审。

## v1.0：新手托管模式

目标：用户不安装 Agent CLI、不配置模型 API Key，也可以完成第一条 Golden Path。

候选范围：

- 托管 Agent Runtime；
- 隔离的远程代码 Sandbox；
- 默认模型路由、预算和停止条件；
- 模板化账号连接向导；
- 新手只回答产品、隐私、费用和发布问题；
- 运行额度、滥用防护和故障支持。

退出条件：托管模式在安全、成本和完成率上优于人工辅助本地安装；模型成本不会吞噬可接受毛利。

## v1.x：多产品 Blueprint

多产品扩展不是一次性增加模板市场，而是按真实交付证据逐步增加 Product Type。先完成 Web SaaS 闭环，再依次验证落地页、浏览器插件、桌面端和移动端。每种类型都必须独立定义构建、质量、Preview/分发、权限、商店人工步骤和交付证据；不同产品只共享治理层，不强行共享源码结构。

详细的共享层、类型层、候选技术栈和退出条件见 [多产品类型交付方案](multi-product-delivery-plan.md)。

## 长期平台

- 开放 Blueprint、Module、Runtime 和 Provider Adapter 规范；
- 社区模块及经过验证的 Golden Path 市场；
- 多 Agent 能力路由，而非绑定单一模型；
- 依赖、Secret、CI、埋点和环境漂移的持续维护；
- 工作室的多客户项目治理；
- 企业私有 Runner、合规、审计和自定义 Policy；
- 基于匿名失败分类改进修复策略，明确数据授权和隐私边界。

## 路线图约束

以下信号出现前不进入下一阶段：

- 用户只生成项目但没有交付第二个功能；
- 仍需要作者频繁手工修复账号和环境；
- 自动化没有显著减少配置步骤或返工；
- 用户不愿授权平台连接；
- Secret、生产权限和回滚边界尚不可信；
- 当前 Golden Path 尚不能通过版本升级持续维护。

产品扩张的优先级是：完成率 > 可靠性 > 可恢复性 > 易用性 > 覆盖范围。
