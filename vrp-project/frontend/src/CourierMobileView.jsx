/**
 * CourierMobileView.jsx
 * ─────────────────────────────────────────────────────────────────────────────
 * Mobile-first dedicated interface for a single courier on the road.
 * Integrates the useDvrpSimulation hook for DOD-controlled, time-based
 * dynamic order injection with real-time map + itinerary reactivity.
 *
 * Props:
 *   vehicleId       – vehicle identifier (number)
 *   currentLocation – { lat, lon } mock GPS coords for the courier's truck
 *   routeData       – the vehicle route object from /optimize response
 *                     { vehicle_id, steps: [{ location_id, task, arrival_time,
 *                         departure_time, is_late, demand }, …] }
 *   nodeMap         – { [location_id]: { lat, lon } } lookup
 *   vehicleColor    – accent hex color for this vehicle
 *   osrmRoads       – array of OSRM road-segment objects with traffic colors
 *   onClose         – callback to dismiss the modal
 */

import { useMemo, useCallback, useState, useRef, useEffect } from 'react'
import { MapContainer, TileLayer, Marker, Popup, Polyline, useMap } from 'react-leaflet'
import L from 'leaflet'
import {
    CheckCircle2, Clock,
    ChevronRight, Truck, X, ExternalLink,
    Play, Pause, RotateCcw, Zap, Activity, Loader2, Navigation,
} from 'lucide-react'
import toast, { Toaster } from 'react-hot-toast'
import useDvrpSimulation from './useDvrpSimulation'

// ─── MOCK STATIC ORDERS (30 nodes — Surabaya locations) ──────────────────────
// These mirror the DEFAULT_NODES in App.jsx so spawned orders have valid coords.
const MOCK_STATIC_ORDERS = [
    { id: '0_Depot_JNE',           lat: -7.265232, lon: 112.736966, demand: 0,  tw_start: 0,    tw_end: 86400, service_time: 0   },
    { id: '5_SMA_Trimurti',        lat: -7.271378, lon: 112.743125, demand: 2,  tw_start: 0,    tw_end: 1800,  service_time: 120 },
    { id: '7_Rawon_Setan',         lat: -7.261884, lon: 112.739778, demand: 3,  tw_start: 0,    tw_end: 1800,  service_time: 120 },
    { id: '4_Siola_Mall',          lat: -7.256426, lon: 112.736236, demand: 4,  tw_start: 0,    tw_end: 900,   service_time: 120 },
    { id: '1_TP_Tunjungan',        lat: -7.262608, lon: 112.742352, demand: -3, tw_start: 0,    tw_end: 900,   service_time: 120 },
    { id: '3_Pasar_Kembang',       lat: -7.269480, lon: 112.730594, demand: -5, tw_start: 0,    tw_end: 900,   service_time: 120 },
    { id: '8_Pandegiling',         lat: -7.273641, lon: 112.733470, demand: -2, tw_start: 900,  tw_end: 1800,  service_time: 120 },
    { id: '2_Hotel_Majapahit',     lat: -7.260656, lon: 112.738876, demand: -2, tw_start: 900,  tw_end: 1800,  service_time: 120 },
    { id: '9_Gramedia',            lat: -7.266857, lon: 112.742223, demand: -2, tw_start: 900,  tw_end: 1800,  service_time: 120 },
    { id: '6_Patung_Sapi',         lat: -7.263884, lon: 112.742308, demand: 1,  tw_start: 900,  tw_end: 1800,  service_time: 120 },
    { id: '10_SPBU_Kedungdoro',    lat: -7.261012, lon: 112.732045, demand: -4, tw_start: 0,    tw_end: 900,   service_time: 120 },
    { id: '11_Apotek_K24',         lat: -7.266050, lon: 112.731080, demand: 2,  tw_start: 600,  tw_end: 1800,  service_time: 120 },
    { id: '12_Warkop_Pitlik',      lat: -7.264020, lon: 112.735010, demand: -1, tw_start: 0,    tw_end: 1800,  service_time: 120 },
    { id: '13_Polsek_Tegalsari',   lat: -7.267088, lon: 112.734000, demand: 3,  tw_start: 0,    tw_end: 1800,  service_time: 120 },
    { id: '14_Sate_Klisik',        lat: -7.271015, lon: 112.732090, demand: -3, tw_start: 900,  tw_end: 1800,  service_time: 120 },
    { id: '15_KFC_Basra',          lat: -7.265005, lon: 112.740510, demand: 4,  tw_start: 900,  tw_end: 1800,  service_time: 120 },
    { id: '16_McD_Basra',          lat: -7.263520, lon: 112.741080, demand: -2, tw_start: 0,    tw_end: 3600,  service_time: 120 },
    { id: '17_Kopi_Kenangan',      lat: -7.262055, lon: 112.738010, demand: 2,  tw_start: 1800, tw_end: 3600,  service_time: 120 },
    { id: '18_Plaza_BRI',          lat: -7.264510, lon: 112.742590, demand: -5, tw_start: 0,    tw_end: 3600,  service_time: 120 },
    { id: '19_Taman_Apsari',       lat: -7.263080, lon: 112.744020, demand: 1,  tw_start: 1800, tw_end: 3600,  service_time: 120 },
    { id: '20_Monumen_Bambu',      lat: -7.267812, lon: 112.743050, demand: -2, tw_start: 1800, tw_end: 5400,  service_time: 120 },
    { id: '21_Intiland_Tower',     lat: -7.268045, lon: 112.741010, demand: 5,  tw_start: 0,    tw_end: 900,   service_time: 120 },
    { id: '22_Hotel_Bumi',         lat: -7.269088, lon: 112.742050, demand: -4, tw_start: 0,    tw_end: 3600,  service_time: 120 },
    { id: '23_Gereja_Hati_Kudus',  lat: -7.270510, lon: 112.741580, demand: 2,  tw_start: 0,    tw_end: 2700,  service_time: 120 },
    { id: '24_Pasar_Keputran',     lat: -7.273050, lon: 112.742010, demand: -5, tw_start: 0,    tw_end: 900,   service_time: 120 },
    { id: '25_BCA_Darmo',          lat: -7.275520, lon: 112.740050, demand: 3,  tw_start: 900,  tw_end: 1800,  service_time: 120 },
    { id: '26_RS_Darmo',           lat: -7.280010, lon: 112.738090, demand: -3, tw_start: 0,    tw_end: 2700,  service_time: 120 },
    { id: '27_Kantor_Pos_Dinoyo',  lat: -7.278055, lon: 112.739020, demand: 4,  tw_start: 1800, tw_end: 2700,  service_time: 120 },
    { id: '28_Pecel_Madiun',       lat: -7.272045, lon: 112.735080, demand: -2, tw_start: 1800, tw_end: 3600,  service_time: 120 },
    { id: '29_Indomaret_Pregolan', lat: -7.268510, lon: 112.737520, demand: 1,  tw_start: 0,    tw_end: 1800,  service_time: 120 },
]

// ─── OSRM ENDPOINT ────────────────────────────────────────────────────────────
// Prefer the local Docker instance (same as App.jsx). Falls back to the public
// demo router if the local server is unreachable.
const LOCAL_OSRM  = 'http://localhost:5001'
const PUBLIC_OSRM = 'https://router.project-osrm.org'

// ─── TRAFFIC COLOR HELPER ─────────────────────────────────────────────────────
const getTrafficColor = (ratio) => {
    if (!ratio || ratio <= 1.1) return '#3b82f6'   // blue  — clear
    if (ratio <= 1.5)           return '#f59e0b'   // amber — moderate
    return                             '#ef4444'   // red   — heavy
}

// ─── REROUTING: OSRM /trip ────────────────────────────────────────────────────
/**
 * fetchOptimizedRoute
 * ───────────────────
 * Calls the OSRM /trip endpoint with:
 *   [courier GPS, ...remaining pending nodes]
 *
 * source=first forces the route to begin exactly at the courier's position.
 * roundtrip=false means the solver treats it as an open path (no loop back).
 *
 * Returns: { segments, orderedNodes, nextStopEta, nextStopDistanceKm }
 *   segments      – array of { latLngs, color } — one per consecutive waypoint pair
 *   orderedNodes  – pending nodes re-sorted per OSRM waypoints response
 *   nextStopEta   – human-readable duration to first stop, e.g. "4 min"
 *   nextStopDistanceKm – distance in km to next stop
 *
 * Throws on network error or OSRM failure so callers can handle gracefully.
 */
async function fetchOptimizedRoute(currentLatLon, pendingNodes) {
    if (!currentLatLon || pendingNodes.length === 0) return null

    // Build coordinate string: lon,lat;lon,lat;…  (OSRM uses lon,lat order)
    const gpsPart   = `${currentLatLon[1]},${currentLatLon[0]}`  // current loc
    const nodeParts = pendingNodes.map(n => `${n.lon},${n.lat}`).join(';')
    const coordStr  = `${gpsPart};${nodeParts}`

    // Probe local OSRM with a tiny 2-point /trip call — the SAME endpoint we
    // actually use. /nearest always responds 200 even when /trip is disabled,
    // so probing /nearest gives a false positive and picks the local server
    // even when its trip plugin isn't loaded (HTTP 400 follows).
    const probeCoord = `${currentLatLon[1]},${currentLatLon[0]}`
    let baseUrl = LOCAL_OSRM
    try {
        const probeRes = await fetch(
            `${LOCAL_OSRM}/trip/v1/driving/${probeCoord};${probeCoord}` +
            `?roundtrip=false&source=first&destination=last&overview=false`,
            { signal: AbortSignal.timeout(3000) }
        )
        if (!probeRes.ok) baseUrl = PUBLIC_OSRM
    } catch {
        baseUrl = PUBLIC_OSRM
    }

    const url = `${baseUrl}/trip/v1/driving/${coordStr}` +
        `?roundtrip=false&source=first&destination=last&geometries=geojson&overview=full&steps=false`

    const res  = await fetch(url, { signal: AbortSignal.timeout(10000) })
    if (!res.ok) throw new Error(`OSRM HTTP ${res.status}`)
    const data = await res.json()
    if (data.code !== 'Ok' || !data.trips?.length) throw new Error(data.message || 'No trip returned')

    const trip = data.trips[0]

    // ── Parse re-ordered waypoints ─────────────────────────────────────────
    // OSRM waypoints[i].waypoint_index gives the position of input coord i in
    // the optimised tour.
    // waypoints[0] is always the GPS fix (source=first), so we skip it.
    const waypoints     = data.waypoints || []   // one per input coordinate
    const nodeWaypoints = waypoints.slice(1)     // strip the GPS point

    // Sort nodeWaypoints by their waypoint_index to get the visit order
    const sorted = [...nodeWaypoints].sort((a, b) => a.waypoint_index - b.waypoint_index)

    // Map back to the original pending node objects via their input index
    // (nodeWaypoints[i] corresponds to pendingNodes[i])
    const orderedNodes = sorted.map(wp => {
        const originalIdx = nodeWaypoints.indexOf(wp)
        return pendingNodes[originalIdx]
    }).filter(Boolean)

    // ── Parse geometry into per-leg segments ──────────────────────────────
    // The geometry covers the full trip. We split it by leg so we can apply
    // the active/inactive visual hierarchy in the same way as App.jsx.
    const allCoords = trip.geometry.coordinates.map(([lon, lat]) => [lat, lon])

    // Distribute points across legs proportionally by leg distance
    const legs        = trip.legs || []
    const totalDist   = legs.reduce((s, l) => s + (l.distance || 0), 0)
    const totalPoints = allCoords.length
    let   cursor      = 0
    const segments    = legs.map((leg, i) => {
        const share    = totalDist > 0 ? leg.distance / totalDist : 1 / legs.length
        const legPts   = i < legs.length - 1
            ? Math.max(2, Math.round(share * totalPoints))
            : totalPoints - cursor          // last leg gets remaining points
        const latLngs  = allCoords.slice(cursor, cursor + legPts)
        cursor        += legPts - 1        // overlap by 1 point for continuity
        return {
            latLngs,
            color:      '#3b82f6',         // default blue; no real-time traffic ratio here
            isFallback: false,
        }
    }).filter(s => s.latLngs.length >= 2)

    // ── Next-stop ETA & distance ───────────────────────────────────────────
    const firstLeg          = legs[0] || {}
    const nextStopDistanceKm = ((firstLeg.distance || 0) / 1000).toFixed(1)
    const etaSecs           = firstLeg.duration || 0
    const nextStopEta       = etaSecs < 60
        ? `${Math.round(etaSecs)}s`
        : `${Math.round(etaSecs / 60)} min`

    return { segments, orderedNodes, nextStopEta, nextStopDistanceKm }
}

// ─── ICON FACTORIES ────────────────────────────────────────────────────────────
const makeNextStopIcon = (color) => L.divIcon({
    className: '',
    html: `<div style="position:relative;width:44px;height:44px;">
      <div style="position:absolute;inset:0;border-radius:50%;background:${color}22;animation:ctPulse 1.6s infinite;"></div>
      <div style="position:absolute;inset:5px;border-radius:50%;background:#fff;border:3px solid ${color};
        display:flex;align-items:center;justify-content:center;
        box-shadow:0 4px 12px ${color}55;font-size:16px;">📍</div>
      <style>@keyframes ctPulse{0%,100%{transform:scale(1);opacity:0.6}50%{transform:scale(1.5);opacity:0.2}}</style>
    </div>`,
    iconSize: [44, 44], iconAnchor: [22, 22], popupAnchor: [0, -24],
})

const makeDynamicIcon = (color) => L.divIcon({
    className: '',
    html: `<div style="position:relative;width:36px;height:36px;">
      <div style="position:absolute;inset:0;border-radius:50%;background:#f59e0b22;animation:dynPulse 1.2s infinite;"></div>
      <div style="position:absolute;inset:4px;border-radius:50%;background:#fff;border:2.5px solid #f59e0b;
        display:flex;align-items:center;justify-content:center;
        box-shadow:0 3px 10px #f59e0b55;font-size:14px;">⚡</div>
      <style>@keyframes dynPulse{0%,100%{transform:scale(1);opacity:0.7}50%{transform:scale(1.4);opacity:0.2}}</style>
    </div>`,
    iconSize: [36, 36], iconAnchor: [18, 18], popupAnchor: [0, -20],
})

const makeFutureDot = () => L.divIcon({
    className: '',
    html: `<div style="width:10px;height:10px;border-radius:50%;background:#94a3b8;border:2px solid #e2e8f0;box-shadow:0 1px 3px rgba(0,0,0,0.12);"></div>`,
    iconSize: [10, 10], iconAnchor: [5, 5],
})

const makeCompletedDot = () => L.divIcon({
    className: '',
    html: `<div style="width:8px;height:8px;border-radius:50%;background:#e2e8f0;border:1.5px solid #cbd5e1;opacity:0.5;"></div>`,
    iconSize: [8, 8], iconAnchor: [4, 4],
})

const makeTruckIcon = (color) => L.divIcon({
    className: '',
    html: `<div style="
      width:38px;height:38px;border-radius:50%;
      background:${color};border:3px solid #fff;
      display:flex;align-items:center;justify-content:center;
      box-shadow:0 3px 10px rgba(0,0,0,0.25), 0 0 0 4px ${color}44;
      font-size:18px;">🚚</div>`,
    iconSize: [38, 38], iconAnchor: [19, 19],
})

// ─── MAP CAMERA FOLLOW ────────────────────────────────────────────────────────
// Replaces the old CourierFitBounds. Uses panTo() instead of fitBounds() so the
// zoom level stays stable while the truck is moving — fitBounds() would cause a
// jarring zoom-out on every GPS tick.
function CourierMapFollow({ pos }) {
    const map = useMap()
    // Only pan when we have a valid position — never change zoom here.
    useEffect(() => {
        if (pos) map.panTo(pos, { animate: true, duration: 0.4 })
    }, [pos, map])
    return null
}

// ─── STATUS BADGE ──────────────────────────────────────────────────────────────
function StatusBadge({ step, showOnTime = true }) {
    if (!step) return null
    if (step.isDynamic) return (
        <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-bold bg-amber-100 text-amber-700 border border-amber-200">
            ⚡ DYNAMIC
        </span>
    )
    if (step.is_late) return (
        <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-bold bg-red-100 text-red-600 border border-red-200">
            ⚠ LATE
        </span>
    )
    if (showOnTime) return (
        <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-bold bg-emerald-100 text-emerald-700 border border-emerald-200">
            ✓ ON TIME
        </span>
    )
    return null
}

// ─── DOD SLIDER ───────────────────────────────────────────────────────────────
// Lightweight sub-component to keep the slider thumb styling self-contained.
function DodSlider({ targetDod, actualDod, dynamicOrdersCount, onChangeDod }) {
    return (
        <div className="flex flex-col gap-1.5">
            <div className="flex items-center justify-between">
                <span className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">
                    DOD Target
                </span>
                <div className="flex items-center gap-1.5">
                    <span className="text-[10px] font-mono text-slate-400">
                        req {Math.round(targetDod * 100)}%
                    </span>
                    <span className="text-[10px] font-bold font-mono text-amber-600 bg-amber-50 border border-amber-200 px-1.5 py-0.5 rounded-full">
                        actual {Math.round(actualDod * 100)}% · {dynamicOrdersCount}D
                    </span>
                </div>
            </div>
            <input
                type="range"
                min={0}
                max={0.60}
                step={0.01}
                value={targetDod}
                onChange={e => onChangeDod(parseFloat(e.target.value))}
                className="w-full h-1.5 rounded-full appearance-none cursor-pointer"
                style={{
                    background: `linear-gradient(to right, #f59e0b ${Math.round(targetDod * 100) / 0.60}%, #e2e8f0 0%)`,
                    accentColor: '#f59e0b',
                }}
            />
            <div className="flex justify-between text-[9px] font-mono text-slate-300">
                <span>0%</span><span>30%</span><span>60%</span>
            </div>
        </div>
    )
}

// ─── SIMULATION CONTROL PANEL ─────────────────────────────────────────────────
function SimControlPanel({
    isRunning, isFinished,
    virtualTimeDisplay, simProgressPct,
    targetDod, actualDod, dynamicOrdersCount,
    pendingInjectionCount,
    onPlay, onPause, onReset, onChangeDod,
    vehicleColor,
}) {
    return (
        <div
            className="flex-shrink-0 border-t border-slate-100 px-4 pt-3 pb-2"
            style={{ background: '#fff' }}
        >
            {/* ── Clock + progress ── */}
            <div className="flex items-center justify-between mb-2.5">
                <div className="flex items-center gap-1.5">
                    <Activity size={11} className="text-indigo-400" />
                    <span className="text-[10px] font-bold tracking-widest text-slate-400 uppercase">Sim Clock</span>
                    <span
                        className="text-xs font-bold font-mono px-2 py-0.5 rounded-lg"
                        style={{ background: '#0f172a', color: '#a5f3fc' }}
                    >
                        {virtualTimeDisplay}
                    </span>
                    {isRunning && (
                        <span className="flex items-center gap-1 text-[10px] font-mono text-emerald-500">
                            <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse inline-block" />
                            LIVE
                        </span>
                    )}
                    {isFinished && (
                        <span className="text-[10px] font-bold text-slate-400 bg-slate-100 px-1.5 py-0.5 rounded">
                            END
                        </span>
                    )}
                </div>
                {/* Pending injection badge */}
                {pendingInjectionCount > 0 && (
                    <span className="flex items-center gap-1 text-[10px] font-bold text-amber-600 bg-amber-50 border border-amber-200 px-1.5 py-0.5 rounded-full">
                        <Zap size={9} />
                        {pendingInjectionCount} queued
                    </span>
                )}
            </div>

            {/* ── Thin sim progress bar ── */}
            <div className="h-1 bg-slate-100 rounded-full mb-3 overflow-hidden">
                <div
                    className="h-full rounded-full transition-all duration-500"
                    style={{
                        width: `${simProgressPct}%`,
                        background: 'linear-gradient(90deg, #6366f1, #8b5cf6)',
                    }}
                />
            </div>

            {/* ── DOD Slider ── */}
            <DodSlider
                targetDod={targetDod}
                actualDod={actualDod}
                dynamicOrdersCount={dynamicOrdersCount}
                onChangeDod={onChangeDod}
            />

            {/* ── Playback controls ── */}
            <div className="flex items-center gap-2 mt-3">
                {!isRunning ? (
                    <button
                        onClick={onPlay}
                        disabled={isFinished}
                        className="flex-1 flex items-center justify-center gap-1.5 py-2 rounded-xl text-sm font-bold text-white transition-all active:scale-95 disabled:opacity-40 disabled:cursor-not-allowed"
                        style={{ background: isFinished ? '#94a3b8' : vehicleColor }}
                    >
                        <Play size={13} />
                        Play
                    </button>
                ) : (
                    <button
                        onClick={onPause}
                        className="flex-1 flex items-center justify-center gap-1.5 py-2 rounded-xl text-sm font-bold transition-all active:scale-95 border"
                        style={{
                            color: vehicleColor,
                            borderColor: `${vehicleColor}40`,
                            background: `${vehicleColor}08`,
                        }}
                    >
                        <Pause size={13} />
                        Pause
                    </button>
                )}
                <button
                    onClick={onReset}
                    className="flex items-center justify-center gap-1 py-2 px-3 rounded-xl text-xs font-bold text-slate-500 border border-slate-200 bg-slate-50 transition-all active:scale-95 hover:bg-slate-100"
                >
                    <RotateCcw size={12} />
                    Reset
                </button>
            </div>
        </div>
    )
}

// ─── MAIN COMPONENT ────────────────────────────────────────────────────────────
export default function CourierMobileView({
    vehicleId,
    currentLocation,
    routeData,
    nodeMap = {},
    vehicleColor = '#6366f1',
    osrmRoads = [],
    onClose,
}) {
    // ── Reroute state ───────────────────────────────────────────────────
    // Holds the result of the most recent OSRM /trip call.
    // While isRerouting=true, the map shows a loading overlay.
    // segments, nextStopEta, and nextStopDistanceKm are OSRM-derived.
    const [rerouteState, setRerouteState] = useState({
        segments:           [],    // [{latLngs, color}] from OSRM /trip geometry
        nextStopEta:        null,  // e.g. "4 min"
        nextStopDistanceKm: null,  // e.g. "1.3"
        isRerouting:        false, // true while fetch is in-flight
        lastRerouteAt:      null,  // virtual time of most recent reroute
    })

    // Stable ref so the async callback always reads the latest GPS position.
    // IMPORTANT: This ref is written on every render (below), so the async
    // fetchOptimizedRoute closure always reads a current value.
    const currentLatLonRef = useRef(null)

    // ── Stable ref for reorderQueue so the callback doesn't need it in deps ──
    // We'll populate this ref after the hook call below.
    const reorderQueueRef = useRef(null)

    // ── Simulation engine ──────────────────────────────────────────────
    // NOTE: handleDynamicOrderInjected is defined AFTER useDvrpSimulation so
    // that reorderQueue is available. We pass it via the ref forwarding pattern
    // used by the hook (injectionCallbackRef) — the hook always reads the latest
    // callback from its internal ref, so there's no stale-closure issue.
    const handleDynamicOrderInjectedRef = useRef(null)

    const sim = useDvrpSimulation({
        initialOrders: MOCK_STATIC_ORDERS,
        initialTargetDod: 0.20,
        onDynamicOrderInjected: useCallback(
            (newOrder, updatedQueue, completed) => {
                if (handleDynamicOrderInjectedRef.current) {
                    handleDynamicOrderInjectedRef.current(newOrder, updatedQueue, completed)
                }
            },
            [] // stable bridge — always delegates to the latest real handler
        ),
    })

    const {
        // DOD
        targetDod, actualDod, dynamicOrdersCount, setTargetDod,
        // Queues — these drive the UI
        currentRouteQueue, completedNodes, pendingInjectionCount,
        // Clock
        virtualTimeDisplay, simProgressPct, isRunning, isFinished,
        // Controls
        play, pause, reset,
        // Node lifecycle
        markNodeAsCompleted,
        reorderQueue,
    } = sim

    // Keep reorderQueueRef current so the async callback always has access
    reorderQueueRef.current = reorderQueue

    // ── Keep currentLatLonRef in sync so async reroute callback gets latest GPS
    const currentLatLon = currentLocation ? [currentLocation.lat, currentLocation.lon] : null
    currentLatLonRef.current = currentLatLon

    // ═══════════════════════════════════════════════════════════════════════════
    // MOCK GPS MOVEMENT SYSTEM
    // ═══════════════════════════════════════════════════════════════════════════
    // mockGpsPos is the source-of-truth for the truck's displayed position.
    // It starts at the prop value and is updated by the movement useEffect below.
    // All other code that previously read `currentLatLon` from the prop now works
    // unchanged because we update currentLatLonRef in the same tick.
    const [mockGpsPos, setMockGpsPos] = useState(
        () => currentLocation ? [currentLocation.lat, currentLocation.lon] : null
    )

    // Index of the NEXT coordinate to move to within the flat waypoint array.
    // Stored in a ref so the useEffect closure can mutate it without triggering
    // extra renders.
    const waypointIndexRef = useRef(0)

    // We watch for changes in the active segment (identified by a string key)
    // so we can reset waypointIndexRef to 0 when the polyline changes — either
    // because a new OSRM reroute arrived or because we finished a segment.
    const prevSegmentKeyRef = useRef('')

    // Stable refs so the movement effect always calls the latest versions of
    // markNodeAsCompleted and reads the latest nextStop without needing to be
    // in the dependency array (which would cause the interval to restart).
    const markNodeAsCompletedRef  = useRef(null)
    const nextStopRef             = useRef(null)

    // ── Haversine distance (metres) between two [lat,lon] pairs ─────────────
    // Used to decide when the courier is "close enough" to a destination node.
    function haversineMetres([lat1, lon1], [lat2, lon2]) {
        const R    = 6_371_000          // Earth radius in metres
        const dLat = (lat2 - lat1) * Math.PI / 180
        const dLon = (lon2 - lon1) * Math.PI / 180
        const a    = Math.sin(dLat / 2) ** 2
                   + Math.cos(lat1 * Math.PI / 180)
                   * Math.cos(lat2 * Math.PI / 180)
                   * Math.sin(dLon / 2) ** 2
        return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a))
    }

    // ── GPS Movement useEffect ───────────────────────────────────────────────
    // Runs whenever the simulation clock ticks (isRunning, activeRoadSegments).
    // We declare activeRoadSegments here temporarily with a placeholder because
    // the full derived value is computed further down; the effect that USES it
    // is placed inside the JSX body further below via a dedicated inner hook.
    // We store the effect logic in a ref-based callback to avoid the chicken-
    // and-egg ordering problem with the derived activeRoadSegments variable.
    const gpsTickCallbackRef = useRef(null)

    // ── Define the real handler NOW that reorderQueue is in scope ─────────────
    const handleDynamicOrderInjected = useCallback((newOrder, updatedQueue) => {
        // Dismiss any earlier rerouting toast so they don't stack
        toast.dismiss('reroute-toast')

        // ── Phase 1: loading toast ───────────────────────────────────────
        toast.loading(
            <div className="flex items-start gap-3">
                <div className="w-7 h-7 rounded-lg flex-shrink-0 flex items-center justify-center"
                    style={{ background: '#f59e0b' }}>
                    <Loader2 size={14} className="text-white animate-spin" />
                </div>
                <div>
                    <p className="text-sm font-bold text-slate-800">⚡ New Order Injected!</p>
                    <p className="text-xs text-slate-500 font-mono mt-0.5">
                        {(newOrder.id || '').replace(/_/g, ' ')}
                    </p>
                    <p className="text-[10px] text-indigo-500 font-semibold mt-1">Calculating new optimal route…</p>
                </div>
            </div>,
            {
                id: 'reroute-toast',
                style: {
                    background: '#fff',
                    border: '1px solid #fcd34d',
                    borderRadius: '12px',
                    padding: '10px 14px',
                    boxShadow: '0 4px 16px rgba(245,158,11,0.15)',
                    maxWidth: '320px',
                },
            }
        )

        // Mark rerouting in progress — shows map overlay spinner
        setRerouteState(s => ({ ...s, isRerouting: true }))

        // ── Phase 2: fetch OSRM /trip ────────────────────────────────────
        // pendingNodes = all nodes in updatedQueue that haven't been completed.
        // Use refs so the async closure always reads the latest values.
        const latLon       = currentLatLonRef.current
        const pendingNodes = updatedQueue.filter(n => !n.completedAt)

        fetchOptimizedRoute(latLon, pendingNodes)
            .then(result => {
                if (!result) {
                    toast.dismiss('reroute-toast')
                    setRerouteState(s => ({ ...s, isRerouting: false }))
                    return
                }

                const { segments, orderedNodes, nextStopEta, nextStopDistanceKm } = result

                // Apply OSRM-optimised sequence to the hook's queue via the ref
                reorderQueueRef.current?.(orderedNodes)

                // Store geometry + ETA for the map and Next Stop Hero
                setRerouteState(s => ({
                    ...s,
                    segments,
                    nextStopEta,
                    nextStopDistanceKm,
                    isRerouting:   false,
                    lastRerouteAt: Date.now(),
                }))

                // ── Phase 3 success toast ─────────────────────────────
                toast.success(
                    <div className="flex items-start gap-3">
                        <div className="w-7 h-7 rounded-lg flex-shrink-0 flex items-center justify-center"
                            style={{ background: '#10b981' }}>
                            <span style={{ fontSize: 13 }}>✓</span>
                        </div>
                        <div>
                            <p className="text-sm font-bold text-slate-800">Route Optimised!</p>
                            <p className="text-xs text-slate-500 font-mono mt-0.5">
                                {orderedNodes.length} stops · next in {nextStopDistanceKm} km · ETA {nextStopEta}
                            </p>
                        </div>
                    </div>,
                    {
                        id: 'reroute-toast',
                        duration: 4000,
                        style: {
                            background: '#fff',
                            border: '1px solid #6ee7b7',
                            borderRadius: '12px',
                            padding: '10px 14px',
                            boxShadow: '0 4px 16px rgba(16,185,129,0.12)',
                            maxWidth: '320px',
                        },
                    }
                )
            })
            .catch(err => {
                console.warn('[DVRP Reroute] OSRM /trip failed:', err.message)
                setRerouteState(s => ({ ...s, isRerouting: false }))

                // ── Phase 3 error toast ──────────────────────────────
                toast.error(
                    <div>
                        <p className="text-sm font-bold text-slate-800">Reroute failed</p>
                        <p className="text-xs text-slate-400 font-mono mt-0.5">Keeping current route</p>
                    </div>,
                    {
                        id: 'reroute-toast',
                        duration: 3000,
                        style: {
                            background: '#fff',
                            border: '1px solid #fca5a5',
                            borderRadius: '12px',
                            padding: '10px 14px',
                            maxWidth: '280px',
                        },
                    }
                )
            })
    }, []) // no deps — reads everything through refs

    // Wire the real handler into the ref so the stable bridge in useDvrpSimulation
    // always delegates to the latest version of this callback.
    handleDynamicOrderInjectedRef.current = handleDynamicOrderInjected

    // ── Build a fast lookup: completedNode id → true ──────────────────────────
    const completedIdSet = useMemo(
        () => new Set(completedNodes.map(n => n.id)),
        [completedNodes]
    )

    // ── Route steps from routeData prop (for OSRM polyline index math) ─────────
    const allSteps     = routeData?.steps || []
    const deliverySteps = useMemo(
        () => allSteps.filter(s =>
            s.task !== 'START' && s.task !== 'FINISH' && s.location_id !== '0_Depot_Akhir'
        ),
        [allSteps]
    )

    // ── "Next Stop" = first node in sim's currentRouteQueue that isn't completed
    // and that also exists in the route data (so it has a map position).
    // For dynamic orders spawned by the sim, we show them on the map too.
    const nextStop = useMemo(
        () => currentRouteQueue.find(n => !completedIdSet.has(n.id)),
        [currentRouteQueue, completedIdSet]
    )



    // ── OSRM segments for this vehicle only ────────────────────────────────────
    const vehicleRoads = useMemo(
        () => osrmRoads.filter(seg => seg.vehicleId === vehicleId),
        [osrmRoads, vehicleId]
    )

    // ── Derived coords ────────────────────────────────────────────────────────
    // currentLatLon is already declared above (alongside currentLatLonRef sync).
    const nextCoords = nextStop
        ? (nodeMap[nextStop.id] || nodeMap[nextStop.location_id] || { lat: nextStop.lat, lon: nextStop.lon })
        : null
    const nextLatLon = nextCoords ? [nextCoords.lat, nextCoords.lon] : null

    // ── Fallback straight-line coords ─────────────────────────────────────────
    // Used only when neither rerouteState.segments nor vehicleRoads has geometry.
    const routeLatLngs = useMemo(() => {
        if (rerouteState.segments.length > 0) return []
        if (vehicleRoads.length > 0)          return []
        const pts = [currentLatLon].filter(Boolean)
        for (const step of deliverySteps) {
            const c = nodeMap[step.location_id]
            if (c) pts.push([c.lat, c.lon])
        }
        return pts
    // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [rerouteState.segments.length, vehicleRoads.length, deliverySteps, nodeMap, currentLatLon])

    // ── Choose which segments to render ──────────────────────────────────────
    // Priority 1: rerouteState.segments — OSRM /trip result (most up-to-date)
    // Priority 2: vehicleRoads          — initial prop from App.jsx
    // Priority 3: routeLatLngs          — straight-line ghost fallback
    const activeRoadSegments     = rerouteState.segments.length > 0 ? rerouteState.segments : vehicleRoads
    const isUsingRerouteSegments = rerouteState.segments.length > 0

    // Post-reroute: segment[0] is always GPS → nextStop (source=first).
    // Pre-reroute: derive from allSteps position as before.
    const activeSegmentIndex = useMemo(() => {
        if (isUsingRerouteSegments) return 0
        if (!nextStop) return -1
        const idx = allSteps.findIndex(s => s.location_id === nextStop.id || s.location_id === nextStop.location_id)
        return idx > 0 ? idx - 1 : -1
    }, [isUsingRerouteSegments, allSteps, nextStop])

    // ── Keep movement-stable refs current ────────────────────────────────────
    // Written on every render so the interval closure always has the latest
    // values of markNodeAsCompleted and nextStop without needing to be in the
    // useEffect dependency array (which would restart the interval).
    markNodeAsCompletedRef.current = markNodeAsCompleted
    nextStopRef.current            = nextStop

    // ── Build the flat waypoint array for the ACTIVE leg ─────────────────────
    // We take the segment at activeSegmentIndex (the leg leading to nextStop).
    // This is a flat [lat, lon] array that the truck drives along.
    const activeSeg = activeSegmentIndex >= 0 ? activeRoadSegments[activeSegmentIndex] : null
    const activeWaypoints = activeSeg?.latLngs ?? []  // [[lat,lon], ...]

    // ── Segment identity key — changes whenever the target leg changes ────────
    // We stringify the first + last coord of the segment as a cheap identity
    // hash. When this changes we reset waypointIndexRef to 0 so the truck
    // starts from the beginning of the new path.
    const segmentKey = activeWaypoints.length > 0
        ? `${activeWaypoints[0]}-${activeWaypoints[activeWaypoints.length - 1]}`
        : ''

    // ═══════════════════════════════════════════════════════════════════════════
    // GPS MOVEMENT useEffect
    // ─────────────────────
    // Runs on every simulation tick (isRunning changes, currentVirtualTime
    // changes). Steps the truck along activeWaypoints by COORDS_PER_TICK
    // positions. When the truck reaches the last waypoint it checks proximity
    // to the nextStop node and auto-completes it.
    //
    // SPEED TUNING:
    //   • SIM_SPEED = 60 (virtual-sec per real-sec)
    //   • TICK_MS   = 500 ms  →  30 virtual-seconds per real tick
    //   • A typical OSRM leg for Surabaya inner-city ≈ 300–600 virtual-secs
    //   • We want to cross it in ~10–20 real ticks
    //   • So COORDS_PER_TICK = max(2, floor(waypoints.length / 15))
    //     gives a smooth walk that finishes in ≈15 ticks regardless of
    //     how many coordinates OSRM returned for the leg.
    // ═══════════════════════════════════════════════════════════════════════════
    useEffect(() => {
        // Reset waypoint index whenever the active segment changes
        // (new reroute arrived, or we just completed the previous leg)
        if (segmentKey !== prevSegmentKeyRef.current) {
            prevSegmentKeyRef.current = segmentKey
            waypointIndexRef.current  = 0
        }

        // Only move when the simulation is actively running
        if (!isRunning) return
        // Nothing to walk if there's no active leg
        if (activeWaypoints.length < 2) return

        // Speed: advance this many coord-array steps per tick.
        // floor(length/15) clamps to at least 1, at most ~20 steps for a
        // typical 300-coord OSRM geometry. This makes the animation finish
        // the segment in ~15 real ticks (≈7.5 seconds at 500 ms/tick).
        const coordsPerTick = Math.max(1, Math.floor(activeWaypoints.length / 15))

        // Advance the index, clamped to the last valid coordinate
        const newIdx = Math.min(
            waypointIndexRef.current + coordsPerTick,
            activeWaypoints.length - 1
        )
        waypointIndexRef.current = newIdx

        const newPos = activeWaypoints[newIdx]
        setMockGpsPos(newPos)

        // Also keep currentLatLonRef in sync so async rerouting always uses
        // the courier's CURRENT moving position, not the static prop.
        currentLatLonRef.current = newPos

        // ── Proximity / arrival check ───────────────────────────────────────
        // When the truck reaches the LAST waypoint of the active segment,
        // check if it is within ARRIVAL_THRESHOLD_M of the nextStop's actual
        // node coordinate. If yes → auto-complete the node.
        const ARRIVAL_THRESHOLD_M = 25   // metres — generous for mock GPS

        const currentStop = nextStopRef.current
        if (!currentStop) return

        const isAtEnd = newIdx >= activeWaypoints.length - 1
        if (!isAtEnd) return

        // Look up the node's lat/lon from nodeMap or the node object itself
        const stopCoords = nodeMap[currentStop.id]
            || nodeMap[currentStop.location_id]
            || (currentStop.lat ? { lat: currentStop.lat, lon: currentStop.lon } : null)

        if (!stopCoords) {
            // No coords found — auto-complete without proximity check
            markNodeAsCompletedRef.current?.(currentStop.id)
            return
        }

        const dist = haversineMetres(newPos, [stopCoords.lat, stopCoords.lon])

        if (dist <= ARRIVAL_THRESHOLD_M || isAtEnd) {
            // Mark node delivered
            markNodeAsCompletedRef.current?.(currentStop.id)

            // Fire a delivery toast — distinct from the rerouting toast
            toast.success(
                <div className="flex items-center gap-2">
                    <span style={{ fontSize: 16 }}>📦</span>
                    <div>
                        <p className="text-sm font-bold text-slate-800">Delivered!</p>
                        <p className="text-xs text-slate-500 font-mono">
                            {(currentStop.id || '').replace(/_/g, ' ')}
                        </p>
                    </div>
                </div>,
                {
                    id: `delivered-${currentStop.id}`,
                    duration: 2500,
                    style: {
                        background: '#fff',
                        border: '1px solid #6ee7b7',
                        borderRadius: '12px',
                        padding: '8px 12px',
                        maxWidth: '260px',
                    },
                }
            )
        }
    // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [isRunning, segmentKey, activeWaypoints.length])

    // ── Progress counters ───────────────────────────────────────────────────────
    const totalCount     = currentRouteQueue.length + completedNodes.length
    const completedCount = completedNodes.length
    const progressPct    = totalCount > 0 ? Math.round((completedCount / totalCount) * 100) : 0

    // ── Handlers ────────────────────────────────────────────────────────────────
    const handleMarkDelivered = useCallback(() => {
        if (!nextStop) return
        markNodeAsCompleted(nextStop.id)
    }, [nextStop, markNodeAsCompleted])

    // Wraps the hook's reset to also clear OSRM-derived route geometry so stale
    // polylines, ETAs, and mock GPS position don't persist across simulation runs.
    const handleReset = useCallback(() => {
        toast.dismiss('reroute-toast')
        setRerouteState({
            segments: [], nextStopEta: null, nextStopDistanceKm: null,
            isRerouting: false, lastRerouteAt: null,
        })
        // Snap truck back to starting position and reset traversal index
        const startPos = currentLocation ? [currentLocation.lat, currentLocation.lon] : null
        setMockGpsPos(startPos)
        currentLatLonRef.current  = startPos
        waypointIndexRef.current  = 0
        prevSegmentKeyRef.current = ''
        reset()
    }, [reset, currentLocation])

    const prettyName = (id) => (id || '').replace(/_/g, ' ').replace(/^\d+\s*/, '')

    // ── All nodes visible on the itinerary (union of queue + completed) ─────────
    // Completed first for visual chronology, then pending queue.
    const allTimelineNodes = useMemo(() => [
        ...completedNodes,
        ...currentRouteQueue.filter(n => !completedIdSet.has(n.id)),
    ], [completedNodes, currentRouteQueue, completedIdSet])

    // ── Map markers: merge routeData stops + dynamically injected stops ─────────
    // We build a unified list for the map so both static and dynamic nodes render.
    const mapNodes = useMemo(() => {
        const seen = new Set()
        const list = []
        // Priority: routeData's deliverySteps (have proper OSRM context)
        for (const step of deliverySteps) {
            if (!seen.has(step.location_id)) {
                seen.add(step.location_id)
                list.push({ id: step.location_id, ...step, isDynamic: false })
            }
        }
        // Then any dynamic orders from the sim queue not already represented
        for (const node of currentRouteQueue) {
            if (node.isDynamic && !seen.has(node.id)) {
                seen.add(node.id)
                list.push(node)
            }
        }
        return list
    }, [deliverySteps, currentRouteQueue])

    // ─────────────────────────────── JSX ──────────────────────────────────────
    return (
        <div className="flex flex-col h-full font-sans overflow-hidden" style={{ background: '#f8fafc' }}>

            {/* ── Toaster (scoped inside modal using fixed container) ──── */}
            <Toaster
                position="top-right"
                containerStyle={{ top: 16, right: 16, zIndex: 99999 }}
                toastOptions={{ className: '' }}
            />

            {/* ── HEADER ──────────────────────────────────────────────── */}
            <div
                className="flex items-center justify-between px-4 py-3 border-b border-slate-800 flex-shrink-0"
                style={{ background: '#0f172a' }}
            >
                <div className="flex items-center gap-2.5">
                    <div
                        className="w-8 h-8 rounded-full flex items-center justify-center text-white font-bold text-sm"
                        style={{ background: vehicleColor }}
                    >
                        <Truck size={16} />
                    </div>
                    <div>
                        <p className="text-white text-sm font-bold leading-none">Vehicle #{vehicleId}</p>
                        <p className="text-slate-400 text-[10px] font-mono leading-tight mt-0.5">
                            {completedCount}/{totalCount} deliveries · {progressPct}%
                        </p>
                    </div>
                </div>
                {/* Virtual clock chip in header */}
                <div className="flex items-center gap-2">
                    <span
                        className="text-[10px] font-bold font-mono px-2 py-1 rounded-lg"
                        style={{ background: '#1e293b', color: '#7dd3fc' }}
                    >
                        {virtualTimeDisplay}
                    </span>
                    <button
                        onClick={onClose}
                        className="text-slate-400 hover:text-white transition-colors p-1.5 rounded-lg hover:bg-slate-700"
                    >
                        <X size={18} />
                    </button>
                </div>
            </div>

            {/* ── DUAL PROGRESS BARS ──────────────────────────────────── */}
            {/* Top: delivery progress */}
            <div className="h-1 bg-slate-800 flex-shrink-0">
                <div
                    className="h-full transition-all duration-500"
                    style={{ width: `${progressPct}%`, background: vehicleColor }}
                />
            </div>
            {/* Bottom: simulation time progress */}
            <div className="h-0.5 flex-shrink-0" style={{ background: '#1e293b' }}>
                <div
                    className="h-full transition-all duration-300"
                    style={{
                        width: `${simProgressPct}%`,
                        background: 'linear-gradient(90deg, #6366f1, #8b5cf6)',
                    }}
                />
            </div>

            {/* ── NEXT STOP HERO ───────────────────────────────────────── */}
            {nextStop ? (
                <div
                    className="mx-4 mt-3 rounded-2xl p-4 flex-shrink-0 border"
                    style={{
                        background: nextStop.isDynamic
                            ? 'linear-gradient(135deg, #fef3c715, #fef9c305)'
                            : `linear-gradient(135deg, ${vehicleColor}12, ${vehicleColor}05)`,
                        borderColor: nextStop.isDynamic ? '#fcd34d60' : `${vehicleColor}30`,
                    }}
                >
                    <div className="flex items-start justify-between mb-2">
                        <div>
                            <div className="flex items-center gap-1.5 mb-0.5">
                                <p className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">
                                    Next Stop
                                </p>
                                {nextStop.isDynamic && (
                                    <span className="text-[9px] font-bold text-amber-600 bg-amber-100 border border-amber-200 px-1.5 py-0.5 rounded-full">
                                        ⚡ NEW
                                    </span>
                                )}
                            </div>
                            <p className="text-base font-bold text-slate-800 leading-tight">
                                {prettyName(nextStop.id || nextStop.location_id)}
                            </p>
                            <p className="text-xs text-slate-500 font-mono mt-0.5">
                                {nextStop.id || nextStop.location_id}
                            </p>
                        </div>
                        <StatusBadge step={nextStop} />
                    </div>

                    {/* Time / demand info — show OSRM ETA/distance when available */}
                    <div className="flex items-center flex-wrap gap-2 mt-2 text-xs font-mono">
                        {/* OSRM-derived live ETA chip (highest priority) */}
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
                        {/* OSRM distance chip */}
                        {rerouteState.nextStopDistanceKm && (
                            <span className="text-slate-500">
                                📏 {rerouteState.nextStopDistanceKm} km
                            </span>
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
                        {/* Rerouting in-progress mini indicator */}
                        {rerouteState.isRerouting && (
                            <span className="flex items-center gap-1 text-indigo-500">
                                <Loader2 size={9} className="animate-spin" />
                                <span className="text-[10px]">rerouting</span>
                            </span>
                        )}
                    </div>

                    {/* Action buttons */}
                    <div className="flex gap-2 mt-3">
                        <a
                            href={nextCoords ? `https://maps.google.com/?q=${nextCoords.lat},${nextCoords.lon}` : '#'}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="flex-1 flex items-center justify-center gap-1.5 py-2.5 rounded-xl text-sm font-bold border transition-all active:scale-95"
                            style={{
                                background: '#fff',
                                borderColor: `${vehicleColor}40`,
                                color: vehicleColor,
                            }}
                        >
                            <ExternalLink size={14} />
                            Navigate
                        </a>
                        <button
                            onClick={handleMarkDelivered}
                            className="flex-1 flex items-center justify-center gap-1.5 py-2.5 rounded-xl text-sm font-bold text-white transition-all active:scale-95 hover:opacity-90"
                            style={{ background: vehicleColor }}
                        >
                            <CheckCircle2 size={14} />
                            Mark Delivered
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

            {/* ── MAP ─────────────────────────────────────────────────── */}
            <div
                className="mx-4 mt-3 rounded-2xl overflow-hidden border border-slate-200 flex-shrink-0"
                style={{ height: '200px', position: 'relative' }}
            >
                <MapContainer
                    center={mockGpsPos || currentLatLon || [-7.266, 112.737]}
                    zoom={15}
                    style={{ height: '100%', width: '100%' }}
                    zoomControl={false}
                    attributionControl={false}
                >
                    <TileLayer
                        url="https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png"
                        maxZoom={20}
                    />
                    {/* CourierMapFollow pans the camera to keep the truck centred.
                         Uses panTo() (not fitBounds) so zoom stays stable during movement. */}
                    <CourierMapFollow pos={mockGpsPos} />

                    {/* ── Road polylines: active/inactive visual hierarchy ───────────────────────
                         Source priority:
                           1. rerouteState.segments  (OSRM /trip post-injection)
                           2. vehicleRoads            (initial from App.jsx prop)
                           3. routeLatLngs            (straight-line fallback)
                         Active leg (i === activeSegmentIndex): full weight + glow halo
                         Inactive legs: dimmed — traffic color always preserved.
                         Rendered BEFORE markers so lines sit beneath icons. */}
                    {activeRoadSegments.length > 0
                        ? activeRoadSegments.map((seg, i) => {
                            if (!seg.latLngs || seg.latLngs.length < 2) return null
                            const color    = seg.color || getTrafficColor(seg.trafficRatio)
                            const isActive = i === activeSegmentIndex

                            const mainWeight  = isActive ? 6 : 3
                            const mainOpacity = isActive ? 1.0 : 0.35
                            const dashArray   = (!isActive && seg.isFallback) ? '6, 5' : null

                            return (
                                <div key={`courier-seg-${i}`}>
                                    {/* Glow halo — active leg only */}
                                    {isActive && (
                                        <Polyline
                                            positions={seg.latLngs}
                                            color={color}
                                            weight={14}
                                            opacity={0.22}
                                            lineCap="round"
                                            lineJoin="round"
                                        />
                                    )}
                                    <Polyline
                                        positions={seg.latLngs}
                                        color={color}
                                        weight={mainWeight}
                                        opacity={mainOpacity}
                                        dashArray={dashArray}
                                        lineCap="round"
                                        lineJoin="round"
                                    />
                                </div>
                            )
                          })
                        : routeLatLngs.length > 1 && (
                            <Polyline
                                positions={routeLatLngs}
                                color={vehicleColor}
                                weight={3}
                                opacity={0.25}
                                dashArray="6, 5"
                            />
                          )
                    }

                    {/* Truck marker — follows mockGpsPos which walks the OSRM polyline */}
                    {mockGpsPos && (
                        <Marker position={mockGpsPos} icon={makeTruckIcon(vehicleColor)}>
                            <Popup><span className="font-bold text-xs">🚚 Live Position</span></Popup>
                        </Marker>
                    )}

                    {/* ── Node markers with visual hierarchy ────────────────────
                         Priority from bottom to top:
                         1. Completed → tiny faded dot (no popup)
                         2. Future static → small slate dot
                         3. Dynamic (injected) pending → amber ⚡ pulsing icon
                         4. Next stop → large pulsing pin (rendered last = on top) */}
                    {mapNodes.map((node) => {
                        const nodeId    = node.id || node.location_id
                        const coords    = nodeMap[nodeId] || (node.lat ? { lat: node.lat, lon: node.lon } : null)
                        if (!coords) return null
                        const pos       = [coords.lat, coords.lon]
                        const isDone    = completedIdSet.has(nodeId)
                        const isNext    = nodeId === (nextStop?.id || nextStop?.location_id)
                        const isDynamic = node.isDynamic

                        if (isDone) return (
                            <Marker key={`${nodeId}-done`} position={pos} icon={makeCompletedDot()} />
                        )
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
                        if (isDynamic) return (
                            <Marker key={`${nodeId}-dyn`} position={pos} icon={makeDynamicIcon(vehicleColor)}>
                                <Popup>
                                    <div className="text-xs">
                                        <p className="font-bold text-amber-600">⚡ Dynamic Order</p>
                                        <p className="text-slate-500">{prettyName(nodeId)}</p>
                                    </div>
                                </Popup>
                            </Marker>
                        )
                        return (
                            <Marker key={`${nodeId}-fut`} position={pos} icon={makeFutureDot()} />
                        )
                    })}
                </MapContainer>

                {/* ── Rerouting overlay: appears while OSRM fetch is in-flight ─── */}
                {rerouteState.isRerouting && (
                    <div
                        style={{
                            position: 'absolute', inset: 0,
                            background: 'rgba(15,23,42,0.55)',
                            backdropFilter: 'blur(2px)',
                            display: 'flex', flexDirection: 'column',
                            alignItems: 'center', justifyContent: 'center',
                            gap: 8, zIndex: 9000,
                            borderRadius: 'inherit',
                        }}
                    >
                        <Loader2 size={26} className="text-white animate-spin" />
                        <p style={{ color: '#e2e8f0', fontSize: 11, fontWeight: 700, letterSpacing: '0.08em' }}>
                            OPTIMISING ROUTE…
                        </p>
                    </div>
                )}
            </div>

            {/* ── ITINERARY TIMELINE ──────────────────────────────────── */}
            <div className="flex-1 overflow-y-auto px-4 pt-3 pb-2 min-h-0">
                <div className="flex items-center justify-between mb-2">
                    <p className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">
                        Itinerary
                    </p>
                    <span className="text-[10px] font-mono text-slate-400">
                        {completedCount} done · {currentRouteQueue.filter(n => !completedIdSet.has(n.id)).length} pending
                    </span>
                </div>
                <ol className="relative">
                    {allTimelineNodes.map((node, i) => {
                        const nodeId    = node.id || node.location_id
                        const isDone    = completedIdSet.has(nodeId)
                        const isNext    = nodeId === (nextStop?.id || nextStop?.location_id)
                        const isDynamic = node.isDynamic

                        const dotColor = isDone    ? '#10b981'
                                       : isNext    ? vehicleColor
                                       : isDynamic ? '#f59e0b'
                                       : '#94a3b8'

                        return (
                            <li key={`tl-${nodeId}-${i}`} className="relative pl-6 pb-3.5 last:pb-0">
                                {/* Vertical connector */}
                                {i < allTimelineNodes.length - 1 && (
                                    <div
                                        className="absolute left-[9px] top-5 bottom-0 w-px"
                                        style={{ background: isDone ? '#10b981' : isDynamic ? '#fcd34d' : '#e2e8f0' }}
                                    />
                                )}
                                {/* Step dot */}
                                <div
                                    className="absolute left-0 top-1 w-[18px] h-[18px] rounded-full flex items-center justify-center text-white text-[9px] font-bold"
                                    style={{ background: dotColor }}
                                >
                                    {isDone ? '✓' : isDynamic ? '⚡' : i + 1}
                                </div>

                                {/* Content card */}
                                <div
                                    className={`rounded-xl px-3 py-2 border transition-all ${
                                        isNext    ? 'shadow-sm'
                                        : isDone  ? 'opacity-50'
                                        : 'border-transparent'
                                    }`}
                                    style={
                                        isNext ? { borderColor: `${vehicleColor}40`, background: `${vehicleColor}08` }
                                        : isDone ? { borderColor: '#e2e8f0', background: '#f8fafc' }
                                        : isDynamic ? { borderColor: '#fcd34d40', background: '#fffbeb' }
                                        : {}
                                    }
                                >
                                    <div className="flex items-center justify-between">
                                        <p className={`text-sm font-bold leading-tight ${
                                            isDone    ? 'line-through text-slate-400'
                                            : isNext  ? 'text-slate-800'
                                            : 'text-slate-600'
                                        }`}>
                                            {prettyName(nodeId)}
                                            {isDynamic && (
                                                <span className="ml-1.5 text-[9px] font-bold text-amber-600 bg-amber-100 px-1 py-0.5 rounded not-italic no-underline">
                                                    DYN
                                                </span>
                                            )}
                                        </p>
                                        {isNext && <StatusBadge step={node} showOnTime={false} />}
                                        {isDone && (
                                            <span className="text-[10px] font-bold text-emerald-600 bg-emerald-50 px-1.5 py-0.5 rounded-full">DONE</span>
                                        )}
                                    </div>
                                    <div className="flex items-center gap-2 mt-0.5">
                                        {node.arrival_time && (
                                            <span className="text-[10px] font-mono text-slate-400">
                                                ETA {node.arrival_time}
                                            </span>
                                        )}
                                        {node.demand !== 0 && node.demand !== undefined && (
                                            <span className={`text-[10px] font-mono ${node.demand > 0 ? 'text-blue-500' : 'text-amber-500'}`}>
                                                {node.demand > 0 ? `+${node.demand}` : node.demand} pkg
                                            </span>
                                        )}
                                        {isDynamic && (
                                            <span className="text-[10px] font-mono text-amber-500">
                                                spawned {Math.floor(node.spawnTime / 60)}m
                                            </span>
                                        )}
                                    </div>
                                </div>
                            </li>
                        )
                    })}
                </ol>
            </div>

            {/* ── SIMULATION CONTROL PANEL ────────────────────────────── */}
            <SimControlPanel
                isRunning={isRunning}
                isFinished={isFinished}
                virtualTimeDisplay={virtualTimeDisplay}
                simProgressPct={simProgressPct}
                targetDod={targetDod}
                actualDod={actualDod}
                dynamicOrdersCount={dynamicOrdersCount}
                pendingInjectionCount={pendingInjectionCount}
                onPlay={play}
                onPause={pause}
                onReset={handleReset}
                onChangeDod={setTargetDod}
                vehicleColor={vehicleColor}
            />

        </div>
    )
}
