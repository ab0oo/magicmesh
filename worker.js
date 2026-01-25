let canvas;
let ctx;

const scheduleFrame = self.requestAnimationFrame
  ? (cb) => self.requestAnimationFrame(cb)
  : (cb) => setTimeout(() => cb(performance.now()), 16);

let useExternalClock = false;

const version = new URL(import.meta.url).searchParams.get("v") || "";
const withVersion = (relativePath) => {
  const url = new URL(relativePath, import.meta.url);
  if (version) {
    url.searchParams.set("v", version);
  }
  return url.href;
};

let handleMessageData = null;
const pendingMessages = [];

self.onmessage = (event) => {
  const data = event.data;
  if (typeof handleMessageData !== "function") {
    pendingMessages.push(data);
    return;
  }
  handleMessageData(data);
};

Promise.all([
  import(withVersion("./worker/util.js")),
  import(withVersion("./worker/state.js")),
  import(withVersion("./worker/quadtree.js")),
  import(withVersion("./worker/glyphs.js")),
  import(withVersion("./worker/radio.js")),
  import(withVersion("./worker/terrain.js")),
  import(withVersion("./worker/palette.js")),
  import(withVersion("./worker/sim.js")),
  import(withVersion("./worker/render.js")),
  import(withVersion("./worker/canvas.js")),
  import(withVersion("./lora_airtime.js")),
])
  .then(
    ([
      utilMod,
      stateMod,
      quadtreeMod,
      glyphsMod,
      radioMod,
      terrainMod,
      paletteMod,
      simMod,
      renderMod,
      canvasMod,
      loraMod,
    ]) => {
      const state = stateMod.createInitialState();
      const { palette, defaultNodeColor } = stateMod;
      const { randomRange, clamp, randomIntInclusive, getDrawScale, formatDistance, chooseNiceScaleMeters } =
        utilMod;

      const glyphs = glyphsMod.createGlyphs();

      const radio = radioMod.createRadio({
        clamp,
        randomRange,
        randomIntInclusive,
      });

      const loraFns = {
        loraTimeOnAirMs: loraMod.loraTimeOnAirMs,
        loraSymbolTimeMs: loraMod.loraSymbolTimeMs,
      };

      const terrain = terrainMod.createTerrain({ clamp });

      const paletteUi = paletteMod.createPalette({
        clamp,
        getDrawScale,
        pathNodeGlyph: glyphs.pathNodeGlyph,
      });

      const sim = simMod.createSim({
        Quadtree: quadtreeMod.Quadtree,
        clamp,
        randomRange,
        defaultNodeColor,
        palette,
        updateEffectiveRange: radio.updateEffectiveRange,
        estimateCwSizeFromSnr: radio.estimateCwSizeFromSnr,
        estimateRxSnr: radio.estimateRxSnr,
        computeRebroadcastDelayMsec: radio.computeRebroadcastDelayMsec,
        hasLineOfSightCurvature: radio.hasLineOfSightCurvature,
        sampleTerrainElevation: terrain.sampleTerrainElevation,
        applyTerrainToNode: terrain.applyTerrainToNode,
      });

      const renderer = renderMod.createRenderer({
        clamp,
        getDrawScale,
        formatDistance,
        chooseNiceScaleMeters,
        defaultNodeColor,
        pathNodeGlyph: glyphs.pathNodeGlyph,
        drawNodePalette: paletteUi.drawNodePalette,
      });

      function updateEffectiveRangeAndTiming() {
        radio.updateEffectiveRange(state);
        radio.updateRadioTiming(state, loraFns);
      }

      function tick(now) {
        const deltaReal = now - state.lastTime;
        state.lastTime = now;
        const delta = state.paused ? 0 : deltaReal * state.timeScale;
        if (!state.paused) {
          state.simTime += delta;
        }
        const simNow = state.simTime;

        if (!state.paused && state.dynamic) {
          sim.updateNodes(state, delta);
        }

        const neighbors = sim.computeNeighbors(state);

        if (!state.paused) {
          sim.updateMessages(state, neighbors.neighbors, simNow);
          sim.updatePulses(state, delta);
        }

        renderer.draw(state, ctx, neighbors);
        if (!useExternalClock) {
          scheduleFrame(tick);
        }
      }

      handleMessageData = (data) => {
        const { type, payload } = data;

        if (type === "init") {
          canvas = payload.canvas;
          ctx = canvas.getContext("2d");
          useExternalClock = Boolean(payload.externalClock);

          state.nodeCount = payload.nodeCount;
          state.range = payload.range;
          state.ttl = payload.ttl;
          state.timeScale = payload.timeScale ?? state.timeScale;
          state.carrierSenseRange = payload.range;
          state.useLinkBudget = Boolean(payload.useLinkBudget);
          state.linkBudgetDb =
            typeof payload.linkBudgetDb === "number" ? payload.linkBudgetDb : null;
          state.frequencyMHz =
            typeof payload.frequencyMHz === "number"
              ? payload.frequencyMHz
              : state.frequencyMHz;
          state.pathLossExp =
            typeof payload.pathLossExp === "number" ? payload.pathLossExp : state.pathLossExp;
          state.mapScale = typeof payload.mapScale === "number" ? payload.mapScale : state.mapScale;
          state.coordinateMode = payload.coordinateMode === "live" ? "live" : "random";
          state.metersPerPixel =
            typeof payload.metersPerPixel === "number" && payload.metersPerPixel > 0
              ? payload.metersPerPixel
              : state.metersPerPixel;
          state.txPower = typeof payload.txPower === "number" ? payload.txPower : state.txPower;
          state.txGain = typeof payload.txGain === "number" ? payload.txGain : state.txGain;
          state.rxGain = typeof payload.rxGain === "number" ? payload.rxGain : state.rxGain;
          state.noiseFloor =
            typeof payload.noiseFloor === "number" ? payload.noiseFloor : state.noiseFloor;

          if (payload.loraPayloadBytes !== undefined) {
            state.loraPayloadBytes = payload.loraPayloadBytes;
          }
          if (payload.loraSpreadingFactor !== undefined) {
            state.loraSpreadingFactor = payload.loraSpreadingFactor;
          }
          if (payload.loraBandwidthHz !== undefined) {
            state.loraBandwidthHz = payload.loraBandwidthHz;
          }
          if (payload.loraCodingRate !== undefined) {
            state.loraCodingRate = payload.loraCodingRate;
          }
          if (payload.loraPreambleSymbols !== undefined) {
            state.loraPreambleSymbols = payload.loraPreambleSymbols;
          }
          if (payload.loraExplicitHeader !== undefined) {
            state.loraExplicitHeader = Boolean(payload.loraExplicitHeader);
          }
          if (payload.loraCrcEnabled !== undefined) {
            state.loraCrcEnabled = Boolean(payload.loraCrcEnabled);
          }
          if (payload.loraLowDataRateOptimize !== undefined) {
            state.loraLowDataRateOptimize = Boolean(payload.loraLowDataRateOptimize);
          }

          updateEffectiveRangeAndTiming();
          canvasMod.resizeCanvas(state, canvas, ctx, payload.width, payload.height, payload.dpr);
          sim.resetSimulation(state);
          state.lastTime = performance.now();
          state.simTime = 0;
          if (!useExternalClock) {
            scheduleFrame(tick);
          }
          return;
        }

        if (type === "tick") {
          if (useExternalClock) {
            tick(payload.now);
          }
          return;
        }

        if (type === "resize") {
          const prevWidth = state.width;
          const prevHeight = state.height;
          canvasMod.resizeCanvas(state, canvas, ctx, payload.width, payload.height, payload.dpr);
          if (prevWidth > 0 && prevHeight > 0 && state.nodes.length > 0) {
            const scaleX = state.width / prevWidth;
            const scaleY = state.height / prevHeight;
            for (const node of state.nodes) {
              node.x *= scaleX;
              node.y *= scaleY;
            }
            for (const transmission of state.activeTransmissions) {
              transmission.x *= scaleX;
              transmission.y *= scaleY;
            }
          }
          return;
        }

        if (type === "pause") {
          state.paused = payload.paused;
          return;
        }

        if (type === "reset") {
          sim.resetSimulation(state);
          return;
        }

        if (type === "export") {
          self.postMessage({
            type: "export",
            payload: {
              saved_at: new Date().toISOString(),
              range: state.range,
              carrierSenseRange: state.carrierSenseRange,
              nodeCount: state.nodeCount,
              ttl: state.ttl,
              timeScale: state.timeScale,
              useLinkBudget: state.useLinkBudget,
              linkBudgetDb: state.linkBudgetDb,
              frequencyMHz: state.frequencyMHz,
              pathLossExp: state.pathLossExp,
              txPower: state.txPower,
              txGain: state.txGain,
              rxGain: state.rxGain,
              noiseFloor: state.noiseFloor,
              metersPerPixel: state.metersPerPixel,
              mapScale: state.mapScale,
              coordinateMode: state.coordinateMode,
              lora: {
                payloadBytes: state.loraPayloadBytes,
                spreadingFactor: state.loraSpreadingFactor,
                bandwidthHz: state.loraBandwidthHz,
                codingRate: state.loraCodingRate,
                preambleSymbols: state.loraPreambleSymbols,
                explicitHeader: state.loraExplicitHeader,
                crcEnabled: state.loraCrcEnabled,
                lowDataRateOptimize: state.loraLowDataRateOptimize,
                onAirTimeMs: state.onAirTime,
                slotTimeMsec: state.slotTimeMsec,
                cadTimeMsec: state.cadTimeMsec,
              },
              nodes: state.nodes.map((node) => ({
                id: node.id,
                node_id: node.nodeId,
                x: node.x,
                y: node.y,
                range: node.range ?? state.range,
                carrierSenseRange: node.carrierSenseRange ?? state.carrierSenseRange,
                pinned: node.pinned,
                role: node.role ?? "CLIENT",
                elevation: node.elevation,
                height_m:
                  typeof node.heightM === "number" ? node.heightM : state.defaultNodeHeightM ?? 2,
              })),
            },
          });
          return;
        }

        if (type === "import") {
          const imported = Array.isArray(payload.nodes) ? payload.nodes : [];
          if (imported.length === 0) {
            return;
          }
          state.range = typeof payload.range === "number" ? payload.range : state.range;
          state.carrierSenseRange =
            typeof payload.carrierSenseRange === "number"
              ? payload.carrierSenseRange
              : state.carrierSenseRange;
          state.nodeCount = imported.length;
          state.messages = [];
          state.nextMessageId = 1;
          state.activeTransmissions = [];
          state.lastTransmissionCount = 0;
          state.lastMessageId = 0;
          state.nodes = imported.map((node, index) => ({
            id: index,
            nodeId: typeof node.node_id === "number" ? node.node_id : index,
            x: node.x,
            y: node.y,
            vx: randomRange(-0.4, 0.4),
            vy: randomRange(-0.4, 0.4),
            pinned: Boolean(node.pinned),
            terrainDriven: typeof node.elevation !== "number",
            role: node.role === "ROUTER" || node.role === "CLIENT_MUTE" ? node.role : "CLIENT",
            pendingTransmits: new Map(),
            received: new Set(),
            pulses: [],
            collisionUntil: 0,
            range:
              typeof node.range === "number"
                ? node.range
                : typeof payload.range === "number"
                  ? payload.range
                  : state.range,
            carrierSenseRange:
              typeof node.carrierSenseRange === "number"
                ? node.carrierSenseRange
                : typeof payload.carrierSenseRange === "number"
                  ? payload.carrierSenseRange
                  : state.carrierSenseRange,
            lastColor: defaultNodeColor,
            elevation:
              typeof node.elevation === "number"
                ? node.elevation
                : terrain.sampleTerrainElevation(state, node.x, node.y),
            heightM:
              typeof node.height_m === "number"
                ? node.height_m
                : typeof node.heightM === "number"
                  ? node.heightM
                  : state.defaultNodeHeightM ?? 2,
          }));
          return;
        }

        if (type === "resetColors") {
          for (const node of state.nodes) {
            node.lastColor = defaultNodeColor;
          }
          state.lastTransmissionCount = 0;
          state.lastMessageId = 0;
          return;
        }

        if (type === "setParams") {
          if (payload.nodeCount !== undefined) {
            state.nodeCount = payload.nodeCount;
            if (state.nodes.length !== payload.nodeCount) {
              sim.resetSimulation(state);
            }
          }
          if (payload.range !== undefined) {
            state.range = payload.range;
            state.carrierSenseRange = payload.range;
            updateEffectiveRangeAndTiming();
            if (!state.useLinkBudget) {
              for (const node of state.nodes) {
                node.range = state.range;
                node.carrierSenseRange = state.carrierSenseRange;
              }
            }
          }
          if (payload.ttl !== undefined) {
            state.ttl = payload.ttl;
          }
          if (payload.timeScale !== undefined) {
            state.timeScale = payload.timeScale;
          }
          if (payload.useLinkBudget !== undefined) {
            state.useLinkBudget = Boolean(payload.useLinkBudget);
          }
          if (payload.linkBudgetDb !== undefined) {
            state.linkBudgetDb =
              typeof payload.linkBudgetDb === "number" ? payload.linkBudgetDb : null;
          }
          if (payload.frequencyMHz !== undefined) {
            state.frequencyMHz =
              typeof payload.frequencyMHz === "number"
                ? payload.frequencyMHz
                : state.frequencyMHz;
          }
          if (payload.pathLossExp !== undefined) {
            state.pathLossExp =
              typeof payload.pathLossExp === "number" ? payload.pathLossExp : state.pathLossExp;
          }
          if (payload.txPower !== undefined) {
            state.txPower = typeof payload.txPower === "number" ? payload.txPower : state.txPower;
          }
          if (payload.txGain !== undefined) {
            state.txGain = typeof payload.txGain === "number" ? payload.txGain : state.txGain;
          }
          if (payload.rxGain !== undefined) {
            state.rxGain = typeof payload.rxGain === "number" ? payload.rxGain : state.rxGain;
          }
          if (payload.noiseFloor !== undefined) {
            state.noiseFloor =
              typeof payload.noiseFloor === "number" ? payload.noiseFloor : state.noiseFloor;
          }

          if (payload.loraPayloadBytes !== undefined) {
            state.loraPayloadBytes = payload.loraPayloadBytes;
          }
          if (payload.loraSpreadingFactor !== undefined) {
            state.loraSpreadingFactor = payload.loraSpreadingFactor;
          }
          if (payload.loraBandwidthHz !== undefined) {
            state.loraBandwidthHz = payload.loraBandwidthHz;
          }
          if (payload.loraCodingRate !== undefined) {
            state.loraCodingRate = payload.loraCodingRate;
          }
          if (payload.loraPreambleSymbols !== undefined) {
            state.loraPreambleSymbols = payload.loraPreambleSymbols;
          }
          if (payload.loraExplicitHeader !== undefined) {
            state.loraExplicitHeader = Boolean(payload.loraExplicitHeader);
          }
          if (payload.loraCrcEnabled !== undefined) {
            state.loraCrcEnabled = Boolean(payload.loraCrcEnabled);
          }
          if (payload.loraLowDataRateOptimize !== undefined) {
            state.loraLowDataRateOptimize = Boolean(payload.loraLowDataRateOptimize);
          }

          if (payload.mapScale !== undefined) {
            state.mapScale = typeof payload.mapScale === "number" ? payload.mapScale : state.mapScale;
          }
          if (payload.coordinateMode !== undefined) {
            state.coordinateMode = payload.coordinateMode === "live" ? "live" : "random";
          }
          if (payload.metersPerPixel !== undefined) {
            if (typeof payload.metersPerPixel === "number" && payload.metersPerPixel > 0) {
              state.metersPerPixel = payload.metersPerPixel;
            }
          }

          updateEffectiveRangeAndTiming();
          if (state.useLinkBudget) {
            for (const node of state.nodes) {
              node.range = state.effectiveRange;
              node.carrierSenseRange = state.effectiveRange;
            }
          }
          return;
        }

        if (type === "setNodePositions") {
          const incoming = Array.isArray(payload.nodes) ? payload.nodes : [];
          if (incoming.length === 0) {
            return;
          }
          if (state.nodes.length === 0 || incoming.length > state.nodes.length) {
            state.nodeCount = incoming.length;
            state.messages = [];
            state.nextMessageId = 1;
            state.activeTransmissions = [];
            state.lastTransmissionCount = 0;
            state.lastMessageId = 0;
            state.nodes = incoming.map((node, index) => ({
              id: index,
              nodeId: typeof node.node_id === "number" ? node.node_id : index,
              x: node.x,
              y: node.y,
              vx: randomRange(-0.4, 0.4),
              vy: randomRange(-0.4, 0.4),
              pinned: false,
              terrainDriven: typeof node.elevation !== "number",
              role: node.role === "ROUTER" || node.role === "CLIENT_MUTE" ? node.role : "CLIENT",
              pendingTransmits: new Map(),
              received: new Set(),
              pulses: [],
              collisionUntil: 0,
              range: state.range,
              carrierSenseRange: state.carrierSenseRange,
              lastColor: defaultNodeColor,
              elevation: typeof node.elevation === "number" ? node.elevation : null,
              heightM:
                typeof node.height_m === "number"
                  ? node.height_m
                  : typeof node.heightM === "number"
                    ? node.heightM
                    : state.defaultNodeHeightM ?? 2,
            }));
            for (const node of state.nodes) {
              terrain.applyTerrainToNode(state, node);
            }
            return;
          }

          state.nodeCount = state.nodes.length;
          for (let i = 0; i < state.nodes.length; i += 1) {
            const node = state.nodes[i];
            const next = incoming[i];
            if (!node || !next) {
              continue;
            }
            node.x = next.x;
            node.y = next.y;
            if (typeof next.node_id === "number") {
              node.nodeId = next.node_id;
            }
            if (typeof next.elevation === "number") {
              node.elevation = next.elevation;
              node.terrainDriven = false;
            } else {
              terrain.applyTerrainToNode(state, node);
            }
            if (typeof next.height_m === "number") {
              node.heightM = next.height_m;
            } else if (typeof next.heightM === "number") {
              node.heightM = next.heightM;
            }
            if (next.role === "ROUTER" || next.role === "CLIENT" || next.role === "CLIENT_MUTE") {
              node.role = next.role;
            }
          }
          return;
        }

        if (type === "hover") {
          const node = sim.findNodeAt(state, payload.x, payload.y);
          state.hoverNodeId = node ? node.id : null;
          return;
        }

        if (type === "hoverEnd") {
          state.hoverNodeId = null;
          return;
        }

        if (type === "editHeightAt") {
          const node = sim.findNodeAt(state, payload.x, payload.y);
          if (!node) {
            return;
          }
          const heightM =
            typeof node.heightM === "number"
              ? node.heightM
              : typeof state.defaultNodeHeightM === "number"
                ? state.defaultNodeHeightM
                : 2;
          self.postMessage({
            type: "editNodeHeight",
            payload: { id: node.id, nodeId: node.nodeId, heightM },
          });
          return;
        }

        if (type === "click") {
          if (paletteUi.paletteRoleAt(state, payload.x, payload.y)) {
            return;
          }
          const node = sim.findNodeAt(state, payload.x, payload.y);
          if (!node) {
            return;
          }
          if (payload.altKey || payload.ctrlKey || payload.metaKey) {
            const heightM =
              typeof node.heightM === "number"
                ? node.heightM
                : typeof state.defaultNodeHeightM === "number"
                  ? state.defaultNodeHeightM
                  : 2;
            self.postMessage({
              type: "editNodeHeight",
              payload: { id: node.id, nodeId: node.nodeId, heightM },
            });
            return;
          }
          if (payload.shiftKey) {
            node.pinned = !node.pinned;
            node.vx = randomRange(-0.4, 0.4);
            node.vy = randomRange(-0.4, 0.4);
            return;
          }
          sim.injectMessage(state, node);
          return;
        }

        if (type === "setNodeHeight") {
          const id = payload && typeof payload.id === "number" ? payload.id : null;
          if (id === null || id < 0 || id >= state.nodes.length) {
            return;
          }
          const heightM = payload && typeof payload.heightM === "number" ? payload.heightM : null;
          if (!Number.isFinite(heightM) || heightM < 0) {
            return;
          }
          const node = state.nodes[id];
          if (!node) {
            return;
          }
          node.heightM = heightM;
          if (state.dragNodeId === id) {
            state.dragNodeId = null;
          }
          for (const transmission of state.activeTransmissions) {
            if (!transmission || transmission.nodeId !== id) {
              continue;
            }
            if (Number.isFinite(transmission.endTime) && transmission.endTime <= state.simTime) {
              continue;
            }
            transmission.heightM = heightM;
          }
          return;
        }

        if (type === "dragStart") {
          state.dragPointer = { x: payload.x, y: payload.y };
          const paletteRole = paletteUi.paletteRoleAt(state, payload.x, payload.y);
          if (paletteRole) {
            state.dragNewRole = paletteRole;
            self.postMessage({ type: "suppressClickOnce" });
            return;
          }
          const node = sim.findNodeAt(state, payload.x, payload.y);
          if (!node) {
            state.dragNodeId = null;
            return;
          }
          state.dragNodeId = node.id;
          node.terrainDriven = true;
          return;
        }

        if (type === "dragMove") {
          state.dragPointer = { x: payload.x, y: payload.y };
          if (state.dragNewRole) {
            return;
          }
          if (state.dragNodeId === null) {
            return;
          }
          const node = state.nodes[state.dragNodeId];
          if (!node) {
            return;
          }
          node.x = payload.x;
          node.y = payload.y;
          if (node.terrainDriven) {
            terrain.applyTerrainToNode(state, node, true);
          }
          return;
        }

        if (type === "dragEnd") {
          if (state.dragNewRole) {
            const role = state.dragNewRole;
            state.dragNewRole = null;
            if (!paletteUi.paletteRoleAt(state, state.dragPointer.x, state.dragPointer.y)) {
              const nodeCount = sim.addNodeAt(state, state.dragPointer.x, state.dragPointer.y, role);
              self.postMessage({ type: "nodeCount", payload: { nodeCount } });
            }
            return;
          }
          state.dragNodeId = null;
          return;
        }

        if (type === "setTerrain") {
          const grid = payload && Array.isArray(payload.grid) ? payload.grid : null;
          if (!grid || !Number.isFinite(payload.width) || !Number.isFinite(payload.height)) {
            return;
          }
          state.terrain = {
            bbox: payload.bbox ?? null,
            width: Number(payload.width),
            height: Number(payload.height),
            min_elevation_m: payload.min_elevation_m ?? payload.minElevation ?? null,
            max_elevation_m: payload.max_elevation_m ?? payload.maxElevation ?? null,
            grid,
          };
          terrain.rebuildTerrainLayer(state);
          for (const node of state.nodes) {
            terrain.applyTerrainToNode(state, node);
          }
          return;
        }

        if (type === "clearTerrain") {
          state.terrain = null;
          state.terrainLayer = null;
          return;
        }
      };

      for (const queued of pendingMessages.splice(0)) {
        handleMessageData(queued);
      }
    }
  )
  .catch((error) => {
    self.postMessage({
      type: "workerInitError",
      payload: { message: error && error.message ? error.message : String(error) },
    });
  });
