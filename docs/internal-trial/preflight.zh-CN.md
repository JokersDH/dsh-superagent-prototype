# 包选择与只读预检

## 选哪个包

只使用发布清单中带准确 tuple 的包：`tar SHA-256`、`bytes`、`buildId`、`productSchema`、`source commit`、`provider platform/arch/abi`。当前本机可测的组合是 `darwin/arm64 + Node 24.21.x + SQLite ABI 137`；其他组合只应标记为“未测量”，不能靠“版本接近”推断兼容。

不要：

- 用目录名或文件名当作 build/source 身份；
- 把旧 tar 的报告贴到新包；
- 用当前 checkout 的文件补包内缺失项；
- 在包外执行 `pnpm install` 来“修好”缺依赖。

## 输入形式

二选一：

- `--tar <file>`：冻结 tar.gz，预检用平台 `tar` 列出成员，再展开到 `<out>/extract` 校验，默认删除；
- `--install <dir>`：已经展开的安装目录，预检只读遍历，不写该目录。

两种形式都会核对 `install.json`（`pa-install/1`）与 `var/config/release.json`（`pa-release/1`）。包内 `install.json` 不列自身，这是唯一允许的未声明文件。

## 报告怎么读

| 结果 | 含义 | 下一步 |
| --- | --- | --- |
| `OK` | 所有可观测检查 PASS | 仍需包内 doctor/readiness 与 E 的独立断言 |
| `DEGRADED` | 完整性通过，但有未测量/未绑定的维度（如 SQLite 版本、平台差异、未提供 `--artifact`） | 看 `unknowns`，不要当成失败或通过 |
| `REFUSED` | 完整性、输入或期望 tuple 不匹配 | 修复输入；不要改断言绕过 |

关键检查 id：

- `install_manifest_format` / `release_manifest_format`：结构化格式与必填身份；
- `file_digests` / `symlink_closure` / `unlisted_entries`：闭包字节与链接；
- `closure_digest` / `artifact_manifest` / `expected_tuple`：与发布摘要绑定；
- `release_artifacts` / `console_stamp`：包内 release 记录与 console 构建戳一致；
- `external_dependencies` / `workspace_packages`：依赖版本、license、workspace 包名；
- `host_platform` / `host_node` / `host_abi`：只报告，不把未测量判为兼容；
- `input_immutability`：检查结束后输入未变。

## 常见拒绝

| 现象 | 原因 |
| --- | --- |
| `archive_listing` FAIL | 截断 tar、绝对路径成员、`..` 成员、重复成员、超长路径 |
| `file_digests` FAIL | 记录摘要与实际文件不符，或文件缺失 |
| `unlisted_entries` FAIL | 包内有 manifest 未声明的文件 |
| `symlink_closure` FAIL | 链接目标与记录不符、悬空或指到包外 |
| `artifact_manifest` / `expected_tuple` FAIL | 与发布 tar/closure/build/schema/source 不一致 |
| `external_dependencies` FAIL | 依赖目录缺失、版本不符、license 缺失 |
| `output_exists` | 输出根已存在；换一个新目录，不要覆盖历史材料 |

## wave-26 补充

- 预检/机器检查一旦 `REFUSED`，不会执行包内任何命令；不要用“bin/pa 存在”推断可执行。
- Node 版本支持只按包内声明的有界比较器判定；`^`/`~` 等未支持语法显示 `UNKNOWN`，`>=23 <24` 不会对 24.21 判通过。
- token 文件必须是普通 0600、单链接、当前用户所有；symlink/hardlink/FIFO/替换全部拒绝。

## 边界

预检不安装依赖、不迁移数据库、不打开 state、不启动进程，也不读取 home 凭据。它不能证明跨机器可用，也不能证明包能运行；后者由包内 doctor、readiness 和实际入口负责。
