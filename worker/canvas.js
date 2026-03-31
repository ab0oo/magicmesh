export function resizeCanvas(state, canvas, ctx, width, height, dpr) {
  const w = Math.floor(width);
  const h = Math.floor(height);
  state.width = w;
  state.height = h;
  canvas.width = Math.floor(w * dpr);
  canvas.height = Math.floor(h * dpr);
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
}
