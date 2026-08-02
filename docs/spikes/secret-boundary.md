# Secret Boundary Spike 记录

> 日期：2026-08-02
> 状态：已通过（macOS 本地边界）
> 实验代码：[`spikes/secret-boundary`](../../spikes/secret-boundary/)

## 1. 目标

验证 Agent-Dev 能统一管理环境变量契约，同时避免成为生产 Secret 数据库。首版必须把“变量定义与引用”和“变量真实值”分开。

## 2. 首版边界

```text
Blueprint / Env Contract
  -> variable name, scope, target, required, secretRef

SQLite
  -> keychain:// reference only

System Keychain / target provider
  -> actual secret value

Provider child process
  -> receives only the secret needed for one operation

Coding Agent
  -> receives no provider or production secret
```

## 3. 验收标准

1. 临时 Keychain 能写入并重新读取随机 Secret；
2. SQLite 只保存结构化引用，数据库字节不包含 Secret；
3. Provider fixture 能使用按需解析的 Secret；
4. Coding Agent fixture 看不到 Provider Token 和 Database URL；
5. 敏感名称或包含已知 Secret 的伪装值即使进入请求白名单，也被二次规则拒绝；
6. 结构化日志对已知值和常见 Token 形态脱敏；
7. 实验不读取或修改用户默认 Keychain。

## 4. 生产设计约束

- 浏览器公开变量不进入 Keychain，但必须明确标记 `public`；
- 开发 Secret 可用系统 Keychain，由 Provider 执行时短暂解析；
- 生产 Secret 优先直接保存在 Vercel、Cloudflare、Supabase 或 GitHub Environments；
- 平台间同步使用单向、最小范围复制，不建立一个可导出全部明文的中央 Vault；
- Agent Runtime 环境由显式白名单创建，不继承父进程全部环境；
- Prompt、事件、错误、Evidence 和 Delivery Report 使用同一个 Redaction 层；
- 无法自动授权时生成 Manual Action，不要求用户把 Secret 粘贴给 Agent。

## 5. 未覆盖

- GitHub OIDC 与短期云凭据；
- Vercel、Cloudflare、Supabase 的真实 OAuth scope；
- Keychain 锁定、访问控制弹窗和多用户会话；
- Windows Credential Manager 与 Linux Secret Service；
- Secret rotation、revoke 和 drift reconciliation。

## 6. 实测结果

Probe 在 `agent-dev` 的忽略目录内创建独立临时 Keychain 和 SQLite 数据库，完成后自动删除。实际结果：

```text
temporary isolated keychain -> verified
SQLite stored value          -> keychain://agent-dev/cloudflare/dev
Provider received secret     -> true
Agent sensitive env names    -> []
Database contains secret     -> false
Log redaction                -> verified
```

macOS 会向子进程自动加入无敏感值的 `__CF_USER_TEXT_ENCODING`；Agent-Dev 允许该系统变量，但仍通过敏感名称拒绝规则和显式 allowlist 控制其余环境。

结论：首版可以采用“Env Contract + SQLite 引用 + 系统 Keychain/目标平台明文 + 单次 Provider 注入 + Agent 环境白名单”。生产实现必须把这里的规则提取为共享库，并为 Windows/Linux 提供等价 Adapter 或 Manual Action。
