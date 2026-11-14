# 迁移前只读预检

本工具只做**兼容性、磁盘、路径与备份身份**的只读观察。实际迁移、安装、升级、停止、切换由 D/main 已准入入口执行；本手册不会给出自动修库、清 marker、force switch 或复制凭据的步骤。

## 可以预检什么

1. **目标包身份**：用 `trial-preflight` 核对 tar/closure/build/schema/source 与发布 tuple；
2. **平台与 ABI**：`host_platform`、`host_node`、`host_abi`；不满足时只报 `WARN`，不能“近似兼容”；
3. **磁盘与路径**：`disk_space`（解压大小 ×1.2 + 64 MiB 余量）、`path_lengths`（成员路径长度）；
4. **依赖闭包**：`external_dependencies`、`workspace_packages`；不在包外安装依赖；
5. **备份身份**：备份/恢复产物应使用其自身的结构化 manifest（`pa-backup/1`、personal evidence 等）与摘要核对；不要把复制目录当作在线备份，也不要在复制已静止输入后外推 WAL/SHM 行为；
6. **不可迁移/不可继承的材料**：凭据、旧 native session、旧授权、旧队列/恢复 marker 一律保留在原处，不随包复制。

## 可以预检但**不能**代表迁移成功

- 包能解压、能通过预检，不等于目标库可迁移；
- `schema` 元数据一致不等于数据语义兼容；
- 本机检查不等于跨机器可用；
- 预览/只读启动通过不等于 writer 静止或新授权成立。

## 明确禁止

- 不要用本工具迁移、复制或删除 `state.sqlite`、`-wal`、`-shm`；
- 不要删除或改写恢复 marker、队列、instance 记录；
- 不要复制 `~/.codex`、token、密钥或旧 native session；
- 不要为提高通过率而放宽 expected tuple、schema 或断言。

## 推荐顺序

```text
1. trial-preflight（包身份/闭包/平台/磁盘）
2. trial-machinecheck（包内 doctor + 可选 readiness）
3. 由 D/main 已准入入口执行实际安装/升级/迁移
4. 迁移后重新观察 readiness 与 doctor；仍只作为配置事实
5. 把原始材料与命令/exit 一起交给验收人
```

如果第 1/2 步出现 `REFUSED`，不要进入第 3 步；如果只有 `UNKNOWN`，把它作为限制写进交接材料，而不是当作通过。
