# 内部试用、迁移发行与 CAC 后置接入

日期：2026-11-10。优先级服从 [第三轮产品路线](product-wave-03.zh-CN.md)：先新 UI 和关键功能闭合，再准入内部本机试用，之后第二协议/CAC。本文是实施规划，不代表发行、跨平台或 CAC 已通过兼容验收。

## 当前边界

当前交付仍需要源码 checkout、pnpm、构建和 Vite；原生准入限定已测 macOS arm64 / Codex 0.164.0。安装状态、模型设置、项目、worktree 和恢复凭证分散在 checkout 与用户 home；运行依赖 Unix socket、`ps`/`lsof`、进程组及对应 Node ABI 的 SQLite addon。只有 SQLite 在线备份函数，不是完整产品备份。

因此第一步是每个内部同事在自己的机器运行自己的 daemon、项目和 agent 账号。不能把现有 loopback 服务改绑 `0.0.0.0` 就宣布多人部署完成；组织认证、ACL、租户/Runner 隔离和远程密钥边界都尚未实现。

## 三层产品结构

```text
浏览器工作台 / 未来桌面 renderer
              |
       同一份 typed HTTP/SSE
              |
    本机 coordinator + 产品状态
              |
  每 attempt 独立 Runner / Driver
              |
       用户自己的 agent 认证
```

未来桌面 host bridge 只提供文件选择、打开工作区、系统通知和安全凭据存储等白名单能力。业务命令、问题和完成 gate 留在现有应用层。网页先交付，UI 不以 Electron/Tauri 全局对象为前提。

## 本机发行阶段

1. **可搬运构建目录。** UI 构建为静态资源，与 daemon 同源服务；运行时不启动 Vite、不编译全仓。锁定受支持 Node、OS/arch 和 SQLite ABI，验证本机包；不复制当前 node_modules 宣称其它机器可用。
2. **稳定数据布局。** 定义统一的安装/config/data/cache/log/workspace 根，支持显式参数覆盖；默认数据在 checkout 外。Mac 可采用 Application Support、Caches、Logs 标准目录，具体产品目录名在发行 RFC 冻结。项目仍由用户选择，缓存授权与工作区归属分开。
3. **可进入的首次设置。** 缺 agent/认证/兼容版本时仍可进入设置、查询历史和诊断，执行保持 disabled；不跳过 native admission、不强制改全局版本。配置保存后不回显 key，不复制开发者账号或共享认证 home。
4. **普通同事的启停。** 启动/复用/停止/doctor 针对选定实例和真实进程身份；端口冲突可解释，不结束陌生进程。升级失败回到已验证的旧发行与快照，卸载不默认删除用户数据。
5. **独立安装验收。** E 在新目录、可用新账户按说明安装、配置、导入项目、交付、备份恢复和升级回滚。没有其它机器或账户时只报告新目录 fixture 范围。

D 负责发行和迁移实现，A 提供一致存储 port，主线接公共设置/诊断与生产组合，E 独立验证。D 可以先做工具和负例，内部试用准入仍等待 UI 与 P0 功能稳定。

## 完整备份与恢复

建议版本化 bundle 包含一致 DB 快照、引用 artifact/patch/check evidence 的摘要清单、必要非秘密配置、格式/应用/平台版本和显式项目路径映射。工作区/项目内容是单独选择，不默认打包用户全部仓库；账号 home、native session dump、密钥、运行 socket/PID、缓存/node_modules 默认排除。

A 的 snapshot port 需固定引用产物集合和一致性边界，D 复制后逐项校验；仅 integrity_check(DB) 通过不足以恢复交付。复制期间的写入/GC、丢失产物、IO 中断、超额/恶意 archive、链接和路径穿越均要有负例。D 不直写 SQL 或再开一个生产 writer。

恢复先落到新的私有目录并验证，不能覆盖活跃 state。旧机器的 PID/inode/socket、签名环境 receipt、native connection epoch 和账号都不能靠替换字符串迁移成新权限；旧运行状态进入历史/待核对范围，不 replay begin/deliver/answer。项目路径明确重新绑定，新环境/版本/policy 重新准入。内容寻址的历史 patch 与证据保持原身份，失败恢复可以回退。

## 桌面壳选型

| 方案 | 适用理由 | 必须验证 |
| --- | --- | --- |
| Electron + 普通 Node daemon sidecar | 与现有 TypeScript/React 和本机 Node 进程逻辑接近，保守首选候选 | renderer 禁 Node integration、context isolation、IPC 白名单、签名/更新，以及 SQLite 留在标准 Node ABI 的 sidecar |
| Tauri + Node sidecar | 可比较安装体积和原生 host 能力 | 增加 Rust/sidecar 分发复杂度；不能因此忽略 Node/SQLite/Runner 平台依赖 |
| 继续网页 + 本机 daemon | 最快形成可用内部试用版 | first-run、静态发行、系统集成与浏览器生命周期的清楚边界 |

先完成第三行的可靠发行与内部验收，再据真实需求冻结桌面框架。当前不为套壳重写业务。

## 远程多人部署

若后续需要集中控制面，应另立 ADR：组织身份/TLS、用户和项目权限、每人独立 Runner 及认证、机器登记/撤销、审计、资源隔离、网络路径与传输加密。远程控制面不能直接取得或复用全体用户的 native home；共享机器与共享账号不是同一项授权。

## CAC 接入配方

本机 CAC 路径为 `/Users/hh/Desktop/huawei/ade/cac`。本次仅核对可用文档/配置：有 ACP 包、SDK/HTTP/SSE、session prompt/abort 的候选接口，同时存在历史 contract/实现不一致记录。其仓库要求 codegraph，而本会话无该工具，因此不据文档推断当前源码已完整兼容；最新版 sub-team 仍需实际输入。

| 平台接口 | CAC 适配原则 | 准入证据 |
| --- | --- | --- |
| `inspect(profile, host)` | 固定可执行/协议版本、认证需要和真实能力 | 不把 help/schema/metadata 当模型工作通过 |
| policy/一次 begin | 优先专属进程的 ACP adapter；若发布形态是 HTTP+SSE，则连接自己明确拥有的 server/session | 生效设置、scope、版本、未知发送核对及一次业务启动 |
| 原生问题/答案 | 保留原 request/session/attempt/epoch/contract，逐请求上浮到现有问题中心 | 澄清/允许/拒绝/旧答案/重连的实际 roundtrip |
| stop/reconcile | 专属进程复用 owned-process 证明；共享 server session 按 `shared_service_session` 处理 | abort ACK/idle 不能冒充所有物理 writer 静止 |
| completion | CAC 报告只是候选提案，由平台冻结内容、跑检查并接受 | 实际代码、检查、完整 patch、候选失效和重开 |
| sub-team | 让 CAC 管理内部团队，平台维持一个主 Assignment 及来源清楚的子任务摘要/待决定 | 子团队请求不会越过父授权，跨 session 身份不可混用 |

先在后置 spike 用官方 ACP SDK/既有公开接口做受控协议验证，不手写新编排框架。第一个 CAC 版本先证明编码、真实问题、停止、断线、版本漂移和交付，再讨论跨 harness 细粒度团队；不能因已有 sub-team 概念就宣称异构协作完成。
