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

- **Monorepo 内置闭包**：自有内置插件（`clear-encrypted`, `session-reader`, `opencode-image`, `opencode-desktop-bridge`）在 `plugins/` 本地维护并归属 QoL 项目；`oh-my-opencode-slim@3.0.6` 与 `billion-context@0.1.206` 源码收录于 `vendor/`，构建期统一锁定，无运行时 npm 安装。
- **官方 PTY 归一**：`src/native-pty.ts` 复用 `PersistentPty.Service` 与原生终端面板；`pty_read` 读取守护进程保留的最近 2 MiB 输出，支持分页和正则检索，不另建日志存储。工具终端退出后保留输出，清理或守护进程结束后释放；退出通知使用原生 synthetic 消息。
- **桌面桥接边界**：仅提供 `opencode-desktop-bridge` 插件包并采用新 RPC 标识，不保留旧名称兼容，不包含 Windows 原生前端程序。
- **随包 MCP**：Codegraph `1.6.2` 与 NixOS MCP `3.0.1` 的 stdio 服务程序随 Nix 闭包提供，内置插件自动注册；显式同名配置优先。Codegraph 索引由使用者创建，启动不自动索引项目。Context7 与 GitHub grep 沿用 Slim 的远程 MCP 定义。
- **QoL 标识**：首页显示小号 `qol`；版本展示动态追加 `-qol`，不改变上游版本、更新通道或状态目录。Sunburst 生成字标位于 `assets/branding/`，随包安装到 `share/opencode-qol/branding/`。
- **构建与验证**：当前未配置发布缓存，无缓存时由 Nix 本地构建。107 项源码与契约测试已通过，包含真实 PTY 守护进程与核心协议测试。整包验收还检查 CLI 版本、宿主插件注册及本地 MCP 连接；具体结果以交付时的构建与运行记录为准。本仓库不会自动部署到现用系统。

## 许可证与出处归属

- **本项目自有代码与内置插件**：自有内置插件属于 QoL 项目，不单列为第三方组件。项目采用 [GNU General Public License v3.0 or later](LICENSE)；已有独立许可证的文件或目录仍按其许可声明处理，本次归属整理不改变这些声明。
- **外部来源与第三方许可**：`vendor/` 下的生态插件及内置功能中引用的外部开源材料（如 NanoBanana、OpenAI 技能、GPT Taste 提示词等）保留各自原始开源许可证，不视作纯 GPL；详细外部来源清单参见 [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md)。
- **Billion Context 署名**：本项目使用 [Billion Context](https://github.com/ranxianglei/billion-context) 及其 [acp-kernel](https://github.com/ranxianglei/acp-kernel)。依据其许可附加条款（Attribution on Product Surfaces），在此明确标明出处与仓库链接，随附文档已满足出处标明要求。
