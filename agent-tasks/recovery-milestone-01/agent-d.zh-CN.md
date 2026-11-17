# D：固定 W36 安装交付与准确来源

目录 `/Users/hh/Desktop/joker/superagent-agent-d`，分支 `codex/g3-local-distribution`；本轮已验输入 `652b6835b22e9c1b2b79793670d4cea534e0d1fb`。
先读[共同里程碑](README.zh-CN.md)、AGENTS/START-HERE/product-spec/README和[验收](../../reports/releases/wave37-admission/README.zh-CN.md)。保留dirty后fetch/merge origin/main，固定实际consumer source。原owned/excluded路径仍以[原表](../product-wave-36/dispatch.json)为准。

你负责把已有固定 W36 安装 cohort 完整交给 E 并持续修复交付问题，先完成这一个 cohort，不追移动 main。W35 原 upgrade 已真实 CONFIRMED，旧 BLOCKED 保留，不重派已修项。

固定 source087a598e5b6f357bd2cc40556cbf693257febc66/build14a6b457ea285988；inner SHA13798190ae43b28628eaf7131dfb8192bdb786b9bcfe4e1e0b6f9217ab33a8af，outer SHA43e06d5bc7606e8283c1c5f58463f402018d4c9c9b223a2c7c021d429ccb8995。完整路径见本入口 README。

先纠正 selected source audit 的5个陈旧记录：App.tsx、evidence.css、transport.ts、http/app.ts、product/runtime.ts。全部从固定 git087 重算，保留旧报告与 selected 标签，不改包、不重签同一字节。

向 E 提供现有 outer/inner/manifest/ABI/schema/原已安装 history HTTP200 证据及准确操作说明，协助它独立验证实际 App 点击、非空重开和当前包启停/升级子集。借用父目录/UNKNOWN 资源不得删除，原 spawn 记录/实际 entry 与包清单一起核对。

只有固定包的产品运行字节确需修复，或 main 后续明确选定恢复集成版本时，才提交明确后继 freeze；先交差异/subject 再给 E，docs/tests 不触发重包。独立队列为此包已知兼容/恢复/诊断缺陷，无 desktop/新平台。

完成出口：5个来源记录准确，固定 W36 可由 E 重复消费并形成准确 verdict；未测 native/当前新 source 不借此准入。

早交可运行source及必要source闭包后，连续支持本里程碑集成、修复、复验和上述独立队列，不逐fix等待、不把SOURCE_READY当整包完成。状态写原owned报告目录的 `recovery-milestone-01-status.json`，列commit/base/实际命令exit/原IDs/层次/剩余项。只显式owned路径提交到原origin分支；外部依赖只阻对应项，不改他人候选。

自动vendor/model/native和真实信号均0；Bcap4UNKNOWN不可花，原E试点本阶段不推进，材料/ledger不变。十二用户实例及state/profile/tar/历史保留；不新Driver/CAC/desktop/自动接受/第二生命周期，不global discovery、借凭据或绕stop拒绝清理。无工时/当天deadline/新token预算；无需用重复测试填执行时间。
