export function createGlyphs() {
  function pathTriangle(ctx, x, y, radius) {
    const height = radius;
    const halfBase = radius * 0.9;
    ctx.moveTo(x, y - height);
    ctx.lineTo(x - halfBase, y + height);
    ctx.lineTo(x + halfBase, y + height);
    ctx.closePath();
  }

  function pathStar(ctx, x, y, outerRadius, innerRadius, points = 5) {
    const step = Math.PI / points;
    const start = -Math.PI / 2;
    for (let i = 0; i < points * 2; i += 1) {
      const angle = start + step * i;
      const radius = i % 2 === 0 ? outerRadius : innerRadius;
      const px = x + Math.cos(angle) * radius;
      const py = y + Math.sin(angle) * radius;
      if (i === 0) {
        ctx.moveTo(px, py);
      } else {
        ctx.lineTo(px, py);
      }
    }
    ctx.closePath();
  }

  function pathNodeGlyph(ctx, node, radius) {
    if (node.role === "ROUTER") {
      pathStar(ctx, node.x, node.y, radius * 1.55, radius * 0.7);
      return;
    }
    if (node.role === "CLIENT_MUTE") {
      pathTriangle(ctx, node.x, node.y, radius * 1.25);
      return;
    }
    ctx.arc(node.x, node.y, radius, 0, Math.PI * 2);
  }

  return { pathNodeGlyph };
}

