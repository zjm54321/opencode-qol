# Native component catalog

<!-- Generated from components.ts, library.ts and reference.ts. Do not edit by hand. -->
Regenerate with `bun kernel/plugins/native-ui/scripts/generate-skill-reference.ts`; use `--check` to detect drift.

Library: `fluentcode-native-ui@0.2.0`. All 57 components below use positional arguments in the listed order. `?` marks an optional prop; use `null` to skip it. Bind a **reactive** prop to a `$variable` (or an inline assignment using `$value`). Other props can read expressions and update when state changes.

Limits: 65536 source characters, 16384 characters per string, 4096 nodes, depth 64.

## Contents

- [Shared types](#shared-types)
- [Col](#col)
- [Row](#row)
- [Card](#card)
- [Divider](#divider)
- [Title](#title)
- [Text](#text)
- [Caption](#caption)
- [Badge](#badge)
- [Markdown](#markdown)
- [Button](#button)
- [Input](#input)
- [Select](#select)
- [Slider](#slider)
- [Checkbox](#checkbox)
- [Chart](#chart)
- [Table](#table)
- [TextArea](#textarea)
- [SegmentedControl](#segmentedcontrol)
- [RadioGroup](#radiogroup)
- [DatePicker](#datepicker)
- [Timer](#timer)
- [IconButton](#iconbutton)
- [Pressable](#pressable)
- [Box](#box)
- [Grid](#grid)
- [Form](#form)
- [Spacer](#spacer)
- [Carousel](#carousel)
- [Popover](#popover)
- [Label](#label)
- [Link](#link)
- [ListItem](#listitem)
- [List](#list)
- [Quote](#quote)
- [Code](#code)
- [Math](#math)
- [Flashcard](#flashcard)
- [Celebration](#celebration)
- [Image](#image)
- [Video](#video)
- [Audio](#audio)
- [ImageGallery](#imagegallery)
- [SearchImage](#searchimage)
- [Icon](#icon)
- [MapMarker](#mapmarker)
- [Map](#map)
- [YouTube](#youtube)
- [Svg](#svg)
- [G](#g)
- [Circle](#circle)
- [Ellipse](#ellipse)
- [Rect](#rect)
- [Line](#line)
- [Path](#path)
- [Polyline](#polyline)
- [Polygon](#polygon)
- [SvgText](#svgtext)

## Shared types

The prop schemas below are generated JSON Schema, including enum values, bounds and array/object shapes. A Node is a native component or expression. Color strings should use native theme tokens. ActionExpression slots accept syntax calls, not the legacy data-object shapes in the upstream schema: use `@Set`, `@Reset`, `@ToAssistant`, `@OpenUrl` or `Action([...])`; see [the language guide](language.md).

- `ActionExpression`: `{"anyOf":[{"type":"object","properties":{"type":{"type":"string","const":"open_url"},"url":{"type":"string"}},"required":["type","url"],"additionalProperties":false},{"type":"object","properties":{"type":{"type":"string","const":"continue_conversation"},"context":{"type":"string"}},"required":["type"],"additionalProperties":false},{"type":"object","properties":{"type":{"type":"string"},"params":{"type":"object","propertyNames":{"type":"string"},"additionalProperties":{}}},"required":["type"],"additionalProperties":false}]}`

## Col

`Col(children, gap, align)`

Vertical layout.

Props in positional order:
- `children`: `{"type":"array","items":{}}`
- `gap?`: `{"type":"number"}`
- `align?`: `{"type":"string","enum":["start","center","end","stretch"]}`

Reactive props: none.

Example:

```openui
root = Col([Text("Hello"), Caption("Ready")])
```

## Row

`Row(children, gap, align, justify, wrap)`

Horizontal layout.

Props in positional order:
- `children`: `{"type":"array","items":{}}`
- `gap?`: `{"type":"number"}`
- `align?`: `{"type":"string","enum":["start","center","end","stretch"]}`
- `justify?`: `{"type":"string","enum":["start","center","end","between"]}`
- `wrap?`: `{"type":"boolean"}`

Reactive props: none.

Example:

```openui
root = Row([Text("Left"), Spacer(), Text("Right")])
```

## Card

`Card(children, variant, padding, gap)`

Native panel.

Props in positional order:
- `children`: `{"type":"array","items":{}}`
- `variant?`: `{"type":"string","enum":["outline","soft"]}`
- `padding?`: `{"type":"number"}`
- `gap?`: `{"type":"number"}`

Reactive props: none.

Example:

```openui
root = Card([Caption("Revenue"), Title("¥12,000", "2xl")], "soft")
```

## Divider

`Divider()`

Native component.

Props in positional order:
- None.

Reactive props: none.

Example:

```openui
root = Col([Text("Before"), Divider(), Text("After")])
```

## Title

`Title(text, size, color)`

Heading or large number.

Props in positional order:
- `text`: `{"type":"string"}`
- `size?`: `{"type":"string","enum":["sm","md","lg","xl","2xl","3xl"]}`
- `color?`: `{"type":"string"}`

Reactive props: none.

Example:

```openui
root = Title("Summary", "lg")
```

## Text

`Text(text, size, color, weight, italic, lineThrough, tabularNums, maxLines)`

Paragraph; text can mix strings and nodes.

Props in positional order:
- `text`: `{"anyOf":[{"type":"string"},{"type":"array","items":{}}]}`
- `size?`: `{"type":"string","enum":["xs","sm","md","lg"]}`
- `color?`: `{"type":"string"}`
- `weight?`: `{"type":"string","enum":["normal","medium","semibold"]}`
- `italic?`: `{"type":"boolean"}`
- `lineThrough?`: `{"type":"boolean"}`
- `tabularNums?`: `{"type":"boolean"}`
- `maxLines?`: `{"type":"number"}`

Reactive props: none.

Example:

```openui
root = Text(["Ready ", Badge("OK")])
```

## Caption

`Caption(text, color)`

Secondary text.

Props in positional order:
- `text`: `{"type":"string"}`
- `color?`: `{"type":"string"}`

Reactive props: none.

Example:

```openui
root = Caption("Updated today")
```

## Badge

`Badge(text, color, icon)`

Small tag.

Props in positional order:
- `text`: `{"type":"string"}`
- `color?`: `{"type":"string","enum":["neutral","info","success","warning","danger","purple","pink"]}`
- `icon?`: `{"type":"string"}`

Reactive props: none.

Example:

```openui
root = Badge("Complete", "success", "check")
```

## Markdown

`Markdown(text)`

Native prose, lists, code and tables; no external resources.

Props in positional order:
- `text`: `{"type":"string"}`

Reactive props: none.

Example:

```openui
root = Markdown("## Notes\n- Native controls")
```

## Button

`Button(label, action, variant, color, size, icon, disabled, block)`

Click action. With no action, sends its label to the assistant. size sm/md/lg selects 32/40/48px. Buttons fill Grid cells and button-only Rows. Omit size on short-label keypad keys for adaptive height: 0.8 times column width, clamped to 40–56px; explicit size overrides it.
Native sizing: sm=32px, md=40px, lg=48px. Buttons fill Grid cells and button-only Rows. For calculator keys (labels of 1–2 characters), omit size to adapt height to 0.8× column width, clamped to 40–56px. Explicit size always wins.

Props in positional order:
- `label`: `{"type":"string"}`
- `action?`: `{"$ref":"#/$defs/ActionExpression"}`
- `variant?`: `{"type":"string","enum":["solid","outline","soft","ghost"]}`
- `color?`: `{"type":"string","enum":["primary","danger","success"]}`
- `size?`: `{"type":"string","enum":["sm","md","lg"]}`
- `icon?`: `{"type":"string"}`
- `disabled?`: `{"type":"boolean"}`
- `block?`: `{"type":"boolean"}`

Reactive props: none.

Example:

```openui
$n = 0
root = Col([Text("Count: " + $n), Button("Add", @Set($n, $n + 1))])
```

## Input

`Input(value, label, type, placeholder)`

Text/number input bound to a $variable.

Props in positional order:
- `value` **reactive**: `{"type":["string","number"]}`
- `label?`: `{"type":"string"}`
- `type?`: `{"type":"string","enum":["text","number"]}`
- `placeholder?`: `{"type":"string"}`

Reactive props: `value`.

Example:

```openui
$name = ""
root = Col([Input($name, "Name"), Text("Hello " + $name)])
```

## Select

`Select(value, options, label, placeholder)`

Dropdown bound to a $variable.

Props in positional order:
- `value` **reactive**: `{"type":"string"}`
- `options`: `{"type":"array","items":{"anyOf":[{"type":"string"},{"type":"object","properties":{"value":{"type":"string"},"label":{"type":"string"}},"required":["value","label"],"additionalProperties":false}]}}`
- `label?`: `{"type":"string"}`
- `placeholder?`: `{"type":"string"}`

Reactive props: `value`.

Example:

```openui
$v = "A"
root = Col([Select($v, ["A", "B"], "Plan"), Text($v)])
```

## Slider

`Slider(value, min, max, step, label, unit, marks)`

Numeric range bound to a $variable.

Props in positional order:
- `value` **reactive**: `{"type":"number"}`
- `min`: `{"type":"number"}`
- `max`: `{"type":"number"}`
- `step?`: `{"type":"number"}`
- `label?`: `{"type":"string"}`
- `unit?`: `{"type":"string"}`
- `marks?`: `{"type":"array","items":{"type":"object","properties":{"value":{"type":"number"},"label":{"type":"string"}},"required":["value","label"],"additionalProperties":false}}`

Reactive props: `value`.

Example:

```openui
$n = 2
root = Col([Slider($n, 1, 10, 1, "Quantity"), Text("Total: " + $n * 12)])
```

## Checkbox

`Checkbox(checked, label, lineThrough)`

Boolean input bound to a $variable.

Props in positional order:
- `checked` **reactive**: `{"type":"boolean"}`
- `label`: `{"type":"string"}`
- `lineThrough?`: `{"type":"boolean"}`

Reactive props: `checked`.

Example:

```openui
$done = false
root = Col([Checkbox($done, "Done"), Text($done ? "Ready" : "Pending")])
```

## Chart

`Chart(type, data, x, series, format, currency, stacked, height)`

Native chart. Rows of data; x is the category key (numeric for scatter); series defaults to numeric keys other than x (up to 8). Percent values are like 45, not 0.45; currency is an ISO code like EUR. Stacking applies to bar/area; height clamps to 140–480 px.

Props in positional order:
- `type`: `{"type":"string","enum":["bar","line","area","pie","donut","scatter"]}`
- `data`: `{"type":"array","items":{"type":"object","propertyNames":{"type":"string"},"additionalProperties":{"type":["string","number"]}}}`
- `x?`: `{"type":"string"}`
- `series?`: `{"type":"array","items":{"type":"string"}}`
- `format?`: `{"type":"string","enum":["number","currency","percent"]}`
- `currency?`: `{"type":"string"}`
- `stacked?`: `{"type":"boolean"}`
- `height?`: `{"type":"number"}`

Reactive props: none.

Example:

```openui
root = Chart("bar", [{month:"Jan",sales:12},{month:"Feb",sales:18}], "month", ["sales"])
```

## Table

`Table(columns, rows)`

Native sortable, resizable table. Each row lists cells in column order; cells may be components. Numeric columns align right.

Props in positional order:
- `columns`: `{"type":"array","items":{"type":"string"}}`
- `rows`: `{"type":"array","items":{"type":"array","items":{}}}`

Reactive props: none.

Example:

```openui
root = Table(["Plan", "Status", "Price"], [["Basic", Badge("Ready", "success"), 12],["Pro", Badge("Trial"), 24]])
```

## TextArea

`TextArea(value, label, placeholder, rows)`

Multiline text field bound to a $variable; rows clamps to 2–20.

Props in positional order:
- `value` **reactive**: `{"type":"string"}`
- `label?`: `{"type":"string"}`
- `placeholder?`: `{"type":"string"}`
- `rows?`: `{"type":"number"}`

Reactive props: `value`.

Example:

```openui
$note = ""
root = Col([TextArea($note, "Notes"), Text($note)])
```

## SegmentedControl

`SegmentedControl(value, options, block)`

Two to four short choices. Options are strings or {value,label}; block fills the available width.

Props in positional order:
- `value` **reactive**: `{"type":"string"}`
- `options`: `{"type":"array","items":{"anyOf":[{"type":"string"},{"type":"object","properties":{"value":{"type":"string"},"label":{"type":"string"}},"required":["value","label"],"additionalProperties":false}]}}`
- `block?`: `{"type":"boolean"}`

Reactive props: `value`.

Example:

```openui
$v = "Day"
root = Col([SegmentedControl($v, ["Day", "Week", "Month"], true), Text($v)])
```

## RadioGroup

`RadioGroup(value, options, label, variant)`

Single choice. list uses radio buttons; pills uses segmented choices; cards includes descriptions.

Props in positional order:
- `value` **reactive**: `{"type":"string"}`
- `options`: `{"type":"array","items":{"anyOf":[{"type":"string"},{"type":"object","properties":{"value":{"type":"string"},"label":{"type":"string"},"description":{"type":"string"}},"required":["value","label"],"additionalProperties":false}]}}`
- `label?`: `{"type":"string"}`
- `variant?`: `{"type":"string","enum":["list","pills","cards"]}`

Reactive props: `value`.

Example:

```openui
$v = "safe"
root = Col([RadioGroup($v, [{value:"safe",label:"Safe",description:"More checks"},"Fast"], "Mode", "cards"), Text($v)])
```

## DatePicker

`DatePicker(value, label, min, max)`

Native calendar picker; value/min/max use YYYY-MM-DD.

Props in positional order:
- `value` **reactive**: `{"type":"string"}`
- `label?`: `{"type":"string"}`
- `min?`: `{"type":"string"}`
- `max?`: `{"type":"string"}`

Reactive props: `value`.

Example:

```openui
$date = "2026-11-07"
root = Col([DatePicker($date, "Date", "2026-01-01", "2026-12-31"), Text($date)])
```

## Timer

`Timer(seconds, label)`

Countdown with start/pause/reset; decrements bound seconds to zero. Pauses when the card leaves the visual tree.

Props in positional order:
- `seconds` **reactive**: `{"type":"number"}`
- `label?`: `{"type":"string"}`

Reactive props: `seconds`.

Example:

```openui
$left = 60
root = Col([Timer($left, "Focus"), Text($left == 0 ? "Done" : "Time left")])
```

## IconButton

`IconButton(icon, action, label, variant, size)`

Icon-only button. Supply a label for accessibility; no implicit assistant action. size sm/md/lg selects 32/40/48px.
Native sizing: sm=32px, md=40px, lg=48px. Buttons fill Grid cells and button-only Rows. For calculator keys (labels of 1–2 characters), omit size to adapt height to 0.8× column width, clamped to 40–56px. Explicit size always wins.

Props in positional order:
- `icon`: `{"type":"string"}`
- `action?`: `{"$ref":"#/$defs/ActionExpression"}`
- `label?`: `{"type":"string"}`
- `variant?`: `{"type":"string","enum":["outline","ghost","solid"]}`
- `size?`: `{"type":"string","enum":["sm","md","lg"]}`

Reactive props: none.

Example:

```openui
$n = 0
root = Col([Text("Count: " + $n), IconButton("plus", @Set($n, $n + 1), "Add")])
```

## Pressable

`Pressable(children, action, selected, padding, background, radius)`

Keyboard-accessible clickable tile; nested controls retain their own input.

Props in positional order:
- `children`: `{"type":"array","items":{}}`
- `action?`: `{"$ref":"#/$defs/ActionExpression"}`
- `selected?`: `{"type":"boolean"}`
- `padding?`: `{"type":"number"}`
- `background?`: `{"type":"string"}`
- `radius?`: `{"anyOf":[{"type":"string","enum":["sm","md","lg","xl","full"]},{"type":"number"}]}`

Reactive props: none.

Example:

```openui
$v = false
root = Col([Pressable([Text("Choose")], @Set($v, !$v), $v), Text($v ? "Chosen" : "Choose a tile")])
```

## Box

`Box(children, direction, gap, padding, background, radius, border, width, height, flex, align, justify, wrap)`

Flex container, column by default. Lengths are pixels or percentages; gap/padding are 4px steps.

Props in positional order:
- `children?`: `{"type":"array","items":{}}`
- `direction?`: `{"type":"string","enum":["row","col"]}`
- `gap?`: `{"type":"number"}`
- `padding?`: `{"type":"number"}`
- `background?`: `{"type":"string"}`
- `radius?`: `{"anyOf":[{"type":"string","enum":["sm","md","lg","xl","full"]},{"type":"number"}]}`
- `border?`: `{"type":"boolean"}`
- `width?`: `{"type":["number","string"]}`
- `height?`: `{"type":["number","string"]}`
- `flex?`: `{"type":"number"}`
- `align?`: `{"type":"string","enum":["start","center","end","stretch"]}`
- `justify?`: `{"type":"string","enum":["start","center","end","between"]}`
- `wrap?`: `{"type":"boolean"}`

Reactive props: none.

Example:

```openui
root = Box([Text("Panel")], "col", 3, 4, "surface", "lg", true)
```

## Grid

`Grid(children, columns, minChildWidth, gap)`

Equal columns (default 2, maximum 12); minChildWidth reduces columns on narrow cards.

Props in positional order:
- `children`: `{"type":"array","items":{}}`
- `columns?`: `{"type":"number"}`
- `minChildWidth?`: `{"type":"number"}`
- `gap?`: `{"type":"number"}`

Reactive props: none.

Example:

```openui
root = Grid([Card([Text("A")]), Card([Text("B")])], 2, 180, 3)
```

## Form

`Form(children)`

Groups fields; current state accompanies @ToAssistant.

Props in positional order:
- `children`: `{"type":"array","items":{}}`

Reactive props: none.

Example:

```openui
$name = ""
root = Form([Input($name, "Name"), Button("Ask", @ToAssistant("Help me plan for " + $name))])
```

## Spacer

`Spacer()`

Fills free space in a Row.

Props in positional order:
- None.

Reactive props: none.

Example:

```openui
root = Row([Text("Left"), Spacer(), Text("Right")])
```

## Carousel

`Carousel(children, itemWidth, gap)`

Horizontally scrolling native items; itemWidth defaults to 240 px (80–640).

Props in positional order:
- `children`: `{"type":"array","items":{}}`
- `itemWidth?`: `{"type":"number"}`
- `gap?`: `{"type":"number"}`

Reactive props: none.

Example:

```openui
root = Carousel([Card([Text("One")]), Card([Text("Two")])], 240, 3)
```

## Popover

`Popover(trigger, content)`

Click trigger to show content in a native flyout. Slots are strings or lists of components.

Props in positional order:
- `trigger`: `{"anyOf":[{"type":"string"},{"type":"array","items":{}}]}`
- `content`: `{"anyOf":[{"type":"string"},{"type":"array","items":{}}]}`

Reactive props: none.

Example:

```openui
root = Popover("Details", [Text("More information")])
```

## Label

`Label(text)`

Field or group label.

Props in positional order:
- `text`: `{"type":"string"}`

Reactive props: none.

Example:

```openui
root = Label("Group")
```

## Link

`Link(text, url)`

http(s) external link; always asks for confirmation showing the full URL.

Props in positional order:
- `text`: `{"type":"string"}`
- `url`: `{"type":"string"}`

Reactive props: none.

Example:

```openui
root = Link("Open documentation", "https://www.openui.com/docs")
```

## ListItem

`ListItem(title, description, marker, children)`

List entry; marker replaces its bullet/number, e.g. a time or emoji.

Props in positional order:
- `title`: `{"type":"string"}`
- `description?`: `{"type":"string"}`
- `marker?`: `{"type":"string"}`
- `children?`: `{"type":"array","items":{}}`

Reactive props: none.

Example:

```openui
root = ListItem("Prepare", "Check inputs", "1", [Badge("Ready")])
```

## List

`List(items, marker, timeline)`

List of strings/ListItem; timeline connects markers.

Props in positional order:
- `items`: `{"type":"array","items":{"anyOf":[{"type":"string"},{"$ref":"#/$defs/ListItem"}]}}`
- `marker?`: `{"type":"string","enum":["bullet","number","none"]}`
- `timeline?`: `{"type":"boolean"}`

Reactive props: none.

Example:

```openui
root = List([ListItem("Start", "Gather data", "1"), ListItem("Finish", "Review", "2")], "number", true)
```

## Quote

`Quote(text, cite)`

Quotation/callout with a side rule and optional attribution.

Props in positional order:
- `text`: `{"type":"string"}`
- `cite?`: `{"type":"string"}`

Reactive props: none.

Example:

```openui
root = Quote("Make it useful.", "Team")
```

## Code

`Code(code, language)`

Native code block with copy; never executes code.

Props in positional order:
- `code`: `{"type":"string"}`
- `language?`: `{"type":"string"}`

Reactive props: none.

Example:

```openui
root = Code("console.log(42)", "javascript")
```

## Math

`Math(tex, inline)`

LaTeX source displayed as native text in v1 (not typeset).

Props in positional order:
- `tex`: `{"type":"string"}`
- `inline?`: `{"type":"boolean"}`

Reactive props: none.

Example:

```openui
root = Math("E = mc^2")
```

## Flashcard

`Flashcard(front, back, hint)`

Tap to flip front/back; flip state is retained with the card.

Props in positional order:
- `front`: `{"anyOf":[{"type":"string"},{"type":"array","items":{}}]}`
- `back`: `{"anyOf":[{"type":"string"},{"type":"array","items":{}}]}`
- `hint?`: `{"type":"string"}`

Reactive props: none.

Example:

```openui
root = Flashcard("Capital of France?", "Paris", "Tap to flip")
```

## Celebration

`Celebration(when)`

Native celebratory feedback when the condition changes from false to true.

Props in positional order:
- `when`: `{"type":"boolean"}`

Reactive props: none.

Example:

```openui
$done = false
root = Col([Checkbox($done, "Complete"), Celebration($done)])
```

## Image

`Image(src, alt, aspectRatio, radius, fit)`

User/tool-provided HTTPS image. Never fetched automatically: a 点击加载 placeholder shows the full URL first. No automatic search fallback.

Props in positional order:
- `src`: `{"type":"string"}`
- `alt`: `{"type":"string"}`
- `aspectRatio?`: `{"type":"number"}`
- `radius?`: `{"anyOf":[{"type":"string","enum":["sm","md","lg","xl","full"]},{"type":"number"}]}`
- `fit?`: `{"type":"string","enum":["cover","contain"]}`

Reactive props: none.

Example:

```openui
root = Image("https://example.org/photo.png", "Photo")
```

## Video

`Video(src, title, height)`

HTTPS video played inside a native MediaPlayerElement with transport controls and full-window support. Shows full URL; click to load, never autoplay. Redirects stay HTTPS; up to 128 MB, system-supported codecs. Pauses on unload.

Props in positional order:
- `src`: `{"type":"string"}`
- `title?`: `{"type":"string"}`
- `height?`: `{"type":"number"}`

Reactive props: none.

Example:

```openui
root = Video("https://media.example.org/demo.mp4", "Product tour", 320)
```

## Audio

`Audio(src, title)`

HTTPS audio played inside a native MediaPlayerElement with transport controls. Shows full URL; click to load, never autoplay. Redirects stay HTTPS; up to 128 MB, system-supported codecs. Pauses on unload.

Props in positional order:
- `src`: `{"type":"string"}`
- `title?`: `{"type":"string"}`

Reactive props: none.

Example:

```openui
root = Audio("https://media.example.org/intro.mp3", "Introduction")
```

## ImageGallery

`ImageGallery(images, title, height)`

Click-loaded image gallery, 1–12 HTTPS images (8 MB each). Full URLs shown before load. Large native FlipView preview; click the preview for a full-size scrollable viewer. height clamps to 180–480px.

Props in positional order:
- `images`: `{"minItems":1,"maxItems":12,"type":"array","items":{"type":"object","properties":{"src":{"type":"string"},"alt":{"type":"string"}},"required":["src","alt"],"additionalProperties":false}}`
- `title?`: `{"type":"string"}`
- `height?`: `{"type":"number"}`

Reactive props: none.

Example:

```openui
root = ImageGallery([{src:"https://example.org/one.png",alt:"Overview"},{src:"https://example.org/two.png",alt:"Detail"}], "Gallery", 320)
```

## SearchImage

`SearchImage(query, aspectRatio, radius, fit)`

Photo-search card with a confirmed external search link; no automatic network requests or in-app image search.

Props in positional order:
- `query`: `{"type":"string"}`
- `aspectRatio?`: `{"type":"number"}`
- `radius?`: `{"anyOf":[{"type":"string","enum":["sm","md","lg","xl","full"]},{"type":"number"}]}`
- `fit?`: `{"type":"string","enum":["cover","contain"]}`

Reactive props: none.

Example:

```openui
root = SearchImage("Belém Tower Lisbon")
```

## Icon

`Icon(name, size, color)`

Lucide-style name mapped to native Segoe Fluent Icons.

Props in positional order:
- `name`: `{"type":"string"}`
- `size?`: `{"type":"string","enum":["sm","md","lg","xl"]}`
- `color?`: `{"type":"string"}`

Reactive props: none.

Example:

```openui
root = Icon("map-pin", "lg", "info")
```

## MapMarker

`MapMarker(label, lat, lng, category, icon)`

WGS-84 latitude/longitude marker. Always supply WGS-84, not GCJ-02 or BD-09; the native renderer converts for the user's map provider.

Props in positional order:
- `label`: `{"type":"string"}`
- `lat`: `{"type":"number","minimum":-90,"maximum":90}`
- `lng`: `{"type":"number","minimum":-180,"maximum":180}`
- `category?`: `{"type":"string"}`
- `icon?`: `{"type":"string"}`

Reactive props: none.

Example:

```openui
root = MapMarker("Lisbon", 38.7223, -9.1393)
```

## Map

`Map(markers, route, selected, height)`

Interactive Mapsui map with pan/zoom, selectable markers and fit-to-markers. Always use WGS-84 lat/lng. Location list renders first; 加载地图 fetches tiles only after the user's click. Provider is configured in Settings (OSM default, AMap with GCJ-02 conversion, TianDiTu key, custom XYZ; Baidu disabled). route joins markers in order, NOT a routing service. selected is the marker label; height clamps to 180–640px. Provider attribution stays visible; tile failure keeps the location list.

Props in positional order:
- `markers`: `{"type":"array","items":{"$ref":"#/$defs/MapMarker"}}`
- `route?`: `{"type":"boolean"}`
- `selected?` **reactive**: `{"type":"string"}`
- `height?`: `{"type":"number"}`

Reactive props: `selected`.

Example:

```openui
$place = ""
root = Col([Map([MapMarker("Lisbon",38.7223,-9.1393)], false, $place), Text($place)])
```

## YouTube

`YouTube(video, title)`

Known YouTube ID or HTTPS youtube.com/youtu.be URL. Full watch URL displayed; thumbnail fetched only after clicking load. Click the thumbnail/watch button to open FluentCode's existing in-app browser tab. No WebView or embedded player inside the card.

Props in positional order:
- `video`: `{"type":"string"}`
- `title?`: `{"type":"string"}`

Reactive props: none.

Example:

```openui
root = YouTube("dQw4w9WgXcQ", "Video")
```

## Svg

`Svg(children, viewBox, width, height)`

Native vector drawing with viewBox scaling. Shapes accept expressions; no HTML/SVG document execution or resources.

Props in positional order:
- `children`: `{"type":"array","items":{}}`
- `viewBox`: `{"type":"string"}`
- `width?`: `{"type":["number","string"]}`
- `height?`: `{"type":["number","string"]}`

Reactive props: none.

Example:

```openui
root = Svg([Circle(50,50,30,"info"), SvgText("Native",50,54,12,"ink","middle")], "0 0 100 100", 200, 200)
```

## G

`G(children, transform, opacity)`

Drawing group. Transforms: translate, rotate, scale, skewX, skewY, matrix with numeric arguments.

Props in positional order:
- `children`: `{"type":"array","items":{}}`
- `transform?`: `{"type":"string"}`
- `opacity?`: `{"type":"number"}`

Reactive props: none.

Example:

```openui
root = Svg([G([Rect(0,0,20,20,"success")], "translate(10 10)")], "0 0 100 100")
```

## Circle

`Circle(cx, cy, r, fill, stroke, strokeWidth, opacity)`

Circle; fill/stroke accept theme colors.

Props in positional order:
- `cx`: `{"type":"number"}`
- `cy`: `{"type":"number"}`
- `r`: `{"type":"number"}`
- `fill?`: `{"type":"string"}`
- `stroke?`: `{"type":"string"}`
- `strokeWidth?`: `{"type":"number"}`
- `opacity?`: `{"type":"number"}`

Reactive props: none.

Example:

```openui
root = Svg([Circle(50,50,30,"info")], "0 0 100 100")
```

## Ellipse

`Ellipse(cx, cy, rx, ry, fill, stroke, strokeWidth, opacity)`

Ellipse.

Props in positional order:
- `cx`: `{"type":"number"}`
- `cy`: `{"type":"number"}`
- `rx`: `{"type":"number"}`
- `ry`: `{"type":"number"}`
- `fill?`: `{"type":"string"}`
- `stroke?`: `{"type":"string"}`
- `strokeWidth?`: `{"type":"number"}`
- `opacity?`: `{"type":"number"}`

Reactive props: none.

Example:

```openui
root = Svg([Ellipse(50,50,40,20,"purple")], "0 0 100 100")
```

## Rect

`Rect(x, y, width, height, fill, stroke, strokeWidth, opacity, rx)`

Rectangle, optional corner radius.

Props in positional order:
- `x`: `{"type":"number"}`
- `y`: `{"type":"number"}`
- `width`: `{"type":"number"}`
- `height`: `{"type":"number"}`
- `fill?`: `{"type":"string"}`
- `stroke?`: `{"type":"string"}`
- `strokeWidth?`: `{"type":"number"}`
- `opacity?`: `{"type":"number"}`
- `rx?`: `{"type":"number"}`

Reactive props: none.

Example:

```openui
root = Svg([Rect(10,10,80,40,"success",null,null,null,8)], "0 0 100 100")
```

## Line

`Line(x1, y1, x2, y2, stroke, strokeWidth, opacity)`

Line segment.

Props in positional order:
- `x1`: `{"type":"number"}`
- `y1`: `{"type":"number"}`
- `x2`: `{"type":"number"}`
- `y2`: `{"type":"number"}`
- `stroke?`: `{"type":"string"}`
- `strokeWidth?`: `{"type":"number"}`
- `opacity?`: `{"type":"number"}`

Reactive props: none.

Example:

```openui
root = Svg([Line(0,0,100,100,"info",2)], "0 0 100 100")
```

## Path

`Path(d, fill, stroke, strokeWidth, opacity)`

Vector path, commands M/L/H/V/C/S/Q/T/A/Z only, never resource URLs.

Props in positional order:
- `d`: `{"type":"string"}`
- `fill?`: `{"type":"string"}`
- `stroke?`: `{"type":"string"}`
- `strokeWidth?`: `{"type":"number"}`
- `opacity?`: `{"type":"number"}`

Reactive props: none.

Example:

```openui
root = Svg([Path("M10 10 L90 90 L10 90 Z","purple")], "0 0 100 100")
```

## Polyline

`Polyline(points, stroke, strokeWidth, fill, opacity)`

Open polyline; points like "0,0 10,5 20,0".

Props in positional order:
- `points`: `{"type":"string"}`
- `stroke?`: `{"type":"string"}`
- `strokeWidth?`: `{"type":"number"}`
- `fill?`: `{"type":"string"}`
- `opacity?`: `{"type":"number"}`

Reactive props: none.

Example:

```openui
root = Svg([Polyline("0,0 50,50 100,0","info",2)], "0 0 100 100")
```

## Polygon

`Polygon(points, fill, stroke, strokeWidth, opacity)`

Closed polygon with numeric points.

Props in positional order:
- `points`: `{"type":"string"}`
- `fill?`: `{"type":"string"}`
- `stroke?`: `{"type":"string"}`
- `strokeWidth?`: `{"type":"number"}`
- `opacity?`: `{"type":"number"}`

Reactive props: none.

Example:

```openui
root = Svg([Polygon("50,0 100,100 0,100","warning")], "0 0 100 100")
```

## SvgText

`SvgText(text, x, y, size, fill, anchor, weight)`

Drawing text at x/y; anchor controls horizontal alignment.

Props in positional order:
- `text`: `{"type":"string"}`
- `x`: `{"type":"number"}`
- `y`: `{"type":"number"}`
- `size?`: `{"type":"number"}`
- `fill?`: `{"type":"string"}`
- `anchor?`: `{"type":"string","enum":["start","middle","end"]}`
- `weight?`: `{"type":"string","enum":["normal","medium","semibold"]}`

Reactive props: none.

Example:

```openui
root = Svg([SvgText("Native",50,50,14,"ink","middle")], "0 0 100 100")
```
