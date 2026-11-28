const image = document.getElementById("pet");
const button = document.getElementById("chat");
window.pet.onSelection(({ src, name }) => {
  image.src = src;
  button.setAttribute("aria-label", "Open Adrian Chat with " + name);
});
button.addEventListener("click", () => window.pet.activate());
