/**
 * CourierMobileView.jsx  v3
 * ─────────────────────────────────────────────────────────────────────────────
 * Mobile-first courier interface — Pure Derived State + Turf.js Interpolation
 *
 * MOVEMENT ENGINE
 * ───────────────
 *   progress = clamp( (wallClockSec − prevNode.departure_time) /
 *                     (nextStop.arrival_time − prevNode.departure_time), 0, 1 )
 *
 *   totalKm  = turf.length(activePolylineSegment)
 *   markerPt = turf.along(activePolylineSegment, totalKm * progress)
 *
 *   The marker is a pure useMemo of wallClockSec. Scrubbing the slider
 *   instantly and accurately repositions the marker — no jumps possible.
 *
 * STATE DESIGN
 * ────────────
 *   • ALL nodes live in ONE array (`staticNodes`). Nothing is ever moved.
 *   • completedNodes / pendingNodes / nextStop / prevNode are DERIVED from
 *     wallClockSec in the hook, never stored separately.
 *   • Dynamic (DOD) orders are overlaid separately — they don't affect the
 *     core timing simulation.
 *   • Rewinding the slider always produces the correct state automatically.
 *
 * PROPS
 *   vehicleId        – vehicle identifier
 *   currentLocation  – { lat, lon } depot start
 *   routeData        – steps array from /optimize
 *   nodeMap          – { [location_id]: { lat, lon } }
 *   vehicleColor     – accent hex
 *   polylineGeometry – OSRM road segments from App.jsx
 *   onClose          – dismiss callback
 */

import { useMemo, useCallback, useState, useRef, useEffect } from 'react'
import { MapContainer, TileLayer, Marker, Popup, Polyline, useMap } from 'react-leaflet'
import L from 'leaflet'
import * as turf from '@turf/turf'
import {
    CheckCircle2, Clock, ChevronRight, Truck, X, ExternalLink,
    Play, Pause, RotateCcw, Zap, Activity, Loader2, Navigation,
    GitCommitHorizontal,
} from 'lucide-react'
import toast, { Toaster } from 'react-hot-toast'
import useDvrpSimulation, {
    parseTimeSec,
    generateDynamicPool,
    calculateDynamicOrders,
    calculateActualDod,
    SIM_OFFSET_SECS,
} from './useDvrpSimulation'

// ─── OSRM ENDPOINTS ───────────────────────────────────────────────────────────
const LOCAL_OSRM  = 'http://localhost:5001'
const PUBLIC_OSRM = 'https://router.project-osrm.org'

// ═══════════════════════════════════════════════════════════════════════════════
// PURE HELPERS
// ═══════════════════════════════════════════════════════════════════════════════

/** Traffic color from congestion ratio */
const getTrafficColor = (ratio) => {
    if (!ratio || ratio <= 1.1) return '#3b82f6'
    if (ratio <= 1.5)           return '#f59e0b'
    return                             '#ef4444'
}

/**
 * turfInterpolate
 * ───────────────
 * Returns the exact [lat, lon] at `fraction` (0–1) along a Leaflet-format
 * [[lat, lon], ...] polyline using Turf's arc-length distance.
 *
 * Falls back to linear interpolation if turf cannot process the line.
 */
function turfInterpolate(latLngs, fraction) {
    if (!latLngs || latLngs.length === 0) return null
    if (latLngs.length === 1) return latLngs[0]

    const f = Math.max(0, Math.min(1, fraction))
    if (f === 0) return latLngs[0]
    if (f === 1) return latLngs[latLngs.length - 1]

    try {
        // Turf uses GeoJSON [lon, lat] coordinate order
        const line    = turf.lineString(latLngs.map(([lat, lon]) => [lon, lat]))
        const totalKm = turf.length(line, { units: 'kilometers' })
        if (totalKm === 0) return latLngs[0]
        const pt      = turf.along(line, totalKm * f, { units: 'kilometers' })
        const [lon, lat] = pt.geometry.coordinates
        return [lat, lon]
    } catch {
        // Graceful fallback: linear interpolation between bounding points
        const idx = Math.min(Math.floor(f * (latLngs.length - 1)), latLngs.length - 2)
        const t   = f * (latLngs.length - 1) - idx
        const [a0, a1] = latLngs[idx]
        const [b0, b1] = latLngs[idx + 1]
        return [a0 + t * (b0 - a0), a1 + t * (b1 - a1)]
    }
}

// ─── OSRM /trip REROUTING ─────────────────────────────────────────────────────
async function fetchOptimizedRoute(currentLatLon, pendingNodes) {
    if (!currentLatLon || pendingNodes.length === 0) return null

    const gpsPart   = `${currentLatLon[1]},${currentLatLon[0]}`
    const nodeParts = pendingNodes.map(n => `${n.lon},${n.lat}`).join(';')
    const coordStr  = `${gpsPart};${nodeParts}`

    let baseUrl = LOCAL_OSRM
    try {
        const r = await fetch(
            `${LOCAL_OSRM}/trip/v1/driving/${currentLatLon[1]},${currentLatLon[0]};` +
            `${currentLatLon[1]},${currentLatLon[0]}?roundtrip=false&source=first&destination=last&overview=false`,
            { signal: AbortSignal.timeout(3000) }
        )
        if (!r.ok) baseUrl = PUBLIC_OSRM
    } catch { baseUrl = PUBLIC_OSRM }

    const url = `${baseUrl}/trip/v1/driving/${coordStr}` +
        `?roundtrip=false&source=first&destination=last&geometries=geojson&overview=full&steps=false`

    const res  = await fetch(url, { signal: AbortSignal.timeout(10000) })
    if (!res.ok) throw new Error(`OSRM HTTP ${res.status}`)
    const data = await res.json()
    if (data.code !== 'Ok' || !data.trips?.length) throw new Error(data.message || 'No trip')

    const trip     = data.trips[0]
    const allCoords = trip.geometry.coordinates.map(([lon, lat]) => [lat, lon])
    const legs      = trip.legs || []
    const totalDist = legs.reduce((s, l) => s + (l.distance || 0), 0)
    let   cursor    = 0
    const segments  = legs.map((leg, i) => {
        const share  = totalDist > 0 ? leg.distance / totalDist : 1 / legs.length
        const legPts = i < legs.length - 1
            ? Math.max(2, Math.round(share * allCoords.length))
            : allCoords.length - cursor
        const latLngs = allCoords.slice(cursor, cursor + legPts)
        cursor       += legPts - 1
        return { latLngs, color: '#3b82f6', isFallback: false }
    }).filter(s => s.latLngs.length >= 2)

    // ── Re-order nodes AND legs to match OSRM's optimal visit sequence ────────
    // waypoints[0] = courier's current GPS (the "source=first" anchor).
    // waypoints[1..N] = the N delivery stops in the order OSRM placed them.
    //
    // OSRM guarantees waypoint_index is the position in the ACTUAL optimised
    // trip order.  We sort both the node refs AND the corresponding legs[]
    // together so that legs[i] is ALWAYS the travel duration to orderedNodes[i].
    const waypoints = data.waypoints || []
    const nodeWpts  = waypoints.slice(1)     // drop waypoint[0] (courier GPS anchor)

    // Build (waypointObj, originalInputIndex, legIndex) triples so we can
    // sort by OSRM's waypoint_index while keeping the leg reference correct.
    // legs[k] = travel FROM waypoints[k] TO waypoints[k+1] in the raw trip.
    // After sorting by waypoint_index we need the leg that leads INTO each stop.
    const wptTriples = nodeWpts.map((wp, i) => ({
        wp,
        inputIndex:     i,                    // index into pendingNodes[]
        waypointIndex:  wp.waypoint_index,    // OSRM's optimised position (1-based)
    }))
    wptTriples.sort((a, b) => a.waypointIndex - b.waypointIndex)

    const orderedNodes = wptTriples.map(t => pendingNodes[t.inputIndex]).filter(Boolean)

    // legs[0] = courier GPS → first stop in OSRM order.
    // After our sort, the leg leading INTO orderedNodes[i] is legs[i]
    // because OSRM's output legs are already in the trip visit order.
    // We align them by mapping waypointIndex-1 → leg index.
    const sortedLegs = wptTriples.map(t => legs[t.waypointIndex - 1] || legs[t.inputIndex] || {})

    const firstLeg           = legs[0] || {}
    const nextStopDistanceKm = ((firstLeg.distance || 0) / 1000).toFixed(1)
    const etaSecs            = firstLeg.duration || 0
    const nextStopEta        = etaSecs < 60 ? `${Math.round(etaSecs)}s` : `${Math.round(etaSecs / 60)} min`

    return { segments, orderedNodes, nextStopEta, nextStopDistanceKm, legs: sortedLegs }
}

// ─── ICON FACTORIES ────────────────────────────────────────────────────────────
const makeNextStopIcon = (color) => L.divIcon({
    className: '',
    html: `<div style="position:relative;width:44px;height:44px;">
      <div style="position:absolute;inset:0;border-radius:50%;background:${color}22;animation:ctPulse 1.6s infinite;"></div>
      <div style="position:absolute;inset:5px;border-radius:50%;background:#fff;border:3px solid ${color};
        display:flex;align-items:center;justify-content:center;box-shadow:0 4px 12px ${color}55;font-size:16px;">📍</div>
      <style>@keyframes ctPulse{0%,100%{transform:scale(1);opacity:0.6}50%{transform:scale(1.5);opacity:0.2}}</style>
    </div>`,
    iconSize: [44, 44], iconAnchor: [22, 22], popupAnchor: [0, -24],
})
const makeDynamicIcon = () => L.divIcon({
    className: '',
    html: `<div style="position:relative;width:36px;height:36px;">
      <div style="position:absolute;inset:0;border-radius:50%;background:#f59e0b22;animation:dynPulse 1.2s infinite;"></div>
      <div style="position:absolute;inset:4px;border-radius:50%;background:#fff;border:2.5px solid #f59e0b;
        display:flex;align-items:center;justify-content:center;box-shadow:0 3px 10px #f59e0b55;font-size:14px;">⚡</div>
      <style>@keyframes dynPulse{0%,100%{transform:scale(1);opacity:0.7}50%{transform:scale(1.4);opacity:0.2}}</style>
    </div>`,
    iconSize: [36, 36], iconAnchor: [18, 18], popupAnchor: [0, -20],
})
const makeFutureDot = () => L.divIcon({
    className: '',
    html: `<div style="width:10px;height:10px;border-radius:50%;background:#94a3b8;border:2px solid #e2e8f0;"></div>`,
    iconSize: [10, 10], iconAnchor: [5, 5],
})
const makeCompletedDot = () => L.divIcon({
    className: '',
    html: `<div style="width:8px;height:8px;border-radius:50%;background:#e2e8f0;border:1.5px solid #cbd5e1;opacity:0.5;"></div>`,
    iconSize: [8, 8], iconAnchor: [4, 4],
})
const makeTruckIcon = (color) => L.divIcon({
    className: '',
    html: `<div style="width:38px;height:38px;border-radius:50%;background:${color};border:3px solid #fff;
      display:flex;align-items:center;justify-content:center;
      box-shadow:0 3px 10px rgba(0,0,0,0.25),0 0 0 4px ${color}44;font-size:18px;">🚚</div>`,
    iconSize: [38, 38], iconAnchor: [19, 19],
})

// ─── MAP CAMERA FOLLOW ────────────────────────────────────────────────────────
function CourierMapFollow({ pos }) {
    const map = useMap()
    useEffect(() => { if (pos) map.panTo(pos, { animate: true, duration: 0.3 }) }, [pos, map])
    return null
}

// ─── STATUS BADGE ──────────────────────────────────────────────────────────────
function StatusBadge({ step, showOnTime = true }) {
    if (!step) return null
    if (step.isDynamic) return (
        <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-bold bg-amber-100 text-amber-700 border border-amber-200">⚡ DYNAMIC</span>
    )
    if (step.is_late) return (
        <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-bold bg-red-100 text-red-600 border border-red-200">⚠ LATE</span>
    )
    if (showOnTime) return (
        <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-bold bg-emerald-100 text-emerald-700 border border-emerald-200">✓ ON TIME</span>
    )
    return null
}

// ─── DOD SLIDER ───────────────────────────────────────────────────────────────
function DodSlider({ targetDod, actualDod, dynamicCount, onChange }) {
    return (
        <div className="flex flex-col gap-1.5">
            <div className="flex items-center justify-between">
                <span className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">DOD Target</span>
                <div className="flex items-center gap-1.5">
                    <span className="text-[10px] font-mono text-slate-400">req {Math.round(targetDod * 100)}%</span>
                    <span className="text-[10px] font-bold font-mono text-amber-600 bg-amber-50 border border-amber-200 px-1.5 py-0.5 rounded-full">
                        actual {Math.round(actualDod * 100)}% · {dynamicCount}D
                    </span>
                </div>
            </div>
            <input type="range" min={0} max={0.60} step={0.01} value={targetDod}
                onChange={e => onChange(parseFloat(e.target.value))}
                className="w-full h-1.5 rounded-full appearance-none cursor-pointer"
                style={{
                    background: `linear-gradient(to right,#f59e0b ${(targetDod / 0.60) * 100}%,#e2e8f0 0%)`,
                    accentColor: '#f59e0b',
                }}
            />
            <div className="flex justify-between text-[9px] font-mono text-slate-300">
                <span>0%</span><span>30%</span><span>60%</span>
            </div>
        </div>
    )
}

// ─── TIME SCRUBBER ────────────────────────────────────────────────────────────
/**
 * TimeScrubber — video-scrubber-style range input for the simulation clock.
 *
 * onMouseDown → immediately pauses the clock (via the `pause` prop).
 * onChange    → calls seek(value) to jump time.
 *
 * Marker position instantly snaps to the turf-interpolated coordinate that
 * corresponds to the dragged time — no stale state, no desync.
 */
function TimeScrubber({ currentVirtualTime, maxVirtualTime, vehicleColor, onMouseDown, onSeek }) {
    const pct = maxVirtualTime > 0
        ? Math.min(100, (currentVirtualTime / maxVirtualTime) * 100)
        : 0

    // Format any virtual-seconds value as "HH:MM"
    const fmt = (vt) => {
        const total = Math.floor(vt) + SIM_OFFSET_SECS
        const h = Math.floor(total / 3600) % 24
        const m = Math.floor((total % 3600) / 60)
        return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`
    }

    return (
        <div className="flex flex-col gap-1.5">
            <div className="flex items-center justify-between">
                <div className="flex items-center gap-1.5">
                    <GitCommitHorizontal size={10} className="text-indigo-400" />
                    <span className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">
                        Timeline Scrubber
                    </span>
                </div>
                <span className="text-[10px] font-bold font-mono px-1.5 py-0.5 rounded"
                    style={{ background: '#f1f5f9', color: vehicleColor }}>
                    {fmt(currentVirtualTime)}
                </span>
            </div>
            <input
                type="range"
                min={0}
                max={maxVirtualTime}
                step={10}
                value={currentVirtualTime}
                onMouseDown={onMouseDown}           // ← pause immediately on grab
                onTouchStart={onMouseDown}          // ← mobile support
                onChange={e => onSeek(parseFloat(e.target.value))}
                className="w-full h-2 rounded-full appearance-none cursor-pointer"
                style={{
                    background: `linear-gradient(to right,${vehicleColor} ${pct}%,#e2e8f0 0%)`,
                    accentColor: vehicleColor,
                }}
            />
            {/* Time axis labels — evenly spaced across the sim window */}
            <div className="flex justify-between text-[9px] font-mono text-slate-300 px-0.5">
                {[0, 0.25, 0.5, 0.75, 1].map((f, i) => (
                    <span key={i}>{fmt(f * maxVirtualTime)}</span>
                ))}
            </div>
        </div>
    )
}

// ─── SIMULATION CONTROL PANEL ─────────────────────────────────────────────────
function SimControlPanel({
    isPlaying, currentVirtualTime, maxVirtualTime,
    virtualTimeDisplay, simProgressPct,
    targetDod, actualDod, dynamicCount,
    spawnedDynamicCount,
    onPlay, onPause, onReset, onChangeDod,
    onScrubMouseDown, onSeek,
    vehicleColor,
}) {
    return (
        <div className="flex-shrink-0 border-t border-slate-100 px-4 pt-3 pb-2" style={{ background: '#fff' }}>
            {/* ── Clock row ── */}
            <div className="flex items-center justify-between mb-2">
                <div className="flex items-center gap-1.5">
                    <Activity size={11} className="text-indigo-400" />
                    <span className="text-[10px] font-bold tracking-widest text-slate-400 uppercase">Sim Clock</span>
                    <span className="text-xs font-bold font-mono px-2 py-0.5 rounded-lg"
                        style={{ background: '#0f172a', color: '#a5f3fc' }}>
                        {virtualTimeDisplay}
                    </span>
                    {isPlaying && (
                        <span className="flex items-center gap-1 text-[10px] font-mono text-emerald-500">
                            <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse inline-block" />
                            LIVE
                        </span>
                    )}
                </div>
                {spawnedDynamicCount > 0 && (
                    <span className="flex items-center gap-1 text-[10px] font-bold text-amber-600 bg-amber-50 border border-amber-200 px-1.5 py-0.5 rounded-full">
                        <Zap size={9} />
                        {spawnedDynamicCount} injected
                    </span>
                )}
            </div>

            {/* ── Timeline Scrubber ── */}
            <div className="mb-3">
                <TimeScrubber
                    currentVirtualTime={currentVirtualTime}
                    maxVirtualTime={maxVirtualTime}
                    vehicleColor={vehicleColor}
                    onMouseDown={onScrubMouseDown}
                    onSeek={onSeek}
                />
            </div>

            {/* ── DOD Slider ── */}
            <DodSlider
                targetDod={targetDod}
                actualDod={actualDod}
                dynamicCount={dynamicCount}
                onChange={onChangeDod}
            />

            {/* ── Playback buttons ── */}
            <div className="flex items-center gap-2 mt-3">
                {!isPlaying ? (
                    <button onClick={onPlay}
                        className="flex-1 flex items-center justify-center gap-1.5 py-2 rounded-xl text-sm font-bold text-white transition-all active:scale-95"
                        style={{ background: vehicleColor }}>
                        <Play size={13} /> Play
                    </button>
                ) : (
                    <button onClick={onPause}
                        className="flex-1 flex items-center justify-center gap-1.5 py-2 rounded-xl text-sm font-bold transition-all active:scale-95 border"
                        style={{ color: vehicleColor, borderColor: `${vehicleColor}40`, background: `${vehicleColor}08` }}>
                        <Pause size={13} /> Pause
                    </button>
                )}
                <button onClick={onReset}
                    className="flex items-center justify-center gap-1 py-2 px-3 rounded-xl text-xs font-bold text-slate-500 border border-slate-200 bg-slate-50 transition-all active:scale-95 hover:bg-slate-100">
                    <RotateCcw size={12} /> Reset
                </button>
            </div>
        </div>
    )
}

// ═══════════════════════════════════════════════════════════════════════════════
// MAIN COMPONENT
// ═══════════════════════════════════════════════════════════════════════════════
export default function CourierMobileView({
    vehicleId,
    currentLocation,
    routeData,
    nodeMap = {},
    vehicleColor = '#6366f1',
    polylineGeometry = [],
    onClose,
}) {
    // ── Route steps ──────────────────────────────────────────────────────────
    const allSteps      = Array.isArray(routeData) ? routeData : routeData?.steps || []
    const deliverySteps = useMemo(
        () => allSteps.filter(s =>
            s.task !== 'START' && s.task !== 'FINISH' && s.location_id !== '0_Depot_Akhir'
        ),
        [allSteps]
    )

    // Depot start position [lat, lon]
    const startLatLon = useMemo(
        () => currentLocation ? [currentLocation.lat, currentLocation.lon] : null,
        [currentLocation]
    )

    // Departure time of the START step — used when prevNode is null
    const startDepartureSec = useMemo(() => {
        const s = allSteps.find(st => st.task === 'START')
        const t = parseTimeSec(s?.departure_time)
        return isNaN(t) ? SIM_OFFSET_SECS : t
    }, [allSteps])

    // ── Static nodes for the simulation hook ─────────────────────────────────
    // Immutable for the lifetime of this component. The hook derives everything
    // from wallClockSec vs arrival_time.
    const staticNodes = useMemo(() =>
        deliverySteps.map((step, idx) => {
            const nodeId = step.location_id || `stop_${idx}`
            const coords = nodeMap[nodeId] || { lat: -7.265, lon: 112.736 }
            return { ...step, id: nodeId, lat: coords.lat, lon: coords.lon, isDynamic: false }
        }),
        [deliverySteps, nodeMap]
    )

    // ── DOD (Dynamic Degree of Dynamism) ─────────────────────────────────────
    const [targetDod,   setTargetDodState] = useState(0.20)
    const [dynamicPool, setDynamicPool]    = useState([])

    const dynamicCount = useMemo(
        () => calculateDynamicOrders(staticNodes.length, targetDod),
        [staticNodes.length, targetDod]
    )
    const actualDod = useMemo(
        () => calculateActualDod(staticNodes.length, dynamicCount),
        [staticNodes.length, dynamicCount]
    )

    const handleChangeDod = useCallback((val) => {
        const clamped = Math.max(0, Math.min(0.99, val))
        setTargetDodState(clamped)
    }, [])

    // ── Route virtual-time window (used to bound DOD spawn times) ─────────────
    // routeStartVT is always 0 (sim begins at 08:00).
    // routeEndVT = last static node's ETA in virtual seconds.
    const routeEndVT = useMemo(() => {
        if (!staticNodes.length) return SIM_DURATION_FALLBACK
        const last = staticNodes[staticNodes.length - 1]
        const arr  = parseTimeSec(last?.arrival_time)
        return isNaN(arr) ? SIM_DURATION_FALLBACK : arr - SIM_OFFSET_SECS
    }, [staticNodes])

    // Regenerate DOD pool whenever count or route boundaries change.
    // spawnTimes are strictly within [routeStart+5min, routeEnd-5min].
    useEffect(() => {
        setDynamicPool(generateDynamicPool(staticNodes, dynamicCount, { routeEndVT }))
    }, [dynamicCount, staticNodes, routeEndVT])

    // ── Simulation hook ───────────────────────────────────────────────────────
    // `scheduledNodes` is the live schedule seen by the hook.
    //   • Starts as staticNodes (original VRP solution).
    //   • After OSRM rerouting, ALL pending nodes are replaced with
    //     re-timed copies, so the hook's time-derived completion logic
    //     (`wallClockSec >= arrival_time`) stays perfectly in sync.
    // `dynamicShiftEndVT` lets the hook run past the original shift end
    // when the rerouted route is longer than the original.
    const [scheduledNodes,   setScheduledNodes]   = useState(staticNodes)
    const [dynamicShiftEndVT, setDynamicShiftEndVT] = useState(null)

    // Keep scheduledNodes in sync if the passed-in route ever changes (modal reopen)
    useEffect(() => {
        setScheduledNodes(staticNodes)
        setDynamicShiftEndVT(null)
    }, [staticNodes])

    const sim = useDvrpSimulation({ allNodes: scheduledNodes, externalMaxVT: dynamicShiftEndVT })
    const {
        completedNodes, pendingNodes, nextStop, prevNode,
        currentVirtualTime, wallClockSec, isPlaying,
        maxVirtualTime, effectiveMaxVT,
        play, pause, reset, seek,
        virtualTimeDisplay, simProgressPct,
    } = sim

    // ── Reroute state (OSRM /trip segments) ──────────────────────────────────
    const [rerouteState, setRerouteState] = useState({
        segments:            [],
        nextStopEta:         null,
        nextStopDistanceKm:  null,
        isRerouting:         false,
        orderedNodes:        null,   // OSRM-optimized node sequence for itinerary
    })

    // Stable ref: always holds the latest marker position for async OSRM calls
    const currentLatLonRef  = useRef(startLatLon)
    // Stable ref: keeps wallClockSec fresh inside async reroute callbacks
    const wallClockSecRef   = useRef(wallClockSec)
    useEffect(() => { wallClockSecRef.current = wallClockSec }, [wallClockSec])
    // Stable ref: keeps completedNodes fresh for ETA merge inside async callbacks
    const completedNodesRef = useRef(completedNodes)
    useEffect(() => { completedNodesRef.current = completedNodes }, [completedNodes])

    // ── Dynamic order spawn tracking refs ────────────────────────────────────
    const announcedSpawnRef  = useRef(new Set())
    const rerouteDebounceRef = useRef(null)
    const pendingNodesRef    = useRef(pendingNodes)        // stable read inside debounced cb
    useEffect(() => { pendingNodesRef.current = pendingNodes }, [pendingNodes])

    // ── activeNodes: static + all currently-spawned dynamic orders ────────────
    // Derived every render. When the user rewinds the scrubber, dynamic orders
    // whose spawnTime > currentVirtualTime automatically disappear — no mutation.
    const spawnedDynamic = useMemo(
        () => dynamicPool.filter(n => currentVirtualTime >= (n.spawnTime ?? Infinity)),
        [dynamicPool, currentVirtualTime]
    )

    // ── REROUTE TRIGGER (defined BEFORE the effect that calls it) ─────────────
    // Called once per newly-spawned set of dynamic orders.
    // Pauses the sim, fires OSRM /trip, stores result, then resumes.
    const triggerReroute = useCallback((latLon, currentPending, newOrders) => {
        // a) Pause while we wait for OSRM
        pause()

        // b) Toast: loading
        toast.dismiss('reroute-toast')
        toast.loading(
            <div className="flex items-start gap-3">
                <div className="w-7 h-7 rounded-lg flex-shrink-0 flex items-center justify-center" style={{ background: '#f59e0b' }}>
                    <Loader2 size={14} className="text-white animate-spin" />
                </div>
                <div>
                    <p className="text-sm font-bold text-slate-800">⚠️ New Dynamic Order! Rerouting…</p>
                    <p className="text-xs text-slate-500 font-mono mt-0.5">
                        {newOrders.map(o => (o.id || '').replace(/_/g, ' ')).join(', ')}
                    </p>
                    <p className="text-[10px] text-indigo-500 font-semibold mt-1">Fetching optimal route via OSRM…</p>
                </div>
            </div>,
            { id: 'reroute-toast', style: { background: '#fff', border: '1px solid #fcd34d', borderRadius: '12px', padding: '10px 14px', maxWidth: '320px' } }
        )
        setRerouteState(s => ({ ...s, isRerouting: true }))

        // c) Build OSRM payload:
        //    [Courier's exact Turf.js position, ...remaining unvisited activeNodes]
        const newOrdersWithCoords = newOrders.map(o => ({
            ...o,
            lat: o.lat || nodeMap[o.origin_id]?.lat,
            lon: o.lon || nodeMap[o.origin_id]?.lon,
        }))
        const allRemaining = [
            ...currentPending,
            ...newOrdersWithCoords,
        ].filter(n => n.lat && n.lon)

        fetchOptimizedRoute(latLon, allRemaining)
            .then(result => {
                if (!result) {
                    toast.dismiss('reroute-toast')
                    setRerouteState(s => ({ ...s, isRerouting: false }))
                    play()    // resume even if OSRM returned nothing
                    return
                }
                const { segments, orderedNodes: rawOrderedNodes, nextStopEta, nextStopDistanceKm, legs } = result

                // ═══════════════════════════════════════════════════════════════
                // FULL ETA RECALCULATION — The core fix
                // ═══════════════════════════════════════════════════════════════
                //
                // Wall clock at the exact moment OSRM responded.
                // This is the "departure" time from the courier's current GPS.
                const SERVICE_SECS  = 120   // 2-minute standard service time per stop
                const wallNow       = wallClockSecRef.current

                // Helper: seconds → "HH:MM" wall-clock string
                const toHHMM = (sec) => {
                    const hh = Math.floor(sec / 3600) % 24
                    const mm = Math.floor((sec % 3600) / 60)
                    return `${String(hh).padStart(2,'0')}:${String(mm).padStart(2,'0')}`
                }

                // Accumulate travel + service time through the new sequence.
                // legs[i].duration = travel from previous point → rawOrderedNodes[i]
                let runningClock = wallNow
                const orderedNodes = rawOrderedNodes.map((node, i) => {
                    runningClock += (legs[i]?.duration || 0)   // travel time to this stop
                    const arrivalWall   = runningClock
                    runningClock += SERVICE_SECS               // service time (for next gap)
                    const departureWall = runningClock
                    return {
                        ...node,
                        arrival_time:   toHHMM(arrivalWall),   // ← used by hook to auto-complete
                        departure_time: toHHMM(departureWall), // ← used by Turf for leg progress
                    }
                })

                console.debug(
                    '[DVRP] ETA recalc | wallNow:', toHHMM(wallNow),
                    '| stops:', orderedNodes.map(n => `${n.id}->${n.arrival_time}`).join(', ')
                )

                // ── Merge completed + rescheduled into the hook's allNodes ────
                // Keep already-delivered nodes intact. Update the last
                // completed node's departure_time to `wallNow` so Turf
                // starts the next leg's progress from 0 (courier's exact pos).
                const doneNodes = completedNodesRef.current
                const lastDone  = doneNodes[doneNodes.length - 1]
                const mergedCompleted = lastDone
                    ? [
                        ...doneNodes.slice(0, -1),
                        { ...lastDone, departure_time: toHHMM(wallNow) },  // reset dep_time
                      ]
                    : []

                setScheduledNodes([...mergedCompleted, ...orderedNodes])

                // ── Extend scrubber/interval max if the new route is longer ──
                const lastOrdered = orderedNodes[orderedNodes.length - 1]
                const lastArrSec  = parseTimeSec(lastOrdered?.arrival_time)
                if (!isNaN(lastArrSec)) {
                    const newEndVT = lastArrSec - SIM_OFFSET_SECS
                    if (newEndVT > maxVirtualTime) setDynamicShiftEndVT(newEndVT)
                }

                // ── Prepend exact pre-reroute coord to seg 0 for seamless handover ──
                // OSRM snaps the courier GPS to the nearest road point which may
                // differ from the Turf-interpolated position by up to ~50 m.
                // Prepending the captured coordinate ensures:
                //   progress = 0  →  marker stays at EXACT current position (no jump)
                //   progress > 0  →  marker blends onto the OSRM road geometry
                const patchedSegments = segments.map((seg, i) =>
                    i === 0 && latLon && seg.latLngs.length >= 2
                        ? { ...seg, latLngs: [latLon, ...seg.latLngs] }
                        : seg
                )

                setRerouteState(s => ({
                    ...s,
                    segments:     patchedSegments,
                    orderedNodes,          // ← itinerary uses this rescheduled sequence
                    nextStopEta,
                    nextStopDistanceKm,
                    isRerouting: false,
                }))
                toast.success(
                    <div className="flex items-start gap-3">
                        <div className="w-7 h-7 rounded-lg flex-shrink-0 flex items-center justify-center" style={{ background: '#10b981' }}>
                            <span style={{ fontSize: 13 }}>✓</span>
                        </div>
                        <div>
                            <p className="text-sm font-bold text-slate-800">Route Optimised!</p>
                            <p className="text-xs text-slate-500 font-mono mt-0.5">
                                {(orderedNodes?.length ?? 0)} stops · next in {nextStopDistanceKm} km · ETA {nextStopEta}
                            </p>
                        </div>
                    </div>,
                    { id: 'reroute-toast', duration: 4000, style: { background: '#fff', border: '1px solid #6ee7b7', borderRadius: '12px', padding: '10px 14px', maxWidth: '320px' } }
                )
                play()    // d) Resume simulation
            })
            .catch(err => {
                console.warn('[DVRP] Reroute failed:', err.message)
                setRerouteState(s => ({ ...s, isRerouting: false }))
                toast.error(
                    <div>
                        <p className="text-sm font-bold text-slate-800">Reroute failed</p>
                        <p className="text-xs text-slate-400 font-mono mt-0.5">Keeping current route</p>
                    </div>,
                    { id: 'reroute-toast', duration: 3000, style: { background: '#fff', border: '1px solid #fca5a5', borderRadius: '12px', padding: '10px 14px', maxWidth: '280px' } }
                )
                play()    // resume even on failure
            })
    // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [nodeMap, pause, play])

    // ── SPAWN DETECTION EFFECT ────────────────────────────────────────────────
    // Watches activeNodes count. When it increases (new order spawned during
    // forward playback), debounces an OSRM rerouting call to avoid spam when
    // the user scrubs the slider rapidly.
    useEffect(() => {
        const spawnedIds = new Set(spawnedDynamic.map(n => n.id))

        // Handle rewind: un-announce orders that are no longer spawned
        for (const id of announcedSpawnRef.current) {
            if (!spawnedIds.has(id)) announcedSpawnRef.current.delete(id)
        }

        // Detect newly-spawned orders not yet announced
        const newlySpawned = spawnedDynamic.filter(n => !announcedSpawnRef.current.has(n.id))
        if (newlySpawned.length === 0) return

        for (const n of newlySpawned) announcedSpawnRef.current.add(n.id)

        // Capture stable values NOW (before the debounce timeout fires)
        const capturedLatLon  = currentLatLonRef.current
        const capturedPending = pendingNodesRef.current
        const capturedOrders  = newlySpawned

        // Debounce: if the user is scrubbing fast, wait 600 ms before calling OSRM
        if (rerouteDebounceRef.current) clearTimeout(rerouteDebounceRef.current)
        rerouteDebounceRef.current = setTimeout(() => {
            triggerReroute(capturedLatLon, capturedPending, capturedOrders)
        }, 600)

        return () => {
            if (rerouteDebounceRef.current) clearTimeout(rerouteDebounceRef.current)
        }
    // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [spawnedDynamic.length])

    // triggerReroute (defined above at line ~500) handles all rerouting.

    // ── OSRM segment selection ────────────────────────────────────────────────
    const activeRoadSegments     = rerouteState.segments.length > 0 ? rerouteState.segments : polylineGeometry
    const isUsingRerouteSegments = rerouteState.segments.length > 0

    const activeSegmentIndex = useMemo(() => {
        if (isUsingRerouteSegments) {
            // After rerouting, each leg in rerouteState.segments corresponds
            // to: seg[0] = couriGPS→stop-0, seg[1] = stop-0→stop-1, …
            // Find which rerouted stop is the current nextStop and use that
            // index so Turf always interpolates the CORRECT leg.
            const rnodes = rerouteState.orderedNodes
            if (!rnodes || !nextStop) return 0
            const idx = rnodes.findIndex(n => n.id === nextStop.id)
            return idx >= 0 ? idx : 0
        }
        if (!nextStop) return -1
        const idx = allSteps.findIndex(s => s.location_id === nextStop.id)
        return idx > 0 ? idx - 1 : 0
    }, [isUsingRerouteSegments, rerouteState.orderedNodes, nextStop, allSteps])

    const activeSeg       = activeSegmentIndex >= 0 ? activeRoadSegments[activeSegmentIndex] : null
    const activeWaypoints = activeSeg?.latLngs ?? []

    // ═══════════════════════════════════════════════════════════════════════════
    // TURF.JS MARKER INTERPOLATION (pure memo — no side effects)
    // ═══════════════════════════════════════════════════════════════════════════
    //
    //   progress = (wallClock − prevNode.departure_time) /
    //              (nextStop.arrival_time − prevNode.departure_time)
    //
    //   markerPos = turf.along(activePolyline, totalKm * progress)
    //
    // Rewinding the slider changes wallClockSec → this memo re-derives
    // the correct position instantly with no race conditions.
    //
    const mockGpsPos = useMemo(() => {
        // All deliveries done → stay at the last completed node
        if (!nextStop) {
            if (prevNode) {
                const c = nodeMap[prevNode.id]
                return c ? [c.lat, c.lon] : startLatLon
            }
            return startLatLon
        }

        // Determine departure reference
        const depSec = prevNode
            ? parseTimeSec(prevNode.departure_time || prevNode.arrival_time)
            : startDepartureSec

        const arrSec = parseTimeSec(nextStop.arrival_time)

        // No valid ETA on next stop (dynamic order) → stay at prev position
        if (isNaN(arrSec)) {
            if (prevNode) {
                const c = nodeMap[prevNode.id]
                return c ? [c.lat, c.lon] : startLatLon
            }
            return startLatLon
        }

        // Time-proportional progress [0, 1]
        const window   = arrSec - (isNaN(depSec) ? arrSec - 1 : depSec)
        const progress = window > 0
            ? Math.max(0, Math.min(1, (wallClockSec - (isNaN(depSec) ? arrSec : depSec)) / window))
            : 0

        // Interpolate along OSRM polyline via Turf.js
        if (activeWaypoints.length >= 2) {
            const pos = turfInterpolate(activeWaypoints, progress)
            if (pos) return pos
        }

        // Fallback: straight-line interpolation between known coords
        const depCoords = prevNode
            ? (() => { const c = nodeMap[prevNode.id]; return c ? [c.lat, c.lon] : startLatLon })()
            : startLatLon
        const arrCoords = (() => { const c = nodeMap[nextStop.id]; return c ? [c.lat, c.lon] : null })()
        if (!depCoords || !arrCoords) return depCoords || startLatLon
        return [
            depCoords[0] + progress * (arrCoords[0] - depCoords[0]),
            depCoords[1] + progress * (arrCoords[1] - depCoords[1]),
        ]
    }, [nextStop?.id, prevNode?.id, wallClockSec, activeWaypoints, nodeMap, startLatLon, startDepartureSec])

    // Keep GPS ref current for OSRM async calls
    useEffect(() => { if (mockGpsPos) currentLatLonRef.current = mockGpsPos }, [mockGpsPos])

    // ── Leg progress [0,1] for the per-leg progress bar ──────────────────────
    const legProgress = useMemo(() => {
        if (!nextStop) return 1
        const depSec = prevNode
            ? parseTimeSec(prevNode.departure_time || prevNode.arrival_time)
            : startDepartureSec
        const arrSec = parseTimeSec(nextStop.arrival_time)
        if (isNaN(arrSec) || isNaN(depSec)) return 0
        const w = arrSec - depSec
        return w > 0 ? Math.max(0, Math.min(1, (wallClockSec - depSec) / w)) : 0
    }, [nextStop?.id, prevNode?.id, wallClockSec, startDepartureSec])

    // ── Completion set for UI (time-derived, matches hook exactly) ────────────
    const completedIdSet = useMemo(
        () => new Set(completedNodes.map(n => n.id)),
        [completedNodes]
    )

    // ── Progress counters ─────────────────────────────────────────────────────
    // totalCount = scheduled static nodes (may have grown with dynamic rescheduling)
    // + any spawned dynamic nodes not yet in the schedule
    const totalCount     = scheduledNodes.length + spawnedDynamic.filter(n => !scheduledNodes.some(s => s.id === n.id)).length
    const completedCount = completedIdSet.size
    const progressPct    = totalCount > 0 ? Math.round((completedCount / totalCount) * 100) : 0

    // ── Next stop coords (for map + navigation) ───────────────────────────────
    const nextCoords = nextStop ? (nodeMap[nextStop.id] || { lat: nextStop.lat, lon: nextStop.lon }) : null
    const nextLatLon = nextCoords ? [nextCoords.lat, nextCoords.lon] : null

    // ── Fallback straight-line route (no OSRM available) ─────────────────────
    const routeLatLngs = useMemo(() => {
        if (activeRoadSegments.length > 0) return []
        const pts = startLatLon ? [startLatLon] : []
        for (const step of deliverySteps) {
            const c = nodeMap[step.location_id]
            if (c) pts.push([c.lat, c.lon])
        }
        return pts
    }, [activeRoadSegments.length, deliverySteps, nodeMap, startLatLon])

    // ── Handlers ─────────────────────────────────────────────────────────────
    const prettyName = (id) => (id || '').replace(/_/g, ' ').replace(/^\d+\s*/, '')

    const handleMarkDelivered = useCallback(() => {
        // Manual completion via button — can't use hook's markNodeAsCompleted
        // (it no longer exists). Instead, fast-forward time to node's ETA.
        if (!nextStop) return
        const arrSec = parseTimeSec(nextStop.arrival_time)
        if (!isNaN(arrSec)) {
            const targetVT = arrSec - SIM_OFFSET_SECS
            seek(targetVT)
        }
    }, [nextStop, seek])

    const handleReset = useCallback(() => {
        toast.dismiss('reroute-toast')
        if (rerouteDebounceRef.current) clearTimeout(rerouteDebounceRef.current)
        announcedSpawnRef.current = new Set()
        setScheduledNodes(staticNodes)   // ← restore original VRP schedule
        setDynamicShiftEndVT(null)
        setRerouteState({
            segments: [], nextStopEta: null, nextStopDistanceKm: null,
            isRerouting: false, orderedNodes: null,
        })
        reset()
    // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [reset, staticNodes])

    // ── Timeline nodes ────────────────────────────────────────────────────────
    // Priority: if OSRM returned an optimized sequence, honour it for pending
    // nodes so the itinerary reflects the rerouted order.
    // Completed nodes always come first (chronological).
    const allTimelineNodes = useMemo(() => {
        const completed  = completedNodes
        const dynamicPending = spawnedDynamic.filter(n => !completedIdSet.has(n.id))

        if (rerouteState.orderedNodes?.length > 0) {
            // OSRM gave us an optimal sequence — use it for pending display
            const orderedSet = new Set(rerouteState.orderedNodes.map(n => n.id))
            const extraPending = [
                ...pendingNodes.filter(n => !orderedSet.has(n.id)),
                ...dynamicPending.filter(n => !orderedSet.has(n.id)),
            ]
            return [
                ...completed,
                ...rerouteState.orderedNodes.filter(n => !completedIdSet.has(n.id)),
                ...extraPending,
            ]
        }

        return [
            ...completed,
            ...pendingNodes,
            ...dynamicPending,
        ]
    }, [rerouteState.orderedNodes, completedNodes, pendingNodes, spawnedDynamic, completedIdSet])

    // ── Map node list (static + spawned dynamic) ──────────────────────────────
    const mapNodes = useMemo(() => {
        const seen = new Set()
        const list = []
        for (const step of deliverySteps) {
            if (!seen.has(step.location_id)) {
                seen.add(step.location_id)
                list.push({ id: step.location_id, ...step, isDynamic: false })
            }
        }
        for (const n of spawnedDynamic) {
            if (!seen.has(n.id)) { seen.add(n.id); list.push(n) }
        }
        return list
    }, [deliverySteps, spawnedDynamic])

    // ─────────────────────────────── JSX ──────────────────────────────────────
    return (
        <div className="flex flex-col h-full font-sans overflow-hidden" style={{ background: '#f8fafc' }}>

            <Toaster position="top-right" containerStyle={{ top: 16, right: 16, zIndex: 99999 }} />

            {/* ── HEADER ─────────────────────────────────────────────────── */}
            <div className="flex items-center justify-between px-4 py-3 border-b border-slate-800 flex-shrink-0"
                style={{ background: '#0f172a' }}>
                <div className="flex items-center gap-2.5">
                    <div className="w-8 h-8 rounded-full flex items-center justify-center text-white font-bold text-sm"
                        style={{ background: vehicleColor }}>
                        <Truck size={16} />
                    </div>
                    <div>
                        <p className="text-white text-sm font-bold leading-none">Vehicle #{vehicleId}</p>
                        <p className="text-slate-400 text-[10px] font-mono leading-tight mt-0.5">
                            {completedCount}/{totalCount} deliveries · {progressPct}%
                        </p>
                    </div>
                </div>
                <div className="flex items-center gap-2">
                    <span className="text-[10px] font-bold font-mono px-2 py-1 rounded-lg"
                        style={{ background: '#1e293b', color: '#7dd3fc' }}>
                        {virtualTimeDisplay}
                    </span>
                    <button onClick={onClose}
                        className="text-slate-400 hover:text-white transition-colors p-1.5 rounded-lg hover:bg-slate-700">
                        <X size={18} />
                    </button>
                </div>
            </div>

            {/* ── DELIVERY PROGRESS BAR ──────────────────────────────────── */}
            <div className="h-1 bg-slate-800 flex-shrink-0">
                <div className="h-full transition-all duration-500"
                    style={{ width: `${progressPct}%`, background: vehicleColor }} />
            </div>

            {/* ── NEXT STOP HERO ────────────────────────────────────────── */}
            {nextStop ? (
                <div className="mx-4 mt-3 rounded-2xl p-4 flex-shrink-0 border"
                    style={{
                        background: `linear-gradient(135deg,${vehicleColor}12,${vehicleColor}05)`,
                        borderColor: `${vehicleColor}30`,
                    }}>
                    <div className="flex items-start justify-between mb-2">
                        <div>
                            <p className="text-[10px] font-bold text-slate-400 uppercase tracking-widest mb-0.5">Next Stop</p>
                            <p className="text-base font-bold text-slate-800 leading-tight">
                                {prettyName(nextStop.id || nextStop.location_id)}
                            </p>
                            <p className="text-xs text-slate-500 font-mono mt-0.5">{nextStop.id}</p>
                        </div>
                        <StatusBadge step={nextStop} />
                    </div>

                    {/* Per-leg progress bar */}
                    <div className="h-1 bg-slate-100 rounded-full mb-2 overflow-hidden">
                        <div className="h-full rounded-full transition-all duration-300"
                            style={{ width: `${Math.round(legProgress * 100)}%`, background: vehicleColor }} />
                    </div>

                    <div className="flex items-center flex-wrap gap-2 text-xs font-mono">
                        {rerouteState.nextStopEta ? (
                            <div className="flex items-center gap-1 text-indigo-600 bg-indigo-50 border border-indigo-100 px-1.5 py-0.5 rounded-lg">
                                <Navigation size={10} className="flex-shrink-0" />
                                <span className="font-bold">{rerouteState.nextStopEta}</span>
                            </div>
                        ) : nextStop.arrival_time ? (
                            <div className="flex items-center gap-1 text-slate-500">
                                <Clock size={11} />
                                <span>ETA {nextStop.arrival_time}</span>
                            </div>
                        ) : null}
                        {rerouteState.nextStopDistanceKm && (
                            <span className="text-slate-500">📏 {rerouteState.nextStopDistanceKm} km</span>
                        )}
                        {nextStop.departure_time && (
                            <div className="flex items-center gap-1 text-slate-400">
                                <ChevronRight size={11} />
                                <span>ETD {nextStop.departure_time}</span>
                            </div>
                        )}
                        {nextStop.demand !== 0 && nextStop.demand !== undefined && (
                            <span className={`px-1.5 py-0.5 rounded font-bold ${nextStop.demand > 0 ? 'bg-blue-50 text-blue-600' : 'bg-amber-50 text-amber-600'}`}>
                                {nextStop.demand > 0 ? `+${nextStop.demand}` : nextStop.demand} pkg
                            </span>
                        )}
                        <span className="text-[10px] font-bold font-mono px-1.5 py-0.5 rounded"
                            style={{ background: `${vehicleColor}15`, color: vehicleColor }}>
                            {Math.round(legProgress * 100)}% en route
                        </span>
                        {rerouteState.isRerouting && (
                            <span className="flex items-center gap-1 text-indigo-500">
                                <Loader2 size={9} className="animate-spin" />
                                <span className="text-[10px]">rerouting</span>
                            </span>
                        )}
                    </div>

                    <div className="flex gap-2 mt-3">
                        <a href={nextCoords ? `https://maps.google.com/?q=${nextCoords.lat},${nextCoords.lon}` : '#'}
                            target="_blank" rel="noopener noreferrer"
                            className="flex-1 flex items-center justify-center gap-1.5 py-2.5 rounded-xl text-sm font-bold border transition-all active:scale-95"
                            style={{ background: '#fff', borderColor: `${vehicleColor}40`, color: vehicleColor }}>
                            <ExternalLink size={14} /> Navigate
                        </a>
                        <button onClick={handleMarkDelivered}
                            title="Fast-forward clock to this stop's ETA"
                            className="flex-1 flex items-center justify-center gap-1.5 py-2.5 rounded-xl text-sm font-bold text-white transition-all active:scale-95 hover:opacity-90"
                            style={{ background: vehicleColor }}>
                            <CheckCircle2 size={14} /> Mark Delivered
                        </button>
                    </div>
                </div>
            ) : (
                <div className="mx-4 mt-3 rounded-2xl p-5 text-center border border-emerald-200 bg-emerald-50 flex-shrink-0">
                    <p className="text-2xl mb-1">🎉</p>
                    <p className="font-bold text-emerald-700">All Deliveries Complete!</p>
                    <p className="text-xs text-emerald-600 mt-0.5">Return to depot</p>
                </div>
            )}

            {/* ── MAP ───────────────────────────────────────────────────── */}
            <div className="mx-4 mt-3 rounded-2xl overflow-hidden border border-slate-200 flex-shrink-0"
                style={{ height: '200px', position: 'relative' }}>
                <MapContainer
                    center={mockGpsPos || startLatLon || [-7.266, 112.737]}
                    zoom={15}
                    style={{ height: '100%', width: '100%' }}
                    zoomControl={false} attributionControl={false}>
                    <TileLayer url="https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png" maxZoom={20} />
                    <CourierMapFollow pos={mockGpsPos} />

                    {/* Road polylines */}
                    {activeRoadSegments.length > 0
                        ? activeRoadSegments.map((seg, i) => {
                            if (!seg.latLngs || seg.latLngs.length < 2) return null
                            const color    = seg.color || getTrafficColor(seg.trafficRatio)
                            const isActive = i === activeSegmentIndex
                            return (
                                <div key={`seg-${i}`}>
                                    {isActive && <Polyline positions={seg.latLngs} color={color} weight={14} opacity={0.22} lineCap="round" lineJoin="round" />}
                                    <Polyline positions={seg.latLngs} color={color}
                                        weight={isActive ? 6 : 3} opacity={isActive ? 1.0 : 0.35}
                                        dashArray={(!isActive && seg.isFallback) ? '6,5' : null}
                                        lineCap="round" lineJoin="round" />
                                </div>
                            )
                        })
                        : routeLatLngs.length > 1 && (
                            <Polyline positions={routeLatLngs} color={vehicleColor} weight={3} opacity={0.25} dashArray="6,5" />
                        )
                    }

                    {/* Truck marker — position derived from Turf.js interpolation */}
                    {mockGpsPos && (
                        <Marker position={mockGpsPos} icon={makeTruckIcon(vehicleColor)}>
                            <Popup>
                                <span className="font-bold text-xs">
                                    🚚 {Math.round(legProgress * 100)}% en route
                                </span>
                            </Popup>
                        </Marker>
                    )}

                    {/* Node markers */}
                    {mapNodes.map(node => {
                        const nodeId  = node.id || node.location_id
                        const coords  = nodeMap[nodeId] || (node.lat ? { lat: node.lat, lon: node.lon } : null)
                        if (!coords) return null
                        const pos     = [coords.lat, coords.lon]
                        const isDone  = completedIdSet.has(nodeId)
                        const isNext  = nodeId === nextStop?.id
                        const isDyn   = node.isDynamic

                        if (isDone) return <Marker key={`${nodeId}-done`} position={pos} icon={makeCompletedDot()} />
                        if (isNext) return (
                            <Marker key={`${nodeId}-next`} position={pos} icon={makeNextStopIcon(vehicleColor)}>
                                <Popup>
                                    <div className="text-xs font-bold text-slate-700">
                                        {prettyName(nodeId)}<br />
                                        <span className="font-normal text-slate-500">
                                            {node.arrival_time ? `ETA ${node.arrival_time}` : 'Dynamic order'}
                                        </span>
                                    </div>
                                </Popup>
                            </Marker>
                        )
                        if (isDyn) return (
                            <Marker key={`${nodeId}-dyn`} position={pos} icon={makeDynamicIcon()}>
                                <Popup>
                                    <div className="text-xs">
                                        <p className="font-bold text-amber-600">⚡ Dynamic Order</p>
                                        <p className="text-slate-500">{prettyName(nodeId)}</p>
                                    </div>
                                </Popup>
                            </Marker>
                        )
                        return <Marker key={`${nodeId}-fut`} position={pos} icon={makeFutureDot()} />
                    })}
                </MapContainer>

                {rerouteState.isRerouting && (
                    <div style={{
                        position: 'absolute', inset: 0,
                        background: 'rgba(15,23,42,0.55)', backdropFilter: 'blur(2px)',
                        display: 'flex', flexDirection: 'column',
                        alignItems: 'center', justifyContent: 'center',
                        gap: 8, zIndex: 9000, borderRadius: 'inherit',
                    }}>
                        <Loader2 size={26} className="text-white animate-spin" />
                        <p style={{ color: '#e2e8f0', fontSize: 11, fontWeight: 700, letterSpacing: '0.08em' }}>OPTIMISING ROUTE…</p>
                    </div>
                )}
            </div>

            {/* ── ITINERARY TIMELINE ───────────────────────────────────── */}
            <div className="flex-1 overflow-y-auto px-4 pt-3 pb-2 min-h-0">
                <div className="flex items-center justify-between mb-2">
                    <p className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">Itinerary</p>
                    <span className="text-[10px] font-mono text-slate-400">
                        {completedCount} done · {pendingNodes.length} pending
                    </span>
                </div>
                <ol className="relative">
                    {allTimelineNodes.map((node, i) => {
                        const nodeId   = node.id || node.location_id
                        const isDone   = completedIdSet.has(nodeId)
                        const isNext   = nodeId === nextStop?.id
                        const isDyn    = node.isDynamic
                        const dotColor = isDone ? '#10b981' : isNext ? vehicleColor : isDyn ? '#f59e0b' : '#94a3b8'

                        return (
                            <li key={`tl-${nodeId}-${i}`} className="relative pl-6 pb-3.5 last:pb-0">
                                {i < allTimelineNodes.length - 1 && (
                                    <div className="absolute left-[9px] top-5 bottom-0 w-px"
                                        style={{ background: isDone ? '#10b981' : isDyn ? '#fcd34d' : '#e2e8f0' }} />
                                )}
                                <div className="absolute left-0 top-1 w-[18px] h-[18px] rounded-full flex items-center justify-center text-white text-[9px] font-bold"
                                    style={{ background: dotColor }}>
                                    {isDone ? '✓' : isDyn ? '⚡' : i + 1}
                                </div>
                                <div className={`rounded-xl px-3 py-2 border transition-all ${isNext ? 'shadow-sm' : isDone ? 'opacity-50' : 'border-transparent'}`}
                                    style={
                                        isNext ? { borderColor: `${vehicleColor}40`, background: `${vehicleColor}08` }
                                        : isDone ? { borderColor: '#e2e8f0', background: '#f8fafc' }
                                        : isDyn  ? { borderColor: '#fcd34d40', background: '#fffbeb' }
                                        : {}
                                    }>
                                    <div className="flex items-center justify-between">
                                        <p className={`text-sm font-bold leading-tight ${isDone ? 'line-through text-slate-400' : isNext ? 'text-slate-800' : 'text-slate-600'}`}>
                                            {prettyName(nodeId)}
                                            {isDyn && <span className="ml-1.5 text-[9px] font-bold text-amber-600 bg-amber-100 px-1 py-0.5 rounded not-italic no-underline">DYN</span>}
                                        </p>
                                        {isNext && <StatusBadge step={node} showOnTime={false} />}
                                        {isDone && <span className="text-[10px] font-bold text-emerald-600 bg-emerald-50 px-1.5 py-0.5 rounded-full">DONE</span>}
                                    </div>
                                    <div className="flex items-center gap-2 mt-0.5">
                                        {node.arrival_time && <span className="text-[10px] font-mono text-slate-400">ETA {node.arrival_time}</span>}
                                        {node.demand !== 0 && node.demand !== undefined && (
                                            <span className={`text-[10px] font-mono ${node.demand > 0 ? 'text-blue-500' : 'text-amber-500'}`}>
                                                {node.demand > 0 ? `+${node.demand}` : node.demand} pkg
                                            </span>
                                        )}
                                        {isDyn && node.spawnTime !== undefined && (
                                            <span className="text-[10px] font-mono text-amber-500">
                                                spawned at {Math.floor(node.spawnTime / 60)}m
                                            </span>
                                        )}
                                    </div>
                                </div>
                            </li>
                        )
                    })}
                </ol>
            </div>

            {/* ── SIMULATION CONTROL PANEL ─────────────────────────────── */}
            <SimControlPanel
                isPlaying={isPlaying}
                currentVirtualTime={currentVirtualTime}
                maxVirtualTime={effectiveMaxVT}
                virtualTimeDisplay={virtualTimeDisplay}
                simProgressPct={simProgressPct}
                targetDod={targetDod}
                actualDod={actualDod}
                dynamicCount={dynamicCount}
                spawnedDynamicCount={spawnedDynamic.length}
                onPlay={play}
                onPause={pause}
                onReset={handleReset}
                onChangeDod={handleChangeDod}
                onScrubMouseDown={pause}
                onSeek={seek}
                vehicleColor={vehicleColor}
            />

        </div>
    )
}
