/** Map and chart icons for point assets. Same size, layer colour, no background. */
const BRIDGE_PATH =
  "M232,160h-8V120.5c1.63.81,3.29,1.57,5,2.26a8,8,0,0,0,6-14.83A55.78,55.78,0,0,1,200,56a8,8,0,0,0-16,0A56,56,0,0,1,72,56a8,8,0,0,0-16,0,55.78,55.78,0,0,1-35,51.93,8,8,0,0,0,6,14.83c1.71-.69,3.37-1.45,5-2.26V160H24.6c-6.31,0-8.6,4.78-8.6,8a8,8,0,0,0,8,8H56v24a8,8,0,0,0,16,0V176H184v24a8,8,0,0,0,16,0V176h32a8,8,0,0,0,0-16ZM72,152a8,8,0,0,1-16,0V104.12a8,8,0,0,1,16,0Zm40,0a8,8,0,0,1-16,0V132.32a8,8,0,0,1,16,0Zm48,0a8,8,0,0,1-16,0V132.32a8,8,0,0,1,16,0Zm40,0a8,8,0,0,1-16,0V104.12a8,8,0,0,1,16,0Z";

const GLYPHS = {
  camera: (color) => `
    <rect x="9" y="12.5" width="14" height="9.5" rx="2" fill="${color}"/>
    <circle cx="16" cy="17.2" r="2.7" fill="#fff"/>
    <circle cx="16" cy="17.2" r="1.3" fill="${color}"/>
    <path d="M12.5 12.5 14.2 9.8h3.6L19.5 12.5Z" fill="${color}"/>`,
  bridge: (color) =>
    `<g fill="${color}" transform="translate(6 6) scale(0.078125)"><path d="${BRIDGE_PATH}"/></g>`,
  culvert: (color) => `
    <rect x="7" y="8" width="18" height="4" rx="1" fill="${color}"/>
    <path d="M9 23v-6a7 7 0 0 1 14 0v6" fill="none" stroke="${color}" stroke-width="2.2"/>
    <path d="M12.2 23v-4.2a3.8 3.8 0 0 1 7.6 0V23Z" fill="none"/>`,
  pole: (color) => `
    <rect x="15" y="11" width="2" height="13" rx="1" fill="${color}"/>
    <rect x="8" y="10" width="16" height="2" rx="1" fill="${color}"/>
    <rect x="9" y="7" width="2.2" height="4" rx="0.4" fill="${color}"/>
    <rect x="14.9" y="7" width="2.2" height="4" rx="0.4" fill="${color}"/>
    <rect x="20.8" y="7" width="2.2" height="4" rx="0.4" fill="${color}"/>`,
  mv: (color) => `
    <rect x="15.15" y="5" width="1.7" height="22" fill="${color}"/>
    <rect x="6" y="8.15" width="20" height="1.45" fill="${color}"/>
    <rect x="6" y="16.15" width="20" height="1.45" fill="${color}"/>
    <path d="M16 9.7 11.4 14.4 M16 9.7 20.6 14.4 M16 17.7 11.8 22.2 M16 17.7 20.2 22.2" fill="none" stroke="${color}" stroke-width="1.25" stroke-linecap="round"/>
    ${[7.3, 10.5, 19.4, 22.6].map((x) => `<rect x="${x}" y="6.15" width="1.15" height="2.7" fill="${color}"/><rect x="${x - 0.55}" y="6.85" width="2.25" height="0.7" fill="${color}"/>`).join("")}
    ${[7.3, 10.5, 19.4, 22.6].map((x) => `<rect x="${x}" y="14.15" width="1.15" height="2.7" fill="${color}"/><rect x="${x - 0.55}" y="14.85" width="2.25" height="0.7" fill="${color}"/>`).join("")}`,
  transformer: (color) => `
    <rect x="8" y="6.5" width="3" height="3.2" rx="0.4" fill="${color}"/>
    <rect x="14.5" y="6.5" width="3" height="3.2" rx="0.4" fill="${color}"/>
    <rect x="21" y="6.5" width="3" height="3.2" rx="0.4" fill="${color}"/>
    <rect x="6.5" y="10" width="19" height="13" rx="2" fill="${color}"/>
    <path d="M16.2 13.2 13 18h2.2l-.8 3.6 4.6-5.2h-2.2Z" fill="#fff"/>`,
  traffic: (color) =>
    [5.5, 13, 20.5]
      .map(
        (x) => `
    <rect x="${x}" y="12.5" width="6.2" height="8" rx="1.2" fill="${color}"/>
    <rect x="${x + 1}" y="13.8" width="4.2" height="2.1" rx="0.4" fill="#fff"/>
    <circle cx="${x + 1.6}" cy="21.2" r="0.9" fill="${color}"/>
    <circle cx="${x + 4.6}" cy="21.2" r="0.9" fill="${color}"/>`,
      )
      .join(""),
  milestone: (color) => `
    <path d="M10 13.5a6 6 0 0 1 12 0V24H10Z" fill="${color}"/>
    <path d="M13 20.2h6M14.2 22.2h3.6" stroke="#fff" stroke-width="1.3" stroke-linecap="round"/>`,
  accident: (color) => `
    <path d="M5.5 15.5h8.2l1.2 2.2v3.2H7.2l-1.7-2.2Z" fill="${color}"/>
    <path d="M17.2 17.2h8.3l1 2.4v3.1h-7.4l-1.9-2.3Z" fill="${color}"/>
    <path d="m15.2 8.2 1.1 2.6h2.3l-1.9 1.6.8 2.5-2.3-1.5-2.3 1.5.8-2.5-1.9-1.6h2.3Z" fill="${color}"/>`,
  sign: (color) => `
    <rect x="15" y="7" width="2" height="17" rx="0.6" fill="${color}"/>
    <path d="M17 9h7.5l-2 2.1 2 2.1H17Z" fill="${color}"/>
    <path d="M15 14.2H8.2l1.8 1.9-1.8 1.9H15Z" fill="${color}"/>
    <path d="M17 19.4h5.6l-1.5 1.6 1.5 1.6H17Z" fill="${color}"/>`,
  circle: (color) => `<circle cx="16" cy="16" r="8" fill="${color}"/>`,
};

function paintOf(color) {
  return typeof color === "string" && color.trim() ? color : "#0f172a";
}

/** SVG data URL for a point-asset icon, or "" when the shape has no icon. */
export function iconUrl(shape, color) {
  const draw = GLYPHS[shape];
  if (!draw) return "";
  const paint = paintOf(color);
  const markup = `<svg xmlns="http://www.w3.org/2000/svg" width="32" height="32" viewBox="4 4 24 24">${draw(paint)}</svg>`;
  return `data:image/svg+xml;charset=UTF-8,${encodeURIComponent(markup)}`;
}

/** Picture marker shared by every point asset, so the icons stay the same size. */
export function markerSymbol(def, px = 24) {
  const url = iconUrl(def?.shape, def?.swatch);
  if (!url) return null;
  return { type: "picture-marker", url, width: `${px}px`, height: `${px}px` };
}
