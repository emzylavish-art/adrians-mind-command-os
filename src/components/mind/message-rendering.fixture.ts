import { readFileSync } from "node:fs";
import vm from "node:vm";
import ts from "typescript";
import { splitBlocks } from "../../lib/mind/blocks.ts";
import { parseMarkdownBlocks } from "../../lib/mind/markdown-safe.ts";
import * as copyCode from "../../lib/mind/copy-code-action.ts";


type Element = { type: unknown; props: Record<string, unknown>; key?: string };
type Component = (props: Record<string, unknown>) => unknown;
type Instance = { slots: { value?: unknown; deps?: unknown[] }[]; props?: Record<string, unknown>; result?: unknown; dirty?: boolean };

/** Deterministic hooks/reconciliation fixture for the actual TSX module. The
 * separate Chromium profile verifies the same counters in React DOM. No account,
 * app server or provider is involved in either fixture. */
export function renderer(sourceOverride?: string) {
  const instances = new Map<string, Instance>();
  let current: Instance;
  let cursor = 0;
  const counts = { blocks: 0, markdown: 0 };
  const jsx = (type: unknown, props: Record<string, unknown>, key?: string) => ({ type, props, key });
  const react = {
    memo: (type: Component) => ({ memo: type }),
    useMemo: (fn: () => unknown, deps: unknown[]) => {
      const slot = current.slots[cursor++] ??= {};
      if (!slot.deps || deps.some((value, index) => !Object.is(value, slot.deps![index]))) {
        slot.value = fn(); slot.deps = deps;
      }
      return slot.value;
    },
    useState: (initial: unknown) => {
      const host = current;
      const slot = host.slots[cursor++] ??= { value: initial };
      return [slot.value, (next: unknown) => { slot.value = typeof next === "function" ? next(slot.value) : next; host.dirty = true; }];
    },
    useId: () => { const slot = current.slots[cursor++] ??= { value: `id-${instances.size}` }; return slot.value; },
  };
  const imports: Record<string, unknown> = {
    react, "react/jsx-runtime": { jsx, jsxs: jsx, Fragment: "fragment" },
    "@/lib/mind/blocks": { splitBlocks: (text: string) => { counts.blocks++; return splitBlocks(text); } },
    "@/components/mind/markdown-prose": { MarkdownProse: ({ text }: { text: string }) => { counts.markdown++; return jsx("prose", { children: JSON.stringify(parseMarkdownBlocks(text)) }); } },
    "@/components/mind/media/inline-image": { InlineImage: (props: Record<string, unknown>) => jsx("image-actions", props) },
    "@/lib/mind/copy-code-action": copyCode,
  };
  const source = ts.transpileModule(sourceOverride ?? readFileSync(new URL("./message-body.tsx", import.meta.url), "utf8"), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX },
  }).outputText;
  const exports: Record<string, unknown> = {};
  vm.runInNewContext(source, { exports, require: (name: string) => { if (!(name in imports)) throw Error(name); return imports[name]; } });
  const sameProps = (before: Record<string, unknown>, after: Record<string, unknown>) => Object.keys(before).length === Object.keys(after).length && Object.keys(after).every((key) => Object.is(before[key], after[key]));
  const render = (value: unknown, path = "root"): unknown => {
    if (Array.isArray(value)) return value.map((item, index) => render(item, `${path}/${(item as Element)?.key ?? index}`));
    if (!value || typeof value !== "object" || !("type" in value)) return value;
    const element = value as Element;
    const memo = typeof element.type === "object" && element.type && "memo" in element.type ? element.type as { memo: Component } : undefined;
    const component = memo?.memo ?? (typeof element.type === "function" ? element.type as Component : undefined);
    if (component) {
      const instance = instances.get(path) ?? { slots: [] };
      instances.set(path, instance);
      if (memo && instance.props && !instance.dirty && sameProps(instance.props, element.props)) return instance.result;
      current = instance; cursor = 0; instance.dirty = false;
      const output = component(element.props);
      instance.props = element.props;
      instance.result = render(output, `${path}/body`);
      return instance.result;
    }
    return { ...element, props: { ...element.props, children: render(element.props.children, `${path}/children`) } };
  };
  return { counts, jsx, render, AnswerTabs: exports.AnswerTabs, MessageBody: exports.MessageBody };
}
