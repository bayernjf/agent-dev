# 对外 MCP 桥接（agent-dev mcp）

> 创建时间：2026-08-29
> 状态：已实现（`apps/cli`），21 个工具，stdio 传输
> 前置依赖：daemon HTTP API（`agent-dev start`，默认 `http://127.0.0.1:3737`）

## 1. 定位

把已有的 daemon API 桥接成一个 stdio MCP server，让外部 agent 客户端（Claude Desktop、Cursor、Qoder 等）能查询项目与交付中间态、创建项目、修订 Blueprint、定义 Feature Task、预览 Apply 产物、提交验收，并申请生产发布。

桥接层不落自己的业务规则：daemon 是唯一事实源，MCP 工具一一对应 daemon 路由。唯一由桥接层持有的东西是发布确认字面量 `REQUEST_RELEASE`——它写在 `apps/cli/src/mcp.ts` 里，因此调用方（包括驱动它的模型）无法伪造、改写或省略。`create_feature_task` 还会自行读取当前 Blueprint revision 后再投递，避免调用方维护版本号。

## 2. 启动与客户端配置

可执行入口是 `apps/cli/bin/agent-dev.mjs`（带 shebang，内部注册 tsx 直接跑 TS 源码，仓库全仓 noEmit，无构建产物）。

```json
{
  "mcpServers": {
    "agent-dev": {
      "command": "node",
      "args": ["C:/000mycodes/agent-dev/apps/cli/bin/agent-dev.mjs", "mcp"],
      "env": { "AGENT_DEV_DAEMON_URL": "http://127.0.0.1:3737" }
    }
  }
}
```

若仓库 node_modules 已安装，也可用 `npm run mcp`（根目录），或在 PATH 中放置 `agent-dev` 后直接 `command: "agent-dev"`。`AGENT_DEV_DAEMON_URL` 缺省即 `http://127.0.0.1:3737`；daemon 未启动时工具返回明确提示而不是挂起（30 秒超时）。

## 3. 工具清单

**环境与资源（不依赖项目）**

| 工具 | 性质 | 说明 |
| --- | --- | --- |
| `agent_dev_doctor` | 只读 | 本地环境与连接器就绪度 |
| `agent_dev_get_runtime` | 只读 | 运行时目录 + 自定义 runtime profile（合并两个 daemon 路由） |
| `agent_dev_get_connectors` | 只读·外网 | 连接器预检 + 云账号发现（合并两个路由；会查外部云账号） |
| `agent_dev_get_credentials_meta` | 只读 | 凭证元数据：哪些 key 已设置、更新时间；**永不返回密钥值** |
| `agent_dev_check_update` | 只读·外网 | 检查本仓库是否落后 Git 上游（只跑 `git fetch`，不更新） |

**项目与交付状态（只读）**

| 工具 | 说明 |
| --- | --- |
| `agent_dev_list_projects` | 项目及交付状态 |
| `agent_dev_get_project` | 单项目状态与当前 Blueprint |
| `agent_dev_get_apply` | 最近一次 Local Apply 运行 |
| `agent_dev_get_feature_task` | 当前 Feature Task |
| `agent_dev_get_quality_gate` | 最近一次 Quality Gate 结果 |
| `agent_dev_get_acceptance` | 当前验收提交 |
| `agent_dev_get_delivery_report` | 合并交付报告（Apply/任务/运行时/质量/验收/Git） |
| `agent_dev_get_baseline_plan` | 基线资源计划与审批状态 |
| `agent_dev_get_release` | 生产发布状态与证据 |
| `agent_dev_get_release_plan` | 发布计划步骤、幂等键与当前运行 |
| `agent_dev_dry_run` | Apply 产物清单（id/title/path/bytes）；传 `artifactId` 才回单文件全文 |

**推进（非只读，但均为本地记录，批准仍在 Studio）**

| 工具 | 说明 |
| --- | --- |
| `agent_dev_create_project` | 由名称 + Blueprint answers 建项目 |
| `agent_dev_revise_blueprint` | 生成下一版 Blueprint |
| `agent_dev_create_feature_task` | 定义 Feature Task（草稿态，批准人工） |
| `agent_dev_submit_acceptance` | 提交验收记录（批准人工） |
| `agent_dev_request_release` | 打开生产发布闸门，等待人工在 Studio 批准 |

`dry_run` 默认只回清单：daemon 的 dry-run 响应把每个产物的全文塞在 `plan.artifacts` 里，实测 4 种 productType 的 revision-1 计划为 9.6–17.8 KB，清单化后降到 3.7–6.1 KB（省 60–75%）；项目 revision 越高、文件越多，绝对节省越大。传 `artifactId`（清单里的 id 或 path）才返回单个文件全文。

`agent_dev_get_connectors` 与 `agent_dev_check_update` 的 `openWorldHint` 为 true，因为它们会访问外部世界（云账号 / Git 上游）；客户端可据此决定是否先征求用户同意。

daemon 调用超时预算 30 秒，超时报 `did not answer within 30000 ms` 而不是挂住连接；最慢的 `agent_dev_doctor` 实测约 9 秒（本机 8 个 CLI 探测 + 连接器预检）。

## 4. 刻意不暴露的能力

Baseline 审批、Feature Task 审批、Apply 执行、Preview 部署、Runtime 执行、验收批准、发布批准、凭证写入、自更新（`POST /api/update`）——全部不注册为 MCP 工具。这些是人工闸门或真实外部副作用，必须由人在 Studio 里按。

注意区分：`submit_acceptance` / `create_feature_task` 只是**提交记录**，批准（`acceptance/approve`、`feature-task/approve`）依然不暴露。凡是带 `approve` 的动作一律不在工具清单里。

闸门拦截时 daemon 返回 409，桥接层把它转成错误文本并附一句「到 Studio 继续」，绝不把拒绝包装成成功。Studio 目前是 SPA、无深链，所以不给伪造 URL。

## 5. 测试

`apps/cli/test/mcp.test.ts` 用真实 HTTP 监听 + 真实 daemon app + `InMemoryTransport` 跑完整链路：21 工具清单（断言不含 `approve`）、annotations、创建与读取、各中间态只读工具、dry_run 清单/单文件、409 引导文案（含 create_feature_task 与 submit_acceptance 的闸门）、daemon 不可达与超时提示。

