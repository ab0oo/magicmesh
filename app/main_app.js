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

const FALLBACK_VERSION = "0.1.21";
const APP_VERSION =
  new URL(import.meta.url).searchParams.get("v") || window.APP_VERSION || FALLBACK_VERSION;

const withVersion = (relativePath) => {
  const url = new URL(relativePath, import.meta.url);
  if (APP_VERSION) {
    url.searchParams.set("v", APP_VERSION);
  }
  return url.href;
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

Promise.all([
  import(withVersion("./controls.js")),
  import(withVersion("./worker_bridge.js")),
  import(withVersion("./state_io.js")),
  import(withVersion("./live_map.js")),
]).then(([controlsMod, workerBridgeMod, stateIoMod, liveMapMod]) => {
  const rfControls = controlsMod.createRfControls({
    withVersion,
    rangeInput,
    modPresetSelect,
    packetSizeInput,
    toaValueEl: document.getElementById("toaValue"),
  });
  rfControls.initAirtime();

  const METERS_PER_PIXEL = rfControls.computeMetersPerPixel();

  const workerBridge = workerBridgeMod.createWorkerBridge({ withVersion, canvas, footerEl });
  workerBridge.bindCanvasHandlers();

  const sendParams = (overrides = {}) => {
    workerBridge.post("setParams", {
      nodeCount: Number(nodeCountInput.value),
      range: Number(rangeInput.value),
      timeScale: Number(timeScaleInput.value),
      ttl: Number(ttlInput.value),
      frequencyMHz: rfControls.RF_FIXED.frequencyMHz,
      pathLossExp: rfControls.RF_FIXED.pathLossExp,
      txPower: rfControls.RF_FIXED.txPower,
      txGain: rfControls.RF_FIXED.txGain,
      rxGain: rfControls.RF_FIXED.rxGain,
      noiseFloor: rfControls.RF_FIXED.noiseFloor,
      ...rfControls.getSelectedLoraParams(),
      ...overrides,
    });
    rfControls.updateOnAirDisplay();
  };

  const liveMap = liveMapMod.createLiveMapController({
    mapContainer,
    canvasSection,
    canvasElement,
    mapToggleButton,
    loadLiveButton,
    nodeCountInput,
    rangeInput,
    getCanvasMetrics,
    workerPost: workerBridge.post,
    sendParams,
    forceRender: workerBridge.forceRender,
  });
  liveMap.bind();

  const stateIO = stateIoMod.initStateIO({
    downloadButton,
    loadButton,
    saveButton,
    loadFileInput,
    nodeCountInput,
    rangeInput,
    workerPost: workerBridge.post,
    resetMapToggleState: liveMap.resetMapToggleState,
    sendParams,
  });

  controlsMod.bindControls({
    nodeCountInput,
    rangeInput,
    timeScaleInput,
    ttlInput,
    modPresetSelect,
    packetSizeInput,
    resetMapToggleState: liveMap.resetMapToggleState,
    sendParams,
    workerPost: workerBridge.post,
    modulationPresets: rfControls.modulationPresets,
    clampPacketSizeBytes: rfControls.clampPacketSizeBytes,
  });

  resetColorsButton.addEventListener("click", () => {
    workerBridge.post("resetColors");
  });

  const metrics = getCanvasMetrics();
  workerBridge.init({
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
    frequencyMHz: rfControls.RF_FIXED.frequencyMHz,
    pathLossExp: rfControls.RF_FIXED.pathLossExp,
    txPower: rfControls.RF_FIXED.txPower,
    txGain: rfControls.RF_FIXED.txGain,
    rxGain: rfControls.RF_FIXED.rxGain,
    noiseFloor: rfControls.RF_FIXED.noiseFloor,
    ...rfControls.getSelectedLoraParams(),
  });

  workerBridge.post("setParams", { mapScale: 1 });
  liveMap.setMapToggleVisible(false);
  workerBridge.startClock();

  workerBridge.worker.addEventListener("message", (event) => {
    const { type, payload } = event.data || {};
    if (type === "workerInitError") {
      console.error("Worker init error:", payload);
      if (footerEl) {
        footerEl.textContent = `Worker init error: ${payload?.message || "unknown"}`;
      }
      workerBridge.stopClock();
      return;
    }
    if (type === "suppressClickOnce") {
      workerBridge.setSuppressClickOnce();
      return;
    }
    if (type === "editNodeHeight") {
      workerBridge.cancelDrag();
      const id = payload && typeof payload.id === "number" ? payload.id : null;
      const nodeId = payload && typeof payload.nodeId === "number" ? payload.nodeId : id;
      const current = payload && typeof payload.heightM === "number" ? payload.heightM : 2;
      if (id === null) {
        return;
      }
      const value = window.prompt(
        `Set Node ${nodeId} height (meters AGL):`,
        Number.isFinite(current) ? String(current) : "2"
      );
      if (value === null) {
        return;
      }
      const parsed = Number(value);
      if (!Number.isFinite(parsed) || parsed < 0) {
        window.alert("Height must be a non-negative number.");
        return;
      }
      workerBridge.post("setNodeHeight", { id, heightM: parsed });
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
      stateIO.handleExport(payload);
    }
  });

  window.addEventListener("resize", () => {
    const resized = getCanvasMetrics();
    workerBridge.post("resize", resized);
    liveMap.onResize();
  });
});
