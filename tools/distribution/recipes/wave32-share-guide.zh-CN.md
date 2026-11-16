# Wave-32 完整工程发行包（macOS Apple Silicon）

## 准确身份
- 外层 ZIP：`pa-artifacts/wave32-preview-88eb8c6/PersonalAgent-Preview-88eb8c6.zip`
- ZIP SHA256：`0a46cd3620e00154ea13e7286dcc73e40ffad4df4522f2339e229ffcb027bc06`；63,475,809 B
- 内层 tar SHA256：`65c386d108d385c1e8463de33b801a1865925d5dd752a7b82a0c57974b8453ac`；20,543,106 B；6,866 manifest items
- build `88eb8c69b0671171`；build checkout `e8348a864d7d192589e72b8099475520f841b1e5`；runtime main `58b4e4c8`（含 terminal lease/guide 修复）
- schema18 / Node24.21.0 / ABI137 / darwin-arm64 / SQLite3.53.4；unsigned, not notarized

## 同事最短流程
1. 核对 ZIP SHA，然后解压到固定目录；保留 `runtime/`、`install/`，运行时不要移动。
2. 双击 `Start.command`。首次会创建本版本私有根：
   `~/Library/Application Support/PersonalAgent/Preview-88eb8c69b0671171/`
   无执行器时显式降级为仅对话；不回退固定 fixture。
3. `Settings.command` 打开私有 `config/model.json`；没有 key 也能先看工作台。分享包不含作者 key/session/state。
4. `Stop.command` 由原 `pa` 核对并停止本包实例；UNKNOWN/BLOCKED 保留现场。
5. 终端状态/诊断：
   `./runtime/bin/node personal-preview-launcher.mjs status`
   `./runtime/bin/node personal-preview-launcher.mjs doctor`
   注：`status` 在 STOPPED 时可能返回 2，这是“未运行”状态码，不是异常删除。

## 已实测（隔离 HOME，新目录，作者 checkout 不是运行依赖）
- 外层静态验证：`VERIFIED_STATIC`，7,434 archive entries，内层 6,866 items。
- Start.command → RUNNING，health `personal/local-development`；Stop.command → STOPPED + recordRemoved。
- 安装包实际 UI：window+export 13/13（2 downloads/6 export reads/POST0）、J6/6（2 accepts）、F8/8。
- 非空备份：`pa backup --json --out <private-file>` → CREATED；`pa restore --json --bundle ... --to <new-private-root>` → RESTORED，schema18/integrity ok。
- R2→W32 managed upgrade/rollback：7/7，含 pre-upgrade backup、binary switch、target doctor/status/journal、binary rollback no data loss。
- portable5、noexec4、support 0600。

## 还原/升级命令（在包内私有根上下文）
外层 launcher 管理配置/数据根；需要直接 CLI 时使用同一组五个 `PA_*` 根，不借其他实例 state。恢复是只读历史，不继承 native 认证、旧 session/grant/queue 执行权。

## 分享与数据
只分享原始 ZIP；不要带上 `~/Library/Application Support/PersonalAgent/Preview-*`。升级/rollback 不覆盖旧 tar/旧 state；新包与旧包根隔离。ZIP 未签名，组织安全策略不应被绕过。

## 未达
- E 尚未对该外层 ZIP/新内层独立 required verdict；D 自测不是 release admission。
- 真实 vendor/model/native=0；真实 native 开发控制、跨机、长期运行、签名/公证、private/target/value、CAC 未测/不含。
