// SPDX-License-Identifier: GPL-3.0-or-later
// Prop names/order and schemas follow OpenIntelligentUI (MIT), components/{layout,text,controls}.tsx.
import { action, createLibrary, defineComponent, markReactive, tagSchemaId } from "@openuidev/lang-core";
import { z } from "zod/v4";
import { additionalComponents } from "./components.ts";

export const limits = Object.freeze({ sourceLength: 65_536, nodes: 4_096, depth: 64, stringLength: 16_384 });

const node = z.any();
tagSchemaId(node, "Node");
const children = z.array(node);
const color = z.string();
tagSchemaId(color, "Color");
const align = z.enum(["start", "center", "end", "stretch"]);
const reactive = <T extends z.ZodType>(schema: T): T => { markReactive(schema); return schema; };
const option = z.union([z.string(), z.object({ value: z.string(), label: z.string() })]);

// One definition list feeds validation, the generated skill reference and the C# manifest.
// Renderers are deliberately absent: this server never renders or executes model-written code.
export const sliceComponents = [
  defineComponent({ name: "Col", props: z.object({ children, gap: z.number().optional(), align: align.optional() }), description: "Vertical layout.", component: null }),
  defineComponent({ name: "Row", props: z.object({ children, gap: z.number().optional(), align: align.optional(), justify: z.enum(["start", "center", "end", "between"]).optional(), wrap: z.boolean().optional() }), description: "Horizontal layout.", component: null }),
  defineComponent({ name: "Card", props: z.object({ children, variant: z.enum(["outline", "soft"]).optional(), padding: z.number().optional(), gap: z.number().optional() }), description: "Native panel.", component: null }),
  defineComponent({ name: "Divider", props: z.object({}), description: "", component: null }),
  defineComponent({ name: "Title", props: z.object({ text: z.string(), size: z.enum(["sm", "md", "lg", "xl", "2xl", "3xl"]).optional(), color: color.optional() }), description: "Heading or large number.", component: null }),
  defineComponent({ name: "Text", props: z.object({ text: z.union([z.string(), children]), size: z.enum(["xs", "sm", "md", "lg"]).optional(), color: color.optional(), weight: z.enum(["normal", "medium", "semibold"]).optional(), italic: z.boolean().optional(), lineThrough: z.boolean().optional(), tabularNums: z.boolean().optional(), maxLines: z.number().optional() }), description: "Paragraph; text can mix strings and nodes.", component: null }),
  defineComponent({ name: "Caption", props: z.object({ text: z.string(), color: color.optional() }), description: "Secondary text.", component: null }),
  defineComponent({ name: "Badge", props: z.object({ text: z.string(), color: z.enum(["neutral", "info", "success", "warning", "danger", "purple", "pink"]).optional(), icon: z.string().optional() }), description: "Small tag.", component: null }),
  defineComponent({ name: "Markdown", props: z.object({ text: z.string() }), description: "Native prose, lists, code and tables; no external resources.", component: null }),
  defineComponent({ name: "Button", props: z.object({ label: z.string(), action: action().optional(), variant: z.enum(["solid", "outline", "soft", "ghost"]).optional(), color: z.enum(["primary", "danger", "success"]).optional(), size: z.enum(["sm", "md", "lg"]).optional(), icon: z.string().optional(), disabled: z.boolean().optional(), block: z.boolean().optional() }), description: "Click action. With no action, sends its label to the assistant. size sm/md/lg selects 32/40/48px. Buttons fill Grid cells and button-only Rows. Omit size on short-label keypad keys for adaptive height: 0.8 times column width, clamped to 40–56px; explicit size overrides it.", component: null }),
  defineComponent({ name: "Input", props: z.object({ value: reactive(z.union([z.string(), z.number()])), label: z.string().optional(), type: z.enum(["text", "number"]).optional(), placeholder: z.string().optional() }), description: "Text/number input bound to a $variable.", component: null }),
  defineComponent({ name: "Select", props: z.object({ value: reactive(z.string()), options: z.array(option), label: z.string().optional(), placeholder: z.string().optional() }), description: "Dropdown bound to a $variable.", component: null }),
  defineComponent({ name: "Slider", props: z.object({ value: reactive(z.number()), min: z.number(), max: z.number(), step: z.number().optional(), label: z.string().optional(), unit: z.string().optional(), marks: z.array(z.object({ value: z.number(), label: z.string() })).optional() }), description: "Numeric range bound to a $variable.", component: null }),
  defineComponent({ name: "Checkbox", props: z.object({ checked: reactive(z.boolean()), label: z.string(), lineThrough: z.boolean().optional() }), description: "Boolean input bound to a $variable.", component: null }),
];

export const library = createLibrary({ id: "fluentcode-native-ui@0.2.0", root: "Col", components: [...sliceComponents, ...additionalComponents] });
export const librarySchema = library.toJSONSchema();
