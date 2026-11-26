import type { Extension } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import { defaultHighlightStyle, syntaxHighlighting } from "@codemirror/language";
import { oneDarkHighlightStyle } from "@codemirror/theme-one-dark";

/** The shell resolves explicit/system appearance to html[data-theme]. */
export function codeEditorTheme(light: boolean): Extension {
  return [
    EditorView.theme({
      "&": {
        color: "var(--color-fg)",
        backgroundColor: "var(--color-surface)",
        fontWeight: "400",
        colorScheme: light ? "light" : "dark",
      },
      "&, & *": { WebkitTextFillColor: "currentColor" },
      ".cm-content": { caretColor: "var(--color-fg)" },
      ".cm-cursor, .cm-dropCursor": { borderLeftColor: "var(--color-fg)" },
      ".cm-gutters": {
        backgroundColor: "var(--color-surface-2)",
        color: "var(--color-muted)",
        borderRightColor: "var(--color-line)",
      },
      ".cm-activeLine, .cm-activeLineGutter": { backgroundColor: "var(--color-surface-2)" },
      "&.cm-focused > .cm-scroller > .cm-selectionLayer .cm-selectionBackground, .cm-selectionBackground, .cm-content ::selection": {
        backgroundColor: "color-mix(in srgb, var(--color-info) 25%, transparent)",
      },
      "&.cm-focused": { outline: "1px solid var(--color-line)" },
    }, { dark: !light }),
    syntaxHighlighting(light ? defaultHighlightStyle : oneDarkHighlightStyle),
  ];
}

/** Reconfigure an existing editor; changing appearance must not replace its document or selection. */
export function observeCodeEditorTheme(
  root: HTMLElement,
  apply: (light: boolean) => void,
  Observer: typeof MutationObserver = MutationObserver,
): () => void {
  let previous: boolean | undefined;
  const read = () => {
    const light = root.dataset.theme === "light";
    if (light === previous) return;
    previous = light;
    apply(light);
  };
  read();
  const observer = new Observer(read);
  observer.observe(root, { attributes: true, attributeFilter: ["data-theme"] });
  return () => observer.disconnect();
}
