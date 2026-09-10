# 在 AgentOrganon 中工作

本文件是[根目录 AGENTS.md](../AGENTS.md) 的中文对应文档，并承载本目录的翻译规则。翻译基准为对应英文文本；出现差异时，以英文文本为准。沿用 [Core 中文翻译规则](../OrganonCore/zh/AGENTS.md)：保持相同的含义、义务或确定性强度、条件、范围和必要限定，允许自然的中文措辞差异；同步更新对应英文和中文文件。翻译核对不替代独立审查。

将 [OrganonCore/AGENTS.md](../OrganonCore/AGENTS.md) 与本文件一并阅读，包括其链接的哲学、审查方法和[迭代规则](../OrganonCore/skills/references/iteration.md)。外层仓库工作适用共享的维护、独立审查、措辞、授权、记录和停止规则。Core 的纯文本交付约束适用于 Core 仓库；外层仓库明确提供零依赖 Node 脚本。

区分工作区已采用的哲学、待采用替代文本与 Core 方法自身的约束。使用[哲学解析契约](../OrganonCore/skills/references/philosophy-resolution.md)和[格式契约](../OrganonCore/skills/references/structure.md)。外层技能在委托时传递所选基准。与 Core 的差异不自动构成采用方承诺内部的矛盾。兼容本身不支持采用，冲突本身也不否定修订理由。

根目录 `PHILOSOPHY.md` 是指向 Core 源文件的只读软链接，没有根目录派生 lock。相对引用从真实源文件目录解析。不得通过哲学管理写入替换它，或通过其他路径写入其 Core 目标。管理操作用于普通采用副本；Core 变更仅通过其适用的维护或吸收流程及授权执行。

脚本执行确定性解析、比较和文件操作。agent 与用户保留哲学判断、语义版本决定及具体采用授权。准备好的应用计划绑定输入，不证明授权或哲学正确性。行为变更须运行相关机械测试及独立的实际技能用例，先保留独立原始响应，再与预期边界比较。

将变更限制在授权范围内，并保留用户已有工作。私有证据及共享六段记录保存在已忽略的 `.local/`；合并报告、候选、决定、计划和记录使用 `.local/iterations/merges/`。写入记录前确认该目录已被忽略。英文文档是对应译文的正本；维护翻译对时遵循本文件的翻译规则。本次实现不翻译 SKILL.md 文件。

远程发布遵循 [Core 授权规则](../OrganonCore/AGENTS.md#remote-publication-authorization)。复用覆盖相同操作、目标和范围的既有授权。实施请求本身不授权 push。不得发布引用尚不可获得的 Core 提交的外层版本。
