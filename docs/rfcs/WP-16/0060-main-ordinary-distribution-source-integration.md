# 0060：主线接入普通个人发行源码

2026-11-13，接入 D 固定源码 `a9b155c13be197d828544a26f4827cf9d4acab68` 的完整运行模块，保持 main 的 HTTP、UI、共享契约和根配置所有权。

## 实际范围

- `apps/launcher/` 的 bin、lib、package、文档和测试；实际 `pa` 命令提供启动、状态、诊断、备份、恢复、安装切换及显式只读审阅。
- `packages/portability/` 的完整 source、export、配置和测试。使用现有 A storage 备份端口，不增加 SQL 迁移或生产 writer。
- `tools/distribution/build.mjs`、`stage.mjs`、`freeze-install.mjs` 与 README；构建静态 console、运行时 workspace、外部依赖及当前 Node/SQLite ABI 的发行闭包。
- root 添加 `pnpm pa`、`pnpm build:distribution`、`pnpm check:distribution`，原 `pnpm start` 保持。离线安装仅新增两个 workspace importer，不更换外部依赖版本。

原 D 的历史报告、recipe 与所有 live installation/probe 脚本均不随源码接入。新 same-store 工具异常清理与验证边界仍需 D 修复。D 的旧 closure manifest 有一处 probe 哈希过时，主线按上述固定 Git tree 的实际字节接入，后续记录逐文件哈希，不能以旧 manifest 代替当前源码身份。

## 验证与限制

portability strict/build 通过；portability 52/52、launcher 60/60 通过。完整15个运行包、静态HTTP console、8个外部依赖的构建与stage自校验通过，输出904个release artifact；初次在未提交工作区构建，诚实记录 source.dirty=true，不是干净发布产物。测试使用私有临时目录、临时本机监听及自己出生的受控子进程，不操作十二组用户服务。实际 `pa help` 成功；`pa --help` 仍按未知命令退出3，帮助列表未列 `review-restored`，由 D 后续改善。

该结果是主线完整发行源码集成，不是新冻结安装包、E 最终独立准入、跨机器兼容或原生恢复的证明。E 本轮准确595普通安装实测与 D 后继a9b安装包分开；主线源码变化后应由 D 冻结准确新字节，再交 E 独立验。

只读审阅/来源诊断不授执行权。业务 attach、私有启动许可及目标激活仍各自未准入；普通安装不等待这些流程或 BLOCKED 价值试点。vendor/native/model0，十二旧服务与全部数据、profile、tar、账本保持。
