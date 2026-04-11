/**
 * useDvrpSimulation.js
 * ════════════════════════════════════════════════════════════════════════════
 * Pure Derived-State DVRP Simulation Engine  v3
 *
 * DESIGN PRINCIPLE
 * ─────────────────
 *   `currentVirtualTime` is the ONLY piece of mutable state.
 *   Completion, pending, nextStop, and prevNode are ALL derived from it
 *   on every render — no arrays are ever mutated or moved.
 *
 *   This guarantees that dragging the time scrubber backward (rewinding)
 *   automatically un-completes nodes with zero state desync possible.
 *
 * TICK RATE
 * ──────────
 *   Every TICK_INTERVAL_MS (500 ms) real time, the virtual clock advances
 *   by VIRTUAL_SECS_PER_TICK (10) virtual seconds.
 *   → 1 real-world second ≈ 20 simulation seconds.
 *
 * EXPORTED UTILITIES
 * ───────────────────
 *   parseTimeSec(s)                   — "HH:MM" → seconds-since-midnight
 *   generateDynamicPool(nodes, n)     — DOD synthetic order factory
 *   calculateDynamicOrders(S, dod)    — D = round(DOD·S / (1−DOD))
 *   calculateActualDod(S, D)          — actualDod = D / (S + D)
 *   SIM_OFFSET_SECS                   — 8 * 3600  (sim starts 08:00)
 *   TICK_INTERVAL_MS                  — 500
 *   VIRTUAL_SECS_PER_TICK             — 10
 * ════════════════════════════════════════════════════════════════════════════
 */

import { useState, useEffect, useRef, useCallback, useMemo } from 'react'

// ─── CONSTANTS ────────────────────────────────────────────────────────────────
export const SIM_OFFSET_SECS       = 8 * 3600   // 08:00:00 in seconds
export const TICK_INTERVAL_MS      = 500         // setInterval cadence (ms)
export const VIRTUAL_SECS_PER_TICK = 10          // sim-seconds per interval tick
export const SIM_DURATION_FALLBACK = 14_400      // 4 h fallback when no ETAs present

// ─── PURE HELPERS (exported for consumers) ────────────────────────────────────

/**
 * parseTimeSec — "HH:MM" or "HH:MM:SS" → seconds since midnight.
 * Returns NaN for missing or malformed input, never throws.
 */
export function parseTimeSec(s) {
    if (!s || !/^\d{1,2}:\d{2}/.test(s)) return NaN
    const [h, m] = s.split(':').map(Number)
    return h * 3600 + m * 60
}

/**
 * calculateDynamicOrders — D = round( (DOD × S) / (1 − DOD) )
 */
export function calculateDynamicOrders(staticCount, targetDod) {
    if (targetDod <= 0) return 0
    if (targetDod >= 1) return Infinity
    return Math.round((targetDod * staticCount) / (1 - targetDod))
}

/**
 * calculateActualDod — actualDod = D / (S + D)
 */
export function calculateActualDod(staticCount, dynamicCount) {
    const total = staticCount + dynamicCount
    return total === 0 ? 0 : dynamicCount / total
}

/**
 * generateDynamicPool — produce `count` synthetic "dynamic" orders.
 *
 * Each order is a shallow clone of a real static node with:
 *   • A unique id prefixed with "DYN_"
 *   • isDynamic: true
 *   • spawnTime: virtual seconds from sim start when this order appears
 *   • No arrival_time — completed only manually or by OSRM ETA assignment
 *
 * spawnTime is drawn uniformly from
 *   [ routeStartVT + 5 min,  routeEndVT - 5 min ]
 * so orders always fall inside the vehicle's actual shift window.
 * Returns [] if the window is too narrow for a safe buffer.
 *
 * @param {Array}  sourceNodes          - static delivery nodes to clone
 * @param {number} count                - how many dynamic orders to create
 * @param {object} [bounds]             - route time boundaries (virtual secs)
 * @param {number} [bounds.routeEndVT]  - last static node's ETA in vt
 * @param {number} [bounds.routeStartVT=0] - first departure in vt (default 0)
 */
export function generateDynamicPool(
    sourceNodes,
    count,
    { routeEndVT = SIM_DURATION_FALLBACK, routeStartVT = 0 } = {}
) {
    if (!sourceNodes?.length || count <= 0) return []

    const MIN_BUFFER_SECS = 300  // 5 virtual minutes
    const spawnStart = routeStartVT + MIN_BUFFER_SECS
    const spawnEnd   = routeEndVT   - MIN_BUFFER_SECS

    if (spawnStart >= spawnEnd) {
        // Route window is too short to safely inject dynamic orders
        console.warn(
            `[DOD] Spawn window too narrow ` +
            `(${spawnStart}–${spawnEnd} vt). ` +
            `Route duration must be > ${MIN_BUFFER_SECS * 2}s. Skipping pool.`
        )
        return []
    }

    const spawnRange = spawnEnd - spawnStart
    const pool = []
    for (let i = 0; i < count; i++) {
        const src = sourceNodes[i % sourceNodes.length]
        pool.push({
            ...src,
            id:             `DYN_${i + 1}_${src.id}`,
            location_id:    `DYN_${i + 1}_${src.id}`,
            origin_id:      src.id,
            isDynamic:      true,
            arrival_time:   null,    // filled in by OSRM ETA assignment after rerouting
            departure_time: null,
            spawnTime:      Math.round(spawnStart + Math.random() * spawnRange),
        })
    }
    pool.sort((a, b) => a.spawnTime - b.spawnTime)
    return pool
}

// ─── MAIN HOOK ────────────────────────────────────────────────────────────────

/**
 * useDvrpSimulation
 * ─────────────────
 * @param {Array}  options.allNodes  – All route nodes sorted by arrival_time.
 *   Static nodes must have `arrival_time` (HH:MM). Dynamic nodes have
 *   `spawnTime` (virtual seconds) but no arrival_time — they are never
 *   auto-completed by the clock; only manually via the UI.
 * @param {number} [options.simSpeed=10]   – Virtual seconds per tick
 * @param {number} [options.tickMs=500]    – Real-world tick interval
 */
export default function useDvrpSimulation({
    allNodes     = [],
    simSpeed     = VIRTUAL_SECS_PER_TICK,
    tickMs       = TICK_INTERVAL_MS,
    externalMaxVT = null,  // component can extend the stop-time after rerouting
} = {}) {

    // ── THE ONLY STATE: virtual time + playing flag ───────────────────────────
    const [currentVirtualTime, setCVT] = useState(0)
    const [isPlaying, setIsPlaying]    = useState(false)

    // ── Max virtual time = last node's arrival_time converted to virtual secs ──
    // externalMaxVT lets the component extend this when OSRM adds new nodes.
    const maxVirtualTime = useMemo(() => {
        let max = 0
        for (const n of allNodes) {
            const arr = parseTimeSec(n.arrival_time)
            if (!isNaN(arr)) {
                const vt = arr - SIM_OFFSET_SECS
                if (vt > max) max = vt
            }
        }
        return max > 0 ? max : SIM_DURATION_FALLBACK
    }, [allNodes])

    // effectiveMaxVT = whichever is larger: static route end OR OSRM-extended end
    const effectiveMaxVT = Math.max(maxVirtualTime, externalMaxVT ?? 0)

    // Stable ref so the interval closure never reads a stale value
    const maxVtRef = useRef(effectiveMaxVT)
    useEffect(() => { maxVtRef.current = effectiveMaxVT }, [effectiveMaxVT])

    // ── TICK ─────────────────────────────────────────────────────────────────
    // Increments currentVirtualTime by simSpeed every tickMs.
    // Auto-stops when time reaches maxVirtualTime.
    // Cleanup: clearInterval on every dependency change or unmount.
    useEffect(() => {
        if (!isPlaying) return
        const id = setInterval(() => {
            setCVT(prev => {
                const next = prev + simSpeed
                if (next >= maxVtRef.current) {
                    setIsPlaying(false)
                    return maxVtRef.current  // clamp at max
                }
                return next
            })
        }, tickMs)
        return () => clearInterval(id)   // ← always cleaned up
    }, [isPlaying, simSpeed, tickMs])

    // ── WALL-CLOCK SECONDS (derived scalar) ───────────────────────────────────
    const wallClockSec = SIM_OFFSET_SECS + Math.floor(currentVirtualTime)

    // ── PURE DERIVED NODE STATE ───────────────────────────────────────────────
    //
    //  spawnedNodes  — static nodes + dynamic nodes whose spawnTime has passed
    //  completedNodes — spawnedNodes where wallClockSec >= parseTimeSec(arrival_time)
    //  pendingNodes  — spawnedNodes not yet completed (or no arrival_time)
    //  nextStop      — pendingNodes[0]  (first pending node)
    //  prevNode      — completedNodes[last]  (last completed node)
    //
    // INVARIANT: no arrays are mutated. Rewinding the slider changes
    // wallClockSec → all of these re-derive correctly on the next render.
    //
    const derived = useMemo(() => {
        const spawned   = allNodes.filter(n =>
            !n.isDynamic || currentVirtualTime >= (n.spawnTime ?? 0)
        )
        const completed = []
        const pending   = []
        for (const n of spawned) {
            const arr = parseTimeSec(n.arrival_time)
            if (!isNaN(arr) && wallClockSec >= arr) {
                completed.push(n)
            } else {
                pending.push(n)
            }
        }
        return {
            spawnedNodes:   spawned,
            completedNodes: completed,
            pendingNodes:   pending,
            nextStop:  pending[0]                     ?? null,
            prevNode:  completed[completed.length - 1] ?? null,
        }
    }, [allNodes, currentVirtualTime, wallClockSec])

    // ── CONTROLS ──────────────────────────────────────────────────────────────

    const play  = useCallback(() => setIsPlaying(true), [])
    const pause = useCallback(() => setIsPlaying(false), [])
    const reset = useCallback(() => {
        setIsPlaying(false)
        setCVT(0)
    }, [])

    /**
     * seek — time-scrubber handler.
     * Immediately pauses the clock and jumps to the requested time.
     * Clamped to [0, maxVirtualTime]. Safe to call at any time.
     */
    const seek = useCallback((t) => {
        setIsPlaying(false)
        setCVT(Math.max(0, Math.min(maxVtRef.current, Number(t))))
    }, [])

    // ── DISPLAY VALUES ────────────────────────────────────────────────────────

    const virtualTimeDisplay = useMemo(() => {
        const total = Math.floor(currentVirtualTime) + SIM_OFFSET_SECS
        const hh = Math.floor(total / 3600) % 24
        const mm = Math.floor((total % 3600) / 60)
        const ss = total % 60
        return [hh, mm, ss].map(v => String(v).padStart(2, '0')).join(':')
    }, [currentVirtualTime])

    const simProgressPct = effectiveMaxVT > 0
        ? Math.min(100, Math.round((currentVirtualTime / effectiveMaxVT) * 100))
        : 0

    // ── RETURN API ────────────────────────────────────────────────────────────

    return {
        // ── Node arrays (all derived, never mutated) ──────────────────────
        allNodes,
        ...derived,          // spawnedNodes, completedNodes, pendingNodes, nextStop, prevNode

        // ── Clock ─────────────────────────────────────────────────────────
        currentVirtualTime,
        wallClockSec,
        isPlaying,
        maxVirtualTime,      // static route end (from staticNodes)
        effectiveMaxVT,      // ← dynamic: extends when OSRM adds nodes

        // ── Controls ──────────────────────────────────────────────────────
        play,
        pause,
        reset,
        seek,                // (t: number) → pauses + jumps to t

        // ── Display ───────────────────────────────────────────────────────
        virtualTimeDisplay,
        simProgressPct,      // uses effectiveMaxVT

        // ── Constants (for consumers) ─────────────────────────────────────
        SIM_OFFSET_SECS,
        TICK_INTERVAL_MS,
        VIRTUAL_SECS_PER_TICK,
    }
}
