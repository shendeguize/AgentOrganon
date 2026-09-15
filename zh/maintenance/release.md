# 发布维护

本页对应[英文正本](../../maintenance/release.md)。产品版本、哲学版本和格式协议分别管理。初始产品候选为 `1.0.0-rc.1`；Core 哲学为 `0.1.4`，SoftwareEngineering 为 `0.2.1`，其已考虑的 Core checkpoint 保持 `0.1.2`。路径维护不表示采纳新哲学。

## 来源与审查边界

`main` 用于集成，`release/1.0.0` 用于候选和稳定维护。变更通过 PR，由仓库所有者决定合并；候选修复也通过 PR 返回 `main`。保护范围包括带多层路径的 `dev`、`release` 分支。先实际运行并通过 `Repository / verify`，再启用对应必需检查。版本 tag 禁止更新和删除。

使用公开 HTTPS 地址检出三个精确 commit。准备分支时保留已有工作和暂存区。Core 维护共享站点主题；子仓库的 `release/tooling.json` 固定工具 commit，不跟随移动分支。外层通过 gitlink 固定 Core 和领域仓库。先公开被依赖 revision，再公开引用它们的版本；工具快照可以早于最终产品 commit，以避免循环引用。

## 平台准备

通过 `scripts/release/security.mjs plan|apply|check --repository shendeguize/AgentOrganon` 及两个子仓库名配置并检查 Actions。需要审核的 Environment 只由 `shendeguize` 审核，允许其审核自己发起的 dispatch，禁止管理员绕过。公开 REST 更新接口未暴露绕过开关，应在 GitHub Environment 页面关闭后复跑检查。分支规则使用 `scripts/release/governance.mjs plan|apply|check --repository ...`，启用时以 `--validated-ref` 指定已通过必需检查的 commit。

在协调仓库 `agent-validation` Environment 的 GitHub Secrets 中设置 `OPENAI_API_KEY`、`ANTHROPIC_API_KEY`、`CURSOR_API_KEY`、`COPILOT_GITHUB_TOKEN`、`GEMINI_API_KEY`，明确设置 `OPENCODE_MODEL`。可选模型变量见[工具验证说明](../../scripts/agents/README.md)。不得把凭据写进仓库或审查消息。认证、实际调用及必要独立委派均在托管 runner 中观察；文件发现检查不能证明工具支持。

每仓首次 npm 发布使用短期、限定权限的 `NPM_BOOTSTRAP_TOKEN`。包创建后，配置对应仓库及 `publish.yml` 的 trusted publisher；Environment 绑定应覆盖预期的 RC 和正式发布流程。实际验证后续 OIDC 发布，再撤销自举凭据并删除 GitHub Secret。npm trust 配置另有账号与 2FA 要求，自举 token 不自动具备该权限。见 [npm 前置条件](https://docs.npmjs.com/cli/v11/commands/npm-trust/#prerequisites)。

`NPM_CHANNEL_STRATEGY` 必须对应所有者的明确决定。`direct` 按 Core、AdvisedOrganons、AgentOrganon 顺序直接发布到 `rc` 或 `latest`，CLI 包最后发布，统一站点推荐仍等待三包完成。`deferred` 先发布临时 tag，之后用单独获准的 `NPM_TAG_TOKEN` 晋升渠道。OIDC 支持发布，不支持 `npm dist-tag`。流程不隐式选择策略。

每仓还需配置短期 `GOVERNANCE_AUDIT_TOKEN` Secret，仅限这三个仓库，权限为 Administration read 和 Actions read。候选构建、发布和 Pages 验证会检查完整分支／tag 规则、Actions 权限和 Environment。REST 隐藏 bypass actor 明细时，审计读取同一 ruleset 的 GraphQL 总数，不把隐藏的 actor 节点计为零。权限不足、计数不可见或配置不合格均阻断发布。新凭据应同时以已知非零 bypass 的对照和这三个仓库验收。参见 [ruleset 可见性](https://docs.github.com/en/rest/repos/rules#get-a-repository-ruleset)和 [Actions 权限检查](https://docs.github.com/en/rest/actions/permissions#get-github-actions-permissions-for-a-repository)。

审计凭据仅注入固定验证／发布步骤；治理模块加载后立即从进程环境移除。只有只读 GitHub 审计适配器接收它，npm、站点构建及其他子进程不会继承。每次发布和渠道验证都会重新检查三个仓库，发现候选封存后的配置变化。

## 候选流程

1. 将审查后的来源合入候选分支，在精确 commit 上运行 `candidate.yml`。它一次构建三个内容包，检查文档、站点、治理、Lean 读者稿，并在原生 Linux/macOS/Windows 中对实际候选包验证安装生命周期。保存 `candidate-packages-{attempt}` 及规范化 manifest digest。
2. 用该 run 和 digest 运行 `agent-e2e.yml`，先探测认证。每个候选都需完整 smoke 矩阵和 Linux full 矩阵。执行完成等待独立审查的进程退出码为 3；workflow 将其记为成功采集，不视为发布批准。调用失败或凭据缺失仍为失败。
3. 下载并保留实际输出。不同的审查者先读取冻结输入和原始回应，再进行比较。用原报告、独立收据及评价运行 `scripts/agents/review.mjs`，披露已知信息和限制。评价者的同意不能替代实际委派证据。
4. 在独立证据分支的 `reviewed/` 下仅提交新审查输入、评价、收据和派生的获准摘要，不改变产品 commit，也不复制改写的执行原件。以精确审查 commit、候选 run、真实工具 run 和原 manifest digest 运行 `seal.yml`。它下载可信原始字节，绑定来源并复验完整执行与审查引用后生成 `validated-release-{attempt}`。
5. 协调仓库 `publish.yml` 以成功 seal run 和 digest 执行 `bootstrap-bundle`，公开已完整验证的内容包与证据。随后各产品从自己精确的 `release/1.0.0` 来源发布，并使用此前确认的 npm 策略。每个发布者读取同一 bundle；相同已发布版本可复用，字节不同则停止。
6. 三包 npm 下载、GitHub 资产、tag 和 manifest 字节全部匹配后，才完成渠道推荐步骤。各站用同一版本和 digest 运行 Pages 流程；独立数据分支见 [Pages 与星标](pages-and-stars.md)。

部分发布不能原子回滚：保留成功的不可变产物，只重试同一 sealed manifest 的缺项。任何内容修订都使用下一个 RC，并重新完成全部候选门禁。审核包应包含来源 commit、包 hash、矩阵报告、独立审查、安装命令、真实发布链接及剩余限制，交所有者审核。

## 正式发布

RC 不是正式版。所有者先批准确切 RC manifest digest，将 `APPROVED_RC_MANIFEST_SHA256` 设置到三仓库受保护的 `npm-stable` Environment，并向正式候选准备流程提供这一获准身份。候选 workflow 的 `approved_rc_version` 使用该 RC 的精确版本。

准备新的产品 `1.0.0` commit，仅变更产品元数据、内部精确依赖版本及对应公开安装／版本文字，并将 gitlink 指向三个精确正式 commit。哲学、rationale、Lean 和运行逻辑保持字节不变。正式门禁下载获准公开 RC，比较三仓完整 Git tree、文件模式和变化的 blob 字节；意外差分需要新的审核 RC。

重新构建正式包并完成同一套全部验证。`publish.yml` 在任何正式发布修改前，分别要求受保护 Environment 批准并验证 RC→正式版差分。不能通过取消旧 RC 的 prerelease 标记将其改称 `1.0.0`；保留两次发行的 manifest 对应关系。

## 复跑入口

开发期运行 `npm test`、`npm run check:content`、`npm run check:site`、`npm run test:install` 及现有 Lean 门禁。实际包检查使用 `npm run check:package -- --package FILE`。`npm run check:release -- --manifest FILE` 复验封存引用，不能把缺失的真实工具或平台证据变为成功。对应托管执行与公开下载尚未通过时，兼容性和发布验收仍未完成。

重跑保留旧 artifact，只使用同一次完整运行尝试（attempt）的固定 artifact ID 和服务端 digest。若仅重跑部分失败 job 导致当前 attempt 缺少矩阵项，应选择 `Rerun all jobs` 或重新 dispatch；不能借用旧 attempt 的结果。
