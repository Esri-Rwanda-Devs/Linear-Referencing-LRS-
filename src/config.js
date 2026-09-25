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
  { id: "POI", label: "POI", hint: "Points of interest", color: "#e11d48" },
  { id: "ATT", label: "ATT", hint: "Pavement, drain, speed, carriageway", color: "#7c3aed" },
  { id: "NET", label: "NET", hint: "Centerline, network, redline", color: "#0f766e" },
  { id: "PLN", label: "PLN", hint: "Maintenance plans", color: "#be185d" },
];

/** Layer ids from Road_Asset_LRS_Map FeatureServer. */
export const LRS_LAYER_DEFS = [
  { id: 3, title: "Road Network", group: "NET", kind: "line", route: true, shape: "bar", color: [56, 189, 248, 0.95], width: 4, swatch: "#38bdf8" },
  { id: 4, title: "Centerline", group: "NET", kind: "line", shape: "bar", color: [251, 191, 36, 0.95], width: 2.5, swatch: "#fbbf24" },
  { id: 1, title: "Redline", group: "NET", kind: "line", shape: "bar", color: [251, 113, 133, 0.95], width: 2.5, swatch: "#fb7185" },
  { id: 8, title: "Pavement Type", group: "ATT", kind: "line", shape: "bar", color: [251, 146, 60, 0.9], width: 4, swatch: "#fb923c" },
  { id: 7, title: "Drain Type", group: "ATT", kind: "line", shape: "bar", color: [34, 211, 238, 0.9], width: 2, swatch: "#22d3ee" },
  { id: 5, title: "Speed Limit", group: "ATT", kind: "line", shape: "bar", color: [74, 222, 128, 0.95], width: 2.5, swatch: "#4ade80" },
  { id: 2, title: "Carriageway Type", group: "ATT", kind: "line", shape: "bar", color: [196, 181, 253, 0.95], width: 2, swatch: "#c4b5fd" },
  { id: 13, title: "Bridges", group: "POI", kind: "point", shape: "circle", color: [255, 255, 255, 0.95], swatch: "#ffffff" },
  { id: 12, title: "Calibration Points", group: "POI", kind: "point", shape: "circle", color: [45, 212, 191, 0.95], swatch: "#2dd4bf" },
  { id: 11, title: "Transformers", group: "POI", kind: "point", shape: "circle", color: [232, 121, 249, 0.95], swatch: "#e879f9" },
  { id: 10, title: "Culverts", group: "POI", kind: "point", shape: "circle", color: [253, 186, 116, 0.95], swatch: "#fdba74" },
  { id: 9, title: "LV Supports", group: "POI", kind: "point", shape: "circle", color: [250, 204, 21, 0.95], swatch: "#facc15" },
  { id: 6, title: "Point Assets", group: "POI", kind: "point", shape: "circle", color: [96, 165, 250, 0.95], swatch: "#60a5fa" },
  { id: 0, title: "KM Stones", group: "POI", kind: "point", shape: "circle", color: [244, 114, 182, 0.95], swatch: "#f472b6" },
];

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
