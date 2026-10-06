// Reference data for SAMAR-AGOS — Catbalogan City, Samar.
//
// Sources (see README → Data sources):
//  • Catbalogan Water District (CWD) Water Safety Plan 2022 (Rev 3.0) and LWUA Monthly Data Sheets Jan–Dec 2022,
//    https://www.catbaloganwd.gov.ph
//  • PSA 2020 Census of Population (via PhilAtlas) — barangay populations
//  • OpenStreetMap contributors (ODbL) — barangay boundaries, facility locations
//
// Operational records (reports, incidents, work orders, advisories, notifications, water points, emergency storage)
// are NOT seeded: they are created in the app and stored in the database.
import { parsePoly, pointInPolygon, xy, llPoly, centroid } from './util.js';
import { SERVED_BARANGAYS } from './barangays.js';

export const UTILITY = {
  name: 'Catbalogan Water District',
  short: 'CWD',
  operator: 'Catbalogan Water District with Tubig Catbalogan Corp. (joint venture since Dec 2022)',
  municipality: 'Catbalogan City, Samar',
  address: 'Pier II, Allen Avenue Ext., Brgy. 4, Catbalogan City, Samar 6700',
  phone: '(055) 544-2576',
  website: 'https://www.catbaloganwd.gov.ph',
};

// Published operating figures (LWUA Monthly Data Sheet, December 2022 unless noted).
export const CWD_FACTS = {
  asOf: 'Dec 2022',
  source: 'LWUA Monthly Data Sheet (Catbalogan Water District), Dec 2022',
  activeConnections: 9681,
  totalConnections: 11524,
  byClass: { Residential: 8521, Government: 182, 'Commercial/Industrial': 924, Bulk: 54 },
  populationServed: 48405,
  barangaysServed: 26,
  barangaysTotal: 57,
  productionM3Month: 276041,
  productionM3Year2022: 3512557,
  billedM3Month: 187707,
  nrwPct: 32,
  nrwPctYear: 36,
  avgM3PerConnection: 19.3,
  lpcd: 107.7,
  networkKm: 45.632,
  reservoirM3: 440,
  cityPopulation2020: 106440,
  cityPopulation2024: 107896,
};

// Water rates effective 1 March 2018 (LWUA MDS 2022, p.2). Minimum charge covers the first 10 m³ (½" meter).
export const WATER_RATES = {
  effective: '1 March 2018',
  source: 'Catbalogan Water District rate schedule (LWUA Monthly Data Sheet 2022)',
  classes: {
    'Domestic / Government': { min: 200, tiers: [22.15, 24.3, 28.25, 32.45] },
    'Commercial / Industrial': { min: 400, tiers: [44.3, 48.6, 56.5, 64.9] },
    'Commercial A': { min: 350, tiers: [37.0, 42.5, 49.4, 56.75] },
    'Commercial B': { min: 300, tiers: [31.7, 36.45, 42.35, 48.65] },
    'Commercial C': { min: 250, tiers: [26.4, 30.35, 35.3, 40.55] },
    Bulk: { min: 600, tiers: [66.45, 72.9, 84.75, 97.35] },
  },
  tierLabels: ['11–20 m³', '21–30 m³', '31–40 m³', '41 m³ and above'],
};
export function waterBill(m3, cls = 'Domestic / Government') {
  const r = WATER_RATES.classes[cls];
  if (!r) return null;
  let bill = r.min;
  let left = Math.max(0, m3 - 10);
  r.tiers.forEach((rate, i) => {
    const band = i < 3 ? 10 : Infinity;
    const use = Math.min(left, band);
    bill += use * rate;
    left -= use;
  });
  return Math.round(bill * 100) / 100;
}

// ---------------------------------------------------------------- service areas = barangays served by CWD
const RESERVOIR_LL = [11.7783, 124.8868]; // Poblacion 13 ground reservoir (35 m elevation)
const km = ([a, b], [c, d]) => Math.hypot((a - c) * 111.32, (b - d) * 111.32 * Math.cos((a * Math.PI) / 180));
const servedPopIII = SERVED_BARANGAYS.filter((b) => b.level === 'III').reduce((n, b) => n + b.pop2020, 0);
const BASE_DEMAND_MLD = CWD_FACTS.productionM3Year2022 / 365 / 1000; // ≈ 9.6 ML/day incl. losses

// Service zones: the 26 served barangays grouped by area of the network. CWD has not published its
// distribution zones, so this grouping follows geography and the supply route from the reservoir.
export const SERVICE_ZONES = [
  { id: 'z1', name: 'Zone 1', area: 'Poblacion', desc: 'City centre around the Poblacion 13 reservoir', barangays: ['poblacion-1', 'poblacion-2', 'poblacion-3', 'poblacion-4', 'poblacion-5', 'poblacion-6', 'poblacion-7', 'poblacion-8', 'poblacion-9', 'poblacion-10', 'poblacion-11', 'poblacion-12', 'poblacion-13'] },
  { id: 'z2', name: 'Zone 2', area: 'North', desc: 'Mercedes to San Andres, Maulong and Payao', barangays: ['san-pablo', 'munoz', 'mercedes', 'canlapwas', 'san-andres', 'maulong', 'payao'] },
  { id: 'z3', name: 'Zone 3', area: 'South', desc: 'Guindaponan to Bunuanan and Lagundi', barangays: ['guindaponan', 'guinsorongan', 'bunuanan', 'lagundi'] },
  { id: 'z4', name: 'Zone 4', area: 'Darahuway islands', desc: 'Fed by the Cogao booster through the submarine line', barangays: ['darahuway-gote', 'darahuway-daco'] },
];
export const serviceZoneOf = (barangayId) => SERVICE_ZONES.find((g) => g.barangays.includes(barangayId)) || null;

export const ZONES = SERVED_BARANGAYS.map((b) => {
  const poly = llPoly(b.ring);
  const center = b.center || b.ring[0];
  const d = km(center, RESERVOIR_LL);
  // Estimated: connections split by population share (Level III only; Level I is communal supply).
  const connections = b.level === 'III' ? Math.round((CWD_FACTS.activeConnections * b.pop2020) / servedPopIII) : 0;
  // Simulated network pressure: gravity head from the 35 m reservoir minus distance losses (outer areas run low at peak, per CWD WSP).
  const basePressure = b.level === 'I' ? 30 : Math.round(Math.max(28, Math.min(46, 47 - 4.2 * d)));
  const share = b.level === 'III' ? b.pop2020 / servedPopIII : 0;
  const baseFlow = +(BASE_DEMAND_MLD * 11.574 * share * 0.97 + (b.level === 'I' ? 0.4 : 0)).toFixed(2); // L/s
  return {
    id: b.id,
    name: `Brgy. ${b.name}`,
    short: b.name,
    barangays: [b.name],
    level: b.level,
    pop2020: b.pop2020,
    approx: b.approx,
    center,
    connections,
    basePressure,
    baseFlow,
    poly,
    label: centroid(poly),
    group: serviceZoneOf(b.id)?.id || null,
  };
});
export const zoneById = (id) => ZONES.find((z) => z.id === id);
export const zoneOfBarangay = (b) => ZONES.find((z) => z.barangays.includes(b)) || null;
// Nearest service area to a point (lat/lng): containing polygon first, else closest centre.
export function zoneAtLL(lat, lng) {
  const [x, y] = xy(lat, lng);
  const inside = ZONES.find((z) => pointInPolygon([x, y], parsePoly(z.poly)));
  if (inside) return inside;
  return ZONES.reduce((best, z) => (km([lat, lng], z.center) < km([lat, lng], best.center) ? z : best), ZONES[0]);
}

// Barangay centre points — used to place a resident's service address.
export const BARANGAY_LL = Object.fromEntries(ZONES.map((z) => [z.short, z.center]));

// Raw-water links from the springs to Kulador are drawn as straight schematic lines (routes not published).
const line = (pts) => pts.map(([lat, lng]) => xy(lat, lng).join(',')).join(' ');
export const MAP = {
  river: '',
  sea: '',
  pipelines: [
    { id: 'PL-CAR', kind: 'raw', pts: line([[11.84167, 124.90306], [11.80056, 124.89828]]) },
    { id: 'PL-MAS', kind: 'raw', pts: line([[11.82139, 124.90056], [11.80056, 124.89828]]) },
  ],
};

const at = (lat, lng) => {
  const [x, y] = xy(lat, lng);
  return { x, y, lat, lng };
};

// Critical facilities (locations from OpenStreetMap).
export const CRITICAL_FACILITIES = [
  { id: 'CF-SPH', name: 'Samar Provincial Hospital', kind: 'Hospital', ...at(11.77386, 124.88603) },
  { id: 'CF-CDH', name: "Catbalogan Doctor's Hospital", kind: 'Hospital', ...at(11.77949, 124.88834) },
  { id: 'CF-SDH', name: 'Samar Doctors Hospital', kind: 'Hospital', ...at(11.78718, 124.86767) },
  { id: 'CF-CH', name: 'Catbalogan City Hall', kind: 'Government', ...at(11.77548, 124.88363) },
  { id: 'CF-SSU', name: 'Samar State University (Main Campus)', kind: 'School', ...at(11.77114, 124.88585) },
  { id: 'CF-SSUM', name: 'Samar State University (Mercedes Campus)', kind: 'School', ...at(11.78354, 124.87032) },
  { id: 'CF-JAIL', name: 'Catbalogan City Jail (BJMP)', kind: 'Detention facility', ...at(11.76262, 124.90967) },
].map((f) => ({ ...f, zone: zoneAtLL(f.lat, f.lng).id }));

// Crews are defined by the utility; work orders accept any team name.
export const TEAMS = [];

// Offline demo accounts only — with Firebase these come from the signed-in user's profile.
const DEMO_BRGY = zoneOfBarangay('Mercedes') || ZONES[0];
export const RESIDENT = {
  name: 'Demo Resident',
  initials: 'DR',
  account: '—',
  meter: '—',
  address: `Brgy. ${DEMO_BRGY.short}`,
  barangay: DEMO_BRGY.short,
  zone: DEMO_BRGY.id,
  ...at(DEMO_BRGY.center[0], DEMO_BRGY.center[1]),
  phone: '',
  verified: true, // offline demo resident can report; signed-in residents need a valid ID
};
export const PROVIDER_USER = { name: 'Demo Operator', role: 'Water utility staff', initials: 'DO' };
// Offline demo responder; signed-in responders replace these fields with their own account.
export const RESPONDER_USER = { id: 'R-DEMO', name: 'Ramon Dacut', initials: 'RD', loginEmail: 'r.dacut@responders.samar-agos.app', contactEmail: 'ramon.dacut@example.com', phone: '', credSent: false };

export const REPORT_TYPES = [
  { id: 'no_water', label: 'No Water', icon: 'droplet-off' },
  { id: 'low_pressure', label: 'Low Pressure', icon: 'gauge' },
  { id: 'leak', label: 'Pipe Leak', icon: 'droplets' },
  { id: 'color', label: 'Unusual Water Color', icon: 'flask' },
  { id: 'odor', label: 'Unusual Odor', icon: 'wind' },
  { id: 'meter', label: 'Meter Problem', icon: 'meter' },
  { id: 'other', label: 'Other', icon: 'more' },
];
export const reportTypeLabel = (id) => REPORT_TYPES.find((t) => t.id === id)?.label || id;

export const REPORT_STEPS = [
  { id: 'submitted', label: 'Report Submitted' },
  { id: 'acknowledged', label: 'Provider Acknowledged' },
  { id: 'investigating', label: 'Investigation Started' },
  { id: 'repair_assigned', label: 'Repair Assigned' },
  { id: 'repair_completed', label: 'Repair Completed' },
  { id: 'verified', label: 'Service Verified' },
];

export const WO_STEPS = ['New', 'Assigned', 'En Route', 'Inspecting', 'Repairing', 'Testing', 'Completed'];

// Demo-mode stress scenarios, modelled on documented Catbalogan events (CWD WSP 2022; July 2026 water crisis).
// The five demo features; each scenario lists the ones it shows (see the Demo scenarios panel).
export const DEMO_FEATURES = {
  consumption: 'Consumption trends',
  demand: 'Demand forecast',
  storage: 'Reservoir and remaining supply',
  warning: 'Shortage early warning',
  reports: 'Reports and incidents',
};
export const SCENARIO_SHOWS = {
  highDemand: ['consumption', 'demand', 'storage'],
  lowReservoir: ['storage', 'warning'],
  pumpFailure: ['storage', 'warning'],
  pipelineLeak: ['reports', 'consumption'],
  lowPressure: ['reports'],
  sourceDisruption: ['storage', 'warning'],
  emergencySupply: ['storage', 'demand'],
};
export const SCENARIOS = {
  normal: { label: 'Normal Operations', desc: 'All sources available. Demand follows the normal daily pattern.' },
  highDemand: { label: 'High Demand (dry season)', desc: 'Demand rises ~22% above normal, as in the April–June dry months.' },
  lowReservoir: { label: 'Low Reservoir', desc: 'Poblacion 13 reservoir drops near its 100 m³ firefighting reserve.' },
  pumpFailure: { label: 'Caramayon Power Outage', desc: 'Power loss stops the Caramayon pumping stations (as on 6 July 2026); ~91 L/s of supply is lost.' },
  pipelineLeak: { label: 'Main Break — Canlapwas', desc: 'A distribution main breaks in Canlapwas: flow rises, pressure drops, reports increase.' },
  lowPressure: { label: 'Low Pressure — Maulong', desc: 'Low pressure at the north end of the network during peak hours (documented in the CWD WSP).' },
  sourceDisruption: { label: 'Turbid Antiao River', desc: 'Heavy rain makes the Antiao River too turbid to treat; Kulador plant output stops and spring yield drops.' },
  emergencySupply: { label: 'Water Tankers Deployed', desc: 'Emergency tanker deliveries add temporary supply to the system.' },
};

// ---------------------------------------------------------------- asset registry (CWD Water Safety Plan 2022)
// Coordinates are from the WSP where published; otherwise the asset has no map position.
// Install years only where documented. Condition and maintenance dates are not published, so they start blank.
const site = (text, lat, lng) => (lat == null ? { site: text, x: null, y: null } : { site: text, ...at(lat, lng), zone: zoneAtLL(lat, lng).id });
const asset = (o) => ({ status: 'normal', condition: 'Not assessed', lastMaint: null, nextMaint: null, failures: [], issues: [], installed: null, zone: null, ...o });
const SRC = 'CWD Water Safety Plan 2022';
export const REAL_ASSETS = [
  asset({ id: 'SRC-CAR1', name: 'Caramayon I Spring', type: 'Water Source', ...site('Sitio Caramayon, Brgy. Lobo', 11.84167, 124.90306), spec: 'Spring yield 140 L/s, gravity main to Kulador (4.65 km)', source: SRC,
    failures: [{ at: Date.UTC(2026, 6, 6), text: 'Power outage stopped the Caramayon pumps during the July 2026 water crisis (Daily Tribune, 7 Jul 2026)' }], issues: ['High turbidity during heavy rain'] }),
  asset({ id: 'PS-CAR1', name: 'Caramayon I Pumping Station', type: 'Pump', ...site('Sitio Caramayon, Brgy. Lobo', 11.84145, 124.9034), installed: 2005, spec: '100 hp + 2 × 50 hp pumps, combined 91 L/s, ADB/LWUA STWSSP (₱32M), operating since Feb 2005', source: SRC,
    failures: [{ at: Date.UTC(2026, 6, 6), text: 'Pumps stopped by a power-line outage (July 2026 water crisis)' }] }),
  asset({ id: 'SRC-CAR2', name: 'Caramayon II Spring', type: 'Water Source', ...site('Brgy. Lobo, ~500 m from Caramayon I', 11.84431, 124.91039), spec: 'Spring source, capacity not published', source: SRC }),
  asset({ id: 'PS-CAR2', name: 'Caramayon II Pumping Station', type: 'Pump', ...site('Brgy. Lobo', 11.84405, 124.91), installed: 2019, spec: '125 hp pump with variable-frequency drive, operating since Dec 2019', source: SRC }),
  asset({ id: 'SRC-MAS', name: 'Masacpasac Spring', type: 'Water Source', ...site('Brgy. Cawayan', 11.82139, 124.90056), spec: 'Rated 55 L/s (20 L/s dry season – 40 L/s wet season), about 64% of total production', source: SRC }),
  asset({ id: 'WTP-KUL', name: 'Kulador Intake and Treatment Plant', type: 'Treatment Equipment', ...site('Antiao River, ~2.7 km from Brgy. San Andres', 11.80056, 124.89828), capacityL: 4000000,
    spec: 'Surface water from the Antiao River, clarifier with PAC and polymer, pre/post chlorination, bag filters, 4,000 m³/day design (current discharge ~20 L/s); upgrade to 6,000–7,000 m³/day planned', source: SRC,
    failures: [{ at: Date.UTC(2026, 6, 6), text: 'Antiao River too turbid to treat after heavy rain (July 2026 water crisis)' }], issues: ['High raw-water turbidity during heavy rain'] }),
  asset({ id: 'RES-P13', name: 'Poblacion 13 Ground Reservoir', type: 'Reservoir', ...site('Brgy. Poblacion 13, 35 m elevation', RESERVOIR_LL[0], RESERVOIR_LL[1]), installed: 1935, capacityL: 440000,
    spec: 'Concrete ground reservoir, 440 m³, 100 m³ held for firefighting, built 1935, recommissioned 2006', source: SRC }),
  asset({ id: 'WEL-TUM', name: 'Tumalistis Pumping Station', type: 'Well', ...site('Tumalistis (south side), location not published'), spec: 'Deep well, 4.5 L/s', source: SRC, issues: ['High iron content'] }),
  asset({ id: 'WEL-EXE', name: 'Executive Heights Pumping Station', type: 'Well', ...site('Executive Heights', 11.76483, 124.88839), spec: 'Deep well, 1.5 L/s, runs 3–4 hours a day', source: SRC }),
  asset({ id: 'WEL-LAG', name: 'Lagundi Pumping Station (Level I)', type: 'Well', ...site('Brgy. Lagundi', 11.76214, 124.91089), installed: 2018, spec: 'Level I deep well, serves the BJMP jail and 2 water ATMs, operating since Jan 2018', source: SRC }),
  asset({ id: 'WEL-PAY', name: 'Payao Pumping Station (Level I)', type: 'Well', ...site('Brgy. Payao', 11.80225, 124.86728), installed: 2020, spec: 'Level I deep well, 1.5 L/s, serves government facilities, operating since Jan 2020', source: SRC }),
  asset({ id: 'BP-CAN', name: 'Canlapwas Booster Pump', type: 'Pump', ...site('Brgy. Canlapwas, exact location not published'), spec: '25 hp booster', source: SRC }),
  asset({ id: 'BP-MAB', name: 'Mabini Booster Pump', type: 'Pump', ...site('Mabini, exact location not published'), spec: '40 hp booster', source: SRC }),
  asset({ id: 'BP-ANT', name: 'Antiao Booster Pump', type: 'Pump', ...site('Antiao, exact location not published'), installed: 2018, spec: '20 hp booster, installed 2018', source: SRC }),
  asset({ id: 'BP-VG', name: 'V&G Booster Pump', type: 'Pump', ...site('V&G Subdivision, exact location not published'), spec: '5 hp booster', source: SRC }),
  asset({ id: 'BP-COG', name: 'Cogao Booster Pump', type: 'Pump', ...site('Cogao, exact location not published'), spec: '5 hp, 5 L/s, feeds Darahuway Daco and Darahuway Gote through the submarine line', source: SRC }),
  asset({ id: 'PL-CAR', name: 'Caramayon–Kulador Gravity Main', type: 'Pipeline', ...site('Brgy. Lobo to Kulador'), spec: 'Gravity transmission main, 4.65 km', source: SRC }),
  asset({ id: 'PL-SUB', name: 'Darahuway Submarine Line', type: 'Pipeline', ...site('Cogao to Darahuway Daco / Gote'), spec: '2-inch line, 1.7 km underwater', source: SRC }),
  asset({ id: 'PL-NET', name: 'Transmission and Distribution Network', type: 'Pipeline', ...site('Service area (26 barangays)'), spec: '45.632 km of transmission and distribution lines, transmission capacity 90–120 L/s', source: SRC,
    issues: ['Low to zero pressure at the north end (Maulong) and south end (Bunuanan) during peak hours'] }),
];

// Supply capacities (ML/day) used by the simulation, from the figures above.
export const SUPPLY = {
  caramayon: (91 * 86400) / 1e6, // pumped, 91 L/s
  masacpasac: (40 * 86400) / 1e6, // wet-season yield 40 L/s (rated 55)
  kulador: (20 * 86400) / 1e6, // current discharge ~20 L/s
  wells: ((4.5 + 1.5 * (3.5 / 24) + 1.5) * 86400) / 1e6, // Tumalistis + Executive (3–4 h/day) + Payao
};
export const BASE_DEMAND = +BASE_DEMAND_MLD.toFixed(2); // average daily production 2022, incl. ~36% non-revenue water

// ---------------------------------------------------------------- report factory (used for resident submissions)
export function makeReport(r, { id, zone, type, x, y, at: when, mine = false, desc, barangay, location }) {
  const z = zoneById(zone);
  const brgy = barangay || z?.short || '';
  return {
    id,
    type,
    zone,
    barangay: brgy,
    location: location || `Brgy. ${brgy}`,
    x,
    y,
    description: desc || '',
    observedAt: when,
    submittedAt: when,
    status: 'submitted',
    incidentId: null,
    mine,
    photo: null,
    updates: [],
    residentResponse: null,
  };
}

// Random point inside a service area (used by demo scenarios only).
export function pointInZone(r, zoneId) {
  const p = parsePoly(zoneById(zoneId).poly);
  const xs = p.map((q) => q[0]);
  const ys = p.map((q) => q[1]);
  for (let i = 0; i < 300; i++) {
    const pt = [Math.round(Math.min(...xs) + r() * (Math.max(...xs) - Math.min(...xs))), Math.round(Math.min(...ys) + r() * (Math.max(...ys) - Math.min(...ys)))];
    if (pointInPolygon(pt, p)) return pt;
  }
  return zoneById(zoneId).label;
}

// Starting state: real asset registry, everything else empty until created in the app.
export function makeSeed(now = Date.now()) {
  return {
    version: 6,
    seededAt: now,
    scenario: 'normal',
    reportSeq: 1,
    incidentSeq: 1,
    woSeq: 1,
    advSeq: 1,
    zoneIssues: {},
    pumpsOffline: [],
    reports: [],
    incidents: [],
    workOrders: [],
    advisories: [],
    assets: REAL_ASSETS.map((a) => ({ ...a })),
    emergencyTanks: [],
    altWater: [],
    consumption: null,
    notifications: [],
    seenAlerts: {},
    tele: null, // filled by the simulation engine
    history: null,
    scenarioLog: [],
  };
}
