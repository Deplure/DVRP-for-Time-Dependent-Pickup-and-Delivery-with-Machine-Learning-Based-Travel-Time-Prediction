/**
 * useDvrpSimulation.js
 * ════════════════════════════════════════════════════════════════════════════
 * Custom React hook — Hybrid DVRP Simulation Engine
 *
 * Responsibilities
 * ─────────────────
 *  1. DOD MATH & AUTO-CORRECTION
 *     • Compute D = round( (DOD × S) / (1 − DOD) ) dynamic orders
 *     • Snap actualDod to the mathematically achievable value given rounded D
 *
 *  2. DYNAMIC ORDER POOL
 *     • Generate D synthetic orders from the static node list
 *     • Each order gets a random `spawnTime` (virtual seconds into the sim)
 *
 *  3. VIRTUAL CLOCK
 *     • Runs at SIM_SPEED× wall-clock (default 60 → 1 real-sec = 1 sim-min)
 *     • Controls: play(), pause(), reset()
 *
 *  4. TIME-BASED INJECTION
 *     • Each tick checks the pool for orders whose spawnTime ≤ currentVirtualTime
 *     • Injects them into currentRouteQueue and fires onDynamicOrderInjected()
 *
 *  5. NODE COMPLETION
 *     • markNodeAsCompleted(nodeId) removes from queue → completedNodes
 *
 * Usage
 * ─────
 *   const sim = useDvrpSimulation({
 *     initialOrders,                           // 30 static node objects
 *     onDynamicOrderInjected: (order, queue, completed) => { ... }
 *   })
 *
 * ════════════════════════════════════════════════════════════════════════════
 */

import { useState, useEffect, useRef, useCallback, useMemo } from 'react'

// ─── CONSTANTS ────────────────────────────────────────────────────────────────

/** The baseline static-order count — locked for this experiment. */
const STATIC_COUNT = 30

/**
 * Simulation speed multiplier.
 * 60 → each real-world second advances the virtual clock by 60 virtual seconds
 * (i.e. 1 real second ≈ 1 simulation minute).
 */
const SIM_SPEED = 60

/**
 * How often the engine ticks in real milliseconds.
 * 500 ms → smooth injection detection without thrashing.
 */
const TICK_MS = 500

/**
 * Total simulation duration in virtual seconds.
 * 14 400 s = 4 virtual hours (e.g. 08:00 → 12:00).
 */
const SIM_DURATION_VIRTUAL_SECS = 14_400

// ─── PURE MATH HELPERS ───────────────────────────────────────────────────────

/**
 * calculateDynamicOrders
 * ──────────────────────
 * Given a static count S and user-requested DOD (0–1 decimal), returns the
 * number of dynamic orders D rounded to the nearest integer.
 *
 * Formula derivation:
 *   DOD = D / (S + D)   →   D = (DOD × S) / (1 − DOD)
 *
 * @param {number} staticCount  - Number of pre-loaded static orders (S)
 * @param {number} targetDod    - Requested DOD as a decimal in [0, 1)
 * @returns {number}            - Whole-integer count of dynamic orders
 */
export function calculateDynamicOrders(staticCount, targetDod) {
    if (targetDod <= 0) return 0
    if (targetDod >= 1) return Infinity // degenerate; guard in UI layer
    return Math.round((targetDod * staticCount) / (1 - targetDod))
}

/**
 * calculateActualDod
 * ──────────────────
 * Returns the real, mathematically achievable DOD once D has been rounded to
 * a whole integer.
 *
 * Formula: actualDod = D / (S + D)
 *
 * @param {number} staticCount   - S
 * @param {number} dynamicCount  - D (already rounded integer)
 * @returns {number}             - Actual DOD as a decimal in [0, 1)
 */
export function calculateActualDod(staticCount, dynamicCount) {
    const total = staticCount + dynamicCount
    if (total === 0) return 0
    return dynamicCount / total
}

// ─── DYNAMIC ORDER FACTORY ───────────────────────────────────────────────────

/**
 * generateDynamicPool
 * ───────────────────
 * Produces `count` synthetic order objects by sampling from `sourceNodes`.
 * Each order is a shallow clone of a real node (maintains valid coordinates)
 * with a unique ID, a "DYNAMIC" tag, and a random spawnTime.
 *
 * spawnTime is spread uniformly across [10%, 90%] of SIM_DURATION so that:
 *  • No orders appear in the first 10 % (give the courier a head-start).
 *  • No orders appear in the last 10 % (avoid un-deliverable late injections).
 *
 * @param {Array}  sourceNodes - Static order array to sample from
 * @param {number} count       - Number of dynamic orders to generate
 * @returns {Array}            - Dynamic order objects, sorted by spawnTime asc
 */
function generateDynamicPool(sourceNodes, count) {
    if (!sourceNodes?.length || count <= 0) return []

    const spawnStart = SIM_DURATION_VIRTUAL_SECS * 0.10
    const spawnEnd   = SIM_DURATION_VIRTUAL_SECS * 0.90
    const spawnRange = spawnEnd - spawnStart

    const pool = []
    for (let i = 0; i < count; i++) {
        // Cycle through source nodes if count > sourceNodes.length
        const source = sourceNodes[i % sourceNodes.length]
        pool.push({
            // ── Identity ──
            id:         `DYN_${i + 1}_${source.id}`,
            origin_id:  source.id,
            isDynamic:  true,

            // ── Geography (inherited from real node) ──
            lat:         source.lat,
            lon:         source.lon,

            // ── Logistics ──
            demand:       source.demand ?? 1,
            tw_start:     source.tw_start ?? 0,
            tw_end:       source.tw_end   ?? SIM_DURATION_VIRTUAL_SECS,
            service_time: source.service_time ?? 120,

            // ── Simulation metadata ──
            // spawnTime: virtual seconds from sim-start when this order "arrives"
            spawnTime:    Math.round(spawnStart + Math.random() * spawnRange),
            injected:     false,  // flipped to true once moved into the queue
        })
    }

    // Sort ascending so the injection loop can process cheaply in order
    pool.sort((a, b) => a.spawnTime - b.spawnTime)
    return pool
}

// ─── MAIN HOOK ────────────────────────────────────────────────────────────────

/**
 * useDvrpSimulation
 * ─────────────────
 * @param {Object}   options
 * @param {Array}    options.initialOrders            - 30 static order nodes
 * @param {number}  [options.initialTargetDod=0.20]   - Starting DOD (decimal)
 * @param {number}  [options.simSpeed=SIM_SPEED]      - Virtual speed multiplier
 * @param {Function}[options.onDynamicOrderInjected]
 *   Callback fired when a dynamic order is injected:
 *   (newOrder, updatedQueue, completedNodes) => void
 */
export default function useDvrpSimulation({
    initialOrders = [],
    initialTargetDod = 0.20,
    simSpeed = SIM_SPEED,
    onDynamicOrderInjected = null,
} = {}) {

    // ── 1. DOD STATE ─────────────────────────────────────────────────────────

    /** User-requested DOD (decimal). Drives all other DOD-derived values. */
    const [targetDod, _setTargetDod] = useState(initialTargetDod)

    /**
     * Derived from targetDod after rounding D.
     * Stored in state so components can subscribe to it directly.
     */
    const [dynamicOrdersCount, setDynamicOrdersCount] = useState(() =>
        calculateDynamicOrders(STATIC_COUNT, initialTargetDod)
    )
    const [actualDod, setActualDod] = useState(() => {
        const d = calculateDynamicOrders(STATIC_COUNT, initialTargetDod)
        return calculateActualDod(STATIC_COUNT, d)
    })

    /**
     * Public setter — auto-corrects actualDod and dynamicOrdersCount whenever
     * the user drags the DOD slider.
     *
     * @param {number} value - DOD in decimal [0, 0.99]
     */
    const setTargetDod = useCallback((value) => {
        const clamped = Math.max(0, Math.min(0.99, value))
        const d       = calculateDynamicOrders(STATIC_COUNT, clamped)
        const actual  = calculateActualDod(STATIC_COUNT, d)
        _setTargetDod(clamped)
        setDynamicOrdersCount(d)
        setActualDod(actual)
    }, [])

    // ── 2. ORDER QUEUES ───────────────────────────────────────────────────────

    /** Active route queue — starts full of static orders, gains dynamic ones. */
    const [currentRouteQueue, setCurrentRouteQueue] = useState(
        () => initialOrders.map(o => ({ ...o, isDynamic: false }))
    )

    /** Nodes the courier has finished — locked out of future reroutes. */
    const [completedNodes, setCompletedNodes] = useState([])

    // ── 3. DYNAMIC ORDER POOL ─────────────────────────────────────────────────

    /**
     * Pool of pending dynamic orders not yet injected.
     * Regenerated whenever dynamicOrdersCount changes (e.g. user edits DOD).
     * Stored in a ref so the interval callback always reads the latest value
     * without needing to be recreated.
     */
    const [dynamicOrdersPool, setDynamicOrdersPool] = useState(() =>
        generateDynamicPool(initialOrders, calculateDynamicOrders(STATIC_COUNT, initialTargetDod))
    )
    const poolRef = useRef(dynamicOrdersPool)

    // Keep poolRef in sync with state (interval reads poolRef, not state)
    useEffect(() => { poolRef.current = dynamicOrdersPool }, [dynamicOrdersPool])

    /**
     * Regenerate pool whenever dynamicOrdersCount changes.
     * Also resets which orders have already been injected.
     */
    useEffect(() => {
        const newPool = generateDynamicPool(initialOrders, dynamicOrdersCount)
        setDynamicOrdersPool(newPool)
        poolRef.current = newPool
    // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [dynamicOrdersCount])

    // ── 4. VIRTUAL CLOCK ─────────────────────────────────────────────────────

    /** Virtual seconds elapsed since simulation start. */
    const [currentVirtualTime, setCurrentVirtualTime] = useState(0)

    /** Whether the simulation is actively ticking. */
    const [isRunning, setIsRunning] = useState(false)

    /** Whether the simulation has ended (reached SIM_DURATION or all done). */
    const [isFinished, setIsFinished] = useState(false)

    /**
     * Ref-wrapped version of the injection callback.
     * Storing in a ref means the interval closure always calls the latest
     * callback without needing to restart the interval when it changes.
     */
    const injectionCallbackRef = useRef(onDynamicOrderInjected)
    useEffect(() => { injectionCallbackRef.current = onDynamicOrderInjected }, [onDynamicOrderInjected])

    /**
     * Refs for mutable values read inside the interval.
     * Using refs avoids stale-closure problems without restarting the interval.
     */
    const currentRouteQueueRef = useRef(currentRouteQueue)
    const completedNodesRef    = useRef(completedNodes)
    const currentVirtualTimeRef = useRef(0)

    useEffect(() => { currentRouteQueueRef.current = currentRouteQueue }, [currentRouteQueue])
    useEffect(() => { completedNodesRef.current    = completedNodes    }, [completedNodes])

    // ── 5. TICK: INJECTION LOOP ───────────────────────────────────────────────

    const intervalRef = useRef(null)

    /**
     * The core injection function.
     * Called every TICK_MS real milliseconds while `isRunning`.
     * Advances virtual time and checks for orders whose spawnTime has passed.
     */
    const tick = useCallback(() => {
        // Advance virtual clock by (simSpeed × tickDuration_in_secs)
        const deltaVirtual = simSpeed * (TICK_MS / 1000)

        currentVirtualTimeRef.current += deltaVirtual
        const newVirtualTime = currentVirtualTimeRef.current

        setCurrentVirtualTime(newVirtualTime)

        // ── Simulation end guard ─────────────────────────────────────────────
        if (newVirtualTime >= SIM_DURATION_VIRTUAL_SECS) {
            setIsRunning(false)
            setIsFinished(true)
            return
        }

        // ── Injection check ─────────────────────────────────────────────────
        // Work on the ref (not React state) so we get the latest pool without
        // triggering a re-render loop.
        const remainingPool = []
        const justInjected  = []

        for (const order of poolRef.current) {
            if (!order.injected && order.spawnTime <= newVirtualTime) {
                // Mark injected so it won't be processed again
                justInjected.push({ ...order, injected: true })
            } else {
                remainingPool.push(order)
            }
        }

        if (justInjected.length === 0) return

        // ── Flush injected orders into queue ─────────────────────────────────
        poolRef.current = remainingPool
        setDynamicOrdersPool(remainingPool)

        setCurrentRouteQueue(prevQueue => {
            const updatedQueue = [...prevQueue, ...justInjected]
            currentRouteQueueRef.current = updatedQueue

            // Fire the callback for each newly injected order.
            // The callback receives the order, the full updated queue, and the
            // snapshot of completed nodes — so the parent can trigger rerouting.
            if (injectionCallbackRef.current) {
                for (const order of justInjected) {
                    injectionCallbackRef.current(
                        order,
                        updatedQueue,
                        completedNodesRef.current
                    )
                }
            }

            return updatedQueue
        })
    }, [simSpeed])

    /** Start/stop the interval based on `isRunning`. */
    useEffect(() => {
        if (isRunning && !isFinished) {
            intervalRef.current = setInterval(tick, TICK_MS)
        } else {
            clearInterval(intervalRef.current)
        }
        return () => clearInterval(intervalRef.current)
    }, [isRunning, isFinished, tick])

    // ── 6. CONTROLS ───────────────────────────────────────────────────────────

    /** Start the virtual clock. No-op if already finished. */
    const play = useCallback(() => {
        if (!isFinished) setIsRunning(true)
    }, [isFinished])

    /** Pause the virtual clock (preserves all state). */
    const pause = useCallback(() => {
        setIsRunning(false)
    }, [])

    /**
     * Reset everything back to initial conditions.
     * Regenerates the dynamic pool with the current DOD settings.
     */
    const reset = useCallback(() => {
        setIsRunning(false)
        setIsFinished(false)
        setCurrentVirtualTime(0)
        currentVirtualTimeRef.current = 0

        const freshQueue = initialOrders.map(o => ({ ...o, isDynamic: false }))
        setCurrentRouteQueue(freshQueue)
        currentRouteQueueRef.current = freshQueue

        setCompletedNodes([])
        completedNodesRef.current = []

        const freshPool = generateDynamicPool(initialOrders, dynamicOrdersCount)
        setDynamicOrdersPool(freshPool)
        poolRef.current = freshPool
    // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [initialOrders, dynamicOrdersCount])

    // ── 7. NODE COMPLETION ────────────────────────────────────────────────────

    /**
     * markNodeAsCompleted
     * ───────────────────
     * Removes `nodeId` from `currentRouteQueue` and appends it to
     * `completedNodes`. Completed nodes are excluded from future reroutes.
     *
     * @param {string} nodeId - The `id` of the order/node to mark done
     */
    const markNodeAsCompleted = useCallback((nodeId) => {
        // Read current queues from refs (always latest, no stale-closure risk)
        const prevQueue  = currentRouteQueueRef.current
        const node       = prevQueue.find(n => n.id === nodeId)
        const newQueue   = prevQueue.filter(n => n.id !== nodeId)

        // Update refs immediately so any in-flight async reads see latest values
        currentRouteQueueRef.current = newQueue

        // Apply both state updates sequentially at the top level — React will
        // batch these in React 18. Calling setState inside another setState's
        // updater function is illegal (triggers the "state during render" warning).
        setCurrentRouteQueue(newQueue)

        if (node) {
            const newCompleted = [
                ...completedNodesRef.current,
                { ...node, completedAt: currentVirtualTimeRef.current },
            ]
            completedNodesRef.current = newCompleted
            setCompletedNodes(newCompleted)
        }
    }, [])

    /**
     * reorderQueue
     * ────────────
     * Replaces the pending section of currentRouteQueue with the caller-supplied
     * ordering. Used by CourierMobileView after an OSRM /trip reroute to apply
     * the TSP-optimised sequence.
     *
     * Rules:
     *  • Completed nodes are NEVER re-inserted (they're locked in completedNodes).
     *  • orderedNodes must only contain pending (non-completed) nodes.
     *  • If orderedNodes contains an id that is already completed it is silently
     *    dropped, so callers don't need to pre-filter.
     *
     * @param {Array} orderedNodes - Pending nodes in the new desired sequence
     */
    const reorderQueue = useCallback((orderedNodes) => {
        setCurrentRouteQueue(() => {
            // Filter out any node that has already been completed
            const completedSet = new Set(completedNodesRef.current.map(n => n.id))
            const filtered = orderedNodes.filter(n => !completedSet.has(n.id))
            currentRouteQueueRef.current = filtered
            return filtered
        })
    }, [])

    // ── 8. DERIVED / DISPLAY VALUES ─────────────────────────────────────────

    /**
     * Human-readable virtual time string "HH:MM:SS".
     * Simulation starts at virtual 08:00:00.
     */
    const virtualTimeDisplay = useMemo(() => {
        const OFFSET_SECS = 8 * 3600  // 08:00:00 start
        const totalSecs   = Math.floor(currentVirtualTime) + OFFSET_SECS
        const hh = Math.floor(totalSecs / 3600) % 24
        const mm = Math.floor((totalSecs % 3600) / 60)
        const ss = totalSecs % 60
        return [hh, mm, ss].map(v => String(v).padStart(2, '0')).join(':')
    }, [currentVirtualTime])

    /**
     * Simulation progress as a percentage of SIM_DURATION.
     * Useful for a progress bar in the UI.
     */
    const simProgressPct = useMemo(() =>
        Math.min(100, Math.round((currentVirtualTime / SIM_DURATION_VIRTUAL_SECS) * 100))
    , [currentVirtualTime])

    /**
     * Count of dynamic orders still waiting in the pool (not yet injected).
     */
    const pendingInjectionCount = useMemo(() =>
        dynamicOrdersPool.filter(o => !o.injected).length
    , [dynamicOrdersPool])

    // ── RETURN API ────────────────────────────────────────────────────────────

    return {
        // ── DOD values ──────────────────────────────────────────────────────
        staticOrdersCount:  STATIC_COUNT,
        targetDod,            // User-requested DOD (decimal, e.g. 0.20)
        actualDod,            // Snapped achievable DOD (decimal, e.g. 0.2174)
        dynamicOrdersCount,   // D (integer, e.g. 8)
        setTargetDod,         // (value: 0–0.99) → auto-corrects actualDod + D

        // ── Order queues ────────────────────────────────────────────────────
        currentRouteQueue,    // All pending (static + injected dynamic) orders
        completedNodes,       // Orders the courier has finished
        dynamicOrdersPool,    // Orders still waiting to be injected
        pendingInjectionCount,// How many dynamic orders haven't spawned yet

        // ── Virtual clock ───────────────────────────────────────────────────
        currentVirtualTime,   // Raw virtual seconds elapsed
        virtualTimeDisplay,   // "HH:MM:SS" string (offset to 08:00 start)
        simProgressPct,       // 0–100 progress percentage
        isRunning,
        isFinished,

        // ── Controls ────────────────────────────────────────────────────────
        play,
        pause,
        reset,

        // ── Node lifecycle ───────────────────────────────────────────────────
        markNodeAsCompleted,  // (nodeId: string) → void
        reorderQueue,         // (orderedNodes: Array) → void  — applies TSP sequence

        // ── Constants (useful for UI rendering) ─────────────────────────────
        SIM_DURATION_VIRTUAL_SECS,
        SIM_SPEED: simSpeed,
        TICK_MS,
    }
}
