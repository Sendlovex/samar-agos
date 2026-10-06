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
                             forecast, simulator, advisories, assets, maintenance, analytics)
```

## Data transparency

Every important value carries a source badge: `LIVE`, `MANUAL`, `ESTIMATED`, `FORECAST`, `SIMULATED`, `RESIDENT REPORTED`. Each 3-second telemetry tick advances the simulation by 5 minutes (accelerated time). State persists in `localStorage`, so the resident and provider views share one connected dataset.
