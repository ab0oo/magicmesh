# Mesh Routing Summary (`src/mesh`)

## What “routing” means in `src/mesh`
- Meshtastic’s data-plane is fundamentally *TTL-limited flooding*, plus an *opportunistic next-hop cache for DMs* and a *retransmit/ACK layer*.
- In this repo, the router instance is `ReliableRouter` (inherits `NextHopRouter` → `FloodingRouter` → `Router`), created in `src/main.cpp:854`.

## On-air packet format (what every relay sees)
- The LoRa header is `PacketHeader` in `src/mesh/RadioInterface.h:26`: `{to, from, id, flags, channel, next_hop, relay_node}`.
- `flags` packs: `hop_limit` (3 bits), `want_ack`, `via_mqtt`, and `hop_start` (3 bits) (`src/mesh/RadioInterface.h:16`).
- `next_hop` and `relay_node` are *only the last byte* of a node ID (`src/mesh/RadioInterface.h:41`), which is why a lot of logic compares “last byte” values.

## Receive → decide → forward pipeline
- Radio receives bytes, builds a `meshtastic_MeshPacket`, sets `transport_mechanism=LoRa`, and queues it to the router (`RadioInterface::deliverToReceiver` in `src/mesh/RadioInterface.cpp:695`).
- The router thread drains the queue and runs `Router::perhapsHandleReceived` (`src/mesh/Router.cpp:768`), which applies ignore rules and then calls the routing-specific duplicate filter `shouldFilterReceived(...)`.
- If not filtered, `Router::handleReceived` decodes (PSK/PKI) and then calls `MeshModule::callModules` (`src/mesh/Router.cpp:686`).
- Key hook: `RoutingModule` is promiscuous and calls `router->sniffReceived(&mp, r)` for *every* packet (`src/modules/RoutingModule.cpp:11` and `src/modules/RoutingModule.cpp:31`). That’s where rebroadcast/next-hop learning/ACK stopping happens.

## Duplicate suppression + “upgrade” behavior
- “Have I already seen this message?” is tracked by `PacketHistory` keyed on `(originator, id)` (`src/mesh/PacketHistory.cpp:48`). It also remembers:
  - `relayed_by[]` (a small list of relayers),
  - the `next_hop` that was requested,
  - the highest `hop_limit` ever observed for that `(from,id)` to support “upgrade” copies.
- If a duplicate arrives, clients may cancel a queued rebroadcast to save airtime, while routers/late-routers behave more aggressively about always relaying (`src/mesh/FloodingRouter.cpp:101`).

## Forwarding rule (Flooding + NextHop in one place)
- Forwarding is implemented in `NextHopRouter::perhapsRebroadcast` (`src/mesh/NextHopRouter.cpp:127`):
  - Only consider relaying if `hop_limit > 0`, `id != 0` (id==0 is “0-hop broadcast”), and you’re a rebroadcaster.
  - If `next_hop == 0` (no preference) → act like flooding: everyone may relay.
  - If `next_hop != 0` → *only* the node whose relay-ID (last byte) matches `next_hop` relays.
  - On relay, it usually decrements `hop_limit` (TTL). Exception: “router backbone” optimization can preserve TTL when a router/CLIENT_BASE is relaying after a *favorited router* (`Router::shouldDecrementHopLimit` in `src/mesh/Router.cpp:81`).

## How “next-hop routing” is chosen for DMs
- When sending, `NextHopRouter::send` sets `relay_node` to “us”, then sets `next_hop` from `NodeDB` (`src/mesh/NextHopRouter.cpp:20`):
  - `next_hop = nodeDB[dest].next_hop` if known *and* not equal to the current relayer (avoid immediate loops), else `0` meaning “fallback to flooding” (`src/mesh/NextHopRouter.cpp:173`).
- Intermediate relayers also keep a pending retransmission entry for next-hop DMs, so if the chosen next hop doesn’t forward, they can retry once to heal mid-route changes (`src/mesh/NextHopRouter.cpp:31`).

## How next-hop entries are learned (the “routing protocol” part)
- Learning is opportunistic and ACK-driven: when a node sees an ACK/reply (`request_id` or `reply_id`), `NextHopRouter::sniffReceived` may set `nodeDB[dest].next_hop = relay_node` (`src/mesh/NextHopRouter.cpp:86`).
- The safety check uses `PacketHistory.relayed_by[]`: it only learns a next hop if the relayer of the ACK was also a relayer of the original packet (or a special “direct ACK + we were sole relayer” case). This is trying to ensure a *two-way* usable neighbor before “locking in” a next hop.

## Reliability: `want_ack`, retransmits, implicit ACKs, and NAKs
- ACK/NAK packets are normal mesh packets on `PortNum_ROUTING_APP` whose payload is `meshtastic_Routing{ error_reason }` and whose `request_id` points at the original message ID (`MeshModule::allocAckNak` in `src/mesh/MeshModule.cpp:48`).
- `ReliableRouter::send` starts retransmissions when `want_ack` is set (`src/mesh/ReliableRouter.cpp:17`). If retries are exhausted, it generates a failure (`MAX_RETRANSMIT`) back to the original sender (as a routing NAK).
- “Implicit ACK” optimization: for broadcasts we originated, if we overhear someone rebroadcasting our packet, we treat that as success and stop retransmitting (LoRa only) (`src/mesh/ReliableRouter.cpp:45`).
- Last-chance fallback: on the final retry for a DM, the code clears `next_hop` in both the packet and `NodeDB`, forcing the next attempt to go back to flooding (`src/mesh/NextHopRouter.cpp:296`).
- Retransmit timing and flood delay are MAC-like backoffs based on airtime + channel utilization + SNR; routers get an earlier window (`src/mesh/RadioInterface.cpp:247` and `src/mesh/RadioInterface.cpp:305`).

## Tunables / behavior knobs that change routing
- `hop_limit` is only 3 bits on-air (max 7, see `HOP_MAX` in `src/mesh/MeshTypes.h:35`); reliability defaults assume smaller hop counts (`HOP_RELIABLE` in `src/mesh/MeshTypes.h:38`).
- Rebroadcast suppression/allow-listing lives in `rebroadcast_mode` checks (e.g., `KNOWN_ONLY`, `CORE_PORTNUMS_ONLY`) that can prevent relaying of unknown/non-core traffic (`src/mesh/Router.cpp:720` and `src/modules/RoutingModule.cpp:15`).
- Roles matter: `ROUTER` rebroadcasts earlier (`src/mesh/RadioInterface.cpp:295`) and is less willing to cancel relays on duplicates (`src/mesh/FloodingRouter.cpp:101`); favorite-router logic can preserve TTL between “backbone” nodes (`src/mesh/Router.cpp:81`).

## Practical limitations of this design
- This is not a full routing protocol (no link-state, no global tables): it’s “flood unless we have a proven next-hop”, and next-hop is only 8 bits (last-byte collision risk).
- Loops are mainly contained by `hop_limit`; stale next-hop entries are corrected by per-hop retransmits and the “reset-to-flooding” fallback.

## Flood timing: backoff, transmit interval, and retransmit interval

The “when does it transmit?” behavior is a stack of:
1) a **per-hop rebroadcast backoff** (collision avoidance / flood shaping), plus
2) a **retransmit timer** used for `want_ack` reliability (and some next-hop relays).

### 1) Per-hop transmit timing (TX scheduling + CAD)
- The LoRa backend (`RadioLibInterface`) does not transmit immediately after RX/TX; it waits a randomized delay and performs CAD (channel activity detection) right before sending (`src/mesh/RadioLibInterface.cpp:256`).
- When the delay fires (`TRANSMIT_DELAY_COMPLETED`), it:
  - waits until any per-packet `tx_after` has elapsed (`src/mesh/RadioLibInterface.cpp:279`)
  - if CAD says channel is active, it goes back to RX and restarts delay (`src/mesh/RadioLibInterface.cpp:284`)
  - otherwise dequeues and sends one packet (`src/mesh/RadioLibInterface.cpp:287`)

#### A) Locally-originated packets: utilization-based contention window
- For “local” packets (`rx_snr == 0 && rx_rssi == 0`), the delay comes from `RadioInterface::getTxDelayMsec()` (`src/mesh/RadioLibInterface.cpp:322`, `src/mesh/RadioInterface.cpp:263`):
  - compute channel utilization: `airTime->channelUtilizationPercent()`
  - map utilization 0..100 → `CWsize` in `[CWmin..CWmax]` where `CWmin=3`, `CWmax=8` (`src/mesh/RadioInterface.h:92`)
  - delay: `random(0, 2^CWsize) * slotTimeMsec` (`src/mesh/RadioInterface.cpp:271`)

#### B) Flood rebroadcast packets: SNR-weighted backoff + router early window
- For rebroadcast packets (received over LoRa; they have rx metadata), the delay comes from `RadioInterface::getTxDelayMsecWeighted()` (`src/mesh/RadioLibInterface.cpp:328`, `src/mesh/RadioInterface.cpp:306`):
  - map `rx_snr` (approx -20..+10 dB) → `CWsize` in `[3..8]` (`src/mesh/RadioInterface.cpp:275`)
  - non-ROUTER nodes use an **offset late window**: `(2*CWmax*slotTimeMsec) + random(0, 2^CWsize)*slotTimeMsec` (`src/mesh/RadioInterface.cpp:318`)
  - ROUTER nodes use an **early window**: `random(0, 2*CWsize)*slotTimeMsec` (`src/mesh/RadioInterface.cpp:314`, `src/mesh/RadioInterface.cpp:295`)
  - the intent is explicit: “high SNR = large CW size (longer delay), low SNR = smaller CW size (shorter delay)” (`src/mesh/RadioInterface.cpp:308`), and routers get a head start by avoiding the `(2*CWmax*slotTimeMsec)` offset.

#### Late rebroadcast window (`tx_after`)
- Some logic pushes queued packets into a “late transmit window” by setting `tx_after`:
  - `RadioLibInterface::clampToLateRebroadcastWindow` sets `tx_after = now + getTxDelayMsecWeightedWorst(rx_snr)` (`src/mesh/RadioLibInterface.cpp:356`).
  - TX queue ordering prefers packets without `tx_after` before those with it (`src/mesh/MeshPacketQueue.cpp:16`).
- The worst-case bound is: `(2*CWmax*slotTimeMsec) + (2^CWsize*slotTimeMsec)` (`src/mesh/RadioInterface.cpp:287`).
- If a packet already has `tx_after`, `setTransmitDelay()` adds additional random delay but clamps it to `now + 2*getTxDelayMsecWeightedWorst(rx_snr)` (`src/mesh/RadioLibInterface.cpp:317`).

### 2) Retransmit timing (reliable `want_ack` and next-hop repair)
- Retransmits are scheduled by `NextHopRouter`’s `pending` table (`src/mesh/NextHopRouter.h:32`) and executed in `NextHopRouter::doRetransmissions()` (`src/mesh/NextHopRouter.cpp:265`).
- The retry interval is computed by `iface->getRetransmissionMsec(packet)` (`src/mesh/NextHopRouter.cpp:330`), implemented as `RadioInterface::getRetransmissionMsec()` (`src/mesh/RadioInterface.cpp:247`):
  - starts with `2*packetAirtime`
  - adds a contention-window-derived term based on *channel utilization* (`CWmin=3`, `CWmax=8`) and `slotTimeMsec`
  - adds `PROCESSING_TIME_MSEC = 4500` ms (`src/mesh/RadioInterface.h:92`)
- To avoid retransmitting “too early” while the radio is busy, `ReliableRouter` pushes other pending deadlines forward by packet airtime after both sends and receives (`src/mesh/ReliableRouter.cpp:36`, `src/mesh/ReliableRouter.cpp:79`).
- Retry counts:
  - original sender: `NUM_RELIABLE_RETX = 3` attempts (`src/mesh/NextHopRouter.h:92`)
  - intermediate next-hop relays: `NUM_INTERMEDIATE_RETX = 2` attempts (`src/mesh/NextHopRouter.h:90`)

