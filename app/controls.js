function computeMaxDistanceMeters(linkBudgetDb, frequencyMHz, pathLossExp) {
  const freq = Number(frequencyMHz);
  const exp = Number(pathLossExp);
  if (!Number.isFinite(linkBudgetDb) || !Number.isFinite(freq) || !Number.isFinite(exp)) {
    return null;
  }
  if (freq <= 0 || exp <= 0) {
    return null;
  }
  const denom = 10 * exp;
  const base = linkBudgetDb - 32.44 - 20 * Math.log10(freq);
  const distanceKm = Math.pow(10, base / denom);
  if (!Number.isFinite(distanceKm) || distanceKm <= 0) {
    return null;
  }
  return distanceKm * 1000;
}

function formatDurationMs(ms) {
  if (!Number.isFinite(ms) || ms <= 0) {
    return "—";
  }
  if (ms >= 1000) {
    return `${(ms / 1000).toFixed(2)} s`;
  }
  if (ms >= 100) {
    return `${ms.toFixed(0)} ms`;
  }
  return `${ms.toFixed(1)} ms`;
}

export function createRfControls({ withVersion, rangeInput, modPresetSelect, packetSizeInput, toaValueEl }) {
  const RF_FIXED = {
    frequencyMHz: 915,
    pathLossExp: 2.0,
    txPower: 24,
    txGain: 3,
    rxGain: 3,
    noiseFloor: -120,
  };

  const LORA_FIXED = {
    // Default simulated packet size (PHY payload length).
    payloadBytes: 20,
    codingRate: "4/5",
    preambleSymbols: 16,
    explicitHeader: true,
    crcEnabled: true,
    lowDataRateOptimize: true,
  };

  const modulationPresets = {
    short_turbo: { linkBudgetDb: 140, sf: 7, bwHz: 500000 },
    short_fast: { linkBudgetDb: 143, sf: 7, bwHz: 250000 },
    short_slow: { linkBudgetDb: 145.5, sf: 8, bwHz: 250000 },
    medium_fast: { linkBudgetDb: 148, sf: 9, bwHz: 250000 },
    medium_slow: { linkBudgetDb: 150.5, sf: 10, bwHz: 250000 },
    long_turbo: { linkBudgetDb: 150, sf: 11, bwHz: 500000 },
    long_fast: { linkBudgetDb: 153, sf: 11, bwHz: 250000 },
    long_moderate: { linkBudgetDb: 156, sf: 11, bwHz: 125000 },
    long_slow: { linkBudgetDb: 158.5, sf: 12, bwHz: 125000 },
  };

  let loraTimeOnAirMs = null;

  const clampPacketSizeBytes = (value) => {
    const parsed = Number(value);
    if (!Number.isFinite(parsed)) {
      return LORA_FIXED.payloadBytes;
    }
    return Math.max(20, Math.min(250, Math.round(parsed)));
  };

  const getSelectedModulation = () => {
    const value = modPresetSelect.value;
    if (value === "manual") {
      // Manual range uses Long/Fast modulation timing.
      return modulationPresets.long_fast;
    }
    return modulationPresets[value] || modulationPresets.long_fast;
  };

  const getSelectedLoraParams = () => {
    const modulation = getSelectedModulation();
    const payloadBytes = packetSizeInput
      ? clampPacketSizeBytes(packetSizeInput.value)
      : LORA_FIXED.payloadBytes;
    return {
      loraPayloadBytes: payloadBytes,
      loraSpreadingFactor: modulation.sf,
      loraBandwidthHz: modulation.bwHz,
      loraCodingRate: LORA_FIXED.codingRate,
      loraPreambleSymbols: LORA_FIXED.preambleSymbols,
      loraExplicitHeader: LORA_FIXED.explicitHeader,
      loraCrcEnabled: LORA_FIXED.crcEnabled,
      loraLowDataRateOptimize: LORA_FIXED.lowDataRateOptimize,
    };
  };

  const updateOnAirDisplay = () => {
    if (!toaValueEl) {
      return;
    }
    if (typeof loraTimeOnAirMs !== "function") {
      toaValueEl.textContent = "—";
      return;
    }
    const modulation = getSelectedModulation();
    const payloadBytes = packetSizeInput
      ? clampPacketSizeBytes(packetSizeInput.value)
      : LORA_FIXED.payloadBytes;
    try {
      const ms = loraTimeOnAirMs(
        payloadBytes,
        modulation.sf,
        modulation.bwHz,
        LORA_FIXED.codingRate,
        {
          preambleSymbols: LORA_FIXED.preambleSymbols,
          explicitHeader: LORA_FIXED.explicitHeader,
          crcEnabled: LORA_FIXED.crcEnabled,
          lowDataRateOptimize: LORA_FIXED.lowDataRateOptimize,
          includeRampTime: false,
        }
      );
      toaValueEl.textContent = formatDurationMs(ms);
    } catch {
      toaValueEl.textContent = "—";
    }
  };

  const initAirtime = () =>
    import(withVersion("../lora_airtime.js"))
      .then((mod) => {
        loraTimeOnAirMs = typeof mod.loraTimeOnAirMs === "function" ? mod.loraTimeOnAirMs : null;
        updateOnAirDisplay();
      })
      .catch(() => {
        updateOnAirDisplay();
      });

  const computeMetersPerPixel = () => {
    const calibrationTargetPx = Number(rangeInput?.value) || 110;
    const linkBudgetRangeMeters = computeMaxDistanceMeters(
      145.5, // Short Slow (SF8/BW250)
      RF_FIXED.frequencyMHz,
      RF_FIXED.pathLossExp
    );
    // Now that curvature LOS is modeled (perfect sphere), don’t calibrate the canvas
    // to hundreds of km/px. Cap the "reference range" to the maximum two-way radio
    // horizon for the default antenna height.
    const earthRadiusM = 6371000;
    const h = 2; // default node height above local ground
    const horizonMeters = Math.sqrt(2 * earthRadiusM * h + h * h);
    const maxLosMeters = horizonMeters * 2;
    const calibrationRangeMeters = Math.min(
      Number.isFinite(linkBudgetRangeMeters) ? linkBudgetRangeMeters : maxLosMeters,
      maxLosMeters
    );
    return Math.max(
      1,
      Math.round(
        (calibrationRangeMeters || 10 * calibrationTargetPx) / Math.max(1, calibrationTargetPx)
      )
    );
  };

  return {
    RF_FIXED,
    LORA_FIXED,
    modulationPresets,
    initAirtime,
    clampPacketSizeBytes,
    getSelectedLoraParams,
    getSelectedModulation,
    updateOnAirDisplay,
    computeMetersPerPixel,
  };
}

export function bindControls({
  nodeCountInput,
  rangeInput,
  timeScaleInput,
  ttlInput,
  modPresetSelect,
  packetSizeInput,
  resetMapToggleState,
  terrainTypeSelect,
  regenTerrainButton,
  sendParams,
  workerPost,
  modulationPresets,
  clampPacketSizeBytes,
}) {
  nodeCountInput.addEventListener("input", () => {
    resetMapToggleState();
    sendParams({ coordinateMode: "random", mapScale: 1, nodeCount: Number(nodeCountInput.value) });
    workerPost("reset");
  });

  rangeInput.addEventListener("input", () => {
    sendParams({ range: Number(rangeInput.value) });
  });

  modPresetSelect.addEventListener("change", () => {
    const value = modPresetSelect.value;
    const preset = modulationPresets[value];
    const useLinkBudget = value !== "manual" && Boolean(preset);
    rangeInput.disabled = useLinkBudget;
    sendParams({
      useLinkBudget,
      linkBudgetDb: useLinkBudget && preset ? preset.linkBudgetDb : null,
    });
  });

  if (terrainTypeSelect) {
    terrainTypeSelect.addEventListener("change", () => {
        workerPost("generateProceduralTerrain", { terrainType: terrainTypeSelect.value });
    });
  }

  if (regenTerrainButton && terrainTypeSelect) {
    regenTerrainButton.addEventListener("click", () => {
        workerPost("generateProceduralTerrain", { terrainType: terrainTypeSelect.value });
    });
  }

  if (packetSizeInput) {
    packetSizeInput.addEventListener("input", () => {
      const normalized = clampPacketSizeBytes(packetSizeInput.value);
      if (String(normalized) !== packetSizeInput.value) {
        packetSizeInput.value = String(normalized);
      }
      sendParams();
    });
  }

  timeScaleInput.addEventListener("input", () => {
    sendParams({ timeScale: Number(timeScaleInput.value) });
  });

  ttlInput.addEventListener("input", () => {
    sendParams({ ttl: Number(ttlInput.value) });
  });

  window.addEventListener("keydown", (event) => {
    if (event.key.toLowerCase() !== "d") {
      return;
    }
    workerPost("toggleDebug");
  });
}
