# Native UI slice

`kernel/plugins/native-ui` registers `native_ui({source, title?})` as a native built-in tool. Non-primary agents receive a deny rule for its permission. It does not replace desktop-bridge's RPC interface.

The source language is OpenUI Lang. Official MIT `@openuidev/lang-core` **1.1.0** parses and validates against the Zod library. Final incomplete input, unresolved references, unsupported components/actions, non-http(s) URL data and safety limits fail the actual tool call with line/column diagnostics. Successful output is a short acknowledgement; history retains the program in `state.input`, not in model-facing output.

`bun kernel/plugins/native-ui/scripts/generate-catalog.ts` generates `kernel/plugins/native-ui/catalog.json`. The JSON preserves OpenIntelligentUI's component names and positional prop order, includes JSON Schema types, reactive flags, parser version and limits. FluentCode embeds an identical copy; its focused conformance runner checks byte equality. Use `--check` to detect a stale generated catalog.

The first slice has Col, Row, Card, Divider, Title, Text, Caption, Badge, Markdown, Button, Input, Select, Slider and Checkbox. No HtmlView, HTML execution, images, file or network capability is provided. Query/Mutation/@Run are parseable, but only their defaults render and they are marked **未支持**. @OpenUrl is disabled in this pass. @ToAssistant is a user-click intent routed through FluentCode's ordinary guarded composer; an agent already working receives queue delivery.

The generated tool description measures **1,903 o200k_base tokens / 7,734 characters**. The server library/description share one definition list; token counting tooling is not a production dependency.

Run focused server checks with `bun test kernel/tests/qol-native-ui.test.ts kernel/tests/qol-tui-defaults.test.ts`. No server build, deployment or running-opencode replacement is needed.
