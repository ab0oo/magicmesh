const canvas = document.getElementById("sim");
const footerEl = document.querySelector(".app__footer");
const resetColorsButton = document.getElementById("resetColors");
const helpButton = document.getElementById("helpButton");
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

const FALLBACK_VERSION = "0.2.0";
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
  const nodeHeightDialog = document.getElementById("nodeHeightDialog");
  const nodeHeightInput = document.getElementById("nodeHeightInput");
  const nodeHeightTitle = document.getElementById("nodeHeightTitle");
  let pendingHeightEdit = null;
  const helpDialog = document.getElementById("helpDialog");

  const inspector = document.getElementById("nodeInspector");
  const inspectorTitle = document.getElementById("inspectorTitle");
  const inspectorClose = document.getElementById("inspectorClose");
  const inspectorHeight = document.getElementById("inspectorHeight");
  const inspectorTxPower = document.getElementById("inspectorTxPower");
  const inspectorRange = document.getElementById("inspectorRange");
  const inspectorLosLimit = document.getElementById("inspectorLosLimit");

  let inspectedNode = null;
  let previewTimer = null;

  const formatMeters = (meters) => {
    const m = Number(meters);
    if (!Number.isFinite(m) || m < 0) {
      return "—";
    }
    if (m >= 1000) {
      const km = m / 1000;
      return `${km >= 10 ? km.toFixed(1) : km.toFixed(2)} km`;
    }
    return `${Math.round(m)} m`;
  };

  const setInspectorVisible = (visible) => {
    if (!(inspector instanceof HTMLElement)) {
      return;
    }
    inspector.hidden = !visible;
  };

  const openNodeHeightDialog = ({ id, nodeId, heightM }) => {
    if (
      !(nodeHeightDialog instanceof HTMLDialogElement) ||
      typeof nodeHeightDialog.showModal !== "function"
    ) {
      return false;
    }
    if (!(nodeHeightInput instanceof HTMLInputElement)) {
      return false;
    }
    pendingHeightEdit = { id };
    nodeHeightDialog.returnValue = "cancel";
    const label = `Set Node ${Number.isFinite(nodeId) ? nodeId : id} height`;
    if (nodeHeightTitle instanceof HTMLElement) {
      nodeHeightTitle.textContent = label;
    } else {
      nodeHeightDialog.setAttribute("aria-label", label);
    }
    nodeHeightInput.value = Number.isFinite(heightM) ? String(heightM) : "2";
    nodeHeightDialog.showModal();
    queueMicrotask(() => nodeHeightInput.focus());
    return true;
  };

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

  const schedulePreview = () => {
    if (!inspectedNode) {
      return;
    }
    if (previewTimer !== null) {
      window.clearTimeout(previewTimer);
    }
    previewTimer = window.setTimeout(() => {
      previewTimer = null;
      const heightM =
        inspectorHeight instanceof HTMLInputElement ? Number(inspectorHeight.value) : null;
      const txPowerDbm =
        inspectorTxPower instanceof HTMLInputElement ? Number(inspectorTxPower.value) : null;
      workerBridge.post("previewNodeRadio", {
        id: inspectedNode.id,
        heightM: Number.isFinite(heightM) ? heightM : undefined,
        txPowerDbm: Number.isFinite(txPowerDbm) ? txPowerDbm : undefined,
      });
    }, 60);
  };

  const openInspector = ({ id, nodeId, heightM, txPowerDbm }) => {
    if (
      !(inspector instanceof HTMLElement) ||
      !(inspectorHeight instanceof HTMLInputElement) ||
      !(inspectorTxPower instanceof HTMLInputElement)
    ) {
      return false;
    }
    inspectedNode = { id };
    if (inspectorTitle instanceof HTMLElement) {
      inspectorTitle.textContent = `Node ${Number.isFinite(nodeId) ? nodeId : id}`;
    }
    inspectorHeight.value = Number.isFinite(heightM) ? String(heightM) : "2";
    inspectorTxPower.value = Number.isFinite(txPowerDbm) ? String(txPowerDbm) : "24";
    if (inspectorRange instanceof HTMLElement) {
      inspectorRange.textContent = "—";
    }
    if (inspectorLosLimit instanceof HTMLElement) {
      inspectorLosLimit.textContent = "—";
    }
    setInspectorVisible(true);
    schedulePreview();
    return true;
  };

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
    schedulePreview();
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

  const initialPreset = rfControls.modulationPresets[modPresetSelect.value] || null;
  const initialUseLinkBudget = modPresetSelect.value !== "manual" && Boolean(initialPreset);
  rangeInput.disabled = initialUseLinkBudget;

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
    useLinkBudget: initialUseLinkBudget,
    linkBudgetDb: initialUseLinkBudget && initialPreset ? initialPreset.linkBudgetDb : null,
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
      const txPowerDbm =
        payload && typeof payload.txPowerDbm === "number" ? payload.txPowerDbm : 24;
      if (id === null) {
        return;
      }
      if (openInspector({ id, nodeId, heightM: current, txPowerDbm })) {
        return;
      }
      if (openNodeHeightDialog({ id, nodeId, heightM: current })) {
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
    if (type === "nodeRadioPreview") {
      const id = payload && typeof payload.id === "number" ? payload.id : null;
      if (!inspectedNode || id === null || id !== inspectedNode.id) {
        return;
      }
      if (inspectorRange instanceof HTMLElement) {
        inspectorRange.textContent = formatMeters(payload.rangeMeters);
      }
      if (inspectorLosLimit instanceof HTMLElement) {
        inspectorLosLimit.textContent = formatMeters(payload.losLimitMeters);
      }
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

  if (inspectorClose instanceof HTMLElement) {
    inspectorClose.addEventListener("click", () => {
      inspectedNode = null;
      setInspectorVisible(false);
    });
  }

  if (inspector instanceof HTMLElement) {
    const inspectorHeader =
      typeof inspector.querySelector === "function" ? inspector.querySelector(".inspector__header") : null;
    let dragState = null;

    const endDrag = () => {
      if (!dragState) {
        return;
      }
      try {
        inspector.releasePointerCapture(dragState.pointerId);
      } catch {
        // Ignore (pointer already released).
      }
      dragState = null;
      inspector.classList.remove("is-dragging");
    };

    if (inspectorHeader instanceof HTMLElement) {
      inspectorHeader.addEventListener("pointerdown", (event) => {
        if (event.button !== 0) {
          return;
        }
        if (event.target && event.target.closest && event.target.closest("#inspectorClose")) {
          return;
        }
        const stage = inspector.parentElement;
        if (!(stage instanceof HTMLElement)) {
          return;
        }
        const stageRect = stage.getBoundingClientRect();
        const rect = inspector.getBoundingClientRect();
        const startLeft = rect.left - stageRect.left;
        const startTop = rect.top - stageRect.top;

        inspector.style.left = `${startLeft}px`;
        inspector.style.top = `${startTop}px`;
        inspector.style.right = "auto";
        inspector.style.bottom = "auto";

        inspector.classList.add("is-dragging");
        dragState = {
          pointerId: event.pointerId,
          startX: event.clientX,
          startY: event.clientY,
          startLeft,
          startTop,
        };
        inspector.setPointerCapture(event.pointerId);
      });
    }

    inspector.addEventListener("pointermove", (event) => {
      if (!dragState || event.pointerId !== dragState.pointerId) {
        return;
      }
      const stage = inspector.parentElement;
      if (!(stage instanceof HTMLElement)) {
        return;
      }
      const stageRect = stage.getBoundingClientRect();
      const maxLeft = Math.max(8, stageRect.width - inspector.offsetWidth - 8);
      const maxTop = Math.max(8, stageRect.height - inspector.offsetHeight - 8);
      const dx = event.clientX - dragState.startX;
      const dy = event.clientY - dragState.startY;
      const nextLeft = Math.max(8, Math.min(maxLeft, dragState.startLeft + dx));
      const nextTop = Math.max(8, Math.min(maxTop, dragState.startTop + dy));
      inspector.style.left = `${nextLeft}px`;
      inspector.style.top = `${nextTop}px`;
    });

    inspector.addEventListener("pointerup", (event) => {
      if (dragState && event.pointerId === dragState.pointerId) {
        endDrag();
      }
    });

    inspector.addEventListener("pointercancel", (event) => {
      if (dragState && event.pointerId === dragState.pointerId) {
        endDrag();
      }
    });
  }

  const bindInspectorField = (field, { onCommit }) => {
    if (!(field instanceof HTMLInputElement)) {
      return;
    }
    field.addEventListener("input", () => {
      schedulePreview();
    });
    field.addEventListener("change", () => {
      if (!inspectedNode) {
        return;
      }
      const parsed = Number(field.value);
      if (!Number.isFinite(parsed) || parsed < 0) {
        return;
      }
      onCommit(parsed);
      schedulePreview();
    });
  };

  bindInspectorField(inspectorHeight, {
    onCommit: (heightM) => {
      if (!inspectedNode) {
        return;
      }
      workerBridge.post("setNodeHeight", { id: inspectedNode.id, heightM });
    },
  });

  bindInspectorField(inspectorTxPower, {
    onCommit: (txPowerDbm) => {
      if (!inspectedNode) {
        return;
      }
      workerBridge.post("setNodeTxPower", { id: inspectedNode.id, txPowerDbm });
    },
  });

  if (helpButton && helpDialog instanceof HTMLDialogElement) {
    helpButton.addEventListener("click", () => {
      if (typeof helpDialog.showModal === "function") {
        helpDialog.showModal();
      }
    });

    helpDialog.addEventListener("click", (event) => {
      if (event.target === helpDialog) {
        helpDialog.close("cancel");
      }
    });
  }

  if (nodeHeightDialog instanceof HTMLDialogElement) {
    const dialogForm =
      typeof nodeHeightDialog.querySelector === "function" ? nodeHeightDialog.querySelector("form") : null;
    if (dialogForm instanceof HTMLFormElement) {
      dialogForm.addEventListener("submit", (event) => {
        const submitterValue = event.submitter ? event.submitter.value : "";
        if (submitterValue !== "save") {
          return;
        }
        if (!(nodeHeightInput instanceof HTMLInputElement)) {
          return;
        }
        if (!nodeHeightInput.checkValidity()) {
          event.preventDefault();
          nodeHeightInput.reportValidity();
        }
      });
    }

    nodeHeightDialog.addEventListener("close", () => {
      if (nodeHeightDialog.returnValue !== "save") {
        pendingHeightEdit = null;
        return;
      }
      if (!(nodeHeightInput instanceof HTMLInputElement)) {
        pendingHeightEdit = null;
        return;
      }
      const parsed = Number(nodeHeightInput.value);
      if (!Number.isFinite(parsed) || parsed < 0) {
        pendingHeightEdit = null;
        return;
      }
      if (pendingHeightEdit && typeof pendingHeightEdit.id === "number") {
        workerBridge.post("setNodeHeight", { id: pendingHeightEdit.id, heightM: parsed });
      }
      pendingHeightEdit = null;
    });

    nodeHeightDialog.addEventListener("click", (event) => {
      if (event.target === nodeHeightDialog) {
        nodeHeightDialog.close("cancel");
      }
    });
  }
});
