const canvas = document.getElementById("sim");
const resetButton = document.getElementById("reset");
const pauseButton = document.getElementById("pause");
const nodeCountInput = document.getElementById("nodeCount");
const rangeInput = document.getElementById("range");
const timeScaleInput = document.getElementById("timeScale");
const ttlInput = document.getElementById("ttl");

if (!canvas.transferControlToOffscreen) {
  console.error("OffscreenCanvas not supported in this browser.");
}

const worker = new Worker("./worker.js", { type: "module" });
const offscreen = canvas.transferControlToOffscreen();
let tickHandle = null;

function getCanvasMetrics() {
  const rect = canvas.getBoundingClientRect();
  const dpr = window.devicePixelRatio || 1;
  return {
    width: rect.width,
    height: rect.height,
    dpr,
  };
}

function sendParams(overrides = {}) {
  worker.postMessage({
    type: "setParams",
    payload: {
      nodeCount: Number(nodeCountInput.value),
      range: Number(rangeInput.value),
      timeScale: Number(timeScaleInput.value),
      ttl: Number(ttlInput.value),
      ...overrides,
    },
  });
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
    },
  },
  [offscreen]
);

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

resetButton.addEventListener("click", () => {
  worker.postMessage({ type: "reset" });
});

pauseButton.addEventListener("click", () => {
  const paused = pauseButton.textContent === "Pause";
  pauseButton.textContent = paused ? "Resume" : "Pause";
  worker.postMessage({ type: "pause", payload: { paused } });
  if (paused) {
    stopClock();
  } else {
    startClock();
  }
});

nodeCountInput.addEventListener("input", () => {
  sendParams({ nodeCount: Number(nodeCountInput.value) });
  worker.postMessage({ type: "reset" });
});

rangeInput.addEventListener("input", () => {
  sendParams({ range: Number(rangeInput.value) });
});

timeScaleInput.addEventListener("input", () => {
  sendParams({ timeScale: Number(timeScaleInput.value) });
});

ttlInput.addEventListener("input", () => {
  sendParams({ ttl: Number(ttlInput.value) });
});

window.addEventListener("resize", () => {
  const resized = getCanvasMetrics();
  worker.postMessage({ type: "resize", payload: resized });
});
