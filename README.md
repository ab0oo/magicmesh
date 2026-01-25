# Mesh Flood Routing Simulator

A browser-based canvas simulation of flood routing in a mesh network. Nodes are mostly static, can be dragged to new positions, and can broadcast flood messages. The simulation models on-air transmission time, distance-based relay delay, and hop limits.

## Features
- **Canvas visualization** of mesh nodes, links, and flood waves.
- **Flood routing** with duplicate suppression and max hop count (TTL).
- **Transmission timing model**:
  - Each transmission’s **on-air time** is computed from the selected LoRa modulation preset (Semtech ToA formula; defaults to a 20-byte PHY payload).
  - After receiving, a node waits an **inverse-distance delay** up to **500 ms** before relaying.
    - 10% of max range → ~450 ms delay.
    - 50% of max range → ~250 ms delay.
    - 90% of max range → ~50 ms delay.
- **Time scale control** to slow the entire simulation (10%–100%).
- **Transmission counter** for the most recently completed flood.
- **Worker-based rendering/simulation** using `OffscreenCanvas`.
- **Persistent node coloring**: nodes keep the color of the last packet they transmitted.
- **Reset node colors** button to restore all nodes to white.
- **Load live data** button to fetch normalized node positions from a remote endpoint.

## Latest updates (0.1.0)
- On-air time uses Semtech LoRa calculations per preset and packet size; manual range uses Long/Fast timing.
- SNR-weighted rebroadcast backoff and CAD-style busy retry approximate Meshtastic timing behavior.
- Packet size spinner updates airtime and simulation timing.
- Added a draggable node palette (router/client/client_mute) to add nodes on the canvas.
- UI controls moved into a left sidebar; map pan/zoom only appears after loading live data.

## Controls
- **Click a node**: inject a flood message from that node.
- **Shift-click**: toggle pin/unpin (reserved for future movement behaviors).
- **Drag a node**: reposition the node without triggering a flood.
- **Reset**: regenerate node positions.
- **Pause**: freeze the simulation clock.
- **Reset Node Colors**: restore all nodes to white.
- **Load Live Data**: fetch the latest node map from the configured endpoint.
- **Node Count**: set the number of nodes.
- **Range**: adjust communication radius.
- **Time Scale**: slow down or speed up the simulation clock.
- **Max Hops**: limit the flood relay depth.

## How it works
- Nodes are indexed in a quadtree each frame for fast neighbor lookups.
- A flood message maintains a transmit queue and pending receives.
- When a node transmits, neighbors schedule receive events after the on-air time.
- When a receive occurs, the node schedules its relay with an inverse-distance delay.
- Pulses render on transmit and expand to full range over the on-air time.

## Algorithm overview
1. Build a quadtree over all node positions to support fast radius queries.\n
2. On flood injection, enqueue the origin node for immediate transmit.\n
3. Each tick:\n
   - Process pending receives whose time has arrived.\n
   - For each receive, mark the node as having seen the message and enqueue a relay after an inverse-distance delay.\n
   - Process transmit events whose time has arrived.\n
   - For each transmit, schedule neighbor receives after the on-air time, suppressing duplicates.\n
4. Remove floods that have no pending transmit/receive events.\n

## Running locally
Because the app uses ES modules and a Web Worker, it must be served over HTTP.

```bash
python3 -m http.server 8000
```

Then open `http://localhost:8000/` in your browser.

## Server-side endpoints config
The PHP endpoints (`node_positions.php`, `dem_elevation.php`, `radio_los.php`) read database settings
from environment variables. For Docker, copy `.env.example` to `.env` and fill in values; `docker-compose.yml`
loads `.env` into the container environment (no DB defaults are hardcoded in PHP).

## Files
- `index.html`: layout and UI controls.
- `style.css`: visual styling.
- `main.js`: UI wiring, worker setup, and input forwarding.
- `worker.js`: simulation engine and renderer.
- `node_positions.php`: server-side endpoint for pulling recent node positions and normalizing to canvas size.
- `terrain_grid.php`: server-side endpoint that samples a DEM into a grid (currently not wired into the UI).

## Live data endpoint (optional)
The codebase includes a `node_positions_proxy.php` helper that can call an upstream
node-positions service. Configure the upstream URL via `NODE_POSITIONS_REMOTE_URL`
in `.env` when you want to re-enable that workflow.

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
