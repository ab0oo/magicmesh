# Mesh Flood Routing Simulator

A browser-based canvas simulation of flood routing in a mesh network (Meshtastic-inspired). Nodes can be dragged, you can inject floods, and the simulation models LoRa on-air time plus timing/backoff behavior.

## Features
- **Canvas visualization** of mesh nodes, links, and flood waves.
- **Flood routing** with duplicate suppression and max hop count (TTL).
- **LoRa airtime** computed from Semtech ToA math for the selected modulation preset + packet size.
- **Backoff + LBT/CAD-style retry**: nodes schedule rebroadcasts and will backoff if the channel is busy.
- **Time scale control** to slow the simulation (10%–100%).
- **On-canvas scale bar** (lower-right) and `m/px` readout for the current view.
- **Worker-based rendering/simulation** using `OffscreenCanvas`.
- **Persistent node coloring**: nodes keep the color of the last packet they received/transmitted.
- **Reset node colors** button to restore all nodes to white.
- **Export/Import** simulation state to/from a JSON file (browser download + file upload).
- **Node types**:
  - `ROUTER` (star), `CLIENT` (circle), `CLIENT_MUTE` (triangle; receives but never retransmits).
- **Simplified curvature LOS** (perfect sphere) using each node’s height above local ground.

## Quick start (frontend only)
Because the app uses ES modules + a Web Worker, it must be served over HTTP.

```bash
python3 -m http.server 8000
```

Open `http://localhost:8000/`.

## Quick start (Docker + PHP endpoints)
If you want the PHP endpoints (`dem_elevation.php`, `node_positions_proxy.php`, etc), run via Docker.

```bash
cp .env.example .env
# edit .env with your DB + proxy settings
docker compose up --build
```

Then open whatever port your `docker-compose.yml` exposes (commonly `http://localhost:8080/`).

## Controls
- **Click a node**: inject a flood message from that node.
- **Shift-click**: pin/unpin a node (prevents movement in dynamic mode; also useful while dragging others).
- **Drag a node**: reposition without triggering a flood.
- **Drag from the palette** (lower-left): add a router/client/mute node.
- **Reset Node Colors**: restore all nodes to white.
- **Download**: export the current node layout (and sim parameters) as JSON.
- **Load**: import a previously exported JSON file.
- **Save**: export a “state” JSON file (same mechanism; useful for snapshots).
- **Node Count**: set the number of nodes.
- **Range**: adjust communication radius.
- **Time Scale**: slow down or speed up the simulation clock.
- **Max Hops**: limit the flood relay depth.

## How it works
- Nodes are indexed in a quadtree each frame for fast neighbor lookups.
- A flood message maintains a transmit queue and pending receives.
- When a node transmits, neighbors schedule receive events after the on-air time.
- When a receive occurs, the node schedules its relay with a role-dependent backoff window.
- Duplicate suppression prevents retransmitting the same flood ID twice (but nodes can still “hear” the final hop).
- Pulses render on transmit and expand to full range over the on-air time.
- Curvature LOS is applied using node height AGL (defaults to `2m`) and a spherical Earth.

## Algorithm overview
1. Build a quadtree over all node positions to support fast radius queries.
2. On flood injection, enqueue the origin node for transmit after CAD time.
3. Each tick:
   - Process pending receives whose time has arrived (collisions are modeled if overlapping).
   - For each receive, mark the node as having seen the message; enqueue a relay if allowed by TTL + role.
   - Process transmit events whose time has arrived; if carrier sense indicates busy, requeue with backoff.
   - For each transmit, schedule neighbor receives after the on-air time, suppressing duplicates.
4. Remove floods that have no pending transmit/receive events.

## Server-side endpoints config
The PHP endpoints (`node_positions.php`, `dem_elevation.php`, `radio_los.php`) read database settings
from environment variables. For Docker, copy `.env.example` to `.env` and fill in values; `docker-compose.yml`
loads `.env` into the container environment (no DB defaults are hardcoded in PHP).

## Files
- `index.html`: layout and UI controls.
- `style.css`: visual styling.
- `main.js`: Small bootloader that loads the UI module with cache-busting.
- `app/main_app.js`: UI orchestrator (imports app modules with cache-busting).
- `app/worker_bridge.js`: Worker creation, clock, and canvas input forwarding.
- `app/controls.js`: RF/LoRa UI controls and fixed parameters.
- `app/state_io.js`: Export/import (download, load, save) wiring.
- `app/live_map.js`: Optional Leaflet live-map integration.
- `worker.js`: simulation engine and renderer.
- `node_positions.php`: server-side endpoint for pulling recent node positions and normalizing to canvas size.
- `terrain_grid.php`: server-side endpoint that samples a DEM into a grid (currently not wired into the UI).

## Live data endpoint (optional)
The codebase includes a `node_positions_proxy.php` helper that can call an upstream
node-positions service. Configure the upstream URL via `NODE_POSITIONS_REMOTE_URL`
in `.env` when you want to re-enable that workflow.

Note: the UI wiring expects an optional button with `id="loadLive"`; if it is not present,
the live-load flow is effectively disabled (but the code paths remain).

Example response:
```json
{
  "nodes": [
    {
      "node_id": 12,
      "latitude": 38.5816,
      "longitude": -121.4944,
      "altitude": 14.2,
      "updated_at": "2024-07-01T18:12:34.123Z",
      "x": 432.18,
      "y": 295.77
    }
  ],
  "bbox": {
    "min_lat": 38.575,
    "max_lat": 38.589,
    "min_lon": -121.506,
    "max_lon": -121.489
  }
}
```

## Radio line-of-sight endpoint
`radio_los.php` is a small PHP microservice that checks terrain line-of-sight between two points,
given lat/lon plus antenna height above local ground (meters). It samples the DEM along the path
and reports whether any terrain intersects the straight line between antennas.

Request (POST JSON):
```json
{
  "point1": { "latitude": 38.5816, "longitude": -121.4944, "height_agl_m": 5 },
  "point2": { "latitude": 38.5890, "longitude": -121.4890, "height_agl_m": 5 },
  "sample_distance_m": 30,
  "max_samples": 1000,
  "include_curvature": true,
  "k_factor": 1.3333333333
}
```

## Notes / Next ideas
- Add UI toggles for mobile nodes.
- Repurpose slider slots for additional routing parameters.
- Add on-screen readouts for slider values and debug timing labels.
