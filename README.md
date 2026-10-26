# OpenCode QoL

OpenCode Quality of Life (QoL) 是一款面向生产环境的 OpenCode 完整工程化整合包（Monorepo）。它将固定版本的 OpenCode 核心 (v2.1.4)、原生 Persistent PTY、内置工程级插件群、生态增强套件（Oh My OpenCode Slim、Billion Context ACP）以及精选的专业技能库（Built-in Skills）由 Nix 统一构建进单一确定性闭包，免除任何运行时 npm/bun 安装或外部网络下载。当前面向 `x86_64-linux`。

---

## 🚀 官方一键安装

### Windows · PowerShell 5.1 / 7+

```powershell
irm https://raw.githubusercontent.com/zjm54321/opencode-qol/main/scripts/install.ps1 | iex
```

默认安装到 `$HOME\.opencode\bin`，自动登记用户 PATH，并运行 `opencode.exe --version`。**当前 CI 仅发布 Linux x64 包，Windows 下载需要 Release 另行提供 `opencode-windows-x64.zip`；当前可使用本地 ZIP 离线安装。**

### Linux / macOS · Bash

```sh
curl -fsSL https://raw.githubusercontent.com/zjm54321/opencode-qol/main/scripts/install.sh | bash
```

默认安装到 `~/.opencode/bin`。**当前提供 Linux x64 的完整 Nix 闭包归档，需要先安装 Nix；macOS/ARM 原生归档尚未发布。** 若该目录不在 PATH 中，脚本会输出添加命令。安装后的 `opencode` 使用标准全局持久化配置与数据目录。

> 只想试用？在本仓库执行 `nix run`。它在随机 `/tmp/opencode-run-XXXXXX` 工作目录启动，隔离 HOME 和所有 XDG 配置、数据、状态、缓存、运行时目录，退出即清理；不会复用全局认证或历史记录。此处是目录级试用隔离，不是限制网络与文件访问的安全容器。

## Monorepo 布局与发布安装

- `kernel/`：默认配置、插件、源码补丁、测试、依赖锁以及 Nix 构建逻辑。
- 根目录保留 `flake.nix`、`flake.lock`，统一导出 `.#default`、`.#kernel` 和 `.#opencode`；构建入口为 `kernel/nix/package.nix`。
- 安装和运行脚本统一放在 `scripts/`：`scripts/install.sh`、`scripts/install.ps1`、`scripts/run-isolated.sh`；发布工作流为 `.github/workflows/release.yml`。
- 私有 `isolated/` 配置保留在根目录，由 `.gitignore` 忽略，不纳入 Git 跟踪。

```sh
nix build
bun test
bash scripts/install.sh --version v2.1.4-qol
# 离线 Linux 安装：
bash scripts/install.sh --archive ./opencode-linux-x64.tar.gz
```

Linux x64 发布归档包含完整 Nix 闭包，安装前需要 Nix；脚本导入闭包并创建 GC root。Windows/macOS 原生包尚不由当前工作流构建，Unix 脚本按系统与架构寻找对应资产。Windows 脚本兼容 PowerShell 5.1/7，支持用户提供的 ZIP：

```powershell
.\scripts\install.ps1 -ZipPath .\opencode-windows-x64.zip -NoPath
# -Archive 同样支持本地 ZIP；省略两者则从对应 Release 下载。
```

推送 `v*` 标签自动发布 Linux 包、安装脚本和 `SHA256SUMS.txt`；手动触发需要填写已有标签。

`bun test` 只发现 `kernel/tests/`，不会进入 `result` 的第三方测试树；插件源码测试需要已准备好的上游工作区依赖与构建期 vendor 源码。

## 🌟 整合包重大特性更新 (Major QoL Update)

本版本对系统进行了全面的原生闭包重构与技能体系扩充，带来以下重大升级：

### 1. 声明式固化内置 Skills 矩阵 (Nix-Native Built-in Skills)
所有外部技能均通过 `flake.nix` 声明式引入，并由 `flake.lock` 精确锁定提交版本与 narHash，构建期由 Nix 直接固化注入，**零运行时下载、零外部依赖**：
- **工程与架构类**：
  - `start-work`：新项目自动化工程初始化（独立工作区、会话重命名、Nix Flake 脚手架、Git 仓库、领域 Skill 自动配置、GPL/MIT 开源许可、Python 脚本规范与热重启加载）。
  - `architecture`：系统架构设计、边界划分与演进权衡评估（来自 Anthropic Engineering）。
  - `code-review-excellence`：高杠杆代码审查规范与合并就绪性审核（来自 W. Hobson）。
  - `web-perf`：现代 Web 性能分析、Core Web Vitals 与渲染链路优化（来自 Cloudflare）。
  - `simplify`：保持行为不变的深层代码简化与可维护性重构（OMO 第一方内置）。
  - `verification-planning`：非平凡改动前的证据闭环规划（OMO 第一方内置）。
  - `deepwork`：大型/高风险代码修改的多阶段渐进式工作流（OMO 第一方内置）。
  - `worktrees`：Git Worktree 安全隔离工作流（OMO 第一方内置）。
- **语言与规范类**：
  - `python-code-style`：现代 Python 习惯用法、类型注记与工程规范。
  - `typescript-advanced-types`：TypeScript 高级类型工程与类型体操推导。
  - `rust-best-practices`：惯用 Rust 架构、内存安全性与并发范式（来自 ApolloGraphQL）。
  - `modern-python`：现代 Python 开发流与前沿工具链（来自 Trail of Bits）。
- **设计与体验类**：
  - `ui-ux-pro-max`：UI/UX 设计智能、设计系统与布局排版规范。
  - `make-interfaces-feel-better`：界面微交互、动画流度与质感细节调优。
  - `better-icons`：高质量工程图标检索与设计准则。
  - `image-generation`：多模型 AI 图像生成与编辑协同。
- **调研与探索类**：
  - `context7-mcp`：基于 Context7 的实时官方文档与代码示例检索。
  - `customer-research`：客户访谈与需求反馈综合分析（来自 Anthropic）。
- **文字与表达类**：
  - `humanizer-zh`：中文语境深度去 AI 味与自然表达转化。
  - `humanizer`：英文语境去除 AI 生成特征与地道润色。
  - `writing-clearly-and-concisely`：经典风格指南，精炼清晰有力的技术文档。
- **元技能与思辨类**：
  - `skill-creator`：Anthropic 官方全功能 Skill 创作者与评测迭代闭环（含评估与聚合脚本）。
  - `grill-me` / `grill-with-docs`：无情刨根问底式思维压力测试工作流。

### 2. 原生 Marketplace 固化 (alvin/documenter)
- 遵循解耦原则，不直接污染修改 OMO 原生源码。
- 通过 Nix 固化拉取官方已验证的 `alvin/documenter` v3 规范 artifact，在构建期生成符合 OMO 原生 Marketplace 存储规范的结构（`package.json`、`sha256` 侧车及 `lock.json`）。
- 启动时原生注入，无需网络即可通过 `/marketplace` 检查或按需更新。

### 3. 模型预设支持
内置预设包含单模型与多梯队容灾链路：
- **`default`**：各 Agent 绑定权威首选模型（Orchestrator: Claude Opus 5.5 High, Oracle: GPT-6 Astra Max, Explorer: GPT-6 Luna XHigh, Designer: Claude Opus 5.5 High, Fixer: GPT-6.1 Sol XHigh, Council: GPT-6.1 Sol Max, Documenter: Gemini 3.8 Flash High）。
- **`defaultwithfallback`**：多层级故障转移链路，按优先级自动平滑回退，跨 Anthropic、Google、OpenAI 与 OpenRouter。
- **`free`**：官方 `opencode` provider 免费模型，含七个角色、三方 Council 与 `alvin/documenter`。官方 provider 默认启用，本地隔离配置仍禁用它。

### 4. 严苛权限与职责隔离矩阵 (Role & MCP Isolation)
- **Specialist 独占性**：
  - `explorer`：仅允许 `customer-research`、`context7-mcp`；专属 MCP：`context7`、`gh_grep`、`codegraph`。
  - `designer`：仅允许 `ui-ux-pro-max`、`make-interfaces-feel-better`、`better-icons`、`image-generation`；专属 MCP：`codegraph`。
  - `fixer`：仅允许 `python-code-style`、`typescript-advanced-types`、`rust-best-practices`、`modern-python`、`skill-creator`；专属 MCP：`codegraph`。
  - `oracle`：仅允许 `web-perf`、`code-review-excellence`、`architecture`、`simplify`；专属 MCP：`codegraph`。
  - `documenter`：独占允许 `humanizer-zh`、`humanizer`、`writing-clearly-and-concisely`；专属 MCP：`codegraph`。
  - `orchestrator`：通用全集通配，严格负向排除所有专家独占技能；专属 MCP：`codegraph`、`nixos`。
- **清理收敛**：彻底移除冗余及非必要配置与 Agent（如 secretary、observer 等），所有 QoL 内部插件命名统一为 `opencode.qol.*`。

---

## 构建与运行

Flake 命令：

```sh
nix build path:.
nix run path:.
```

本地 NUR 风格引用（使用根目录 `default.nix`，尚未向官方 NUR 注册或建立远端）：

```nix
let
  opencode-qol = ((import ./default.nix { inherit pkgs; }).opencode-qol);
in
  opencode-qol
```

## Home Manager

在宿主 flake 添加输入：

```nix
inputs.opencode-qol.url = "path:/home/you/opencode-qol";
```

在 Home Manager 配置中导入并启用：

```nix
imports = [ inputs.opencode-qol.homeManagerModules.default ];

programs.opencode-qol = {
  enable = true;
  settings = { };
  slim.settings = { };
  billionContext.settings = { };
};
```

各 `settings` 可覆盖默认配置（默认：关闭原生 auto compaction、`update: "disable"`、禁用 plan/build/general/explore、orchestrator 为主 agent、禁用 OMO observer 与各插件 autoUpdate）；模型密钥仍由使用者在运行环境中注入。

## 架构与范围说明

- **Monorepo 内置闭包**：自有内置插件（`clear-encrypted`, `session-reader`, `opencode-image`, `opencode-desktop-bridge`）在 `kernel/plugins/` 本地维护并归属 QoL 项目；`oh-my-opencode-slim@3.0.6` 与 `billion-context@0.1.206` 构建期统一锁定并收录到产物的 `vendor/`，无运行时 npm 安装。
- **官方 PTY 归一**：`kernel/src/native-pty.ts` 复用 `PersistentPty.Service` 与原生终端面板；`pty_read` 读取守护进程保留的最近 2 MiB 输出，支持分页和正则检索，不另建日志存储。工具终端退出后保留输出，清理或守护进程结束后释放；退出通知使用原生 synthetic 消息。
- **桌面桥接边界**：仅提供 `opencode-desktop-bridge` 插件包并采用新 RPC 标识，不保留旧名称兼容，不包含 Windows 原生前端程序。
- **随包 MCP**：Codegraph `1.6.2` 与 NixOS MCP `3.0.1` 的 stdio 服务程序随 Nix 闭包提供，内置插件自动注册；显式同名配置优先。Codegraph 索引由使用者创建，启动不自动索引项目。Context7 与 GitHub grep 沿用 Slim 的远程 MCP 定义。
- **QoL 标识**：首页显示小号 `qol`；版本展示动态追加 `-qol`，不改变上游版本、更新通道或状态目录。Sunburst 生成字标位于 `assets/branding/`，随包安装到 `share/opencode-qol/branding/`。
- **构建与验证**：当前未配置发布缓存，无缓存时由 Nix 本地构建。107 项源码与契约测试已通过，包含真实 PTY 守护进程与核心协议测试。整包验收还检查 CLI 版本、宿主插件注册及本地 MCP 连接；具体结果以交付时的构建与运行记录为准。本仓库不会自动部署到现用系统。

## 许可证与出处归属

- **本项目自有代码与内置插件**：自有内置插件属于 QoL 项目，不单列为第三方组件。项目采用 [GNU General Public License v3.0 or later](LICENSE)；已有独立许可证的文件或目录仍按其许可声明处理，本次归属整理不改变这些声明。
- **外部来源与第三方许可**：`vendor/` 下的生态插件及内置功能中引用的外部开源材料（如 NanoBanana、OpenAI 技能、GPT Taste 提示词等）保留各自原始开源许可证，不视作纯 GPL；详细外部来源清单参见 [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md)。
- **Billion Context 署名**：本项目使用 [Billion Context](https://github.com/ranxianglei/billion-context) 及其 [acp-kernel](https://github.com/ranxianglei/acp-kernel)。依据其许可附加条款（Attribution on Product Surfaces），在此明确标明出处与仓库链接，随附文档已满足出处标明要求。
