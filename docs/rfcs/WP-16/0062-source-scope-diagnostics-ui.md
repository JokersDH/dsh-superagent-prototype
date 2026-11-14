# 0062：冻结来源范围说明与只读审阅帮助

2026-11-14。本轮主线将已存在的 `context/sources?scopeReview=1` 接入真实 React 来源面板，并窄接 D 的 CLI 帮助修复。后端授权、持久状态与默认 query 不变。

## 用户行为

用户打开原消息来源或选择使用记录时，仍只请求默认冻结正文。明确点击“查看范围说明”才发一次 opt-in 只读 GET；无需提供 scope、principal、grant 或 project override。可刷新说明，原文重新读取与范围说明分别有加载和失败状态。

面板按真实 `verified`、`scope_changed`、`missing`、`unverified` 显示冻结正文状态。诊断最多七个去重原因，正数遮蔽数量单列；未知 readable 数量、原始允许/排除路径、principal、token、authorization 不显示。`scope_changed`、缺失或未核对状态不显示正文；解释不变成执行许可。

诊断网络错误、错消息/项目/会话身份或可选能力缺失，不用错误结果覆盖已读取正文。合法新响应的真实状态仍决定正文显示。组件按项目/会话/消息/请求/冻结摘要重挂载，序号与卸载清理拒绝旧响应。范围按钮保持键盘焦点，状态通过原生按钮语义与 polite 结果区域表达，不做新弹窗或卡片。

## 实现

- `apps/console/src/transport.ts`：可选 `{ scopeReview: true }`，仅此精确值添加 query，原10秒deadline/公共schema/消息身份继续生效。
- `ContextSources.tsx` 与 `context.css`：沿现有精密工作台的平面分区、固定字号和状态色；保留主对话/历史列表，范围原因按需展开。
- D `27675c46` 的 `apps/launcher/bin/pa.mjs` 最小帮助片段：全局 `--help`/`-h`、`help review-restored`、命令 `--help`，原所有执行动作不变。

## 验证

传输4/4与console strict通过，实际HTTP/SQLite/React/Playwright首轮12/12通过，desktop1440×900和mobile390×844截图无溢出或重叠，浏览器错误0，读取新增mock provider请求0。独立狭窄review无实质问题；随后补延迟响应切记录及焦点断言，最终结果见本轮integration报告。mock provider只供种子数据，真实vendor/native/model0。

CLI帮助窄测试通过，全部帮助命令退出0、不创建private roots或调用执行器。console生产构建通过。首次截图/报告保留，最终确认另存，不把dirty测试报告贴成clean source。

## 边界

不合入尚未准入的A新manifest、B新业务通道、Cpackage driver或Dlive清理工具，不编辑E独立断言。没有迁移、source确认/私有许可、target、自动接受或新Driver。十二用户服务与全部state/profile/tar/ledger未重启/迁移；旧包缺晚UI是时间范围。运行字节改变后由D准确freeze、E独立验新包，不能贴a9b旧结果。
