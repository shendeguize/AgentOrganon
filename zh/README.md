![AgentOrganon](../assets/banner.svg)

[English](../README.md) · [简体中文](README.md) · [Website](https://shendeguize.github.io/AgentOrganon/zh/) · [Releases](https://github.com/shendeguize/AgentOrganon/releases)

# AgentOrganon

工作区方法与哲学管理。

## Design Aim · 设计目标

让 agent 的判断与改进有依据。Organon 让承诺、理由和适用边界可读、可审查、可修订。它提供哲学和方法，不保证判断正确或自动改进；哲学采纳保留明确的人类决定。

## 开始使用

```sh
npx --yes @shendeguize/agent-organon@1.0.0-rc.1 install --product agent-organon --agent codex --scope project --project /path/to/workspace --version 1.0.0-rc.1
```

候选发行版 **1.0.0-rc.1** 等待审核。公开包可用后执行上述命令；发行前使用本地候选包。需要 Node.js 22+。支持项目或全局安装；六种 agent 适配的真实验证状态见发行矩阵。

[完整快速开始：安装 → 检查 → 选择哲学 → 只读评估](https://shendeguize.github.io/AgentOrganon/zh/quick-start)

## 阅读与仓库结构

| 入口 | 内容 |
| --- | --- |
| [AgentOrganon](https://github.com/shendeguize/AgentOrganon) | 工作区技能及已采纳副本的管理。 |
| [OrganonCore](https://github.com/shendeguize/OrganonCore) | 核心哲学、审查方法与 Lean 证据。 |
| [AdvisedOrganons](https://github.com/shendeguize/AdvisedOrganons) | 领域哲学集合；明确选择领域后使用。 |
| [Docs](https://shendeguize.github.io/AgentOrganon/zh/understand) | 帮助读者理解概念、操作及能力边界。 |
| [Philosophy](https://shendeguize.github.io/AgentOrganon/zh/philosophy) | 已采纳承诺及其含义与条件。 |
| [Lean](https://shendeguize.github.io/AgentOrganon/zh/lean) | 主张速览及代码与解释的左右对照。 |

发布包仅包含哲学、非 Lean skills 及运行所需文件。网站、教程、Lean 工程与证据仍在源码中维护。Rationale 独立于人读 docs，不增加哲学义务；维护协议位于 maintenance。


## 选择方法

| 方法 | 用途 |
| --- | --- |
| `organon-assess` | 按所选哲学评估输入。 |
| `organon-absorb` | 检查哲学修订理由，并实施已授权的采纳。 |
| `organon-principled-review` | 按共享方法已说明的标准分析对象。 |
| `organon-wording-review` | 审查措辞，不决定哲学采纳。 |
| `organon-philosophy` | 管理哲学副本、版本及文件操作。 |

## 星标历史

![当前仓库真实星标总数历史](https://shendeguize.github.io/AgentOrganon/assets/stars.svg)

从启用日起每日记录真实总数。零值、取消星标和缺失采样如实保留；图中注明更新时间。

源码检出后的操作：[工作区文件与脚本参考](docs/workspace-reference.md)。

## 参与维护

维护前阅读仓库的 agent 指导与维护协议。机械检查、独立审查和人类采纳决定具有不同职责。

MIT · [License](../LICENSE)
