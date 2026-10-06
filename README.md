# SAMAR-AGOS

**Smart Water Monitoring and Response**: a connected water-service platform prototype for Catbalogan City, Samar, built around Catbalogan Water District (CWD).

> Residents know what to expect. Water providers know where to act.

Reference data is real and sourced (see **Data sources**). Operational records — reports, incidents, work orders, advisories, notifications, water points and emergency storage — are not preloaded: they are created in the app and stored in Firebase. Live readings (pressure, flow, reservoir level, water quality) are **simulated**, calibrated to CWD's published figures, because no live sensor data is public.

## Run

```bash
npm start
```

Then open http://localhost:5173 (set `PORT` to change it). There is nothing to install: the app uses vanilla ES modules and its own SVG charts. It needs Node 18 or later.

The service-area map is an interactive Leaflet map of Catbalogan City on OpenStreetMap or Esri satellite tiles, so it needs internet access. Without a connection it falls back to a built-in schematic SVG map.

**Service areas** are the 26 barangays CWD serves, with real boundaries from OpenStreetMap. Six barangays (Poblacion 3, 4, 6, 9, Canlapwas, Lagundi) have no boundary in OpenStreetMap and are drawn as approximate areas around their mapped centre. Regenerate with `node scripts/build-barangays.mjs` (writes `public/js/barangays.js`).

The **pipe network** in `public/data/network.json` follows real roads (© OpenStreetMap contributors, ODbL) inside the served barangays, fed from the Poblacion 13 reservoir, with mains to the Kulador plant and the deep wells. It totals about 45 km, close to CWD's published 45.6 km, but the routing is illustrative: CWD has not published its pipe routes. Regenerate with:

```bash
node scripts/build-network.mjs public/data/network.json
```

## Data sources

| Data | Source |
|---|---|
| Utility, water sources, treatment plant, reservoir, wells, booster pumps, pipe length, coverage (26 of 57 barangays), water-quality testing routine | Catbalogan Water District **Water Safety Plan 2022** (Rev 3.0), catbaloganwd.gov.ph |
| Connections (9,681 active), production, billed volume, non-revenue water (32%), average use, water rates (effective 1 Mar 2018) | **LWUA Monthly Data Sheets**, Catbalogan WD, Jan–Dec 2022 |
| Barangay populations (2020) | PSA 2020 Census of Population (via PhilAtlas) |
| Barangay boundaries, hospitals, schools, city hall, jail, roads | OpenStreetMap contributors (ODbL) |
| Weather forecast, climate normals (ERA5 2015–2024) | Open-Meteo |
| Drinking-water limits | Philippine National Standards for Drinking Water (PNSDW 2017) |
| Demo scenarios (Caramayon power outage, turbid Antiao River) | Modelled on the documented July 2026 Catbalogan water crisis (Daily Tribune, PIA) |

Not publicly available, so **simulated** or **left blank**: live pressure, flow, reservoir level and water-quality readings (simulated); per-barangay connections (estimated from population); asset condition, maintenance dates and install years where CWD has not published them (shown as "Not recorded").

## Weather and climate (real data)

The Forecast page uses real data from [Open-Meteo](https://open-meteo.com) (free, no API key):

- **Weather forecast:** current conditions and the 3-day outlook for Catbalogan City.
- **Climate record:** ERA5 reanalysis for 2015–2024 gives the normal daily high and rainfall for each day of the year. The last 30 days of observed rain are compared with that normal.

How weather affects the water supply (demand +2.5% per °C above the climate normal, lower treatment output in heavy rain, lower river inflow in a dry spell) is still an ESTIMATED model.

## Water Safety (potability)

**Monitor → Water Safety** checks drinking water before it reaches residents, at the sampling points in CWD's Water Safety Plan: the Kulador plant outlet, the Poblacion 13 reservoir and household taps.

- **Online readings (SIMULATED IoT):** pH, turbidity, free residual chlorine, temperature and total dissolved solids.
- **Lab results (MANUAL):** E. coli and total coliform.

Limits follow the Philippine National Standards for Drinking Water (PNSDW 2017). Temperature uses an operational guide of ≤ 32 °C, since it has no health limit.

- **Verdict:** any health limit exceeded makes the water **Not safe to use**. The operator gets an alert, recommended actions and a one-click boil-water advisory.
- **Demo control** (demo mode only): the floating **Safe / Not safe** buttons switch all readings instantly. With Firebase, the choice is shared with every operator through `system/control`.

## Forecast accuracy tracking

Every 30 simulated minutes the app saves its storage and demand forecast for 1, 6 and 24 hours ahead. When each target time arrives, it records the measured value and scores the error. The Forecast page shows:

- average error (percentage points of storage)
- bias
- the share of forecasts within target
- demand error (MAPE)
- a forecast-vs-measured chart

The 90th-percentile error becomes the shaded "likely range" around the storage forecast. Proposed targets (±2 / ±5 / ±8 pts) are in `FC_TARGETS` in `store.js`; agree the real margins with the utility. Measured values are simulated in this prototype, so the scores become a real accuracy measure only once meter data is connected.

## Backend: Firebase (Authentication + Cloud Firestore)

SAMAR-AGOS uses Firebase project **`samar-agos-ic9sb`**. The web config is in `public/js/firebase-config.js`. It identifies the project but isn't secret; access is enforced by the security rules.

- **Accounts:** email and password or Google (Firebase Authentication). Residents create their own account and choose their barangay.
- **Staff (provider) access:** an email allowlist stored in `config/access`. The first account to sign in can claim staff administrator during profile setup. After that, staff add colleagues under **Sidebar → Staff access**.
- **Shared data in Firestore:** `reports`, `incidents`, `workOrders`, `advisories`, `notifications`, `altWater`, `emergencyTanks`, `assets`, `system/control` (scenario state), `system/public` (zone report counts for residents), `counters/ids` (ticket numbers) and `users/{uid}` (profiles).
- **Security rules** (`firestore.rules`):
  - residents read and update only their own reports and notifications
  - operational records are readable by signed-in users and writable only by staff
- **Telemetry** is still simulated on each device, driven by the shared scenario state. It isn't written to Firestore.
- **Starting data:** the first staff sign-in on an empty database stores CWD's asset registry and the scenario state. Nothing else is seeded.
- **Demo mode** (account menu → Demo mode, per browser) shows the Demo scenarios panel and the Safe / Not safe switch. **Reset demo scenarios** restores normal operations and removes only simulated reports; real records are never deleted.

Deploy rule changes after editing `firestore.rules`:

```bash
firebase deploy --only firestore:rules
```

To run without Firebase (offline local demo with role picker), set `apiKey: ''` in `public/js/firebase-config.js`.

## Typical workflow

1. A resident reports a problem (**Report a Problem**). It appears in the operator's **Incidents → Report Inbox**, grouped by barangay.
2. The operator checks the evidence (pressure, flow, storage, equipment) and creates an incident.
3. From the incident, the operator creates a work order and publishes an advisory to the affected barangays.
4. The crew completes the work order with repair notes and a verification reading; the operator resolves the incident and residents are notified.
5. Residents confirm whether service returned; "problem still exists" reopens the incident.

Turn on **Demo mode** to trigger scenarios (Caramayon power outage, turbid Antiao River, low pressure in Maulong, main break in Canlapwas) for presentations.

## Structure

```
server.js                    static file server (no deps)
public/index.html
public/css/styles.css        design system (tokens, components, responsive)
public/js/
  app.js                     shell, routing, login, notifications, demo panel
  store.js                   state, IoT simulation engine, forecast, alerts, workflow actions
  data.js                    reference data: CWD facts, water rates, asset registry, service areas
  barangays.js               generated: served barangays (PSA 2020 population, OSM boundaries)
  assetinfo.js               asset categories, lifecycle (documented install years), simulated run logs
  ui.js                      components: badges, KPI, cards, timeline, table, modal, drawer, toast
  charts.js                  SVG line/bar/sparkline charts with tooltips
  livemap.js                 interactive Leaflet map (Catbalogan City): live markers, clustering, layers
  map.js                     map entry point + offline schematic SVG fallback
  views/resident.js          resident portal (mobile-first)
  views/provider*.js         provider portal (overview, operations, incidents, work orders,
                             forecast, advisories, assets, analytics; maintenance is a Work Orders tab)
```

## Data transparency

Every important value carries a source badge: `LIVE`, `MANUAL` (recorded or published data), `ESTIMATED`, `FORECAST`, `SIMULATED`, `RESIDENT REPORTED`, `CLIMATE RECORD`. The simulation is calibrated to CWD: one 440 m³ reservoir (100 m³ firefighting reserve), ~9.6 ML/day average production, and supply from the Caramayon springs (91 L/s pumped), Masacpasac spring, Kulador plant and deep wells. Each 3-second tick advances it by 5 minutes (accelerated time).
