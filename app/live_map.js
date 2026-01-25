export function createLiveMapController({
  mapContainer,
  canvasSection,
  canvasElement,
  mapToggleButton,
  loadLiveButton,
  nodeCountInput,
  rangeInput,
  getCanvasMetrics,
  workerPost,
  sendParams,
  forceRender,
}) {
  let liveMap = null;
  let liveTileLayer = null;
  let liveMapReady = false;
  let liveDataNodes = null;
  let liveDataBbox = null;
  let mapUpdatePending = false;
  let mapInteractionEnabled = false;
  let liveMinZoom = null;
  let liveBaseZoom = null;
  let liveBaseMetersPerPixel = null;

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
    return { min_lat: minLat, max_lat: maxLat, min_lon: minLon, max_lon: maxLon };
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
          attribution:
            '&copy; <a href="https://www.openstreetmap.org/copyright">OSM</a> contributors &copy; <a href="https://carto.com/attributions">CARTO</a>',
          maxZoom: 20,
          noWrap: true,
        }
      );
      liveTileLayer.addTo(liveMap);
      setMapInteraction(mapInteractionEnabled);
    }

    if (bbox) {
      const bounds = window.L.latLngBounds([bbox.min_lat, bbox.min_lon], [bbox.max_lat, bbox.max_lon]);
      liveMap.invalidateSize();
      liveMap.fitBounds(bounds, { padding: [0, 0], animate: false });
      liveBaseZoom = liveMap.getZoom();
      liveMap.setMaxBounds(undefined);
      liveMinZoom = liveMap.getBoundsZoom(bounds);
      liveMap.setMinZoom(liveMinZoom);
      liveMapReady = true;

      const size = liveMap.getSize();
      const y = Math.max(0, Math.min(size.y, Math.round(size.y / 2)));
      const ll0 = liveMap.containerPointToLatLng([0, y]);
      const ll1 = liveMap.containerPointToLatLng([1, y]);
      const metersPerPixel = liveMap.distance(ll0, ll1);
      liveBaseMetersPerPixel =
        Number.isFinite(metersPerPixel) && metersPerPixel > 0 ? metersPerPixel : null;
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
      headers: { "Content-Type": "application/json" },
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
        workerPost("setParams", { mapScale: scale });
      }
      projectLiveNodes(liveDataNodes, liveDataBbox).then((mappedNodes) => {
        if (!mappedNodes) {
          return;
        }
        workerPost("setNodePositions", { nodes: mappedNodes });
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
        sendParams({
          coordinateMode: "live",
          mapScale: scale,
          metersPerPixel: liveBaseMetersPerPixel ?? undefined,
        });
      } else {
        sendParams({
          coordinateMode: "live",
          metersPerPixel: liveBaseMetersPerPixel ?? undefined,
        });
      }

      const mappedNodesInitial = await projectLiveNodes(liveDataNodes, liveDataBbox);
      if (!mappedNodesInitial) {
        return;
      }

      nodeCountInput.value = String(mappedNodesInitial.length);
      workerPost("import", {
        range: Number(rangeInput.value),
        carrierSenseRange: Number(rangeInput.value),
        nodes: mappedNodesInitial,
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

        const mappedNodesWithElevations = await projectLiveNodes(liveDataNodes, liveDataBbox);
        if (mappedNodesWithElevations) {
          workerPost("setNodePositions", { nodes: mappedNodesWithElevations });
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

  const onResize = () => {
    if (liveMap && liveMapReady) {
      liveMap.invalidateSize();
      if (liveDataNodes && liveDataBbox) {
        ensureLiveMap(liveDataBbox);
        scheduleLiveNodeUpdate();
      }
    }
  };

  const bind = () => {
    resetMapToggleState();
    if (loadLiveButton) {
      loadLiveButton.addEventListener("click", loadLiveData);
    }
    if (mapToggleButton) {
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
    }
  };

  return {
    bind,
    onResize,
    resetMapToggleState,
    setMapToggleVisible,
  };
}
