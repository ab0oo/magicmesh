# Project Context

## What’s working
- Live node loads from `node_positions_proxy.php`, map renders with Leaflet, and nodes align with the basemap.
- Node colors persist by last transmit; reset button restores white.
- Elevation lookup works via `dem_elevation.php` and is stored in node model.
- Tooltip shows node ID + elevation on hover.
- Modulation presets + link-budget range are wired in.
- Docker image builds with `pdo_pgsql` installed.

## Current behavior
- Map is slippy/zoomable when “Map Pan/Zoom” is enabled.
- Nodes stay aligned to map during pan/zoom; node size scales with zoom (`1 / sqrt(mapScale)`).
- Live data load shows two-stage loading text: “Loading Live Data…” then “Loading Elevation…”.

## Files touched
- `index.html`, `style.css`, `main.js`, `worker.js`
- `node_positions.php`, `node_positions_proxy.php`
- `dem_elevation.php`
- `docker-compose.yml`, `Dockerfile`
- `favicon.ico`, `README.md`

## Important implementation notes
- `node_positions.php` uses `geom` with `ST_Transform(..., 4326)`; fixed-point lat/lon fallback is supported.
- `main.js` projects lat/lon to canvas using Leaflet `latLngToContainerPoint` and syncs nodes on map move/zoom.
- `worker.js` accepts `mapScale` to scale visuals; `setNodePositions` updates node coords without resetting state.
- Elevation fetch: `main.js` POSTs node list to `dem_elevation.php` and merges `elevation` onto nodes.

## TODO / next ideas
- Tune node scaling further if needed (currently `1 / sqrt(mapScale)`).
- Decide whether to keep debug mode in `dem_elevation.php` (TODO added).
- Consider adding UI readouts for current preset/link budget settings.
