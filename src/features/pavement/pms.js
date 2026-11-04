import { flattenPaths, haversineKm } from "../analysis/utils/geometry";

export const INDICATORS = [
  { id: "pci", label: "PCI", title: "PCI range" },
  { id: "iri", label: "IRI", title: "Roughness range" },
  // { id: "crack", label: "Cracking", title: "Cracking" },
];

export const CLASS_LABEL = { good: "Good", fair: "Fair", poor: "Poor", unknown: "No class" };

export const TREATMENT = {
  good: "Routine maintenance",
  fair: "Resurfacing",
  poor: "Reconstruction",
  unknown: "Inspect",
};

export const PMS_COLORS = {
  good: [22, 163, 74, 0.95],
  fair: [245, 158, 11, 0.95],
  poor: [220, 38, 38, 0.95],
  unknown: [148, 163, 184, 0.8],
};

const POOR_WORD = /\b(poor|bad|failed|severe|critical|extensive)\b/;
const FAIR_WORD = /\b(fair|moderate|medium|average)\b/;
const GOOD_WORD = /\b(good|excellent|sound|none|negligible)\b/;

function textOf(value) {
  if (value === null || value === undefined) return "";
  return String(value).trim();
}

function field(attributes, name) {
  if (!attributes) return null;
  if (attributes[name] !== undefined && attributes[name] !== null) return attributes[name];
  const key = Object.keys(attributes).find((item) => item.toLowerCase() === name);
  return key ? attributes[key] : null;
}

function numberOf(value) {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  const match = textOf(value).match(/-?\d+(?:\.\d+)?/);
  if (!match) return null;
  const number = Number(match[0]);
  return Number.isFinite(number) ? number : null;
}

function rangeMidpoint(text) {
  const raw = textOf(text);
  if (!raw) return null;
  const numbers = raw.match(/\d+(?:\.\d+)?/g)?.map(Number) || [];
  if (!numbers.length) return null;
  if (/>\s*\d/.test(raw) || /\b(over|above)\b/i.test(raw)) return numbers[0] + 0.01;
  if (numbers.length >= 2) return (numbers[0] + numbers[1]) / 2;
  return numbers[0];
}

function words(indicator, text) {
  const raw = text.toLowerCase();
  if (POOR_WORD.test(raw)) return "poor";
  if (FAIR_WORD.test(raw)) return "fair";
  if (GOOD_WORD.test(raw)) return "good";
  if (indicator === "pci") {
    if (/\bhigh\b/.test(raw)) return "good";
    if (/\blow\b/.test(raw)) return "poor";
  } else if (/\b(high|over)\b/.test(raw)) return "poor";
  else if (/\b(low|slight|minor)\b/.test(raw)) return "good";
  return null;
}

function fromNumber(indicator, value) {
  if (indicator === "iri") {
    if (value <= 4) return "good";
    if (value <= 8) return "fair";
    return "poor";
  }
  if (indicator === "crack") {
    if (value <= 5) return "good";
    if (value <= 20) return "fair";
    return "poor";
  }
  if (value >= 70) return "good";
  if (value >= 40) return "fair";
  return "poor";
}

function rated(indicator, label, numeric) {
  const text = textOf(label);
  const named = text ? words(indicator, text) : null;
  if (named) return named;
  const value = Number.isFinite(numeric) ? numeric : rangeMidpoint(text);
  if (!Number.isFinite(value)) return "unknown";
  return fromNumber(indicator, value);
}

export function conditionClass(segment, indicator) {
  if (indicator === "iri") return rated("iri", segment.iriRange, segment.iri);
  // if (indicator === "crack") return rated("crack", segment.cracking, numberOf(segment.cracking));
  return rated("pci", segment.pciRange, segment.pci);
}

export function roadKeyOf(segment) {
  return segment?.roadCode || segment?.routeId || segment?.routeName || "";
}

export function hasPotholes(value) {
  const text = textOf(value).toLowerCase();
  if (!text) return false;
  return !/^(none|no|nil|n\/a|na|0|0%|false|no potholes?)$/.test(text);
}

function pathLength(paths) {
  let km = 0;
  paths.forEach((path) => {
    for (let index = 1; index < path.length; index += 1) km += haversineKm(path[index - 1], path[index]);
  });
  return km;
}

function segmentLength(from, to, paths) {
  const start = Number(from);
  const end = Number(to);
  if (Number.isFinite(start) && Number.isFinite(end) && end > start) {
    const span = end - start;
    return span < 500 ? span : span / 1000;
  }
  return pathLength(paths);
}

/** One pavement feature, with measures in kilometres and paths in longitude/latitude. */
export function toSegment(feature) {
  const attributes = feature?.attributes || {};
  const id = Number(field(attributes, "objectid"));
  if (!Number.isFinite(id)) return null;
  const paths = flattenPaths(feature.geometry || {});
  const from = numberOf(field(attributes, "frommeasure"));
  const to = numberOf(field(attributes, "tomeasure"));
  return {
    id,
    routeId: textOf(field(attributes, "routeid") ?? field(attributes, "fromrouteid")),
    routeName: textOf(field(attributes, "routename")),
    roadCode: textOf(field(attributes, "road_code")),
    roadCategory: textOf(field(attributes, "road_category")),
    linkName: textOf(field(attributes, "link_name")),
    pavementCategory: textOf(field(attributes, "pavement_category")),
    pavementType: textOf(field(attributes, "pavement_type")),
    surfaceType: textOf(field(attributes, "surface_type")),
    from,
    to,
    lengthKm: segmentLength(from, to, paths),
    pci: numberOf(field(attributes, "pci_value")),
    pciRange: textOf(field(attributes, "pci_range")),
    iri: numberOf(field(attributes, "roughness")),
    iriRange: textOf(field(attributes, "roughness_range")),
    cracking: textOf(field(attributes, "cracking")),
    potholes: textOf(field(attributes, "potholes") ?? field(attributes, "patholes")),
    surveyYear: textOf(field(attributes, "survey_year")),
    defects: [
      ["Ravelling", field(attributes, "ravelling")],
      ["Edge break", field(attributes, "edgebreak")],
      ["Bleeding", field(attributes, "bleeding")],
      ["Depression", field(attributes, "depression")],
      ["Shoving", field(attributes, "shoving")],
      ["Shoulder", field(attributes, "shoulder")],
      ["Rutting", field(attributes, "rutting")],
    ].map(([label, value]) => [label, textOf(value)]).filter(([, value]) => value),
    paths,
  };
}

function weightOf(segment, measured) {
  if (measured > 0) return segment.lengthKm > 0 ? segment.lengthKm : 0;
  return 1;
}

export function conditionSummary(segments, indicator) {
  const bins = { good: 0, fair: 0, poor: 0, unknown: 0 };
  const measured = segments.reduce((sum, segment) => sum + (segment.lengthKm > 0 ? segment.lengthKm : 0), 0);
  let pciWeighted = 0;
  let pciLength = 0;
  let iriWeighted = 0;
  let iriLength = 0;
  let total = 0;
  segments.forEach((segment) => {
    const weight = weightOf(segment, measured);
    total += weight;
    bins[conditionClass(segment, indicator)] += weight;
    if (Number.isFinite(segment.pci) && weight) {
      pciWeighted += segment.pci * weight;
      pciLength += weight;
    }
    if (Number.isFinite(segment.iri) && weight) {
      iriWeighted += segment.iri * weight;
      iriLength += weight;
    }
  });
  const averagePci = pciLength ? pciWeighted / pciLength : null;
  const averageIri = iriLength ? iriWeighted / iriLength : null;
  let overall = "unknown";
  if (Number.isFinite(averagePci)) overall = fromNumber("pci", averagePci);
  else {
    const leader = ["poor", "fair", "good"].sort((left, right) => bins[right] - bins[left])[0];
    if (bins[leader] > 0) overall = leader;
  }
  return {
    bins,
    total,
    measured,
    averagePci,
    averageIri,
    overall,
    parts: ["good", "fair", "poor", "unknown"].map((id) => ({
      id,
      label: CLASS_LABEL[id],
      lengthKm: bins[id],
      percent: total > 0 ? (bins[id] / total) * 100 : 0,
    })).filter((part) => part.lengthKm > 0),
  };
}

const CLASS_RANK = { poor: 0, fair: 1, good: 2, unknown: 3 };

export function rankSegments(segments, indicator) {
  return segments.slice().sort((left, right) => {
    const classGap = CLASS_RANK[conditionClass(left, indicator)] - CLASS_RANK[conditionClass(right, indicator)];
    if (classGap) return classGap;
    const leftPci = Number.isFinite(left.pci) ? left.pci : 101;
    const rightPci = Number.isFinite(right.pci) ? right.pci : 101;
    return leftPci - rightPci;
  });
}

export function worstSegments(segments) {
  const scored = segments.filter((segment) => Number.isFinite(segment.pci));
  const source = scored.length ? scored : segments;
  return source.slice().sort((left, right) => {
    const leftPci = Number.isFinite(left.pci) ? left.pci : 101;
    const rightPci = Number.isFinite(right.pci) ? right.pci : 101;
    return leftPci - rightPci;
  }).slice(0, 8);
}

export function priorityIds(segments, indicator) {
  const ranked = rankSegments(segments, indicator);
  const poor = ranked.filter((segment) => conditionClass(segment, indicator) === "poor");
  const chosen = poor.length ? poor : ranked.filter((segment) => conditionClass(segment, indicator) === "fair").slice(0, 5);
  return new Set(chosen.map((segment) => segment.id));
}

export function surveyRecord(segments) {
  const years = new Map();
  segments.forEach((segment) => {
    const year = segment.surveyYear || "Undated";
    const entry = years.get(year) || { year, count: 0, pci: 0, pciCount: 0 };
    entry.count += 1;
    if (Number.isFinite(segment.pci)) {
      entry.pci += segment.pci;
      entry.pciCount += 1;
    }
    years.set(year, entry);
  });
  return [...years.values()].sort((left, right) => String(right.year).localeCompare(String(left.year)));
}
