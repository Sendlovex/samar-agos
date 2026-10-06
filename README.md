# SAMAR-AGOS

**Smart Water Monitoring and Response**: a hackathon prototype of a connected water-service platform for Catbalogan City, Samar.

> Residents know what to expect. Water providers know where to act.

All data is fictional, and the IoT telemetry is simulated. The app does not connect to any real utility, sensor, or account.

## Run

```bash
npm start
```

Then open http://localhost:5173 (set `PORT` to change it). There is nothing to install: the app uses vanilla ES modules and its own SVG charts. It needs Node 18 or later.

The service-area map is an interactive Leaflet map of Catbalogan City on OpenStreetMap or Esri satellite tiles, so it needs internet access. Without a connection it falls back to a built-in schematic SVG map. Zone boundaries and asset locations are approximate and fictionalized; barangay positions come from OpenStreetMap.

The pipe network in `public/data/network.json` follows real Catbalogan roads from OpenStreetMap (© OpenStreetMap contributors, ODbL). The network is one connected graph fed from the Central Reservoir. Transmission mains (blue) follow the shortest road routes from the reservoir to each tank, well, booster pump and zone; every other connected street carries a distribution line (red). The routing is illustrative, not the actual utility network. To regenerate it (roads are cached in `scripts/.osm-roads-cache.json`; delete that file to re-download):

```bash
node scripts/build-network.mjs public/data/network.json
```

## Weather and climate (real data)

The Forecast page uses real data from [Open-Meteo](https://open-meteo.com) (free, no API key):

- **Weather forecast:** current conditions and the 3-day outlook for Catbalogan City.
- **Climate record:** ERA5 reanalysis for 2015–2024 gives the normal daily high and rainfall for each day of the year. The last 30 days of observed rain are compared with that normal.

How weather affects the water supply (demand +2.5% per °C above the climate normal, lower treatment output in heavy rain, lower river inflow in a dry spell) is still an ESTIMATED model.

## Water Safety (potability)

**Monitor → Water Safety** checks drinking water before it reaches residents, at three monitoring points: treatment plant outlet, Central Reservoir outlet and distribution entry.

- **Online readings (SIMULATED IoT):** pH, turbidity, free residual chlorine, temperature and total dissolved solids.
- **Lab results (MANUAL):** E. coli and total coliform.

Limits follow the Philippine National Standards for Drinking Water (PNSDW 2017). Temperature uses an operational guide of ≤ 32 °C, since it has no health limit.

- **Verdict:** any health limit exceeded makes the water **Not safe to drink**. The operator gets an alert, recommended actions and a one-click boil-water advisory.
- **Demo control:** the floating panel's **Safe / Not safe** buttons switch all readings instantly. With Firebase, the choice is shared with every operator through `system/control`.

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

- **Accounts:** email and password (Firebase Authentication). Residents create their own account and choose their barangay, which sets their service zone.
- **Staff (provider) access:** an email allowlist stored in `config/access`. The first account to sign in can claim staff administrator during profile setup. After that, staff add colleagues under **Sidebar → Staff access**.
- **Shared data in Firestore:** `reports`, `incidents`, `workOrders`, `advisories`, `notifications`, `altWater`, `emergencyTanks`, `assets`, `system/control` (scenario state), `system/public` (zone report counts for residents), `counters/ids` (ticket numbers) and `users/{uid}` (profiles).
- **Security rules** (`firestore.rules`):
  - residents read and update only their own reports and notifications
  - operational records are readable by signed-in users and writable only by staff
- **Telemetry** is still simulated on each device, driven by the shared scenario state. It isn't written to Firestore.
- **Demo data:** the first staff sign-in on an empty database loads the demo dataset. **Demo scenarios → Reset demo data** reseeds it for everyone.

Deploy rule changes after editing `firestore.rules`:

```bash
firebase deploy --only firestore:rules
```

To run without Firebase (offline local demo with role picker), set `apiKey: ''` in `public/js/firebase-config.js`.

## Demo walkthrough (core workflow)

1. Sign in as **Water Provider / Operator**. The Overview shows a **WARNING**: Zone B pressure is low and 17 resident reports are waiting for review.
2. **Incidents → Report Inbox**: review the Zone B cluster against the pressure, flow, storage, and equipment evidence, then click **Create Incident**. You must confirm the operational evidence first; the report count alone is not enough.
3. On the incident page, **Create Work Order** and **Publish Advisory** (there's a live resident preview; the restoration time is optional).
4. **Run Response Simulation**. Use the sidebar's **Demo scenarios** to apply *Pump Failure* and see a forecast shortage risk. Then compare *No Action* with *Activate Emergency Water*.
5. Open the work order and step it through En Route → … → **Completed** (repair notes and a verification reading). Zone B pressure recovers on the next telemetry updates.
6. **Resolve Incident**. This sends residents a restoration notification.
7. Click **Open resident view** and go to **My Reports → WR-2026-1038**. Answer **Service Restored** or **Problem Still Exists**. The second answer reopens the incident and alerts the provider.

The Demo scenarios panel includes a live checklist of these steps and a **Reset demo data** button.

## Structure

```
server.js                    static file server (no deps)
public/index.html
public/css/styles.css        design system (tokens, components, responsive)
public/js/
  app.js                     shell, routing, login, notifications, demo panel
  store.js                   state, IoT simulation engine, forecast, alerts, workflow actions
  data.js                    fictional seed data (zones, assets, reports, incidents…)
  ui.js                      components: badges, KPI, cards, timeline, table, modal, drawer, toast
  charts.js                  SVG line/bar/sparkline charts with tooltips
  livemap.js                 interactive Leaflet map (Catbalogan City): live markers, clustering, layers
  map.js                     map entry point + offline schematic SVG fallback
  views/resident.js          resident portal (mobile-first)
  views/provider*.js         provider portal (overview, operations, incidents, work orders,
                             forecast, simulator, advisories, assets, analytics; maintenance is a Work Orders tab)
```

## Data transparency

Every important value carries a source badge: `LIVE`, `MANUAL`, `ESTIMATED`, `FORECAST`, `SIMULATED`, `RESIDENT REPORTED`. Each 3-second telemetry tick advances the simulation by 5 minutes (accelerated time). State persists in `localStorage`, so the resident and provider views share one connected dataset.
