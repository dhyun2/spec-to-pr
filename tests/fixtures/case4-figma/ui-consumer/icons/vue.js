function createIcon({ name, label, size, color, state, pathData }) {
  const icon = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  icon.dataset.icon = name.toLowerCase();
  icon.dataset.state = state;
  icon.setAttribute("role", "img");
  icon.setAttribute("aria-label", label);
  icon.setAttribute("viewBox", "0 0 16 16");
  Object.assign(icon.style, {
    width: `${size}px`,
    height: `${size}px`,
    color: `var(${color})`,
    flexShrink: "0",
    alignSelf: "center",
  });
  const path = document.createElementNS("http://www.w3.org/2000/svg", "path");
  path.setAttribute("d", pathData);
  path.setAttribute("fill", "currentColor");
  icon.append(path);
  return icon;
}

export function Spot(props) {
  return createIcon({
    name: "spot",
    label: "기본 상태",
    pathData: "M8 3a5 5 0 1 1 0 10A5 5 0 0 1 8 3Z",
    ...props,
  });
}

export function Circle(props) {
  return createIcon({
    name: "circle",
    label: "사용 가능",
    pathData: "M8 2a6 6 0 1 1 0 12A6 6 0 0 1 8 2Zm0 2a4 4 0 1 0 0 8A4 4 0 0 0 8 4Z",
    ...props,
  });
}

export function Close(props) {
  return createIcon({
    name: "close",
    label: "사용 불가",
    pathData: "m4.2 3 3.8 3.8L11.8 3 13 4.2 9.2 8l3.8 3.8-1.2 1.2L8 9.2 4.2 13 3 11.8 6.8 8 3 4.2Z",
    ...props,
  });
}
