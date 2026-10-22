# 组合级发布 Runbook（T-M5-03）

> **用途**：照本操作即可独立完成一次服务发布（Blueprint→Preview→Production），中断可恢复。
> **适用**：commerce-os、loom 及后续接入 agent-dev 发布流的服务。
> **首版**：2026-10-23。配套：`Tier0-外部依赖清单.md`、`@agent-dev/deployment-composer`。
>
> **铁律**：
> 1. 生产只从**已记录仓库的生产分支**发布，绝不从本地工作区直接上生产。
> 2. 任何外部凭据/通道不可用，**fail-closed**，不猜、不拿桩冒充。
> 3. 每一步都要留下**观测证据**（实际 URL/HTTP 状态/命令退出码），不写"应该通过"。

## 0. 角色与决策门

| 阶段 | 决策门 | 谁能放行 |
|---|---|---|
| Preview | 自动化质量门 + 健康检查 | 操作者（可自助） |
| Production | 外部/不可逆动作，按 zeus 分级 | owner（D2 同步审批 / D3 人工主导） |

## 1. 发布前检查（全部满足才开工）

- [ ] 工作区干净：`git status` 无未提交改动；当前分支为待发布特性分支。
- [ ] 全量测试通过：
  - commerce-os：`npm test`（基线 61 用例）
  - loom：`cd backend && .venv/bin/pytest tests/unit tests/integration`（基线 1481 用例）
- [ ] 类型检查/构建通过：`npm run typecheck`（TS 仓）；`ruff check && mypy`（loom）。
- [ ] 凭据就绪（对照外部依赖清单）：
      GitHub `gh auth status` 已登录；真实部署所需 Vercel/Cloudflare/云凭据已配置（未配置则只走 Preview/fake，Production 标记阻塞）。
- [ ] 迁移已在目标库验证；无未应用的待执行迁移。
- [ ] 幂等键已规划；同键重试不会产生重复资源。

## 2. 阶段一 · Blueprint（定义期望状态）

1. 为服务确定发布定义：`ServiceReleaseDefinition`（projectId、owner、deployProvider）。
   - commerce-os：`deployProvider=vercel`（Node）；loom：`deployProvider=cloud`（Python，需云主机）。
2. 生成期望资源：`releaseResourceSpecs(def)` → 源码仓库 + preview + production 资源。
3. 复核：每个资源的 owner/kind 正确；无多余资源。

## 3. 阶段二 · Preview（不触生产）

1. 提交特性分支；如走 GitHub Preview，先确认分支已 push（**push 由 owner 决定**）。
2. 运行 Preview 编排（DeploymentComposer）：
   - 部署 preview API → 验证 API 健康（记录 URL/HTTP 状态/Content-Type）
   - 注入 API URL → 构建前端（如有）→ 部署 preview 站点
   - 校验 CORS（记录期望 Origin 与实际响应头）
   - 联合冒烟（API + 站点同时通过）
3. 无外部凭据时：用 `FakeProviderRegistry` 走相同 plan→apply→verify 流程，验证流程可复现；
   **不得**把 fake 结果当作真实部署证据。
4. Preview 通过标准：所有步骤 `completed`，健康检查与冒烟均成功，证据写齐。
5. Preview 失败：停止，不进入生产；按第 7 节回滚 preview 资源。

## 4. 阶段三 · Production

1. 确认发布来源：`ReleaseSource`（仓库、生产分支、已验收 commit）。
2. 发起生产决策（ReleaseComposer）：外部/不可逆动作由 zeus 分级；
   - D0 自动；D1 异步审批；D2 同步审批；D3 人工主导。
   - 决策被挂起（awaiting_approval）时，动作保持 parked，等待审批。
3. 审批通过后，按生产分支 checkout → 安装依赖 → 质量门 → 部署 API → 验证生产健康
   → 构建前端 → 部署前端 → 生产冒烟 → 写证据。
4. 生产通过标准：生产 URL 健康检查 200、CORS 正确、端到端冒烟通过。
5. 任一步失败：**立即停止**，按第 7 节回滚，并记录时间线。

## 5. 证据清单（每次发布归档）

- 发布定义与期望资源（Blueprint）。
- 各 provider 的 plan 结果（create/update/noop 及原因）。
- 审批记录（决策 ID、审批人、时间、结论）。
- 健康检查：URL、HTTP 状态、Content-Type、CORS 响应头。
- 冒烟结果（Preview 与 Production 各一份）。
- 最终资源状态：外部产品/内容/部署 ID、生产 URL。
- 发布时间线（开始、各步骤完成、结束）。

## 6. 中断与恢复

- 发布为幂等设计：中断后重新运行编排，已完成的步骤（noop）跳过，从断点继续。
- 恢复前先核对：`plan` 结果与已落资源一致，避免重复创建。
- 审批中断：决策保持挂起，审批后从该步骤 resume，不回滚已完成步骤。

## 7. 回滚手册

| 场景 | 回滚动作 |
|---|---|
| Preview 失败 | 调 `cleanupPreviewProjects` 清理临时 preview 资源；删除临时分支（如已建） |
| 生产前端部署失败 | 回退到上一稳定版本（重新部署上一 release 的前端产物） |
| 生产 API 部署失败/健康异常 | 流量切回上一 release；保留现场日志；标记本次 release 失败 |
| 数据/迁移异常 | 停止发布，按备份恢复 runbook 从发布前备份恢复（见 T-M6-02） |
| 外部凭据/通道中途失效 | fail-closed，停止后续步骤，登记阻塞到外部依赖清单 |

回滚后必须：验证回滚目标健康正常，记录回滚原因与影响范围，再决定是否重新发布。

## 8. 发布后

- [ ] 生产环境持续观察（错误率/503/进程退出）。
- [ ] 更新各仓 handoff 与组合复盘（T-M5-05）。
- [ ] 外部依赖清单状态如有变更，立即更新。
- [ ] 遗留项明确 owner / 期限。
