/**
 * Isolation harness for the mobile chrome. Not imported by any route.
 * Playwright loads the bundled file from a temp directory; it is not a prod route.
 */
import { createElement } from "react";
import { createRoot } from "react-dom/client";
import { GraphFiltersPanel } from "../graph-filters-panel";
import { MobileChrome, MobilePanelCard } from "../mobile-structure";

const rootEl = document.getElementById("root");
if (rootEl) {
  createRoot(rootEl).render(
    createElement(
      "main",
      {
        className: "dash3d-root dash3d-universe",
        "data-testid": "dash3d-root",
        "data-narrow": "1",
        "data-scene-interact": "0",
        "data-reduced-motion": document.documentElement.dataset.reducedMotion ?? "0",
      },
      createElement("div", { className: "dash3d-canvas-wrap", "data-testid": "canvas-slot" }),
      createElement(MobileChrome, {
        sceneInteract: false,
        onSceneInteract: () => {
          const root = document.querySelector("[data-testid='dash3d-root']");
          if (!root) return;
          root.setAttribute("data-scene-interact", root.getAttribute("data-scene-interact") === "1" ? "0" : "1");
        },
        filtersSlot: createElement(GraphFiltersPanel, { triggerOnly: true }),
        focused: null,
        onJump: () => {},
        onBack: () => {},
      }),
      createElement(
        "div",
        { className: "dash3d-panel-stack", "data-testid": "dash3d-panel-stack" },
        createElement(
          "div",
          { className: "dash3d-hud-card", "data-hud-card": "1", "data-hud-col": "left" },
          createElement(MobilePanelCard, {
            id: "money",
            title: "Money",
            defaultOpen: true,
            focused: null,
            onFocus: () => {},
            summary: "no spend source yet",
            children: createElement("p", { className: "dash3d-title" }, "no spend source yet"),
          }),
        ),
        createElement(
          "div",
          { className: "dash3d-hud-card", "data-hud-card": "1", "data-hud-col": "left" },
          createElement(MobilePanelCard, {
            id: "notion",
            title: "Notion galaxy",
            defaultOpen: true,
            focused: null,
            onFocus: () => {},
            summary: "Unavailable",
            children: createElement("p", { className: "dash3d-muted" }, "Unavailable — No Notion snapshot file found and NOTION_TOKEN unset."),
          }),
        ),
        createElement(
          "div",
          { className: "dash3d-hud-card", "data-hud-card": "1", "data-hud-col": "left" },
          createElement(
          MobilePanelCard,
          {
            id: "compass",
            title: "Universe list",
            defaultOpen: false,
            focused: null,
            onFocus: () => {},
            summary: "2 from status",
          },
          createElement(
            "section",
            { className: "dash3d-plain-fallback", "data-testid": "dash3d-plain-fallback" },
            createElement("p", { className: "dash3d-muted" }, "Demo labels for the harness only. Live status is not fetched here."),
            createElement(
              "ul",
              { className: "dash3d-list" },
              createElement("li", null, createElement("button", { type: "button", className: "dash3d-pill" }, "Logic — healthy")),
              createElement("li", null, createElement("button", { type: "button", className: "dash3d-pill" }, "Voice — stalled")),
            ),
          ),
        ),
        ),
      ),
    ),
  );
}
