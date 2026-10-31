# Third-Party Notices & License Inventory

本项目（OpenCode QoL）的自有内置插件属于 QoL 项目，不单列为第三方组件。项目许可为 **GPL-3.0-or-later**，详见根目录 [LICENSE](LICENSE) 与 [package.json](package.json)；已有独立许可证的文件或目录仍按其许可声明处理。

本文件专用于记录由本项目整合、收录或引用的**真正外部第三方开源来源**（包括上游核心、vendor 生态组件以及内置功能引用的外部开源材料）。所有外部材料均保留其各自的原始许可与版权声明，本项目不对第三方内容作二次重许可声明，亦不将外部代码混称为纯 GPL。

> **说明**：本文件记录主要内置功能引用的外部材料、vendor 代码与上游核心来源，非 npm 传递依赖的完整 SBOM 清单。传递依赖树未执行全量审计，不对整树作全兼容断言。本项目当前未发布预编译二进制制品。

---

## 1. 上游核心 (Upstream Core)

- **组件**：OpenCode
- **固定版本**：v2.2.5（源码修订以 `flake.lock` 为准）
- **官方仓库**：[anomalyco/opencode](https://github.com/anomalyco/opencode)
- **许可证**：[MIT License](https://raw.githubusercontent.com/anomalyco/opencode/v2.2.5/LICENSE) (Copyright (c) 2025 opencode)
- **源码与构建说明**：上游核心源码未作为 vendored 源码签入仓库。构建时由 Nix Flake 锁定并拉取源码，通过本地构建脚本（`nix/prepare-source.mjs`、`nix/package.nix` 及补丁）装配。若后续发布二进制制品，将遵循对应许可要求提供配套源码映射与第三方告知；当前尚未发布。

### 1.1 原生 PTY 与终端解析

- **OpenCode PTY**：OpenCode `v2.2.5` 的 `packages/process-daemon`（与核心共用 `flake.lock` 修订），来源 [anomalyco/opencode](https://github.com/anomalyco/opencode)，MIT。
- **Ghostty VT**：修订 `ab0b9da9e88fcb4b0533a1854e84628f663930af`，来源 [ghostty-org/ghostty](https://github.com/ghostty-org/ghostty)，MIT。
- **构建与修改**：`flake.lock` 固定源码；`nix/pty-daemon.nix` 从源码构建并应用 `patches/native-pty-daemon.patch`。产物附带两者许可证及 `SOURCES.json`，见 `share/licenses/opencode-pty-qol/` 与 `share/doc/opencode-pty-qol/`。

---

## 2. 外部 Vendor 组件 (vendor/)

依据 [vendor/sources.json](vendor/sources.json) 锁定信息：

### 2.1 Billion Context 及 acp-kernel / pi-subagents

- **组件**：Billion Context
- **版本/修订**：`0.1.210` (commit `10821260a79fb4215699906184e05082156c89a5`)
- **源码仓库**：[ranxianglei/billion-context](https://github.com/ranxianglei/billion-context)
- **许可证**：MIT License with Additional Term — Attribution on Product Surfaces（详见 [vendor/billion-context/LICENSE](vendor/billion-context/LICENSE)）
- **配套组件**（同 Git 修订）：
  - **acp-kernel**（版本 `0.0.175`）：仓库 [ranxianglei/acp-kernel](https://github.com/ranxianglei/acp-kernel)，许可证详见 [vendor/billion-context/kernel/LICENSE](vendor/billion-context/kernel/LICENSE)。
  - **pi-subagents**（版本 `0.2.2`）：位于 [vendor/billion-context/pi-subagents](vendor/billion-context/pi-subagents)。
- **出处标注条款满足**：上游许可要求在产品首页、文档或“关于”页面至少一处标明出处与仓库 URL。本项目在 [README.md](README.md) 及本文档中均明确标示出处与链接，随附文档已满足该条款，无需额外产品 UI 修改。
- **溯源审计**：内核包含上游针对历史衍生代码的审计分类自述（详见 [vendor/billion-context/kernel/PROVENANCE.md](vendor/billion-context/kernel/PROVENANCE.md)）。本项目保留该链接以供查阅，不做独立的已排除 AGPL 担保。

### 2.2 oh-my-opencode-slim

- **组件**：oh-my-opencode-slim
- **版本/修订**：`3.0.6` (commit `48a4080dcea90e9defd5725e63304439243c01ba`)
- **源码仓库**：[alvinunreal/oh-my-opencode-slim](https://github.com/alvinunreal/oh-my-opencode-slim)
- **许可证**：MIT License

---

## 3. 内置功能引用的外部材料

位于 `plugins/` 内的自有内置插件本身属于本项目，但其中引入、摘录或适配了以下独立的外部第三方开源材料，原样保留其原始版权声明与许可文件：

### 3.1 Google Nano Banana 图像生成技能
- **引用路径**：`plugins/image/skills/image-generation/subskills/nanobanana/`
- **版权所有**：Copyright (c) 2026 Antonio Cárdenas, yeou.dev
- **许可证**：MIT License（详见 [LICENSE](plugins/image/skills/image-generation/subskills/nanobanana/LICENSE) 及 [SOURCE](plugins/image/skills/image-generation/subskills/nanobanana/SOURCE)）

### 3.2 OpenAI 图像生成技能
- **引用路径**：`plugins/image/skills/image-generation/subskills/openai/`
- **许可证**：Apache License 2.0（详见 [LICENSE.txt](plugins/image/skills/image-generation/subskills/openai/LICENSE.txt)）

### 3.3 GPT Taste 提示词模板
- **引用路径**：`plugins/gpt-taste/`
- **版权所有**：Copyright (c) 2026 GPT with Taste contributors, X-T-E-R
- **许可证**：MIT License（详见 [LICENSE](plugins/gpt-taste/LICENSE)）
- **来源记录**：提示词模板摘录自 NB-Corp/gpt-with-taste，修订见 [SOURCE](plugins/gpt-taste/SOURCE)。原许可中的其他材料署名继续保留；当前包不包含 TOML 词法扫描器实现。

---

## 4. 随包 MCP 服务

- **Codegraph**：`1.6.2`，[colbymchenry/codegraph](https://github.com/colbymchenry/codegraph)，MIT。保留上游服务程序及工具协议，使用固定哈希的发布产物。
- **NixOS MCP**：`3.0.2`，[utensils/mcp-nixos](https://github.com/utensils/mcp-nixos)，MIT；源码哈希由 `flake.lock` 中的 `mcp-nixpkgs` 固定。
- **装配与告知**：`nix/mcp-servers.nix` 使用独立固定的工具包集，不改变 OpenCode 核心的 Nixpkgs 输入。产物附带原许可证及 `SOURCES.json`，见 `share/licenses/opencode-qol-mcp/` 与 `share/doc/opencode-qol-mcp/`；各服务的传递依赖保留其原始许可。
