export function createRadio({ clamp, randomRange, randomIntInclusive }) {
  function hasLineOfSightCurvature(distanceMeters, heightAMeters, heightBMeters, earthRadiusM) {
    const d = Number(distanceMeters);
    if (!Number.isFinite(d) || d <= 0) {
      return true;
    }
    const R = Number(earthRadiusM);
    if (!Number.isFinite(R) || R <= 0) {
      return true;
    }
    const h1 = Math.max(0, Number(heightAMeters) || 0);
    const h2 = Math.max(0, Number(heightBMeters) || 0);
    const horizon1 = Math.sqrt(2 * R * h1 + h1 * h1);
    const horizon2 = Math.sqrt(2 * R * h2 + h2 * h2);
    if (!Number.isFinite(horizon1) || !Number.isFinite(horizon2)) {
      return true;
    }
    return d <= horizon1 + horizon2;
  }

  function updateEffectiveRange(state) {
    if (!state.useLinkBudget) {
      state.effectiveRange = state.range;
      return;
    }

    let linkBudget = null;
    if (typeof state.linkBudgetDb === "number") {
      linkBudget = state.linkBudgetDb;
    } else if (
      Number.isFinite(state.txPower) &&
      Number.isFinite(state.txGain) &&
      Number.isFinite(state.rxGain) &&
      Number.isFinite(state.noiseFloor)
    ) {
      linkBudget = state.txPower + state.txGain + state.rxGain - state.noiseFloor;
    }

    if (linkBudget === null) {
      state.effectiveRange = state.range;
      return;
    }

    const freq = state.frequencyMHz || 915;
    const pathLossExp = state.pathLossExp || 2.0;
    const denom = 10 * pathLossExp;
    const base = linkBudget - 32.44 - 20 * Math.log10(freq);
    const distanceKm = Math.pow(10, base / denom);
    state.effectiveRange = Math.max(1, distanceKm * 1000);
  }

  function updateRadioTiming(state, loraFns) {
    const { loraTimeOnAirMs, loraSymbolTimeMs } = loraFns || {};
    if (typeof loraTimeOnAirMs !== "function") {
      return;
    }

    const payloadBytes = Number(state.loraPayloadBytes);
    const sf = Number(state.loraSpreadingFactor);
    const bw = Number(state.loraBandwidthHz);
    const codingRate = state.loraCodingRate || "4/5";

    try {
      const onAirTimeMs = loraTimeOnAirMs(payloadBytes, sf, bw, codingRate, {
        preambleSymbols: state.loraPreambleSymbols,
        explicitHeader: state.loraExplicitHeader,
        crcEnabled: state.loraCrcEnabled,
        lowDataRateOptimize: state.loraLowDataRateOptimize,
        includeRampTime: false,
      });
      if (Number.isFinite(onAirTimeMs) && onAirTimeMs > 0) {
        state.onAirTime = onAirTimeMs;
      }
    } catch {
      // Keep previous onAirTime.
    }

    if (typeof loraSymbolTimeMs !== "function") {
      return;
    }

    try {
      const symMs = loraSymbolTimeMs(sf, bw);
      if (Number.isFinite(symMs) && symMs > 0) {
        state.slotTimeMsec = Math.max(10, Math.round(symMs * 4));
        state.cadTimeMsec = Math.max(2, Math.round(symMs * 2));
      }
    } catch {
      // Keep previous slot/cad.
    }
  }

  function estimateCwSizeFromSnr(state, snrDb) {
    const min = state.snrMinDb;
    const max = state.snrMaxDb;
    if (!Number.isFinite(snrDb) || !Number.isFinite(min) || !Number.isFinite(max)) {
      return clamp(1, 1, state.cwMax);
    }
    if (max === min) {
      return clamp(1, 1, state.cwMax);
    }
    const t = clamp((snrDb - min) / (max - min), 0, 1);
    const cw = Math.round(1 + t * (state.cwMax - 1));
    return clamp(cw, 1, state.cwMax);
  }

  function estimateRxSnr(state, sender, receiver, getNodeRange) {
    const rangePx = Math.max(1, getNodeRange(sender));
    const dx = receiver.x - sender.x;
    const dy = receiver.y - sender.y;
    const ratio = clamp(Math.hypot(dx, dy) / rangePx, 0, 1);
    const min = state.snrMinDb;
    const max = state.snrMaxDb;
    let snr = max - ratio * (max - min);
    const jitter = Number.isFinite(state.snrJitterDb) ? state.snrJitterDb : 0;
    if (jitter > 0) {
      snr += randomRange(-jitter, jitter);
    }
    return snr;
  }

  function computeRebroadcastDelayMsec(state, role, cwSize) {
    const slot = state.slotTimeMsec;
    if (!Number.isFinite(slot) || slot <= 0) {
      return 0;
    }
    const cw = clamp(cwSize, 1, state.cwMax);

    if (role === "ROUTER") {
      const slots = randomIntInclusive(2 * cw);
      return slots * slot;
    }

    const offset = 2 * state.cwMax * slot;
    const windowSlots = 2 ** cw;
    const slots = randomIntInclusive(windowSlots);
    return offset + slots * slot;
  }

  return {
    updateEffectiveRange,
    updateRadioTiming,
    estimateCwSizeFromSnr,
    estimateRxSnr,
    computeRebroadcastDelayMsec,
    hasLineOfSightCurvature,
  };
}
