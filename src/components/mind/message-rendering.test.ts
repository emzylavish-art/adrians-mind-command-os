import assert from "node:assert/strict";
import { it } from "node:test";
import { renderer } from "./message-rendering.fixture.ts";

type Element = { type: unknown; props: Record<string, unknown>; key?: string };

function nodes(value: unknown): Element[] {
  if (Array.isArray(value)) return value.flatMap(nodes);
  if (!value || typeof value !== "object" || !("type" in value)) return [];
  const element = value as Element;
  return [element, ...nodes(element.props.children)];
}

it("AA062/063: unchanged 20/200/1000-message history is not reparsed during streaming parent updates", () => {
  for (const count of [20, 200, 1000]) {
    const app = renderer();
    const history = Array.from({ length: count }, (_, index) => `History ${index}: **safe formatting** [source](https://example.invalid/${index})\n\n\`\`\`ts\nconst n = ${index};\n\`\`\`\nAfter code`);
    const draw = (tick: number) => app.render([
      ...history.map((text, index) => app.jsx(app.AnswerTabs, { text, onEditImagine: () => tick }, `history-${index}`)),
      app.jsx(app.MessageBody, { text: `Streaming update ${tick}` }, "live"),
    ]);
    draw(0);
    const initial = { ...app.counts };
    for (let tick = 1; tick <= 20; tick++) draw(tick);
    assert.equal(app.counts.blocks - initial.blocks, 20, `${count} messages: only changed live text is split`);
    assert.equal(app.counts.markdown - initial.markdown, 20, `${count} messages: only changed live text is parsed`);
    assert.equal(nodes(draw(20)).filter((node) => node.props["data-testid"] === "answer-tabs").length, count, "all historical messages remain available");
  }
});

it("AA063: text changes invalidate memoized links and image callbacks use the latest render", () => {
  const app = renderer();
  const seen: string[] = [];
  const image = { dataUrl: "data:image/png;base64,YQ==", name: "fixture" };
  const draw = (version: string) => app.render(app.jsx(app.AnswerTabs, {
    text: `[${version}](https://example.invalid/${version})`, images: [image],
    onSaveImage: () => { seen.push(version); },
  }));
  draw("old");
  const latest = draw("new");
  const action = nodes(latest).find((node) => node.type === "image-actions")!;
  (action.props.onSave as () => void)();
  assert.deepEqual(seen, ["new"]);
  assert.equal(app.counts.blocks, 4, "both link and content parses invalidate when text changes");
  assert.match(JSON.stringify(latest), /https:\/\/example\.invalid\/new/);
  assert.doesNotMatch(JSON.stringify(latest), /https:\/\/example\.invalid\/old/);
});

it("AA033: missing attachment references say unavailable rather than indefinitely loading", () => {
  const app = renderer();
  const rendered = app.render(app.jsx(app.MessageBody, { text: "Saved text", images: [{ blobId: "missing", name: "Photo" }] }));
  assert.match(JSON.stringify(rendered), /unavailable on this device/);
  assert.match(JSON.stringify(rendered), /Reattach it to use its contents/);
  assert.doesNotMatch(JSON.stringify(rendered), /still loading|stored offline/);
});
