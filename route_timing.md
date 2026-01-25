# Meshtastic mesh retransmission / rebroadcast timing (by role)

This note summarizes how the firmware schedules **rebroadcast/relay transmissions** (i.e., “flooding” rebroadcasts and related timing/backoff behavior) based on device role, as implemented in `src/mesh`.

## Where timing is decided

- TX queue scheduling and “random delay before TX” is driven by the radio helper thread in `src/mesh/RadioLibInterface.cpp:256` and `src/mesh/RadioLibInterface.cpp:306`.
- The random backoff windows are computed in `src/mesh/RadioInterface.cpp:263` (`getTxDelayMsec`) and `src/mesh/RadioInterface.cpp:306` (`getTxDelayMsecWeighted`).
- `slotTimeMsec` (the base unit for these backoffs) is derived from LoRa SF/BW plus CAD/processing overhead in `src/mesh/RadioInterface.cpp:639`.

## Key concepts

- **Normal TX backoff** (any outgoing send / locally-generated traffic):
  - `delay = random(0, 2^CWsize) * slotTimeMsec` where `CWsize` is based on channel utilization (`src/mesh/RadioInterface.cpp:263`).
- **Flooding rebroadcast backoff** (rebroadcast of a received packet):
  - `CWsize` is derived from packet SNR (`src/mesh/RadioInterface.cpp:275`).
  - Role determines whether the rebroadcast happens “early” or “late” (router-first behavior), via `src/mesh/RadioInterface.cpp:295`.

## Role-based rebroadcast timing

### `ROUTER`

- **Early rebroadcast window**:
  - `delay = random(0, 2*CWsize) * slotTimeMsec`
  - Implemented when `shouldRebroadcastEarlyLikeRouter()` returns true (`src/mesh/RadioInterface.cpp:295`, `src/mesh/RadioInterface.cpp:306`).
- **Duplicate handling**: never cancels a pending rebroadcast just because it heard another node rebroadcast it (`src/mesh/FloodingRouter.cpp:101`).

### `CLIENT`

- **Late rebroadcast window** (offset so routers can go first):
  - `delay = (2*CWmax*slotTimeMsec) + random(0, 2^CWsize) * slotTimeMsec`
  - Implemented as the “else” path in `getTxDelayMsecWeighted()` (`src/mesh/RadioInterface.cpp:306`).
- **Duplicate handling**: cancels a pending rebroadcast if it hears a duplicate rebroadcast first (LoRa only) (`src/mesh/FloodingRouter.cpp:121`).

### `ROUTER_LATE`

- **Late rebroadcast timing**: uses the same late-window timing as `CLIENT`.
  - Reason: only `Role_ROUTER` is treated as “rebroadcast early like router” in `shouldRebroadcastEarlyLikeRouter()` (`src/mesh/RadioInterface.cpp:295`).
- **Duplicate handling**: does **not** cancel (like a router), but will shift an already-queued TX into the “late rebroadcast window” by setting `tx_after` (`src/mesh/FloodingRouter.cpp:129`, `src/mesh/RadioLibInterface.cpp:356`).

## Late rebroadcast window mechanics (`tx_after`)

- The TX queue distinguishes “normal” packets vs “late-window” packets via `p->tx_after`:
  - When `tx_after` is set, that packet is deprioritized behind non-`tx_after` packets (`src/mesh/MeshPacketQueue.cpp:20`).
  - `clampToLateRebroadcastWindow()` sets:
    - `p->tx_after = millis() + getTxDelayMsecWeightedWorst(p->rx_snr)` (`src/mesh/RadioLibInterface.cpp:356`, `src/mesh/RadioInterface.cpp:287`)

## Notes on whether a node rebroadcasts at all (not timing)

- A node is treated as a “rebroadcaster” unless it is `CLIENT_MUTE` or `rebroadcast_mode == NONE` (`src/mesh/FloodingRouter.cpp:138`).
- Role defaults can change `rebroadcast_mode` (e.g., `ROUTER` defaults to `CORE_PORTNUMS_ONLY`) (`src/mesh/NodeDB.cpp:931`).

