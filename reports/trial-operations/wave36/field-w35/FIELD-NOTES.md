# 同事试用现场包

生成时间：2026-11-17T03:39:48.768Z
包：install  build=599de3e98c02de0b  schema=18
tar sha256：unknown
machinecheck：DEGRADED（exit 1），PASS=42 WARN=0 UNKNOWN=5 FAIL=0

## 一页清单
1. 只使用显式 tar/install 与自己的新根；不要在旧用户实例上安装、停止或迁移。
2. 先看 machinecheck 的 refuse/unknown；完整性 REFUSED 时不执行包内命令。
3. 包内 status/doctor/readiness 是观察，不是安装/执行/授权结论。
4. 遇到问题保留整个新输出根；不要删除 UNKNOWN 资源或修改用户数据库。
5. 分享 support-summary.json、machinecheck-report.json、diagnostics-bundle.json 和实际命令 exit；不要分享 token、正文或私有 DB。

## 已知问题 / 决策树
...
- [info] host_sqlite_unknown: preflight cannot execute the native SQLite binding; the package doctor verifies it at runtime → run package doctor in a private root and keep the exit/check list
- [info] unknown:expected_tuple: Pass --expect-sha256/--expect-schema/--expect-build/--expect-source to bind this report to a published tuple → inspect the raw machinecheck report
- [info] unknown:artifact_manifest: Pass --artifact <install-artifact.json> to bind the published tar/closure digests → inspect the raw machinecheck report
- [info] readiness_no_package_identity: readiness reports configuration facts, not a package identity → bind the report to the tar/build/source tuple manually
- [info] support_not_supplied: pa support opens a database with write pragmas and is not run automatically → run it yourself on a copy and pass --support
- [warn] doctor_warn:executor_codex: unexpected package doctor warning → inspect the doctor check detail
- [info] instance_stopped: no managed instance is running in this private root → this is expected for a fresh trial root; do not start without an explicit own target

## 未达分层
- installed: exact tar preflight + package help/status/doctor in private roots
- source: current I/B source consumer, in-process only
- fixture: readiness fixture (not a package daemon)
- recovery: NOT_REACHED in this kit
- native: NOT_MEASURED

