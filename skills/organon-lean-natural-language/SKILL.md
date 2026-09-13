---
name: organon-lean-natural-language
description: Forward Lean explanation, blind backtranslation and bilingual reader requests to the maintained Core skill.
---

# organon-lean-natural-language

Use [organon-core-lean-natural-language](../../OrganonCore/skills/organon-core-lean-natural-language/SKILL.md) as the sole maintained method. Preserve the supplied source, output directory, language and explanation options, and existing authorization. This entrypoint does not maintain a separate formalization or translation method.

Code-only explanation does not require a philosophy. Retain `--explain-lines` and the selected output language; default to Chinese as specified by Core. If the invocation is an independent blind review, pass only the permitted code and technical context and retain the initial output before disclosing source prose.
