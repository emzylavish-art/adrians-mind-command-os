# Visual QA foundation

This is the visual-polish guardrail for Adrian's Mind. It is local-first and
does not submit forms, open OAuth, call providers, run MCP tools, or change
production data.

## Run the app

```bash
npm run dev
```

If the persistent local PGLite preview cannot start, do not delete `.data`.
Use an isolated temporary preview database instead:

```bash
NODE_TEST_CONTEXT=visual-audit npm run dev
```

In another terminal:

```bash
BASE_URL=http://127.0.0.1:8080 npm run visual:audit
npm run visual:css-debt
npm run visual:css
```

`visual:audit` captures desktop and mobile screenshots after destination and
theme checks, collects layout and axe evidence, and defaults to report mode.
Its zero exit is not a visual release guarantee. Explicit release thresholds,
revision-bound reviewed exceptions, baseline comparisons, and isolated synthetic
functional states are described in [the verification guide](verification/README.md).
Results are written to `artifacts/visual-audit/`, which is ignored by Git.

## Tool roles

- Playwright + axe: browser layout and accessibility evidence.
- Playwright context routing: implemented local deterministic API/RPC states
  without live credentials. Unrecognized calls are refused. The initial fixture
  catalog and remaining state coverage are documented in the verification guide.
- Unlighthouse: future whole-site performance sweep.
- Stylelint, Knip, and PurgeCSS: CSS/code-debt reporting. PurgeCSS is audit
  only; it must never delete dynamic classes automatically.
- Motion, Inter, and Simple Icons: available for focused UI improvements, not
  bulk restyling.

## Merge rule

Treat a screen as visually complete only after the applicable desktop/mobile
screenshots, overflow checks, and accessibility report have been reviewed.
API/MCP screens also need mocked loading, empty, connected, blocked, and error
states before a real provider is involved.

## Researched modules — adopt only at their matching surface

These are deliberately not installed as unused application dependencies. Each is
free/open-source and fills a distinct need when that product surface is built:

- Mermaid (MIT): flowcharts and sequence diagrams in help or AI answers.
- Shiki (MIT): readable, themeable code blocks in AI replies and Build output.
- Scalar (MIT): self-hosted API explorer after the product publishes an OpenAPI
  contract.
- React Grid Layout (MIT): owner-configurable dashboard grids. Use this rather
  than adding a separate drag-and-drop toolkit if dashboard personalization is
  approved.
- CSS Stats and Project Wallace CSS Analyzer (MIT): trend reports for selector
  complexity, colors, and specificity during the stylesheet consolidation.
- Penpot (MPL-2.0): self-hosted collaborative screen review with Manus; it is
  a separate design workspace, not a web-app runtime dependency.
- Lost Pixel or reg-suit (MIT): optional pull-request visual-diff dashboard
  only if native Playwright screenshot review stops being sufficient.
- Monaspace (OFL-1.1): optional code font for the Build/IDE surface.

Do not add another component primitive library, icon library, 3D renderer, or
visual-test SaaS. Radix, Lucide, Three, and Playwright already own those roles.
