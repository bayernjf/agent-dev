# Workflow Resume Spike

这个 Spike 验证 Delivery Run 的 XState 持久化快照能否写入 SQLite，并在新的 Node 进程中恢复人工 Gate 或失败步骤。

## 运行

```bash
npm install
npm run probe
```

Probe 覆盖两条路径：

1. `awaitingApproval` 持久化后退出，在新进程恢复并继续到 `delivered`；
2. `failed` 持久化后退出，在新进程恢复、增加重试次数并回到验证流程。

每次状态迁移同时追加 `step_runs`，用于证明恢复前后的事件历史没有被新运行覆盖。临时 SQLite 文件位于忽略的 `tmp/`，Probe 结束时自动清理。

## Spike 边界

- 使用 XState 5 的 persisted snapshot；
- 使用系统 `sqlite3` CLI 减少实验依赖；
- 只验证单进程协调器在重启后的恢复语义；
- 不验证并发 worker、租约、崩溃事务恢复和数据库迁移。

生产实现仍使用 Drizzle 和正式 SQLite 驱动，不能直接复制本 Spike 的 SQL CLI 封装。
