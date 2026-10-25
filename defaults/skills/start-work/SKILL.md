---
name: start-work
description: Initialize and bootstrap medium-to-large projects with isolated workspace, Nix Flake toolchains, Git, project-level OpenCode/OMO configurations, licensing, and cold-reload before implementation. Use whenever starting a new project, scaffolding a repository from scratch, or setting up a structured engineering workspace.
---

# Start Work

Autonomous bootstrapping workflow for medium and large-scale software engineering projects.

Always execute this workflow when initializing a new project or major subsystem before writing functional code.

## Phase 1: Workspace & Session Setup

1. **Create Project Workspace**:
   - Determine the project root directory path.
   - Create the directory (`mkdir -p <project-path>`).
2. **Relocate OpenCode Session**:
   - Move the active OpenCode session into the project workspace:
     ```javascript
     tools.opencode.session_move({ directory: "<project-path>" })
     ```
3. **Audit Task & Set Title**:
   - Review user specifications, core requirements, and target architecture.
   - Rename the session to a concise, descriptive project title:
     ```javascript
     tools.opencode.session_rename({ title: "<Project Name>: Initial Scaffolding" })
     ```

## Phase 2: Nix Toolchain & Flake Scaffolding

1. **Initialize Git**:
   - Run `git init -b main` in the workspace.
   - Create a standard `.gitignore` suited to the language stack.
2. **Construct Declarative `flake.nix`**:
   - Create a standalone `flake.nix` with a reproducible `devShells.default`.
   - Include all required compilers, runtime engines, language servers (LSP), linters, formatters, and CLIs.
   - Run `nix flake lock` to lock dependencies.
3. **Domain Skill Curation & Assignment**:
   - Identify the primary programming languages, frameworks, and domains (e.g. C#, Rust, Python, Go, React, Kubernetes).
   - Search and discover relevant domain-specific skills.
   - Configure project-level `.opencode/oh-my-opencode-slim.jsonc` (or `.json`) to assign discovered domain skills directly to the responsible specialist agent (e.g., assign language idioms/types to `@fixer`, UI to `@designer`, or performance to `@oracle`).

## Phase 3: Open-Source Licensing

1. **Inquire License Preference**:
   - Ask the user which open-source license they prefer.
   - **Default Policy**: Use GNU General Public License v3.0 (`GPL-3.0-or-later`).
   - If GPL is rejected or incompatible with project dependencies/intent, fall back to `MIT`.
2. **Generate `LICENSE`**:
   - Write the chosen standard license text to the root `LICENSE` file.

## Phase 4: Automation Scripting Standards

1. **Evaluate Tooling Needs**:
   - Determine whether custom build helpers, data parsers, or evaluation scripts are needed.
2. **Scripting Language Rule**:
   - **Prioritize Python 3**: For any multi-step automation, generation, or maintenance scripts, write clean, executable Python scripts (e.g. under `scripts/`). Include Python in the Nix `devShells.default` packages.

## Phase 5: Initial Baseline Git Commit

1. **Stage Files**:
   - Review `git status` to ensure no temporary, secret, or unintended artifacts are tracked.
2. **Create Baseline Commit**:
   - Commit the scaffolding:
     ```bash
     git add .
     git commit -m "chore: initial project scaffolding with flake, config, and license"
     ```

## Phase 6: Environment Reload & Verification

1. **Verify Integration**:
   - Ensure `.opencode/` configurations, LSP servers, MCPs, and skills are staged cleanly.
2. **Restart OpenCode Host**:
   - Execute `/restart` (or the restart command) to cold-reload the OpenCode server inside the newly initialized flake environment:
     - The server restarts cleanly.
     - Project-level flake environment, devShell paths, LSP, MCPs, and skills load into context.
     - State automatically restores upon reload.
3. **Begin Implementation**:
   - Once reloaded, proceed with the actual implementation passes.
