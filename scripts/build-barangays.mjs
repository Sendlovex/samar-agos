// Builds public/data/barangays.json: the barangays served by Catbalogan Water District, with
// official population (PSA 2020 Census via PhilAtlas) and real boundaries from OpenStreetMap
// (Nominatim, © OpenStreetMap contributors, ODbL). Usage: node scripts/build-barangays.mjs
import { writeFileSync, readFileSync, existsSync } from 'node:fs';

const OUT = 'public/js/barangays.js';
// Approximate radius (degrees) for barangays with no boundary in OpenStreetMap.
const APPROX_R = { 'Poblacion 3': 0.0011, 'Poblacion 4': 0.0009, 'Poblacion 6': 0.0009, 'Poblacion 9': 0.0012, Canlapwas: 0.0065, Lagundi: 0.007 };
const CACHE = 'scripts/.osm-barangays-cache.json';
const UA = 'SAMAR-AGOS/1.0 (water service monitoring prototype)';

// Served barangays per CWD Water Safety Plan 2022 / LWUA Monthly Data Sheet Dec 2022.
// level: 'III' = piped house connections, 'I' = communal point source. pop: PSA 2020 Census.
const SERVED = [
  ['Poblacion 1', 1238, 'III'], ['Poblacion 2', 799, 'III'], ['Poblacion 3', 3102, 'III'], ['Poblacion 4', 1038, 'III'],
  ['Poblacion 5', 537, 'III'], ['Poblacion 6', 1344, 'III'], ['Poblacion 7', 1368, 'III'], ['Poblacion 8', 1169, 'III'],
  ['Poblacion 9', 2988, 'III'], ['Poblacion 10', 1838, 'III'], ['Poblacion 11', 1027, 'III'], ['Poblacion 12', 620, 'III'],
  ['Poblacion 13', 4266, 'III'], ['San Andres', 5898, 'III'], ['Canlapwas', 11805, 'III'], ['San Pablo', 1209, 'III'],
  ['Muñoz', 1712, 'III'], ['Mercedes', 12281, 'III'], ['Maulong', 5954, 'III'], ['Guindaponan', 3597, 'III'],
  ['Guinsorongan', 4255, 'III'], ['Bunuanan', 4786, 'III'], ['Darahuway Gote', 689, 'I'], ['Darahuway Daco', 810, 'I'],
  ['Payao', 2093, 'I'], ['Lagundi', 1023, 'I'],
];
// Alternative spellings to try in OpenStreetMap.
const ALT = {
  'Poblacion 1': ['Barangay 1', 'Poblacion I'], 'Poblacion 2': ['Barangay 2'], 'Poblacion 3': ['Barangay 3'], 'Poblacion 4': ['Barangay 4'],
  'Poblacion 5': ['Barangay 5'], 'Poblacion 6': ['Barangay 6'], 'Poblacion 7': ['Barangay 7'], 'Poblacion 8': ['Barangay 8'],
  'Poblacion 9': ['Barangay 9'], 'Poblacion 10': ['Barangay 10'], 'Poblacion 11': ['Barangay 11'], 'Poblacion 12': ['Barangay 12'],
  'Poblacion 13': ['Barangay 13'], Guindaponan: ['Guindapunan'], 'Darahuway Gote': ['Darahuway Guti'], 'Darahuway Daco': ['Darahuway Dako'], Muñoz: ['Munoz'],
};

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const cache = existsSync(CACHE) ? JSON.parse(readFileSync(CACHE, 'utf8')) : {};

async function lookup(name) {
  for (const q of [name, ...(ALT[name] || [])]) {
    if (cache[q] !== undefined) {
      if (cache[q]) return cache[q];
      continue;
    }
    const url = `https://nominatim.openstreetmap.org/search?q=${encodeURIComponent(`${q}, Catbalogan, Samar`)}&format=jsonv2&polygon_geojson=1&limit=5`;
    const res = await fetch(url, { headers: { 'User-Agent': UA } });
    await sleep(1200); // Nominatim usage policy: max 1 request per second
    const hits = res.ok ? await res.json() : [];
    const hit = hits.find((h) => /Catbalogan/.test(h.display_name) && h.category === 'boundary' && /Polygon/.test(h.geojson?.type || '')) || hits.find((h) => /Catbalogan/.test(h.display_name) && h.category === 'place');
    cache[q] = hit ? { osm: `${hit.osm_type}/${hit.osm_id}`, lat: +hit.lat, lng: +hit.lon, geojson: /Polygon/.test(hit.geojson?.type || '') ? hit.geojson : null } : null;
    writeFileSync(CACHE, JSON.stringify(cache));
    if (cache[q]) return cache[q];
  }
  return null;
}

// Douglas–Peucker simplification (in degrees) to keep the file small.
function simplify(pts, eps = 0.00012) {
  if (pts.length < 3) return pts;
  const d = (p, a, b) => {
    const [x, y] = p, [x1, y1] = a, [x2, y2] = b;
    const L = (x2 - x1) ** 2 + (y2 - y1) ** 2;
    if (!L) return Math.hypot(x - x1, y - y1);
    const t = Math.max(0, Math.min(1, ((x - x1) * (x2 - x1) + (y - y1) * (y2 - y1)) / L));
    return Math.hypot(x - (x1 + t * (x2 - x1)), y - (y1 + t * (y2 - y1)));
  };
  let idx = 0, max = 0;
  for (let i = 1; i < pts.length - 1; i++) {
    const v = d(pts[i], pts[0], pts[pts.length - 1]);
    if (v > max) (max = v), (idx = i);
  }
  if (max <= eps) return [pts[0], pts[pts.length - 1]];
  return [...simplify(pts.slice(0, idx + 1), eps).slice(0, -1), ...simplify(pts.slice(idx), eps)];
}

const slug = (s) => s.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]+/g, '-');
const out = [];
for (const [name, pop, level] of SERVED) {
  const hit = await lookup(name);
  let ring = null;
  if (hit?.geojson) {
    const g = hit.geojson;
    const rings = g.type === 'Polygon' ? [g.coordinates[0]] : g.coordinates.map((p) => p[0]);
    const biggest = rings.sort((a, b) => b.length - a.length)[0];
    ring = simplify(biggest.map(([lng, lat]) => [lat, lng])).map(([a, b]) => [+a.toFixed(5), +b.toFixed(5)]);
  }
  let approx = false;
  if (!ring && hit) {
    // No boundary mapped: use a hexagon around the OSM place point and flag it as approximate.
    const r = APPROX_R[name] || 0.002;
    const k = Math.cos((hit.lat * Math.PI) / 180);
    ring = Array.from({ length: 6 }, (_, i) => [+(hit.lat + r * Math.sin((i * Math.PI) / 3)).toFixed(5), +(hit.lng + (r / k) * Math.cos((i * Math.PI) / 3)).toFixed(5)]);
    approx = true;
  }
  out.push({ id: slug(name), name, pop2020: pop, level, osm: hit?.osm || null, center: hit ? [+hit.lat.toFixed(5), +hit.lng.toFixed(5)] : null, ring, approx });
  console.log(`${name.padEnd(16)} ${hit ? (ring ? `polygon ${ring.length} pts` : 'point only') : 'NOT FOUND'}`);
}
const meta = { generated: new Date().toISOString().slice(0, 10), sources: ['PSA 2020 Census of Population (via PhilAtlas)', 'Catbalogan Water District Water Safety Plan 2022', 'LWUA Monthly Data Sheet Dec 2022', 'OpenStreetMap contributors (ODbL), via Nominatim'] };
writeFileSync(OUT, `// Generated by scripts/build-barangays.mjs — do not edit by hand.
// Sources: ${meta.sources.join('; ')}.
export const BARANGAY_META = ${JSON.stringify(meta)};
export const SERVED_BARANGAYS = ${JSON.stringify(out)};
`);
console.log(`wrote ${OUT}`);
