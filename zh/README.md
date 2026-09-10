# AgentOrganon

AgentOrganon 在 [OrganonCore](../OrganonCore/README.md) 外提供工作区技能与确定性文件操作。Core 包含哲学和审查方法；外层仓库包含管理采用副本的 Node 脚本。采用方工作区可以根据用户的明确决定修订或撤回承诺。

本仓库文档以英文为维护正本。参见[英文 README](../README.md)。

## 技能

| 技能 | 职责 |
| --- | --- |
| [organon-assess](../skills/organon-assess/SKILL.md) | 依据所选工作区哲学评估输入。 |
| [organon-absorb](../skills/organon-absorb/SKILL.md) | 审查修订该哲学的理由，在审查后落实已获授权的采用。 |
| [organon-principled-review](../skills/organon-principled-review/SKILL.md) | 按 Core 方法规定的触发条件和标准委托完整分析。 |
| [organon-wording-review](../skills/organon-wording-review/SKILL.md) | 审查措辞；不要求哲学文件。 |
| [organon-philosophy](../skills/organon-philosophy/SKILL.md) | 初始化、检查、导出、导入和合并采用副本。 |

前三个技能使用显式指定的哲学路径；未指定时，依次在调用工作区的 Git 根目录、当前目录查找 `PHILOSOPHY.md`，不搜索子目录。显式路径无效即停止；默认候选均缺失时提示初始化。它们不会回退到随附的 Core 哲学。委托过程中始终以所选路径为评估基准，并分别标明待采用修订与 Core 方法约束。

兼容不构成采用理由，与既有承诺冲突也不单独否定修订理由。脚本检查并转换文件；agent 与用户评估含义、审查完整候选并决定采用。

## 文件与版本

采用方工作区使用普通文件 `PHILOSOPHY.md` 及其旁侧的 `PHILOSOPHY.lock.json`，其中 `document_filename` 标识同目录下的托管文件。[格式契约](../OrganonCore/skills/references/structure.md) 规定支持的四个 frontmatter 字段，以及每个标题及其直属正文和文首说明的稳定 ID。支持 `## Title` 这样的无缩进 ATX 标题；其他 ATX 形式和 Setext 标题会被拒绝。Core 当前的三章组织形式是初始化模板；采用方可以重组。初始化增加空 Extensions 章节，以稳定 ID `extensions` 标识，不依赖标题或位置。

- `format_version` 标识支持的文件格式。不支持的格式会阻止托管写入。
- `philosophy_version` 描述语义修订，由 agent 提议、用户决定：改变或撤回承诺、含义或适用范围使用 major；保留既有承诺的新增使用 minor；保持含义的措辞或结构维护使用 patch。
- `core_version` 记录最后一次完整审视的 Core 来源版本。超出 `package.json` 中 `organon.coreVersion` 范围时产生来源版本警告，不构成哲学裁决。
- `derived_from` 记录导出来源。来源信息和相同版本号都不能证明共同祖先。

lock 保存已审视来源检查点的 hash、结构和拒绝记忆，不包含旧来源正文。本地内容不同于检查点是正常状态。被拒绝的来源单元在传入状态变化前不再提议，但实际差异仍可见。没有可验证来源检查点的导入采用双向差异模式，且绝不推进 Core 的已审视版本。

本仓库根目录的 `PHILOSOPHY.md` 是指向 `OrganonCore/PHILOSOPHY.md` 的相对软链接，仅用于读取；相对引用从真实源文件目录解析。根目录没有派生 lock。管理脚本拒绝穿透或替换该软链接，也拒绝写入 Core 源文件。Core 变更使用其明确的维护或吸收流程。

## 本地使用

使用 Node.js 22，无第三方运行时依赖。以下命令在本仓库执行，并要求 OrganonCore 子模块已存在。从其他目录操作时，使用脚本的绝对路径。目标的父目录必须已存在。在 Git 工作区中，初始化前先忽略 `.local/`，使恢复日志保持私有；脚本会在需要时创建日志目录。

```sh
node scripts/check.js --source OrganonCore/PHILOSOPHY.md
node scripts/check.js --source PHILOSOPHY.md
node scripts/init.js --target /path/to/workspace/PHILOSOPHY.md
node scripts/check.js /path/to/workspace/PHILOSOPHY.md
node scripts/export.js --source /path/to/workspace/PHILOSOPHY.md --out /path/to/export.md
node scripts/export.js --source /path/to/workspace/PHILOSOPHY.md --out /path/to/core-part.md --core-only
node --test
```

初始化和导出要求输出路径尚不存在。`--core-only` 删除由 `extensions` 标识的子树；标记缺失即停止导出。剩余文本仍属于采用方，不是官方 Core 副本。来源身份是调用方提供的标签或已保存的文档身份，不是经过认证的发布者身份。托管操作发现输入存在未完成事务时会停止，包括初始化、导出和分类时的读取；恢复操作后再继续，使用报告中给出的恢复命令。

通过 `organon-philosophy merge --dry-run` 请求只读差异报告。技能调用 `classify.js`；不存在已安装的 `organon-philosophy` 可执行命令。技能文档说明候选准备、决定、恢复及应用命令。报告、候选、计划和六段合并记录保存在已忽略的 `.local/iterations/merges/`。准备好的计划绑定已审视输入和候选；输入过期则停止应用。完成准备或通过文件检查不提供采用授权。

私有包名为 `@shendeguize/agent-organon`，版本为 `0.1.0`。安装模式和发布不在本次实现范围内。贡献前请阅读 [AGENTS.md](../AGENTS.md)；远程发布遵循其引用的 Core 授权规则。

使用[自实践与迭代协议](docs/self-iteration.md)比较方法、保留证据并完成有界迭代。

## 许可证

MIT。
