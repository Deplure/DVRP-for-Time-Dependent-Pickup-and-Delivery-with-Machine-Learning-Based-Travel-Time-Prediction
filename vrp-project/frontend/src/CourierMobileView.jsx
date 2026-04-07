/**
 * CourierMobileView.jsx
 * ─────────────────────
 * Mobile-first dedicated interface for a single courier on the road.
 *
 * Props:
 *   vehicleId       – vehicle identifier (number)
 *   currentLocation – { lat, lon } mock GPS coords for the courier's truck
 *   routeData       – the vehicle route object from the /optimize response
 *                     e.g. { vehicle_id, steps: [{ location_id, task, arrival_time,
 *                             departure_time, is_late, demand }, …] }
 *   nodeMap         – { [location_id]: { lat, lon } } lookup built from the nodes array
 *   vehicleColor    – accent hex color for this vehicle
 *   onClose         – callback to dismiss the view
 */

import { useMemo, useState } from 'react'
import {
    MapContainer, TileLayer, Marker, Popup, Polyline, useMap,
} from 'react-leaflet'
import L from 'leaflet'
import {
    Navigation, CheckCircle2, Package, MapPin, Clock,
    ChevronRight, Truck, Flag, X, ExternalLink,
} from 'lucide-react'

// ─── HELPER: parse "HH:MM" → seconds ──────────────────────────────────────
const toSec = (hhmm) => {
    if (!hhmm) return 0
    const [h, m] = hhmm.split(':').map(Number)
    return h * 3600 + m * 60
}

// ─── ICON FACTORIES ────────────────────────────────────────────────────────
const makeIcon = (color, label, opts = {}) => L.divIcon({
    className: '',
    html: `<div style="
      width:${opts.size || 28}px; height:${opts.size || 28}px; border-radius:50%;
      background:${opts.fill || '#ffffff'}; border:2.5px solid ${color};
      display:flex; align-items:center; justify-content:center;
      box-shadow:0 2px 8px rgba(0,0,0,0.18), 0 0 0 3px ${color}22;
      font-size:${opts.fontSize || 10}px; font-weight:700;
      color:${opts.textColor || color};
      font-family:'JetBrains Mono',monospace;
      transition: all 0.2s;
    ">${label}</div>`,
    iconSize: [opts.size || 28, opts.size || 28],
    iconAnchor: [(opts.size || 28) / 2, (opts.size || 28) / 2],
    popupAnchor: [0, -16],
})

// Large pulsing "Next Stop" marker
const makeNextStopIcon = (color) => L.divIcon({
    className: '',
    html: `<div style="position:relative;width:44px;height:44px;">
      <div style="position:absolute;inset:0;border-radius:50%;background:${color}22;animation:ctPulse 1.6s infinite;"></div>
      <div style="position:absolute;inset:5px;border-radius:50%;background:#fff;border:3px solid ${color};
        display:flex;align-items:center;justify-content:center;
        box-shadow:0 4px 12px ${color}55;font-size:16px;">📍</div>
      <style>@keyframes ctPulse{0%,100%{transform:scale(1);opacity:0.6}50%{transform:scale(1.5);opacity:0.2}}</style>
    </div>`,
    iconSize: [44, 44],
    iconAnchor: [22, 22],
    popupAnchor: [0, -24],
})

// Tiny dot for future unvisited stops
const makeFutureDot = () => L.divIcon({
    className: '',
    html: `<div style="width:10px;height:10px;border-radius:50%;background:#94a3b8;border:2px solid #e2e8f0;box-shadow:0 1px 3px rgba(0,0,0,0.12);"></div>`,
    iconSize: [10, 10],
    iconAnchor: [5, 5],
})

// Tiny faded dot for completed stops
const makeCompletedDot = () => L.divIcon({
    className: '',
    html: `<div style="width:8px;height:8px;border-radius:50%;background:#e2e8f0;border:1.5px solid #cbd5e1;opacity:0.5;"></div>`,
    iconSize: [8, 8],
    iconAnchor: [4, 4],
})

// GPS truck marker (current location)
const makeTruckIcon = (color) => L.divIcon({
    className: '',
    html: `<div style="
      width:38px;height:38px;border-radius:50%;
      background:${color};border:3px solid #fff;
      display:flex;align-items:center;justify-content:center;
      box-shadow:0 3px 10px rgba(0,0,0,0.25), 0 0 0 4px ${color}44;
      font-size:18px;
    ">🚚</div>`,
    iconSize: [38, 38],
    iconAnchor: [19, 19],
})

// ─── MAP AUTO-FIT CONTROLLER ───────────────────────────────────────────────
// Zooms the map to fit the truck + next stop only
function CourierFitBounds({ currentLatLon, nextLatLon }) {
    const map = useMap()
    if (currentLatLon && nextLatLon) {
        const bounds = L.latLngBounds([currentLatLon, nextLatLon])
        map.fitBounds(bounds.pad(0.4), { animate: true, maxZoom: 17 })
    } else if (currentLatLon) {
        map.setView(currentLatLon, 16, { animate: true })
    }
    return null
}

// ─── STATUS BADGE ──────────────────────────────────────────────────────────
function StatusBadge({ step, showOnTime = true }) {
    if (!step) return null
    if (step.is_late) {
        return (
            <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-bold bg-red-100 text-red-600 border border-red-200">
                ⚠ LATE
            </span>
        )
    }
    if (showOnTime) {
        return (
            <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-bold bg-emerald-100 text-emerald-700 border border-emerald-200">
                ✓ ON TIME
            </span>
        )
    }
    return null
}

// ─── MAIN COMPONENT ─────────────────────────────────────────────────────────
export default function CourierMobileView({
    vehicleId,
    currentLocation,
    routeData,
    nodeMap = {},
    vehicleColor = '#6366f1',
    onClose,
}) {
    const [deliveredIds, setDeliveredIds] = useState(new Set())

    // ── Parse route steps ──────────────────────────────────────────────────
    // A "delivery" step has task === 'DELIVERY' or 'PICKUP' (not START/FINISH)
    const allSteps = routeData?.steps || []

    // Separate depot-terminal steps from actual deliveries
    const deliverySteps = useMemo(
        () => allSteps.filter(s => s.task !== 'START' && s.task !== 'FINISH' && s.location_id !== '0_Depot_Akhir'),
        [allSteps]
    )

    // Determine the "next stop": first step not yet delivered
    const nextStop = useMemo(
        () => deliverySteps.find(s => !deliveredIds.has(s.location_id)),
        [deliverySteps, deliveredIds]
    )

    // Counts
    const totalDeliveries = deliverySteps.length
    const completedCount = deliveredIds.size
    const progressPct = totalDeliveries > 0 ? Math.round((completedCount / totalDeliveries) * 100) : 0

    // Coordinates for the next stop
    const nextCoords = nextStop ? nodeMap[nextStop.location_id] : null
    const currentLatLon = currentLocation ? [currentLocation.lat, currentLocation.lon] : null
    const nextLatLon = nextCoords ? [nextCoords.lat, nextCoords.lon] : null

    // All node coords along the route for polyline
    const routeLatLngs = useMemo(() => {
        const pts = [currentLatLon].filter(Boolean)
        for (const step of deliverySteps) {
            const c = nodeMap[step.location_id]
            if (c) pts.push([c.lat, c.lon])
        }
        return pts
    }, [deliverySteps, nodeMap, currentLatLon])

    const handleMarkDelivered = () => {
        if (!nextStop) return
        setDeliveredIds(prev => new Set([...prev, nextStop.location_id]))
    }

    const prettyName = (id) => (id || '').replace(/_/g, ' ').replace(/^\d+\s*/, '')

    return (
        <div className="flex flex-col h-full bg-slate-50 font-sans overflow-hidden">

            {/* ── HEADER ─────────────────────────────────────────────── */}
            <div
                className="flex items-center justify-between px-4 py-3 border-b border-slate-200 flex-shrink-0"
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
                            {completedCount}/{totalDeliveries} deliveries · {progressPct}%
                        </p>
                    </div>
                </div>
                <button
                    onClick={onClose}
                    className="text-slate-400 hover:text-white transition-colors p-1.5 rounded-lg hover:bg-slate-700"
                >
                    <X size={18} />
                </button>
            </div>

            {/* ── PROGRESS BAR ───────────────────────────────────────── */}
            <div className="h-1.5 bg-slate-200 flex-shrink-0">
                <div
                    className="h-full transition-all duration-500 rounded-r-full"
                    style={{ width: `${progressPct}%`, background: vehicleColor }}
                />
            </div>

            {/* ── NEXT STOP HERO ─────────────────────────────────────── */}
            {nextStop ? (
                <div
                    className="mx-4 mt-4 rounded-2xl p-4 flex-shrink-0 border"
                    style={{
                        background: `linear-gradient(135deg, ${vehicleColor}12, ${vehicleColor}05)`,
                        borderColor: `${vehicleColor}30`,
                    }}
                >
                    <div className="flex items-start justify-between mb-2">
                        <div>
                            <p className="text-[10px] font-bold text-slate-400 uppercase tracking-widest mb-0.5">Next Stop</p>
                            <p className="text-base font-bold text-slate-800 leading-tight">
                                {prettyName(nextStop.location_id)}
                            </p>
                            <p className="text-xs text-slate-500 font-mono mt-0.5">{nextStop.location_id}</p>
                        </div>
                        <StatusBadge step={nextStop} />
                    </div>

                    {/* Time window info */}
                    <div className="flex items-center gap-3 mt-2 text-xs font-mono">
                        <div className="flex items-center gap-1 text-slate-500">
                            <Clock size={11} />
                            <span>ETA {nextStop.arrival_time}</span>
                        </div>
                        {nextStop.departure_time && (
                            <div className="flex items-center gap-1 text-slate-400">
                                <ChevronRight size={11} />
                                <span>ETD {nextStop.departure_time}</span>
                            </div>
                        )}
                        {nextStop.demand !== 0 && (
                            <span className={`px-1.5 py-0.5 rounded font-bold ${nextStop.demand > 0 ? 'bg-blue-50 text-blue-600' : 'bg-amber-50 text-amber-600'}`}>
                                {nextStop.demand > 0 ? `+${nextStop.demand}` : nextStop.demand} pkg
                            </span>
                        )}
                    </div>

                    {/* Action buttons */}
                    <div className="flex gap-2 mt-3">
                        <a
                            href={nextCoords
                                ? `https://maps.google.com/?q=${nextCoords.lat},${nextCoords.lon}`
                                : '#'}
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
                <div className="mx-4 mt-4 rounded-2xl p-5 text-center border border-emerald-200 bg-emerald-50 flex-shrink-0">
                    <p className="text-2xl mb-1">🎉</p>
                    <p className="font-bold text-emerald-700">All Deliveries Complete!</p>
                    <p className="text-xs text-emerald-600 mt-0.5">Return to depot</p>
                </div>
            )}

            {/* ── MAP ────────────────────────────────────────────────── */}
            <div className="mx-4 mt-3 rounded-2xl overflow-hidden border border-slate-200 flex-shrink-0" style={{ height: '220px' }}>
                <MapContainer
                    center={currentLatLon || [-7.266, 112.737]}
                    zoom={15}
                    style={{ height: '100%', width: '100%' }}
                    zoomControl={false}
                    attributionControl={false}
                >
                    <TileLayer
                        url="https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png"
                        maxZoom={20}
                    />
                    <CourierFitBounds currentLatLon={currentLatLon} nextLatLon={nextLatLon} />

                    {/* Route ghost polyline for directional context */}
                    {routeLatLngs.length > 1 && (
                        <Polyline
                            positions={routeLatLngs}
                            color={vehicleColor}
                            weight={3}
                            opacity={0.25}
                            dashArray="6, 5"
                        />
                    )}

                    {/* Truck / current GPS location */}
                    {currentLatLon && (
                        <Marker position={currentLatLon} icon={makeTruckIcon(vehicleColor)}>
                            <Popup>
                                <span className="font-bold text-xs">📍 Your Location</span>
                            </Popup>
                        </Marker>
                    )}

                    {/* Render markers per step with visual hierarchy */}
                    {deliverySteps.map((step) => {
                        const coords = nodeMap[step.location_id]
                        if (!coords) return null
                        const pos = [coords.lat, coords.lon]
                        const isCompleted = deliveredIds.has(step.location_id)
                        const isNext = step.location_id === nextStop?.location_id

                        if (isCompleted) {
                            // Completed → tiny faded dot, no popup clutter
                            return (
                                <Marker key={step.location_id} position={pos} icon={makeCompletedDot()} />
                            )
                        }
                        if (isNext) {
                            // Next stop → large pulsing marker
                            return (
                                <Marker key={step.location_id} position={pos} icon={makeNextStopIcon(vehicleColor)}>
                                    <Popup>
                                        <div className="text-xs font-bold text-slate-700">
                                            {prettyName(step.location_id)}<br />
                                            <span className="font-normal text-slate-500">ETA {step.arrival_time}</span>
                                        </div>
                                    </Popup>
                                </Marker>
                            )
                        }
                        // Future stop → small slate dot
                        return (
                            <Marker key={step.location_id} position={pos} icon={makeFutureDot()} />
                        )
                    })}
                </MapContainer>
            </div>

            {/* ── ITINERARY TIMELINE ──────────────────────────────────── */}
            <div className="flex-1 overflow-y-auto px-4 pt-3 pb-6">
                <p className="text-[10px] font-bold text-slate-400 uppercase tracking-widest mb-2">Itinerary</p>
                <ol className="relative">
                    {deliverySteps.map((step, i) => {
                        const isCompleted = deliveredIds.has(step.location_id)
                        const isNext = step.location_id === nextStop?.location_id
                        const isFuture = !isCompleted && !isNext

                        const dotColor = isCompleted ? '#10b981'
                            : isNext ? vehicleColor
                            : '#94a3b8'

                        return (
                            <li key={step.location_id} className="relative pl-6 pb-4 last:pb-0">
                                {/* Vertical connector line */}
                                {i < deliverySteps.length - 1 && (
                                    <div
                                        className="absolute left-[9px] top-5 bottom-0 w-px"
                                        style={{ background: isCompleted ? '#10b981' : '#e2e8f0' }}
                                    />
                                )}
                                {/* Step dot */}
                                <div
                                    className="absolute left-0 top-1 w-[18px] h-[18px] rounded-full flex items-center justify-center text-white text-[9px] font-bold flex-shrink-0"
                                    style={{ background: dotColor, border: `2px solid ${dotColor}` }}
                                >
                                    {isCompleted ? '✓' : i + 1}
                                </div>

                                {/* Content */}
                                <div
                                    className={`rounded-xl px-3 py-2 border transition-all ${
                                        isNext
                                            ? 'shadow-sm'
                                            : isCompleted
                                            ? 'opacity-50'
                                            : 'border-transparent'
                                    }`}
                                    style={isNext
                                        ? { borderColor: `${vehicleColor}40`, background: `${vehicleColor}08` }
                                        : isCompleted
                                        ? { borderColor: '#e2e8f0', background: '#f8fafc' }
                                        : {}
                                    }
                                >
                                    <div className="flex items-center justify-between">
                                        <p
                                            className={`text-sm font-bold leading-tight ${
                                                isCompleted
                                                    ? 'line-through text-slate-400'
                                                    : isNext
                                                    ? 'text-slate-800'
                                                    : 'text-slate-600'
                                            }`}
                                        >
                                            {prettyName(step.location_id)}
                                        </p>
                                        {isNext && <StatusBadge step={step} showOnTime={false} />}
                                        {isCompleted && (
                                            <span className="text-[10px] font-bold text-emerald-600 bg-emerald-50 px-1.5 py-0.5 rounded-full">DONE</span>
                                        )}
                                    </div>
                                    <div className="flex items-center gap-2 mt-0.5">
                                        <span className="text-[10px] font-mono text-slate-400">
                                            ETA {step.arrival_time}
                                        </span>
                                        {step.demand !== 0 && (
                                            <span className={`text-[10px] font-mono ${step.demand > 0 ? 'text-blue-500' : 'text-amber-500'}`}>
                                                {step.demand > 0 ? `+${step.demand}` : step.demand} pkg
                                            </span>
                                        )}
                                    </div>
                                </div>
                            </li>
                        )
                    })}
                </ol>
            </div>
        </div>
    )
}
