const canvas = document.getElementById("sim");
const footerEl = document.querySelector(".app__footer");
const resetColorsButton = document.getElementById("resetColors");
const downloadButton = document.getElementById("download");
const loadButton = document.getElementById("load");
const loadLiveButton = document.getElementById("loadLive");
const saveButton = document.getElementById("saveState");
const loadFileInput = document.getElementById("loadFile");
const canvasSection = document.querySelector(".app__canvas");
const mapContainer = document.getElementById("map");
const nodeCountInput = document.getElementById("nodeCount");
const rangeInput = document.getElementById("range");
const timeScaleInput = document.getElementById("timeScale");
const ttlInput = document.getElementById("ttl");
const modPresetSelect = document.getElementById("modPreset");
const packetSizeInput = document.getElementById("packetSize");
const mapToggleButton = document.getElementById("mapToggle");
const canvasElement = document.getElementById("sim");

if (!canvas.transferControlToOffscreen) {
  console.error("OffscreenCanvas not supported in this browser.");
}

const APP_VERSION = window.APP_VERSION || "0.1.5";

const RF_FIXED = {
  frequencyMHz: 915,
  pathLossExp: 2.0,
  txPower: 24,
  txGain: 3,
  rxGain: 3,
  noiseFloor: -120,
};

const LORA_FIXED = {
  // Default simulated packet size (PHY payload length).
  payloadBytes: 20,
  codingRate: "4/5",
  preambleSymbols: 16,
  explicitHeader: true,
  crcEnabled: true,
  lowDataRateOptimize: true,
};

const toaValueEl = document.getElementById("toaValue");
let loraTimeOnAirMs = null;
import(`./lora_airtime.js?v=${encodeURIComponent(APP_VERSION)}`)
  .then((mod) => {
    loraTimeOnAirMs = typeof mod.loraTimeOnAirMs === "function" ? mod.loraTimeOnAirMs : null;
    updateOnAirDisplay();
  })
  .catch(() => {
    // Display stays as "—" if the helper can't be loaded.
  });

function computeMaxDistanceMeters(linkBudgetDb, frequencyMHz, pathLossExp) {
  const freq = Number(frequencyMHz);
  const exp = Number(pathLossExp);
  if (!Number.isFinite(linkBudgetDb) || !Number.isFinite(freq) || !Number.isFinite(exp)) {
    return null;
  }
  if (freq <= 0 || exp <= 0) {
    return null;
  }
  const denom = 10 * exp;
  const base = linkBudgetDb - 32.44 - 20 * Math.log10(freq);
  const distanceKm = Math.pow(10, base / denom);
  if (!Number.isFinite(distanceKm) || distanceKm <= 0) {
    return null;
  }
  return distanceKm * 1000;
}

// Calibrate the random-canvas physical scale so that the Short Slow preset's
// computed range is roughly equal (in pixels) to the manual range slider value.
const CALIBRATION_LINK_BUDGET_DB = 145.5; // Short Slow (SF8/BW250)
const CALIBRATION_FREQ_MHZ = RF_FIXED.frequencyMHz;
const calibrationTargetPx = Number(rangeInput?.value) || 110;
const calibrationPathLossExp = RF_FIXED.pathLossExp;
const calibrationRangeMeters = computeMaxDistanceMeters(
  CALIBRATION_LINK_BUDGET_DB,
  CALIBRATION_FREQ_MHZ,
  calibrationPathLossExp
);
const METERS_PER_PIXEL = Math.max(
  1,
  Math.round(
    (calibrationRangeMeters || 10 * calibrationTargetPx) / Math.max(1, calibrationTargetPx)
  )
);

const worker = new Worker(`./worker.js?v=${encodeURIComponent(APP_VERSION)}`, {
  type: "module",
});
worker.addEventListener("error", (event) => {
  console.error("Worker error:", event);
  if (footerEl) {
    footerEl.textContent = "Worker error (see console).";
  }
});
worker.addEventListener("messageerror", (event) => {
  console.error("Worker message error:", event);
  if (footerEl) {
    footerEl.textContent = "Worker message error (see console).";
  }
});
const offscreen = canvas.transferControlToOffscreen();
let tickHandle = null;
let liveMap = null;
let liveTileLayer = null;
let liveMapReady = false;
let liveDataNodes = null;
let liveDataBbox = null;
let mapUpdatePending = false;
let mapInteractionEnabled = false;
let liveMinZoom = null;
let liveBaseZoom = null;

const forceRender = () => {
  worker.postMessage({ type: "tick", payload: { now: performance.now() } });
};

const setMapInteraction = (enabled) => {
  if (!mapContainer) {
    return;
  }
  mapContainer.style.pointerEvents = enabled ? "auto" : "none";
  mapContainer.style.zIndex = enabled ? "1" : "0";
  if (canvasElement) {
    canvasElement.style.pointerEvents = enabled ? "none" : "auto";
    canvasElement.style.zIndex = enabled ? "2" : "1";
  }
  if (liveMap) {
    const action = enabled ? "enable" : "disable";
    if (liveMap.dragging) {
      liveMap.dragging[action]();
    }
    if (liveMap.scrollWheelZoom) {
      liveMap.scrollWheelZoom[action]();
    }
    if (liveMap.touchZoom) {
      liveMap.touchZoom[action]();
    }
    if (liveMap.doubleClickZoom) {
      liveMap.doubleClickZoom[action]();
    }
    if (liveMap.boxZoom) {
      liveMap.boxZoom[action]();
    }
    if (liveMap.keyboard) {
      liveMap.keyboard[action]();
    }
  }
};

const setMapToggleVisible = (visible) => {
  if (!mapToggleButton) {
    return;
  }
  mapToggleButton.hidden = !visible;
};

const resetMapToggleState = () => {
  if (!canvasSection) {
    return;
  }
  mapInteractionEnabled = false;
  canvasSection.classList.remove("app__canvas--map-active");
  setMapInteraction(false);
  if (mapToggleButton) {
    mapToggleButton.textContent = "Map Pan/Zoom";
  }
  setMapToggleVisible(false);
};

function getCanvasMetrics() {
  const rect = canvas.getBoundingClientRect();
  const dpr = window.devicePixelRatio || 1;
  return {
    width: rect.width,
    height: rect.height,
    dpr,
  };
}

const modulationPresets = {
  short_turbo: { linkBudgetDb: 140, sf: 7, bwHz: 500000 },
  short_fast: { linkBudgetDb: 143, sf: 7, bwHz: 250000 },
  short_slow: { linkBudgetDb: 145.5, sf: 8, bwHz: 250000 },
  medium_fast: { linkBudgetDb: 148, sf: 9, bwHz: 250000 },
  medium_slow: { linkBudgetDb: 150.5, sf: 10, bwHz: 250000 },
  long_turbo: { linkBudgetDb: 150, sf: 11, bwHz: 500000 },
  long_fast: { linkBudgetDb: 153, sf: 11, bwHz: 250000 },
  long_moderate: { linkBudgetDb: 156, sf: 11, bwHz: 125000 },
  long_slow: { linkBudgetDb: 158.5, sf: 12, bwHz: 125000 },
};

function getSelectedModulation() {
  const value = modPresetSelect.value;
  if (value === "manual") {
    // Manual range uses Long/Fast modulation timing.
    return modulationPresets.long_fast;
  }
  return modulationPresets[value] || modulationPresets.long_fast;
}

function clampPacketSizeBytes(value) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) {
    return LORA_FIXED.payloadBytes;
  }
  return Math.max(20, Math.min(250, Math.round(parsed)));
}

function getSelectedLoraParams() {
  const modulation = getSelectedModulation();
  const payloadBytes = packetSizeInput
    ? clampPacketSizeBytes(packetSizeInput.value)
    : LORA_FIXED.payloadBytes;
  return {
    loraPayloadBytes: payloadBytes,
    loraSpreadingFactor: modulation.sf,
    loraBandwidthHz: modulation.bwHz,
    loraCodingRate: LORA_FIXED.codingRate,
    loraPreambleSymbols: LORA_FIXED.preambleSymbols,
    loraExplicitHeader: LORA_FIXED.explicitHeader,
    loraCrcEnabled: LORA_FIXED.crcEnabled,
    loraLowDataRateOptimize: LORA_FIXED.lowDataRateOptimize,
  };
}

function formatDurationMs(ms) {
  if (!Number.isFinite(ms) || ms <= 0) {
    return "—";
  }
  if (ms >= 1000) {
    return `${(ms / 1000).toFixed(2)} s`;
  }
  if (ms >= 100) {
    return `${ms.toFixed(0)} ms`;
  }
  return `${ms.toFixed(1)} ms`;
}

function updateOnAirDisplay() {
  if (!toaValueEl) {
    return;
  }
  if (typeof loraTimeOnAirMs !== "function") {
    toaValueEl.textContent = "—";
    return;
  }
  const modulation = getSelectedModulation();
  const payloadBytes = packetSizeInput
    ? clampPacketSizeBytes(packetSizeInput.value)
    : LORA_FIXED.payloadBytes;
  try {
    const ms = loraTimeOnAirMs(
      payloadBytes,
      modulation.sf,
      modulation.bwHz,
      LORA_FIXED.codingRate,
      {
        preambleSymbols: LORA_FIXED.preambleSymbols,
        explicitHeader: LORA_FIXED.explicitHeader,
        crcEnabled: LORA_FIXED.crcEnabled,
        lowDataRateOptimize: LORA_FIXED.lowDataRateOptimize,
        includeRampTime: false,
      }
    );
    toaValueEl.textContent = formatDurationMs(ms);
  } catch {
    toaValueEl.textContent = "—";
  }
}

function sendParams(overrides = {}) {
  worker.postMessage({
    type: "setParams",
    payload: {
      nodeCount: Number(nodeCountInput.value),
      range: Number(rangeInput.value),
      timeScale: Number(timeScaleInput.value),
      ttl: Number(ttlInput.value),
      frequencyMHz: RF_FIXED.frequencyMHz,
      pathLossExp: RF_FIXED.pathLossExp,
      txPower: RF_FIXED.txPower,
      txGain: RF_FIXED.txGain,
      rxGain: RF_FIXED.rxGain,
      noiseFloor: RF_FIXED.noiseFloor,
      ...getSelectedLoraParams(),
      ...overrides,
    },
  });
  updateOnAirDisplay();
}

const metrics = getCanvasMetrics();
worker.postMessage(
  {
    type: "init",
    payload: {
      canvas: offscreen,
      width: metrics.width,
      height: metrics.height,
      dpr: metrics.dpr,
      nodeCount: Number(nodeCountInput.value),
      range: Number(rangeInput.value),
      timeScale: Number(timeScaleInput.value),
      ttl: Number(ttlInput.value),
      externalClock: true,
      coordinateMode: "random",
      metersPerPixel: METERS_PER_PIXEL,
      useLinkBudget: false,
      linkBudgetDb: null,
      frequencyMHz: RF_FIXED.frequencyMHz,
      pathLossExp: RF_FIXED.pathLossExp,
      txPower: RF_FIXED.txPower,
      txGain: RF_FIXED.txGain,
      rxGain: RF_FIXED.rxGain,
      noiseFloor: RF_FIXED.noiseFloor,
      ...getSelectedLoraParams(),
    },
  },
  [offscreen]
);
setMapToggleVisible(false);

worker.addEventListener("message", (event) => {
  const { type, payload } = event.data || {};
  if (type === "workerInitError") {
    console.error("Worker init error:", payload);
    if (footerEl) {
      footerEl.textContent = `Worker init error: ${payload?.message || "unknown"}`;
    }
    stopClock();
    return;
  }
  if (type === "suppressClickOnce") {
    suppressClick = true;
    return;
  }
  if (type === "nodeCount") {
    const count = payload && typeof payload.nodeCount === "number" ? payload.nodeCount : null;
    if (Number.isFinite(count) && count > 0) {
      const max = Number(nodeCountInput.max) || 0;
      if (count > max) {
        nodeCountInput.max = String(count);
      }
      nodeCountInput.value = String(Math.round(count));
    }
    return;
  }
  if (type === "export") {
    const json = JSON.stringify(payload, null, 2);
    const blob = new Blob([json], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = pendingExportName;
    document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();
    URL.revokeObjectURL(url);
    pendingExportName = "mesh-map.json";
  }
});

function startClock() {
  if (tickHandle !== null) {
    return;
  }
  const loop = (now) => {
    worker.postMessage({ type: "tick", payload: { now } });
    tickHandle = requestAnimationFrame(loop);
  };
  tickHandle = requestAnimationFrame(loop);
}

function stopClock() {
  if (tickHandle !== null) {
    cancelAnimationFrame(tickHandle);
    tickHandle = null;
  }
}

let pendingExportName = "mesh-map.json";

startClock();

let suppressClick = false;
let dragStart = null;

canvas.addEventListener("click", (event) => {
  if (suppressClick) {
    suppressClick = false;
    return;
  }
  const rect = canvas.getBoundingClientRect();
  worker.postMessage({
    type: "click",
    payload: {
      x: event.clientX - rect.left,
      y: event.clientY - rect.top,
      shiftKey: event.shiftKey,
    },
  });
});

let dragging = false;

canvas.addEventListener("pointerdown", (event) => {
  const rect = canvas.getBoundingClientRect();
  dragging = true;
  dragStart = { x: event.clientX - rect.left, y: event.clientY - rect.top };
  canvas.setPointerCapture(event.pointerId);
  worker.postMessage({
    type: "dragStart",
    payload: {
      x: dragStart.x,
      y: dragStart.y,
    },
  });
});

canvas.addEventListener("pointermove", (event) => {
  if (!dragging) {
    const rect = canvas.getBoundingClientRect();
    worker.postMessage({
      type: "hover",
      payload: {
        x: event.clientX - rect.left,
        y: event.clientY - rect.top,
      },
    });
    return;
  }
  const rect = canvas.getBoundingClientRect();
  const x = event.clientX - rect.left;
  const y = event.clientY - rect.top;
  if (dragStart) {
    const dx = x - dragStart.x;
    const dy = y - dragStart.y;
    if (dx * dx + dy * dy > 16) {
      suppressClick = true;
    }
  }
  worker.postMessage({
    type: "dragMove",
    payload: {
      x,
      y,
    },
  });
});

canvas.addEventListener("pointerleave", () => {
  worker.postMessage({ type: "hoverEnd" });
});

const endDrag = (event) => {
  if (!dragging) {
    return;
  }
  dragging = false;
  dragStart = null;
  canvas.releasePointerCapture(event.pointerId);
  worker.postMessage({ type: "dragEnd" });
};

canvas.addEventListener("pointerup", endDrag);
canvas.addEventListener("pointercancel", endDrag);

resetColorsButton.addEventListener("click", () => {
  worker.postMessage({ type: "resetColors" });
});

downloadButton.addEventListener("click", () => {
  pendingExportName = "mesh-map.json";
  worker.postMessage({ type: "export" });
});

loadButton.addEventListener("click", () => {
  loadFileInput.click();
});

if (saveButton) {
  saveButton.addEventListener("click", () => {
    pendingExportName = "mesh-state.json";
    worker.postMessage({ type: "export" });
  });
}

const waitForMapMove = () =>
  new Promise((resolve) => {
    if (!liveMap) {
      resolve();
      return;
    }
    let resolved = false;
    const finish = () => {
      if (resolved) {
        return;
      }
      resolved = true;
      liveMap.off("moveend", finish);
      resolve();
    };
    liveMap.once("moveend", finish);
    requestAnimationFrame(() => {
      if (!resolved) {
        finish();
      }
    });
  });

const deriveBbox = (nodes) => {
  if (!nodes || nodes.length === 0) {
    return null;
  }
  let minLat = Infinity;
  let maxLat = -Infinity;
  let minLon = Infinity;
  let maxLon = -Infinity;
  for (const node of nodes) {
    if (!Number.isFinite(node.lat) || !Number.isFinite(node.lon)) {
      continue;
    }
    minLat = Math.min(minLat, node.lat);
    maxLat = Math.max(maxLat, node.lat);
    minLon = Math.min(minLon, node.lon);
    maxLon = Math.max(maxLon, node.lon);
  }
  if (!Number.isFinite(minLat) || !Number.isFinite(minLon)) {
    return null;
  }
  return {
    min_lat: minLat,
    max_lat: maxLat,
    min_lon: minLon,
    max_lon: maxLon,
  };
};

const isValidBbox = (bbox) => {
  if (!bbox) {
    return false;
  }
  return (
    Number.isFinite(bbox.min_lat) &&
    Number.isFinite(bbox.max_lat) &&
    Number.isFinite(bbox.min_lon) &&
    Number.isFinite(bbox.max_lon) &&
    bbox.min_lat !== bbox.max_lat &&
    bbox.min_lon !== bbox.max_lon
  );
};

const ensureLiveMap = (bbox) => {
  if (!mapContainer || !window.L) {
    return;
  }
  if (!liveMap) {
    liveMap = window.L.map("map", {
      zoomControl: true,
      attributionControl: true,
      dragging: true,
      scrollWheelZoom: true,
      doubleClickZoom: true,
      boxZoom: true,
      keyboard: true,
      tap: true,
      touchZoom: true,
    });
    window._leaflet_map = liveMap;
    liveMap.on("move", scheduleLiveNodeUpdate);
    liveMap.on("zoom", scheduleLiveNodeUpdate);
    liveTileLayer = window.L.tileLayer(
      "https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png",
      {
        attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OSM</a> contributors &copy; <a href="https://carto.com/attributions">CARTO</a>',
        maxZoom: 20,
        noWrap: true,
      }
    );
    liveTileLayer.addTo(liveMap);
    setMapInteraction(mapInteractionEnabled);
  }

  if (bbox) {
    const bounds = window.L.latLngBounds(
      [bbox.min_lat, bbox.min_lon],
      [bbox.max_lat, bbox.max_lon]
    );
    liveMap.invalidateSize();
    liveMap.fitBounds(bounds, { padding: [0, 0], animate: false });
    liveBaseZoom = liveMap.getZoom();
    liveMap.setMaxBounds(undefined);
    liveMinZoom = liveMap.getBoundsZoom(bounds);
    liveMap.setMinZoom(liveMinZoom);
    liveMapReady = true;
  }

  if (canvasSection && !canvasSection.classList.contains("app__canvas--live")) {
    canvasSection.classList.add("app__canvas--live");
  }
};

const projectLiveNodes = async (nodes, bbox) => {
  if (!nodes || nodes.length === 0 || !bbox) {
    return null;
  }
  if (!liveMap) {
    return null;
  }
  await waitForMapMove();
  return nodes.map((node) => {
    const point = liveMap.latLngToContainerPoint([node.lat, node.lon]);
    return {
      node_id: node.node_id,
      x: point.x,
      y: point.y,
      pinned: false,
      elevation: node.elevation ?? null,
    };
  });
};

const fetchElevations = async (nodes) => {
  const response = await fetch("dem_elevation.php", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      nodes: nodes.map((node) => ({
        node_id: node.node_id,
        latitude: node.lat,
        longitude: node.lon,
      })),
    }),
  });
  if (!response.ok) {
    throw new Error(`Elevation request failed with ${response.status}`);
  }
  const data = await response.json();
  const entries = Array.isArray(data.nodes) ? data.nodes : [];
  const byId = new Map();
  for (const entry of entries) {
    if (entry && entry.node_id !== undefined) {
      byId.set(Number(entry.node_id), entry.elevation ?? null);
    }
  }
  return byId;
};

const scheduleLiveNodeUpdate = () => {
  if (mapUpdatePending || !liveMapReady || !liveDataNodes || !liveDataBbox) {
    return;
  }
  mapUpdatePending = true;
  requestAnimationFrame(() => {
    mapUpdatePending = false;
    if (liveMap && liveBaseZoom !== null) {
      const scale = liveMap.getZoomScale(liveMap.getZoom(), liveBaseZoom);
      worker.postMessage({
        type: "setParams",
        payload: {
          mapScale: scale,
        },
      });
    }
    projectLiveNodes(liveDataNodes, liveDataBbox).then((mappedNodes) => {
      if (!mappedNodes) {
        return;
      }
      worker.postMessage({
        type: "setNodePositions",
        payload: {
          nodes: mappedNodes,
        },
      });
      forceRender();
    });
  });
};

const loadLiveData = async () => {
  const originalLabel = loadLiveButton.textContent;
  const startLoading = (label) => {
    loadLiveButton.disabled = true;
    loadLiveButton.classList.add("is-loading");
    loadLiveButton.textContent = label;
  };
  const stopLoading = () => {
    loadLiveButton.disabled = false;
    loadLiveButton.classList.remove("is-loading");
    loadLiveButton.textContent = originalLabel;
  };
  const { width, height } = getCanvasMetrics();
  const url = new URL("node_positions_proxy.php", window.location.href);
  url.searchParams.set("width", String(width));
  url.searchParams.set("height", String(height));
  url.searchParams.set("limit", "100");

  try {
    startLoading("Loading Live Data...");
    const response = await fetch(url.toString(), { cache: "no-store" });
    if (!response.ok) {
      throw new Error(`Request failed with ${response.status}`);
    }
    const data = await response.json();
    const nodes = Array.isArray(data.nodes) ? data.nodes : [];
    if (nodes.length === 0) {
      return;
    }

    liveDataNodes = nodes.map((node) => ({
      node_id: Number(node.node_id),
      lat: Number(node.latitude),
      lon: Number(node.longitude),
      elevation: null,
    }));
    const serverBbox = data.bbox
      ? {
          min_lat: Number(data.bbox.min_lat),
          max_lat: Number(data.bbox.max_lat),
          min_lon: Number(data.bbox.min_lon),
          max_lon: Number(data.bbox.max_lon),
        }
      : null;
    const derivedBbox = deriveBbox(liveDataNodes);
    liveDataBbox = isValidBbox(serverBbox) ? serverBbox : derivedBbox;
    if (!isValidBbox(liveDataBbox)) {
      return;
    }

    startLoading("Rendering Nodes...");
    ensureLiveMap(liveDataBbox);

    if (liveMap && liveBaseZoom !== null) {
      const scale = liveMap.getZoomScale(liveMap.getZoom(), liveBaseZoom);
      sendParams({ coordinateMode: "live", mapScale: scale });
    } else {
      sendParams({ coordinateMode: "live" });
    }

    const mappedNodesInitial = await projectLiveNodes(liveDataNodes, liveDataBbox);
    if (!mappedNodesInitial) {
      return;
    }

    nodeCountInput.value = String(mappedNodesInitial.length);
    worker.postMessage({
      type: "import",
      payload: {
        range: Number(rangeInput.value),
        carrierSenseRange: Number(rangeInput.value),
        nodes: mappedNodesInitial,
      },
    });
    forceRender();
    setMapToggleVisible(true);

    startLoading("Loading Elevation...");
    try {
      const elevations = await fetchElevations(liveDataNodes);
      for (const node of liveDataNodes) {
        if (elevations.has(node.node_id)) {
          node.elevation = elevations.get(node.node_id);
        }
      }

      const mappedNodesWithElevations = await projectLiveNodes(
        liveDataNodes,
        liveDataBbox
      );
      if (mappedNodesWithElevations) {
        worker.postMessage({
          type: "setNodePositions",
          payload: {
            nodes: mappedNodesWithElevations,
          },
        });
        forceRender();
      }
    } catch (error) {
      console.error("Failed to load elevations.", error);
    } finally {
      stopLoading();
    }
  } catch (error) {
    console.error("Failed to load live data.", error);
  } finally {
    stopLoading();
  }
};

if (loadLiveButton) {
  loadLiveButton.addEventListener("click", loadLiveData);
}

loadFileInput.addEventListener("change", (event) => {
  const [file] = event.target.files;
  if (!file) {
    return;
  }
  const reader = new FileReader();
  reader.onload = () => {
    try {
      const data = JSON.parse(reader.result);
      const nodes = Array.isArray(data.nodes) ? data.nodes : [];
      const range = typeof data.range === "number" ? data.range : Number(rangeInput.value);
      const carrierSenseRange =
        typeof data.carrierSenseRange === "number"
          ? data.carrierSenseRange
          : range;
      if (nodes.length === 0) {
        return;
      }
      nodeCountInput.value = String(nodes.length);
      rangeInput.value = String(range);
      resetMapToggleState();
      sendParams({ coordinateMode: "random", mapScale: 1, nodeCount: nodes.length, range });
      worker.postMessage({
        type: "import",
        payload: {
          range,
          carrierSenseRange,
          nodes,
        },
      });
    } catch (error) {
      console.error("Invalid map file.", error);
    }
  };
  reader.readAsText(file);
  event.target.value = "";
});

nodeCountInput.addEventListener("input", () => {
  resetMapToggleState();
  sendParams({ coordinateMode: "random", mapScale: 1, nodeCount: Number(nodeCountInput.value) });
  worker.postMessage({ type: "reset" });
});

rangeInput.addEventListener("input", () => {
  sendParams({ range: Number(rangeInput.value) });
});

modPresetSelect.addEventListener("change", () => {
  const value = modPresetSelect.value;
  const preset = modulationPresets[value];
  const useLinkBudget = value !== "manual" && Boolean(preset);
  rangeInput.disabled = useLinkBudget;
  sendParams({
    useLinkBudget,
    linkBudgetDb: useLinkBudget && preset ? preset.linkBudgetDb : null,
  });
});

if (packetSizeInput) {
  packetSizeInput.addEventListener("input", () => {
    const normalized = clampPacketSizeBytes(packetSizeInput.value);
    if (String(normalized) !== packetSizeInput.value) {
      packetSizeInput.value = String(normalized);
    }
    sendParams();
  });
}

timeScaleInput.addEventListener("input", () => {
  sendParams({ timeScale: Number(timeScaleInput.value) });
});

ttlInput.addEventListener("input", () => {
  sendParams({ ttl: Number(ttlInput.value) });
});

window.addEventListener("keydown", (event) => {
  if (event.key.toLowerCase() !== "d") {
    return;
  }
  worker.postMessage({ type: "toggleDebug" });
});

window.addEventListener("resize", () => {
  const resized = getCanvasMetrics();
  worker.postMessage({ type: "resize", payload: resized });
  if (liveMap && liveMapReady) {
    liveMap.invalidateSize();
    if (liveDataNodes && liveDataBbox) {
      ensureLiveMap(liveDataBbox);
      scheduleLiveNodeUpdate();
    }
  }
});

mapToggleButton.addEventListener("click", () => {
  if (!canvasSection) {
    return;
  }
  mapInteractionEnabled = !mapInteractionEnabled;
  const isActive = canvasSection.classList.toggle("app__canvas--map-active");
  mapToggleButton.textContent = isActive ? "Node Interaction" : "Map Pan/Zoom";
  setMapInteraction(mapInteractionEnabled);
  if (liveMap) {
    liveMap.invalidateSize();
    scheduleLiveNodeUpdate();
  }
});
