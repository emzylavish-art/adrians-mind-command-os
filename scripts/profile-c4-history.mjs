/** Local, synthetic React DOM profile for AA062/063. No app server, account,
 * network provider or production data is used. Run with:
 * node scripts/profile-c4-history.mjs [baseline-sha]
 * CHROMIUM_EXECUTABLE may point to a locally installed Chromium binary.
 * Numbers describe this fixture and machine, not production INP or frame rate. */
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { resolve } from "node:path";
import { createServer } from "vite";
import react from "@vitejs/plugin-react";
import { chromium } from "playwright";
import ts from "typescript";

const root = fileURLToPath(new URL("../", import.meta.url));
const baseline = process.argv[2] ?? "18d5b9364e6bdcfec028eeccf56fe596946ed8ce";
if (!/^[a-f\d]{40}$/.test(baseline)) throw Error("Pass a full baseline Git SHA.");
const before = execFileSync("git", ["show", `${baseline}:src/components/mind/message-body.tsx`], { cwd: root, encoding: "utf8" });
const compile = (source) => ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX } }).outputText;
const entry = `
import React, {useState} from "react";
import {createRoot} from "react-dom/client";
import {flushSync} from "react-dom";
import * as Before from "virtual:c4-before";
import * as After from "/src/components/mind/message-body.tsx";
let bump;
const histories = new Map();
function Fixture({count, variant}) {
  const [tick, setTick] = useState(0); bump = () => setTick(n => n + 1);
  const {AnswerTabs, MessageBody} = variant === "before" ? Before : After;
  const history = histories.get(count) ?? Array.from({length: count}, (_,i) =>
    "History " + i + ": **formatted text** [source](https://example.invalid/" + i + ")\\n\\n" +
    "More text. ".repeat(15) + "\\n\\n" + "\`\`\`ts\\nconst n = " + i + ";\\n\`\`\`\\nAfter code.");
  histories.set(count, history);
  return <div id="pane" style={{height:400, overflow:"auto"}}>
    {history.map((text,i) => <article key={i} id={"history-"+i} data-history tabIndex={-1}>
      <AnswerTabs text={text} onEditImagine={() => tick} />
    </article>)}
    <MessageBody text={"Streaming update " + tick} />
  </div>;
}
const root = createRoot(document.getElementById("root"));
globalThis.__c4Run = (count, variant) => {
  globalThis.__c4Counters = {blocks:0, markdown:0};
  let start = performance.now();
  flushSync(() => root.render(<Fixture key={variant+count} count={count} variant={variant}/>));
  const mountMs = performance.now() - start;
  const initial = {...globalThis.__c4Counters};
  const first = document.getElementById("history-0");
  const pane = document.getElementById("pane");
  first.focus(); pane.scrollTop = 100;
  const range = document.createRange(); range.selectNodeContents(first.querySelector("code"));
  const selection = getSelection(); selection.removeAllRanges(); selection.addRange(range);
  const selectedText = selection.toString();
  const timings=[];
  for (let i=0;i<20;i++) { start=performance.now(); flushSync(bump); timings.push(performance.now()-start); }
  const result = {count, variant, updates:20, mountMs:Number(mountMs.toFixed(2)),
    updateCommitMs:Number(timings.reduce((a,b)=>a+b,0).toFixed(2)),
    maxUpdateCommitMs:Number(Math.max(...timings).toFixed(2)),
    initialBlockParses:initial.blocks, initialMarkdownParses:initial.markdown,
    updateBlockParses:globalThis.__c4Counters.blocks-initial.blocks,
    updateMarkdownParses:globalThis.__c4Counters.markdown-initial.markdown,
    mountedHistory:document.querySelectorAll("[data-history]").length,
    historyNodesRetained:document.getElementById("history-0") === first,
    selectedCodeRetained:selection.toString() === selectedText,
    focusRetained:document.activeElement === first,
    scrollTop:pane.scrollTop};
  document.getElementById("history-"+(count-1)).scrollIntoView();
  result.lastMessageReachable = document.getElementById("history-"+(count-1)).getBoundingClientRect().top < pane.getBoundingClientRect().bottom;
  return result;
};
globalThis.__c4Ready=true;
`;
const server = await createServer({ root, configFile: false, logLevel: "error", plugins: [
  {
    name: "c4-profile-only", enforce: "pre",
    resolveId(id) { if (id === "virtual:c4-before" || id === "virtual:c4-entry") return `\0${id}`; },
    load(id) { if (id === "\0virtual:c4-before") return compile(before); if (id === "\0virtual:c4-entry") return compile(entry); },
    transform(source, id) {
      if (id.endsWith("/src/lib/mind/blocks.ts")) return source.replace("export function splitBlocks(source: string): Block[] {", "export function splitBlocks(source: string): Block[] { globalThis.__c4Counters.blocks++;");
      if (id.endsWith("/src/lib/mind/markdown-safe.ts")) return source.replace("export function parseMarkdownBlocks(source: string): BlockNode[] {", "export function parseMarkdownBlocks(source: string): BlockNode[] { globalThis.__c4Counters.markdown++;");
    },
    configureServer(instance) {
      instance.middlewares.use(async (req, res, next) => {
        if (req.url !== "/") return next();
        const html = await instance.transformIndexHtml("/", '<!doctype html><html><body><div id="root"></div><script type="module" src="/@id/__x00__virtual:c4-entry"></script></body></html>');
        res.setHeader("content-type", "text/html"); res.end(html);
      });
    },
  }, react(),
], resolve: { alias: { "@": resolve(root, "src") } }, optimizeDeps: { noDiscovery: true, include: ["react", "react/jsx-runtime", "react-dom", "react-dom/client"] }, server: { host: "127.0.0.1", port: 0, hmr: false } });
let browser;
try {
  await server.listen();
  const address = server.httpServer.address();
  const origin = `http://127.0.0.1:${address.port}`;
  const executablePath = process.env.CHROMIUM_EXECUTABLE ?? (existsSync("/usr/bin/chromium") ? "/usr/bin/chromium" : undefined);
  const extraArgs = process.env.CHROMIUM_ARGS_JSON ? JSON.parse(process.env.CHROMIUM_ARGS_JSON) : [];
  if (!Array.isArray(extraArgs) || extraArgs.some((arg) => typeof arg !== "string")) throw Error("CHROMIUM_ARGS_JSON must be a string array.");
  browser = await chromium.launch({ executablePath, headless: true, args: ["--no-sandbox", "--disable-dev-shm-usage", ...extraArgs] });
  const page = await browser.newPage();
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.route("**/*", (route) => new URL(route.request().url()).origin === origin ? route.continue() : route.abort());
  await page.goto(origin);
  await page.waitForFunction(() => globalThis.__c4Ready, { timeout: 30_000 });
  const results = [];
  for (const count of [20, 200, 1000]) {
    for (const variant of ["before", "after"]) {
      if (process.env.C4_PROFILE_DEBUG) console.error(`Profiling ${count} historical messages: ${variant}`);
      const result = await page.evaluate(({count,variant}) => globalThis.__c4Run(count,variant), {count,variant});
      assert.equal(result.mountedHistory, count);
      for (const key of ["historyNodesRetained", "selectedCodeRetained", "focusRetained", "lastMessageReachable"]) assert.equal(result[key], true, key);
      assert.equal(result.scrollTop, 100);
      if (variant === "after") { assert.equal(result.updateBlockParses, 20); assert.equal(result.updateMarkdownParses, 20); }
      results.push(result);
    }
  }
  assert.deepEqual(errors, []);
  console.log(JSON.stringify({baseline, chromium:await browser.version(), fixture:"Actual MessageBody/AnswerTabs in React DOM; changed callback identities on each parent update; 20 synchronous updates; all history mounted", results}, null, 2));
} finally { await browser?.close(); await server.close(); }
