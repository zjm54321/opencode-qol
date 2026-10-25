# OpenCode QoL

OpenCode Solution 的单体后端包（Monorepo）：将固定版本的 OpenCode 核心、原生 Persistent PTY、内置个人插件与生态插件（OMO Slim、Billion Context）由 Nix 统一构建进单一闭包，免除运行时 npm 下载。当前面向 `x86_64-linux`。

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

- **Monorepo 内置闭包**：个人插件（`clear-encrypted`, `session-reader`, `opencode-image`, `opencode-desktop-bridge`）在 `plugins/` 本地维护，清理旧 repo/homepath 元数据；`oh-my-opencode-slim@3.0.5` 与 `billion-context@0.1.202` 源码收录于 `vendor/`，构建期统一锁定，无运行时 npm 安装。
- **官方 PTY 归一**：`src/native-pty.ts` 直接调用 OpenCode 核心自带的 `PersistentPty.Service`，旧 `bun-pty` 已删除；复用上游原生会话终端面板。当前 `pty_read` 仅输出屏幕快照，工具层尚未补齐历史读取、正则检索及退出通知。
- **桌面桥接边界**：仅提供 `opencode-desktop-bridge` 插件包并采用新 RPC 标识，不保留旧名称兼容，不包含 Windows 原生前端程序。
- **交付与验证状态**：NUR 结构本身不提供预编译缓存，无二进制缓存时由 Nix 本地构建；当前尚未配置发布缓存或预编译产物。v2.1.4 基线的 Nix 求值、补丁与注入点检查已通过；整包构建及运行时行为尚未验证，未修改或部署现用系统。

## 许可证与出处归属

- **本项目自有代码**：采用 [GNU General Public License v3.0 or later](LICENSE) 开源（详见 `LICENSE` 与 `package.json`）。该许可仅涵盖本项目自有且有权授权的原创代码与构建配置。
- **第三方组件归属**：所有第三方内置与 vendor 组件均保留各自原始开源许可，不视作纯 GPL；详细来源、版本与许可证清单参见 [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md)。
- **Billion Context 署名**：本项目使用 [Billion Context](https://github.com/ranxianglei/billion-context) 及其 [acp-kernel](https://github.com/ranxianglei/acp-kernel)。依据其许可附加条款（Attribution on Product Surfaces），在此明确标明出处与仓库链接，随附文档已满足出处标明要求。
