// SPDX-License-Identifier: GPL-3.0-or-later
import { autoClose, createParser, parseExpression, split, tokenize, type ASTNode, type ParseResult, type ValidationError } from "@openuidev/lang-core";
import { library, librarySchema, limits } from "./library.ts";

export interface Diagnostic { line: number; column: number; code: string; message: string }
export type Validation = { ok: true; result: ParseResult } | { ok: false; errors: Diagnostic[] };
const parser = createParser(librarySchema, library.root);
const actionNames = new Set(["Action", "Set", "Reset", "ToAssistant", "OpenUrl", "Run"]);
// lang-core 1.1.0's T is a declaration-only const enum, not a JavaScript export.
// These pinned discriminants are used only for source locations/final-input guards, never parsing semantics.
const T = Object.freeze({ LParen: 1, Colon: 8, Equals: 9, Ident: 16, Type: 17, Dot: 19 });
function isActionExpression(node: ASTNode): boolean {
  return node.k === "Comp" && actionNames.has(node.name)
    || node.k === "Ternary" && isActionExpression(node.then) && isActionExpression(node.else);
}
function unsafeUrl(value: string): boolean {
  const urls = value.match(/[a-z][a-z\d+.-]*:\/\/[^\s<>"')\]]*|\b(?:file|javascript|data|vbscript|mailto|shell|ms-appx|ms-appdata):[^\s<>"')\]]+/gi) ?? [];
  return urls.some(text => {
    try { const url = new URL(text); return !["http:", "https:"].includes(url.protocol) || !url.hostname; }
    catch { return true; }
  });
}

function location(source: string, offset: number): { line: number; column: number } {
  const prefix = source.slice(0, offset);
  return { line: 1 + (prefix.match(/\n/g)?.length ?? 0), column: offset - prefix.lastIndexOf("\n") };
}
function diagnostic(source: string, offset: number, code: string, message: string): Diagnostic {
  return { ...location(source, Math.max(0, Math.min(source.length, offset))), code, message };
}

// Run before the tolerant official parser. Bound lexical work and reject incomplete final input.
// This is a scanner/guard, not an alternative OpenUI parser; all program semantics use lang-core.
function scan(source: string): Diagnostic[] {
  const errors: Diagnostic[] = [];
  const stack: { c: string; at: number }[] = [];
  let nodes = 0;
  for (let i = 0; i < source.length; i++) {
    const c = source[i]!;
    if (/\s/.test(c)) continue;
    if (c === "#" || (c === "/" && source[i + 1] === "/")) {
      while (i < source.length && source[i] !== "\n") i++;
      continue;
    }
    if (++nodes > limits.nodes) return [diagnostic(source, i, "limit", `Program exceeds ${limits.nodes} nodes/tokens.`)];
    if (c === '"' || c === "'") {
      const start = i;
      let closed = false;
      while (++i < source.length) {
        if (source[i] === "\\") i++;
        else if (source[i] === c) { closed = true; break; }
      }
      if (!closed) errors.push(diagnostic(source, start, "incomplete", "Unclosed string in final input."));
      else if (c === '"') {
        try { JSON.parse(source.slice(start, i + 1)); }
        catch { errors.push(diagnostic(source, start, "syntax", "Invalid JSON string escape; escape newlines and quotes.")); }
      }
      if (i - start - 1 > limits.stringLength) errors.push(diagnostic(source, start, "limit", `String exceeds ${limits.stringLength} characters.`));
      continue;
    }
    if ("([{".includes(c)) {
      stack.push({ c, at: i });
      if (stack.length > limits.depth) return [diagnostic(source, i, "limit", `Program exceeds depth ${limits.depth}.`)];
    } else if (")] }".replace(" ", "").includes(c)) {
      const expected = c === ")" ? "(" : c === "]" ? "[" : "{";
      if (stack.at(-1)?.c !== expected) errors.push(diagnostic(source, i, "syntax", `Unexpected closing '${c}'.`));
      else stack.pop();
    } else if (/[\w$@]/.test(c)) {
      while (i + 1 < source.length && /[\w$]/.test(source[i + 1]!)) i++;
    } else if (!"=+-*/%!?:.,&|<>".includes(c)) {
      errors.push(diagnostic(source, i, "syntax", `Unexpected character '${c}'. Use OpenUI Lang, not HTML or code fences.`));
    }
    if (errors.length >= 32) break;
  }
  for (const item of stack) errors.push(diagnostic(source, item.at, "incomplete", `Unclosed '${item.c}' in final input.`));
  return errors;
}

function children(node: ASTNode): ASTNode[] {
  switch (node.k) {
    case "Comp": return node.args;
    case "Arr": return node.els;
    case "Obj": return node.entries.map(entry => entry[1]);
    case "BinOp": return [node.left, node.right];
    case "UnaryOp": return [node.operand];
    case "Ternary": return [node.cond, node.then, node.else];
    case "Member": return [node.obj];
    case "Index": return [node.obj, node.index];
    case "Assign": return [node.value];
    default: return [];
  }
}

function argumentOffset(source: string, start: number, end: number, component: string, index: number): number {
  const pattern = new RegExp(`\\b${component}\\s*\\(`, "g");
  const match = pattern.exec(source.slice(start, end));
  if (!match) return start;
  const call = start + match.index;
  if (index < 0) return call;
  const first = start + match.index + match[0].length;
  const skipSpace = (offset: number): number => { while (offset < end && /\s/.test(source[offset]!)) offset++; return offset; };
  if (index === 0) return skipSpace(first);
  let depth = 0, quote = "", argument = 0;
  for (let i = first; i < end; i++) {
    const c = source[i]!;
    if (quote) { if (c === "\\") i++; else if (c === quote) quote = ""; continue; }
    if (c === '"' || c === "'") { quote = c; continue; }
    if ("([{".includes(c)) depth++;
    else if (")] }".replace(" ", "").includes(c)) { if (!depth) break; depth--; }
    else if (c === "," && !depth && ++argument === index) return skipSpace(i + 1);
  }
  return call;
}

export function validateSource(source: string): Validation {
  if (source.length > limits.sourceLength) return { ok: false, errors: [diagnostic(source, 0, "limit", `Source exceeds ${limits.sourceLength} characters.`)] };
  const errors = scan(source);
  if (errors.length) return { ok: false, errors };
  const raw = split(tokenize(source));
  const statements = new Map(raw.map(stmt => [stmt.id, stmt]));
  const ast = new Map<string, ASTNode>();
  try {
    for (const stmt of raw) ast.set(stmt.id, parseExpression(stmt.tokens));
  } catch {
    return { ok: false, errors: [diagnostic(source, 0, "syntax", "Expression is too deeply nested or malformed.")] };
  }
  // Bound expansion across forward references, not just bracket nesting (a shared-ref DAG can explode).
  const pending = [...ast].map(([id, node]) => ({ node, depth: 0, refs: new Set([id]), id }));
  let visited = 0;
  while (pending.length) {
    const item = pending.pop()!;
    if (++visited > limits.nodes || item.depth > limits.depth) return { ok: false, errors: [diagnostic(source, statements.get(item.id)?.start ?? 0, "limit", `Expanded program exceeds ${limits.nodes} nodes or depth ${limits.depth}.`)] };
    if (item.node.k === "Ref" && ast.has(item.node.n) && !item.refs.has(item.node.n)) {
      pending.push({ ...item, node: ast.get(item.node.n)!, depth: item.depth + 1, refs: new Set([...item.refs, item.node.n]) });
    } else for (const child of children(item.node)) pending.push({ ...item, node: child, depth: item.depth + 1 });
  }
  // Invalid non-comment lines must not be silently discarded by the tolerant parser.
  const covered = new Set<number>();
  for (const stmt of raw) {
    const first = location(source, stmt.start ?? 0).line;
    const last = location(source, stmt.end ?? source.length).line;
    for (let line = first; line <= last; line++) covered.add(line);
    if (stmt.tokens.at(-1)?.t === T.Equals || /[+*/%=&|!?:,-]\s*$/.test(source.slice(stmt.start, stmt.end))) errors.push(diagnostic(source, stmt.end ?? source.length, "syntax", "Missing expression after operator."));
  }
  let offset = 0;
  for (const [index, line] of source.split("\n").entries()) {
    if (line.trim() && !/^\s*(#|\/\/)/.test(line) && !covered.has(index + 1)) errors.push(diagnostic(source, offset, "syntax", "Expected identifier = Expression."));
    offset += line.length + 1;
  }
  if (!raw.length) errors.push(diagnostic(source, 0, "parse-failed", "No OpenUI Lang statements. Define root = Col([...])."));
  if (autoClose(source).wasIncomplete) errors.push(diagnostic(source, source.length, "incomplete", "Final program is incomplete."));
  if (errors.length) return { ok: false, errors };
  let result: ParseResult;
  try { result = parser.parse(source); }
  catch { return { ok: false, errors: [diagnostic(source, 0, "parse-failed", "OpenUI Lang parse failed; simplify the expression.")] }; }
  const unknown = Symbol("dynamic");
  const literal = (node: ASTNode | undefined, refs = new Set<string>()): unknown => {
    if (!node) return unknown;
    switch (node.k) {
      case "Str": case "Num": case "Bool": return node.v;
      case "Null": return null;
      case "Ref": return ast.has(node.n) && !refs.has(node.n) ? literal(ast.get(node.n), new Set([...refs, node.n])) : unknown;
      case "Arr": { const values = node.els.map(value => literal(value, refs)); return values.includes(unknown) ? unknown : values; }
      case "Obj": { const entries = node.entries.map(([key, value]) => [key, literal(value, refs)] as const); return entries.some(entry => entry[1] === unknown) ? unknown : Object.fromEntries(entries); }
      case "Comp": return library.components[node.name] ? { type: "element", typeName: node.name } : unknown;
      default: return unknown;
    }
  };
  const located = new Map<string, Set<number>>();
  const locate = (error: Pick<ValidationError, "statementId" | "component" | "path"> & { code?: string }): number => {
    const stmt = statements.get(error.statementId ?? "root");
    const props = library.components[error.component]?.props.shape;
    const prop = error.path.split("/")[1];
    const index = prop ? Object.keys(props ?? {}).indexOf(prop) : -1;
    // Type tokens have exact official lexer offsets. Pair their source order with the official AST,
    // then choose the failing literal argument rather than the first similarly named inline component.
    const calls: ASTNode[] = [];
    const walk = (node: ASTNode): void => { if (node.k === "Comp" && node.name === error.component && !node.fn) calls.push(node); for (const child of children(node)) walk(child); };
    const expression = ast.get(stmt?.id ?? "root"); if (expression) walk(expression);
    const tokens = stmt?.tokens.filter((token, offset) => token.t === T.Type && token.v === error.component && stmt.tokens[offset + 1]?.t === T.LParen) ?? [];
    const candidates = calls.length === tokens.length ? calls.flatMap((call, offset) => {
      if (call.k !== "Comp") return [];
      let match = true;
      if (error.code === "missing-required" && index >= 0) match = call.args.length <= index;
      else if (error.code === "excess-args") match = call.args.length > Object.keys(props ?? {}).length;
      else if (index >= 0 && (error.code === "type-mismatch" || error.code === "null-required" || error.code === "action")) {
        const value = literal(call.args[index]);
        match = value !== unknown && (error.code === "null-required" ? value === null : error.code === "action" ? value !== null : !props?.[prop!]?.safeParse(value).success);
      }
      return match ? [tokens[offset]!.start ?? stmt?.start ?? 0] : [];
    }) : [];
    if (candidates.length) {
      const key = [error.statementId, error.component, error.path, error.code].join("\0");
      const used = located.get(key) ?? new Set<number>(); located.set(key, used);
      const start = candidates.find(offset => !used.has(offset)) ?? candidates[0]!; used.add(start);
      return argumentOffset(source, start, stmt?.end ?? source.length, error.component, index);
    }
    return argumentOffset(source, stmt?.start ?? 0, stmt?.end ?? source.length, error.component, index);
  };
  for (const error of result.meta.errors) if (error.severity !== "warning") errors.push(diagnostic(source, locate(error), error.code, error.message));
  for (const name of new Set(result.meta.unresolved)) {
    const token = raw.flatMap(stmt => stmt.tokens.filter((token, index) => (token.t === T.Ident || token.t === T.Type) && token.v === name && stmt.tokens[index - 1]?.t !== T.Dot && stmt.tokens[index + 1]?.t !== T.Colon)).find(token => token.start !== undefined);
    errors.push(diagnostic(source, token?.start ?? 0, "unresolved", `Unresolved or cyclic reference '${name}'.`));
  }
  if (result.meta.incomplete) errors.push(diagnostic(source, source.length, "incomplete", "Final program is incomplete."));
  if (!result.root && !result.rootExpression && !errors.length) errors.push(diagnostic(source, 0, "no-root", "root must resolve to a native component."));

  // lang-core intentionally defers composite schemas. Check fully static props with their original Zod schemas too.
  const values: { value: unknown; depth: number; statementId?: string }[] = [
    { value: result.root ?? result.rootExpression, depth: 0 },
    { value: result.stateDeclarations, depth: 0 },
    { value: result.queryStatements, depth: 0 },
    { value: result.mutationStatements, depth: 0 },
  ];
  let count = 0;
  while (values.length && errors.length < 32) {
    const { value, depth, statementId } = values.pop()!;
    if (++count > limits.nodes || depth > limits.depth) { errors.push(diagnostic(source, 0, "limit", "Rendered tree exceeds node/depth limits.")); break; }
    if (typeof value === "string") {
      if (value.length > limits.stringLength) errors.push(diagnostic(source, statements.get(statementId ?? "root")?.start ?? 0, "limit", "Decoded string exceeds the string limit."));
      if (unsafeUrl(value)) errors.push(diagnostic(source, statements.get(statementId ?? "root")?.start ?? 0, "url", "Only absolute http(s) URLs are allowed."));
      continue;
    }
    if (!value || typeof value !== "object") continue;
    if (Array.isArray(value)) { for (const child of value) values.push({ value: child, depth: depth + 1, statementId }); continue; }
    const record = value as Record<string, unknown>;
    const id = typeof record.statementId === "string" ? record.statementId : statementId;
    if (record.type === "element" && typeof record.typeName === "string") {
      const component = library.components[record.typeName];
        const props = record.props as Record<string, unknown>;
        if (record.typeName === "Image" && typeof props.src === "string" && !/^https:\/\//i.test(props.src)) errors.push(diagnostic(source, statements.get(id ?? "root")?.start ?? 0, "url", "Image requires an absolute HTTPS URL and explicit user loading."));
      for (const [key, child] of Object.entries(props)) {
        const dynamic = (v: unknown): boolean => !!v && typeof v === "object" && ("k" in v || (v as Record<string, unknown>).type === "element" || Object.values(v).some(dynamic));
        if (key === "action" && child != null && !(typeof child === "object" && "k" in child && isActionExpression(child as ASTNode))) {
          errors.push(diagnostic(source, locate({ statementId: id, component: record.typeName, path: `/${key}`, code: "action" }), "action", "Actions must be syntax calls, not data objects."));
        } else if (child != null && component && !dynamic(child)) {
          const checked = component.props.shape[key]?.safeParse(child);
          if (checked && !checked.success) for (const issue of checked.error.issues) errors.push(diagnostic(source, locate({ statementId: id, component: record.typeName, path: `/${key}`, code: "type-mismatch" }), "type-mismatch", `${record.typeName}/${key}: ${issue.message}`));
        }
        values.push({ value: child, depth: depth + 1, statementId: id });
      }
    } else for (const child of Object.values(record)) values.push({ value: child, depth: depth + 1, statementId: id });
  }
  return errors.length ? { ok: false, errors: errors.slice(0, 32) } : { ok: true, result };
}

export function failureText(errors: Diagnostic[]): string {
  return "native_ui validation failed. Fix and retry; load the native-ui skill and consult references/components.md and references/error-recovery.md for positional prop docs, examples and diagnostic fixes:\n" + errors.map(error => `line ${error.line}, column ${error.column} [${error.code}]: ${error.message}`).join("\n");
}
