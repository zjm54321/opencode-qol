# Worked native UI examples

These complete programs are tested with the official `@openuidev/lang-core` parser and the server's `validateSource`. Pass a program as the tool's `source`, without its Markdown fence. Adapt the labels to the user's language and the data to the user's request. The example.org media URLs below are placeholders: replace them with actual user/tool-provided HTTPS assets, not guessed URLs.

## Calculator with memory

Inputs and the operator update the result locally. **MS** stores the result, **M+** adds to memory, **MR** recalls into the first operand, and **MC** clears memory. Division by zero displays a helpful message instead of an invalid number. Short memory-button labels use adaptive sizing.

```openui
$left = 12
$right = 3
$operator = "+"
$memory = 0
result = $operator == "+" ? $left + $right : $operator == "-" ? $left - $right : $operator == "×" ? $left * $right : $right == 0 ? 0 : $left / $right
root = Card([Title("Calculator", "lg"), Row([Input($left, "First number", "number"), Input($right, "Second number", "number")]), SegmentedControl($operator, ["+", "-", "×", "÷"], true), Title($operator == "÷" && $right == 0 ? "Cannot divide by zero" : "Result: " + @Round(result, 4), "xl"), Caption("Memory: " + @Round($memory, 4)), Grid([Button("MS", @Set($memory, result)), Button("M+", @Set($memory, $memory + result)), Button("MR", @Set($left, $memory)), Button("MC", @Reset($memory))], 4, 64, 2), Button("Reset inputs", @Reset($left, $right, $operator), "outline"), Caption("Memory stays local to this card.")], "soft", 4, 3)
```

## Dashboard with chart and table

The chart type is reactive, while both views share the same sample rows. The table includes a native Badge cell. Use named series instead of guessing field positions.

```openui
$chartType = "bar"
sales = [{month:"Jan",revenue:12000},{month:"Feb",revenue:18000},{month:"Mar",revenue:21000}]
root = Card([Title("Revenue dashboard", "lg"), Row([Caption("Quarter total"), Title("$" + @Sum(@Each(sales, "item", item.revenue)), "xl")]), SegmentedControl($chartType, ["bar", "line", "area"], true), Chart($chartType, sales, "month", ["revenue"], "currency", "USD", false, 220), Table(["Month", "Revenue (USD)", "Status"], @Each(sales, "item", [item.month, item.revenue, Badge("Recorded", "success")])), Caption("Sample data · switch chart type or sort the table.")], "outline", 4, 3)
```

## Form that sends to the assistant

Editing does not submit. The user clicks **Ask assistant** to send a short first-person request and structured context through the normal composer. The button is disabled until a name is entered, and a separate reset preserves the submitted values until the user clears them.

```openui
$name = ""
$destination = "Lisbon"
$days = 3
$notes = ""
root = Card([Title("Trip planner", "lg"), Form([Input($name, "Your name", "text", "Name"), Select($destination, ["Lisbon", "Porto", "Coimbra"], "Destination"), Slider($days, 1, 14, 1, "Days", "days"), TextArea($notes, "Preferences", "Food, pace, accessibility…", 3), Text("Plan: " + $days + " days in " + $destination), Button("Ask assistant", @ToAssistant("I'd like a " + $days + "-day trip plan for " + $destination + ".", {name:$name,destination:$destination,days:$days,notes:$notes}), "solid", "primary", "md", null, $name == "", true), Button("Reset form", @Reset($name, $destination, $days, $notes), "outline")]), Caption("Only sent on click; queued if the assistant is busy.")], "soft", 4, 3)
```

## Map with markers and a route

The location list is available before loading map tiles. The third Map argument binds the selected marker label. Coordinates are WGS-84; `true` connects the markers in order, not along roads.

```openui
$selected = ""
stops = [MapMarker("Belém Tower",38.6916,-9.2160,"Sight","map-pin"), MapMarker("Commerce Square",38.7078,-9.1366,"Square","map-pin"), MapMarker("São Jorge Castle",38.7139,-9.1335,"Sight","map-pin")]
root = Card([Title("Lisbon stops", "lg"), Map(stops, true, $selected, 320), Text($selected == "" ? "Select a marker to see its name." : "Selected: " + $selected), Caption("WGS-84 · click to load HTTPS tiles · line joins stops, not road directions.")], "outline", 4, 3)
```

## Media gallery

All URLs are shown before loading. The user loads images, video or audio individually; there is no autoplay. YouTube opens in FluentCode's in-app browser after the user chooses to watch.

```openui
root = Card([Title("Project media", "lg"), ImageGallery([{src:"https://media.example.org/overview.png",alt:"Project overview"},{src:"https://media.example.org/detail.png",alt:"Detail view"}], "Screenshots", 260), Video("https://media.example.org/tour.mp4", "Product tour", 240), Audio("https://media.example.org/intro.mp3", "Audio introduction"), YouTube("dQw4w9WgXcQ", "YouTube example"), Caption("Click each item to load. Media does not autoplay.")], "soft", 4, 3)
```
