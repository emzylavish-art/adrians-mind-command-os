/**
 * Picker host the reload test mounts. It uses the same storage keys and turn
 * body as the chat shell, and the same Sol control id as the model chip.
 */

import { createElement, useEffect, useState, type ReactNode } from "react";
import {
  LOGIC_ROUTES,
  activePickerLabel,
  chatTurnBody,
  logicMenuState,
  readSelection,
  writeSelection,
  type LogicRoutePublic,
  type ModelTier,
} from "../../lib/mind/logic-routes.ts";

export function LogicRoutePickerHost(props: { routes: LogicRoutePublic[]; text?: string }): ReactNode {
  const stored = readSelection(typeof localStorage === "undefined" ? null : localStorage);
  const [provider, setProvider] = useState(stored.provider);
  const [modelTier, setModelTier] = useState<ModelTier>(stored.modelTier);
  const [logicRoute, setLogicRoute] = useState(stored.logicRoute);
  useEffect(() => {
    writeSelection(typeof localStorage === "undefined" ? null : localStorage, { provider, modelTier, logicRoute });
  }, [provider, modelTier, logicRoute]);
  const label = activePickerLabel({ logicRoute, tierLabel: modelTier, routes: props.routes });
  const body = chatTurnBody({
    text: props.text ?? "hi",
    memory: "off",
    halted: false,
    history: [],
    memoryContext: [],
    provider: logicRoute ?? provider,
    modelTier,
    logicRoute,
    images: [],
  });
  return createElement(
    "section",
    { "data-testid": "model-tier-chip" },
    createElement("p", { "data-testid": "picker-label" }, label),
    createElement("p", { "data-testid": "turn-logic-route" }, body.logicRoute == null ? "" : String(body.logicRoute)),
    createElement("p", { "data-testid": "turn-provider" }, String(body.provider)),
    ...LOGIC_ROUTES.map((id) => {
      const view = props.routes.find((item) => item.id === id);
      const menu = logicMenuState(view, id);
      return createElement(
        "button",
        {
          key: id,
          type: "button",
          role: "menuitemradio",
          "data-testid": `logic-route-${id}`,
          "aria-checked": logicRoute === id ? "true" : "false",
          disabled: !menu.selectable,
          onClick: () => {
            if (!menu.selectable) return;
            setLogicRoute(id);
            setProvider(id);
          },
        },
        menu.label,
      );
    }),
  );
}
