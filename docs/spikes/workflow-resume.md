# Workflow Resume Spike 记录

> 日期：2026-08-02
> 状态：已通过
> 实验代码：[`spikes/workflow-resume`](../../spikes/workflow-resume/)

## 1. 目标

验证 Agent-Dev 本地进程退出后，Delivery Run 能否从 SQLite 恢复 XState 快照，并继续同一个 Run，而不是创建新运行或丢失人工 Gate、失败状态和重试上下文。

## 2. 验证场景

### 人工 Gate

```text
implementing
-> verifying
-> awaitingApproval
-> process exit
-> new process restores awaitingApproval
-> releasing
-> delivered
```

### 失败恢复

```text
implementing
-> verifying
-> failed
-> process exit
-> new process restores failed
-> retryCount + 1
-> verifying
-> awaitingApproval
```

## 3. 数据约束

- `delivery_runs` 保存当前状态、XState persisted snapshot 和更新时间；
- `step_runs` 追加事件、迁移前状态、迁移后状态和时间；
- 更新快照和追加迁移记录位于同一 SQLite 事务；
- 恢复后沿用原 `run_id`；
- 人工 Gate 不会因进程重启自动批准；
- 失败恢复显式消费 `RETRY` 事件并增加计数。

## 4. 实现边界

本实验使用 XState 5 和系统 SQLite CLI，只用于验证状态语义。生产实现必须改用 Drizzle + 正式 SQLite 驱动，并增加：

- schema migration；
- step 幂等键与输入版本；
- worker lease/heartbeat；
- 并发写保护；
- crash recovery 分类；
- 最多两次自动修复策略；
- Evidence 与外部写操作收据。

## 5. 验收标准

1. 四个阶段分别在独立 Node 进程运行；
2. Gate 恢复前状态严格为 `awaitingApproval`；
3. 恢复不会隐式越过 Gate；
4. 失败恢复前状态严格为 `failed`；
5. 重试后 `retryCount` 为 1；
6. 最终 SQLite 历史包含恢复前后的完整迁移。

## 6. 实测结果

环境：

```text
Node.js v20.20.2
XState 5.32.5
SQLite 3.50.6
```

四个阶段均在独立 Node 进程中成功执行：

```text
gate-seed      -> awaitingApproval
gate-resume    -> delivered
failure-seed   -> failed
failure-resume -> awaitingApproval
```

人工 Gate 的历史连续包含 `PREVIEW_READY -> APPROVE -> RELEASE_SUCCEEDED`；失败路径连续包含 `VERIFICATION_FAILED -> RETRY -> PREVIEW_READY`。恢复后仍使用原 `run_id`，`retryCount` 为 1。

结论：XState persisted snapshot 可以作为 SQLite 中的可恢复状态载荷，人工 Gate 和失败步骤不会因本地进程重启而丢失。Phase A 可以继续采用 XState + SQLite，但在进入真实外部写操作前必须补齐 worker lease、幂等键和 crash recovery 测试。
