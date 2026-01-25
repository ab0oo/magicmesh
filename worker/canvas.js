export function resizeCanvas(state, canvas, ctx, width, height, dpr) {
  state.width = width;
  state.height = height;
  canvas.width = Math.floor(width * dpr);
  canvas.height = Math.floor(height * dpr);
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
}

