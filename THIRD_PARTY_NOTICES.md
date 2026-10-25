# Third-Party Notices & License Inventory

本项目（OpenCode QoL）自有代码与构建配置声明以 **GNU General Public License v3.0 or later (GPL-3.0-or-later)** 授权，详见根目录 [LICENSE](LICENSE) 与 [package.json](package.json)。

此 GPL 声明仅适用于本项目自有且有权授权的原创代码与配置。本项目收录、引用或链接的第三方开源组件均保留各自的原始许可与版权声明，不将第三方依赖或 vendor 目录统一重命名为纯 GPL。

> **说明**：本文件记录主要内置组件、vendor 代码与上游核心来源，非 npm 传递依赖的完整 SBOM 清单。传递依赖树未执行全量审计，不对整树作全兼容断言。本项目当前未发布预编译二进制。

---

## 1. 上游核心 (Upstream Core)

- **组件**：OpenCode
- **固定版本**：v2.1.4（源码修订以 `flake.lock` 为准）
- **官方仓库**：[anomalyco/opencode](https://github.com/anomalyco/opencode)
- **许可证**：[MIT License](https://raw.githubusercontent.com/anomalyco/opencode/v2.1.4/LICENSE) (Copyright (c) 2025 opencode)
- **源码与构建说明**：上游核心源码未作为 vendored 源码签入仓库。构建时由 Nix Flake 锁定并拉取源码，通过本地构建脚本（`nix/prepare-source.mjs`、`nix/package.nix` 及补丁）装配。若后续发布二进制制品，将遵循对应许可要求提供配套源码映射与第三方告知；当前尚未发布。

---

## 2. Vendor 第三方依赖 (vendor/)

依据 [vendor/sources.json](vendor/sources.json) 锁定信息：

### 2.1 Billion Context 及 acp-kernel

- **组件**：Billion Context
- **版本/修订**：`0.1.202` (commit `6deb4547e57af6203bcedd3739fdc63b75443aec`)
- **源码仓库**：[ranxianglei/billion-context](https://github.com/ranxianglei/billion-context)
- **许可证**：MIT License with Additional Term — Attribution on Product Surfaces（详见 [vendor/billion-context/LICENSE](vendor/billion-context/LICENSE)）
- **内核组件**：acp-kernel
  - **仓库**：[ranxianglei/acp-kernel](https://github.com/ranxianglei/acp-kernel)
  - **许可证**：MIT License with Additional Term — Attribution on Product Surfaces（详见 [vendor/billion-context/kernel/LICENSE](vendor/billion-context/kernel/LICENSE)）
- **出处标注条款满足**：上游许可要求在产品首页、文档或“关于”页面至少一处标明出处与仓库 URL。本项目在 [README.md](README.md) 及本文档中均明确标示出处与链接，随附文档已满足该条款，无需额外产品 UI 修改。
- **溯源审计**：内核包含上游针对历史衍生代码的审计分类自述（详见 [vendor/billion-context/kernel/PROVENANCE.md](vendor/billion-context/kernel/PROVENANCE.md)）。本项目保留该链接以供查阅，不做独立的已排除 AGPL 担保。

### 2.2 oh-my-opencode-slim

- **组件**：oh-my-opencode-slim
- **版本/修订**：`3.0.5` (commit `fc76b4fc1f41520c0923916564f7a3ef51f5bc7b`)
- **源码仓库**：[alvinunreal/oh-my-opencode-slim](https://github.com/alvinunreal/oh-my-opencode-slim)
- **许可证**：MIT License

---

## 3. 本地内置插件与扩展 (plugins/)

### 3.1 clear-encrypted (`plugins/clear-encrypted/`)
- **许可证**：GPL-3.0-or-later（见 [plugins/clear-encrypted/package.json](plugins/clear-encrypted/package.json) 与 [plugins/clear-encrypted/LICENSE](plugins/clear-encrypted/LICENSE)）

### 3.2 session-reader (`plugins/session-reader/`)
- **许可证**：GPL-3.0-or-later（见 [plugins/session-reader/package.json](plugins/session-reader/package.json) 与 [plugins/session-reader/LICENSE](plugins/session-reader/LICENSE)）

### 3.3 opencode-image (`plugins/image/`)
- **许可证**：MIT License（见 [plugins/image/LICENSE](plugins/image/LICENSE)，Copyright (c) 2026 zjm54321）
- **子技能引用**：
  - **Google Nano Banana** (`plugins/image/skills/image-generation/subskills/nanobanana/`)：MIT License（Copyright (c) 2026 Antonio Cárdenas, yeou.dev，见其 [LICENSE](plugins/image/skills/image-generation/subskills/nanobanana/LICENSE) 及 [SOURCE](plugins/image/skills/image-generation/subskills/nanobanana/SOURCE)）
  - **OpenAI Image Generation** (`plugins/image/skills/image-generation/subskills/openai/`)：Apache License 2.0（见其 [LICENSE.txt](plugins/image/skills/image-generation/subskills/openai/LICENSE.txt)）

### 3.4 gpt-taste (`plugins/gpt-taste/`)
- **许可证**：MIT License（见 [plugins/gpt-taste/LICENSE](plugins/gpt-taste/LICENSE)，Copyright (c) 2026 GPT with Taste contributors, X-T-E-R）
- **来源记录**：Prompt 模板摘录自 NB-Corp/gpt-with-taste (commit `27e7da1`)，TOML overlay 适配自 nb-codex-main（见 [plugins/gpt-taste/SOURCE](plugins/gpt-taste/SOURCE)）

### 3.5 opencode-desktop-bridge (`plugins/desktop-bridge/`)
- **许可证**：GPL-3.0-or-later
- **说明**：该插件已由权利人确认按 GPL-3.0-or-later 授权，适用根目录 [LICENSE](LICENSE)。
