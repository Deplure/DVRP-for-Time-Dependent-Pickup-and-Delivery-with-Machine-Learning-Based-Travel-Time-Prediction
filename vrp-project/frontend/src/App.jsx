import { useState, useEffect, useRef } from 'react'
import axios from 'axios'
import { MapContainer, TileLayer, Marker, Popup, Polyline, useMap } from 'react-leaflet'
import L from 'leaflet'
import {
    Brain, Zap, Truck, BarChart3, CloudSun, Loader2,
    CheckCircle2, AlertCircle, MapPin, Navigation,
    Activity, ChevronRight, PackageCheck, Package,
    Warehouse, Flag, RefreshCw, Clock, Layers,
    Plus, X, Settings2, Route, Eye
} from 'lucide-react'
import CourierMobileView from './CourierMobileView'

// ===================== CONSTANTS =====================
const API_URL = 'http://localhost:8000/optimize'
const OSRM_URL = 'http://localhost:5001'  // port 5001 — port 5000 is taken by MLflow UI

const DEFAULT_NODES = [
    // ===== 0. DEPOT =====
    { id: '0_Depot_JNE', lat: -7.265232, lon: 112.736966, demand: 0, tw_start: 0, tw_end: 86400, service_time: 0 },

    // ===== JEBAKAN =====
    { id: '5_SMA_Trimurti', lat: -7.271378, lon: 112.743125, demand: 2, tw_start: 0, tw_end: 1800, service_time: 120 },
    { id: '7_Rawon_Setan', lat: -7.261884, lon: 112.739778, demand: 3, tw_start: 0, tw_end: 1800, service_time: 120 },

    // ===== FILLER LAMA =====
    { id: '4_Siola_Mall', lat: -7.256426, lon: 112.736236, demand: 4, tw_start: 0, tw_end: 900, service_time: 120 },
    { id: '1_TP_Tunjungan', lat: -7.262608, lon: 112.742352, demand: -3, tw_start: 0, tw_end: 900, service_time: 120 },
    { id: '3_Pasar_Kembang', lat: -7.269480, lon: 112.730594, demand: -5, tw_start: 0, tw_end: 900, service_time: 120 },
    { id: '8_Pandegiling', lat: -7.273641, lon: 112.733470, demand: -2, tw_start: 900, tw_end: 1800, service_time: 120 },
    { id: '2_Hotel_Majapahit', lat: -7.260656, lon: 112.738876, demand: -2, tw_start: 900, tw_end: 1800, service_time: 120 },
    { id: '9_Gramedia', lat: -7.266857, lon: 112.742223, demand: -2, tw_start: 900, tw_end: 1800, service_time: 120 },
    { id: '6_Patung_Sapi', lat: -7.263884, lon: 112.742308, demand: 1, tw_start: 900, tw_end: 1800, service_time: 120 },

    // ===== KORIDOR KEDUNGDORO =====
    { id: '10_SPBU_Kedungdoro', lat: -7.261012, lon: 112.732045, demand: -4, tw_start: 0, tw_end: 900, service_time: 120 },
    { id: '11_Apotek_K24', lat: -7.266050, lon: 112.731080, demand: 2, tw_start: 600, tw_end: 1800, service_time: 120 },
    { id: '12_Warkop_Pitlik', lat: -7.264020, lon: 112.735010, demand: -1, tw_start: 0, tw_end: 1800, service_time: 120 },
    { id: '13_Polsek_Tegalsari', lat: -7.267088, lon: 112.734000, demand: 3, tw_start: 0, tw_end: 1800, service_time: 120 },
    { id: '14_Sate_Klisik', lat: -7.271015, lon: 112.732090, demand: -3, tw_start: 900, tw_end: 1800, service_time: 120 },

    // ===== KORIDOR BASUKI RAHMAT =====
    { id: '15_KFC_Basra', lat: -7.265005, lon: 112.740510, demand: 4, tw_start: 900, tw_end: 1800, service_time: 120 },
    { id: '16_McD_Basra', lat: -7.263520, lon: 112.741080, demand: -2, tw_start: 0, tw_end: 3600, service_time: 120 },
    { id: '17_Kopi_Kenangan', lat: -7.262055, lon: 112.738010, demand: 2, tw_start: 1800, tw_end: 3600, service_time: 120 },
    { id: '18_Plaza_BRI', lat: -7.264510, lon: 112.742590, demand: -5, tw_start: 0, tw_end: 3600, service_time: 120 },
    { id: '19_Taman_Apsari', lat: -7.263080, lon: 112.744020, demand: 1, tw_start: 1800, tw_end: 3600, service_time: 120 },

    // ===== KORIDOR PANGLIMA SUDIRMAN =====
    { id: '20_Monumen_Bambu', lat: -7.267812, lon: 112.743050, demand: -2, tw_start: 1800, tw_end: 5400, service_time: 120 },
    { id: '21_Intiland_Tower', lat: -7.268045, lon: 112.741010, demand: 5, tw_start: 0, tw_end: 900, service_time: 120 },
    { id: '22_Hotel_Bumi', lat: -7.269088, lon: 112.742050, demand: -4, tw_start: 0, tw_end: 3600, service_time: 120 },
    { id: '23_Gereja_Hati_Kudus', lat: -7.270510, lon: 112.741580, demand: 2, tw_start: 0, tw_end: 2700, service_time: 120 },
    { id: '24_Pasar_Keputran', lat: -7.273050, lon: 112.742010, demand: -5, tw_start: 0, tw_end: 900, service_time: 120 },

    // ===== KORIDOR DARMO & DINOYO =====
    { id: '25_BCA_Darmo', lat: -7.275520, lon: 112.740050, demand: 3, tw_start: 900, tw_end: 1800, service_time: 120 },
    { id: '26_RS_Darmo', lat: -7.280010, lon: 112.738090, demand: -3, tw_start: 0, tw_end: 2700, service_time: 120 },
    { id: '27_Kantor_Pos_Dinoyo', lat: -7.278055, lon: 112.739020, demand: 4, tw_start: 1800, tw_end: 2700, service_time: 120 },
    { id: '28_Pecel_Madiun', lat: -7.272045, lon: 112.735080, demand: -2, tw_start: 1800, tw_end: 3600, service_time: 120 },
    { id: '29_Indomaret_Pregolan', lat: -7.268510, lon: 112.737520, demand: 1, tw_start: 0, tw_end: 1800, service_time: 120 },
]

// Traffic congestion color palette (replaces vehicle-id colors for polylines)
const TRAFFIC_COLORS = {
    clear:    '#3b82f6',   // blue    — ratio ≤ 1.1  (on time)
    moderate: '#f59e0b',   // amber   — ratio 1.1–1.5 (mild delay)
    heavy:    '#ef4444',   // red     — ratio > 1.5   (severe congestion)
}
// Vehicle accent colors kept for sidebar panels
const VEHICLE_COLORS = ['#8b5cf6', '#3b82f6', '#10b981', '#f59e0b', '#ef4444', '#06b6d4']
const VEHICLE_CSS = ['v-color-1', 'v-color-2', 'v-color-3', 'v-color-4']

// ===================== HELPERS =====================
// Convert "HH:MM" string → total seconds since midnight
const timeStrToSec = (hhmm) => {
    if (!hhmm) return 0
    const [h, m] = hhmm.split(':').map(Number)
    return h * 3600 + m * 60
}

// Return a traffic color based on actual/ideal ratio
const getTrafficColor = (ratio) => {
    if (!ratio || ratio <= 1.1) return TRAFFIC_COLORS.clear
    if (ratio <= 1.5)           return TRAFFIC_COLORS.moderate
    return                             TRAFFIC_COLORS.heavy
}

// ===================== CUSTOM MARKERS =====================
// Smart icon factory — color and label driven by status
const makeIcon = (color, label, opts = {}) => L.divIcon({
    className: '',
    html: `
    <div style="
      width:${opts.size || 30}px; height:${opts.size || 30}px; border-radius:50%;
      background:${opts.fill || '#ffffff'}; border:2.5px solid ${color};
      display:flex; align-items:center; justify-content:center;
      box-shadow:0 2px 8px rgba(0,0,0,0.15), 0 0 0 1px ${color}33;
      font-size:${opts.fontSize || 10}px; font-weight:700; color:${opts.textColor || color};
      font-family:'JetBrains Mono',monospace;
    ">${label}</div>`,
    iconSize: [opts.size || 30, opts.size || 30],
    iconAnchor: [(opts.size || 30) / 2, (opts.size || 30) / 2],
    popupAnchor: [0, -18],
})

// Depot icon — dark slate
const depotIcon = makeIcon('#0f172a', '🏠', { size: 32, fill: '#0f172a', textColor: '#fff', fontSize: 12 })

// Build a status-aware node icon
const makeNodeIcon = (nodeId, origIdx, nodeStatusMap) => {
    if (origIdx === 0) return depotIcon
    const status = nodeStatusMap?.get(nodeId)
    if (status) {
        const col = status.isLate ? '#ef4444' : '#10b981'
        const lbl = status.isLate ? '✗' : '✓'
        return makeIcon(col, lbl, { size: 28, fill: '#ffffff' })
    }
    // Default — corporate blue for unvisited/pre-optimization
    return makeIcon('#3b82f6', String(origIdx), { size: 28 })
}

// Grayed-out icon for nodes completely skipped by the solver
const makeUnvisitedIcon = (origIdx) => makeIcon('#cbd5e1', String(origIdx), {
    size: 26, fill: '#f8fafc', textColor: '#94a3b8',
})

// ===================== UTILS =====================
const taskBadge = (task) => {
    const map = {
        PICKUP: 'badge-pickup', DROP: 'badge-drop',
        START: 'badge-start', FINISH: 'badge-finish', PASS: 'badge-standby',
    }
    const icon = { PICKUP: '▲', DROP: '▼', START: '●', FINISH: '■', PASS: '○' }
    return (
        <span className={map[task] || 'badge-standby'}>
            {icon[task]} {task}
        </span>
    )
}

const formatRp = (num) => {
    if (!num && num !== 0) return 'Rp —'
    return 'Rp ' + Number(num).toLocaleString('id-ID')
}

// ===================== MAP FOCUS CONTROLLER =====================
// Handles both initial fit-all-nodes and single-vehicle auto-zoom.
function MapFocusController({ nodes, focusLatLngs }) {
    const map = useMap()

    // When a specific vehicle is selected → zoom to its road polyline
    useEffect(() => {
        if (focusLatLngs && focusLatLngs.length > 1) {
            const bounds = L.latLngBounds(focusLatLngs)
            map.fitBounds(bounds, { padding: [48, 48], maxZoom: 17 })
        }
    }, [focusLatLngs, map])

    // Initial fit to all nodes (only when focusLatLngs is null)
    useEffect(() => {
        if (!focusLatLngs && nodes && nodes.length > 0) {
            const bounds = L.latLngBounds(nodes.map(n => [n.lat, n.lon]))
            map.fitBounds(bounds, { padding: [40, 40] })
        }
    }, [nodes, map]) // eslint-disable-line react-hooks/exhaustive-deps

    return null
}

// ===================== WEATHER ICON =====================
const WeatherIcon = ({ weather }) => {
    const icons = {
        Rain: '🌧️', Drizzle: '🌦️', Thunderstorm: '⛈️',
        Clear: '☀️', Clouds: '☁️', Haze: '🌫️', Mist: '🌫️',
        Smoke: '🌫️', Snow: '❄️', Fog: '🌫️',
    }
    return <span>{icons[weather] || '🌡️'}</span>
}

// ===================== KPI CARD =====================
function KpiCard({ icon: Icon, label, value, sub, color, loading }) {
    return (
        <div className="glass-card p-4 flex items-start gap-3 fade-in-up">
            <div
                className="w-10 h-10 rounded-lg flex items-center justify-center flex-shrink-0 mt-0.5"
                style={{ background: `${color}18`, border: `1.5px solid ${color}40` }}
            >
                <Icon size={18} style={{ color }} />
            </div>
            <div className="flex-1 min-w-0">
                <p className="text-xs text-slate-400 uppercase tracking-widest font-semibold mb-1">{label}</p>
                {loading ? (
                    <div className="flex items-center gap-2">
                        <Loader2 size={16} className="animate-spin" style={{ color }} />
                        <span className="text-sm font-mono" style={{ color }}>Computing...</span>
                    </div>
                ) : (
                    <>
                        <p className="kpi-number" style={{ color }}>
                            {value}
                        </p>
                        {sub && <p className="text-xs text-slate-400 mt-0.5 font-mono">{sub}</p>}
                    </>
                )}
            </div>
        </div>
    )
}

// ===================== STATUS SYSTEM KPI =====================
function StatusCard({ status, loading }) {
    const cfg = {
        STANDBY: { label: 'Standby', color: '#64748b', Icon: Activity, badge: 'badge-standby' },
        OPTIMIZING: { label: 'Optimizing', color: '#8b5cf6', Icon: Loader2, badge: 'badge-running' },
        SUCCESS: { label: 'Success', color: '#10b981', Icon: CheckCircle2, badge: 'badge-success' },
        ERROR: { label: 'Error', color: '#ef4444', Icon: AlertCircle, badge: 'badge-standby' },
    }
    const c = cfg[status] || cfg.STANDBY

    return (
        <div className="glass-card p-4 flex items-start gap-3 fade-in-up">
            <div
                className="w-10 h-10 rounded-lg flex items-center justify-center flex-shrink-0 mt-0.5"
                style={{ background: `${c.color}18`, border: `1.5px solid ${c.color}40` }}
            >
                <c.Icon size={18} style={{ color: c.color }} className={status === 'OPTIMIZING' ? 'animate-spin' : ''} />
            </div>
            <div className="flex-1">
                <p className="text-xs text-slate-400 uppercase tracking-widest font-semibold mb-1">System Status</p>
                <div className="flex items-center gap-2 mt-1">
                    {status === 'SUCCESS' && <div className="w-2 h-2 rounded-full bg-emerald-500 pulse-ring" />}
                    {status === 'STANDBY' && <div className="w-2 h-2 rounded-full bg-slate-400" />}
                    {status === 'OPTIMIZING' && <div className="w-2 h-2 rounded-full bg-violet-500 animate-pulse" />}
                    {status === 'ERROR' && <div className="w-2 h-2 rounded-full bg-red-500" />}
                    <span className={c.badge}>{c.label}</span>
                </div>
                <p className="text-xs text-slate-400 mt-1 font-mono">
                    {status === 'STANDBY' && 'Awaiting optimization'}
                    {status === 'OPTIMIZING' && 'AI model processing...'}
                    {status === 'SUCCESS' && 'Routes computed ✓'}
                    {status === 'ERROR' && 'Check backend connection'}
                </p>
            </div>
        </div>
    )
}

// ===================== ROUTE TIMELINE STEP =====================
function RouteStep({ step, isLast }) {
    const task = step.task || 'PASS'
    const isTerminal = task === 'START' || task === 'FINISH'
    const dotColor = task === 'START' ? '#10b981' : task === 'FINISH' ? '#ef4444' : task === 'PICKUP' ? '#3b82f6' : '#f59e0b'
    const hasTimes = step.arrival_time && step.departure_time
    const hasService = (step.service_duration_mins ?? 0) > 0

    return (
        <div className="relative flex gap-2.5 pb-3">
            {!isLast && (
                <div className="absolute left-[9px] top-5 bottom-0 w-0.5"
                    style={{ background: 'linear-gradient(to bottom, rgba(99,102,241,0.3), rgba(99,102,241,0.04))' }} />
            )}

            {/* Timeline dot */}
            <div className="flex-shrink-0 mt-0.5">
                <div
                    className="w-[18px] h-[18px] rounded-full border-2 flex items-center justify-center"
                    style={{ borderColor: dotColor, background: '#ffffff', boxShadow: '0 1px 3px rgba(0,0,0,0.08)' }}
                >
                    <div className="w-1.5 h-1.5 rounded-full" style={{ background: dotColor }} />
                </div>
            </div>

            {/* Content */}
            <div className="flex-1 min-w-0 pb-0.5">
                {/* Location name + task badge */}
                <div className="flex items-center gap-1.5 flex-wrap mb-1">
                    {taskBadge(task)}
                    <p className="text-xs text-slate-700 font-semibold truncate" title={step.location_id}>
                        {step.location_id?.replace(/_/g, ' ')}
                    </p>
                    {step.is_late && (
                        <span className="text-[10px] font-bold text-red-500 bg-red-50 border border-red-200 rounded px-1">LATE</span>
                    )}
                </div>

                {/* Timestamp row: ETA | Service | ETD */}
                {hasTimes && !isTerminal && (
                    <div className="flex items-center gap-1 text-[10px] font-mono flex-wrap">
                        <span className="text-slate-400">ETA</span>
                        <span className="font-bold text-indigo-600 bg-indigo-50 px-1.5 py-0.5 rounded">{step.arrival_time}</span>
                        {hasService && (
                            <>
                                <span className="text-slate-300">›</span>
                                <span className="text-slate-400">Svc</span>
                                <span className="font-semibold text-amber-600 bg-amber-50 px-1.5 py-0.5 rounded">
                                    {step.service_duration_mins}m
                                </span>
                                <span className="text-slate-300">›</span>
                                <span className="text-slate-400">ETD</span>
                                <span className="font-bold text-emerald-600 bg-emerald-50 px-1.5 py-0.5 rounded">{step.departure_time}</span>
                            </>
                        )}
                    </div>
                )}

                {/* For START / FINISH: just show the single timestamp */}
                {hasTimes && isTerminal && (
                    <div className="flex items-center gap-1 text-[10px] font-mono">
                        <span className="text-slate-400">{task === 'START' ? 'Depart' : 'Arrive'}</span>
                        <span className="font-bold px-1.5 py-0.5 rounded"
                            style={{ color: dotColor, background: `${dotColor}12` }}>
                            {step.arrival_time}
                        </span>
                    </div>
                )}

                {/* Demand chip */}
                {step.demand !== 0 && (
                    <p className="text-[10px] text-slate-400 font-mono mt-0.5">
                        demand: <span className={step.demand > 0 ? 'text-blue-500' : 'text-amber-500'}>
                            {step.demand > 0 ? '+' : ''}{step.demand}
                        </span>
                    </p>
                )}
            </div>
        </div>
    )
}

// ===================== VEHICLE ROUTE PANEL =====================
function VehicleRoutePanel({ vehicle, colorIdx, isActive, onSelect }) {
    const [open, setOpen] = useState(true)
    const col = VEHICLE_COLORS[colorIdx % VEHICLE_COLORS.length]
    const cssClass = VEHICLE_CSS[colorIdx % VEHICLE_CSS.length]

    const handleHeaderClick = (e) => {
        // Single click on the header row = select vehicle on map
        // Chevron area still toggles expand
        onSelect(vehicle.vehicle_id)
        setOpen(o => !o)
    }

    return (
        <div
            className={`rounded-lg p-3 mb-2 ${cssClass} transition-all duration-200`}
            style={{
                boxShadow: isActive
                    ? `0 0 0 2px ${col}55, 0 2px 8px rgba(0,0,0,0.1)`
                    : '0 1px 3px rgba(0,0,0,0.06)',
                cursor: 'pointer',
            }}
        >
            <div className="flex items-center justify-between" onClick={handleHeaderClick}>
                <div className="flex items-center gap-2">
                    <Truck size={14} style={{ color: col }} />
                    <span className="text-xs font-bold font-mono" style={{ color: col }}>
                        VEHICLE #{vehicle.vehicle_id}
                    </span>
                    <span className="text-xs text-slate-400">
                        {vehicle.steps?.length || 0} stops
                    </span>
                    {isActive && (
                        <span className="text-[10px] font-bold px-1.5 py-0.5 rounded-full"
                            style={{ background: `${col}20`, color: col, border: `1px solid ${col}40` }}>
                            ON MAP
                        </span>
                    )}
                </div>
                <ChevronRight size={14} className={`text-slate-400 transition-transform duration-200 ${open ? 'rotate-90' : ''}`} />
            </div>

            {open && vehicle.steps && (
                <div className="mt-3 ml-1 fade-in-up">
                    {vehicle.steps.map((step, i) => (
                        <RouteStep key={i} step={step} isLast={i === vehicle.steps.length - 1} />
                    ))}
                </div>
            )}
        </div>
    )
}

// ===================== MAIN APP =====================
export default function App() {
    // --- Global state ---
    const [status, setStatus] = useState('STANDBY')
    const [loading, setLoading] = useState(false)
    const [result, setResult] = useState(null)
    const [error, setError] = useState(null)
    const [mapKey, setMapKey] = useState(1)
    const [mapKeyBench, setMapKeyBench] = useState(1)
    const [osrmRoads, setOsrmRoads] = useState([])        // AI map segments
    const [osrmBenchRoads, setOsrmBenchRoads] = useState([]) // Bench map segments
    const [osrmLoading, setOsrmLoading] = useState(false)

    // --- Node delivery status maps ---
    const [nodeStatusMap, setNodeStatusMap] = useState(null)       // AI routes
    const [benchNodeStatusMap, setBenchNodeStatusMap] = useState(null) // Benchmark routes

    // --- Independent vehicle filter states ---
    const [selectedAiVehicle, setSelectedAiVehicle] = useState('all')
    const [selectedBenchVehicle, setSelectedBenchVehicle] = useState('all')

    // --- Manager Live View: which courier card is open in the modal ---
    const [selectedLiveCourier, setSelectedLiveCourier] = useState(null)

    // --- Tab state ---
    const [activeTab, setActiveTab] = useState('configuration')

    // --- Configuration state ---
    const [numVehicles, setNumVehicles] = useState(5)
    const [vehicleCapacity, setVehicleCapacity] = useState(20)
    const [startTime, setStartTime] = useState('08:00')
    const [nodes, setNodes] = useState(DEFAULT_NODES)

    // --- Dynamic Injection State ---
    const [newOrders, setNewOrders] = useState([])
    const [interruptTime, setInterruptTime] = useState('10:00')

    // --- Geocoding / search state ---
    const [searchQuery, setSearchQuery] = useState('')
    const [searchLoading, setSearchLoading] = useState(false)
    const [searchError, setSearchError] = useState(null)
    const [savedLocations, setSavedLocations] = useState([])

    // ---- Remove a node by index ----
    const removeNode = (idx) => setNodes(prev => prev.filter((_, i) => i !== idx))

    // ---- Inline-edit a node field ----
    const updateNode = (idx, field, value) => {
        setNodes(prev => prev.map((n, i) => i === idx ? { ...n, [field]: value } : n))
    }

    // ---- Add a location directly to nodes ----
    const addLocationToNodes = (loc) => {
        const newNode = {
            id: loc.name.trim().replace(/\s+/g, '_').slice(0, 30) || `Node_${Date.now()}`,
            lat: parseFloat(loc.lat),
            lon: parseFloat(loc.lon),
            demand: 0,
            tw_start: 0,
            tw_end: 28800,
            service_time: 120,
        }
        setNodes(prev => [...prev, newNode])
    }

    // ---- Search location via backend geocoding ----
    const handleGeoSearch = async () => {
        if (!searchQuery.trim()) return
        setSearchLoading(true)
        setSearchError(null)
        try {
            const res = await fetch(`http://localhost:8000/search_location?q=${encodeURIComponent(searchQuery.trim())}`)
            if (!res.ok) {
                const err = await res.json()
                throw new Error(err.detail || 'Lokasi tidak ditemukan')
            }
            const loc = await res.json()
            addLocationToNodes(loc)
            setSearchQuery('')
            fetchSavedLocations()
        } catch (e) {
            setSearchError(e.message)
        } finally {
            setSearchLoading(false)
        }
    }

    // ---- Fetch saved locations (for chips) ----
    const fetchSavedLocations = async () => {
        try {
            const res = await fetch('http://localhost:8000/saved_locations')
            if (res.ok) setSavedLocations(await res.json())
        } catch (_) { /* server may be offline */ }
    }

    useEffect(() => { fetchSavedLocations() }, [])

    // ---- Fetch real road geometry from local OSRM ----
    // label: 'ai' | 'bench'  — determines which state slice to update
    const fetchOsrmRoads = async (routes, currentNodes, label = 'ai') => {
        if (label === 'ai') setOsrmLoading(true)

        // ----------------------------------------------------------------
        // STEP 1 — Build node-ID → {lat, lon} lookup (with depot aliases)
        // ----------------------------------------------------------------
        const nodeMap = {}
        if (currentNodes?.length > 0) {
            const depot = currentNodes[0]
            nodeMap[depot.id] = { lat: depot.lat, lon: depot.lon }
            nodeMap['0_Depot_Akhir'] = { lat: depot.lat, lon: depot.lon }
            nodeMap['0_Depot_JNE']   = { lat: depot.lat, lon: depot.lon }
            nodeMap['0_Depot']       = { lat: depot.lat, lon: depot.lon }
            for (let k = 1; k < currentNodes.length; k++) {
                const n = currentNodes[k]
                nodeMap[n.id] = { lat: n.lat, lon: n.lon }
            }
        }

        // ----------------------------------------------------------------
        // STEP 2 — OSRM pre-flight probe
        // ----------------------------------------------------------------
        let osrmReachable = false
        try {
            await fetch(`${OSRM_URL}/nearest/v1/driving/112.736966,-7.265232`, { signal: AbortSignal.timeout(4000) })
            osrmReachable = true
        } catch (_) { /* OSRM down */ }

        // ----------------------------------------------------------------
        // STEP 3 — Segment-by-segment fetching with traffic-ratio coloring
        //
        // For each pair of consecutive steps (A → B) in every vehicle route:
        //   • Call OSRM for the A→B leg to get ideal_duration + geometry
        //   • Compute actual_travel_secs = arrival_B - departure_A
        //   • traffic_ratio = actual / ideal  → determines color
        //   • Store each leg as an independent segment object
        // ----------------------------------------------------------------
        const segments = []

        for (const veh of routes) {
            const steps = veh.steps || []
            for (let s = 0; s < steps.length - 1; s++) {
                const stepA = steps[s]
                const stepB = steps[s + 1]

                const coordA = nodeMap[stepA.location_id]
                const coordB = nodeMap[stepB.location_id]

                if (!coordA || !coordB) {
                    console.warn(`[OSRM] Unknown node: "${!coordA ? stepA.location_id : stepB.location_id}"`)
                    continue
                }

                // Compute actual travel time (departure of A → arrival of B)
                const depASec = timeStrToSec(stepA.departure_time || stepA.arrival_time)
                const arrBSec = timeStrToSec(stepB.arrival_time)
                const actualTravelSec = Math.max(0, arrBSec - depASec)

                const osrmUrl = `${OSRM_URL}/route/v1/driving/${coordA.lon},${coordA.lat};${coordB.lon},${coordB.lat}?overview=full&geometries=geojson`

                if (!osrmReachable) {
                    // Fallback: straight dashed line, default blue
                    segments.push({
                        latLngs: [[coordA.lat, coordA.lon], [coordB.lat, coordB.lon]],
                        color: getTrafficColor(null),
                        trafficRatio: null,
                        isFallback: true,
                        vehicleId: veh.vehicle_id,
                    })
                    continue
                }

                try {
                    const res = await fetch(osrmUrl, { signal: AbortSignal.timeout(6000) })
                    if (!res.ok) throw new Error(`HTTP ${res.status}`)
                    const data = await res.json()
                    if (!data.routes?.length) throw new Error('no routes')

                    const idealSec = data.routes[0].duration  // OSRM ideal duration (seconds)
                    const ratio = idealSec > 0 ? actualTravelSec / idealSec : null
                    const color = getTrafficColor(ratio)

                    const latLngs = data.routes[0].geometry.coordinates.map(([lon, lat]) => [lat, lon])
                    segments.push({ latLngs, color, trafficRatio: ratio, isFallback: false, vehicleId: veh.vehicle_id })
                } catch (e) {
                    // Fallback to straight line with best-guess traffic color
                    const ratio = null
                    segments.push({
                        latLngs: [[coordA.lat, coordA.lon], [coordB.lat, coordB.lon]],
                        color: getTrafficColor(ratio),
                        trafficRatio: ratio,
                        isFallback: true,
                        vehicleId: veh.vehicle_id,
                    })
                }
            }
        }

        if (label === 'ai') {
            setOsrmRoads(segments)
            setOsrmLoading(false)
            console.log(`%c[OSRM-AI] ${segments.length} segments — road-snapped: ${segments.filter(s => !s.isFallback).length}`, 'color:#4ade80;font-weight:bold')
        } else {
            setOsrmBenchRoads(segments)
            console.log(`%c[OSRM-Bench] ${segments.length} segments`, 'color:#94a3b8;font-weight:bold')
        }
    }

    // ---- Run AI Optimization ----
    const handleOptimize = async () => {
        setLoading(true)
        setStatus('OPTIMIZING')
        setError(null)
        setResult(null)
        setOsrmRoads([])
        setOsrmBenchRoads([])
        setNodeStatusMap(null)

        const payload = {
            nodes,
            num_vehicles: numVehicles,
            vehicle_capacity: vehicleCapacity,
            start_time: startTime,
        }

        try {
            const res = await axios.post(API_URL, payload)
            const data = res.data
            setResult(data)
            setStatus('SUCCESS')
            setMapKey(k => k + 1)
            setMapKeyBench(k => k + 1)
            setActiveTab('manifest')

            // Build node status map (isLate, arrivalTime) from AI routes
            const statusMap = new Map()
            for (const veh of (data.routes || [])) {
                for (const step of (veh.steps || [])) {
                    if (step.location_id && step.location_id !== '0_Depot_Akhir') {
                        statusMap.set(step.location_id, {
                            isLate: step.is_late ?? false,
                            arrivalTime: step.arrival_time,
                        })
                    }
                }
            }
            setNodeStatusMap(statusMap)

            // Build benchmark status map from benchmark_routes
            const benchStatusMap = new Map()
            for (const veh of (data.benchmark_routes || [])) {
                for (const step of (veh.steps || [])) {
                    if (step.location_id && step.location_id !== '0_Depot_Akhir') {
                        benchStatusMap.set(step.location_id, {
                            isLate: step.is_late ?? false,
                            arrivalTime: step.arrival_time,
                        })
                    }
                }
            }
            setBenchNodeStatusMap(benchStatusMap)

            // Fetch road segments for both maps in parallel
            await Promise.all([
                fetchOsrmRoads(data.routes, nodes, 'ai'),
                ...(data.benchmark_routes?.length
                    ? [fetchOsrmRoads(data.benchmark_routes, nodes, 'bench')]
                    : [])
            ])
        } catch (err) {
            const msg = err.response?.data?.detail || err.message || 'Koneksi ke backend gagal'
            setError(msg)
            setStatus('ERROR')
        } finally {
            setLoading(false)
        }
    }

    // --- Fungsi Handle Dynamic Injection ---
    const handleDynamicInjection = async () => {
        if (newOrders.length === 0) return
        setLoading(true)
        setStatus('OPTIMIZING')
        setError(null)

        const payload = {
            original_nodes: nodes,
            original_routes: result.routes,
            new_orders: newOrders,
            start_time: startTime,
            interrupt_time: interruptTime,
            num_vehicles: numVehicles,
            vehicle_capacity: vehicleCapacity
        }

        try {
            const res = await axios.post('http://localhost:8000/dynamic_injection', payload)
            const data = res.data
            setResult(data)
            setStatus('SUCCESS')
            setMapKey(k => k + 1)
            setMapKeyBench(k => k + 1)
            setActiveTab('manifest')

            const combinedNodes = [...nodes, ...newOrders]
            setNodes(combinedNodes)
            setNewOrders([])

            // Rebuild delivery status map
            const statusMap = new Map()
            for (const veh of (data.routes || [])) {
                for (const step of (veh.steps || [])) {
                    if (step.location_id && step.location_id !== '0_Depot_Akhir') {
                        statusMap.set(step.location_id, {
                            isLate: step.is_late ?? false,
                            arrivalTime: step.arrival_time,
                        })
                    }
                }
            }
            setNodeStatusMap(statusMap)

            // Benchmark status map not rebuilt on dynamic injection (no bench_routes returned)
            setBenchNodeStatusMap(null)

            await fetchOsrmRoads(data.routes, combinedNodes, 'ai')
        } catch (err) {
            const msg = err.response?.data?.detail || err.message || 'Gagal inject orderan baru.'
            setError(msg)
            setStatus('ERROR')
        } finally {
            setLoading(false)
        }
    }

    const handleReset = () => {
        setStatus('STANDBY')
        setResult(null)
        setError(null)
        setOsrmRoads([])
        setOsrmBenchRoads([])
        setNodeStatusMap(null)
        setBenchNodeStatusMap(null)
        setNewOrders([])
        setActiveTab('configuration')
        setSelectedAiVehicle('all')
        setSelectedBenchVehicle('all')
        setSelectedLiveCourier(null)
    }

    // =====================================================================
    // DERIVED — AI MAP  (driven by selectedAiVehicle)
    // =====================================================================
    const activeAiRoad = selectedAiVehicle === 'all'
        ? null
        : osrmRoads.filter(r => r.vehicleId === selectedAiVehicle)

    const visibleRoads = selectedAiVehicle === 'all'
        ? osrmRoads
        : osrmRoads.filter(r => r.vehicleId === selectedAiVehicle)

    const aiVehicleStepIds = selectedAiVehicle !== 'all' && result
        ? new Set(
            (result.routes.find(r => r.vehicle_id === selectedAiVehicle)?.steps || [])
                .map(s => s.location_id)
          )
        : null

    const visibleNodes = nodes.filter((node, i) => {
        if (i === 0) return true
        if (!aiVehicleStepIds) return true
        return aiVehicleStepIds.has(node.id)
    })

    const focusAiLatLngs = activeAiRoad?.length > 0
        ? activeAiRoad.flatMap(seg => seg.latLngs || []).filter(Boolean)
        : null

    // =====================================================================
    // DERIVED — BENCH MAP  (driven by selectedBenchVehicle)
    // =====================================================================
    const activeBenchRoadSegs = selectedBenchVehicle === 'all'
        ? null
        : osrmBenchRoads.filter(r => r.vehicleId === selectedBenchVehicle)

    const visibleBenchRoads = selectedBenchVehicle === 'all'
        ? osrmBenchRoads
        : osrmBenchRoads.filter(r => r.vehicleId === selectedBenchVehicle)

    // Node IDs visited by the bench vehicle's route
    const benchVehicleStepIds = selectedBenchVehicle !== 'all' && result?.benchmark_routes
        ? new Set(
            (result.benchmark_routes.find(r => r.vehicle_id === selectedBenchVehicle)?.steps || [])
                .map(s => s.location_id)
          )
        : null

    // Set of ALL node IDs that appear in any benchmark route (for unvisited detection)
    const allBenchVisitedIds = result?.benchmark_routes
        ? new Set(
            (result.benchmark_routes).flatMap(r => (r.steps || []).map(s => s.location_id))
          )
        : null

    const focusBenchLatLngs = activeBenchRoadSegs?.length > 0
        ? activeBenchRoadSegs.flatMap(seg => seg.latLngs || []).filter(Boolean)
        : null

    // Bench markers: depot + filtered customers + grayed-out unvisited
    // When a vehicle filter is active → show only that vehicle's nodes
    // When 'all'                     → show all nodes, grayed if totally unvisited
    const visibleBenchNodes = nodes.filter((node, i) => {
        if (i === 0) return true           // depot always shown
        if (!benchVehicleStepIds) return true  // 'all' → show every node
        return benchVehicleStepIds.has(node.id)
    })

    // Which vehicle IDs exist in AI routes (for filter buttons)
    const vehicleIds = result?.routes?.map(r => r.vehicle_id) ?? []
    // Bench vehicle IDs
    const benchVehicleIds = result?.benchmark_routes?.map(r => r.vehicle_id) ?? []

    // Shared clean input style (light mode)
    const neonInput = {
        background: '#f8fafc',
        border: '1px solid #cbd5e1',
        borderRadius: '8px',
        color: '#0f172a',
        fontSize: '13px',
        fontFamily: 'Inter, system-ui, sans-serif',
        padding: '7px 10px',
        width: '100%',
        outline: 'none',
        transition: 'border-color 0.2s, box-shadow 0.2s',
    }

    return (
        <div className="min-h-screen relative" style={{ background: '#f1f5f9' }}>
            {/* Subtle dot grid BG */}
            <div className="grid-bg" />

            {/* Soft radial accent at top */}
            <div className="fixed inset-x-0 top-0 h-48 pointer-events-none z-0"
                style={{ background: 'radial-gradient(ellipse 80% 50% at 50% -10%, rgba(99,102,241,0.06) 0%, transparent 100%)' }} />

            {/* ===================== HEADER ===================== */}
            <header className="relative z-10 border-b" style={{ borderColor: 'rgba(0,0,0,0.08)', background: '#0f172a', boxShadow: '0 1px 4px rgba(0,0,0,0.15)' }}>
                <div className="max-w-screen-2xl mx-auto px-6 h-16 flex items-center justify-between">
                    <div className="flex items-center gap-3">
                        <div className="w-8 h-8 rounded-lg flex items-center justify-center"
                            style={{ background: 'linear-gradient(135deg, #3b82f6, #6366f1)', boxShadow: '0 0 12px rgba(99,102,241,0.4)' }}>
                            <Brain size={16} className="text-white" />
                        </div>
                        <div>
                            <h1 className="shimmer-text text-base font-bold tracking-tight leading-none">
                                AI Logistics Optimizer
                            </h1>
                            <p className="text-xs text-slate-400 font-mono leading-tight">VRP · Surabaya · Dynamic Routing</p>
                        </div>
                    </div>

                    <div className="hidden md:flex items-center gap-4">
                        <div className="flex items-center gap-1.5 text-xs font-mono text-slate-400">
                            <div className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" />
                            <span>Backend: <span className="text-emerald-400">ONLINE</span></span>
                        </div>
                        <div className="h-4 w-px bg-slate-700" />
                        <div className="flex items-center gap-1.5 text-xs font-mono text-slate-400">
                            <Layers size={11} className="text-indigo-400" />
                            <span>Model: <span className="text-indigo-400">XGBoost GPU</span></span>
                        </div>
                        {result?.metadata && (
                            <>
                                <div className="h-4 w-px bg-slate-700" />
                                <div className="flex items-center gap-1.5 text-xs font-mono text-slate-400">
                                    <WeatherIcon weather={result.metadata.weather} />
                                    <span>{result.metadata.weather}</span>
                                    {result.metadata.is_rain === 1 && (
                                        <span className="text-xs text-sky-400">(+traffic)</span>
                                    )}
                                </div>
                            </>
                        )}
                    </div>

                    <div className="flex items-center gap-2">
                        <Clock size={13} className="text-slate-500" />
                        <span className="text-xs font-mono text-slate-400">
                            {new Date().toLocaleTimeString('id-ID', { hour: '2-digit', minute: '2-digit' })} WIB
                        </span>
                    </div>
                </div>
            </header>

            {/* ===================== MAIN CONTENT ===================== */}
            <main className="relative z-10 max-w-screen-2xl mx-auto px-6 py-5">

                {/* KPI CARDS */}
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 mb-5">
                    <StatusCard status={status} loading={loading} />

                    <KpiCard
                        icon={BarChart3}
                        label="AI Route Cost"
                        value={result?.metadata?.ai_cost_rp != null ? formatRp(result.metadata.ai_cost_rp) : '—'}
                        sub={result?.metadata != null
                            ? `⛽ ${formatRp(result.metadata.ai_fuel_rp ?? result.metadata.ai_cost_rp)} | 🚨 Denda ${formatRp(result.metadata.ai_penalty_rp ?? 0)}`
                            : 'Total bensin + denda'}
                        color="#6366f1"
                        loading={loading}
                    />

                    <KpiCard
                        icon={Truck}
                        label="Cost Savings vs Standard"
                        value={result?.metadata?.savings_rp != null ? formatRp(result.metadata.savings_rp) : '—'}
                        sub={result?.metadata?.benchmark_cost_rp != null
                            ? `Standard: ${formatRp(result.metadata.benchmark_cost_rp)} | 🚨 ${result.metadata.bench_late_count ?? 0} late`
                            : 'Awaiting run'}
                        color={result?.metadata?.savings_rp > 0 ? '#10b981' : '#f59e0b'}
                        loading={loading}
                    />
                </div>

                {/* MAP + CONTROL PANEL GRID */}
                <div className="grid grid-cols-12 gap-4">

                    {/* ===== DUAL MAP PANEL (8/12) ===== */}
                    <div className="col-span-12 lg:col-span-8 flex flex-col gap-3">

                        {/* ---- SHARED LEGEND ROW ---- */}
                        <div className="flex items-center gap-4 px-1">
                            <span className="text-[10px] font-semibold text-slate-400 uppercase tracking-wider">Traffic:</span>
                            {[
                                { color: TRAFFIC_COLORS.clear,    label: 'Clear (≤1.1×)' },
                                { color: TRAFFIC_COLORS.moderate, label: 'Moderate (≤1.5×)' },
                                { color: TRAFFIC_COLORS.heavy,    label: 'Heavy (>1.5×)' },
                            ].map(({ color, label }) => (
                                <div key={label} className="flex items-center gap-1.5">
                                    <div className="w-5 h-1.5 rounded-full" style={{ background: color }} />
                                    <span className="text-[10px] font-mono text-slate-500">{label}</span>
                                </div>
                            ))}
                            <div className="w-px h-3 bg-slate-200 mx-1" />
                            <span className="text-[10px] font-semibold text-slate-400 uppercase tracking-wider">Stops:</span>
                            {[
                                { color: '#10b981', label: 'On-time' },
                                { color: '#ef4444', label: 'Late' },
                                { color: '#3b82f6', label: 'Unvisited' },
                            ].map(({ color, label }) => (
                                <div key={label} className="flex items-center gap-1">
                                    <div className="w-2.5 h-2.5 rounded-full border-2" style={{ borderColor: color, background: '#fff' }} />
                                    <span className="text-[10px] font-mono text-slate-500">{label}</span>
                                </div>
                            ))}
                        </div>

                        {/* ════ TOP: AI OPTIMIZED MAP ════ */}
                        <div className="glass-card-solid overflow-hidden" style={{ height: '320px' }}>
                            {/* Header */}
                            <div className="flex items-center justify-between px-4 py-2 border-b" style={{ borderColor: '#e2e8f0', background: '#f8fafc' }}>
                                <div className="flex items-center gap-2">
                                    <Brain size={13} className="text-indigo-500" />
                                    <span className="text-xs font-bold font-mono text-slate-700 tracking-wider">AI OPTIMIZED ROUTES</span>
                                    {osrmLoading && (
                                        <span className="flex items-center gap-1 text-xs font-mono text-indigo-500">
                                            <Loader2 size={10} className="animate-spin" />
                                            Snapping...
                                        </span>
                                    )}
                                    {osrmRoads.length > 0 && !osrmLoading && (
                                        <span className="text-xs font-mono text-emerald-600">• road-snapped</span>
                                    )}
                                </div>
                                {/* Vehicle filter — AI map only */}
                                <div className="flex items-center gap-1">
                                    <Route size={11} className="text-slate-400" />
                                    <button
                                        onClick={() => setSelectedAiVehicle('all')}
                                        className="px-2 py-0.5 rounded text-[10px] font-bold font-mono transition-all"
                                        style={{
                                            background: selectedAiVehicle === 'all' ? '#6366f1' : '#f1f5f9',
                                            color: selectedAiVehicle === 'all' ? '#fff' : '#64748b',
                                            border: selectedAiVehicle === 'all' ? '1px solid #6366f1' : '1px solid #e2e8f0',
                                        }}
                                    >All</button>
                                    {vehicleIds.map((vid, idx) => {
                                        const col = VEHICLE_COLORS[idx % VEHICLE_COLORS.length]
                                        const isSelected = selectedAiVehicle === vid
                                        return (
                                            <button
                                                key={vid}
                                                onClick={() => setSelectedAiVehicle(isSelected ? 'all' : vid)}
                                                className="px-2 py-0.5 rounded text-[10px] font-bold font-mono transition-all"
                                                style={{
                                                    background: isSelected ? col : '#f1f5f9',
                                                    color: isSelected ? '#fff' : '#64748b',
                                                    border: isSelected ? `1px solid ${col}` : '1px solid #e2e8f0',
                                                    boxShadow: isSelected ? `0 1px 6px ${col}55` : 'none',
                                                }}
                                            >V{idx + 1}</button>
                                        )
                                    })}
                                </div>
                            </div>

                            {/* AI Leaflet Map */}
                            <MapContainer
                                key={mapKey}
                                center={[-7.266, 112.737]}
                                zoom={14}
                                style={{ height: 'calc(100% - 40px)', width: '100%' }}
                                zoomControl={true}
                            >
                                <TileLayer
                                    url="https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png"
                                    attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OSM</a> &copy; <a href="https://carto.com/">CARTO</a>'
                                    maxZoom={20}
                                />
                                <MapFocusController nodes={visibleNodes} focusLatLngs={focusAiLatLngs?.length > 1 ? focusAiLatLngs : null} />

                                {/* Status-colored node markers */}
                                {visibleNodes.map((node) => {
                                    const origIdx = nodes.indexOf(node)
                                    const status = nodeStatusMap?.get(node.id)
                                    const isLate = status?.isLate ?? false
                                    const dotColor = origIdx === 0 ? '#0f172a' : (status ? (isLate ? '#ef4444' : '#10b981') : '#3b82f6')
                                    return (
                                        <Marker
                                            key={node.id}
                                            position={[node.lat, node.lon]}
                                            icon={makeNodeIcon(node.id, origIdx, nodeStatusMap)}
                                        >
                                            <Popup>
                                                <div style={{ fontFamily: 'Inter, system-ui, sans-serif', fontSize: '12px', color: '#0f172a' }}>
                                                    <div style={{ fontWeight: 700, marginBottom: 4, color: dotColor }}>
                                                        {origIdx === 0 ? '🏠 DEPOT' : `📍 NODE ${origIdx}`}
                                                    </div>
                                                    <div style={{ color: '#475569' }}>{node.id.replace(/_/g, ' ')}</div>
                                                    <div style={{ marginTop: 4 }}>
                                                        <span style={{ color: '#3b82f6' }}>Demand: </span>
                                                        <span>{node.demand}</span>
                                                    </div>
                                                    {status && (
                                                        <div style={{ marginTop: 4, fontWeight: 700, color: isLate ? '#ef4444' : '#10b981' }}>
                                                            {isLate ? '⚠ LATE' : '✓ ON TIME'} — ETA {status.arrivalTime}
                                                        </div>
                                                    )}
                                                </div>
                                            </Popup>
                                        </Marker>
                                    )
                                })}

                                {/* Traffic-colored segments — AI routes */}
                                {visibleRoads.map((seg, i) =>
                                    seg.latLngs?.length > 1 ? (
                                        <div key={`ai-seg-${i}`}>
                                            {/* Glow halo */}
                                            <Polyline positions={seg.latLngs} color={seg.color} weight={10} opacity={0.15} lineCap="round" lineJoin="round" />
                                            {/* Main line */}
                                            <Polyline
                                                positions={seg.latLngs}
                                                color={seg.color}
                                                weight={4}
                                                opacity={seg.isFallback ? 0.5 : 0.9}
                                                dashArray={seg.isFallback ? '6, 5' : null}
                                                lineCap="round"
                                                lineJoin="round"
                                            />
                                        </div>
                                    ) : null
                                )}
                            </MapContainer>
                        </div>

                        {/* ════ BOTTOM: BENCHMARK / STANDARD MAP ════ */}
                        <div className="glass-card-solid overflow-hidden" style={{ height: '310px' }}>
                            {/* Header */}
                            <div className="flex items-center justify-between px-4 py-2 border-b" style={{ borderColor: '#e2e8f0', background: '#f8fafc' }}>
                                <div className="flex items-center gap-2">
                                    <BarChart3 size={13} className="text-slate-500" />
                                    <span className="text-xs font-bold font-mono text-slate-600 tracking-wider">STANDARD / BENCHMARK ROUTES</span>
                                    {result?.benchmark_routes?.length > 0 ? (
                                        <span className="text-[10px] font-mono text-slate-400 bg-slate-100 px-1.5 py-0.5 rounded">
                                            {selectedBenchVehicle === 'all'
                                                ? `${result.benchmark_routes.length} vehicles`
                                                : `V${benchVehicleIds.indexOf(selectedBenchVehicle) + 1} only`
                                            }
                                        </span>
                                    ) : (
                                        <span className="text-[10px] text-slate-300 font-mono italic">
                                            {result ? 'No benchmark data' : 'Run optimization to compare'}
                                        </span>
                                    )}
                                </div>
                                {/* Independent filter for bench map */}
                                <div className="flex items-center gap-1">
                                    <Route size={11} className="text-slate-400" />
                                    <button
                                        onClick={() => setSelectedBenchVehicle('all')}
                                        className="px-2 py-0.5 rounded text-[10px] font-bold font-mono transition-all"
                                        style={{
                                            background: selectedBenchVehicle === 'all' ? '#64748b' : '#f1f5f9',
                                            color: selectedBenchVehicle === 'all' ? '#fff' : '#64748b',
                                            border: selectedBenchVehicle === 'all' ? '1px solid #64748b' : '1px solid #e2e8f0',
                                        }}
                                    >All</button>
                                    {benchVehicleIds.map((vid, idx) => {
                                        const col = VEHICLE_COLORS[idx % VEHICLE_COLORS.length]
                                        const isSelected = selectedBenchVehicle === vid
                                        return (
                                            <button
                                                key={vid}
                                                onClick={() => setSelectedBenchVehicle(isSelected ? 'all' : vid)}
                                                className="px-2 py-0.5 rounded text-[10px] font-bold font-mono transition-all"
                                                style={{
                                                    background: isSelected ? col : '#f1f5f9',
                                                    color: isSelected ? '#fff' : '#64748b',
                                                    border: isSelected ? `1px solid ${col}` : '1px solid #e2e8f0',
                                                    boxShadow: isSelected ? `0 1px 6px ${col}55` : 'none',
                                                }}
                                            >V{idx + 1}</button>
                                        )
                                    })}
                                </div>
                            </div>

                            {/* Benchmark Leaflet Map */}
                            <MapContainer
                                key={mapKeyBench}
                                center={[-7.266, 112.737]}
                                zoom={14}
                                style={{ height: 'calc(100% - 40px)', width: '100%' }}
                                zoomControl={false}
                            >
                                <TileLayer
                                    url="https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png"
                                    attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OSM</a> &copy; <a href="https://carto.com/">CARTO</a>'
                                    maxZoom={20}
                                />
                                <MapFocusController
                                    nodes={visibleBenchNodes}
                                    focusLatLngs={focusBenchLatLngs?.length > 1 ? focusBenchLatLngs : null}
                                />

                                {/* Benchmark markers — status-colored + unvisited grayed out */}
                                {visibleBenchNodes.map((node) => {
                                    const origIdx = nodes.indexOf(node)
                                    const status = benchNodeStatusMap?.get(node.id)
                                    const isVisited = !allBenchVisitedIds || allBenchVisitedIds.has(node.id)
                                    const isLate = status?.isLate ?? false
                                    const dotColor = origIdx === 0 ? '#0f172a'
                                        : !isVisited ? '#cbd5e1'
                                        : status ? (isLate ? '#ef4444' : '#10b981')
                                        : '#3b82f6'
                                    const icon = origIdx === 0 ? depotIcon
                                        : !isVisited ? makeUnvisitedIcon(origIdx)
                                        : makeNodeIcon(node.id, origIdx, benchNodeStatusMap)
                                    return (
                                        <Marker
                                            key={`bench-${node.id}`}
                                            position={[node.lat, node.lon]}
                                            icon={icon}
                                        >
                                            <Popup>
                                                <div style={{ fontFamily: 'Inter, system-ui, sans-serif', fontSize: '12px' }}>
                                                    <div style={{ fontWeight: 700, color: dotColor, marginBottom: 3 }}>
                                                        {origIdx === 0 ? '🏠 DEPOT' : `📍 NODE ${origIdx}`}
                                                    </div>
                                                    <div style={{ color: '#475569' }}>{node.id.replace(/_/g, ' ')}</div>
                                                    <div><span style={{ color: '#3b82f6' }}>Demand: </span>{node.demand}</div>
                                                    {status && (
                                                        <div style={{ marginTop: 4, fontWeight: 700, color: isLate ? '#ef4444' : '#10b981' }}>
                                                            {isLate ? '⚠ LATE' : '✓ ON TIME'} — ETA {status.arrivalTime}
                                                        </div>
                                                    )}
                                                    {!isVisited && (
                                                        <div style={{ marginTop: 4, color: '#94a3b8', fontStyle: 'italic' }}>Not visited by any vehicle</div>
                                                    )}
                                                </div>
                                            </Popup>
                                        </Marker>
                                    )
                                })}

                                {/* Traffic-colored benchmark segments — filtered by selectedVehicleView */}
                                {visibleBenchRoads.map((seg, i) =>
                                    seg.latLngs?.length > 1 ? (
                                        <div key={`bench-seg-${i}`}>
                                            <Polyline positions={seg.latLngs} color={seg.color} weight={10} opacity={0.12} lineCap="round" lineJoin="round" />
                                            <Polyline
                                                positions={seg.latLngs}
                                                color={seg.color}
                                                weight={3}
                                                opacity={seg.isFallback ? 0.45 : 0.85}
                                                dashArray={seg.isFallback ? '6, 5' : null}
                                                lineCap="round"
                                                lineJoin="round"
                                            />
                                        </div>
                                    ) : null
                                )}
                            </MapContainer>
                        </div>

                    </div>

                    {/* ===== 2-TAB CONTROL PANEL (4/12) ===== */}
                    <div className="col-span-12 lg:col-span-4 flex flex-col">
                        <div className="glass-card-solid flex flex-col" style={{ flex: 1, minHeight: '580px' }}>

                            {/* ---- TAB HEADER ---- */}
                            <div className="flex border-b" style={{ borderColor: '#e2e8f0' }}>
                                <button
                                    onClick={() => setActiveTab('configuration')}
                                    className="flex-1 flex items-center justify-center gap-1.5 py-3 text-xs font-bold font-mono tracking-wider transition-all duration-200 relative"
                                    style={{
                                        color: activeTab === 'configuration' ? '#6366f1' : '#94a3b8',
                                        background: activeTab === 'configuration' ? 'rgba(99,102,241,0.05)' : 'transparent',
                                    }}
                                >
                                    <Settings2 size={13} />
                                    Configuration
                                    {activeTab === 'configuration' && (
                                        <div className="absolute bottom-0 left-0 right-0 h-0.5"
                                            style={{ background: 'linear-gradient(90deg, transparent, #6366f1, transparent)' }} />
                                    )}
                                </button>

                                <button
                                    onClick={() => setActiveTab('manifest')}
                                    className="flex-1 flex items-center justify-center gap-1.5 py-3 text-xs font-bold font-mono tracking-wider transition-all duration-200 relative"
                                    style={{
                                        color: activeTab === 'manifest' ? '#3b82f6' : '#94a3b8',
                                        background: activeTab === 'manifest' ? 'rgba(59,130,246,0.05)' : 'transparent',
                                    }}
                                >
                                    <Route size={13} />
                                    Route Manifest
                                    {result && (
                                        <span className="ml-1 w-1.5 h-1.5 rounded-full bg-emerald-500 inline-block animate-pulse" />
                                    )}
                                    {activeTab === 'manifest' && (
                                        <div className="absolute bottom-0 left-0 right-0 h-0.5"
                                            style={{ background: 'linear-gradient(90deg, transparent, #3b82f6, transparent)' }} />
                                    )}
                                </button>
                            </div>

                            {/* ================================================================= */}
                            {/* ---- TAB: CONFIGURATION ---- */}
                            {/* ================================================================= */}
                            {activeTab === 'configuration' && (
                                <div className="flex flex-col flex-1 overflow-hidden">
                                    <div className="flex-1 overflow-y-auto scroll-panel px-4 pt-4 pb-2 space-y-4">

                                        {/* -- Global Parameters -- */}
                                        <div>
                                            <p className="text-xs text-slate-500 uppercase tracking-widest font-semibold mb-2 flex items-center gap-1.5">
                                                <Zap size={11} className="text-indigo-400" />
                                                Global Parameters
                                            </p>
                                            <div className="grid grid-cols-3 gap-2">
                                                {[
                                                    { label: 'Vehicles', value: numVehicles, setter: setNumVehicles, min: 1, max: 10 },
                                                    { label: 'Capacity', value: vehicleCapacity, setter: setVehicleCapacity, min: 1, max: 100 },
                                                ].map(({ label, value, setter, min, max }) => (
                                                    <div key={label}>
                                                        <label className="text-xs text-slate-500 font-mono mb-1 block">{label}</label>
                                                        <input
                                                            type="number"
                                                            min={min}
                                                            max={max}
                                                            value={value}
                                                            onChange={e => setter(Number(e.target.value))}
                                                            style={neonInput}
                                                            onFocus={e => {
                                                                e.target.style.borderColor = '#6366f1'
                                                                e.target.style.boxShadow = '0 0 0 3px rgba(99,102,241,0.12)'
                                                            }}
                                                            onBlur={e => {
                                                                e.target.style.borderColor = '#cbd5e1'
                                                                e.target.style.boxShadow = 'none'
                                                            }}
                                                        />
                                                    </div>
                                                ))}

                                                {/* [UBAHAN] Input Start Time dengan limit min dan max */}
                                                <div>
                                                    <label className="text-xs text-slate-500 font-mono mb-1 block">Start Time</label>
                                                    <input
                                                        type="time"
                                                        min="07:00"
                                                        max="19:00"
                                                        value={startTime}
                                                        onChange={e => setStartTime(e.target.value)}
                                                        style={neonInput}
                                                        onFocus={e => {
                                                            e.target.style.borderColor = '#6366f1'
                                                            e.target.style.boxShadow = '0 0 0 3px rgba(99,102,241,0.12)'
                                                        }}
                                                        onBlur={e => {
                                                            e.target.style.borderColor = '#cbd5e1'
                                                            e.target.style.boxShadow = 'none'
                                                        }}
                                                    />
                                                </div>
                                            </div>
                                        </div>

                                        {/* ===== GEOCODING SEARCH ===== */}
                                        <div>
                                            <p className="text-xs text-slate-500 uppercase tracking-widest font-semibold mb-2 flex items-center gap-1.5">
                                                <MapPin size={11} className="text-indigo-400" />
                                                Search Location
                                            </p>
                                            <div className="flex gap-2">
                                                <input
                                                    type="text"
                                                    value={searchQuery}
                                                    onChange={e => { setSearchQuery(e.target.value); setSearchError(null) }}
                                                    onKeyDown={e => e.key === 'Enter' && handleGeoSearch()}
                                                    placeholder="e.g. Tunjungan Plaza Surabaya"
                                                    style={{
                                                        flex: 1,
                                                        background: '#f8fafc',
                                                        border: '1px solid #cbd5e1',
                                                        borderRadius: '7px',
                                                        color: '#0f172a',
                                                        fontSize: '11px',
                                                        fontFamily: 'Inter, system-ui, sans-serif',
                                                        padding: '6px 10px',
                                                        outline: 'none',
                                                    }}
                                                    onFocus={e => {
                                                        e.target.style.borderColor = '#6366f1'
                                                        e.target.style.boxShadow = '0 0 0 3px rgba(99,102,241,0.1)'
                                                    }}
                                                    onBlur={e => {
                                                        e.target.style.borderColor = '#cbd5e1'
                                                        e.target.style.boxShadow = 'none'
                                                    }}
                                                />
                                                <button
                                                    onClick={handleGeoSearch}
                                                    disabled={searchLoading || !searchQuery.trim()}
                                                    className="flex-shrink-0 flex items-center gap-1.5 px-3 py-1.5 text-xs font-mono font-bold rounded-lg transition-all"
                                                    style={{
                                                        background: searchLoading ? '#f1f5f9' : 'rgba(99,102,241,0.12)',
                                                        border: '1px solid rgba(99,102,241,0.35)',
                                                        color: '#6366f1',
                                                        cursor: searchLoading ? 'wait' : 'pointer',
                                                    }}
                                                >
                                                    {searchLoading
                                                        ? <Loader2 size={12} className="animate-spin" />
                                                        : <MapPin size={12} />}
                                                    Search
                                                </button>
                                            </div>
                                            {searchError && (
                                                <p className="text-xs text-red-400 font-mono mt-1.5 flex items-center gap-1">
                                                    <AlertCircle size={10} /> {searchError}
                                                </p>
                                            )}
                                        </div>

                                        {/* ===== QUICK-ADD CHIPS (Saved Locations) ===== */}
                                        {savedLocations.length > 0 && (
                                            <div>
                                                <p className="text-xs text-slate-500 uppercase tracking-widest font-medium mb-2 flex items-center gap-1.5">
                                                    <Zap size={11} className="text-indigo-400" />
                                                    Quick Add
                                                    <span className="text-indigo-500 font-mono">[{savedLocations.length}]</span>
                                                </p>
                                                <div className="flex flex-wrap gap-1.5">
                                                    {savedLocations.map(loc => (
                                                        <button
                                                            key={loc.id}
                                                            onClick={() => addLocationToNodes(loc)}
                                                            className="text-xs font-mono px-2.5 py-1 rounded-full transition-all duration-150 hover:scale-105"
                                                            style={{
                                                                background: 'rgba(99,102,241,0.08)',
                                                                border: '1px solid rgba(99,102,241,0.28)',
                                                                color: '#6366f1',
                                                                maxWidth: '130px',
                                                                overflow: 'hidden',
                                                                textOverflow: 'ellipsis',
                                                                whiteSpace: 'nowrap',
                                                            }}
                                                            title={`${loc.name} (${parseFloat(loc.lat).toFixed(4)}, ${parseFloat(loc.lon).toFixed(4)})`}
                                                        >
                                                            + {loc.name.length > 16 ? loc.name.slice(0, 16) + '…' : loc.name}
                                                        </button>
                                                    ))}
                                                </div>
                                            </div>
                                        )}

                                        {/* ===== EDITABLE NODE LIST ===== */}
                                        <div>
                                            <p className="text-xs text-slate-500 uppercase tracking-widest font-semibold mb-2 flex items-center gap-1.5">
                                                <MapPin size={11} className="text-indigo-400" />
                                                Route Nodes
                                                <span className="text-indigo-500 font-mono">[{nodes.length}]</span>
                                            </p>

                                            <div className="space-y-2">
                                                {nodes.map((node, idx) => (
                                                    <div
                                                        key={`${node.id}-${idx}`}
                                                        className="rounded-lg p-2.5 group transition-all duration-150"
                                                        style={{
                                                            background: idx === 0 ? 'rgba(16,185,129,0.06)' : '#f8fafc',
                                                            border: idx === 0 ? '1px solid rgba(16,185,129,0.25)' : '1px solid #e2e8f0',
                                                        }}
                                                    >
                                                        <div className="flex items-center gap-2 mb-1.5">
                                                            <div
                                                                className="flex-shrink-0 w-5 h-5 rounded-full flex items-center justify-center font-mono font-bold"
                                                                style={{
                                                                    background: idx === 0 ? 'rgba(16,185,129,0.15)' : 'rgba(99,102,241,0.12)',
                                                                    color: idx === 0 ? '#10b981' : VEHICLE_COLORS[(idx - 1) % VEHICLE_COLORS.length],
                                                                    fontSize: '9px',
                                                                }}
                                                            >
                                                                {idx === 0 ? '🏠' : idx}
                                                            </div>
                                                            <p className="flex-1 text-xs font-mono text-slate-600 truncate" title={node.id}>
                                                                {node.id.replace(/_/g, ' ')}
                                                            </p>
                                                            {idx !== 0 && (
                                                                <button
                                                                    onClick={() => removeNode(idx)}
                                                                    className="flex-shrink-0 w-5 h-5 rounded flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity"
                                                                    style={{ background: 'rgba(239,68,68,0.12)', color: '#ef4444' }}
                                                                >
                                                                    <X size={10} />
                                                                </button>
                                                            )}
                                                        </div>
                                                        <p className="text-xs font-mono text-slate-400 mb-1.5 pl-7">
                                                            {node.lat.toFixed(4)}, {node.lon.toFixed(4)}
                                                        </p>
                                                        <div className="grid grid-cols-4 gap-1.5 pl-7">
                                                            {[
                                                                { field: 'demand', label: 'Demand' },
                                                                { field: 'tw_start', label: 'TW↑(s)' },
                                                                { field: 'tw_end', label: 'TW↓(s)' },
                                                                { field: 'service_time', label: 'Svc(s)' },
                                                            ].map(({ field, label }) => (
                                                                <div key={field}>
                                                                    <label className="text-xs font-mono mb-0.5 block" style={{ color: '#94a3b8', fontSize: '9px' }}>{label}</label>
                                                                    <input
                                                                        type="number"
                                                                        value={node[field]}
                                                                        onChange={e => updateNode(idx, field, parseInt(e.target.value) || 0)}
                                                                        style={{
                                                                            width: '100%',
                                                                            background: '#f1f5f9',
                                                                            border: '1px solid #e2e8f0',
                                                                            borderRadius: '5px',
                                                                            color: field === 'demand'
                                                                                ? (node.demand > 0 ? '#3b82f6' : node.demand < 0 ? '#f59e0b' : '#64748b')
                                                                                : '#475569',
                                                                            fontSize: '10px',
                                                                            fontFamily: 'JetBrains Mono, monospace',
                                                                            padding: '3px 5px',
                                                                            outline: 'none',
                                                                        }}
                                                                        onFocus={e => {
                                                                            e.target.style.borderColor = '#6366f1'
                                                                            e.target.style.boxShadow = '0 0 0 2px rgba(99,102,241,0.1)'
                                                                        }}
                                                                        onBlur={e => {
                                                                            e.target.style.borderColor = '#e2e8f0'
                                                                            e.target.style.boxShadow = 'none'
                                                                        }}
                                                                    />
                                                                </div>
                                                            ))}
                                                        </div>
                                                    </div>
                                                ))}
                                            </div>
                                        </div>

                                        {/* ===== DYNAMIC EVENT INJECTION ===== */}
                                        {result && (
                                            <div className="p-4 rounded-lg border fade-in-up" style={{ background: 'rgba(245,158,11,0.06)', border: '1px solid rgba(245,158,11,0.3)' }}>
                                                <p className="text-xs text-amber-600 uppercase tracking-widest font-semibold mb-3 flex items-center gap-1.5">
                                                    <Zap size={14} /> Ada Orderan Mendadak?
                                                </p>

                                                <div className="flex gap-3 mb-3">
                                                    {/* [UBAHAN] Input Jam Order Masuk dengan limit min dan max */}
                                                    <div className="flex-1">
                                                        <label className="text-xs text-amber-700 font-mono mb-1 block">Jam Order Masuk</label>
                                                        <input
                                                            type="time"
                                                            min="07:00"
                                                            max="19:00"
                                                            value={interruptTime}
                                                            onChange={e => setInterruptTime(e.target.value)}
                                                            style={{ ...neonInput, borderColor: 'rgba(245,158,11,0.35)', color: '#92400e' }}
                                                        />
                                                    </div>
                                                    <div className="flex-1">
                                                        <label className="text-xs text-amber-700 font-mono mb-1 block">Tambah Paket</label>
                                                        <button
                                                            onClick={() => {
                                                                const id = `Mendadak_${Date.now().toString().slice(-4)}`
                                                                setNewOrders(prev => [...prev, { id, lat: -7.261884, lon: 112.739778, demand: 2, tw_start: 0, tw_end: 28800 }])
                                                            }}
                                                            className="w-full py-1.5 px-2 text-[10px] font-bold rounded bg-orange-500/20 text-orange-300 hover:bg-orange-500/30 transition-colors"
                                                        >
                                                            + Add Dummy Order
                                                        </button>
                                                    </div>
                                                </div>

                                                {/* Daftar Keranjang Order Baru */}
                                                {newOrders.map((no, idx) => (
                                                    <div key={idx} className="flex justify-between items-center text-[10px] text-slate-600 font-mono mb-2 p-1.5 bg-amber-50 rounded border border-amber-200">
                                                        <span>{no.id} | Dem: {no.demand}</span>
                                                        <span className="text-amber-600">Menunggu...</span>
                                                    </div>
                                                ))}

                                                <button
                                                    onClick={handleDynamicInjection}
                                                    disabled={newOrders.length === 0 || loading}
                                                    className={`w-full mt-2 py-2 text-xs font-bold rounded-lg transition-all shadow-lg ${newOrders.length > 0 && !loading
                                                            ? 'bg-gradient-to-r from-orange-600 to-red-600 text-white hover:shadow-orange-500/20'
                                                            : 'bg-slate-800 text-slate-500 cursor-not-allowed'
                                                        }`}
                                                >
                                                    {loading ? 'Injecting...' : '🚀 Inject Order & Re-Optimize'}
                                                </button>
                                            </div>
                                        )}

                                        {/* Payload preview */}
                                        <div className="rounded-lg p-3 text-xs font-mono"
                                            style={{ background: '#f8fafc', border: '1px solid #e2e8f0' }}>
                                            <p className="text-slate-400 mb-1">Payload Preview:</p>
                                            <p className="text-slate-600">nodes: <span className="text-indigo-500">{nodes.length}</span></p>
                                            <p className="text-slate-600">vehicles: <span className="text-indigo-500">{numVehicles}</span></p>
                                            <p className="text-slate-600">capacity: <span className="text-indigo-500">{vehicleCapacity}</span></p>
                                            <p className="text-slate-600">start_time: <span className="text-indigo-500">{startTime}</span></p>
                                        </div>

                                        {/* Error banner */}
                                        {error && (
                                            <div className="rounded-lg p-3 flex items-start gap-2 fade-in-up"
                                                style={{ background: 'rgba(239,68,68,0.06)', border: '1px solid rgba(239,68,68,0.2)' }}>
                                                <AlertCircle size={14} className="text-red-500 flex-shrink-0 mt-0.5" />
                                                <p className="text-xs text-red-600 font-mono">{error}</p>
                                            </div>
                                        )}
                                    </div>

                                    {/* ---- RUN BUTTON (sticky bottom) ---- */}
                                    <div className="px-4 pb-4 pt-2 border-t" style={{ borderColor: '#e2e8f0' }}>
                                        <button
                                            className="btn-neon w-full py-3.5 text-sm"
                                            onClick={handleOptimize}
                                            disabled={loading || nodes.length < 2}
                                            id="btn-run-optimization"
                                        >
                                            {loading ? (
                                                <span className="flex items-center justify-center gap-2">
                                                    <Loader2 size={16} className="animate-spin" />
                                                    AI Computing Routes...
                                                </span>
                                            ) : (
                                                <span className="flex items-center justify-center gap-2">
                                                    <Brain size={16} />
                                                    Run Initial Optimization
                                                </span>
                                            )}
                                        </button>
                                        {result && (
                                            <button
                                                className="w-full mt-2 py-2 text-xs font-mono text-slate-500 hover:text-slate-300 flex items-center justify-center gap-1.5 transition-colors"
                                                onClick={handleReset}
                                            >
                                                <RefreshCw size={11} />
                                                Reset & Clear Map
                                            </button>
                                        )}
                                    </div>
                                </div>
                            )}

                            {/* ================================================================= */}
                            {/* ---- TAB: ROUTE MANIFEST ---- */}
                            {/* ================================================================= */}
                            {activeTab === 'manifest' && (
                                <div className="flex flex-col flex-1 overflow-hidden">
                                    <div className="flex items-center justify-between px-4 pt-4 pb-2">
                                        <div className="flex items-center gap-2">
                                            <Navigation size={14} className="text-blue-500" />
                                            <span className="text-xs font-bold font-mono text-slate-700 tracking-wider">ROUTE MANIFEST</span>
                                        </div>
                                        {result && (
                                            <span className="badge-success text-xs">{result.status}</span>
                                        )}
                                    </div>

                                    {/* Empty state */}
                                    {!result && !loading && (
                                        <div className="flex-1 flex flex-col items-center justify-center py-8 text-center px-4">
                                            <div className="w-12 h-12 rounded-full flex items-center justify-center mb-3"
                                                style={{ background: '#f1f5f9', border: '1px dashed #cbd5e1' }}>
                                                <PackageCheck size={22} className="text-slate-400" />
                                            </div>
                                            <p className="text-xs text-slate-400 font-mono max-w-[200px] leading-relaxed">
                                                Go to <span className="text-indigo-500">Configuration</span> tab and press <span className="text-indigo-500">"Run Initial Optimization"</span> to generate routes.
                                            </p>
                                        </div>
                                    )}

                                    {/* Loading state */}
                                    {loading && (
                                        <div className="flex-1 flex flex-col items-center justify-center py-8 text-center">
                                            <div className="w-10 h-10 rounded-full border-2 border-indigo-500 border-t-transparent animate-spin mb-3" />
                                            <p className="text-xs text-indigo-500 font-mono animate-pulse">Neural path computing...</p>
                                        </div>
                                    )}

                                    {/* Route data */}
                                    {result && !loading && (
                                        <div className="scroll-panel flex-1 overflow-y-auto px-4 pb-4">

                                            {/* ===== INJECTION BANNER ===== */}
                                            {result.metadata?.type === "MID-ROUTE INJECTION" && (
                                                <div className="mb-3 p-3 rounded-lg border border-orange-500/30 bg-orange-500/10 fade-in-up">
                                                    <div className="flex items-center gap-2 mb-1.5">
                                                        <Zap size={14} className="text-orange-400" />
                                                        <span className="text-xs font-bold font-mono text-orange-400 tracking-widest">DYNAMIC RE-ROUTING AKTIF</span>
                                                    </div>
                                                    <p className="text-xs font-mono text-orange-200/80 leading-relaxed">
                                                        Sistem telah mencegat armada pada jam interupsi dan mendistribusikan pesanan baru ke kurir yang posisinya paling menguntungkan.
                                                    </p>
                                                </div>
                                            )}

                                            {/* ===== SCORE BOARD PANEL ===== */}
                                            {result.metadata?.savings_rp != null && (
                                                <div className="mb-3 rounded-lg overflow-hidden fade-in-up" style={{ border: '1px solid #e2e8f0', boxShadow: '0 1px 4px rgba(0,0,0,0.06)' }}>
                                                    {/* Header */}
                                                    <div className="px-3 py-2 flex items-center gap-2" style={{ background: '#f8fafc', borderBottom: '1px solid #e2e8f0' }}>
                                                        <BarChart3 size={12} className="text-indigo-500" />
                                                        <span className="text-xs font-bold font-mono text-slate-700 tracking-widest">SCORE BOARD</span>
                                                    </div>

                                                    {/* AI Row */}
                                                    <div className="px-3 py-2.5" style={{ background: '#fafafa' }}>
                                                        <div className="flex items-center justify-between mb-1">
                                                            <span className="text-xs font-bold font-mono" style={{ color: '#6366f1' }}>🤖 AI VRP</span>
                                                            <span className="text-xs font-bold font-mono" style={{ color: (result.metadata.ai_penalty_rp ?? 0) > 0 ? '#f59e0b' : '#10b981' }}>
                                                                TOTAL {formatRp(result.metadata.ai_cost_rp)}
                                                            </span>
                                                        </div>
                                                        <div className="flex gap-3 text-xs font-mono text-slate-500">
                                                            <span>⛽ {formatRp(result.metadata.ai_fuel_rp ?? result.metadata.ai_cost_rp)}</span>
                                                            <span style={{ color: (result.metadata.ai_penalty_rp ?? 0) > 0 ? '#ef4444' : '#10b981' }}>
                                                                🚨 Denda {formatRp(result.metadata.ai_penalty_rp ?? 0)}
                                                            </span>
                                                        </div>
                                                        {(result.metadata.ai_late_count ?? 0) > 0 ? (
                                                            <p className="text-xs font-mono mt-0.5" style={{ color: '#ef4444' }}>{result.metadata.ai_late_count} pelanggaran time window</p>
                                                        ) : (
                                                            <p className="text-xs font-mono mt-0.5" style={{ color: '#10b981' }}>✨ Semua tepat waktu!</p>
                                                        )}
                                                    </div>

                                                    <div style={{ height: 1, background: '#e2e8f0' }} />

                                                    {/* Standard Row */}
                                                    <div className="px-3 py-2.5" style={{ background: '#fafcff' }}>
                                                        <div className="flex items-center justify-between mb-1">
                                                            <span className="text-xs font-bold font-mono" style={{ color: '#64748b' }}>📏 Standard ETA</span>
                                                            <span className="text-xs font-bold font-mono" style={{ color: (result.metadata.bench_penalty_rp ?? 0) > 0 ? '#ef4444' : '#64748b' }}>
                                                                TOTAL {formatRp(result.metadata.benchmark_cost_rp)}
                                                            </span>
                                                        </div>
                                                        <div className="flex gap-3 text-xs font-mono text-slate-500">
                                                            <span>⛽ {formatRp(result.metadata.bench_fuel_rp ?? result.metadata.benchmark_cost_rp)}</span>
                                                            <span style={{ color: (result.metadata.bench_penalty_rp ?? 0) > 0 ? '#ef4444' : '#64748b' }}>
                                                                🚨 Denda {formatRp(result.metadata.bench_penalty_rp ?? 0)}
                                                            </span>
                                                        </div>
                                                        {(result.metadata.bench_late_count ?? 0) > 0 && (
                                                            <p className="text-xs font-mono mt-0.5" style={{ color: '#ef4444' }}>
                                                                🚨 {result.metadata.bench_late_count} pelanggaran time window!
                                                            </p>
                                                        )}
                                                    </div>

                                                    {/* Winner Banner */}
                                                    <div
                                                        className="px-3 py-2 flex items-center gap-2"
                                                        style={{
                                                            background: result.metadata.savings_rp > 0 ? '#d1fae5' : '#fef9c3',
                                                            borderTop: `1px solid ${result.metadata.savings_rp > 0 ? '#6ee7b7' : '#fde047'}`,
                                                        }}
                                                    >
                                                        <span style={{ fontSize: 14 }}>{result.metadata.savings_rp > 0 ? '🏆' : '⚠️'}</span>
                                                        {result.metadata.savings_rp > 0 ? (
                                                            <p className="text-xs font-bold font-mono" style={{ color: '#065f46' }}>
                                                                AI Menang! Hemat {formatRp(result.metadata.savings_rp)}
                                                            </p>
                                                        ) : (
                                                            <p className="text-xs font-bold font-mono" style={{ color: '#92400e' }}>
                                                                Standard route is comparable
                                                            </p>
                                                        )}
                                                    </div>
                                                </div>
                                            )}

                                            {result.routes?.map((veh, i) => {
                                                const col = VEHICLE_COLORS[i % VEHICLE_COLORS.length]
                                                return (
                                                    <div key={veh.vehicle_id} className="relative group">
                                                        <VehicleRoutePanel
                                                            vehicle={veh}
                                                            colorIdx={i}
                                                            isActive={selectedAiVehicle === veh.vehicle_id}
                                                            onSelect={(vid) => {
                                                                setSelectedAiVehicle(prev => prev === vid ? 'all' : vid)
                                                            }}
                                                        />
                                                        {/* Live View eye button — appears on hover */}
                                                        <button
                                                            onClick={() => setSelectedLiveCourier(veh)}
                                                            title="Open Courier Live View"
                                                            className="absolute top-2.5 right-8 opacity-0 group-hover:opacity-100 transition-opacity duration-150
                                                                       flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-bold"
                                                            style={{
                                                                background: `${col}15`,
                                                                color: col,
                                                                border: `1px solid ${col}30`,
                                                            }}
                                                        >
                                                            <Eye size={10} />
                                                            Live
                                                        </button>
                                                    </div>
                                                )
                                            })}
                                        </div>
                                    )}
                                </div>
                            )}

                        </div>
                    </div>
                    {/* end 2-tab panel */}

                </div>

                {/* BOTTOM METADATA BAR */}
                {result && (
                    <div className="mt-4 glass-card px-5 py-3 flex items-center gap-6 flex-wrap fade-in-up">
                        <div className="flex items-center gap-2 text-xs font-mono">
                            <CheckCircle2 size={12} className="text-emerald-500" />
                            <span className="text-slate-500">Solved by OR-Tools GLS</span>
                        </div>
                        <div className="flex items-center gap-2 text-xs font-mono">
                            <Brain size={12} className="text-indigo-500" />
                            <span className="text-slate-500">AI Model: XGBoost GPU</span>
                        </div>
                        <div className="flex items-center gap-2 text-xs font-mono">
                            <BarChart3 size={12} className="text-blue-500" />
                            <span className="text-slate-500">Objective: <span className="text-blue-600">{result.objective_value}s</span></span>
                        </div>
                        {result.metadata && (
                            <div className="flex items-center gap-2 text-xs font-mono">
                                <CloudSun size={12} className="text-amber-500" />
                                <span className="text-slate-500">Weather: <span className="text-amber-600">{result.metadata.weather}</span></span>
                            </div>
                        )}
                    </div>
                )}

            </main>

            {/* FOOTER */}
            <footer className="relative z-10 mt-8 pb-4 text-center">
                <p className="text-xs font-mono text-slate-400">
                    AI Dynamic VRP System &middot; Bachelor Thesis 2022–2026 &middot; Powered by XGBoost + OR-Tools + FastAPI
                </p>
            </footer>
            {/* ============================================================= */}
            {/* MANAGER LIVE VIEW MODAL                                        */}
            {/* Opens when manager clicks the "Live" eye button on a vehicle   */}
            {/* ============================================================= */}
            {selectedLiveCourier && (() => {
                const vehIdx = result?.routes?.findIndex(r => r.vehicle_id === selectedLiveCourier.vehicle_id) ?? 0
                const vehicleColor = VEHICLE_COLORS[vehIdx % VEHICLE_COLORS.length]

                // Build nodeMap for the CourierMobileView from the current nodes array
                const nodeMapForCourier = {}
                nodes.forEach(n => { nodeMapForCourier[n.id] = { lat: n.lat, lon: n.lon } })
                // Depot aliases
                if (nodes[0]) {
                    nodeMapForCourier['0_Depot_Akhir'] = { lat: nodes[0].lat, lon: nodes[0].lon }
                    nodeMapForCourier['0_Depot_JNE']   = { lat: nodes[0].lat, lon: nodes[0].lon }
                    nodeMapForCourier['0_Depot']       = { lat: nodes[0].lat, lon: nodes[0].lon }
                }

                // Count actual delivery steps for the progress bar
                const deliverySteps = (selectedLiveCourier.steps || []).filter(
                    s => s.task !== 'START' && s.task !== 'FINISH' && s.location_id !== '0_Depot_Akhir'
                )
                const lateCount = deliverySteps.filter(s => s.is_late).length
                const nextStop = deliverySteps[0] // first stop = next stop (manager view is read-only)

                // Mock GPS: use depot coords as the truck's "current" position
                const depot = nodes[0]
                const mockGPS = depot ? { lat: depot.lat, lon: depot.lon } : null

                return (
                    <div
                        className="fixed inset-0 z-[9999] flex items-center justify-center"
                        style={{ background: 'rgba(15,23,42,0.65)', backdropFilter: 'blur(4px)' }}
                        onClick={(e) => { if (e.target === e.currentTarget) setSelectedLiveCourier(null) }}
                    >
                        {/* Modal card — phone frame on larger screens */}
                        <div
                            className="relative w-full max-w-sm mx-4 rounded-3xl overflow-hidden shadow-2xl"
                            style={{
                                height: '90vh',
                                maxHeight: '820px',
                                background: '#f8fafc',
                                border: '1px solid rgba(99,102,241,0.2)',
                                boxShadow: `0 25px 60px rgba(0,0,0,0.4), 0 0 0 1px ${vehicleColor}30`,
                            }}
                        >
                            {/* ── Manager summary bar (sits above the CourierMobileView) ── */}
                            <div
                                className="absolute bottom-0 inset-x-0 z-10 px-4 py-3 border-t border-slate-200"
                                style={{ background: 'rgba(248,250,252,0.95)', backdropFilter: 'blur(8px)' }}
                            >
                                <div className="flex items-center justify-between">
                                    <div className="flex items-center gap-2">
                                        <div className="w-2 h-2 rounded-full animate-pulse" style={{ background: vehicleColor }} />
                                        <span className="text-xs font-bold font-mono" style={{ color: vehicleColor }}>
                                            MANAGER VIEW — V{vehIdx + 1}
                                        </span>
                                    </div>
                                    <div className="flex items-center gap-3 text-[10px] font-mono text-slate-500">
                                        <span>{deliverySteps.length} stops</span>
                                        {lateCount > 0 && (
                                            <span className="font-bold text-red-500">⚠ {lateCount} late</span>
                                        )}
                                        {nextStop && (
                                            <span>Next: {(nextStop.location_id || '').replace(/_/g, ' ').replace(/^\d+\s*/, '').slice(0, 20)}</span>
                                        )}
                                    </div>
                                </div>
                            </div>

                            {/* ── Full CourierMobileView (leaves room for the manager bar) ── */}
                            {/* key=vehicle_id forces a full remount (and hook reinit) when  */}
                            {/* the manager switches to a different courier's live view.       */}
                            <div className="h-full pb-12">
                                <CourierMobileView
                                    key={selectedLiveCourier.vehicle_id}
                                    vehicleId={selectedLiveCourier.vehicle_id}
                                    currentLocation={mockGPS}
                                    routeData={selectedLiveCourier.steps || []}
                                    nodeMap={nodeMapForCourier}
                                    vehicleColor={vehicleColor}
                                    polylineGeometry={osrmRoads.filter(r => r.vehicleId === selectedLiveCourier.vehicle_id)}
                                    onClose={() => setSelectedLiveCourier(null)}
                                />
                            </div>
                        </div>
                    </div>
                )
            })()}

        </div>
    )
}