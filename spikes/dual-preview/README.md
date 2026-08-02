# Dual Preview Spike

这个 Spike 验证 Vercel API Preview URL 能按确定顺序注入 Cloudflare Pages Preview，并用精确 CORS 和联合 smoke 形成真实 Evidence。

## 本地验证

```bash
node spikes/dual-preview/local-validate.mjs
```

## Dry Run 计划

```bash
node spikes/dual-preview/probe.mjs --run-id 20260802a
```

默认只输出资源名、步骤和清理范围，不写云端。真实运行必须显式增加 `--apply`，并在运行前获得用户对专用临时项目的批准。

## 真实执行

```bash
node spikes/dual-preview/probe.mjs --apply --run-id 20260802a
```

真实执行会创建一个 Vercel 项目和一个 Cloudflare Pages 项目，完成 API、精确 CORS、URL 注入和联合 smoke 后删除两者。若清理失败，Probe 以失败退出并打印唯一待清理的项目名。

运行 Evidence 写入被 Git 忽略的 `output/`，不包含 Token、账号身份或组织信息。
