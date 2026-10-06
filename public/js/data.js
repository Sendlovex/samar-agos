// Fictional demo data for SAMAR-AGOS. Not real government or utility data.
import { rng, parsePoly, pointInPolygon, xy, llPoly, centroid } from './util.js';

export const UTILITY = {
  name: 'Maqueda Bay Water Service',
  note: 'Fictional water service provider — demo data only',
  municipality: 'Catbalogan City, Samar (fictionalized data)',
};

// Service zones follow the real barangay locations and coastline of Catbalogan City
// (positions from OpenStreetMap). Boundaries are approximate, not official.
const ZONE_LL = {
  A: [[11.7835, 124.8815], [11.7825, 124.8875], [11.776, 124.889], [11.7735, 124.885], [11.776, 124.881], [11.7795, 124.879], [11.7815, 124.879]],
  B: [[11.812, 124.858], [11.81, 124.866], [11.798, 124.874], [11.789, 124.881], [11.7835, 124.8815], [11.7815, 124.879], [11.7845, 124.8725], [11.7925, 124.8635], [11.804, 124.8575]],
  C: [[11.789, 124.881], [11.798, 124.874], [11.8, 124.89], [11.797, 124.906], [11.786, 124.908], [11.779, 124.899], [11.776, 124.889], [11.7825, 124.8875], [11.7835, 124.8815]],
  D: [[11.779, 124.899], [11.786, 124.908], [11.777, 124.916], [11.762, 124.914], [11.755, 124.906], [11.7615, 124.8915], [11.769, 124.8895], [11.776, 124.889]],
  E: [[11.776, 124.881], [11.7735, 124.885], [11.776, 124.889], [11.769, 124.8895], [11.7615, 124.8915], [11.75, 124.896], [11.7495, 124.8855], [11.758, 124.882], [11.77, 124.8835]],
};
const zone = (id, name, barangays, connections, basePressure, baseFlow) => {
  const poly = llPoly(ZONE_LL[id]);
  return { id, name: `Zone ${id} — ${name}`, short: `Zone ${id}`, barangays, connections, basePressure, baseFlow, poly, label: centroid(poly) };
};
export const ZONES = [
  zone('A', 'Poblacion', ['Barangay 1', 'Barangay 13', 'San Pablo', 'Muñoz'], 2140, 42, 9.4),
  zone('B', 'Mercedes', ['Mercedes', 'Maulong', 'Payao'], 1860, 38, 8.1),
  zone('C', 'Canlapwas', ['Canlapwas', 'San Andres'], 1320, 40, 6.2),
  zone('D', 'Uplands', ['Lagundi', 'Socorro'], 980, 33, 4.3),
  zone('E', 'South Coastal', ['Guindapunan', 'Guinsorongan', 'Bunuanan'], 1540, 44, 7.0),
];
export const zoneById = (id) => ZONES.find((z) => z.id === id);

const COAST = [[11.816, 124.856], [11.805, 124.8575], [11.793, 124.862], [11.784, 124.872], [11.779, 124.8785], [11.773, 124.8805], [11.765, 124.8825], [11.758, 124.881], [11.7497, 124.884]];
const line = (pts) => pts.map(([lat, lng]) => xy(lat, lng).join(',')).join(' ');
export const MAP = {
  river: '',
  sea: `M0,0 L${COAST.map(([lat, lng]) => xy(lat, lng).join(',')).join(' L')} L0,620 Z`,
  pipelines: [
    { id: 'PL-R1', kind: 'raw', pts: line([[11.796, 124.899], [11.7935, 124.896], [11.7905, 124.8935]]) },
    { id: 'PL-M1', kind: 'main', pts: line([[11.7905, 124.8935], [11.788, 124.8915], [11.785, 124.8935]]) },
    { id: 'PL-D1', kind: 'main', pts: line([[11.785, 124.8935], [11.778, 124.899], [11.77, 124.905], [11.764, 124.9075]]) },
    { id: 'PL-E1', kind: 'main', pts: line([[11.785, 124.8935], [11.776, 124.89], [11.769, 124.8885], [11.765, 124.887]]) },
    { id: 'PL-C2', kind: 'dist', pts: line([[11.795, 124.887], [11.788, 124.8915]]) },
    { id: 'PL-A1', kind: 'main', pts: line([[11.785, 124.8935], [11.782, 124.888], [11.7775, 124.8845], [11.779, 124.8815]]) },
    { id: 'PL-B2', kind: 'main', pts: line([[11.785, 124.8935], [11.786, 124.886], [11.786, 124.879], [11.788, 124.8735], [11.7905, 124.87], [11.799, 124.864]]) },
    { id: 'PL-B3', kind: 'dist', pts: line([[11.788, 124.8735], [11.7845, 124.8765], [11.7835, 124.879]]) },
  ],
};

const at = (lat, lng) => {
  const [x, y] = xy(lat, lng);
  return { x, y };
};
export const CRITICAL_FACILITIES = [
  { id: 'CF-1', name: 'Mercedes District Hospital', kind: 'Hospital', zone: 'B', ...at(11.7838, 124.877) },
  { id: 'CF-2', name: 'Maulong Evacuation Center', kind: 'Evacuation Center', zone: 'B', ...at(11.793, 124.867) },
  { id: 'CF-3', name: 'Poblacion Central School', kind: 'School / Evacuation Site', zone: 'A', ...at(11.779, 124.885) },
  { id: 'CF-4', name: 'South Coastal Rural Health Unit', kind: 'Health Station', zone: 'E', ...at(11.76, 124.886) },
];

export const TEAMS = ['Field Team Alpha', 'Field Team Bravo', 'Distribution Crew 2', 'Pump Maintenance Unit', 'Water Quality Unit'];

export const RESIDENT = {
  name: 'Ana Ramos',
  initials: 'AR',
  account: '0412-118-2207',
  meter: 'MTR-B-04471',
  address: 'Purok 3, Brgy. Mercedes',
  barangay: 'Mercedes',
  zone: 'B',
  ...at(11.783, 124.876),
  phone: '+63 9•• ••• 4471',
};

export const PROVIDER_USER = { name: 'Engr. R. Dacanay', role: 'Duty Operations Engineer', initials: 'RD' };

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

// Stress scenarios for the provider demo control
export const SCENARIOS = {
  normal: { label: 'Normal Operations', desc: 'All sources available. Demand follows the normal daily pattern.' },
  highDemand: { label: 'High Demand', desc: 'Demand rises ~22% above normal; storage draws down faster.' },
  lowReservoir: { label: 'Low Reservoir', desc: 'Central Reservoir drops near the 30% minimum reserve.' },
  pumpFailure: { label: 'Pump Failure', desc: 'Raw Water Pump Station PS-01 trips offline; production falls.' },
  pipelineLeak: { label: 'Pipeline Leak', desc: 'Main break in Zone C: flow rises, pressure drops, reports increase.' },
  lowPressure: { label: 'Low Pressure', desc: 'Distribution-line problem reduces pressure in Zone B.' },
  sourceDisruption: { label: 'Source Disruption', desc: 'Raw-water inflow from Antiao River intake falls ~38%.' },
  emergencySupply: { label: 'Emergency Supply Activated', desc: '400,000 L backup storage becomes available to the system.' },
};

function poly(z) {
  return parsePoly(zoneById(z).poly);
}

function scatter(r, zone, n) {
  const out = [];
  const p = poly(zone);
  const box = [Math.min(...p.map((q) => q[0])), Math.min(...p.map((q) => q[1])), Math.max(...p.map((q) => q[0])), Math.max(...p.map((q) => q[1]))];
  let guard = 0;
  while (out.length < n && guard++ < 2000) {
    const x = box[0] + r() * (box[2] - box[0]);
    const y = box[1] + r() * (box[3] - box[1]);
    if (pointInPolygon([x, y], p)) out.push([Math.round(x), Math.round(y)]);
  }
  return out;
}

const PUROKS = ['Purok 1', 'Purok 2', 'Purok 3', 'Purok 4', 'Purok 5', 'Sitio Ilaya', 'Sitio Baybayon'];

export function makeReport(r, { id, zone, type, x, y, at, mine = false, desc, barangay }) {
  const z = zoneById(zone);
  const brgy = barangay || z.barangays[Math.floor(r() * z.barangays.length)];
  return {
    id,
    type,
    zone,
    barangay: brgy,
    location: `${PUROKS[Math.floor(r() * PUROKS.length)]}, Brgy. ${brgy}`,
    x,
    y,
    description: desc || defaultDesc(type),
    observedAt: at - Math.round(r() * 20) * 60000,
    submittedAt: at,
    status: 'submitted',
    incidentId: null,
    mine,
    photo: null,
    updates: [],
    residentResponse: null,
  };
}

function defaultDesc(type) {
  return {
    low_pressure: 'Water flow from the faucet is weak, especially upstairs.',
    no_water: 'No water coming out of the tap since this morning.',
    leak: 'Water leaking from the pipe near the road side.',
    color: 'Water looks brownish when first opened.',
    odor: 'Water has an unusual smell.',
    meter: 'Meter dial appears stuck.',
    other: 'Issue observed with water service.',
  }[type];
}

// Build the initial demo state. Times are relative to "now".
export function makeSeed(now = Date.now()) {
  const r = rng(20261006);
  const min = (n) => now - n * 60000;
  const day = (n) => now + n * 86400000;

  // --- Resident reports: a Zone B low-pressure cluster (not yet reviewed) ---
  const reports = [];
  let seq = 1021;
  const bPts = scatter(r, 'B', 16);
  const bTypes = ['low_pressure', 'low_pressure', 'no_water', 'low_pressure', 'low_pressure', 'leak', 'low_pressure', 'no_water', 'low_pressure', 'low_pressure', 'no_water', 'low_pressure', 'low_pressure', 'low_pressure', 'no_water', 'low_pressure'];
  bPts.forEach(([x, y], i) => {
    reports.push(makeReport(r, { id: `WR-2026-${seq++}`, zone: 'B', type: bTypes[i], x, y, at: min(98 - i * 5.5) }));
  });
  // Resident's own report — part of the cluster
  reports.push(
    makeReport(r, {
      id: 'WR-2026-1038',
      zone: 'B',
      type: 'low_pressure',
      x: RESIDENT.x,
      y: RESIDENT.y,
      at: min(34),
      mine: true,
      barangay: 'Mercedes',
      desc: 'Very weak water flow since around 8 AM. Cannot fill the overhead tank.',
    })
  );
  reports[reports.length - 1].location = 'Purok 3, Brgy. Mercedes';
  reports[reports.length - 1].updates = [{ at: min(34), status: 'submitted', text: 'Report received. Awaiting provider review.' }];
  // A few scattered reports elsewhere (already linked or older)
  const misc = [
    { zone: 'D', type: 'leak', ...at(11.7705, 124.9045), at: min(60 * 26), status: 'repair_assigned', incidentId: 'INC-2026-040' },
    { zone: 'D', type: 'low_pressure', ...at(11.768, 124.907), at: min(60 * 25), status: 'repair_assigned', incidentId: 'INC-2026-040' },
    { zone: 'E', type: 'color', ...at(11.76, 124.888), at: min(60 * 30), status: 'investigating', incidentId: 'INC-2026-039' },
    { zone: 'E', type: 'color', ...at(11.756, 124.889), at: min(60 * 29), status: 'investigating', incidentId: 'INC-2026-039' },
    { zone: 'A', type: 'meter', ...at(11.78, 124.885), at: min(60 * 5), status: 'acknowledged', incidentId: null },
  ];
  misc.forEach((m, i) => {
    const rep = makeReport(r, { id: `WR-2026-${1010 + i}`, ...m });
    rep.status = m.status;
    rep.incidentId = m.incidentId;
    reports.push(rep);
  });

  const incidents = [
    {
      id: 'INC-2026-039',
      title: 'Elevated Turbidity — Zone E',
      type: 'Water Quality',
      zone: 'E',
      zones: ['E'],
      status: 'Monitoring',
      severity: 'Medium',
      detectedAt: min(60 * 31),
      connections: 1540,
      facilities: ['CF-4'],
      condition: 'Turbidity at Coastal Tank sampling point 4.6 NTU (guideline 5 NTU). Flushing in progress.',
      reportIds: ['WR-2026-1012', 'WR-2026-1013'],
      workOrderIds: ['WO-2026-0186'],
      advisoryIds: ['ADV-2026-031'],
      notes: [{ at: min(60 * 28), by: 'Water Quality Unit', text: 'Flushed hydrants HY-E3 and HY-E5. Sample results improving.' }],
      timeline: [
        { at: min(60 * 31), text: 'Turbidity sensor TS-E1 exceeded 5 NTU' },
        { at: min(60 * 30), text: 'First resident report (unusual water color)' },
        { at: min(60 * 30 - 20), text: 'Incident created' },
        { at: min(60 * 29), text: 'Advisory published to Zone E' },
        { at: min(60 * 28), text: 'Hydrant flushing completed' },
      ],
      resolvedAt: null,
    },
    {
      id: 'INC-2026-040',
      title: 'Pipe Leak — Lagundi Main',
      type: 'Leak',
      zone: 'D',
      zones: ['D'],
      status: 'Response in Progress',
      severity: 'Medium',
      detectedAt: min(60 * 26),
      connections: 410,
      facilities: [],
      condition: 'Visible leak on 100mm line along Lagundi road. Section valve partly closed.',
      reportIds: ['WR-2026-1010', 'WR-2026-1011'],
      workOrderIds: ['WO-2026-0187'],
      advisoryIds: ['ADV-2026-030'],
      notes: [],
      timeline: [
        { at: min(60 * 26), text: 'First resident report (pipe leak)' },
        { at: min(60 * 25), text: 'Incident created after field confirmation' },
        { at: min(60 * 24), text: 'Work order WO-2026-0187 assigned to Field Team Bravo' },
      ],
      resolvedAt: null,
    },
    {
      id: 'INC-2026-041',
      title: 'High Vibration — PS-01 Unit 2',
      type: 'Equipment',
      zone: 'D',
      zones: ['D'],
      status: 'Investigating',
      severity: 'Low',
      detectedAt: min(60 * 7),
      connections: 0,
      facilities: [],
      condition: 'Vibration 7.1 mm/s on Unit 2 (alarm 7.0). Unit remains in service.',
      reportIds: [],
      workOrderIds: ['WO-2026-0188'],
      advisoryIds: [],
      notes: [],
      timeline: [
        { at: min(60 * 7), text: 'Equipment alert: vibration above threshold' },
        { at: min(60 * 6), text: 'Incident created' },
      ],
      resolvedAt: null,
    },
    {
      id: 'INC-2026-038',
      title: 'No Water — San Andres',
      type: 'Supply Interruption',
      zone: 'C',
      zones: ['C'],
      status: 'Resolved',
      severity: 'High',
      detectedAt: day(-6),
      connections: 640,
      facilities: [],
      condition: 'Air lock after valve replacement. Restored.',
      reportIds: [],
      workOrderIds: ['WO-2026-0181'],
      advisoryIds: [],
      notes: [],
      timeline: [{ at: day(-6), text: 'Incident created' }, { at: day(-5.8), text: 'Resolved — service verified by 9 residents' }],
      resolvedAt: day(-5.8),
    },
  ];

  const wo = (o) => ({
    photos: { before: null, after: null },
    notes: [],
    completion: null,
    history: [{ status: 'New', at: o.createdAt }],
    ...o,
  });
  const workOrders = [
    wo({ id: 'WO-2026-0186', incidentId: 'INC-2026-039', assetId: 'TNK-03', location: 'South Coastal Elevated Tank, Brgy. Guindapunan', priority: 'Medium', team: 'Water Quality Unit', description: 'Flush distribution lines and collect turbidity samples at 3 points.', createdAt: min(60 * 29), target: now + 3600000 * 5, status: 'Testing' }),
    wo({ id: 'WO-2026-0187', incidentId: 'INC-2026-040', assetId: 'PL-D1', location: 'Lagundi Road, Km 2', priority: 'High', team: 'Field Team Bravo', description: 'Excavate and repair 100mm PVC line leak. Restore section valve after testing.', createdAt: min(60 * 24), target: now + 3600000 * 2, status: 'Repairing' }),
    wo({ id: 'WO-2026-0188', incidentId: 'INC-2026-041', assetId: 'PS-01', location: 'Raw Water Pump Station', priority: 'Medium', team: 'Pump Maintenance Unit', description: 'Inspect Unit 2 bearings and alignment; record vibration readings.', createdAt: min(60 * 6), target: now + 3600000 * 20, status: 'Inspecting' }),
    wo({ id: 'WO-2026-0189', incidentId: null, assetId: 'TNK-02', location: 'Uplands Ground Tank', priority: 'Low', team: 'Distribution Crew 2', description: 'Quarterly tank cleaning and hatch inspection.', createdAt: day(-2), target: day(3), status: 'Assigned' }),
    wo({ id: 'WO-2026-0190', incidentId: null, assetId: 'PT-D2', location: 'Socorro, Zone D', priority: 'Medium', team: 'Field Team Alpha', description: 'Pressure sensor PT-D2 not reporting. Check battery and modem.', createdAt: min(60 * 9), target: day(1), status: 'New' }),
    wo({ id: 'WO-2026-0183', incidentId: null, assetId: 'VLV-07', location: 'Zone B Isolation Valve 07', priority: 'Medium', team: 'Distribution Crew 2', description: 'Exercise valve and replace gland packing.', createdAt: day(-5), target: day(-1), status: 'Assigned' }),
    wo({ id: 'WO-2026-0184', incidentId: null, assetId: 'WEL-01', location: 'Deep Well No. 1', priority: 'Low', team: 'Pump Maintenance Unit', description: 'Measure static and pumping water levels.', createdAt: day(-3), target: day(2), status: 'En Route' }),
    wo({ id: 'WO-2026-0181', incidentId: 'INC-2026-038', assetId: 'PL-C2', location: 'San Andres', priority: 'High', team: 'Field Team Alpha', description: 'Release air lock and verify supply.', createdAt: day(-6), target: day(-5.8), status: 'Completed', completion: { at: day(-5.85), notes: 'Air released at 3 points. Supply restored.', reading: '38 PSI at San Andres chapel tap' } }),
  ];

  const advisories = [
    {
      id: 'ADV-2026-031',
      incidentId: 'INC-2026-039',
      title: 'Water Quality Advisory — Zone E',
      kind: 'Water Quality',
      areas: ['E'],
      barangays: ['Guindapunan', 'Canlapwas'],
      message: 'Some households in Guindapunan and Canlapwas may notice slightly cloudy water while crews flush the lines. Results are improving.',
      instructions: 'Let the tap run for 1–2 minutes before use. Boil water for drinking until further notice.',
      startAt: min(60 * 29),
      updatedAt: min(60 * 3),
      etr: null,
      nextUpdate: now + 3600000 * 3,
      status: 'Active',
      serviceStatus: 'QUALITY ADVISORY',
    },
    {
      id: 'ADV-2026-030',
      incidentId: 'INC-2026-040',
      title: 'Reduced Pressure — Lagundi',
      kind: 'Repair',
      areas: ['D'],
      barangays: ['Lagundi'],
      message: 'Residents near Lagundi road may experience low pressure while a leaking line is repaired.',
      instructions: 'Store enough water for cooking and drinking. Report any new leaks.',
      startAt: min(60 * 24),
      updatedAt: min(60 * 2),
      etr: now + 3600000 * 3,
      nextUpdate: now + 3600000 * 2,
      status: 'Active',
      serviceStatus: 'REDUCED PRESSURE',
    },
    {
      id: 'ADV-2026-029',
      incidentId: null,
      title: 'Scheduled Valve Maintenance — Zone B',
      kind: 'Maintenance',
      areas: ['B'],
      barangays: ['Mercedes', 'Maulong'],
      message: 'Planned valve maintenance completed. Service returned to normal.',
      instructions: '',
      startAt: day(-9),
      updatedAt: day(-8.8),
      etr: null,
      nextUpdate: null,
      status: 'Resolved',
      serviceStatus: 'NORMAL',
    },
  ];

  const asset = (o) => ({ failures: [], status: 'normal', condition: 'Good', ...o });
  const assets = [
    asset({ id: 'SRC-01', name: 'Antiao River Intake', type: 'Water Source', zone: 'C', ...at(11.796, 124.899), lastMaint: day(-40), nextMaint: day(50), spec: 'Design yield 2.2 ML/day', failures: [{ at: day(-210), text: 'Intake screen clogged after heavy rain' }] }),
    asset({ id: 'PS-01', name: 'Raw Water Pump Station', type: 'Pump', zone: 'C', ...at(11.7935, 124.896), condition: 'Fair', lastMaint: day(-75), nextMaint: day(-2), spec: '2 × 30 kW centrifugal pumps', failures: [{ at: day(-120), text: 'Unit 1 motor overheating' }, { at: day(-14), text: 'Unit 2 vibration alarm' }] }),
    asset({ id: 'WTP-01', name: 'Antiao Treatment Plant', type: 'Treatment Equipment', zone: 'C', ...at(11.7905, 124.8935), lastMaint: day(-20), nextMaint: day(40), spec: 'Rapid sand filtration, chlorination' }),
    asset({ id: 'PS-02', name: 'High-Lift Pump Station', type: 'Pump', zone: 'C', ...at(11.788, 124.8915), lastMaint: day(-30), nextMaint: day(60), spec: '2 × 45 kW (1 duty, 1 standby)' }),
    asset({ id: 'RES-01', name: 'Central Reservoir', type: 'Reservoir', zone: 'C', ...at(11.785, 124.8935), capacityL: 2000000, lastMaint: day(-160), nextMaint: day(20), spec: 'Concrete ground reservoir, 2,000,000 L' }),
    asset({ id: 'PS-03', name: 'Mercedes Booster Pump', type: 'Pump', zone: 'B', ...at(11.788, 124.8735), lastMaint: day(-55), nextMaint: day(35), spec: '1 × 15 kW booster' }),
    asset({ id: 'TNK-01', name: 'Mercedes Elevated Tank', type: 'Tank', zone: 'B', ...at(11.7905, 124.87), capacityL: 250000, lastMaint: day(-90), nextMaint: day(90) }),
    asset({ id: 'TNK-02', name: 'Uplands Ground Tank', type: 'Tank', zone: 'D', ...at(11.764, 124.9075), capacityL: 180000, lastMaint: day(-95), nextMaint: day(3) }),
    asset({ id: 'TNK-03', name: 'South Coastal Elevated Tank', type: 'Tank', zone: 'E', ...at(11.765, 124.887), capacityL: 300000, lastMaint: day(-60), nextMaint: day(120) }),
    asset({ id: 'WEL-01', name: 'Deep Well No. 1', type: 'Well', zone: 'A', ...at(11.7775, 124.8845), lastMaint: day(-35), nextMaint: day(2), spec: 'Submersible pump, 0.5 ML/day' }),
    asset({ id: 'WEL-02', name: 'Deep Well No. 2', type: 'Well', zone: 'C', ...at(11.795, 124.887), lastMaint: day(-12), nextMaint: day(80), spec: 'Submersible pump, 0.4 ML/day' }),
    asset({ id: 'VLV-07', name: 'Zone B Isolation Valve 07', type: 'Valve', zone: 'B', ...at(11.786, 124.879), condition: 'Fair', lastMaint: day(-400), nextMaint: day(-1), spec: '200mm gate valve' }),
    asset({ id: 'PL-M1', name: 'Transmission Main M1 (300mm)', type: 'Pipeline', zone: 'C', ...at(11.7893, 124.8925), lastMaint: day(-300), nextMaint: day(65) }),
    asset({ id: 'PL-B2', name: 'Mercedes Distribution Line B2 (150mm)', type: 'Pipeline', zone: 'B', ...at(11.7865, 124.8775), condition: 'Fair', lastMaint: day(-500), nextMaint: day(30), failures: [{ at: day(-75), text: 'Joint leak near Maulong crossing' }] }),
    asset({ id: 'PL-D1', name: 'Lagundi Line D1 (100mm)', type: 'Pipeline', zone: 'D', ...at(11.771, 124.904), condition: 'Poor', status: 'warning', lastMaint: day(-700), nextMaint: day(10), failures: [{ at: day(-1), text: 'Leak — under repair' }] }),
    asset({ id: 'PL-C2', name: 'San Andres Line C2 (100mm)', type: 'Pipeline', zone: 'C', ...at(11.7915, 124.889), lastMaint: day(-6), nextMaint: day(180) }),
    asset({ id: 'PT-B1', name: 'Pressure Sensor PT-B1', type: 'Sensor', zone: 'B', ...at(11.789, 124.8715), lastMaint: day(-50), nextMaint: day(130) }),
    asset({ id: 'PT-D2', name: 'Pressure Sensor PT-D2', type: 'Sensor', zone: 'D', ...at(11.77, 124.91), status: 'offline', condition: 'Unknown', lastMaint: day(-200), nextMaint: day(-20) }),
    asset({ id: 'TS-E1', name: 'Turbidity Sensor TS-E1', type: 'Sensor', zone: 'E', ...at(11.7625, 124.8875), status: 'warning', lastMaint: day(-30), nextMaint: day(60) }),
  ];

  const emergencyTanks = [
    { id: 'ET-01', name: 'Mercedes Barangay Hall Bladder Tank', mode: 'MANUAL', zone: 'B', capacityL: 20000, volumeL: 15500, lastRefill: min(60 * 20), lastInspection: day(-3), team: 'Distribution Crew 2', notes: 'Visual level check by barangay staff. Chlorine residual 0.6 mg/L.', updatedAt: min(60 * 2) },
    { id: 'ET-02', name: 'Maulong Smart Emergency Tank', mode: 'SIMULATED', zone: 'B', capacityL: 10000, volumeL: 8200, sensor: 'online', lastRefill: min(60 * 30), team: 'Field Team Alpha', notes: 'Ultrasonic level sensor (simulated IoT for demo).', updatedAt: now },
    { id: 'ET-03', name: 'Mobile Tanker MT-2', mode: 'MANUAL', zone: 'B', capacityL: 10000, volumeL: 8500, lastRefill: min(60 * 3), lastInspection: day(-1), team: 'Field Team Bravo', notes: 'Stationed at depot. Can deploy within 45 minutes.', updatedAt: min(60 * 2) },
  ];

  const altWater = [
    { id: 'AW-1', name: 'Mercedes Barangay Hall Water Distribution', address: 'Brgy. Hall, Purok 2, Mercedes', zone: 'B', ...at(11.7826, 124.8778), hours: '8:00 AM – 5:00 PM', status: 'AVAILABLE', confirmedAt: min(38), instructions: 'Bring clean, covered containers. Limit 40 L per household per visit.', active: true },
    { id: 'AW-2', name: 'Maulong Covered Court Tank', address: 'Covered Court, Maulong', zone: 'B', ...at(11.7925, 124.867), hours: '6:00 AM – 8:00 PM', status: 'LIMITED', confirmedAt: min(55), instructions: 'Priority for seniors, PWDs, and households with infants.', active: true },
    { id: 'AW-3', name: 'Payao Mobile Tanker Stop', address: 'Payao Chapel grounds', zone: 'B', ...at(11.803, 124.8635), hours: '1:00 PM – 4:00 PM', status: 'SCHEDULED', confirmedAt: min(70), instructions: 'Tanker MT-2 scheduled to arrive at 1:00 PM.', active: true },
    { id: 'AW-4', name: 'Lagundi Public Faucet', address: 'Elementary School gate, Lagundi', zone: 'D', ...at(11.76, 124.9045), hours: '24 hours', status: 'AVAILABLE', confirmedAt: min(60 * 3), instructions: 'Gravity-fed from Uplands Ground Tank.', active: true },
  ];

  // Resident consumption — 12 billing periods (m³)
  const periods = [];
  const vals = [14.2, 13.8, 15.1, 11.8, 17.2, 16.8, 15.9, 14.7, 13.9, 14.4, 13.6];
  const d = new Date(now);
  let start = new Date(d.getFullYear(), d.getMonth() - (d.getDate() >= 16 ? 0 : 1), 16);
  for (let i = vals.length; i >= 1; i--) {
    const ps = new Date(start.getFullYear(), start.getMonth() - i, 16);
    const pe = new Date(start.getFullYear(), start.getMonth() - i + 1, 15);
    periods.push({ start: ps.getTime(), end: pe.getTime(), m3: vals[vals.length - i], source: vals.length - i === 3 ? 'ESTIMATED' : 'MEASURED', note: vals.length - i === 3 ? 'Meter inaccessible (locked gate). Estimated from 3-period average.' : '' });
  }
  const daysIn = Math.max(1, Math.round((now - start.getTime()) / 86400000));
  const daily = [];
  for (let i = 0; i < daysIn; i++) daily.push(+(0.38 + r() * 0.16 - (i > daysIn - 3 ? 0.08 : 0)).toFixed(3));
  const toDate = +daily.reduce((a, b) => a + b, 0).toFixed(1);
  const consumption = {
    periods,
    current: { start: start.getTime(), end: new Date(start.getFullYear(), start.getMonth() + 1, 15).getTime(), toDate, lastReading: min(60 * 18), daily, source: 'MEASURED' },
  };

  const notifications = [
    { id: 'n1', audience: 'resident', kind: 'report', title: 'Report received', body: 'Your report WR-2026-1038 (Low Pressure) was received and is awaiting provider review.', at: min(34), state: 'unread', link: '#/r/reports/WR-2026-1038' },
    { id: 'n2', audience: 'resident', kind: 'reading', title: 'Meter reading posted', body: 'Previous period consumption: 13.6 m³ (measured reading).', at: day(-20), state: 'read', link: '#/r/consumption' },
    { id: 'n3', audience: 'resident', kind: 'restored', title: 'Maintenance completed — Zone B', body: 'Scheduled valve maintenance in Mercedes and Maulong is complete. Service is normal.', at: day(-8.8), state: 'read', link: '#/r/advisories' },
    { id: 'n4', audience: 'provider', kind: 'overdue', title: 'Overdue work order', body: 'WO-2026-0183 (Valve 07 maintenance) passed its target completion date.', at: min(60 * 22), state: 'unread', link: '#/p/work-orders/WO-2026-0183', severity: 'warning' },
    { id: 'n5', audience: 'provider', kind: 'equipment', title: 'Sensor offline', body: 'Pressure Sensor PT-D2 has not reported for 9 hours.', at: min(60 * 9), state: 'read', link: '#/p/assets/PT-D2', severity: 'offline' },
  ];

  return {
    version: 5,
    seededAt: now,
    scenario: 'normal',
    reportSeq: 1042,
    incidentSeq: 42,
    woSeq: 191,
    advSeq: 32,
    zoneIssues: {
      B: { type: 'line', label: 'Distribution-line problem (unconfirmed)', pressureDrop: 16, flowChange: -21, lossML: 0.5, since: min(100), spawn: true },
    },
    pumpsOffline: [],
    reports,
    incidents,
    workOrders,
    advisories,
    assets,
    emergencyTanks,
    altWater,
    consumption,
    notifications,
    seenAlerts: {},
    tele: null, // filled by the simulation engine
    history: null,
    scenarioLog: [],
  };
}
