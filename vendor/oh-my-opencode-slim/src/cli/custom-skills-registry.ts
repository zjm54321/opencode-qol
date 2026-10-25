/**
 * A custom skill bundled in this repository.
 * Registered in-process from src/skills/ via the host's `ctx.skill` channel
 * at plugin load — never copied to the OpenCode skills directory.
 */
export interface CustomSkill {
  /** Skill name (folder name) */
  name: string;
  /** Human-readable description */
  description: string;
  /** List of agents that should auto-allow this skill */
  allowedAgents: string[];
  /** Source path in this repo (relative to project root) */
  sourcePath: string;
}

/**
 * Registry of custom skills bundled in this repository — the single gate for
 * in-process skill registration. Note: `src/skills/loop-engineering` is
 * deliberately NOT registered; the `/loop` command hook drives that workflow
 * inline and the directory is reference material only.
 */
export const CUSTOM_SKILLS: CustomSkill[] = [
  {
    name: 'simplify',
    description: 'Code simplification and readability-focused refactoring',
    allowedAgents: ['oracle'],
    sourcePath: 'src/skills/simplify',
  },
  {
    name: 'codemap',
    description: 'Repository understanding and hierarchical codemap generation',
    allowedAgents: ['orchestrator'],
    sourcePath: 'src/skills/codemap',
  },
  {
    name: 'clonedeps',
    description: 'Clone important dependency source for local inspection',
    allowedAgents: ['orchestrator'],
    sourcePath: 'src/skills/clonedeps',
  },
  {
    name: 'deepwork',
    description:
      'Heavy/complex coding sessions and large modifications workflow',
    allowedAgents: ['orchestrator'],
    sourcePath: 'src/skills/deepwork',
  },
  {
    name: 'verification-planning',
    description:
      'Plan credible, proportionate evidence before non-trivial implementation',
    allowedAgents: ['orchestrator'],
    sourcePath: 'src/skills/verification-planning',
  },
  {
    name: 'step-back',
    description:
      'Pause snowballing patches and reassess direction before continuing',
    allowedAgents: ['orchestrator'],
    sourcePath: 'src/skills/step-back',
  },
  {
    name: 'deanchor',
    description:
      'Generalize from examples instead of copying them with light edits',
    allowedAgents: ['orchestrator'],
    sourcePath: 'src/skills/deanchor',
  },
  {
    name: 'ai-estimates',
    description:
      'Estimate task duration for a human working with AI, not alone',
    allowedAgents: ['orchestrator'],
    sourcePath: 'src/skills/ai-estimates',
  },
  {
    name: 'reflect',
    description:
      'Review repeated work and suggest reusable workflow improvements',
    allowedAgents: ['orchestrator'],
    sourcePath: 'src/skills/reflect',
  },
  {
    name: 'oh-my-opencode-slim',
    description:
      'Configure, customize, and safely improve oh-my-opencode-slim setups',
    allowedAgents: ['orchestrator'],
    sourcePath: 'src/skills/oh-my-opencode-slim',
  },
  {
    name: 'worktrees',
    description:
      'Manage Git worktrees as OMO safe isolated coding lanes for complex/risky/parallel work',
    allowedAgents: ['orchestrator'],
    sourcePath: 'src/skills/worktrees',
  },
  {
    name: 'start-work',
    description: 'Bootstrap new projects with workspace relocation, Nix Flake, Git, skills, licensing, and server reload',
    allowedAgents: ['orchestrator'],
    sourcePath: 'src/skills/start-work',
  },
  {
    name: 'grill-me',
    description: 'Grill the user about their problem or idea before writing code',
    allowedAgents: ['orchestrator'],
    sourcePath: 'src/skills/grill-me',
  },
  {
    name: 'grill-with-docs',
    description: 'Grill the user about their problem while actively consulting documentation',
    allowedAgents: ['orchestrator'],
    sourcePath: 'src/skills/grill-with-docs',
  },
  {
    name: 'image-generation',
    description: 'Generate or edit images with AI models',
    allowedAgents: ['orchestrator', 'designer'],
    sourcePath: 'src/skills/image-generation',
  },
  {
    name: 'skill-creator',
    description: 'Create new skills, modify and improve existing skills, and measure skill performance',
    allowedAgents: ['orchestrator', 'fixer'],
    sourcePath: 'src/skills/skill-creator',
  },
  {
    name: 'customer-research',
    description: 'Customer interview and feedback research synthesis',
    allowedAgents: ['explorer'],
    sourcePath: 'src/skills/customer-research',
  },
  {
    name: 'context7-mcp',
    description: 'Up-to-date documentation and code examples via Context7 MCP',
    allowedAgents: ['explorer'],
    sourcePath: 'src/skills/context7-mcp',
  },
  {
    name: 'ui-ux-pro-max',
    description: 'UI/UX design intelligence and best practices',
    allowedAgents: ['designer'],
    sourcePath: 'src/skills/ui-ux-pro-max',
  },
  {
    name: 'make-interfaces-feel-better',
    description: 'Interaction design and interface refinement techniques',
    allowedAgents: ['designer'],
    sourcePath: 'src/skills/make-interfaces-feel-better',
  },
  {
    name: 'better-icons',
    description: 'Icon search and design guidelines',
    allowedAgents: ['designer'],
    sourcePath: 'src/skills/better-icons',
  },
  {
    name: 'python-code-style',
    description: 'Modern Python idioms, formatting, typing, and conventions',
    allowedAgents: ['fixer'],
    sourcePath: 'src/skills/python-code-style',
  },
  {
    name: 'typescript-advanced-types',
    description: 'TypeScript type engineering and advanced pattern guidelines',
    allowedAgents: ['fixer'],
    sourcePath: 'src/skills/typescript-advanced-types',
  },
  {
    name: 'rust-best-practices',
    description: 'Idiomatic Rust architecture, memory safety, and concurrency practices',
    allowedAgents: ['fixer'],
    sourcePath: 'src/skills/rust-best-practices',
  },
  {
    name: 'modern-python',
    description: 'Modern Python development practices and tooling',
    allowedAgents: ['orchestrator', 'fixer'],
    sourcePath: 'src/skills/modern-python',
  },
  {
    name: 'web-perf',
    description: 'Web performance analysis, Core Web Vitals, and optimization strategies',
    allowedAgents: ['oracle'],
    sourcePath: 'src/skills/web-perf',
  },
  {
    name: 'code-review-excellence',
    description: 'High-leverage code review principles and checklist',
    allowedAgents: ['oracle'],
    sourcePath: 'src/skills/code-review-excellence',
  },
  {
    name: 'architecture',
    description: 'Software architecture design, system trade-offs, and boundary definitions',
    allowedAgents: ['oracle'],
    sourcePath: 'src/skills/architecture',
  },
  {
    name: 'humanizer-zh',
    description: 'Chinese text naturalization and AI tone removal',
    allowedAgents: ['documenter'],
    sourcePath: 'src/skills/humanizer-zh',
  },
  {
    name: 'humanizer',
    description: 'Remove AI patterns and make text sound authentic and natural',
    allowedAgents: ['documenter'],
    sourcePath: 'src/skills/humanizer',
  },
  {
    name: 'writing-clearly-and-concisely',
    description: 'Style guide for clear, concise, and vigorous prose',
    allowedAgents: ['documenter'],
    sourcePath: 'src/skills/writing-clearly-and-concisely',
  },
];
