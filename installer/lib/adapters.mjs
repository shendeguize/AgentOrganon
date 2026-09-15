import path from 'node:path';

// Native discovery paths, checked against the linked vendor documentation.
// Filesystem installation does not certify authenticated invocation/delegation.
export const AGENTS = {
  codex: { project: '.agents/skills', global: '.agents/skills', instructions: 'AGENTS.md', aliases: ['.codex/skills'], command: 'codex', source: 'https://developers.openai.com/codex/skills/' },
  claude: { project: '.claude/skills', global: '.claude/skills', instructions: 'CLAUDE.md', aliases: [], command: 'claude', source: 'https://code.claude.com/docs/en/skills' },
  cursor: { project: '.cursor/skills', global: '.cursor/skills', instructions: 'AGENTS.md', aliases: ['.agents/skills', '.claude/skills'], command: 'agent', source: 'https://cursor.com/docs/skills' },
  copilot: { project: '.github/skills', global: '.copilot/skills', instructions: 'AGENTS.md', aliases: ['.agents/skills', '.claude/skills'], command: 'copilot', source: 'https://docs.github.com/en/copilot/reference/copilot-cli-reference/cli-command-reference' },
  gemini: { project: '.gemini/skills', global: '.gemini/skills', instructions: 'GEMINI.md', aliases: ['.agents/skills'], command: 'gemini', source: 'https://geminicli.com/docs/cli/skills/' },
  opencode: { project: '.opencode/skills', global: '.config/opencode/skills', instructions: 'AGENTS.md', aliases: ['.agents/skills', '.claude/skills'], command: 'opencode', source: 'https://opencode.ai/docs/skills/' },
};
export function discoveryRoot(agent, scope, root) { return path.join(root, AGENTS[agent][scope]); }
