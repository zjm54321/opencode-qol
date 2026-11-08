# Recovering from validator diagnostics

`native_ui` validates the final program with the real `@openuidev/lang-core` parser, then enforces native schema and safety rules. Invalid source fails the tool call; it is not a rendered card. The error starts with **native_ui validation failed. Fix and retry** and points back to this skill's references.

Each diagnostic has the form `line N, column M [code]: message`. Line and column are 1-based locations in the exact `source` string, not in your surrounding chat. Inspect the first diagnostic, identify its component/prop path when present, consult [the component catalog](components.md), and fix the cause before retrying. Up to 32 diagnostics may be returned; a missing bracket can cause several later errors.

| Code | Repair |
| --- | --- |
| `syntax`, `incomplete`, `parse-failed` | Use `id = Expr` statements, JSON string escaping, and balanced brackets. Remove fences/HTML from `source`. Send a complete program, not a streaming fragment. |
| `no-root` | Define `root` as a native component (or an expression that resolves to one), not a scalar. |
| `unknown-component`, `unknown-function` | Use exact catalog names and the documented built-in functions/actions. `HtmlView` is excluded; metrics use Card/Title/Caption. |
| `missing-required`, `null-required` | Supply every required positional prop; skip only optional slots with `null`. |
| `type-mismatch`, `excess-args` | Check the prop's ordinal position, primitive type, enum, object shape, array bounds and numeric range. Do not shift later arguments into an omitted middle slot. |
| `unresolved` | Declare the named reference, fix case/spelling, or break a reference cycle. Keep `@Each` loop variables inside their inline template. Forward references themselves are allowed. |
| `action` | Use syntax calls such as `@Set($count, ...)` or `Action([...])`, not legacy action objects. |
| `url` | Use absolute HTTP(S) links; image/map/media loading requires HTTPS. Remove unsafe schemes and credentials. Do not relax the rule to make an example pass. |
| `limit` | Reduce source/string size, nesting or expanded reference duplication. Limits are 65,536 source characters, 16,384 per string, 4,096 nodes/tokens and depth 64. Repeated reference expansion also counts. |

For a wrong scalar type, repair the value rather than inventing a prop. For example, a Title needs string text:

```openui
root = Card([Title("42", "lg"), Caption("A number shown as text")])
```

For a later optional Button slot, preserve the intervening positions with `null`:

```openui
$count = 0
root = Col([Text("Count: " + $count), Button("Add", @Set($count, $count + 1), "solid", null, "md")])
```

A successful validation does not turn `Query`, `Mutation` or `@Run` into executable features: **未支持** is a renderer capability message. Replace that interaction with local `$state` / `@Set` / `@Reset`, or a user-click `@ToAssistant` request.
