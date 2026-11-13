# 第二十二轮 Agent C：可选Scope诊断、失效回执与同包参数化driver

2026-11-13，基线 merge `1d6eada`（`origin/main` `54d6e1b`，main 诊断 `712e191`；RFC 0058）。
C 只改 context/proposals/knowledge/routing；真实 vendor model/native 0；未写 SQL/HTTP writer/第二确认/LLM loop。
本包不再改 explainer 生产接口（main 已最小消费），而是**实际验证** opt-in 诊断、真实失效/回执，
并交付 D/E 可参数化的同包 driver 与 main 只读 UI 输入契约。

## 1. 实际 main 诊断（C1）

真实 personal 进程（`demo.ts --discussion-only --assistant --review-restored-scope`）读取：

| 请求 | 结果 |
| --- | --- |
| `GET /v1/messages/:id/context/sources` | 旧 shape，无 `scopeReview` 字段 |
| `?scopeReview=1` | 除 `scopeReview` 与 `observedAt` 外，与默认响应完全一致 |
| `scopeReview` | `protocol:'context-scope-review/1'`、去重 reasons、`partial`、`withheldSourceCount`、`authorization:'none'` |
| `?scopeReview=0` / 空值 / 重复 / `true` / `scopeReview=1&grant=foreign` | 400 |

诊断不包含 principal、可读计数或原始路径；`authorization` 恒为 `none`。原 state/正文释放仍由 main
guard 唯一决定。

## 2. 合法 Scope/排除/validity（C2）

真实链的冻结 binding scope 带 `expiresAt`，个人选择不带 → 宽选择下 body 仍 `verified`，
`scopeReview.reasons` 为 `['selection_validity_changed']`、`partial:false`、withheld 0。这解释
“有效期不同”，不改变正文，也不构成 grant。

| 选择 | state | sources | reasons | withheld |
| --- | --- | --- | --- | --- |
| 宽 `src/` | verified | 原冻结正文 | `selection_validity_changed` | 0 |
| 窄 `src/narrow/` | scope_changed | 空 | `selection_narrowed` + `selection_validity_changed` | 原 binding 来源数（≤64） |
| 新排除 `src/secret/` | scope_changed | 空 | `exclusion_added` + `selection_validity_changed` | 原 binding 来源数 |

窄选择下原候选被 `scope_escalation` 拒绝，history/Work/delivery 仍可读，业务 POST 仍 422。
诊断不额外读取 artifact（main 自身断言；C 侧验证正文空、加字段不改变默认响应与 provider/queue）。

## 3. 失效与回执（C5）

- 复制恢复 root 并删除冻结 artifact 后：默认 `state:'missing'`、sources 空；诊断 `partial:true`、
  `withheldSourceCount:0`、`authorization:'none'`；业务仍 422。
- 原已确认 proposal token 与原 context token 重放均 422；provider 请求数前后不变。
- 权限问答显示文本不进 frozen sources，也不成为普通模型批准。

## 4. 双格式标准入口与新风险（C3/C6）

`packages/context/tools/personal-review-driver.mjs` 是参数化同包 driver：

```sh
node packages/context/tools/personal-review-driver.mjs \
  --install <install-root> --state <restored-state> --project <id> \
  --allow-path src/ --console-port <c> --api-port <a> \
  --model-config <file> --format v1|v2 \
  --work <id> --question <id> --candidate-message <id> [--package-subject <sha256>]
```

它用**包内** `tools/dev/review-restored.mjs` 生成新 0600 文件，用**包内** `tools/dev/start.mjs`
（标准入口）启动，读取 actual health/`restoredReviewDigest`、默认与 opt-in sources，并验证：
business/candidate prepare 422、候选 `executable:false`、Work `delivered`、delivery `native_applied`。
输出包含 review/start/demo/restored-review 文件路径与 SHA-256、review 文件 SHA/模式、health、
sources 诊断、refusals，`sourceOnly:true`，`packageSubject` 仅在调用者明确提供时回显。

实测：**v1 与 v2 都通过标准 `start.mjs` 入口**（本轮补 v2 标准入口的新风险；v1 标准
start/reuse 与 v2 demo 的旧范围保留在 wave21 用例，不机械重跑）。两格式各用自己的恢复 root、
凭据与新同意文件。

## 5. 投影边界与成本（C7/C8）

- `explainRestoredReviewScope` 仍是 main 调用的纯展示投影：state/正文释放由 main guard 唯一决定；
  未观察的可读计数为 `null`，公开 DTO 不包含它们。
- 诊断字段 bounded：`reasons` 最多 7 个去重值、`withheldSourceCount` ≤64、JSON 小于 4KiB（实测断言）。
- 不新增 SQL/HTTP writer/确认 authority/LLM loop；不跨 await 持 SQL 事务；不加载全库正文。
- 旧规模边界（600 字节同意文件、8 候选/长文本、10000 history）继续引用，不重复扩大扫描。

## 6. 给 main 的只读 UI 输入（C9）

见 `packages/context/reports/wave22-ui-contract.json`：四个 state 的标题/文案、七个 reason 的
中文说明、`partial` badge、`withheldSourceCount` 文案上限、禁止渲染项（可读计数/原始路径/
principal/token/把 `none` 当批准），以及 main 应加的测试提示。C 不改 UI、不写 E 断言。

## 7. D/E 使用规则

- D 必须用自己安装根运行 driver，输出中的 `entries.*.sha256` 是**实际文件字节**；
  `packageSubject` 由 D 的 tar/hash/build 提供。source checkout 的通过不认证旧包。
- E 只有把该输出绑定到同包 consumer 字节后才可把结果标为 installed；driver 本身只输出
  `sourceOnly:true`，缺省 `packageSubject:null`，不冒充发布认证。
- 若 D 的入口不接受 `--state/--port/--api-port/--discussion-only/--review-restored-scope`，
  driver 必须报错而不是回退 source demo；这种情况标记 NOT_REACHED，由 D 提供等价参数入口。

## 8. 限制

- 实测入口为 `start.mjs`（标准 personal）与 `demo.ts`；未运行 D launcher。
- 恢复仍是真实 v1/v2 库/artifacts 复制 + `personal-restore/1` marker，不是完整安装/升级矩阵。
- validity 用例来自冻结 binding 的 `expiresAt` 与当前选择差异，不是运行中定时撤权。
- 无 private permission、target 启动、queue 消费或 vendor native 调用。
