function normalizeBandwidthHz(bandwidth) {
  if (!Number.isFinite(bandwidth) || bandwidth <= 0) {
    throw new Error(`Invalid bandwidth: ${bandwidth}`);
  }
  // Accept Hz or kHz. If it's small, assume kHz.
  return bandwidth <= 2000 ? bandwidth * 1000 : bandwidth;
}

function normalizeCodingRate(codingRate) {
  // LoRa CR is typically expressed as 4/5..4/8, represented as 1..4 in most formulas.
  // - 1 => 4/5
  // - 2 => 4/6
  // - 3 => 4/7
  // - 4 => 4/8
  if (typeof codingRate === "string") {
    const match = codingRate.trim().match(/^4\s*\/\s*([5-8])$/);
    if (!match) {
      throw new Error(`Invalid coding rate string: ${codingRate}`);
    }
    return Number(match[1]) - 4;
  }

  if (!Number.isFinite(codingRate)) {
    throw new Error(`Invalid coding rate: ${codingRate}`);
  }
  if (codingRate >= 5 && codingRate <= 8) {
    return codingRate - 4;
  }
  if (codingRate >= 1 && codingRate <= 4) {
    return codingRate;
  }
  throw new Error(`Invalid coding rate: ${codingRate}`);
}

export function loraSymbolTimeMs(spreadingFactor, bandwidth) {
  const sf = Number(spreadingFactor);
  if (!Number.isInteger(sf) || sf < 5 || sf > 12) {
    throw new Error(`Invalid spreading factor: ${spreadingFactor}`);
  }
  const bwHz = normalizeBandwidthHz(Number(bandwidth));
  const tSymSec = (2 ** sf) / bwHz;
  return tSymSec * 1000;
}

// Returns LoRa packet time-on-air in milliseconds.
// Defaults are tuned to your stated configuration:
// - Low Data Rate Optimizer: ON
// - Preamble: 16 symbols
// - Explicit header: enabled
// - CRC: enabled
// - Ramp time: NOT included (can be added optionally)
export function loraTimeOnAirMs(
  payloadBytes,
  spreadingFactor,
  bandwidth,
  codingRate,
  options = {}
) {
  const payloadLen = Number(payloadBytes);
  if (!Number.isInteger(payloadLen) || payloadLen < 0) {
    throw new Error(`Invalid payloadBytes: ${payloadBytes}`);
  }

  const sf = Number(spreadingFactor);
  if (!Number.isInteger(sf) || sf < 5 || sf > 12) {
    throw new Error(`Invalid spreadingFactor: ${spreadingFactor}`);
  }

  const bwHz = normalizeBandwidthHz(Number(bandwidth));
  const cr = normalizeCodingRate(codingRate);

  const preambleSymbols =
    options.preambleSymbols == null ? 16 : Number(options.preambleSymbols);
  if (!Number.isFinite(preambleSymbols) || preambleSymbols < 0) {
    throw new Error(`Invalid preambleSymbols: ${options.preambleSymbols}`);
  }

  const explicitHeader =
    options.explicitHeader == null ? true : Boolean(options.explicitHeader);
  const crcEnabled = options.crcEnabled == null ? true : Boolean(options.crcEnabled);
  const lowDataRateOptimize =
    options.lowDataRateOptimize == null
      ? true
      : Boolean(options.lowDataRateOptimize);

  const includeRampTime =
    options.includeRampTime == null ? false : Boolean(options.includeRampTime);
  const rampTimeUs = options.rampTimeUs == null ? 800 : Number(options.rampTimeUs);
  if (!Number.isFinite(rampTimeUs) || rampTimeUs < 0) {
    throw new Error(`Invalid rampTimeUs: ${options.rampTimeUs}`);
  }

  const de = lowDataRateOptimize ? 1 : 0;
  const ih = explicitHeader ? 0 : 1;
  const crc = crcEnabled ? 1 : 0;

  const tSymSec = (2 ** sf) / bwHz;
  const tPreambleSec = (preambleSymbols + 4.25) * tSymSec;

  const payloadSymbNb =
    8 +
    Math.max(
      Math.ceil(
        (8 * payloadLen - 4 * sf + 28 + 16 * crc - 20 * ih) /
          (4 * (sf - 2 * de))
      ) *
        (cr + 4),
      0
    );
  const tPayloadSec = payloadSymbNb * tSymSec;

  const timeOnAirSec = tPreambleSec + tPayloadSec;
  const rampSec = includeRampTime ? rampTimeUs / 1_000_000 : 0;
  return (timeOnAirSec + rampSec) * 1000;
}
