---
name: native-ui
description: "Render user-requested interactive or structured UI in FluentCode with native_ui. Load this skill whenever preparing a native calculator, form, dashboard, chart, table, comparison, plan, map or media card, and before the first native_ui call. Requires the native_ui tool and FluentCode; not for plain answers, code or unsolicited UI."
---

# Native UI in FluentCode

`native_ui` renders OpenUI Lang as native WinUI 3 controls inside the FluentCode transcript. There is no HTML or WebView inside a card. Its state is local and reactive: controls update the card without another model turn.

## Workflow

1. Confirm that the user requested an interactive or structured display and that `native_ui` is available. Use it for calculators, forms, dashboards, comparisons, plans, maps and media. Keep plain answers and code in normal chat; do not add interactive UI the user did not ask for. This skill does not provide a renderer to other clients.
2. Read [the language guide](references/language.md) and [native behavior, safety and Fluent design](references/behavior-and-design.md) before your first card.
3. Look up unfamiliar components in [the generated full catalog](references/components.md). It lists all 57 components, positional props, reactive bindings, enums and short validated examples. Do not guess prop order or use HTML.
4. Adapt a [worked example](references/examples.md): calculator with memory, chart/table dashboard, assistant-submitting form, map with a route, or media gallery. Make every input affect a visible result or an explicit submission. Give labels, content and footers in the user's language.
5. Pass the complete OpenUI Lang program in `native_ui`'s `source` string and, optionally, a short `title`. Do not put a Markdown fence inside `source`. A successful call returns a short acknowledgement; the card appears in the transcript, so do not echo the whole program in chat.
6. If validation fails, follow [error recovery](references/error-recovery.md), fix the reported line/column and retry.

## Essential boundaries

- Images, maps and media require HTTPS and the user's click before loading. Show the real user/tool-provided URLs; example URLs are placeholders, not discovered assets.
- `@OpenUrl` asks for confirmation. `@ToAssistant` uses the normal composer and queues while the assistant is busy; write a short first-person request, not an instruction to bypass safeguards.
- Supply WGS-84 map coordinates; the renderer handles provider conversion. YouTube opens in the in-app browser, not an embedded card player.
- Cards cannot run commands or edit files. `Query`, `Mutation` and `@Run` are unsupported and show **未支持**; use local state or an explicit assistant submission instead.
