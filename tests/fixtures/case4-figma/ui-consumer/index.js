export function installFrontendUiTokens() {
  const style = document.createElement("style");
  style.dataset.frontendUi = "semantic-tokens";
  style.textContent = `
    :root {
      --semantic-text-tertiary: rgb(107 114 128);
      --semantic-status-positive: rgb(15 107 55);
      --semantic-status-negative: rgb(159 18 57);
      --semantic-border-primary: rgb(209 213 219);
      --semantic-focus-primary: rgb(245 158 11);
    }
  `;
  document.head.append(style);
}

export function IconButton({ ariaLabel, onPress }) {
  const button = document.createElement("button");
  button.className = "copy-button";
  button.dataset.ui = "copy-button";
  button.id = "copy-link";
  button.type = "button";
  button.setAttribute("aria-label", ariaLabel);
  Object.assign(button.style, {
    width: "32px",
    height: "32px",
    flex: "0 0 32px",
    padding: "0",
    border: "1px solid var(--semantic-border-primary)",
    borderRadius: "8px",
    color: "var(--semantic-text-tertiary)",
    background: "#fff",
    fontSize: "16px",
    lineHeight: "1",
  });
  const glyph = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  glyph.setAttribute("viewBox", "0 0 16 16");
  glyph.setAttribute("width", "16");
  glyph.setAttribute("height", "16");
  glyph.setAttribute("aria-hidden", "true");
  const path = document.createElementNS("http://www.w3.org/2000/svg", "path");
  path.setAttribute("d", "M5 3h7v8H5z M3 5h2v7h6v2H3z");
  path.setAttribute("fill", "currentColor");
  glyph.append(path);
  button.append(glyph);
  button.addEventListener("click", onPress);
  return button;
}
