export function createPalette({ clamp, getDrawScale, pathNodeGlyph }) {
  function getNodePaletteLayout(state, drawScale) {
    const scale = clamp(drawScale || 1, 0.85, 1.2);
    const margin = 16;
    const padding = 12;
    const iconRadius = 6 * scale;
    const iconHitRadius = 18;
    const iconSpacing = 62;
    const gap = 12;
    const boxHeight = 74;
    const boxWidth = padding * 2 + iconSpacing * 2 + iconHitRadius * 2;
    const deleteWidth = 140;
    const x = margin;
    const y = state.height - margin - boxHeight;
    const iconY = y + 40;
    const iconX0 = x + padding + iconHitRadius;
    const icons = [
      {
        role: "ROUTER",
        x: iconX0 + 0 * iconSpacing,
        y: iconY,
        radius: iconRadius,
        hit: iconHitRadius,
        label: "Router",
      },
      {
        role: "CLIENT",
        x: iconX0 + 1 * iconSpacing,
        y: iconY,
        radius: iconRadius,
        hit: iconHitRadius,
        label: "Client",
      },
      {
        role: "CLIENT_MUTE",
        x: iconX0 + 2 * iconSpacing,
        y: iconY,
        radius: iconRadius,
        hit: iconHitRadius,
        label: "Mute",
      },
    ];
    const deleteBox = {
      x: x + boxWidth + gap,
      y,
      w: deleteWidth,
      h: boxHeight,
      label: "Drop to delete",
    };
    return { x, y, w: boxWidth + gap + deleteWidth, h: boxHeight, padding, icons, deleteBox };
  }

  function paletteRoleAt(state, x, y) {
    const layout = getNodePaletteLayout(state, getDrawScale(state));
    if (
      x < layout.x ||
      x > layout.x + layout.w ||
      y < layout.y ||
      y > layout.y + layout.h
    ) {
      return null;
    }
    for (const icon of layout.icons) {
      const dx = x - icon.x;
      const dy = y - icon.y;
      if (dx * dx + dy * dy <= icon.hit * icon.hit) {
        return icon.role;
      }
    }
    return null;
  }

  function paletteDeleteAt(state, x, y) {
    const layout = getNodePaletteLayout(state, getDrawScale(state));
    const box = layout.deleteBox;
    if (!box) {
      return false;
    }
    return x >= box.x && x <= box.x + box.w && y >= box.y && y <= box.y + box.h;
  }

  function drawNodePalette(state, ctx, drawScale) {
    const layout = getNodePaletteLayout(state, drawScale);
    ctx.save();
    ctx.globalAlpha = 1;
    ctx.fillStyle = "rgba(10, 15, 22, 0.72)";
    ctx.strokeStyle = "rgba(255, 255, 255, 0.12)";
    ctx.lineWidth = 1;
    const addBoxWidth = layout.w - layout.deleteBox.w - 12;
    ctx.beginPath();
    if (typeof ctx.roundRect === "function") {
      ctx.roundRect(layout.x, layout.y, addBoxWidth, layout.h, 12);
    } else {
      ctx.rect(layout.x, layout.y, addBoxWidth, layout.h);
    }
    ctx.fill();
    ctx.stroke();

    const overDelete =
      state.dragNodeId !== null &&
      state.dragPointer &&
      paletteDeleteAt(state, state.dragPointer.x, state.dragPointer.y);
    ctx.beginPath();
    ctx.fillStyle = "rgba(10, 15, 22, 0.72)";
    ctx.strokeStyle = overDelete ? "rgba(255, 74, 74, 0.9)" : "rgba(255, 255, 255, 0.12)";
    ctx.lineWidth = overDelete ? 2 : 1;
    if (typeof ctx.roundRect === "function") {
      ctx.roundRect(layout.deleteBox.x, layout.deleteBox.y, layout.deleteBox.w, layout.deleteBox.h, 12);
    } else {
      ctx.rect(layout.deleteBox.x, layout.deleteBox.y, layout.deleteBox.w, layout.deleteBox.h);
    }
    ctx.fill();
    ctx.stroke();

    ctx.font = "11px 'Space Grotesk', sans-serif";
    ctx.fillStyle = "rgba(243, 247, 255, 0.9)";
    ctx.fillText("Add node", layout.x + layout.padding, layout.y + 16);
    ctx.fillStyle = overDelete ? "rgba(255, 180, 180, 0.95)" : "rgba(243, 247, 255, 0.9)";
    ctx.fillText(layout.deleteBox.label, layout.deleteBox.x + layout.padding, layout.deleteBox.y + 16);

    ctx.save();
    ctx.globalAlpha = overDelete ? 0.95 : 0.8;
    ctx.strokeStyle = overDelete ? "rgba(255, 74, 74, 0.95)" : "rgba(159, 176, 197, 0.9)";
    ctx.lineWidth = 3;
    const cx = layout.deleteBox.x + layout.deleteBox.w / 2;
    const cy = layout.deleteBox.y + 44;
    const size = 14;
    ctx.beginPath();
    ctx.moveTo(cx - size, cy - size);
    ctx.lineTo(cx + size, cy + size);
    ctx.moveTo(cx - size, cy + size);
    ctx.lineTo(cx + size, cy - size);
    ctx.stroke();
    ctx.restore();

    for (const icon of layout.icons) {
      ctx.save();
      ctx.globalAlpha = 0.95;
      ctx.fillStyle = "#f3f7ff";
      ctx.beginPath();
      pathNodeGlyph(ctx, { x: icon.x, y: icon.y, role: icon.role }, icon.radius);
      ctx.closePath();
      ctx.fill();
      ctx.restore();

      ctx.fillStyle = "rgba(159, 176, 197, 0.95)";
      const textWidth = ctx.measureText(icon.label).width;
      ctx.fillText(icon.label, icon.x - textWidth / 2, layout.y + layout.h - 10);
    }

    ctx.restore();
    return layout;
  }

  return { paletteRoleAt, paletteDeleteAt, drawNodePalette };
}
