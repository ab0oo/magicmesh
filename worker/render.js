export function createRenderer({
  clamp,
  getDrawScale,
  formatDistance,
  chooseNiceScaleMeters,
  defaultNodeColor,
  pathNodeGlyph,
  drawNodePalette,
}) {
  function formatDurationMs(ms) {
    if (!Number.isFinite(ms) || ms < 0) {
      return "—";
    }
    if (ms >= 10000) {
      return `${(ms / 1000).toFixed(1)} s`;
    }
    if (ms >= 1000) {
      return `${(ms / 1000).toFixed(2)} s`;
    }
    if (ms >= 100) {
      return `${ms.toFixed(0)} ms`;
    }
    return `${ms.toFixed(1)} ms`;
  }

  function drawScaleBar(state, ctx, bottomOffset = 0) {
    if (state.coordinateMode !== "random") {
      return;
    }
    if (!Number.isFinite(state.metersPerPixel) || state.metersPerPixel <= 0) {
      return;
    }

    const mapScale = Number.isFinite(state.mapScale) && state.mapScale > 0 ? state.mapScale : 1;
    const metersPerScreenPx = state.metersPerPixel / mapScale;
    if (!Number.isFinite(metersPerScreenPx) || metersPerScreenPx <= 0) {
      return;
    }

    const margin = 16;
    const barHeight = 6;
    const available = Math.max(0, state.width - margin * 2);
    const targetPx = Math.min(220, Math.max(90, available * 0.18));
    const targetMeters = targetPx * metersPerScreenPx;
    const barMeters = chooseNiceScaleMeters(targetMeters);
    const barPx = Math.max(20, Math.min(available, barMeters / metersPerScreenPx));

    const yBase = state.height - 2 - bottomOffset;
    const x1 = state.width - margin;
    const x0 = x1 - barPx;

    ctx.save();
    ctx.globalAlpha = 1;
    ctx.lineCap = "butt";

    const label1 = formatDistance(barMeters);
    const metersPerPxLabel =
      metersPerScreenPx >= 10
        ? metersPerScreenPx.toFixed(0)
        : metersPerScreenPx >= 1
          ? metersPerScreenPx.toFixed(1)
          : metersPerScreenPx.toFixed(2);
    const label2 = `${metersPerPxLabel} m/px`;
    ctx.font = "12px 'Space Grotesk', sans-serif";
    const textWidth = Math.max(
      ctx.measureText(label1).width,
      ctx.measureText(label2).width
    );
    const boxWidth = Math.min(available, Math.max(textWidth + 16, barPx + 16));
    const boxHeight = 34;
    ctx.fillStyle = "rgba(10, 15, 22, 0.78)";
    ctx.strokeStyle = "rgba(255, 255, 255, 0.12)";
    ctx.lineWidth = 1;
    ctx.beginPath();
    const boxX = x1 - boxWidth + 8;
    const boxY = yBase - boxHeight - 8;
    if (typeof ctx.roundRect === "function") {
      ctx.roundRect(boxX, boxY, boxWidth, boxHeight, 10);
    } else {
      ctx.rect(boxX, boxY, boxWidth, boxHeight);
    }
    ctx.fill();
    ctx.stroke();

    ctx.strokeStyle = "rgba(243, 247, 255, 0.9)";
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.moveTo(x0, yBase);
    ctx.lineTo(x1, yBase);
    ctx.stroke();

    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(x0, yBase - barHeight);
    ctx.lineTo(x0, yBase);
    ctx.moveTo(x1, yBase - barHeight);
    ctx.lineTo(x1, yBase);
    ctx.stroke();

    ctx.fillStyle = "rgba(243, 247, 255, 0.95)";
    ctx.fillText(label1, boxX + 8, boxY + 14);
    ctx.fillStyle = "rgba(159, 176, 197, 0.95)";
    ctx.fillText(label2, boxX + 8, boxY + 30);

    ctx.restore();
  }

  function draw(state, ctx, neighbors) {
    ctx.clearRect(0, 0, state.width, state.height);
    const drawScale = getDrawScale(state);

    if (state.terrainLayer) {
      ctx.save();
      ctx.globalAlpha = 0.45;
      ctx.imageSmoothingEnabled = true;
      ctx.drawImage(state.terrainLayer, 0, 0, state.width, state.height);
      ctx.restore();
    }

    const paletteLayout = drawNodePalette(state, ctx, drawScale);
    drawScaleBar(state, ctx, 0);

    ctx.lineWidth = 1.3 * drawScale;
    ctx.globalAlpha = 0.22;
    ctx.strokeStyle = "#8a9bb4";
    for (const [i, j] of neighbors.edges) {
      ctx.beginPath();
      ctx.moveTo(state.nodes[i].x, state.nodes[i].y);
      ctx.lineTo(state.nodes[j].x, state.nodes[j].y);
      ctx.stroke();
    }
    ctx.globalAlpha = 1;

    for (const node of state.nodes) {
      for (const pulse of node.pulses) {
        const progress = pulse.duration > 0 ? pulse.age / pulse.duration : 1;
        const radius = Math.min(pulse.maxRange, progress * pulse.maxRange);
        ctx.beginPath();
        ctx.strokeStyle = pulse.color;
        ctx.globalAlpha = Math.max(0, 1 - progress);
        ctx.lineWidth = 2 * drawScale;
        ctx.arc(node.x, node.y, radius, 0, Math.PI * 2);
        ctx.stroke();
      }
    }
    ctx.globalAlpha = 1;

    for (const node of state.nodes) {
      if (!(node?.uiRings instanceof Array) || node.uiRings.length === 0) {
        continue;
      }
      for (const ring of node.uiRings) {
        const durationMs = Number(ring?.durationMs);
        const ageMs = Number(ring?.ageMs);
        const fromRadiusPx = Number(ring?.fromRadiusPx);
        const toRadiusPx = Number(ring?.toRadiusPx);
        if (!Number.isFinite(durationMs) || durationMs <= 0) {
          continue;
        }
        if (!Number.isFinite(ageMs) || ageMs < 0) {
          continue;
        }
        if (!Number.isFinite(fromRadiusPx) || fromRadiusPx <= 0) {
          continue;
        }
        if (!Number.isFinite(toRadiusPx) || toRadiusPx <= 0) {
          continue;
        }
        const progress = clamp(ageMs / durationMs, 0, 1);
        const eased = 1 - (1 - progress) * (1 - progress) * (1 - progress);
        const radiusPx = fromRadiusPx + (toRadiusPx - fromRadiusPx) * eased;
        ctx.save();
        ctx.strokeStyle = typeof ring.color === "string" ? ring.color : "#5ce1e6";
        ctx.globalAlpha = 0.9 * (1 - progress);
        ctx.lineWidth = 2.5 * drawScale;
        ctx.beginPath();
        ctx.arc(node.x, node.y, radiusPx, 0, Math.PI * 2);
        ctx.stroke();
        ctx.restore();
      }
    }

    for (const node of state.nodes) {
      ctx.fillStyle = node.lastColor ?? defaultNodeColor;
      if (node.collisionUntil > state.simTime) {
        ctx.fillStyle = "#ff4a4a";
      }
      const radius = 5 * drawScale;
      ctx.beginPath();
      pathNodeGlyph(ctx, node, radius);
      ctx.closePath();
      ctx.fill();

      if (node.pendingTransmits instanceof Map && node.pendingTransmits.size > 0) {
        let next = null;
        for (const entry of node.pendingTransmits.values()) {
          if (!entry || !Number.isFinite(entry.readyAt) || !Number.isFinite(entry.startAt)) {
            continue;
          }
          if (entry.readyAt <= state.simTime) {
            continue;
          }
          if (next === null || entry.readyAt < next.readyAt) {
            next = entry;
          }
        }
        if (next) {
          const duration = next.readyAt - next.startAt;
          const remaining = next.readyAt - state.simTime;
          const fraction = duration > 0 ? clamp(remaining / duration, 0, 1) : 0;
          if (fraction > 0) {
            const ringWidth = 2 * drawScale;
            const ringRadius = radius + 3 * drawScale;
            const startAngle = -Math.PI / 2;
            const direction = typeof next.direction === "string" ? next.direction : "ccw";
            const clockwise = direction === "cw";
            const endAngle = clockwise
              ? startAngle - Math.PI * 2 * fraction
              : startAngle + Math.PI * 2 * fraction;
            ctx.save();
            ctx.strokeStyle = typeof next.color === "string" ? next.color : "#f4c95d";
            ctx.globalAlpha = 0.9;
            ctx.lineWidth = ringWidth;
            ctx.beginPath();
            ctx.arc(node.x, node.y, ringRadius, startAngle, endAngle, clockwise);
            ctx.stroke();
            ctx.restore();
          }
        }
      }

      if (node.pinned) {
        ctx.lineWidth = 2 * drawScale;
        ctx.strokeStyle = "#f4c95d";
        ctx.beginPath();
        pathNodeGlyph(ctx, node, radius);
        ctx.closePath();
        ctx.stroke();
      }
    }

    if (state.dragNewRole) {
      ctx.save();
      ctx.globalAlpha = 0.7;
      ctx.fillStyle = "#f4c95d";
      const radius = 6 * clamp(drawScale, 0.85, 1.2);
      ctx.beginPath();
      pathNodeGlyph(
        ctx,
        { x: state.dragPointer.x, y: state.dragPointer.y, role: state.dragNewRole },
        radius
      );
      ctx.closePath();
      ctx.fill();
      ctx.restore();
    }

    if (state.hoverNodeId !== null) {
      const node = state.nodes[state.hoverNodeId];
      if (node) {
        const heightM =
          typeof node.heightM === "number"
            ? node.heightM
            : typeof state.defaultNodeHeightM === "number"
              ? state.defaultNodeHeightM
              : 2;
        const lines = [
          `Node ${node.nodeId}`,
          `Role: ${node.role ?? "CLIENT"}`,
          `Height: ${heightM.toFixed(1)} m AGL`,
          typeof node.elevation === "number"
            ? `Ground elev: ${node.elevation.toFixed(1)} m`
            : null,
        ];
        const displayLines = lines.filter((line) => typeof line === "string");
        ctx.font = "12px 'Space Grotesk', sans-serif";
        const padding = 8;
        const lineHeight = 16;
        const width = Math.max(...displayLines.map((line) => ctx.measureText(line).width));
        const boxWidth = width + padding * 2;
        const boxHeight = lineHeight * displayLines.length + padding * 2;
        let boxX = node.x + 12;
        let boxY = node.y - boxHeight - 12;
        if (boxX + boxWidth > state.width - 8) {
          boxX = node.x - boxWidth - 12;
        }
        if (boxY < 8) {
          boxY = node.y + 12;
        }
        ctx.fillStyle = "rgba(10, 15, 22, 0.85)";
        ctx.strokeStyle = "rgba(255, 255, 255, 0.15)";
        ctx.lineWidth = 1;
        ctx.beginPath();
        if (typeof ctx.roundRect === "function") {
          ctx.roundRect(boxX, boxY, boxWidth, boxHeight, 8);
        } else {
          ctx.rect(boxX, boxY, boxWidth, boxHeight);
        }
        ctx.fill();
        ctx.stroke();
        ctx.fillStyle = "#f3f7ff";
        for (let i = 0; i < displayLines.length; i += 1) {
          ctx.fillText(
            displayLines[i],
            boxX + padding,
            boxY + padding + lineHeight * (i + 0.75)
          );
        }
      }
    }

    ctx.fillStyle = "#9fb0c5";
    ctx.font = "12px 'Space Grotesk', sans-serif";
    const statusX = Math.min(state.width - 16, paletteLayout.x + paletteLayout.w + 12);
    const activeMessageId =
      state.messages.length > 0 && typeof state.messages[state.messages.length - 1]?.id === "number"
        ? state.messages[state.messages.length - 1].id
        : null;
    const receivedFor =
      typeof activeMessageId === "number"
        ? activeMessageId
        : typeof state.lastMessageId === "number"
          ? state.lastMessageId
          : null;
    let receivedCount = 0;
    if (typeof receivedFor === "number") {
      for (const node of state.nodes) {
        if (node?.received instanceof Set && node.received.has(receivedFor)) {
          receivedCount += 1;
        }
      }
    }
    ctx.fillText(
      `Nodes: ${state.nodeCount} | Active floods: ${state.messages.length} | Received: ${receivedCount} | Last flood (#${state.lastMessageId}) transmissions: ${state.lastTransmissionCount} | Elapsed: ${formatDurationMs(state.lastFloodElapsedMs)}`,
      statusX,
      state.height - 16
    );
  }

  return { draw };
}
