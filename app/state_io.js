export function initStateIO({
  downloadButton,
  loadButton,
  saveButton,
  loadFileInput,
  nodeCountInput,
  rangeInput,
  workerPost,
  resetMapToggleState,
  sendParams,
}) {
  let pendingExportName = "mesh-map.json";

  const handleExport = (payload) => {
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
  };

  if (downloadButton) {
    downloadButton.addEventListener("click", () => {
      pendingExportName = "mesh-map.json";
      workerPost("export");
    });
  }

  loadButton.addEventListener("click", () => {
    loadFileInput.click();
  });

  if (saveButton) {
    saveButton.addEventListener("click", () => {
      pendingExportName = "mesh-state.json";
      workerPost("export");
    });
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
          typeof data.carrierSenseRange === "number" ? data.carrierSenseRange : range;
        if (nodes.length === 0) {
          return;
        }
        nodeCountInput.value = String(nodes.length);
        rangeInput.value = String(range);
        resetMapToggleState();
        sendParams({ coordinateMode: "random", mapScale: 1, nodeCount: nodes.length, range });
        workerPost("import", {
          range,
          carrierSenseRange,
          nodes,
        });
      } catch (error) {
        console.error("Invalid map file.", error);
      }
    };
    reader.readAsText(file);
    event.target.value = "";
  });

  return { handleExport };
}
