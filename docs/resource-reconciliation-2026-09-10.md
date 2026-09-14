# 资源清单 × Provider 控制台一致性核对（2026-09-10）

> 核对目的：handoff §8-3 遗留「资源清单外部 ID/URL 与 Provider 控制台一致性逐项核对」。
> 核对方式：数据库 `project-resources.json`（4 个 DELIVERED 项目的 apply workspace）与真实控制台只读查询比对（`gh api` / `vercel project ls|inspect` / `wrangler pages project list`），无任何写操作。
> 范围：GitHub / Vercel / Cloudflare 三家的**已交付资源**与**遗留资源**；Supabase 为 manual 降级（resources 恒空，设计如此）。

## 一、核心交付资源——全部存在 ✅

| 项目 | 类型 | GitHub 仓库 | Vercel 生产 API | Cloudflare 生产页面 |
| --- | --- | --- | --- | --- |
| Receipt Test | web-saas | `bayernjf/receipt-test`（PRIVATE）✅ | `receipt-test-api` ✅ | `receipt-test-web` ✅（页面 200） |
| Workspace Verify Fresh | web-saas | `bayernjf/workspace-verify-fresh`（PRIVATE）✅ | `workspace-verify-fresh-api` ✅ | `workspace-verify-fresh-web` ✅（页面 200） |
| Link Vault | web-saas | `bayernjf/link-vault`（PRIVATE）✅ | `link-vault-api` ✅ | `link-vault-web` ✅（页面 200） |
| MCP Word Tools | api-tool | `bayernjf/mcp-word-tools`（PRIVATE）✅ | （该类型不供给） | （该类型不供给） |

4 个 GitHub 仓库全部存在、均 PRIVATE、URL 与清单逐字一致。Cloudflare 三个生产页面本机直连 200。
**Vercel 生产 API 存活未能在本机复验**：`*.vercel.app` 直连被网络重置（handoff 记录的环境问题），当前 shell 与 `~/.agent-dev/env` 均无代理配置；控制台确认三个 `-api` 项目均存在且有 Latest Production URL（Updated 17–18 天前）。

## 二、清单字段与控制台实际的项目名差异 ⚠️

资源清单里 `vercel.projectName` / `cloudflare.projectName` 记录的是**apply 阶段创建/使用的裸项目名**，与最终生产交付项目名（`<name>-api` / `<name>-web`）不一致：

| 项目 | 清单记录（Vercel/CF） | Vercel 控制台 | Cloudflare 控制台 |
| --- | --- | --- | --- |
| Receipt Test | `receipt-test` | `receipt-test` 存在，但**仅有 1 次失败部署（Error）**；生产是 `receipt-test-api` | `receipt-test` 存在（hash 域名 `receipt-test-92p.pages.dev`）；生产是 `receipt-test-web` |
| Workspace Verify Fresh | `workspace-verify-fresh` | **不存在**；生产是 `workspace-verify-fresh-api` | **不存在**；生产是 `workspace-verify-fresh-web` |
| Link Vault | `link-vault` | `link-vault` 存在，但**仅有 1 次失败部署（Error）**；生产是 `link-vault-api` | `link-vault` 存在（hash 域名 `link-vault-2wc.pages.dev`）；生产是 `link-vault-web` |

性质判断：
- 裸名项目（`receipt-test` / `link-vault`）为**早期失败的部署尝试遗留**（Vercel 侧部署状态 Error），非生产交付物，清单未记录其失败性质；
- `workspace-verify-fresh` 裸名在两家控制台均不存在——该项目的 apply 从未以裸名建过项目（Preview 阶段即用 `-preview` 后缀命名）；
- 影响：清单的 `projectName` 字段不能作为「生产项目名」消费；生产项目名应以 `<name>-api` / `<name>-web` 为准。是否需要修正清单字段语义（改为记录生产名）待定，不影响交付事实。

## 三、Preview 遗留资源——8 个全部确认存在（handoff §8-7 待清理）🧹

| Provider | 资源 | 判定 |
| --- | --- | --- |
| Vercel | `receipt-test-api-pr-1` | ✅ 存在（18d） |
| Vercel | `workspace-verify-fresh-api-pr-1` | ✅ 存在（18d） |
| Vercel | `link-vault-api-pr-1` | ✅ 存在（17d） |
| Vercel | `workspace-verify-fresh-api-preview` | ✅ 存在（27d，早期 Dual Preview 遗留） |
| Cloudflare | `receipt-test-web-pr-1` | ✅ 存在 |
| Cloudflare | `workspace-verify-fresh-web-pr-1` | ✅ 存在 |
| Cloudflare | `link-vault-web-pr-1` | ✅ 存在 |
| Cloudflare | `workspace-verify-fresh-web-preview` | ✅ 存在（早期 Dual Preview 遗留） |

清理入口：`POST .../preview/cleanup`（确认串 `CLEANUP_PREVIEW`）。生产项目（`-api` / `-web` 无后缀）是交付物，**不清理**。

## 四、额外发现：废弃裸名项目（清单未记录，非生产交付物）

| Provider | 项目 | 状态 |
| --- | --- | --- |
| Vercel | `receipt-test` | 存在，唯一部署 Error（废弃） |
| Vercel | `link-vault` | 存在，唯一部署 Error（废弃） |
| Cloudflare | `receipt-test` | 存在（hash 域名，无自定义域） |
| Cloudflare | `link-vault` | 存在（hash 域名，无自定义域） |

这些不属于 handoff 明确的清理清单；是否一并清理需用户拍板（Vercel 侧需 `vercel project rm`，Cloudflare 侧需 `wrangler pages project delete`，均为删除操作）。

## 五、Supabase ✅

三个 web-saas 项目 `supabase.resources` 均为空——符合「Supabase 走 Manual 降级路径、不做自动化」的设计，无差异。

## 六、核对结论

1. **交付事实成立**：4 个项目的真实交付资源（仓库 + 生产 API + 生产页面）在控制台全部存在，无丢失、无错配。
2. **清单字段语义偏差**：`projectName` 记录的是 apply 阶段裸名，与生产项目名（`-api`/`-web`）不一致；`workspace-verify-fresh` 裸名在控制台不存在。建议后续把清单改为记录生产项目名，或明确字段语义为「apply 阶段项目名」。
3. **待清理资源确认**：8 个 Preview 遗留资源全部在账号中，可随时走 `preview/cleanup` 清理；另有 4 个废弃裸名项目需用户确认是否一并删除。

## 附：核对命令（全部只读）

```bash
gh repo view bayernjf/<name> --json name,visibility,url
vercel project ls / vercel project inspect <name> / vercel ls <name>
wrangler pages project list
```
