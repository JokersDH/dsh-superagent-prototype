# 第十九轮 Agent C：真实业务来源与个人只读消费者

2026-11-13，基线 `a8e1db5`（合并 `origin/main` `2208899`，main 双版本快照 `9856124`）。
C 只改 context/proposals/knowledge/routing；真实 vendor model/native 0；未写 SQL/HTTP/第二确认。

## 1. 把真实业务实体放进已过的快照链

`packages/knowledge/test/main-business-snapshot-chain.case.ts` 在同一个真实 `ProductStore` 上：

- 经 main 受控正常产品路径（Application → Effects → Broker → 受控 fixture executor）
  `create_work` 生成真实 Work/Ticket，Broker `user_questions` 产生真实问题；
  `answer_question` 后 delivery 变为 **`native_applied`**，候选被明确 accept，Work 进入 delivered；
- 第二个 Work 保持 pending question，供第二根只读审阅；
- 同一 Store 内保留已过的 SDK 候选确认 + selected-context frozen binding；
- 提问/回答以 anchored `trusted_user` 与 `question_answer_display` 形式存在，**不是**普通
  `reasoner_reply` 或普通对话文本；普通 context preview 明确不包含该显示文本。

## 2. 默认 v1 与显式 v2

- `create({destination})` 默认仍产出 `workflow-snapshot/1` + `workflow-evidence/1`，verify ok；
- `create({destination, formatVersion: 2})` 产出 `workflow-snapshot/2` + `workflow-evidence/2` +
  `familySetVersion: 2`（21 族），verify ok；
- `formatVersion: 3` 在创建目录前被拒绝，目录不出现；
- portability 的 personal-evidence 1/2 是另一协议，未在此混用。

## 3. 同一快照第二根只读 HTTP

用默认 v1 快照目录启动 `recovery_readonly` runtime + HTTP：

| 读/动作 | 结果 |
| --- | --- |
| `GET /v1/snapshot` | 200，恢复的 Work（含 pending 第二 Work）与 1 条 pending question |
| `GET /v1/works/:id` | 200，第一 Work 为 `delivered` |
| `GET /v1/questions/:id/deliveries` | 200，已答问题仍为 `native_applied` |
| `POST /v1/commands answer_question`（pending 问题） | 422，不写业务 |
| `create_work`、candidates prepare、proposals、context preview、旧 context token 重放 | 全部 422 |
| `product.start()` | 抛 `unsupported_capability` |
| 候选 payloadDigest / history entry / audit bundleDigest | 与正常根一致 |
| effect 行、Work 数、provider 调用 | 前后不变；0 次新模型调用 |
| source prepare/confirm | 200，`not_granted`/`startupAvailable:false`，target 不创建，audit 等于 confirm |

## 4. 敏感问答与模型复用

提问/回答不是普通消息流的一部分：它们要么带 work anchor，要么是 `question_answer_display`；
普通 context preview 不包含显示文本，第二根候选也只为普通用户消息提供候选。权限/认证问答因此
没有进入普通模型复用路径。source 事实确认不携带 private grant、native 或 target 权限。

## 5. 成本

- 每条回复 1 次本地伪 SDK 调用；第二根只读 0 次新调用；
- 快照各创建一次（v1、v2），第二根只读读取不启动 effects、不消费 held queue；
- 600 扫描边界/8 候选/长正文与 10000 历史证据沿用 wave-16/17/18，不重复跑。

## 6. 命令与结果

```
context 124 · proposals 41 · knowledge 98 · routing 44（全部 pass）
wave15 4/4 · wave14 6/6 · wave13 6/6 · wave12 8/8 · wave11 17/17
wave18 C-only wrapper 4/4（保留）
strict/exactOptional 全链 build 通过
```

## 7. NOT_REACHED / owner

- **个人历史项目只读重绑定**（restored-personal consent/principal/root）：main 尚未发布该入口；
  fixture `recovery_readonly` 不当作 personal，该项单列 NOT_REACHED。
- B 的业务 reconnect/崩溃恢复与真实 Runner 传输：B-owned，未在 C 内重建。
- 真实 vendor native：0；Broker 问答来自受控 fixture executor，不是厂商 native 兼容证据。
- source 确认后的私有许可/target 启动/native value：main-owned，未到。
- C 的 module-only 投影（relevance/projectSourceReview/collectContextHistory）仍非 main HTTP 调用。
