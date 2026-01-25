export function randomRange(min, max) {
  return min + Math.random() * (max - min);
}

export function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

export function randomIntInclusive(max) {
  const upper = Math.floor(max);
  if (upper <= 0) {
    return 0;
  }
  return Math.floor(Math.random() * (upper + 1));
}

export function getDrawScale(state) {
  const baseScale = state.mapScale > 0 ? 1 / Math.sqrt(state.mapScale) : 1;
  return state.coordinateMode === "live" ? clamp(baseScale, 0.75, 1.25) : baseScale;
}

export function formatDistance(meters) {
  if (!Number.isFinite(meters) || meters < 0) {
    return "";
  }
  if (meters >= 1000) {
    const km = meters / 1000;
    const label =
      Math.abs(km - Math.round(km)) < 1e-9 ? String(Math.round(km)) : km.toFixed(1);
    return `${label} km`;
  }
  return `${Math.round(meters)} m`;
}

export function chooseNiceScaleMeters(targetMeters) {
  if (!Number.isFinite(targetMeters) || targetMeters <= 0) {
    return 1000;
  }
  const exponent = Math.floor(Math.log10(targetMeters));
  const base = targetMeters / 10 ** exponent;
  const steps = [1, 2, 5, 10];
  let best = steps[0];
  for (const step of steps) {
    if (base <= step) {
      best = step;
      break;
    }
    best = step;
  }
  return best * 10 ** exponent;
}

