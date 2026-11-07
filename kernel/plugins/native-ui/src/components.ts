// SPDX-License-Identifier: GPL-3.0-or-later
// Positional contracts adapted from OpenIntelligentUI (MIT); native policy is documented here.
import { action, defineComponent, markReactive, tagSchemaId } from "@openuidev/lang-core";
import { z } from "zod/v4";

const node = z.any(); tagSchemaId(node, "Node");
const children = z.array(node);
const color = z.string();
const length = z.union([z.number(), z.string()]);
const radius = z.union([z.enum(["sm", "md", "lg", "xl", "full"]), z.number()]);
const align = z.enum(["start", "center", "end", "stretch"]);
const justify = z.enum(["start", "center", "end", "between"]);
const reactive = <T extends z.ZodType>(schema: T): T => { markReactive(schema); return schema; };
const options = z.array(z.union([z.string(), z.object({ value: z.string(), label: z.string() })]));
const slot = z.union([z.string(), children]);
const paint = { fill: color.optional(), stroke: color.optional(), strokeWidth: z.number().optional(), opacity: z.number().optional() };
const fit = z.enum(["cover", "contain"]).optional();
const component = (name: string, props: z.ZodObject, description: string) => defineComponent({ name, props, description, component: null });
const ListItem = component("ListItem", z.object({ title: z.string(), description: z.string().optional(), marker: z.string().optional(), children: children.optional() }), "List entry; marker replaces its bullet/number, e.g. a time or emoji.");
const MapMarker = component("MapMarker", z.object({ label: z.string(), lat: z.number(), lng: z.number(), category: z.string().optional(), icon: z.string().optional() }), "Location marker with latitude and longitude; rendered as a selectable location card.");

export const additionalComponents = [
  component("Chart", z.object({ type: z.enum(["bar", "line", "area", "pie", "donut", "scatter"]), data: z.array(z.record(z.string(), z.union([z.string(), z.number()]))), x: z.string().optional(), series: z.array(z.string()).optional(), format: z.enum(["number", "currency", "percent"]).optional(), currency: z.string().optional(), stacked: z.boolean().optional(), height: z.number().optional() }), "Native chart. Rows of data; x is the category key (numeric for scatter); series defaults to numeric keys other than x (up to 8). Percent values are like 45, not 0.45; currency is an ISO code like EUR. Stacking applies to bar/area; height clamps to 140–480 px."),
  component("Table", z.object({ columns: z.array(z.string()), rows: z.array(z.array(node)) }), "Native sortable, resizable table. Each row lists cells in column order; cells may be components. Numeric columns align right."),
  component("TextArea", z.object({ value: reactive(z.string()), label: z.string().optional(), placeholder: z.string().optional(), rows: z.number().optional() }), "Multiline text field bound to a $variable; rows clamps to 2–20."),
  component("SegmentedControl", z.object({ value: reactive(z.string()), options, block: z.boolean().optional() }), "Two to four short choices. Options are strings or {value,label}; block fills the available width."),
  component("RadioGroup", z.object({ value: reactive(z.string()), options: z.array(z.union([z.string(), z.object({ value: z.string(), label: z.string(), description: z.string().optional() })])), label: z.string().optional(), variant: z.enum(["list", "pills", "cards"]).optional() }), "Single choice. list uses radio buttons; pills uses segmented choices; cards includes descriptions."),
  component("DatePicker", z.object({ value: reactive(z.string()), label: z.string().optional(), min: z.string().optional(), max: z.string().optional() }), "Native calendar picker; value/min/max use YYYY-MM-DD."),
  component("Timer", z.object({ seconds: reactive(z.number()), label: z.string().optional() }), "Countdown with start/pause/reset; decrements bound seconds to zero. Pauses when the card leaves the visual tree."),
  component("IconButton", z.object({ icon: z.string(), action: action().optional(), label: z.string().optional(), variant: z.enum(["outline", "ghost", "solid"]).optional() }), "Icon-only button. Supply a label for accessibility; no implicit assistant action."),
  component("Pressable", z.object({ children, action: action().optional(), selected: z.boolean().optional(), padding: z.number().optional(), background: color.optional(), radius: radius.optional() }), "Keyboard-accessible clickable tile; nested controls retain their own input."),
  component("Box", z.object({ children: children.optional(), direction: z.enum(["row", "col"]).optional(), gap: z.number().optional(), padding: z.number().optional(), background: color.optional(), radius: radius.optional(), border: z.boolean().optional(), width: length.optional(), height: length.optional(), flex: z.number().optional(), align: align.optional(), justify: justify.optional(), wrap: z.boolean().optional() }), "Flex container, column by default. Lengths are pixels or percentages; gap/padding are 4px steps."),
  component("Grid", z.object({ children, columns: z.number().optional(), minChildWidth: z.number().optional(), gap: z.number().optional() }), "Equal columns (default 2, maximum 12); minChildWidth reduces columns on narrow cards."),
  component("Form", z.object({ children }), "Groups fields; current state accompanies @ToAssistant."),
  component("Spacer", z.object({}), "Fills free space in a Row."),
  component("Carousel", z.object({ children, itemWidth: z.number().optional(), gap: z.number().optional() }), "Horizontally scrolling native items; itemWidth defaults to 240 px (80–640)."),
  component("Popover", z.object({ trigger: slot, content: slot }), "Click trigger to show content in a native flyout. Slots are strings or lists of components."),
  component("Label", z.object({ text: z.string() }), "Field or group label."),
  component("Link", z.object({ text: z.string(), url: z.string() }), "http(s) external link; always asks for confirmation showing the full URL."),
  ListItem,
  component("List", z.object({ items: z.array(z.union([z.string(), ListItem.ref])), marker: z.enum(["bullet", "number", "none"]).optional(), timeline: z.boolean().optional() }), "List of strings/ListItem; timeline connects markers."),
  component("Quote", z.object({ text: z.string(), cite: z.string().optional() }), "Quotation/callout with a side rule and optional attribution."),
  component("Code", z.object({ code: z.string(), language: z.string().optional() }), "Native code block with copy; never executes code."),
  component("Math", z.object({ tex: z.string(), inline: z.boolean().optional() }), "LaTeX source displayed as native text in v1 (not typeset)."),
  component("Flashcard", z.object({ front: slot, back: slot, hint: z.string().optional() }), "Tap to flip front/back; flip state is retained with the card."),
  component("Celebration", z.object({ when: z.boolean() }), "Native celebratory feedback when the condition changes from false to true."),
  component("Image", z.object({ src: z.string(), alt: z.string(), aspectRatio: z.number().optional(), radius: radius.optional(), fit }), "User/tool-provided HTTPS image. Never fetched automatically: a 点击加载 placeholder shows the full URL first. No automatic search fallback."),
  component("SearchImage", z.object({ query: z.string(), aspectRatio: z.number().optional(), radius: radius.optional(), fit }), "Photo-search card with a confirmed external search link; no automatic network requests or in-app image search."),
  component("Icon", z.object({ name: z.string(), size: z.enum(["sm", "md", "lg", "xl"]).optional(), color: color.optional() }), "Lucide-style name mapped to native Segoe Fluent Icons."),
  MapMarker,
  component("Map", z.object({ markers: z.array(MapMarker.ref), route: z.boolean().optional(), selected: reactive(z.string().optional()), height: z.number().optional() }), "Static native location cards, not a map service. Selecting updates selected to the marker label; coordinates open externally only after confirmation. route lists locations in order (no routing/network)."),
  component("YouTube", z.object({ video: z.string(), title: z.string().optional() }), "Known YouTube video ID/URL rendered as a native preview card and confirmed external link; no embedded player or automatic thumbnail request."),
  component("Svg", z.object({ children, viewBox: z.string(), width: length.optional(), height: length.optional() }), "Native vector drawing with viewBox scaling. Shapes accept expressions; no HTML/SVG document execution or resources."),
  component("G", z.object({ children, transform: z.string().optional(), opacity: z.number().optional() }), "Drawing group. Transforms: translate, rotate, scale, skewX, skewY, matrix with numeric arguments."),
  component("Circle", z.object({ cx: z.number(), cy: z.number(), r: z.number(), ...paint }), "Circle; fill/stroke accept theme colors."),
  component("Ellipse", z.object({ cx: z.number(), cy: z.number(), rx: z.number(), ry: z.number(), ...paint }), "Ellipse."),
  component("Rect", z.object({ x: z.number(), y: z.number(), width: z.number(), height: z.number(), ...paint, rx: z.number().optional() }), "Rectangle, optional corner radius."),
  component("Line", z.object({ x1: z.number(), y1: z.number(), x2: z.number(), y2: z.number(), stroke: color.optional(), strokeWidth: z.number().optional(), opacity: z.number().optional() }), "Line segment."),
  component("Path", z.object({ d: z.string(), ...paint }), "Vector path, commands M/L/H/V/C/S/Q/T/A/Z only, never resource URLs."),
  component("Polyline", z.object({ points: z.string(), stroke: color.optional(), strokeWidth: z.number().optional(), fill: color.optional(), opacity: z.number().optional() }), 'Open polyline; points like "0,0 10,5 20,0".'),
  component("Polygon", z.object({ points: z.string(), ...paint }), "Closed polygon with numeric points."),
  component("SvgText", z.object({ text: z.string(), x: z.number(), y: z.number(), size: z.number().optional(), fill: color.optional(), anchor: z.enum(["start", "middle", "end"]).optional(), weight: z.enum(["normal", "medium", "semibold"]).optional() }), "Drawing text at x/y; anchor controls horizontal alignment."),
];
