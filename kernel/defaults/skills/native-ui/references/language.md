# OpenUI Lang for native cards

## Statements and expressions

Write one `id = Expr` statement per line. Define `root` as the displayed component; named statements can reference later statements. Use exact, case-sensitive component names. Ordinary identifiers are reusable values or expressions, not mutable state.

```openui
root = Card([heading, Text("Native controls"), Caption("Ready")])
heading = Title("Summary", "lg")
```

Pass component arguments **positionally**, in the catalog's schema order. Omit optional trailing arguments; use `null` to skip an optional slot before a later argument. Required props cannot be omitted or `null`. There are no named props, JSX tags, HTML, JavaScript statements or arbitrary function calls.

Use JSON-quoted strings, numbers, booleans, `null`, arrays `[...]` and objects `{key:value}`. Escape newlines and quotes inside strings. Expressions support `+ - * / %`, `== != < > <= >=`, `&& || !`, `condition ? a : b`, `data.key` and `data[index]`. String concatenation uses `+`. Keep each statement on one line even when composing several inline components.

## Local reactive state

Declare mutable state with `$name = initialValue`. Bind the catalog's **reactive** prop to that variable. Most input bindings are the first argument; `Map` binds its third argument (`selected`). Reading a variable in text, a chart, a drawing or another expression makes that output update when the state changes.

A reactive prop may also use an inline assignment, such as `Input($quantity = @Max([0, $value]), ...)`: `$value` is the control's incoming value and the expression transforms it before storing it. Use `$value` only in a binding expression, not as an independent state declaration.

```openui
$quantity = 2
root = Col([Input($quantity = @Max([0, $value]), "Quantity", "number"), Text("Total: " + @Round($quantity * 12, 2)), Button("Reset", @Reset($quantity))])
```

Every input should change a displayed result or feed an explicit `@ToAssistant` submission. A form with controls that do nothing is not a working interaction.

## Pure built-in functions

These operate on local values and expressions, without network or code execution:

| Call | Meaning |
| --- | --- |
| `@Count(array)` | Number of items. |
| `@First(array)`, `@Last(array)` | First/last item, or `null` for an empty array. |
| `@Sum(numbers)`, `@Avg(numbers)` | Sum/average of a numeric array. |
| `@Min(numbers)`, `@Max(numbers)` | Minimum/maximum of a numeric array; pass an array, not separate numbers. |
| `@Sort(array, field, direction?)` | Sort by a field/dot-path; `"asc"` is the default, or `"desc"`. Use an empty field string for plain values. |
| `@Filter(array, field, operator, value)` | Filter by `==`, `!=`, `>`, `<`, `>=`, `<=` or `"contains"`; an empty field targets plain values. |
| `@Round(number, decimals?)` | Round, with zero decimal places by default. |
| `@Abs(number)`, `@Floor(number)`, `@Ceil(number)` | Absolute value or rounding down/up; also operate elementwise on numeric arrays. |
| `@Each(array, "item", inlineTemplate)` | Evaluate the template for each item. The loop variable exists only inside this inline template. |

Do not extract an `@Each` template into a separate statement: its loop variable would be unresolved outside the template.

```openui
items = [{label:"Basic",price:12},{label:"Pro",price:24}]
root = Col([@Each(items, "item", Row([Text(item.label), Badge("$" + item.price)])), Text("Plans: " + @Count(items))])
```

## Actions

Actions are syntax calls in a component's action slot, never JSON action objects:

| Call | Effect |
| --- | --- |
| `@Set($state, expression)` | Store a new local value. |
| `@Reset($state, ...)` | Restore one or several variables to their declared defaults. |
| `@ToAssistant(shortMessage, context?)` | Send a user-click request through the normal composer; current form state accompanies it. Optional context may be an object, array, string or number. Delivery queues while the assistant is busy. |
| `@OpenUrl(absoluteHttpUrl)` | Ask the user to confirm the full HTTP(S) URL before opening it. |
| `Action([actions...])` | Run actions in order; each sees prior state changes. |

```openui
$count = 0
root = Col([Text("Count: " + $count), Button("Add and explain", Action([@Set($count, $count + 1), @ToAssistant("Please explain count " + $count)])), Button("Open documentation", @OpenUrl("https://www.openui.com/docs"))])
```

A `Button` with no action sends its label to the assistant; use an explicit action for predictable local behavior. An `IconButton` has no implicit assistant action. Use short, understandable first-person messages for assistant submissions.

## Unsupported execution

`Query`, `Mutation` and `@Run` may parse, but FluentCode does not execute them: parsed defaults remain and the renderer shows **未支持** (unsupported). Do not use them for working interactions. There is no card command runner, file editor, arbitrary network client, script interpreter, HTML renderer or `HtmlView`. `Math` displays LaTeX source as text in this version, not typeset mathematics.
