# Mesh Flood Routing Simulator

A browser-based canvas simulation of flood routing in a mesh network. Nodes are mostly static, can be dragged to new positions, and can broadcast flood messages. The simulation models on-air transmission time, distance-based relay delay, and hop limits.

## Features
- **Canvas visualization** of mesh nodes, links, and flood waves.
- **Flood routing** with duplicate suppression and max hop count (TTL).
- **Transmission timing model**:
  - Each transmission spends **350 ms on air**.
  - After receiving, a node waits an **inverse-distance delay** up to **500 ms** before relaying.
    - 10% of max range → ~450 ms delay.
    - 50% of max range → ~250 ms delay.
    - 90% of max range → ~50 ms delay.
- **Time scale control** to slow the entire simulation (10%–100%).
- **Transmission counter** for the most recently completed flood.
- **Worker-based rendering/simulation** using `OffscreenCanvas`.

## Controls
- **Click a node**: inject a flood message from that node.
- **Shift-click**: toggle pin/unpin (reserved for future movement behaviors).
- **Drag a node**: reposition the node without triggering a flood.
- **Reset**: regenerate node positions.
- **Pause**: freeze the simulation clock.
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

## Files
- `index.html`: layout and UI controls.
- `style.css`: visual styling.
- `main.js`: UI wiring, worker setup, and input forwarding.
- `worker.js`: simulation engine and renderer.

## Notes / Next ideas
- Add UI toggles for mobile nodes.
- Repurpose slider slots for additional routing parameters.
- Add on-screen readouts for slider values and debug timing labels.
