let canvas;
let ctx;
const scheduleFrame = self.requestAnimationFrame
  ? (cb) => self.requestAnimationFrame(cb)
  : (cb) => setTimeout(() => cb(performance.now()), 16);
let useExternalClock = false;

class Quadtree {
  constructor(bounds, capacity = 6) {
    this.bounds = bounds;
    this.capacity = capacity;
    this.points = [];
    this.divided = false;
  }

  contains(point) {
    const { x, y, w, h } = this.bounds;
    return (
      point.x >= x &&
      point.x <= x + w &&
      point.y >= y &&
      point.y <= y + h
    );
  }

  intersects(range) {
    const { x, y, w, h } = this.bounds;
    return !(
      range.x > x + w ||
      range.x + range.w < x ||
      range.y > y + h ||
      range.y + range.h < y
    );
  }

  subdivide() {
    const { x, y, w, h } = this.bounds;
    const hw = w / 2;
    const hh = h / 2;
    this.northwest = new Quadtree({ x, y, w: hw, h: hh }, this.capacity);
    this.northeast = new Quadtree({ x: x + hw, y, w: hw, h: hh }, this.capacity);
    this.southwest = new Quadtree({ x, y: y + hh, w: hw, h: hh }, this.capacity);
    this.southeast = new Quadtree(
      { x: x + hw, y: y + hh, w: hw, h: hh },
      this.capacity
    );
    this.divided = true;
  }

  insert(point) {
    if (!this.contains(point)) {
      return false;
    }
    if (this.points.length < this.capacity) {
      this.points.push(point);
      return true;
    }
    if (!this.divided) {
      this.subdivide();
    }
    return (
      this.northwest.insert(point) ||
      this.northeast.insert(point) ||
      this.southwest.insert(point) ||
      this.southeast.insert(point)
    );
  }

  query(range, found = []) {
    if (!this.intersects(range)) {
      return found;
    }
    for (const point of this.points) {
      if (
        point.x >= range.x &&
        point.x <= range.x + range.w &&
        point.y >= range.y &&
        point.y <= range.y + range.h
      ) {
        found.push(point);
      }
    }
    if (this.divided) {
      this.northwest.query(range, found);
      this.northeast.query(range, found);
      this.southwest.query(range, found);
      this.southeast.query(range, found);
    }
    return found;
  }
}

const state = {
  nodes: [],
  messages: [],
  paused: false,
  dynamic: false,
  nextMessageId: 1,
  lastTime: 0,
  simTime: 0,
  timeScale: 1,
  ttl: 6,
  range: 110,
  nodeCount: 80,
  width: 1200,
  height: 720,
  dragNodeId: null,
  lastTransmissionCount: 0,
  lastMessageId: 0,
  onAirTime: 350,
  maxRelayWait: 500,
};

const palette = ["#f4c95d", "#5ce1e6", "#ff8a5c", "#f57ad2", "#9bff8f"];

function randomRange(min, max) {
  return min + Math.random() * (max - min);
}

function resizeCanvas(width, height, dpr) {
  state.width = width;
  state.height = height;
  canvas.width = Math.floor(width * dpr);
  canvas.height = Math.floor(height * dpr);
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
}

function createNodes() {
  const padding = 40;
  state.nodes = Array.from({ length: state.nodeCount }, (_, id) => ({
    id,
    x: randomRange(padding, state.width - padding),
    y: randomRange(padding, state.height - padding),
    vx: randomRange(-0.4, 0.4),
    vy: randomRange(-0.4, 0.4),
    pinned: false,
    received: new Set(),
    pulses: [],
  }));
}

function resetSimulation() {
  state.messages = [];
  state.nextMessageId = 1;
  createNodes();
}

function computeNeighbors() {
  const tree = new Quadtree({ x: 0, y: 0, w: state.width, h: state.height });
  for (const node of state.nodes) {
    tree.insert({ x: node.x, y: node.y, id: node.id });
  }

  const neighbors = Array.from({ length: state.nodes.length }, () => []);
  for (const node of state.nodes) {
    const range = {
      x: node.x - state.range,
      y: node.y - state.range,
      w: state.range * 2,
      h: state.range * 2,
    };
    const candidates = tree.query(range);
    const nearby = [];
    for (const candidate of candidates) {
      if (candidate.id === node.id) {
        continue;
      }
      const dx = node.x - candidate.x;
      const dy = node.y - candidate.y;
      if (dx * dx + dy * dy <= state.range * state.range) {
        nearby.push(candidate.id);
      }
    }
    neighbors[node.id] = nearby;
  }
  return neighbors;
}

function injectMessage(originNode) {
  const id = state.nextMessageId++;
  const color = palette[(id - 1) % palette.length];
  const now = state.simTime;
  const message = {
    id,
    color,
    transmitQueue: [{ nodeId: originNode.id, readyAt: now, hop: 0 }],
    pendingReceives: [],
    seen: new Set([originNode.id]),
    transmissions: 0,
  };
  state.messages.push(message);
  receiveMessage(originNode, message);
}

function receiveMessage(node, message) {
  node.received.add(message.id);
}

function emitPulse(node, message) {
  node.pulses.push({ color: message.color, age: 0, duration: state.onAirTime });
}

function updateMessages(neighbors, now) {
  for (const message of state.messages) {
    if (message.pendingReceives.length > 0) {
      const remainingReceives = [];
      for (const receiveEvent of message.pendingReceives) {
        if (receiveEvent.time > now) {
          remainingReceives.push(receiveEvent);
          continue;
        }
        const receiver = state.nodes[receiveEvent.nodeId];
        const sender = state.nodes[receiveEvent.fromId];
        if (!receiver || !sender) {
          continue;
        }
        receiveMessage(receiver, message);
        const dx = receiver.x - sender.x;
        const dy = receiver.y - sender.y;
        const ratio = Math.min(1, Math.hypot(dx, dy) / state.range);
        const relayDelay = state.maxRelayWait * (1 - ratio);
        message.transmitQueue.push({
          nodeId: receiver.id,
          readyAt: now + relayDelay,
          hop: receiveEvent.hop,
        });
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
        if (transmitEvent.hop >= state.ttl) {
          continue;
        }
        const sender = state.nodes[transmitEvent.nodeId];
        if (!sender) {
          continue;
        }
        emitPulse(sender, message);
        for (const neighborId of neighbors[transmitEvent.nodeId]) {
          if (message.seen.has(neighborId)) {
            continue;
          }
          message.seen.add(neighborId);
          message.pendingReceives.push({
            nodeId: neighborId,
            fromId: transmitEvent.nodeId,
            time: now + state.onAirTime,
            hop: transmitEvent.hop + 1,
          });
          message.transmissions += 1;
        }
      }
      message.transmitQueue = remainingTransmits;
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
}

function updateNodes() {
  const padding = 30;
  for (const node of state.nodes) {
    if (node.pinned) {
      continue;
    }
    node.x += node.vx;
    node.y += node.vy;
    if (node.x < padding || node.x > state.width - padding) {
      node.vx *= -1;
    }
    if (node.y < padding || node.y > state.height - padding) {
      node.vy *= -1;
    }
  }
}

function updatePulses(delta) {
  for (const node of state.nodes) {
    node.pulses = node.pulses
      .map((pulse) => ({
        ...pulse,
        age: pulse.age + delta,
      }))
      .filter((pulse) => pulse.age < pulse.duration);
  }
}

function draw(neighbors) {
  ctx.clearRect(0, 0, state.width, state.height);

  ctx.lineWidth = 1;
  ctx.globalAlpha = 0.15;
  ctx.strokeStyle = "#6c7b91";
  for (let i = 0; i < neighbors.length; i += 1) {
    for (const j of neighbors[i]) {
      if (j > i) {
        ctx.beginPath();
        ctx.moveTo(state.nodes[i].x, state.nodes[i].y);
        ctx.lineTo(state.nodes[j].x, state.nodes[j].y);
        ctx.stroke();
      }
    }
  }
  ctx.globalAlpha = 1;

  for (const node of state.nodes) {
    for (const pulse of node.pulses) {
      const progress = pulse.duration > 0 ? pulse.age / pulse.duration : 1;
      const radius = Math.min(state.range, progress * state.range);
      ctx.beginPath();
      ctx.strokeStyle = pulse.color;
      ctx.globalAlpha = Math.max(0, 1 - progress);
      ctx.lineWidth = 2;
      ctx.arc(node.x, node.y, radius, 0, Math.PI * 2);
      ctx.stroke();
    }
  }
  ctx.globalAlpha = 1;

  for (const node of state.nodes) {
    ctx.beginPath();
    ctx.fillStyle = node.pinned ? "#f4c95d" : "#e6edf6";
    ctx.arc(node.x, node.y, 5, 0, Math.PI * 2);
    ctx.fill();
  }

  ctx.fillStyle = "#9fb0c5";
  ctx.font = "12px 'Space Grotesk', sans-serif";
  ctx.fillText(
    `Nodes: ${state.nodeCount} | Active floods: ${state.messages.length} | Last flood (#${state.lastMessageId}) transmissions: ${state.lastTransmissionCount}`,
    16,
    state.height - 16
  );
}

function findNodeAt(x, y) {
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

function tick(now) {
  const deltaReal = now - state.lastTime;
  state.lastTime = now;
  const delta = state.paused ? 0 : deltaReal * state.timeScale;
  if (!state.paused) {
    state.simTime += delta;
  }
  const simNow = state.simTime;

  if (!state.paused) {
    if (state.dynamic) {
      updateNodes();
    }
  }

  const neighbors = computeNeighbors();

  if (!state.paused) {
    updateMessages(neighbors, simNow);
    updatePulses(delta);
  }

  draw(neighbors);
  if (!useExternalClock) {
    scheduleFrame(tick);
  }
}

self.onmessage = (event) => {
  const { type, payload } = event.data;
  if (type === "init") {
    canvas = payload.canvas;
    ctx = canvas.getContext("2d");
    useExternalClock = Boolean(payload.externalClock);
    state.nodeCount = payload.nodeCount;
    state.range = payload.range;
    state.ttl = payload.ttl;
    state.timeScale = payload.timeScale ?? state.timeScale;
    resizeCanvas(payload.width, payload.height, payload.dpr);
    resetSimulation();
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
    resizeCanvas(payload.width, payload.height, payload.dpr);
    resetSimulation();
    return;
  }
  if (type === "pause") {
    state.paused = payload.paused;
    return;
  }
  if (type === "reset") {
    resetSimulation();
    return;
  }
  if (type === "setParams") {
    if (payload.nodeCount !== undefined) {
      state.nodeCount = payload.nodeCount;
    }
    if (payload.range !== undefined) {
      state.range = payload.range;
    }
    if (payload.ttl !== undefined) {
      state.ttl = payload.ttl;
    }
    if (payload.timeScale !== undefined) {
      state.timeScale = payload.timeScale;
    }
    return;
  }
  if (type === "click") {
    const node = findNodeAt(payload.x, payload.y);
    if (!node) {
      return;
    }
    if (payload.shiftKey) {
      node.pinned = !node.pinned;
      node.vx = randomRange(-0.4, 0.4);
      node.vy = randomRange(-0.4, 0.4);
      return;
    }
    injectMessage(node);
    return;
  }
  if (type === "dragStart") {
    const node = findNodeAt(payload.x, payload.y);
    if (!node) {
      state.dragNodeId = null;
      return;
    }
    state.dragNodeId = node.id;
    return;
  }
  if (type === "dragMove") {
    if (state.dragNodeId === null) {
      return;
    }
    const node = state.nodes[state.dragNodeId];
    if (!node) {
      return;
    }
    node.x = payload.x;
    node.y = payload.y;
    return;
  }
  if (type === "dragEnd") {
    state.dragNodeId = null;
  }
};
