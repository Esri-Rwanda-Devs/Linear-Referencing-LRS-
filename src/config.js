export const PORTAL = "https://gh.space.gov.rw/portal";
export const LRS = "https://gh.space.gov.rw/server/rest/services/Road_Asset_LRS_Map/FeatureServer";
export const ROAD = "https://gh.space.gov.rw/server/rest/services/Road/FeatureServer";
export const WATER = "https://gh.space.gov.rw/server/rest/services/Water/FeatureServer";
export const ADMIN = "https://gh.space.gov.rw/server/rest/services/Admin_Boundaries/FeatureServer";

/** Map Viewer item from the request. It is not public; the app uses the open Road service on the same server. */
export const REQUESTED_ITEM = "44f8c12876dc4751b3ec8c4116c4202f";

export const EVENT_LAYERS = [
  { id: "bus", group: "POI", layerId: 0, service: "road", title: "Bus stops", kind: "point", shape: "triangle", color: "#2f6fed", labelFields: ["bus_stop_name", "name"] },
  { id: "signs", group: "POI", layerId: 12, service: "road", title: "Road signs", kind: "point", shape: "diamond", color: "#7a4e2d", labelFields: ["road_signs_type", "trajectory"] },
  { id: "bridges", group: "LOC", layerId: 13, service: "road", title: "Bridges", kind: "point", shape: "x", color: "#1c1c1c", labelFields: ["name", "ref"] },
  { id: "junctions", group: "LOC", layerId: 11, service: "road", title: "Junctions", kind: "point", shape: "plus", color: "#c45512", labelFields: ["highway", "ref"] },
  { id: "lights", group: "LOC", layerId: 15, service: "road", title: "Street lights", kind: "point", shape: "triangle", color: "#1f8a4c", labelFields: ["syb_name", "so_name", "f_class"] },
  { id: "culverts", group: "LOC", layerId: 1, service: "road", title: "Culverts", kind: "point", shape: "tick", color: "#d97706", labelFields: ["name", "type", "type2"] },
  { id: "ped", group: "LOC", layerId: 10, service: "road", title: "Pedestrian bridges", kind: "point", shape: "diamond", color: "#0f766e", labelFields: ["name", "fclass"] },
  { id: "manholes", group: "LOC", layerId: 6, service: "road", title: "Manholes", kind: "point", shape: "circle", color: "#4b5563", labelFields: ["name", "type"] },
  { id: "tanks", group: "UTL", layerId: 3, service: "water", title: "Water tanks", kind: "point", shape: "square", color: "#0369a1", labelFields: ["assetname", "description", "muid"] },
  { id: "pipes", group: "UTL", layerId: 2, service: "water", title: "Water pipes", kind: "line", shape: "bar", color: "#0284c7", labelFields: ["streetname", "material", "assetname", "description"] },
];

export const GROUPS = [
  { id: "NET", label: "NET", hint: "Road network", color: "#0f766e" },
  { id: "ATT", label: "Line Events", hint: "Pavement, drain, speed, carriageway", color: "#7c3aed" },
  { id: "POI", label: "POI", hint: "Points of interest", color: "#e11d48" },
  { id: "PLN", label: "PLN", hint: "Maintenance plans", color: "#be185d" },
];

export const groupLabel = (id) => GROUPS.find((group) => group.id === id)?.label || id;

/** Layer ids from Road_Asset_LRS_Map FeatureServer. */
export const LRS_LAYER_DEFS = [
  { id: 3, title: "Road Network", group: "NET", kind: "line", route: true, shape: "bar", color: [56, 189, 248, 0.95], width: 4, swatch: "#38bdf8" },
  { id: 8, title: "Pavement Type", group: "ATT", kind: "line", shape: "bar", color: [251, 146, 60, 0.9], width: 4, swatch: "#fb923c" },
  { id: 7, title: "Drain Type", group: "ATT", kind: "line", shape: "bar", color: [34, 211, 238, 0.9], width: 2, swatch: "#22d3ee" },
  { id: 5, title: "Speed Limit", group: "ATT", kind: "line", shape: "bar", color: [74, 222, 128, 0.95], width: 2.5, swatch: "#4ade80" },
  { id: 2, title: "Carriageway Type", group: "ATT", kind: "line", shape: "bar", color: [196, 181, 253, 0.95], width: 2, swatch: "#c4b5fd" },
  { id: 13, title: "Bridges", group: "POI", kind: "point", shape: "square", color: [30, 41, 59, 0.95], swatch: "#1e293b" },
  { id: 12, title: "Calibration Points", group: "POI", kind: "point", chart: false, shape: "diamond", color: [13, 148, 136, 0.95], swatch: "#0d9488" },
  { id: 11, title: "Transformers", group: "POI", kind: "point", shape: "triangle", color: [192, 38, 211, 0.95], swatch: "#c026d3" },
  { id: 10, title: "Culverts", group: "POI", kind: "point", shape: "x", color: [234, 88, 12, 0.95], swatch: "#ea580c" },
  { id: 9, title: "LV Supports", group: "POI", kind: "point", shape: "triangle", color: [22, 163, 74, 0.95], swatch: "#16a34a" },
  { id: 6, title: "Point Assets", group: "POI", kind: "point", shape: "circle", color: [37, 99, 235, 0.95], swatch: "#2563eb" },
  { id: 0, title: "KM Stones", group: "POI", kind: "point", shape: "diamond", color: [219, 39, 119, 0.95], swatch: "#db2777" },
];

/** Chart colours per attribute value, keyed by LRS layer id. Values match case-insensitively. */
export const VALUE_COLORS = {
  5: { field: "maxspeed", colors: { 0: "#E2E8F0", 40: "#B3E0C8", 60: "#E7E774", 80: "#A5A7F2" } },
  2: { field: "cway_type", colors: { divided: "#4C1D95", undivided: "#C4B5FD" } },
  8: { field: "pavement_category", colors: { paved: "#000000", unpaved: "#F0BEA5" } },
  7: { field: "drain_type", colors: { "no drain": "#F7634F", unlined: "#D7C29E", "surface lined": "#9FEB1C", "fully lined": "#002673" } },
};

export const RWANDA_EXTENT = {
  xmin: 3195067.83,
  ymin: -303309.38,
  xmax: 3447434.79,
  ymax: -110720.38,
  spatialReference: { wkid: 102100 },
};

export const TEMPLATES = [
  "Bridge repair",
  "Resurfacing",
  "Drainage works",
  "Street lighting",
  "Water pipe relocation",
  "Junction improvement",
];

export const SNAP_METERS = 80;
export const WINDOW_KM = 8;
