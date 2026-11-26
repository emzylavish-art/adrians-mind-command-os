import { useEffect, useRef, useState } from "react";
import { EditorState } from "@codemirror/state";
import { EditorView, lineNumbers } from "@codemirror/view";
import { javascript } from "@codemirror/lang-javascript";
import { json } from "@codemirror/lang-json";
import { markdown } from "@codemirror/lang-markdown";
import { css } from "@codemirror/lang-css";
import { html } from "@codemirror/lang-html";
import { python } from "@codemirror/lang-python";
import { oneDark } from "@codemirror/theme-one-dark";

type IdeFile = { path: string; bytes: number };

type TreeNode = {
  name: string;
  path: string;
  file: boolean;
  bytes?: number;
  children: TreeNode[];
};

function languageFor(path: string) {
  const name = path.toLowerCase();
  if (name.endsWith(".tsx") || name.endsWith(".jsx")) return javascript({ jsx: true, typescript: name.endsWith(".tsx") });
  if (name.endsWith(".ts") || name.endsWith(".js") || name.endsWith(".mjs")) return javascript({ typescript: name.endsWith(".ts") });
  if (name.endsWith(".json")) return json();
  if (name.endsWith(".md")) return markdown();
  if (name.endsWith(".css")) return css();
  if (name.endsWith(".html")) return html();
  if (name.endsWith(".py")) return python();
  return null;
}

function fileTree(files: IdeFile[]): TreeNode[] {
  const root: TreeNode[] = [];
  for (const file of [...files].sort((a, b) => a.path.localeCompare(b.path))) {
    const parts = file.path.split("/").filter(Boolean);
    let level = root;
    let acc = "";
    parts.forEach((part, index) => {
      acc = acc ? `${acc}/${part}` : part;
      const fileNode = index === parts.length - 1;
      let node = level.find((item) => item.name === part && item.file === fileNode);
      if (!node) {
        node = { name: part, path: acc, file: fileNode, bytes: fileNode ? file.bytes : undefined, children: [] };
        level.push(node);
      }
      level = node.children;
    });
  }
  const foldersFirst = (nodes: TreeNode[]) => {
    nodes.sort((a, b) => Number(a.file) - Number(b.file) || a.name.localeCompare(b.name));
    nodes.forEach((node) => foldersFirst(node.children));
  };
  foldersFirst(root);
  return root;
}

function TreeRows(props: { nodes: TreeNode[]; depth: number; selected: string; onOpen: (path: string) => void }) {
  return (
    <ul className="code-ide-tree" role="group">
      {props.nodes.map((node) => (
        <li key={`${node.file ? "f" : "d"}:${node.path}`}>
          {node.file ? (
            <button type="button" role="treeitem" aria-selected={node.path === props.selected} className={node.path === props.selected ? "is-selected" : ""} style={{ paddingLeft: `${0.5 + props.depth * 0.75}rem` }} onClick={() => props.onOpen(node.path)}>
              {node.name}
            </button>
          ) : (
            <details open>
              <summary style={{ paddingLeft: `${0.5 + props.depth * 0.75}rem` }}>{node.name}</summary>
              <TreeRows nodes={node.children} depth={props.depth + 1} selected={props.selected} onOpen={props.onOpen} />
            </details>
          )}
        </li>
      ))}
    </ul>
  );
}

function HighlightedEditor(props: { path: string; text: string; disabled: boolean; onChange: (value: string) => void }) {
  const host = useRef<HTMLDivElement>(null);
  const viewRef = useRef<EditorView | null>(null);
  const onChange = useRef(props.onChange);
  onChange.current = props.onChange;

  useEffect(() => {
    if (!host.current) return;
    const language = languageFor(props.path);
    const view = new EditorView({
      parent: host.current,
      state: EditorState.create({
        doc: props.text,
        extensions: [
          lineNumbers(),
          oneDark,
          EditorView.editable.of(!props.disabled),
          EditorView.contentAttributes.of({ "aria-label": "Workspace file editor", "data-language": props.path.split(".").pop() || "text" }),
          ...(language ? [language] : []),
          EditorView.updateListener.of((update) => {
            if (update.docChanged) onChange.current(update.state.doc.toString());
          }),
        ],
      }),
    });
    viewRef.current = view;
    return () => {
      view.destroy();
      viewRef.current = null;
    };
    // The path remounts the language. Text changes are applied by the next effect.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [props.path, props.disabled]);

  useEffect(() => {
    const editor = viewRef.current;
    if (!editor) return;
    const shown = editor.state.doc.toString();
    if (shown === props.text) return;
    editor.dispatch({ changes: { from: 0, to: shown.length, insert: props.text } });
  }, [props.text]);

  return <div ref={host} className="code-ide-editor" data-testid="code-ide-editor" />;
}

export function CodeIde(props: {
  files: IdeFile[];
  matches: string[];
  tabs: { id: string; path: string; workspace: string; cwd?: string }[];
  selectedId: string;
  onSelectTab: (id: string) => void;
  onOpenMatch: (path: string) => void;
  dirty: string[];
  selected: string;
  text: string;
  busy: boolean;
  notice: string | null;
  newName: string;
  onNewName: (value: string) => void;
  onCreate: () => void;
  onOpen: (path: string) => void;
  onCloseTab: (path: string) => void;
  onChange: (value: string) => void;
  onSave: () => void;
  onCheck: () => void;
  onRename: () => void;
  onDelete: () => void;
}) {
  const tree = fileTree(props.files);
  const dirty = props.selected !== "" && props.dirty.includes(props.selectedId);
  const [completions, setCompletions] = useState<string[]>([]);
  const [debugText, setDebugText] = useState("");
  const [toolNotice, setToolNotice] = useState("");
  const [breakLine, setBreakLine] = useState(3);
  async function complete() {
    setToolNotice("");
    const lines = props.text.split("\n");
    const response = await fetch("/api/mind/build/ide", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ action: "complete", path: props.selected, text: props.text, line: lines.length, column: lines.at(-1)?.length ?? 0 }),
    });
    const body = await response.json().catch(() => ({})) as { ok?: boolean; completions?: string[]; error?: string };
    setCompletions(Array.isArray(body.completions) ? body.completions : []);
    setToolNotice(body.ok ? "" : body.error || "Completions did not load.");
  }
  async function debug() {
    setToolNotice("Debugging.");
    setDebugText("");
    const response = await fetch("/api/mind/build/ide", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ action: "debug", path: props.selected, line: breakLine }),
    });
    const body = await response.json().catch(() => ({})) as { ok?: boolean; pausedLine?: number; locals?: Array<{ name: string; value: string }>; error?: string };
    if (!body.ok) {
      setToolNotice(body.error || "The breakpoint was not reached.");
      return;
    }
    const locals = (body.locals ?? []).map((item) => `${item.name} = ${item.value}`).join(", ");
    setDebugText(`Paused at line ${body.pausedLine}${locals ? `. ${locals}` : ""}`);
    setToolNotice("");
  }
  return (
    <div className="code-ide" data-testid="code-ide">
      <aside aria-label="File tree">
        <form className="code-ide-new" onSubmit={(event) => { event.preventDefault(); props.onCreate(); }}>
          <input value={props.newName} onChange={(event) => props.onNewName(event.target.value)} placeholder="src/note.ts" aria-label="New file name" />
          <button type="submit">New</button>
        </form>
        {tree.length ? <TreeRows nodes={tree} depth={0} selected={props.selected} onOpen={props.onOpen} /> : <p className="code-ide-empty">Choose Browse to list the hosted workspace.</p>}
        {props.matches.map((path) => <button key={path} type="button" className="code-ide-match" onClick={() => props.onOpenMatch(path)}>Match: {path}</button>)}
      </aside>
      <section>
        <div className="code-ide-tabs" role="tablist" aria-label="Open files">
          {props.tabs.map(({ id, path, workspace, cwd }) => (
            <div key={id} className="code-ide-tab" title={`${workspace} ${cwd || ""} ${path}`}>
              <button type="button" role="tab" aria-selected={id === props.selectedId} onClick={() => props.onSelectTab(id)}>
                {path.split("/").at(-1)}{props.dirty.includes(id) ? " •" : ""}
              </button>
              <button type="button" aria-label={`Close ${path}`} onClick={() => props.onCloseTab(id)}>×</button>
            </div>
          ))}
          {!props.tabs.length ? <span className="code-ide-empty">No file open</span> : null}
        </div>
        {props.selected ? (
          <HighlightedEditor key={props.selectedId} path={props.selected} text={props.text} disabled={props.busy} onChange={props.onChange} />
        ) : (
          <p className="code-ide-empty">Select a file from the tree.</p>
        )}
        <div className="code-ide-status">
          <button type="button" disabled={!props.selected || props.busy || !dirty} onClick={props.onSave}>{props.busy ? "Saving…" : "Save reviewed file"}</button>
          {props.selected && <button type="button" disabled={props.busy} onClick={props.onCheck}>Check disk copy</button>}
          {props.selected && <button type="button" disabled={props.busy || dirty} onClick={props.onRename}>Rename reviewed file</button>}
          {props.selected && <button type="button" disabled={props.busy || dirty} onClick={props.onDelete}>Delete reviewed file</button>}
          <span>{props.selected ? `${props.selected} · ${props.text.split("\n").length} lines · ${dirty ? "Unsaved" : "Matches last read or verified save"}` : "No file selected"}</span>
        </div>
        <div className="code-ide-tools">
          <button type="button" disabled={!props.selected || props.busy} onClick={() => void complete()}>Complete</button>
          <label>
            Breakpoint line
            <input aria-label="Breakpoint line" type="number" min={1} value={breakLine} onChange={(event) => setBreakLine(Number(event.target.value) || 1)} />
          </label>
          <button type="button" disabled={!props.selected || props.busy || dirty || props.tabs.find((tab) => tab.id === props.selectedId)?.workspace !== "hosted"} title="Debug runs the saved hosted file" onClick={() => void debug()}>Debug</button>
        </div>
        <div className="code-ide-results">
          {completions.length ? <ul data-testid="completions">{completions.map((name) => <li key={name}>{name}</li>)}</ul> : null}
          {debugText ? <p data-testid="debug-pause">{debugText}</p> : null}
          {toolNotice ? <p role="status">{toolNotice}</p> : null}
        </div>
        {props.notice ? <p className="code-ide-empty" role="status">{props.notice}</p> : null}
      </section>
    </div>
  );
}
