// SPDX-License-Identifier: GPL-3.0-or-later
import { library, librarySchema } from "./library.ts";
import { examples } from "./reference.ts";

export const signatures = Object.entries(library.components).map(([name, component]) => {
  const required = librarySchema.$defs![name]!.required ?? [];
  return `${name}(${Object.keys(component.props.shape).map(key => key + (required.includes(key) ? "" : "?")).join(",")})`;
}).join("\n");

export const referenceDescription = "Get native OpenUI component reference on demand. Pass components:[exact component names] for full positional prop schemas, native behavior, and working examples. Primary agents only. Use before unfamiliar components or to fix native_ui validation diagnostics.";
export const description = `native_ui(source,title?): render a real native interactive card in FluentCode. Use for charts, tables, calculators, comparisons, choices and reactive forms, not ordinary prose, code edits, terminal work or decorative cards. No HTML/WebView/scripts.
OpenUI Lang: one name = Expression per statement. root = Col([...]) is the displayed component; forward references allowed. $name = initialValue declares mutable state. Strings use JSON quoting; arrays [], objects {key:value}; null skips optional positional arguments. Expressions: + - * / % == != < > <= >= && || !, condition ? a : b, data.key, data[index]. Components use POSITIONAL arguments, never named props. Compose metrics with Card/Title/Caption. Gap/padding count 4px steps; use native theme color tokens.
Reactive inputs take $state as their first argument, or $state = expression using $value. Pure builtins: @Count @First @Last @Sum @Avg @Min @Max @Sort(array,field?,direction?) @Filter(array,field,operator,value) @Round(number,decimals?) @Abs @Floor @Ceil @Each(array,item,inlineTemplate). Actions: @Set($state,expression), @Reset($state,...), @ToAssistant(shortMessage,context?), @OpenUrl(absoluteHttpUrl), Action([actions...]) in order. Each action sees prior changes. Every input must affect displayed results or a short first-person @ToAssistant; current form state accompanies it.
@OpenUrl/Link show the full http(s) URL and require user confirmation. Images require HTTPS and an explicit 点击加载; never auto-fetch. Map/SearchImage/YouTube are static native cards plus confirmed external links. Math shows source text. Query/Mutation/@Run keep parsed defaults and show 未支持; do not use them for working cards. No file/network/code execution by card programs.
Index (? = optional; null to skip):
${signatures}
Call native_ui_reference({components:[...]}) for full prop types, enums, behavior and examples before using unfamiliar components. On validation failure consult that reference, fix line/column and retry. Limits: 65536 source characters, 16384 per string, 4096 nodes, depth 64. Put the program in source, not a chat fence. Success returns a short acknowledgement.
Examples:
${examples.Slider}
${examples.Chart}`;
