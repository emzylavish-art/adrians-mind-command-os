/**
 * A deliberately narrow first gate. The legacy stylesheet is layered: later
 * theme/viewport blocks intentionally repeat selectors and use !important to
 * override older shell rules. Keep those findings visible as warnings while
 * css-debt.mjs tracks consolidation; syntax and invalid colors still block.
 */
export default {
  rules: {
    "block-no-empty": true,
    "color-no-invalid-hex": true,
    "no-duplicate-selectors": [true, { severity: "warning" }],
    "declaration-no-important": [true, { severity: "warning" }],
  },
};
