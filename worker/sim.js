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
  function addRangeRing(state, node, options = {}) {
    if (!node) {
      return;
    }
    const durationMs =
      Number.isFinite(options.durationMs) && options.durationMs > 0 ? options.durationMs : 3000;
    const color = typeof options.color === "string" ? options.color : "#5ce1e6";
    const fromRadiusPx = Number(options.fromRadiusPx);
    const toRadiusPx = Number(options.toRadiusPx);
    const fromPx = Number.isFinite(fromRadiusPx) ? fromRadiusPx : toRadiusPx;
    const toPx = Number.isFinite(toRadiusPx) ? toRadiusPx : fromRadiusPx;
    if (!Number.isFinite(fromPx) || fromPx <= 0) {
      return;
    }
    if (!Number.isFinite(toPx) || toPx <= 0) {
      return;
    }
    if (!(node.uiRings instanceof Array)) {
      node.uiRings = [];
    }
    node.uiRings.push({
      color,
      ageMs: 0,
      durationMs,
      fromRadiusPx: fromPx,
      toRadiusPx: toPx,
    });
  }

  function updateUiRings(state, deltaRealMs) {
    const delta = Number(deltaRealMs);
    if (!Number.isFinite(delta) || delta <= 0) {
      return;
    }
    for (const node of state.nodes) {
      if (!(node?.uiRings instanceof Array) || node.uiRings.length === 0) {
        continue;
      }
      node.uiRings = node.uiRings
        .map((ring) => ({
          ...ring,
          ageMs: (Number.isFinite(ring.ageMs) ? ring.ageMs : 0) + delta,
        }))
        .filter(
          (ring) =>
            Number.isFinite(ring.durationMs) &&
            ring.durationMs > 0 &&
            Number.isFinite(ring.ageMs) &&
            ring.ageMs < ring.durationMs
        );
    }
  }

  function getNodeRangeDetails(state, node, overrides = {}) {
    if (!node) {
      return null;
    }
    const heightM =
      Number.isFinite(overrides.heightM) && overrides.heightM >= 0
        ? overrides.heightM
        : getNodeHeightMeters(state, node);
    const txPowerDbm = Number.isFinite(overrides.txPowerDbm)
      ? overrides.txPowerDbm
      : getNodeTxPowerDbm(state, node);

    const tempNode = { ...node };
    tempNode.heightM = heightM;
    tempNode.txPowerDbm = txPowerDbm;

    const mapScale = Number.isFinite(state.mapScale) && state.mapScale > 0 ? state.mapScale : 1;
    const metersPerScreenPx =
      Number.isFinite(state.metersPerPixel) && state.metersPerPixel > 0
        ? state.metersPerPixel / mapScale
        : null;

    let rawRangePx = null;
    let rawRangeMeters = null;
    if (state.useLinkBudget) {
      const baseMeters = getNodeEffectiveRangeMeters(state, tempNode);
      rawRangeMeters = baseMeters;
      if (metersPerScreenPx) {
        rawRangePx = (baseMeters / metersPerScreenPx);
      } else {
        rawRangePx = baseMeters * mapScale;
      }
    } else {
      const baseRangePx = (tempNode.range ?? state.range) * mapScale;
      const deltaDb =
        getNodeTxPowerDbm(state, tempNode) - (Number.isFinite(state.txPower) ? state.txPower : 0);
      rawRangePx = baseRangePx * computeRangeScaleFromTxDeltaDb(state, deltaDb);
      rawRangeMeters = metersPerScreenPx ? rawRangePx * metersPerScreenPx : null;
    }

    const otherHeightM =
      Number.isFinite(state.defaultNodeHeightM) && state.defaultNodeHeightM >= 0
        ? state.defaultNodeHeightM
        : 2;
    const earthRadiusM = getEarthRadiusMeters(state);
    const losLimitMeters =
      computeHorizonMeters(earthRadiusM, heightM) + computeHorizonMeters(earthRadiusM, otherHeightM);
    const losLimitPx = metersPerScreenPx ? losLimitMeters / metersPerScreenPx : null;

    const rangePx =
      Number.isFinite(losLimitPx) && Number.isFinite(rawRangePx)
        ? Math.min(rawRangePx, losLimitPx)
        : rawRangePx;
    const rangeMeters =
      metersPerScreenPx && Number.isFinite(rangePx) ? rangePx * metersPerScreenPx : rawRangeMeters;

    return {
      heightM,
      txPowerDbm: getNodeTxPowerDbm(state, tempNode),
      rangePx,
      rangeMeters,
      rawRangePx,
      losLimitPx,
      losLimitMeters,
      metersPerScreenPx,
    };
  }

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

  function getNodeTxPowerDbm(state, node) {
    const fallback = Number.isFinite(state.txPower) ? state.txPower : 0;
    const maxDbm =
      Number.isFinite(state.maxTxPowerDbm) && state.maxTxPowerDbm > 0 ? state.maxTxPowerDbm : 40;
    const raw = Number.isFinite(node?.txPowerDbm) ? node.txPowerDbm : fallback;
    return clamp(raw, 0, maxDbm);
  }

  function computeRangeScaleFromTxDeltaDb(state, deltaDb) {
    const exp = Number(state.pathLossExp);
    if (!Number.isFinite(deltaDb) || deltaDb === 0) {
      return 1;
    }
    if (!Number.isFinite(exp) || exp <= 0) {
      return 1;
    }
    return Math.pow(10, deltaDb / (10 * exp));
  }

  function computeHorizonMeters(earthRadiusM, heightM) {
    const R = Number(earthRadiusM);
    const h = Math.max(0, Number(heightM) || 0);
    return Math.sqrt(2 * R * h + h * h);
  }

  function getNodeVisualRangePx(state, node) {
    const rfPx = getNodeRange(state, node);
    if (!Number.isFinite(rfPx) || rfPx <= 0) {
      return rfPx;
    }
    if (!Number.isFinite(state.metersPerPixel) || state.metersPerPixel <= 0) {
      return rfPx;
    }
    const mapScale = Number.isFinite(state.mapScale) && state.mapScale > 0 ? state.mapScale : 1;
    const metersPerScreenPx = state.metersPerPixel / mapScale;
    if (!Number.isFinite(metersPerScreenPx) || metersPerScreenPx <= 0) {
      return rfPx;
    }
    const earthRadiusM = getEarthRadiusMeters(state);
    const ownHeightM = getNodeHeightMeters(state, node);
    const peerHeightM =
      Number.isFinite(state.defaultNodeHeightM) && state.defaultNodeHeightM >= 0
        ? state.defaultNodeHeightM
        : 2;
    const losMeters =
      computeHorizonMeters(earthRadiusM, ownHeightM) + computeHorizonMeters(earthRadiusM, peerHeightM);
    const losPx = losMeters / metersPerScreenPx;
    if (!Number.isFinite(losPx) || losPx <= 0) {
      return rfPx;
    }
    return Math.min(rfPx, losPx);
  }

  function computeLinkBudgetRangeMeters(state, linkBudgetDb) {
    const budget = Number(linkBudgetDb);
    const freq = Number(state.frequencyMHz) || 915;
    const pathLossExp = Number(state.pathLossExp) || 2.0;
    if (!Number.isFinite(budget) || !Number.isFinite(freq) || !Number.isFinite(pathLossExp)) {
      return null;
    }
    if (freq <= 0 || pathLossExp <= 0) {
      return null;
    }
    const denom = 10 * pathLossExp;
    const base = budget - 32.44 - 20 * Math.log10(freq);
    const distanceKm = Math.pow(10, base / denom);
    if (!Number.isFinite(distanceKm) || distanceKm <= 0) {
      return null;
    }
    return Math.max(1, distanceKm * 1000);
  }

  function getNodeEffectiveRangeMeters(state, node) {
    const baseline = Number.isFinite(state.linkBudgetDb)
      ? state.linkBudgetDb
      : Number.isFinite(state.txPower) &&
          Number.isFinite(state.txGain) &&
          Number.isFinite(state.rxGain) &&
          Number.isFinite(state.noiseFloor)
        ? state.txPower + state.txGain + state.rxGain - state.noiseFloor
        : null;

    const deltaDb = getNodeTxPowerDbm(state, node) - (Number.isFinite(state.txPower) ? state.txPower : 0);
    const nodeBudget = baseline === null ? null : baseline + deltaDb;
    const meters =
      nodeBudget === null ? null : computeLinkBudgetRangeMeters(state, nodeBudget);
    if (Number.isFinite(meters)) {
      return meters;
    }
    if (Number.isFinite(state.effectiveRange) && state.effectiveRange > 0) {
      return state.effectiveRange;
    }
    return Math.max(1, Number(state.range) || 110);
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
    // Candidate radius only: curvature LOS is applied per-pair in `hasCurvatureLos`.
    if (state.useLinkBudget) {
      const baseMeters = getNodeEffectiveRangeMeters(state, node);
      if (!Number.isFinite(state.metersPerPixel) || state.metersPerPixel <= 0) {
        return baseMeters * state.mapScale;
      }
      return (baseMeters / state.metersPerPixel) * state.mapScale;
    }
    const baseRangePx = (node.range ?? state.range) * state.mapScale;
    const deltaDb =
      getNodeTxPowerDbm(state, node) - (Number.isFinite(state.txPower) ? state.txPower : 0);
    return baseRangePx * computeRangeScaleFromTxDeltaDb(state, deltaDb);
  }

  function getCarrierSenseRange(state, node) {
    if (state.useLinkBudget) {
      const baseMeters = getNodeEffectiveRangeMeters(state, node);
      if (!Number.isFinite(state.metersPerPixel) || state.metersPerPixel <= 0) {
        return baseMeters * state.mapScale;
      }
      return (baseMeters / state.metersPerPixel) * state.mapScale;
    }
    const baseRangePx = (node.carrierSenseRange ?? state.carrierSenseRange) * state.mapScale;
    const deltaDb =
      getNodeTxPowerDbm(state, node) - (Number.isFinite(state.txPower) ? state.txPower : 0);
    return baseRangePx * computeRangeScaleFromTxDeltaDb(state, deltaDb);
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
        uiRings: [],
        collisionUntil: 0,
        range: state.range,
        carrierSenseRange: state.carrierSenseRange,
        lastColor: defaultNodeColor,
        elevation: sampleTerrainElevation(state, x, y),
        heightM: state.defaultNodeHeightM ?? 2,
        txPowerDbm: state.txPower,
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
      maxRange: getNodeVisualRangePx(state, node),
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
      firstTxAt: null,
      lastTxEndAt: null,
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
        if (!Number.isFinite(message.firstTxAt)) {
          message.firstTxAt = now;
        }
        message.lastTxEndAt = now + state.onAirTime;
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
      const start = message.firstTxAt;
      const end = message.lastTxEndAt;
      state.lastFloodElapsedMs =
        Number.isFinite(start) && Number.isFinite(end) && end >= start ? end - start : null;
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
      uiRings: [],
      collisionUntil: 0,
      range: nodeRange,
      carrierSenseRange: senseRange,
      lastColor: defaultNodeColor,
      elevation: sampleTerrainElevation(state, nx, ny),
      heightM: state.defaultNodeHeightM ?? 2,
      txPowerDbm: state.txPower,
    });
    state.nodeCount = state.nodes.length;
    return state.nodeCount;
  }

  function deleteNodeById(state, nodeId) {
    const id = Number(nodeId);
    if (!Number.isFinite(id) || id < 0 || id >= state.nodes.length) {
      return state.nodeCount;
    }

    state.nodes.splice(id, 1);
    state.nodeCount = state.nodes.length;

    state.messages = [];
    state.nextMessageId = 1;
    state.activeTransmissions = [];
    state.lastTransmissionCount = 0;
    state.lastMessageId = 0;
    state.lastFloodElapsedMs = null;
    state.dragNodeId = null;
    state.dragNewRole = null;
    state.hoverNodeId = null;

    for (let i = 0; i < state.nodes.length; i += 1) {
      const node = state.nodes[i];
      if (!node) {
        continue;
      }
      node.id = i;
      node.nodeId = i;
      node.pendingTransmits = new Map();
      node.received = new Set();
      node.pulses = [];
      node.collisionUntil = 0;
    }

    return state.nodeCount;
  }

  return {
    getNodeRange,
    getNodeRangeDetails,
    getCarrierSenseRange,
    createNodes,
    resetSimulation,
    computeNeighbors,
    updateMessages,
    updateNodes,
    updatePulses,
    updateUiRings,
    findNodeAt,
    injectMessage,
    addNodeAt,
    deleteNodeById,
    addRangeRing,
  };
}
