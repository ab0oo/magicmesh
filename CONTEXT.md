# Project Context

## What’s working (current)
- Worker-based sim/render runs reliably after refresh (message buffering avoids early init races).
- Node roles/shapes: `ROUTER`=star, `CLIENT`=circle, `CLIENT_MUTE`=triangle (receives but never retransmits).
- Flood model: duplicate suppression, TTL semantics allow receiving at max hop but not rebroadcasting past TTL.
- LoRa on-air time uses Semtech ToA math and updates based on modulation preset + packet size spinner.
- LBT/CAD-style busy detection triggers backoff; pending-transmit ring counts down clockwise.
- Curvature LOS (perfect sphere) gates both neighbor links and carrier-sense checks using node height AGL.
- Default node height is `2m` AGL; tooltip shows `Height: 2.0 m AGL` even if ground elevation is unknown.
- Scale bar is in the lower-right and is tied to the same `metersPerPixel/mapScale` logic used by LOS.
- Export/import of sim state works via JSON download + file upload.

## Current behavior / UI notes
- The UI is loaded via `main.js` (bootloader) → `app/main_app.js` (orchestrator) → small app modules.
- Live-map integration exists (`app/live_map.js`) but is currently UI-gated by an optional `id="loadLive"` button.
- Map pan/zoom button only becomes visible after live data is loaded (when enabled).

## Files touched
- Frontend: `index.html`, `style.css`, `main.js`, `app/*.js`, `worker.js`, `worker/*`
- PHP: `dem_elevation.php`, `node_positions.php`, `node_positions_proxy.php`, `radio_los.php`, `terrain_grid.php`
- Docker: `docker-compose.yml`, `Dockerfile`
- Docs: `README.md`, `CONTEXT.md`, `route_timing.md`, `route_summary.md`

## Important implementation notes
- Cache-busting/versioning: `index.html` sets `window.APP_VERSION`; `main.js` and `app/main_app.js` have fallbacks.
  Worker + worker submodules are imported with the same `?v=` query param; if you change JS, bump the patch.
- Worker init race: `worker.js` installs `onmessage` immediately and buffers `event.data` until modules load.
- Curvature LOS: implemented as a simple radio-horizon check (`worker/radio.js`) assuming a perfect sphere.
  It gates neighbor edges and carrier-sense “busy” detection; it does not model diffraction or refraction.
- Height model: nodes have `heightM` (AGL). Export/import uses `height_m` for persistence.
- Scale model:
  - Random mode: `metersPerPixel` is computed in `app/controls.js` and capped to the 2m↔2m horizon (~10.1 km).
  - Live mode (when enabled): `app/live_map.js` computes `metersPerPixel` from Leaflet by measuring 1 screen pixel.
  - Rendering uses `metersPerPixel / mapScale` as “meters per screen pixel”.

## TODO / next ideas
- Decide how to reconcile “link budget range” vs curvature horizon (today curvature can dominate at low heights).
- Improve the LBT model: simultaneous transmit events within the same tick can both start transmitting.
- Add a UI control for node height AGL (global + per-node) and show “radio horizon” readouts.
- Re-enable or remove live-map loading UI (bring back a `loadLive` button if desired).
