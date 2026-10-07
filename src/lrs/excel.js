import { groupLabel } from "../config";

const BASE = ["Route", "Layer", "Group", "Asset", "From km", "To km", "Length km", "Longitude", "Latitude"];

function xmlEscape(value) {
  return String(value ?? "")
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

function colLetter(index) {
  let n = index + 1;
  let letters = "";
  while (n > 0) {
    const rem = (n - 1) % 26;
    letters = String.fromCharCode(65 + rem) + letters;
    n = Math.floor((n - 1) / 26);
  }
  return letters;
}

function sheetName(name) {
  return xmlEscape(String(name).replace(/[:\\/?*[\]]/g, " ").slice(0, 31)) || "Sheet";
}

function fileName(name) {
  const clean = String(name).replace(/[^\w.-]+/g, "_").replace(/_+/g, "_").slice(0, 80);
  return clean.endsWith(".xlsx") ? clean : `${clean}.xlsx`;
}

const CRC_TABLE = new Uint32Array(256);
for (let n = 0; n < 256; n += 1) {
  let c = n;
  for (let k = 0; k < 8; k += 1) c = (c & 1) ? (0xedb88320 ^ (c >>> 1)) : (c >>> 1);
  CRC_TABLE[n] = c >>> 0;
}

function crc32(data) {
  let c = 0xffffffff;
  for (let i = 0; i < data.length; i += 1) c = CRC_TABLE[(c ^ data[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function concat(chunks) {
  const size = chunks.reduce((sum, chunk) => sum + chunk.length, 0);
  const out = new Uint8Array(size);
  let offset = 0;
  chunks.forEach((chunk) => {
    out.set(chunk, offset);
    offset += chunk.length;
  });
  return out;
}

function u16(value) {
  const bytes = new Uint8Array(2);
  new DataView(bytes.buffer).setUint16(0, value, true);
  return bytes;
}

function u32(value) {
  const bytes = new Uint8Array(4);
  new DataView(bytes.buffer).setUint32(0, value, true);
  return bytes;
}

function zipStore(files) {
  const locals = [];
  const central = [];
  let offset = 0;
  files.forEach((file) => {
    const name = new TextEncoder().encode(file.name);
    const crc = crc32(file.data);
    const local = concat([
      u32(0x04034b50), u16(20), u16(0), u16(0), u16(0), u16(0),
      u32(crc), u32(file.data.length), u32(file.data.length),
      u16(name.length), u16(0), name, file.data,
    ]);
    const entry = concat([
      u32(0x02014b50), u16(20), u16(20), u16(0), u16(0), u16(0), u16(0),
      u32(crc), u32(file.data.length), u32(file.data.length),
      u16(name.length), u16(0), u16(0), u16(0), u16(0), u32(0),
      u32(offset), name,
    ]);
    locals.push(local);
    central.push(entry);
    offset += local.length;
  });
  const directory = concat(central);
  const end = concat([
    u32(0x06054b50), u16(0), u16(0), u16(files.length), u16(files.length),
    u32(directory.length), u32(offset), u16(0),
  ]);
  return concat([...locals, directory, end]);
}

function text(value) {
  return new TextEncoder().encode(value);
}

function cellXml(value, ref, header) {
  const style = header ? ` s="1"` : "";
  if (typeof value === "number" && Number.isFinite(value)) {
    return `<c r="${ref}"${style}><v>${value}</v></c>`;
  }
  const raw = value === null || value === undefined ? "" : String(value);
  const space = /^\s|\s$/.test(raw) ? ` xml:space="preserve"` : "";
  return `<c r="${ref}" t="inlineStr"${style}><is><t${space}>${xmlEscape(raw)}</t></is></c>`;
}

function worksheetXml(rows) {
  const width = Math.max(1, ...rows.map((row) => row.length));
  const height = Math.max(1, rows.length);
  const last = `${colLetter(width - 1)}${height}`;
  const body = rows.map((row, rowIndex) => {
    const cells = row.map((value, column) => cellXml(value, `${colLetter(column)}${rowIndex + 1}`, rowIndex === 0)).join("");
    return `<row r="${rowIndex + 1}">${cells}</row>`;
  }).join("");
  const cols = Array.from({ length: width }, (_, index) => {
    const widest = rows.reduce((max, row) => Math.max(max, String(row[index] ?? "").length), 10);
    return `<col min="${index + 1}" max="${index + 1}" width="${Math.min(42, Math.max(12, widest + 2))}" customWidth="1"/>`;
  }).join("");
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">
<dimension ref="A1:${last}"/>
<sheetViews><sheetView workbookViewId="0"><pane ySplit="1" topLeftCell="A2" activePane="bottomLeft" state="frozen"/></sheetView></sheetViews>
<cols>${cols}</cols>
<sheetData>${body}</sheetData>
<tableParts count="1"><tablePart r:id="rId1"/></tableParts>
</worksheet>`;
}

function tableXml(id, name, rows) {
  const width = Math.max(1, ...rows.map((row) => row.length));
  const height = Math.max(1, rows.length);
  const ref = `A1:${colLetter(width - 1)}${height}`;
  const headers = rows[0] || ["Data"];
  const columns = headers.map((header, index) => {
    const title = String(header || `Column ${index + 1}`);
    return `<tableColumn id="${index + 1}" name="${xmlEscape(title)}"/>`;
  }).join("");
  const display = name.replace(/[^A-Za-z0-9_]/g, "") || `Table${id}`;
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<table xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" id="${id}" name="${display}" displayName="${display}" ref="${ref}" totalsRowShown="0">
<autoFilter ref="${ref}"/>
<tableColumns count="${width}">${columns}</tableColumns>
<tableStyleInfo name="TableStyleMedium2" showFirstColumn="0" showLastColumn="0" showRowStripes="1" showColumnStripes="0"/>
</table>`;
}

const STYLES = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">
<fonts count="2"><font><sz val="11"/><name val="Calibri"/></font><font><b/><sz val="11"/><color rgb="FFFFFFFF"/><name val="Calibri"/></font></fonts>
<fills count="3"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill><fill><patternFill patternType="solid"><fgColor rgb="FF166534"/></patternFill></fill></fills>
<borders count="1"><border><left/><right/><top/><bottom/><diagonal/></border></borders>
<cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>
<cellXfs count="2"><xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/><xf numFmtId="0" fontId="1" fillId="2" borderId="0" xfId="0" applyFont="1" applyFill="1"/></cellXfs>
</styleSheet>`;

function buildXlsx(sheets) {
  const files = [
    { name: "[Content_Types].xml", data: text(contentTypes(sheets.length)) },
    { name: "_rels/.rels", data: text(`<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/>
</Relationships>`) },
    { name: "xl/workbook.xml", data: text(workbookXml(sheets)) },
    { name: "xl/_rels/workbook.xml.rels", data: text(workbookRels(sheets.length)) },
    { name: "xl/styles.xml", data: text(STYLES) },
  ];
  sheets.forEach((sheet, index) => {
    const n = index + 1;
    files.push({ name: `xl/worksheets/sheet${n}.xml`, data: text(worksheetXml(sheet.rows)) });
    files.push({ name: `xl/worksheets/_rels/sheet${n}.xml.rels`, data: text(`<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/table" Target="../tables/table${n}.xml"/>
</Relationships>`) });
    files.push({ name: `xl/tables/table${n}.xml`, data: text(tableXml(n, sheet.name, sheet.rows)) });
  });
  return zipStore(files);
}

function contentTypes(count) {
  const overrides = [
    `<Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>`,
    `<Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>`,
  ];
  for (let n = 1; n <= count; n += 1) {
    overrides.push(`<Override PartName="/xl/worksheets/sheet${n}.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>`);
    overrides.push(`<Override PartName="/xl/tables/table${n}.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.table+xml"/>`);
  }
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
<Default Extension="xml" ContentType="application/xml"/>
${overrides.join("")}
</Types>`;
}

function workbookXml(sheets) {
  const list = sheets.map((sheet, index) => `<sheet name="${sheetName(sheet.name)}" sheetId="${index + 1}" r:id="rId${index + 1}"/>`).join("");
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">
<sheets>${list}</sheets>
</workbook>`;
}

function workbookRels(count) {
  const links = [];
  for (let n = 1; n <= count; n += 1) {
    links.push(`<Relationship Id="rId${n}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet${n}.xml"/>`);
  }
  links.push(`<Relationship Id="rId${count + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>`);
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
${links.join("")}
</Relationships>`;
}

function downloadWorkbook(filename, sheets) {
  const bytes = buildXlsx(sheets);
  const url = URL.createObjectURL(new Blob([bytes], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" }));
  const link = document.createElement("a");
  link.href = url;
  link.download = fileName(filename);
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}

const round = (value) => Math.round(value * 1000) / 1000;

function inRange(event, range) {
  if (!range) return true;
  if (event.kind === "span") return event.to > range.from && event.from < range.to;
  return event.measure >= range.from && event.measure <= range.to;
}

function detailLabels(events) {
  const labels = [];
  const seen = new Set();
  events.forEach((event) => {
    (event.details || []).forEach(([label]) => {
      if (seen.has(label)) return;
      seen.add(label);
      labels.push(label);
    });
  });
  return labels;
}

function assetValues(routeId, event, range, labels) {
  const span = event.kind === "span";
  const from = span ? event.from : event.measure;
  const to = span ? event.to : "";
  const length = span
    ? Math.max(0, (range ? Math.min(range.to, event.to) : event.to) - (range ? Math.max(range.from, event.from) : event.from))
    : "";
  const [lon, lat] = event.point || [];
  const details = new Map(event.details || []);
  return [
    routeId,
    event.title || "",
    groupLabel(event.group),
    event.name || "",
    Number.isFinite(from) ? round(from) : "",
    to === "" || !Number.isFinite(to) ? "" : round(to),
    length === "" ? "" : round(length),
    Number.isFinite(lon) ? lon : "",
    Number.isFinite(lat) ? lat : "",
    ...labels.map((label) => details.get(label) ?? ""),
  ];
}

function uniqueHeaders(headers) {
  const seen = new Map();
  return headers.map((header, index) => {
    const base = String(header || `Column ${index + 1}`).replace(/[[\]]/g, " ").trim().slice(0, 80) || `Column ${index + 1}`;
    const key = base.toLowerCase();
    const count = seen.get(key) || 0;
    seen.set(key, count + 1);
    return count === 0 ? base : `${base} ${count + 1}`;
  });
}

function assetSheet(events, range, leading = []) {
  const chosen = events.filter((event) => inRange(event, range));
  const labels = detailLabels(chosen);
  const headers = uniqueHeaders([...leading, ...BASE, ...labels]);
  const rows = [headers];
  chosen.forEach((event) => {
    const prefix = leading.length ? [event.side || ""] : [];
    rows.push([...prefix, ...assetValues(event.routeId, event, range, labels)]);
  });
  return rows;
}

function summaryRows(events) {
  const rows = [["Route", "Layer", "Group", "Assets", "Length km"]];
  const layers = new Map();
  events.forEach((event) => {
    const key = `${event.routeId}|${event.layerId}`;
    const layer = layers.get(key) || { routeId: event.routeId, title: event.title, group: groupLabel(event.group), count: 0, length: 0 };
    layer.count += 1;
    if (event.kind === "span") layer.length += Math.max(0, event.to - event.from);
    layers.set(key, layer);
  });
  [...layers.values()].forEach((layer) => {
    rows.push([layer.routeId, layer.title, layer.group, layer.count, layer.length ? round(layer.length) : ""]);
  });
  return rows;
}

function tagged(routeId, events, side) {
  return events.map((event) => ({ ...event, routeId, side }));
}

export function exportRouteAssets(route, events) {
  const rows = tagged(route.id, events);
  downloadWorkbook(`route-${route.id}-assets`, [
    { name: "Assets", rows: assetSheet(rows) },
    { name: "Summary", rows: summaryRows(rows) },
  ]);
}

export function exportSegmentAssets(route, events, segment) {
  const from = round(segment.from);
  const to = round(segment.to);
  const rows = tagged(route.id, events.filter((event) => inRange(event, segment)));
  downloadWorkbook(`route-${route.id}-${from}-${to}-km`, [
    { name: "Assets", rows: assetSheet(rows, segment) },
    { name: "Summary", rows: summaryRows(rows) },
  ]);
}

export function exportComparison(a, b) {
  const rows = [...tagged(a.route.id, a.events, "A"), ...tagged(b.route.id, b.events, "B")];
  downloadWorkbook(`compare-${a.route.id}-vs-${b.route.id}`, [
    { name: "Assets", rows: assetSheet(rows, null, ["Side"]) },
    { name: "Summary", rows: summaryRows(rows) },
  ]);
}
