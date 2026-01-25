export function createWorkerBridge({ withVersion, canvas, footerEl }) {
  const worker = new Worker(withVersion("../worker.js"), { type: "module" });
  const offscreen = canvas.transferControlToOffscreen();

  let tickHandle = null;
  let suppressClick = false;
  let dragging = false;
  let dragStart = null;
  let dragPointerId = null;

  const post = (type, payload, transfer) => {
    if (transfer) {
      worker.postMessage({ type, payload }, transfer);
      return;
    }
    worker.postMessage({ type, payload });
  };

  const init = (payload) => {
    post("init", { ...payload, canvas: offscreen }, [offscreen]);
  };

  const forceRender = () => post("tick", { now: performance.now() });

  const startClock = () => {
    if (tickHandle !== null) {
      return;
    }
    const loop = (now) => {
      post("tick", { now });
      tickHandle = requestAnimationFrame(loop);
    };
    tickHandle = requestAnimationFrame(loop);
  };

  const stopClock = () => {
    if (tickHandle !== null) {
      cancelAnimationFrame(tickHandle);
      tickHandle = null;
    }
  };

  const bindCanvasHandlers = () => {
    canvas.addEventListener("click", (event) => {
      if (suppressClick) {
        suppressClick = false;
        return;
      }
      const rect = canvas.getBoundingClientRect();
      post("click", {
        x: event.clientX - rect.left,
        y: event.clientY - rect.top,
        shiftKey: event.shiftKey,
        altKey: event.altKey,
        ctrlKey: event.ctrlKey,
        metaKey: event.metaKey,
      });
    });

    canvas.addEventListener("contextmenu", (event) => {
      event.preventDefault();
      cancelDrag();
      const rect = canvas.getBoundingClientRect();
      post("editHeightAt", {
        x: event.clientX - rect.left,
        y: event.clientY - rect.top,
      });
    });

    canvas.addEventListener("pointerdown", (event) => {
      const rect = canvas.getBoundingClientRect();
      dragging = true;
      dragPointerId = event.pointerId;
      dragStart = { x: event.clientX - rect.left, y: event.clientY - rect.top };
      canvas.setPointerCapture(event.pointerId);
      post("dragStart", { x: dragStart.x, y: dragStart.y });
    });

    canvas.addEventListener("pointermove", (event) => {
      const rect = canvas.getBoundingClientRect();
      const x = event.clientX - rect.left;
      const y = event.clientY - rect.top;

      if (!dragging) {
        post("hover", { x, y });
        return;
      }

      if (dragStart) {
        const dx = x - dragStart.x;
        const dy = y - dragStart.y;
        if (dx * dx + dy * dy > 16) {
          suppressClick = true;
        }
      }
      post("dragMove", { x, y });
    });

    canvas.addEventListener("pointerleave", () => {
      post("hoverEnd");
    });

    const endDrag = (event) => {
      if (!dragging) {
        return;
      }
      dragging = false;
      dragStart = null;
      if (dragPointerId !== null) {
        try {
          canvas.releasePointerCapture(dragPointerId);
        } catch {
          // Ignore (pointer already released).
        }
      }
      dragPointerId = null;
      post("dragEnd");
    };

    canvas.addEventListener("pointerup", endDrag);
    canvas.addEventListener("pointercancel", endDrag);
  };

  const setSuppressClickOnce = () => {
    suppressClick = true;
  };

  const cancelDrag = () => {
    if (!dragging) {
      return;
    }
    dragging = false;
    dragStart = null;
    if (dragPointerId !== null) {
      try {
        canvas.releasePointerCapture(dragPointerId);
      } catch {
        // Ignore (pointer already released).
      }
    }
    dragPointerId = null;
    suppressClick = true;
    post("dragEnd");
  };

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

  return {
    worker,
    post,
    init,
    forceRender,
    startClock,
    stopClock,
    bindCanvasHandlers,
    setSuppressClickOnce,
    cancelDrag,
  };
}
