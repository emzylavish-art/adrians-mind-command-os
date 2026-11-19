/**
 * A deliberately narrow first gate. It catches invalid CSS without blocking
 * the current visual-debt cleanup. Once the legacy !important rules are
 * removed, declaration-no-important can be promoted from warning to error.
 */
export default {
  rules: {
    "block-no-empty": true,
    "color-no-invalid-hex": true,
    "no-duplicate-selectors": true,
    "declaration-no-important": [true, { severity: "warning" }],
  },
};
