# 主 Agent：G0 公共契约、仓库与集成

主目录：`/Users/hh/Desktop/joker/superagent`。交付仓库为用户 fork，main 是 review 后的集成基线。

当前职责：

1. 维护根 AGENTS、代码地图、分工和共享规格，给 A/B 同一基线。
2. 将 [契约草案](../product-spec/contracts/contracts.ts) 收敛为 `packages/contracts/` 的单一运行时 schema 来源、生成类型、schema hash 和合法/非法 fixtures。
3. 维护 bootstrap 模板与未来根 workspace 集成，禁止 A/B 竞争改根 lockfile。
4. Review A 的独立提取和 B 的实际 runtime/binding 证据，汇总 CORE-01、DATA-01、OPS-01 的 G0 适用断言。
5. fetch A/B 的同名远程分支；检查修改范围/测试/敏感数据，再集成 main，push 用户 fork。
6. G0 通过后发布契约/共同 commit，自己负责 WP-01/16，A 转 WP-02，B 转 WP-03。

不要将 A/B 的分支提交误认为本会话已运行的测试。原仓 baseline、提取试验、真实 binding、native 和端到端报告各自记录。

两个 Agent 的目录彼此独立，不在他们进行中的文件里修复问题；review 反馈交原 owner。跨目录紧急修改需要明确 ownership 交接。
