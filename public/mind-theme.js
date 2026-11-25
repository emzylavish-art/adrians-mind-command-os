// Apply the saved appearance before the page or its embedded workspace paints.
(() => {
  const scheme = window.matchMedia("(prefers-color-scheme: dark)");
  function apply() {
    let choice;
    try { choice = localStorage.getItem("amcos.theme.v1"); } catch { /* Browser storage is optional. */ }
    const light = choice === "light" || (choice === "system" && !scheme.matches);
    document.documentElement.dataset.theme = light ? "light" : "dark";
    document.documentElement.style.colorScheme = light ? "light" : "dark";
  }
  apply();
  scheme.addEventListener("change", apply);
  window.addEventListener("storage", apply);
})();
