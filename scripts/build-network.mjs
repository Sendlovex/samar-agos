// Builds public/data/network.json — an illustrative water network routed along
// real Catbalogan City roads (© OpenStreetMap contributors, ODbL).
//
//   node scripts/build-network.mjs public/data/network.json [cache.json]
//
// 1. Road graph from OSM (cached so re-runs don't hit Overpass).
// 2. Keep road segments inside (or just outside) the service zones.
// 3. Keep only the part connected to the Central Reservoir — no floating fragments.
// 4. Transmission mains = shortest routes from the reservoir to tanks, wells,
//    booster pump and each zone; every other connected street = distribution.
import { writeFileSync, readFileSync, existsSync, mkdirSync } from 'node:fs';

const OUT = process.argv[2] || 'public/data/network.json';
const CACHE = process.argv[3] || 'scripts/.osm-roads-cache.json';
const BBOX = [11.749, 124.856, 11.812, 124.916];
const ENDPOINTS = ['https://overpass-api.de/api/interpreter', 'https://overpass.kumi.systems/api/interpreter', 'https://maps.mail.ru/osm/tools/overpass/api/interpreter'];

// Keep in sync with ZONE_LL / asset positions in public/js/data.js
const ZONES = {
  A: [[11.7835, 124.8815], [11.7825, 124.8875], [11.776, 124.889], [11.7735, 124.885], [11.776, 124.881], [11.7795, 124.879], [11.7815, 124.879]],
  B: [[11.812, 124.858], [11.81, 124.866], [11.798, 124.874], [11.789, 124.881], [11.7835, 124.8815], [11.7815, 124.879], [11.7845, 124.8725], [11.7925, 124.8635], [11.804, 124.8575]],
  C: [[11.789, 124.881], [11.798, 124.874], [11.8, 124.89], [11.797, 124.906], [11.786, 124.908], [11.779, 124.899], [11.776, 124.889], [11.7825, 124.8875], [11.7835, 124.8815]],
  D: [[11.779, 124.899], [11.786, 124.908], [11.777, 124.916], [11.762, 124.914], [11.755, 124.906], [11.7615, 124.8915], [11.769, 124.8895], [11.776, 124.889]],
  E: [[11.776, 124.881], [11.7735, 124.885], [11.776, 124.889], [11.769, 124.8895], [11.7615, 124.8915], [11.75, 124.896], [11.7495, 124.8855], [11.758, 124.882], [11.77, 124.8835]],
};
const RESERVOIR = [11.785, 124.8935];
const TARGETS = [
  [11.7905, 124.87], // TNK-01 Mercedes Elevated Tank
  [11.764, 124.9075], // TNK-02 Uplands Ground Tank
  [11.765, 124.887], // TNK-03 South Coastal Elevated Tank
  [11.7775, 124.8845], // WEL-01
  [11.795, 124.887], // WEL-02
  [11.788, 124.8735], // PS-03 Mercedes Booster
  [11.803, 124.8635], // Payao (north end of Zone B)
  [11.7541, 124.8886], // Bunuanan (south end of Zone E)
  [11.7598, 124.9053], // Lagundi
];

// ---------------------------------------------------------------- fetch (cached)
const ROAD = /^(trunk|primary|secondary|tertiary|unclassified|residential|living_street)$/;

// Primary source: the main OSM API map call (4 small boxes). XML parsed with regexes —
// enough for <node>, <way>, <nd> and <tag> elements.
async function fetchOsmApi() {
  const [s, w, n, e] = BBOX;
  const ml = (s + n) / 2, mg = (w + e) / 2;
  const tiles = [[s, w, ml, mg], [s, mg, ml, e], [ml, w, n, mg], [ml, mg, n, e]];
  const nodes = new Map();
  const ways = new Map();
  for (const [ts, tw, tn, te] of tiles) {
    const url = `https://api.openstreetmap.org/api/0.6/map?bbox=${tw},${ts},${te},${tn}`;
    const r = await fetch(url, { headers: { 'User-Agent': 'SAMAR-AGOS-hackathon-prototype (one-off road extract)' } });
    if (!r.ok) throw new Error(`OSM API ${r.status}`);
    const xml = await r.text();
    for (const m of xml.matchAll(/<node id="(\d+)"[^>]*?lat="([-\d.]+)" lon="([-\d.]+)"/g)) nodes.set(+m[1], { lat: +m[2], lon: +m[3] });
    for (const m of xml.matchAll(/<way id="(\d+)"[^>]*>([\s\S]*?)<\/way>/g)) {
      const tags = Object.fromEntries([...m[2].matchAll(/<tag k="([^"]+)" v="([^"]*)"/g)].map((t) => [t[1], t[2].replace(/&amp;/g, '&').replace(/&quot;/g, '"')]));
      if (!ROAD.test(tags.highway || '')) continue;
      ways.set(+m[1], { id: +m[1], nodes: [...m[2].matchAll(/<nd ref="(\d+)"/g)].map((x) => +x[1]), tags });
    }
    console.log('osm api tile ok', ways.size, 'road ways so far');
    await new Promise((res) => setTimeout(res, 1500));
  }
  // nodes outside a tile box may be missing from that tile's response; keep only fully resolved geometry
  return [...ways.values()]
    .map((w) => {
      const ids = w.nodes.filter((id) => nodes.has(id));
      return { ...w, nodes: ids, geometry: ids.map((id) => nodes.get(id)) };
    })
    .filter((w) => w.nodes.length >= 2);
}

async function fetchRoads() {
  if (existsSync(CACHE)) return JSON.parse(readFileSync(CACHE, 'utf8'));
  try {
    const data = await fetchOsmApi();
    writeFileSync(CACHE, JSON.stringify(data));
    return data;
  } catch (err) {
    console.log('OSM API failed, falling back to Overpass:', err.message);
  }
  const partial = existsSync(CACHE + '.partial') ? JSON.parse(readFileSync(CACHE + '.partial', 'utf8')) : { done: [], ways: [] };
  const ways = new Map(partial.ways.map((w) => [w.id, w]));
  const split = ([s, w, n, e]) => {
    const ml = (s + n) / 2, mg = (w + e) / 2;
    return [[s, w, ml, mg], [s, mg, ml, e], [ml, w, n, mg], [ml, mg, n, e]];
  };
  // Small tiles are much less likely to time out on busy public servers; failed tiles split further.
  const queue = split(BBOX).map((t) => ({ t, depth: 1 }));
  while (queue.length) {
    const { t, depth } = queue.shift();
    const id = t.map((v) => v.toFixed(4)).join(',');
    if (partial.done.includes(id)) continue;
    const q = `[out:json][timeout:25];way["highway"~"^(trunk|primary|secondary|tertiary|unclassified|residential|living_street)$"](${id});out body geom;`;
    let ok = false;
    for (const url of ENDPOINTS) {
      await new Promise((r) => setTimeout(r, 8000));
      try {
        const r = await fetch(url + '?data=' + encodeURIComponent(q), { headers: { 'User-Agent': 'SAMAR-AGOS-hackathon-prototype' } });
        if (!r.ok) throw new Error(r.status);
        (await r.json()).elements.forEach((el) => ways.set(el.id, el));
        console.log('tile ok', id);
        ok = true;
        break;
      } catch (err) {
        console.log('tile failed', id, url, err.message);
      }
    }
    if (ok) {
      partial.done.push(id);
      partial.ways = [...ways.values()];
      writeFileSync(CACHE + '.partial', JSON.stringify(partial));
    } else if (depth < 3) queue.push(...split(t).map((x) => ({ t: x, depth: depth + 1 })));
    else throw new Error('Overpass unavailable — re-run later; finished tiles are cached');
  }
  const data = [...ways.values()];
  writeFileSync(CACHE, JSON.stringify(data));
  return data;
}

// ---------------------------------------------------------------- geometry
const inPoly = (lat, lng, poly) => {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const [yi, xi] = poly[i], [yj, xj] = poly[j];
    if (yi > lat !== yj > lat && lng < ((xj - xi) * (lat - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
};
const zoneOf = (lat, lng) => Object.keys(ZONES).find((z) => inPoly(lat, lng, ZONES[z])) || null;
function segDist(p, a, b) {
  const [px, py, ax, ay, bx, by] = [p[1], p[0], a[1], a[0], b[1], b[0]];
  const dx = bx - ax, dy = by - ay;
  const t = Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / (dx * dx + dy * dy || 1)));
  return Math.hypot(px - ax - t * dx, py - ay - t * dy);
}
// inside a zone, or within ~120 m of one (so roads hugging a boundary stay connected)
const nearService = (lat, lng) => zoneOf(lat, lng) || Object.values(ZONES).some((poly) => poly.some((a, i) => segDist([lat, lng], a, poly[(i + 1) % poly.length]) < 0.0011));
const meters = (a, b) => Math.hypot((a[0] - b[0]) * 111320, (a[1] - b[1]) * 111320 * Math.cos((a[0] * Math.PI) / 180));

// ---------------------------------------------------------------- graph
const ways = await fetchRoads();
const pos = new Map(); // nodeId -> [lat,lng]
const adj = new Map(); // nodeId -> [{to, edge}]
const edges = []; // {a, b, name, len, main:false}
for (const w of ways) {
  if (!w.nodes || !w.geometry) continue;
  w.nodes.forEach((id, i) => pos.set(id, [w.geometry[i].lat, w.geometry[i].lon]));
  for (let i = 0; i < w.nodes.length - 1; i++) {
    const a = w.nodes[i], b = w.nodes[i + 1];
    const pa = pos.get(a), pb = pos.get(b);
    if (!nearService(...pa) || !nearService(...pb)) continue;
    const e = { a, b, name: w.tags.name || '', len: meters(pa, pb), main: false };
    edges.push(e);
    (adj.get(a) || adj.set(a, []).get(a)).push({ to: b, e });
    (adj.get(b) || adj.set(b, []).get(b)).push({ to: a, e });
  }
}
const nearestNode = (p, pool = [...adj.keys()]) => pool.reduce((best, id) => (meters(p, pos.get(id)) < meters(p, pos.get(best)) ? id : best), pool[0]);

// Dijkstra from the reservoir (also yields the connected component)
const src = nearestNode(RESERVOIR);
const dist = new Map([[src, 0]]);
const prev = new Map();
const queue = new Set([src]);
while (queue.size) {
  let u = null;
  for (const q of queue) if (u === null || dist.get(q) < dist.get(u)) u = q;
  queue.delete(u);
  for (const { to, e } of adj.get(u) || []) {
    const d = dist.get(u) + e.len;
    if (d < (dist.get(to) ?? Infinity)) (dist.set(to, d), prev.set(to, { from: u, e }), queue.add(to));
  }
}
const reach = new Set(dist.keys());
const kept = edges.filter((e) => reach.has(e.a) && reach.has(e.b));
const reachIds = [...reach];

// Mains: shortest paths to every target and to each zone's furthest reachable area
const markPath = (node) => {
  let n = node;
  while (prev.has(n)) {
    prev.get(n).e.main = true;
    n = prev.get(n).from;
  }
};
TARGETS.forEach((t) => markPath(nearestNode(t, reachIds)));
for (const z of Object.keys(ZONES)) {
  const inZone = reachIds.filter((id) => zoneOf(...pos.get(id)) === z);
  if (!inZone.length) continue;
  const c = ZONES[z].reduce((s, p) => [s[0] + p[0] / ZONES[z].length, s[1] + p[1] / ZONES[z].length], [0, 0]);
  markPath(nearestNode(c, inZone));
}

// ---------------------------------------------------------------- merge edges into polylines
// Chain edges of the same class/zone/name through degree-2 nodes.
const key = (e) => `${e.main ? 'm' : 'd'}|${zoneOf(...mid(e)) || zoneOf(...pos.get(e.a)) || zoneOf(...pos.get(e.b)) || nearestZone(mid(e))}|${e.name}`;
function mid(e) {
  const a = pos.get(e.a), b = pos.get(e.b);
  return [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2];
}
function nearestZone(p) {
  return Object.keys(ZONES).reduce((best, z) => {
    const d = Math.min(...ZONES[z].map((a, i) => segDist(p, a, ZONES[z][(i + 1) % ZONES[z].length])));
    return d < best[1] ? [z, d] : best;
  }, ['A', Infinity])[0];
}
const used = new Set();
const byNode = new Map();
kept.forEach((e) => [e.a, e.b].forEach((n) => (byNode.get(n) || byNode.set(n, []).get(n)).push(e)));
const lines = [];
for (const e of kept) {
  if (used.has(e)) continue;
  used.add(e);
  const k = key(e);
  let chain = [e.a, e.b];
  const extend = (atEnd) => {
    for (;;) {
      const n = atEnd ? chain[chain.length - 1] : chain[0];
      const nxt = (byNode.get(n) || []).filter((x) => !used.has(x) && key(x) === k);
      if (nxt.length !== 1 || (byNode.get(n) || []).length > 2) return;
      const x = nxt[0];
      used.add(x);
      const other = x.a === n ? x.b : x.a;
      atEnd ? chain.push(other) : chain.unshift(other);
    }
  };
  extend(true);
  extend(false);
  const [kind, zone, name] = k.split('|');
  lines.push({ z: zone, k: kind, n: name, c: chain.map((id) => pos.get(id).map((v) => +v.toFixed(5))) });
}

const km = (kind) => (kept.filter((e) => (kind === 'm') === e.main).reduce((s, e) => s + e.len, 0) / 1000).toFixed(1);
mkdirSync(OUT.replace(/[\\/][^\\/]+$/, ''), { recursive: true });
writeFileSync(OUT, JSON.stringify({ source: 'Road geometry © OpenStreetMap contributors (ODbL). Pipe routing is illustrative.', generated: new Date().toISOString().slice(0, 10), lines }));
console.log(`edges kept ${kept.length}/${edges.length} · polylines ${lines.length} · mains ${km('m')} km · distribution ${km('d')} km`);
