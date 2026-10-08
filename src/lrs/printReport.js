import { LRS_LAYER_DEFS } from "../config";
import { averageMaxSpeed, summariseSegment } from "./lrsService";

const PRINT_URL = "https://utility.arcgisonline.com/arcgis/rest/services/Utilities/PrintingTools/GPServer/Export%20Web%20Map%20Task";

function loadModules(names) {
  return new Promise((resolve, reject) => {
    const run = () => window.require(names, (...mods) => resolve(mods), reject);
    if (window.require) run();
    else reject(new Error("ArcGIS API failed to load"));
  });
}

const esc = (value) => String(value ?? "").replace(/[&<>"']/g, (char) => ({
  "&": "&amp;",
  "<": "&lt;",
  ">": "&gt;",
  '"': "&quot;",
  "'": "&#39;",
}[char]));

const km = (value) => `${Number(value).toFixed(2)} km`;
const speedText = (value) => `${Number(value.toFixed(1))} km/h`;
const perKm = (count, lengthKm) => (lengthKm > 0 ? count / lengthKm : 0);

function geometriesOf(layer) {
  const list = [];
  layer?.graphics?.forEach((graphic) => {
    if (graphic.geometry) list.push(graphic.geometry);
  });
  return list;
}

async function frameMap(bag) {
  const { view } = bag;
  const saved = view.viewpoint?.clone?.() || null;
  const targets = [
    ...geometriesOf(bag.overlay),
    ...geometriesOf(bag.compareLayer),
    ...geometriesOf(bag.segmentLayer),
  ];
  if (targets.length) await view.goTo({ target: targets, padding: 48 }, { animate: false }).catch(() => {});
  await view.when();
  if (view.updating) {
    await new Promise((resolve) => {
      const handle = view.watch("updating", (updating) => {
        if (!updating) {
          handle.remove();
          resolve();
        }
      });
    });
  }
  return saved;
}

async function esriMapImage(view) {
  const [print, PrintParameters, PrintTemplate] = await loadModules([
    "esri/rest/print",
    "esri/rest/support/PrintParameters",
    "esri/rest/support/PrintTemplate",
  ]);
  const template = new PrintTemplate({
    format: "png32",
    layout: "map-only",
    exportOptions: { width: 1400, height: 780, dpi: 120 },
  });
  const result = await print.execute(PRINT_URL, new PrintParameters({ view, template }));
  if (!result?.url) throw new Error("Esri print did not return a map.");
  return result.url;
}

async function mapImage(view) {
  try {
    return { url: await esriMapImage(view), source: "Esri print service" };
  } catch (error) {
    const shot = await view.takeScreenshot({ format: "png", width: 1400, height: 780 }).catch(() => null);
    if (!shot?.dataUrl) throw error;
    return { url: shot.dataUrl, source: "current map view" };
  }
}

function summaryRows(a, b, speedA, speedB) {
  const rows = [
    ["Length", a.route.lengthKm, b.route.lengthKm, km(a.route.lengthKm), km(b.route.lengthKm)],
    ["Point assets", a.summary.pointCount, b.summary.pointCount,
      `${a.summary.pointCount} <small>${perKm(a.summary.pointCount, a.route.lengthKm).toFixed(1)}/km</small>`,
      `${b.summary.pointCount} <small>${perKm(b.summary.pointCount, b.route.lengthKm).toFixed(1)}/km</small>`],
    ["Average speed", speedA, speedB, speedText(speedA), speedText(speedB)],
  ];
  LRS_LAYER_DEFS.forEach((def) => {
    if (def.route || def.chart === false || def.id === 5) return;
    const onA = a.summary.points.some((layer) => layer.layerId === def.id) || a.summary.spans.some((layer) => layer.layerId === def.id);
    const onB = b.summary.points.some((layer) => layer.layerId === def.id) || b.summary.spans.some((layer) => layer.layerId === def.id);
    if (!onA && !onB) return;
    if (def.kind === "point") {
      const countA = a.summary.points.find((layer) => layer.layerId === def.id)?.items.length || 0;
      const countB = b.summary.points.find((layer) => layer.layerId === def.id)?.items.length || 0;
      rows.push([
        def.title,
        countA,
        countB,
        `${countA} <small>${perKm(countA, a.route.lengthKm).toFixed(1)}/km</small>`,
        `${countB} <small>${perKm(countB, b.route.lengthKm).toFixed(1)}/km</small>`,
      ]);
      return;
    }
    const spanA = a.summary.spans.find((layer) => layer.layerId === def.id);
    const spanB = b.summary.spans.find((layer) => layer.layerId === def.id);
    const text = (span) => (span?.values[0] ? `${esc(span.values[0].name)} <small>${Math.round(span.values[0].share * 100)}%</small>` : "—");
    const share = (span) => span?.values[0]?.share || 0;
    rows.push([def.title, share(spanA), share(spanB), text(spanA), text(spanB), false]);
  });
  return rows.map(([label, left, right, leftText, rightText, emphasize = true]) => `
    <tr>
      <th>${esc(label)}</th>
      <td class="${emphasize && left > right ? "more" : ""}">${leftText}</td>
      <td class="${emphasize && right > left ? "more" : ""}">${rightText}</td>
    </tr>`).join("");
}

function segmentSection(segment) {
  if (!segment) return "";
  const summary = summariseSegment(segment.events, segment.from, segment.to);
  const points = summary.points.map((layer) => `<li><span>${esc(layer.title)}</span><b>${layer.items.length}</b></li>`).join("");
  const spans = summary.spans.map((layer) => {
    const values = layer.values.slice(0, 4).map((value) => `${esc(value.name)} ${km(value.km)}`).join(" · ");
    return `<li><span>${esc(layer.title)}</span><b>${values || km(layer.coveredKm)}</b></li>`;
  }).join("");
  return `
    <section>
      <h2>Selected segment · ${esc(segment.routeId)}</h2>
      <p class="meta">${km(segment.from)} – ${km(segment.to)} · ${km(summary.lengthKm)} · ${summary.pointCount} point assets. Shown in yellow on the map and on the chart.</p>
      <ul class="segment-list">${points}${spans}</ul>
    </section>`;
}

function reportHtml({ a, b, speedA, speedB, charts, segment, map }) {
  const when = new Date().toLocaleString();
  const chartHtml = charts.map((chart) => `
    <figure>
      <figcaption>${esc(chart.title)}</figcaption>
      ${chart.svg}
    </figure>`).join("");
  return `<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8" />
  <title>Route comparison ${esc(a.route.id)} and ${esc(b.route.id)}</title>
  <style>
    @page { size: A4 landscape; margin: 12mm; }
    body { margin: 0; color: #0f172a; font: 13px/1.4 "Segoe UI", sans-serif; }
    h1 { margin: 0 0 4px; font-size: 20px; }
    h2 { margin: 18px 0 6px; font-size: 14px; }
    .meta { margin: 0 0 10px; color: #64748b; font-size: 12px; }
    table { width: 100%; border-collapse: collapse; }
    th, td { padding: 5px 8px; border-bottom: 1px solid #e2e8f0; text-align: left; vertical-align: top; }
    thead th { border-bottom: 2px solid #cbd5e1; }
    tbody th { font-weight: 600; width: 28%; }
    td.more { font-weight: 700; }
    small { display: block; color: #64748b; font-weight: 500; }
    img.map { width: 100%; height: auto; border: 1px solid #e2e8f0; }
    .charts { display: grid; grid-template-columns: 1fr 1fr; gap: 12px; }
    .charts.one { grid-template-columns: 1fr; }
    figure { margin: 0; }
    figcaption { font-weight: 700; margin-bottom: 4px; }
    svg { width: 100%; height: auto; background: #fff; border: 1px solid #e2e8f0; }
    .segment-list { list-style: none; margin: 0; padding: 0; }
    .segment-list li { display: flex; justify-content: space-between; gap: 12px; padding: 3px 0; border-bottom: 1px solid #f1f5f9; }
    .segment-list b { font-weight: 600; text-align: right; }
  </style>
</head>
<body>
  <h1>Route comparison</h1>
  <p class="meta">${esc(when)} · Bold marks the higher value.</p>
  <table>
    <thead>
      <tr><th></th><th>${esc(a.route.id)}</th><th>${esc(b.route.id)}</th></tr>
    </thead>
    <tbody>${summaryRows(a, b, speedA, speedB)}</tbody>
  </table>
  ${segmentSection(segment)}
  <h2>Map</h2>
  <p class="meta">${esc(map.source)}. Route A is cyan, route B is magenta${segment ? ", and the selected segment is yellow" : ""}.</p>
  <img class="map" alt="Printed map" src="${esc(map.url)}" />
  <h2>Chart</h2>
  <div class="charts${charts.length > 1 ? "" : " one"}">${chartHtml}</div>
  <script>
    const image = document.querySelector("img.map");
    const go = () => setTimeout(() => window.print(), 250);
    if (!image || image.complete) go();
    else { image.onload = go; image.onerror = go; }
  </script>
</body>
</html>`;
}

function openReport() {
  const page = window.open("", "lrs-print");
  if (!page) throw new Error("Allow pop-ups to print.");
  page.document.write("<p style=\"font-family:sans-serif;padding:24px\">Preparing the map and charts…</p>");
  return page;
}

function writeReport(page, html) {
  page.document.open();
  page.document.write(html);
  page.document.close();
}

function layerLines(summary, lengthKm) {
  const rows = [];
  LRS_LAYER_DEFS.forEach((def) => {
    if (def.route || def.chart === false || def.id === 5) return;
    if (def.kind === "point") {
      const count = summary.points.find((layer) => layer.layerId === def.id)?.items.length || 0;
      if (!count) return;
      rows.push([def.title, `${count} <small>${perKm(count, lengthKm).toFixed(1)}/km</small>`]);
      return;
    }
    const span = summary.spans.find((layer) => layer.layerId === def.id);
    if (!span?.values?.length) return;
    const values = span.values.slice(0, 4).map((value) => `${esc(value.name)} <small>${Math.round(value.share * 100)}% · ${km(value.km)}</small>`).join("");
    rows.push([def.title, values]);
  });
  return rows;
}

function routeReportHtml({ route, events, segment, charts, map }) {
  const when = new Date().toLocaleString();
  const from = segment ? segment.from : 0;
  const to = segment ? segment.to : route.lengthKm;
  const focused = summariseSegment(events, from, to);
  const lengthKm = Math.max(0, to - from);
  const speed = averageMaxSpeed(events.map((event) => ({ ...event, from: event.from - from, to: event.to - from })), lengthKm);
  const rows = [
    ["Length", km(lengthKm)],
    ["Point assets", `${focused.pointCount} <small>${perKm(focused.pointCount, lengthKm).toFixed(1)}/km</small>`],
    ["Average speed", speedText(speed)],
    ...layerLines(focused, lengthKm),
  ];
  const chartHtml = (charts || []).map((chart) => `
    <figure>
      <figcaption>${esc(chart.title || route.id)}</figcaption>
      ${chart.svg}
    </figure>`).join("");
  const heading = segment ? `Segment · ${esc(route.id)}` : `Route · ${esc(route.id)}`;
  const range = segment ? `${km(segment.from)} – ${km(segment.to)} · ` : "";
  return `<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8" />
  <title>${heading}</title>
  <style>
    @page { size: A4 landscape; margin: 12mm; }
    body { margin: 0; color: #0f172a; font: 13px/1.4 "Segoe UI", sans-serif; }
    h1 { margin: 0 0 4px; font-size: 20px; }
    h2 { margin: 18px 0 6px; font-size: 14px; }
    .meta { margin: 0 0 10px; color: #64748b; font-size: 12px; }
    table { width: 100%; border-collapse: collapse; }
    th, td { padding: 5px 8px; border-bottom: 1px solid #e2e8f0; text-align: left; vertical-align: top; }
    tbody th { font-weight: 600; width: 28%; }
    small { display: block; color: #64748b; font-weight: 500; }
    img.map { width: 100%; height: auto; border: 1px solid #e2e8f0; }
    .charts { display: grid; grid-template-columns: 1fr; gap: 12px; }
    figure { margin: 0; }
    figcaption { font-weight: 700; margin-bottom: 4px; }
    svg { width: 100%; height: auto; background: #fff; border: 1px solid #e2e8f0; }
  </style>
</head>
<body>
  <h1>${heading}</h1>
  <p class="meta">${esc(when)} · ${range}${km(route.lengthKm)} route</p>
  <table><tbody>${rows.map(([label, text]) => `<tr><th>${esc(label)}</th><td>${text}</td></tr>`).join("")}</tbody></table>
  <h2>Map</h2>
  <p class="meta">${esc(map.source)}. The route is cyan${segment ? " and the selected segment is yellow" : ""}.</p>
  <img class="map" alt="Printed map" src="${esc(map.url)}" />
  <h2>Chart</h2>
  <div class="charts">${chartHtml}</div>
  <script>
    const image = document.querySelector("img.map");
    const go = () => setTimeout(() => window.print(), 250);
    if (!image || image.complete) go();
    else { image.onload = go; image.onerror = go; }
  </script>
</body>
</html>`;
}

async function runPrint(bag, buildHtml) {
  const page = openReport();
  const view = bag?.view;
  if (!view) {
    page.close();
    throw new Error("The map is not ready to print yet.");
  }
  let saved = null;
  try {
    saved = await frameMap(bag);
    const map = await mapImage(view);
    writeReport(page, buildHtml(map));
  } catch (error) {
    page.close();
    throw error;
  } finally {
    if (saved) view.goTo(saved, { animate: false }).catch(() => {});
  }
}

export function chartSnapshots() {
  const columns = [...document.querySelectorAll(".chart-col")];
  const fromColumns = columns.map((col) => ({
    title: col.querySelector(".compare-chart-head b")?.textContent?.trim() || "",
    svg: col.querySelector("svg.chart")?.outerHTML || "",
  })).filter((chart) => chart.svg);
  if (fromColumns.length) return fromColumns;
  return [...document.querySelectorAll("svg.chart")].map((svg) => ({ title: "", svg: svg.outerHTML }));
}

/** Prints the comparison summary, an Esri map, the charts, and the selected segment when one is set. */
function withSummary(side) {
  if (side?.summary) return side;
  return { ...side, summary: summariseSegment(side.events, 0, side.route.lengthKm) };
}

export function printMapReport({ bag, a, b, speedA, speedB, charts, segment }) {
  const left = withSummary(a);
  const right = withSummary(b);
  return runPrint(bag, (map) => reportHtml({
    a: left,
    b: right,
    speedA: speedA ?? averageMaxSpeed(left.events, left.route.lengthKm),
    speedB: speedB ?? averageMaxSpeed(right.events, right.route.lengthKm),
    charts: charts || chartSnapshots(),
    segment,
    map,
  }));
}

/** Prints one route, or the selected segment of that route, with the map and chart. */
export function printRouteReport({ bag, route, events, segment, charts }) {
  return runPrint(bag, (map) => routeReportHtml({ route, events, segment, charts: charts || chartSnapshots(), map }));
}
