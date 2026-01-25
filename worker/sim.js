export function createSim({
  Quadtree,
  clamp,
  randomRange,
  defaultNodeColor,
  palette,
  updateEffectiveRange,
  estimateCwSizeFromSnr,
  estimateRxSnr,
  computeRebroadcastDelayMsec,
  hasLineOfSightCurvature,
  sampleTerrainElevation,
  applyTerrainToNode,
}) {
  function getEarthRadiusMeters(state) {
    return Number.isFinite(state.earthRadiusM) && state.earthRadiusM > 0 ? state.earthRadiusM : 6371000;
  }

  function getNodeHeightMeters(state, node) {
    if (Number.isFinite(node?.heightM) && node.heightM >= 0) {
      return node.heightM;
    }
    if (Number.isFinite(state.defaultNodeHeightM) && state.defaultNodeHeightM >= 0) {
      return state.defaultNodeHeightM;
    }
    return 2;
  }

  function computeHorizonMeters(earthRadiusM, heightM) {
    const R = Number(earthRadiusM);
    const h = Math.max(0, Number(heightM) || 0);
    return Math.sqrt(2 * R * h + h * h);
  }

  function getDistanceMeters(state, dxPx, dyPx) {
    const distPx = Math.hypot(dxPx, dyPx);
    const mapScale = Number.isFinite(state.mapScale) && state.mapScale > 0 ? state.mapScale : 1;
    if (Number.isFinite(state.metersPerPixel) && state.metersPerPixel > 0) {
      return (distPx * state.metersPerPixel) / mapScale;
    }
    // Fallback: approximate 1 px == 1 meter.
    return distPx / mapScale;
  }

  function hasCurvatureLos(state, a, b, dxPx, dyPx) {
    if (typeof hasLineOfSightCurvature !== "function") {
      return true;
    }
    const earthRadiusM =
      Number.isFinite(state.earthRadiusM) && state.earthRadiusM > 0 ? state.earthRadiusM : 6371000;
    const ha =
      Number.isFinite(a?.heightM) && a.heightM >= 0 ? a.heightM : state.defaultNodeHeightM ?? 2;
    const hb =
      Number.isFinite(b?.heightM) && b.heightM >= 0 ? b.heightM : state.defaultNodeHeightM ?? 2;
    const distanceM = getDistanceMeters(state, dxPx, dyPx);
    return hasLineOfSightCurvature(distanceM, ha, hb, earthRadiusM);
  }

  function getNodeRange(state, node) {
    const base = state.useLinkBudget ? state.effectiveRange : node.range ?? state.range;
    if (state.useLinkBudget) {
      if (!Number.isFinite(state.metersPerPixel) || state.metersPerPixel <= 0) {
        return base * state.mapScale;
      }
      const rangePx = (base / state.metersPerPixel) * state.mapScale;
      const maxHeight =
        Number.isFinite(state.maxNodeHeightM) && state.maxNodeHeightM >= 0
          ? state.maxNodeHeightM
          : getNodeHeightMeters(state, node);
      const earthRadiusM = getEarthRadiusMeters(state);
      const maxLosMeters =
        computeHorizonMeters(earthRadiusM, getNodeHeightMeters(state, node)) +
        computeHorizonMeters(earthRadiusM, maxHeight);
      const maxLosPx = (maxLosMeters / state.metersPerPixel) * state.mapScale;
      return Math.min(rangePx, maxLosPx);
    }
    const rangePx = base * state.mapScale;
    if (!Number.isFinite(state.metersPerPixel) || state.metersPerPixel <= 0) {
      return rangePx;
    }
    const maxHeight =
      Number.isFinite(state.maxNodeHeightM) && state.maxNodeHeightM >= 0
        ? state.maxNodeHeightM
        : getNodeHeightMeters(state, node);
    const earthRadiusM = getEarthRadiusMeters(state);
    const maxLosMeters =
      computeHorizonMeters(earthRadiusM, getNodeHeightMeters(state, node)) +
      computeHorizonMeters(earthRadiusM, maxHeight);
    const maxLosPx = (maxLosMeters / state.metersPerPixel) * state.mapScale;
    return Math.min(rangePx, maxLosPx);
  }

  function getCarrierSenseRange(state, node) {
    const base = state.useLinkBudget
      ? state.effectiveRange
      : node.carrierSenseRange ?? state.carrierSenseRange;
    if (state.useLinkBudget) {
      if (!Number.isFinite(state.metersPerPixel) || state.metersPerPixel <= 0) {
        return base * state.mapScale;
      }
      const rangePx = (base / state.metersPerPixel) * state.mapScale;
      const maxHeight =
        Number.isFinite(state.maxNodeHeightM) && state.maxNodeHeightM >= 0
          ? state.maxNodeHeightM
          : getNodeHeightMeters(state, node);
      const earthRadiusM = getEarthRadiusMeters(state);
      const maxLosMeters =
        computeHorizonMeters(earthRadiusM, getNodeHeightMeters(state, node)) +
        computeHorizonMeters(earthRadiusM, maxHeight);
      const maxLosPx = (maxLosMeters / state.metersPerPixel) * state.mapScale;
      return Math.min(rangePx, maxLosPx);
    }
    const rangePx = base * state.mapScale;
    if (!Number.isFinite(state.metersPerPixel) || state.metersPerPixel <= 0) {
      return rangePx;
    }
    const maxHeight =
      Number.isFinite(state.maxNodeHeightM) && state.maxNodeHeightM >= 0
        ? state.maxNodeHeightM
        : getNodeHeightMeters(state, node);
    const earthRadiusM = getEarthRadiusMeters(state);
    const maxLosMeters =
      computeHorizonMeters(earthRadiusM, getNodeHeightMeters(state, node)) +
      computeHorizonMeters(earthRadiusM, maxHeight);
    const maxLosPx = (maxLosMeters / state.metersPerPixel) * state.mapScale;
    return Math.min(rangePx, maxLosPx);
  }

  function createNodes(state) {
    const padding = 40;
    const nodes = [];
    for (let id = 0; id < state.nodeCount; id += 1) {
      const x = randomRange(padding, state.width - padding);
      const y = randomRange(padding, state.height - padding);
      const roleRoll = Math.random();
      const role = roleRoll < 0.1 ? "ROUTER" : Math.random() < 0.1 ? "CLIENT_MUTE" : "CLIENT";
      nodes.push({
        id,
        nodeId: id,
        x,
        y,
        vx: randomRange(-0.4, 0.4),
        vy: randomRange(-0.4, 0.4),
        pinned: false,
        terrainDriven: true,
        role,
        pendingTransmits: new Map(),
        received: new Set(),
        pulses: [],
        collisionUntil: 0,
        range: state.range,
        carrierSenseRange: state.carrierSenseRange,
        lastColor: defaultNodeColor,
        elevation: sampleTerrainElevation(state, x, y),
        heightM: state.defaultNodeHeightM ?? 2,
      });
    }
    state.nodes = nodes;
  }

  function resetSimulation(state) {
    state.messages = [];
    state.nextMessageId = 1;
    state.activeTransmissions = [];
    createNodes(state);
  }

  function computeNeighbors(state) {
    let maxHeightM = null;
    for (const node of state.nodes) {
      const heightM = getNodeHeightMeters(state, node);
      if (maxHeightM === null || heightM > maxHeightM) {
        maxHeightM = heightM;
      }
    }
    state.maxNodeHeightM = maxHeightM === null ? state.defaultNodeHeightM ?? 2 : maxHeightM;

    const tree = new Quadtree({ x: 0, y: 0, w: state.width, h: state.height });
    for (const node of state.nodes) {
      tree.insert({ x: node.x, y: node.y, id: node.id });
    }

    const neighbors = Array.from({ length: state.nodes.length }, () => []);
    const edges = [];
    const edgeSet = new Set();
    for (const node of state.nodes) {
      const nodeRange = getNodeRange(state, node);
      const range = {
        x: node.x - nodeRange,
        y: node.y - nodeRange,
        w: nodeRange * 2,
        h: nodeRange * 2,
      };
      const candidates = tree.query(range);
      const nearby = [];
      for (const candidate of candidates) {
        if (candidate.id === node.id) {
          continue;
        }
        const dx = node.x - candidate.x;
        const dy = node.y - candidate.y;
        if (dx * dx + dy * dy <= nodeRange * nodeRange) {
          const other = state.nodes[candidate.id];
          if (other && !hasCurvatureLos(state, node, other, dx, dy)) {
            continue;
          }
          nearby.push(candidate.id);
          const a = Math.min(node.id, candidate.id);
          const b = Math.max(node.id, candidate.id);
          const key = `${a}:${b}`;
          if (!edgeSet.has(key)) {
            edgeSet.add(key);
            edges.push([a, b]);
          }
        }
      }
      neighbors[node.id] = nearby;
    }
    return { neighbors, edges };
  }

  function receiveMessage(node, message) {
    node.received.add(message.id);
    node.lastColor = message.color;
  }

  function emitPulse(state, node, message) {
    node.lastColor = message.color;
    node.pulses.push({
      color: message.color,
      age: 0,
      duration: state.onAirTime,
      maxRange: getNodeRange(state, node),
    });
  }

  function injectMessage(state, originNode) {
    const id = state.nextMessageId++;
    const color = palette[(id - 1) % palette.length];
    const now = state.simTime;
    const cadTime = Number.isFinite(state.cadTimeMsec) ? state.cadTimeMsec : 0;
    const message = {
      id,
      color,
      transmitQueue: [
        {
          nodeId: originNode.id,
          readyAt: now + cadTime,
          hop: 0,
          cwSize: state.cwMax,
          cadAttempts: 0,
        },
      ],
      pendingReceives: [],
      transmissions: 0,
    };
    state.messages.push(message);
    receiveMessage(originNode, message);
  }

  function getBusyUntil(state, node, now) {
    const senseRange = getCarrierSenseRange(state, node);
    const senseRangeSq = senseRange * senseRange;
    let earliestEnd = null;
    for (const transmission of state.activeTransmissions) {
      if (transmission.endTime <= now) {
        continue;
      }
      const dx = node.x - transmission.x;
      const dy = node.y - transmission.y;
      if (dx * dx + dy * dy <= senseRangeSq) {
        const earthRadiusM =
          Number.isFinite(state.earthRadiusM) && state.earthRadiusM > 0 ? state.earthRadiusM : 6371000;
        const rxHeight =
          Number.isFinite(node?.heightM) && node.heightM >= 0 ? node.heightM : state.defaultNodeHeightM ?? 2;
        const txHeight =
          Number.isFinite(transmission?.heightM) && transmission.heightM >= 0
            ? transmission.heightM
            : state.defaultNodeHeightM ?? 2;
        const distanceM = getDistanceMeters(state, dx, dy);
        if (
          typeof hasLineOfSightCurvature === "function" &&
          !hasLineOfSightCurvature(distanceM, rxHeight, txHeight, earthRadiusM)
        ) {
          continue;
        }
        if (earliestEnd === null || transmission.endTime < earliestEnd) {
          earliestEnd = transmission.endTime;
        }
      }
    }
    return earliestEnd;
  }

  function updateMessages(state, neighbors, now) {
    state.activeTransmissions = state.activeTransmissions.filter(
      (transmission) => transmission.endTime > now
    );

    const dueTransmits = [];
    for (const message of state.messages) {
      if (message.pendingReceives.length > 0) {
        const remainingReceives = [];
        const byNode = new Map();
        for (const receiveEvent of message.pendingReceives) {
          if (!byNode.has(receiveEvent.nodeId)) {
            byNode.set(receiveEvent.nodeId, []);
          }
          byNode.get(receiveEvent.nodeId).push(receiveEvent);
        }

        for (const [nodeId, events] of byNode) {
          events.sort((a, b) => a.time - b.time);

          let clusterStart = 0;
          for (let i = 1; i <= events.length; i += 1) {
            const prev = events[i - 1];
            const current = events[i];
            const overlaps = current && current.time - prev.time < state.onAirTime;
            if (overlaps) {
              continue;
            }

            const cluster = events.slice(clusterStart, i);
            const isColliding = cluster.length > 1;
            const clusterHasArrived = cluster.some((item) => item.time <= now);

            if (isColliding && clusterHasArrived) {
              const receiver = state.nodes[nodeId];
              if (receiver) {
                receiver.collisionUntil = Math.max(
                  receiver.collisionUntil,
                  now + state.onAirTime
                );
              }
            }

            for (const receiveEvent of cluster) {
              if (isColliding) {
                if (!clusterHasArrived) {
                  remainingReceives.push(receiveEvent);
                }
                continue;
              }
              if (receiveEvent.time > now) {
                remainingReceives.push(receiveEvent);
                continue;
              }
              const receiver = state.nodes[receiveEvent.nodeId];
              const sender = state.nodes[receiveEvent.fromId];
              if (!receiver || !sender) {
                continue;
              }
              if (receiver.received.has(message.id)) {
                if (
                  receiver.role === "CLIENT" &&
                  receiver.pendingTransmits instanceof Map &&
                  receiver.pendingTransmits.has(message.id)
                ) {
                  receiver.pendingTransmits.delete(message.id);
                  message.transmitQueue = message.transmitQueue.filter(
                    (event) => event.nodeId !== receiver.id
                  );
                }
                continue;
              }
              receiveMessage(receiver, message);
              if (receiveEvent.hop > state.ttl) {
                receiver.lastColor = message.color;
              }
              const snrDb = Number.isFinite(receiveEvent.snr)
                ? receiveEvent.snr
                : estimateRxSnr(state, sender, receiver, (n) => getNodeRange(state, n));
              const cwSize = estimateCwSizeFromSnr(state, snrDb);
              const delay = computeRebroadcastDelayMsec(state, receiver.role, cwSize);
              const cadTime = Number.isFinite(state.cadTimeMsec) ? state.cadTimeMsec : 0;
              const readyAt = now + delay + cadTime;
              if (receiver.role !== "CLIENT_MUTE" && receiveEvent.hop <= state.ttl) {
                message.transmitQueue.push({
                  nodeId: receiver.id,
                  readyAt,
                  hop: receiveEvent.hop,
                  cwSize,
                  cadAttempts: 0,
                });
                if (!(receiver.pendingTransmits instanceof Map)) {
                  receiver.pendingTransmits = new Map();
                }
                receiver.pendingTransmits.set(message.id, {
                  startAt: now,
                  readyAt,
                  color: message.color,
                  direction: "ccw",
                });
              }
            }

            clusterStart = i;
          }
        }

        message.pendingReceives = remainingReceives;
      }

      if (message.transmitQueue.length > 0) {
        const remainingTransmits = [];
        for (const transmitEvent of message.transmitQueue) {
          if (transmitEvent.readyAt > now) {
            remainingTransmits.push(transmitEvent);
            continue;
          }
          dueTransmits.push({ message, transmitEvent });
        }
        message.transmitQueue = remainingTransmits;
      }
    }

    if (dueTransmits.length > 0) {
      const transmitNow = [];
      for (const { message, transmitEvent } of dueTransmits) {
        const sender = state.nodes[transmitEvent.nodeId];
        if (!sender) {
          continue;
        }
        const busyUntil = getBusyUntil(state, sender, now);
        if (busyUntil !== null) {
          const cwSize = Number.isFinite(transmitEvent.cwSize) ? transmitEvent.cwSize : state.cwMax;
          const cadAttempts = Number.isFinite(transmitEvent.cadAttempts)
            ? transmitEvent.cadAttempts
            : 0;
          const nextAttempts = cadAttempts + 1;
          const maxAttempts = Number.isFinite(state.maxCadAttempts) ? state.maxCadAttempts : 6;
          if (nextAttempts > maxAttempts) {
            if (sender.pendingTransmits instanceof Map) {
              sender.pendingTransmits.delete(message.id);
            }
            continue;
          }
          const delay = computeRebroadcastDelayMsec(state, sender.role, cwSize);
          const cadTime = Number.isFinite(state.cadTimeMsec) ? state.cadTimeMsec : 0;
          const newReadyAt = Math.max(busyUntil, now) + cadTime + delay;
          message.transmitQueue.push({
            ...transmitEvent,
            readyAt: newReadyAt,
            cadAttempts: nextAttempts,
            cwSize,
          });
          if (!(sender.pendingTransmits instanceof Map)) {
            sender.pendingTransmits = new Map();
          }
          const prev = sender.pendingTransmits.get(message.id);
          const prevDir = prev && typeof prev.direction === "string" ? prev.direction : null;
          const nextDir = prevDir === "ccw" ? "cw" : "ccw";
          sender.pendingTransmits.set(message.id, {
            startAt: now,
            readyAt: newReadyAt,
            color: message.color,
            direction: nextDir,
          });
          continue;
        }
        transmitNow.push({ message, transmitEvent, sender });
      }

      for (const { message, transmitEvent, sender } of transmitNow) {
        if (transmitEvent.hop > state.ttl) {
          continue;
        }
        if (sender.pendingTransmits instanceof Map) {
          sender.pendingTransmits.delete(message.id);
        }
        emitPulse(state, sender, message);
        for (const neighborId of neighbors[transmitEvent.nodeId]) {
          const neighbor = state.nodes[neighborId];
          if (!neighbor || neighbor.received.has(message.id)) {
            continue;
          }
          const snrDb = estimateRxSnr(state, sender, neighbor, (n) => getNodeRange(state, n));
          message.pendingReceives.push({
            nodeId: neighborId,
            fromId: transmitEvent.nodeId,
            time: now + state.onAirTime,
            hop: transmitEvent.hop + 1,
            snr: snrDb,
          });
          message.transmissions += 1;
        }
        state.activeTransmissions.push({
          nodeId: sender.id,
          x: sender.x,
          y: sender.y,
          endTime: now + state.onAirTime,
          heightM:
            Number.isFinite(sender?.heightM) && sender.heightM >= 0
              ? sender.heightM
              : state.defaultNodeHeightM ?? 2,
        });
      }
    }

    state.messages = state.messages.filter((message) => {
      if (message.transmitQueue.length > 0 || message.pendingReceives.length > 0) {
        return true;
      }
      state.lastTransmissionCount = message.transmissions;
      state.lastMessageId = message.id;
      return false;
    });

    const remainingIds = new Set(state.messages.map((message) => message.id));
    for (const node of state.nodes) {
      if (!(node.pendingTransmits instanceof Map)) {
        continue;
      }
      for (const [messageId, entry] of node.pendingTransmits.entries()) {
        if (!remainingIds.has(messageId) || !entry || entry.readyAt <= now) {
          node.pendingTransmits.delete(messageId);
        }
      }
    }
  }

  function updateNodes(state, delta) {
    const padding = 30;
    const step = delta / 16.6667;
    for (const node of state.nodes) {
      if (node.pinned) {
        continue;
      }
      node.x += node.vx * step;
      node.y += node.vy * step;
      if (node.x < padding || node.x > state.width - padding) {
        node.vx *= -1;
      }
      if (node.y < padding || node.y > state.height - padding) {
        node.vy *= -1;
      }
      if (node.terrainDriven) {
        applyTerrainToNode(state, node, true);
      }
    }
  }

  function updatePulses(state, delta) {
    for (const node of state.nodes) {
      node.pulses = node.pulses
        .map((pulse) => ({
          ...pulse,
          age: pulse.age + delta,
        }))
        .filter((pulse) => pulse.age < pulse.duration);
    }
  }

  function findNodeAt(state, x, y) {
    let closest = null;
    let closestDist = Infinity;
    for (const node of state.nodes) {
      const dist = Math.hypot(node.x - x, node.y - y);
      if (dist < 12 && dist < closestDist) {
        closest = node;
        closestDist = dist;
      }
    }
    return closest;
  }

  function addNodeAt(state, x, y, role) {
    const safeRole =
      role === "ROUTER" || role === "CLIENT" || role === "CLIENT_MUTE" ? role : "CLIENT";
    const padding = 24;
    const nx = clamp(x, padding, state.width - padding);
    const ny = clamp(y, padding, state.height - padding);
    const id = state.nodes.length;
    const nodeRange = state.useLinkBudget ? state.effectiveRange : state.range;
    const senseRange = state.useLinkBudget ? state.effectiveRange : state.carrierSenseRange;
    state.nodes.push({
      id,
      nodeId: id,
      x: nx,
      y: ny,
      vx: randomRange(-0.4, 0.4),
      vy: randomRange(-0.4, 0.4),
      pinned: false,
      terrainDriven: true,
      role: safeRole,
      pendingTransmits: new Map(),
      received: new Set(),
      pulses: [],
      collisionUntil: 0,
      range: nodeRange,
      carrierSenseRange: senseRange,
      lastColor: defaultNodeColor,
      elevation: sampleTerrainElevation(state, nx, ny),
      heightM: state.defaultNodeHeightM ?? 2,
    });
    state.nodeCount = state.nodes.length;
    return state.nodeCount;
  }

  return {
    getNodeRange,
    getCarrierSenseRange,
    createNodes,
    resetSimulation,
    computeNeighbors,
    updateMessages,
    updateNodes,
    updatePulses,
    findNodeAt,
    injectMessage,
    addNodeAt,
  };
}
