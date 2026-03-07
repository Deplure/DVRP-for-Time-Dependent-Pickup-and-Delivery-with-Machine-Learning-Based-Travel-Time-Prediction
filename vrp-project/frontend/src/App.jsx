import { useState, useEffect, useRef } from 'react'
import axios from 'axios'
import { MapContainer, TileLayer, Marker, Popup, Polyline, useMap } from 'react-leaflet'
import L from 'leaflet'
import {
    Brain, Zap, Truck, BarChart3, CloudSun, Loader2,
    CheckCircle2, AlertCircle, MapPin, Navigation,
    Activity, ChevronRight, PackageCheck, Package,
    Warehouse, Flag, RefreshCw, Clock, Layers,
    Plus, X, Settings2, Route
} from 'lucide-react'

// ===================== CONSTANTS =====================
const API_URL = 'http://localhost:8000/optimize'
const OSRM_URL = 'http://localhost:5000'

const DEFAULT_NODES = [
    // ===== 0. DEPOT =====
    { id: '0_Depot_JNE', lat: -7.265232, lon: 112.736966, demand: 0, tw_start: 0, tw_end: 86400 },

    // ===== JEBAKAN =====
    { id: '5_SMA_Trimurti', lat: -7.271378, lon: 112.743125, demand: 2, tw_start: 0, tw_end: 1800 },
    { id: '7_Rawon_Setan', lat: -7.261884, lon: 112.739778, demand: 3, tw_start: 0, tw_end: 1800 },

    // ===== FILLER LAMA =====
    { id: '4_Siola_Mall', lat: -7.256426, lon: 112.736236, demand: 4, tw_start: 0, tw_end: 900 },
    { id: '1_TP_Tunjungan', lat: -7.262608, lon: 112.742352, demand: -3, tw_start: 0, tw_end: 900 },
    { id: '3_Pasar_Kembang', lat: -7.269480, lon: 112.730594, demand: -5, tw_start: 0, tw_end: 900 },
    { id: '8_Pandegiling', lat: -7.273641, lon: 112.733470, demand: -2, tw_start: 900, tw_end: 1800 },
    { id: '2_Hotel_Majapahit', lat: -7.260656, lon: 112.738876, demand: -2, tw_start: 900, tw_end: 1800 },
    { id: '9_Gramedia', lat: -7.266857, lon: 112.742223, demand: -2, tw_start: 900, tw_end: 1800 },
    { id: '6_Patung_Sapi', lat: -7.263884, lon: 112.742308, demand: 1, tw_start: 900, tw_end: 1800 },

    // ===== KORIDOR KEDUNGDORO =====
    { id: '10_SPBU_Kedungdoro', lat: -7.261012, lon: 112.732045, demand: -4, tw_start: 0, tw_end: 900 },
    { id: '11_Apotek_K24', lat: -7.266050, lon: 112.731080, demand: 2, tw_start: 600, tw_end: 1800 },
    { id: '12_Warkop_Pitlik', lat: -7.264020, lon: 112.735010, demand: -1, tw_start: 0, tw_end: 1800 },
    { id: '13_Polsek_Tegalsari', lat: -7.267088, lon: 112.734000, demand: 3, tw_start: 0, tw_end: 1800 },
    { id: '14_Sate_Klisik', lat: -7.271015, lon: 112.732090, demand: -3, tw_start: 900, tw_end: 1800 },

    // ===== KORIDOR BASUKI RAHMAT =====
    { id: '15_KFC_Basra', lat: -7.265005, lon: 112.740510, demand: 4, tw_start: 900, tw_end: 1800 },
    { id: '16_McD_Basra', lat: -7.263520, lon: 112.741080, demand: -2, tw_start: 0, tw_end: 3600 },
    { id: '17_Kopi_Kenangan', lat: -7.262055, lon: 112.738010, demand: 2, tw_start: 1800, tw_end: 3600 },
    { id: '18_Plaza_BRI', lat: -7.264510, lon: 112.742590, demand: -5, tw_start: 0, tw_end: 3600 },
    { id: '19_Taman_Apsari', lat: -7.263080, lon: 112.744020, demand: 1, tw_start: 1800, tw_end: 3600 },

    // ===== KORIDOR PANGLIMA SUDIRMAN =====
    { id: '20_Monumen_Bambu', lat: -7.267812, lon: 112.743050, demand: -2, tw_start: 1800, tw_end: 5400 },
    { id: '21_Intiland_Tower', lat: -7.268045, lon: 112.741010, demand: 5, tw_start: 0, tw_end: 900 },
    { id: '22_Hotel_Bumi', lat: -7.269088, lon: 112.742050, demand: -4, tw_start: 0, tw_end: 3600 },
    { id: '23_Gereja_Hati_Kudus', lat: -7.270510, lon: 112.741580, demand: 2, tw_start: 0, tw_end: 2700 },
    { id: '24_Pasar_Keputran', lat: -7.273050, lon: 112.742010, demand: -5, tw_start: 0, tw_end: 900 },

    // ===== KORIDOR DARMO & DINOYO =====
    { id: '25_BCA_Darmo', lat: -7.275520, lon: 112.740050, demand: 3, tw_start: 900, tw_end: 1800 },
    { id: '26_RS_Darmo', lat: -7.280010, lon: 112.738090, demand: -3, tw_start: 0, tw_end: 2700 },
    { id: '27_Kantor_Pos_Dinoyo', lat: -7.278055, lon: 112.739020, demand: 4, tw_start: 1800, tw_end: 2700 },
    { id: '28_Pecel_Madiun', lat: -7.272045, lon: 112.735080, demand: -2, tw_start: 1800, tw_end: 3600 },
    { id: '29_Indomaret_Pregolan', lat: -7.268510, lon: 112.737520, demand: 1, tw_start: 0, tw_end: 1800 },
]

// Per-vehicle neon color palette
const VEHICLE_COLORS = ['#a855f7', '#22d3ee', '#4ade80', '#fb923c', '#f87171', '#fbbf24']
const VEHICLE_CSS = ['v-color-1', 'v-color-2', 'v-color-3', 'v-color-4']

// ===================== CUSTOM MARKERS =====================
const makeIcon = (color, label) => L.divIcon({
    className: '',
    html: `
    <div style="
      width:32px; height:32px; border-radius:50%;
      background:${color}22; border:2px solid ${color};
      display:flex; align-items:center; justify-content:center;
      box-shadow:0 0 10px ${color}66, 0 0 20px ${color}33;
      font-size:10px; font-weight:700; color:${color};
      font-family:'JetBrains Mono',monospace;
    ">${label}</div>`,
    iconSize: [32, 32],
    iconAnchor: [16, 16],
    popupAnchor: [0, -18],
})

const depotIcon = makeIcon('#4ade80', '🏠')
const nodeIcons = [
    makeIcon('#a855f7', 'N1'),
    makeIcon('#22d3ee', 'N2'),
    makeIcon('#fb923c', 'N3'),
    makeIcon('#f87171', 'N4'),
    makeIcon('#fbbf24', 'N5'),
]

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

// ===================== MAP CENTER FITTER =====================
function MapBounds({ nodes }) {
    const map = useMap()
    useEffect(() => {
        if (nodes && nodes.length > 0) {
            const bounds = L.latLngBounds(nodes.map(n => [n.lat, n.lon]))
            map.fitBounds(bounds, { padding: [40, 40] })
        }
    }, [nodes, map])
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
                style={{ background: `${color}20`, border: `1px solid ${color}40` }}
            >
                <Icon size={18} style={{ color }} />
            </div>
            <div className="flex-1 min-w-0">
                <p className="text-xs text-slate-500 uppercase tracking-widest font-medium mb-1">{label}</p>
                {loading ? (
                    <div className="flex items-center gap-2">
                        <Loader2 size={16} className="animate-spin text-purple-400" />
                        <span className="text-sm text-purple-400 font-mono">Computing...</span>
                    </div>
                ) : (
                    <>
                        <p className="kpi-number" style={{ background: `linear-gradient(135deg, ${color}, ${color}99)`, WebkitBackgroundClip: 'text', WebkitTextFillColor: 'transparent', backgroundClip: 'text' }}>
                            {value}
                        </p>
                        {sub && <p className="text-xs text-slate-500 mt-0.5 font-mono">{sub}</p>}
                    </>
                )}
            </div>
        </div>
    )
}

// ===================== STATUS SYSTEM KPI =====================
function StatusCard({ status, loading }) {
    const cfg = {
        STANDBY: { label: 'Standby', color: '#94a3b8', Icon: Activity, badge: 'badge-standby' },
        OPTIMIZING: { label: 'Optimizing', color: '#a855f7', Icon: Loader2, badge: 'badge-running' },
        SUCCESS: { label: 'Success', color: '#4ade80', Icon: CheckCircle2, badge: 'badge-success' },
        ERROR: { label: 'Error', color: '#f87171', Icon: AlertCircle, badge: 'badge-standby' },
    }
    const c = cfg[status] || cfg.STANDBY

    return (
        <div className="glass-card p-4 flex items-start gap-3 fade-in-up">
            <div
                className="w-10 h-10 rounded-lg flex items-center justify-center flex-shrink-0 mt-0.5"
                style={{ background: `${c.color}20`, border: `1px solid ${c.color}40` }}
            >
                <c.Icon size={18} style={{ color: c.color }} className={status === 'OPTIMIZING' ? 'animate-spin' : ''} />
            </div>
            <div className="flex-1">
                <p className="text-xs text-slate-500 uppercase tracking-widest font-medium mb-1">System Status</p>
                <div className="flex items-center gap-2 mt-1">
                    {status === 'SUCCESS' && <div className="w-2 h-2 rounded-full bg-green-400 pulse-ring" />}
                    {status === 'STANDBY' && <div className="w-2 h-2 rounded-full bg-slate-500" />}
                    {status === 'OPTIMIZING' && <div className="w-2 h-2 rounded-full bg-purple-400 animate-pulse" />}
                    {status === 'ERROR' && <div className="w-2 h-2 rounded-full bg-red-400" />}
                    <span className={c.badge}>{c.label}</span>
                </div>
                <p className="text-xs text-slate-600 mt-1 font-mono">
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
    return (
        <div className="relative flex gap-3 pb-3">
            {!isLast && (
                <div className="absolute left-[11px] top-6 bottom-0 w-0.5"
                    style={{ background: 'linear-gradient(to bottom, rgba(168,85,247,0.4), rgba(168,85,247,0.05))' }} />
            )}
            <div className="flex-shrink-0 mt-1">
                <div
                    className="w-5 h-5 rounded-full border-2 flex items-center justify-center"
                    style={{
                        borderColor: task === 'START' ? '#4ade80' : task === 'FINISH' ? '#f87171' : task === 'PICKUP' ? '#22d3ee' : '#fb923c',
                        background: 'rgba(15,23,42,0.9)',
                    }}
                >
                    <div className="w-1.5 h-1.5 rounded-full"
                        style={{ background: task === 'START' ? '#4ade80' : task === 'FINISH' ? '#f87171' : task === 'PICKUP' ? '#22d3ee' : '#fb923c' }}
                    />
                </div>
            </div>
            <div className="flex-1 min-w-0 pb-1">
                <div className="flex items-center gap-2 flex-wrap">
                    <span className="text-xs font-mono text-purple-300 flex-shrink-0">{step.arrival_time}</span>
                    {taskBadge(task)}
                </div>
                <p className="text-xs text-slate-300 mt-0.5 font-medium truncate" title={step.location_id}>
                    {step.location_id?.replace(/_/g, ' ')}
                </p>
                {step.demand !== 0 && (
                    <p className="text-xs text-slate-600 font-mono">
                        demand: <span className={step.demand > 0 ? 'text-cyan-400' : 'text-orange-400'}>{step.demand > 0 ? '+' : ''}{step.demand}</span>
                    </p>
                )}
            </div>
        </div>
    )
}

// ===================== VEHICLE ROUTE PANEL =====================
function VehicleRoutePanel({ vehicle, colorIdx }) {
    const [open, setOpen] = useState(true)
    const col = VEHICLE_COLORS[colorIdx % VEHICLE_COLORS.length]
    const cssClass = VEHICLE_CSS[colorIdx % VEHICLE_CSS.length]

    return (
        <div className={`rounded-lg p-3 mb-2 cursor-pointer ${cssClass} transition-all duration-200`}
            onClick={() => setOpen(o => !o)}>
            <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                    <Truck size={14} style={{ color: col }} />
                    <span className="text-xs font-bold font-mono" style={{ color: col }}>
                        VEHICLE #{vehicle.vehicle_id}
                    </span>
                    <span className="text-xs text-slate-500">
                        {vehicle.steps?.length || 0} stops
                    </span>
                </div>
                <ChevronRight size={14} className={`text-slate-500 transition-transform duration-200 ${open ? 'rotate-90' : ''}`} />
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
    const [osrmRoads, setOsrmRoads] = useState([])
    const [osrmLoading, setOsrmLoading] = useState(false)

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
    const fetchOsrmRoads = async (routes, currentNodes) => {
        setOsrmLoading(true)
        const roadGeoms = []

        for (let i = 0; i < routes.length; i++) {
            const veh = routes[i]
            const color = VEHICLE_COLORS[i % VEHICLE_COLORS.length]

            const orderedCoords = veh.steps
                ?.map(step => {
                    if (step.location_id === '0_Depot_Akhir') {
                        const depot = currentNodes[0]
                        return depot ? { lon: depot.lon, lat: depot.lat } : null
                    }
                    const node = currentNodes.find(n => n.id === step.location_id)
                    return node ? { lon: node.lon, lat: node.lat } : null
                })
                .filter(Boolean)

            if (orderedCoords.length < 2) {
                roadGeoms.push({ latLngs: [], color, vehicleId: veh.vehicle_id })
                continue
            }

            const waypointStr = orderedCoords.map(c => `${c.lon},${c.lat}`).join(';')
            const osrmEndpoint = `${OSRM_URL}/route/v1/driving/${waypointStr}?overview=full&geometries=geojson`

            try {
                const res = await fetch(osrmEndpoint)
                if (!res.ok) throw new Error(`OSRM HTTP ${res.status}`)
                const data = await res.json()
                const latLngs = data.routes[0].geometry.coordinates.map(([lon, lat]) => [lat, lon])
                roadGeoms.push({ latLngs, color, vehicleId: veh.vehicle_id })
            } catch (e) {
                console.warn(`OSRM fetch failed for vehicle ${veh.vehicle_id}:`, e.message)
                roadGeoms.push({
                    latLngs: orderedCoords.map(c => [c.lat, c.lon]),
                    color,
                    vehicleId: veh.vehicle_id,
                    isFallback: true,
                })
            }
        }

        setOsrmRoads(roadGeoms)
        setOsrmLoading(false)
    }

    // ---- Run AI Optimization ----
    const handleOptimize = async () => {
        setLoading(true)
        setStatus('OPTIMIZING')
        setError(null)
        setResult(null)
        setOsrmRoads([])

        const payload = {
            nodes,
            num_vehicles: numVehicles,
            vehicle_capacity: vehicleCapacity,
            start_time: startTime,
        }

        try {
            const res = await axios.post(API_URL, payload)
            setResult(res.data)
            setStatus('SUCCESS')
            setMapKey(k => k + 1)
            setActiveTab('manifest')
            await fetchOsrmRoads(res.data.routes, nodes)
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
            setResult(res.data)
            setStatus('SUCCESS')
            setMapKey(k => k + 1)
            setActiveTab('manifest')

            // Gabungkan node lama dan baru agar petanya ter-update
            const combinedNodes = [...nodes, ...newOrders]
            setNodes(combinedNodes)
            setNewOrders([])

            await fetchOsrmRoads(res.data.routes, combinedNodes)
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
        setNewOrders([])
        setActiveTab('configuration')
    }

    // Shared neon input style
    const neonInput = {
        background: 'rgba(168,85,247,0.06)',
        border: '1px solid rgba(168,85,247,0.25)',
        borderRadius: '8px',
        color: '#e2e8f0',
        fontSize: '13px',
        fontFamily: 'JetBrains Mono, monospace',
        padding: '7px 10px',
        width: '100%',
        outline: 'none',
        transition: 'border-color 0.2s, box-shadow 0.2s',
    }

    return (
        <div className="min-h-screen relative" style={{ background: '#020617' }}>
            {/* Animated grid BG */}
            <div className="grid-bg" />
            <div className="scan-line" />

            {/* Radial glow at top */}
            <div className="fixed inset-x-0 top-0 h-64 pointer-events-none z-0"
                style={{ background: 'radial-gradient(ellipse 80% 50% at 50% -10%, rgba(168,85,247,0.15) 0%, transparent 100%)' }} />

            {/* ===================== HEADER ===================== */}
            <header className="relative z-10 border-b" style={{ borderColor: 'rgba(168,85,247,0.15)', background: 'rgba(2,6,23,0.8)', backdropFilter: 'blur(12px)' }}>
                <div className="max-w-screen-2xl mx-auto px-6 h-16 flex items-center justify-between">
                    <div className="flex items-center gap-3">
                        <div className="w-8 h-8 rounded-lg flex items-center justify-center"
                            style={{ background: 'linear-gradient(135deg, #7c3aed, #a855f7)', boxShadow: '0 0 15px rgba(168,85,247,0.4)' }}>
                            <Brain size={16} className="text-white" />
                        </div>
                        <div>
                            <h1 className="shimmer-text text-base font-bold tracking-tight leading-none">
                                AI Logistics Optimizer
                            </h1>
                            <p className="text-xs text-slate-600 font-mono leading-tight">VRP · Surabaya · Dynamic Routing</p>
                        </div>
                    </div>

                    <div className="hidden md:flex items-center gap-4">
                        <div className="flex items-center gap-1.5 text-xs font-mono text-slate-500">
                            <div className="w-1.5 h-1.5 rounded-full bg-green-400 animate-pulse" />
                            <span>Backend: <span className="text-green-400">ONLINE</span></span>
                        </div>
                        <div className="h-4 w-px bg-slate-800" />
                        <div className="flex items-center gap-1.5 text-xs font-mono text-slate-500">
                            <Layers size={11} className="text-purple-400" />
                            <span>Model: <span className="text-purple-400">XGBoost GPU</span></span>
                        </div>
                        {result?.metadata && (
                            <>
                                <div className="h-4 w-px bg-slate-800" />
                                <div className="flex items-center gap-1.5 text-xs font-mono text-slate-500">
                                    <WeatherIcon weather={result.metadata.weather} />
                                    <span>{result.metadata.weather}</span>
                                    {result.metadata.is_rain === 1 && (
                                        <span className="text-xs text-cyan-400">(+traffic)</span>
                                    )}
                                </div>
                            </>
                        )}
                    </div>

                    <div className="flex items-center gap-2">
                        <Clock size={13} className="text-slate-600" />
                        <span className="text-xs font-mono text-slate-500">
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
                        color="#a855f7"
                        loading={loading}
                    />

                    <KpiCard
                        icon={Truck}
                        label="Cost Savings vs Standard"
                        value={result?.metadata?.savings_rp != null ? formatRp(result.metadata.savings_rp) : '—'}
                        sub={result?.metadata?.benchmark_cost_rp != null
                            ? `Standard: ${formatRp(result.metadata.benchmark_cost_rp)} | 🚨 ${result.metadata.bench_late_count ?? 0} late`
                            : 'Awaiting run'}
                        color={result?.metadata?.savings_rp > 0 ? '#4ade80' : '#fbbf24'}
                        loading={loading}
                    />
                </div>

                {/* MAP + CONTROL PANEL GRID */}
                <div className="grid grid-cols-12 gap-4">

                    {/* ===== MAP PANEL (8/12) ===== */}
                    <div className="col-span-12 lg:col-span-8">
                        <div className="glass-card-solid overflow-hidden" style={{ height: '580px' }}>
                            {/* Map Header */}
                            <div className="flex items-center justify-between px-4 py-2.5 border-b" style={{ borderColor: 'rgba(168,85,247,0.15)' }}>
                                <div className="flex items-center gap-2">
                                    <MapPin size={14} className="text-purple-400" />
                                    <span className="text-xs font-bold font-mono text-slate-300 tracking-wider">ROUTE MAP</span>
                                    <span className="text-xs text-slate-600">— Tegalsari Area, Surabaya</span>
                                    {osrmLoading && (
                                        <span className="flex items-center gap-1 text-xs font-mono text-purple-400">
                                            <Loader2 size={10} className="animate-spin" />
                                            Snapping to road...
                                        </span>
                                    )}
                                    {osrmRoads.length > 0 && !osrmLoading && (
                                        <span className="text-xs font-mono text-green-400">● Road-snapped</span>
                                    )}
                                </div>
                                {result && (
                                    <div className="flex items-center gap-3">
                                        {VEHICLE_COLORS.slice(0, result.routes.length).map((col, i) => (
                                            <div key={i} className="flex items-center gap-1.5">
                                                <div className="w-6 h-0.5 rounded" style={{ background: col, boxShadow: `0 0 6px ${col}, 0 0 12px ${col}55` }} />
                                                <span className="text-xs font-mono text-slate-500">V{i + 1}</span>
                                            </div>
                                        ))}
                                    </div>
                                )}
                            </div>

                            {/* Leaflet Map */}
                            <MapContainer
                                key={mapKey}
                                center={[-7.266, 112.737]}
                                zoom={14}
                                style={{ height: 'calc(100% - 42px)', width: '100%' }}
                                zoomControl={true}
                            >
                                <TileLayer
                                    url="https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png"
                                    attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OSM</a> &copy; <a href="https://carto.com/">CARTO</a>'
                                    maxZoom={20}
                                />

                                <MapBounds nodes={nodes} />

                                {nodes.map((node, i) => (
                                    <Marker
                                        key={node.id}
                                        position={[node.lat, node.lon]}
                                        icon={i === 0 ? depotIcon : nodeIcons[(i - 1) % nodeIcons.length]}
                                    >
                                        <Popup>
                                            <div style={{ fontFamily: 'JetBrains Mono, monospace', fontSize: '12px', color: '#f1f5f9' }}>
                                                <div style={{ color: '#a855f7', fontWeight: 700, marginBottom: 4 }}>
                                                    {i === 0 ? '🏠 DEPOT' : `📍 NODE ${i}`}
                                                </div>
                                                <div style={{ color: '#94a3b8' }}>{node.id.replace(/_/g, ' ')}</div>
                                                <div style={{ marginTop: 4 }}>
                                                    <span style={{ color: '#22d3ee' }}>Demand: </span>
                                                    <span>{node.demand}</span>
                                                </div>
                                                <div>
                                                    <span style={{ color: '#22d3ee' }}>Coords: </span>
                                                    <span>{node.lat.toFixed(4)}, {node.lon.toFixed(4)}</span>
                                                </div>
                                            </div>
                                        </Popup>
                                    </Marker>
                                ))}

                                {/* OSRM Snap-to-Road Polylines */}
                                {osrmRoads.map((road, i) =>
                                    road.latLngs && road.latLngs.length > 1 ? (
                                        <div key={i}>
                                            <Polyline
                                                positions={road.latLngs}
                                                color={road.color}
                                                weight={10}
                                                opacity={0.18}
                                                dashArray={null}
                                                lineCap="round"
                                                lineJoin="round"
                                            />
                                            <Polyline
                                                positions={road.latLngs}
                                                color={road.color}
                                                weight={4}
                                                opacity={road.isFallback ? 0.5 : 0.92}
                                                dashArray={road.isFallback ? '6, 5' : null}
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
                            <div className="flex border-b" style={{ borderColor: 'rgba(168,85,247,0.15)' }}>
                                <button
                                    onClick={() => setActiveTab('configuration')}
                                    className="flex-1 flex items-center justify-center gap-1.5 py-3 text-xs font-bold font-mono tracking-wider transition-all duration-200 relative"
                                    style={{
                                        color: activeTab === 'configuration' ? '#a855f7' : '#475569',
                                        background: activeTab === 'configuration' ? 'rgba(168,85,247,0.06)' : 'transparent',
                                    }}
                                >
                                    <Settings2 size={13} />
                                    Configuration
                                    {activeTab === 'configuration' && (
                                        <div className="absolute bottom-0 left-0 right-0 h-0.5"
                                            style={{ background: 'linear-gradient(90deg, transparent, #a855f7, transparent)' }} />
                                    )}
                                </button>

                                <button
                                    onClick={() => setActiveTab('manifest')}
                                    className="flex-1 flex items-center justify-center gap-1.5 py-3 text-xs font-bold font-mono tracking-wider transition-all duration-200 relative"
                                    style={{
                                        color: activeTab === 'manifest' ? '#22d3ee' : '#475569',
                                        background: activeTab === 'manifest' ? 'rgba(34,211,238,0.06)' : 'transparent',
                                    }}
                                >
                                    <Route size={13} />
                                    Route Manifest
                                    {result && (
                                        <span className="ml-1 w-1.5 h-1.5 rounded-full bg-green-400 inline-block animate-pulse" />
                                    )}
                                    {activeTab === 'manifest' && (
                                        <div className="absolute bottom-0 left-0 right-0 h-0.5"
                                            style={{ background: 'linear-gradient(90deg, transparent, #22d3ee, transparent)' }} />
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
                                            <p className="text-xs text-slate-500 uppercase tracking-widest font-medium mb-2 flex items-center gap-1.5">
                                                <Zap size={11} className="text-purple-400" />
                                                Global Parameters
                                            </p>
                                            <div className="grid grid-cols-3 gap-2">
                                                {[
                                                    { label: 'Vehicles', value: numVehicles, setter: setNumVehicles, min: 1, max: 10 },
                                                    { label: 'Capacity', value: vehicleCapacity, setter: setVehicleCapacity, min: 1, max: 100 },
                                                ].map(({ label, value, setter, min, max }) => (
                                                    <div key={label}>
                                                        <label className="text-xs text-slate-600 font-mono mb-1 block">{label}</label>
                                                        <input
                                                            type="number"
                                                            min={min}
                                                            max={max}
                                                            value={value}
                                                            onChange={e => setter(Number(e.target.value))}
                                                            style={neonInput}
                                                            onFocus={e => {
                                                                e.target.style.borderColor = 'rgba(168,85,247,0.6)'
                                                                e.target.style.boxShadow = '0 0 0 2px rgba(168,85,247,0.1)'
                                                            }}
                                                            onBlur={e => {
                                                                e.target.style.borderColor = 'rgba(168,85,247,0.25)'
                                                                e.target.style.boxShadow = 'none'
                                                            }}
                                                        />
                                                    </div>
                                                ))}

                                                {/* [UBAHAN] Input Start Time dengan limit min dan max */}
                                                <div>
                                                    <label className="text-xs text-slate-600 font-mono mb-1 block">Start Time</label>
                                                    <input
                                                        type="time"
                                                        min="07:00"
                                                        max="19:00"
                                                        value={startTime}
                                                        onChange={e => setStartTime(e.target.value)}
                                                        style={neonInput}
                                                        onFocus={e => {
                                                            e.target.style.borderColor = 'rgba(168,85,247,0.6)'
                                                            e.target.style.boxShadow = '0 0 0 2px rgba(168,85,247,0.1)'
                                                        }}
                                                        onBlur={e => {
                                                            e.target.style.borderColor = 'rgba(168,85,247,0.25)'
                                                            e.target.style.boxShadow = 'none'
                                                        }}
                                                    />
                                                </div>
                                            </div>
                                        </div>

                                        {/* ===== GEOCODING SEARCH ===== */}
                                        <div>
                                            <p className="text-xs text-slate-500 uppercase tracking-widest font-medium mb-2 flex items-center gap-1.5">
                                                <MapPin size={11} className="text-purple-400" />
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
                                                        background: 'rgba(168,85,247,0.06)',
                                                        border: '1px solid rgba(168,85,247,0.25)',
                                                        borderRadius: '7px',
                                                        color: '#e2e8f0',
                                                        fontSize: '11px',
                                                        fontFamily: 'JetBrains Mono, monospace',
                                                        padding: '6px 10px',
                                                        outline: 'none',
                                                    }}
                                                    onFocus={e => e.target.style.borderColor = 'rgba(168,85,247,0.6)'}
                                                    onBlur={e => e.target.style.borderColor = 'rgba(168,85,247,0.25)'}
                                                />
                                                <button
                                                    onClick={handleGeoSearch}
                                                    disabled={searchLoading || !searchQuery.trim()}
                                                    className="flex-shrink-0 flex items-center gap-1.5 px-3 py-1.5 text-xs font-mono font-bold rounded-lg transition-all"
                                                    style={{
                                                        background: searchLoading ? 'rgba(168,85,247,0.1)' : 'rgba(168,85,247,0.18)',
                                                        border: '1px solid rgba(168,85,247,0.4)',
                                                        color: '#d8b4fe',
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
                                                    <Zap size={11} className="text-cyan-400" />
                                                    Quick Add
                                                    <span className="text-cyan-400 font-mono">[{savedLocations.length}]</span>
                                                </p>
                                                <div className="flex flex-wrap gap-1.5">
                                                    {savedLocations.map(loc => (
                                                        <button
                                                            key={loc.id}
                                                            onClick={() => addLocationToNodes(loc)}
                                                            className="text-xs font-mono px-2.5 py-1 rounded-full transition-all duration-150 hover:scale-105"
                                                            style={{
                                                                background: 'rgba(34,211,238,0.08)',
                                                                border: '1px solid rgba(34,211,238,0.25)',
                                                                color: '#67e8f9',
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
                                            <p className="text-xs text-slate-500 uppercase tracking-widest font-medium mb-2 flex items-center gap-1.5">
                                                <MapPin size={11} className="text-cyan-400" />
                                                Route Nodes
                                                <span className="text-cyan-400 font-mono">[{nodes.length}]</span>
                                            </p>

                                            <div className="space-y-2">
                                                {nodes.map((node, idx) => (
                                                    <div
                                                        key={`${node.id}-${idx}`}
                                                        className="rounded-lg p-2.5 group transition-all duration-150"
                                                        style={{
                                                            background: idx === 0 ? 'rgba(74,222,128,0.05)' : 'rgba(168,85,247,0.04)',
                                                            border: idx === 0 ? '1px solid rgba(74,222,128,0.18)' : '1px solid rgba(168,85,247,0.12)',
                                                        }}
                                                    >
                                                        <div className="flex items-center gap-2 mb-1.5">
                                                            <div
                                                                className="flex-shrink-0 w-5 h-5 rounded-full flex items-center justify-center font-mono font-bold"
                                                                style={{
                                                                    background: idx === 0 ? 'rgba(74,222,128,0.15)' : 'rgba(168,85,247,0.15)',
                                                                    color: idx === 0 ? '#4ade80' : VEHICLE_COLORS[(idx - 1) % VEHICLE_COLORS.length],
                                                                    fontSize: '9px',
                                                                }}
                                                            >
                                                                {idx === 0 ? '🏠' : idx}
                                                            </div>
                                                            <p className="flex-1 text-xs font-mono text-slate-300 truncate" title={node.id}>
                                                                {node.id.replace(/_/g, ' ')}
                                                            </p>
                                                            {idx !== 0 && (
                                                                <button
                                                                    onClick={() => removeNode(idx)}
                                                                    className="flex-shrink-0 w-5 h-5 rounded flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity"
                                                                    style={{ background: 'rgba(248,113,113,0.2)', color: '#f87171' }}
                                                                >
                                                                    <X size={10} />
                                                                </button>
                                                            )}
                                                        </div>
                                                        <p className="text-xs font-mono text-slate-600 mb-1.5 pl-7">
                                                            {node.lat.toFixed(4)}, {node.lon.toFixed(4)}
                                                        </p>
                                                        <div className="grid grid-cols-3 gap-1.5 pl-7">
                                                            {[
                                                                { field: 'demand', label: 'Demand' },
                                                                { field: 'tw_start', label: 'TW↑(s)' },
                                                                { field: 'tw_end', label: 'TW↓(s)' },
                                                            ].map(({ field, label }) => (
                                                                <div key={field}>
                                                                    <label className="text-xs font-mono mb-0.5 block" style={{ color: '#475569', fontSize: '9px' }}>{label}</label>
                                                                    <input
                                                                        type="number"
                                                                        value={node[field]}
                                                                        onChange={e => updateNode(idx, field, parseInt(e.target.value) || 0)}
                                                                        style={{
                                                                            width: '100%',
                                                                            background: 'rgba(168,85,247,0.06)',
                                                                            border: '1px solid rgba(168,85,247,0.18)',
                                                                            borderRadius: '5px',
                                                                            color: field === 'demand'
                                                                                ? (node.demand > 0 ? '#22d3ee' : node.demand < 0 ? '#fb923c' : '#94a3b8')
                                                                                : '#94a3b8',
                                                                            fontSize: '10px',
                                                                            fontFamily: 'JetBrains Mono, monospace',
                                                                            padding: '3px 5px',
                                                                            outline: 'none',
                                                                        }}
                                                                        onFocus={e => e.target.style.borderColor = 'rgba(168,85,247,0.5)'}
                                                                        onBlur={e => e.target.style.borderColor = 'rgba(168,85,247,0.18)'}
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
                                            <div className="p-4 rounded-lg border fade-in-up" style={{ background: 'rgba(249,115,22,0.06)', border: '1px solid rgba(249,115,22,0.3)' }}>
                                                <p className="text-xs text-orange-400 uppercase tracking-widest font-medium mb-3 flex items-center gap-1.5">
                                                    <Zap size={14} /> Ada Orderan Mendadak?
                                                </p>

                                                <div className="flex gap-3 mb-3">
                                                    {/* [UBAHAN] Input Jam Order Masuk dengan limit min dan max */}
                                                    <div className="flex-1">
                                                        <label className="text-xs text-orange-200/70 font-mono mb-1 block">Jam Order Masuk</label>
                                                        <input
                                                            type="time"
                                                            min="07:00"
                                                            max="19:00"
                                                            value={interruptTime}
                                                            onChange={e => setInterruptTime(e.target.value)}
                                                            style={{ ...neonInput, borderColor: 'rgba(249,115,22,0.3)', color: '#fdba74' }}
                                                        />
                                                    </div>
                                                    <div className="flex-1">
                                                        <label className="text-xs text-orange-200/70 font-mono mb-1 block">Tambah Paket</label>
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
                                                    <div key={idx} className="flex justify-between items-center text-[10px] text-slate-300 font-mono mb-2 p-1.5 bg-slate-900 rounded border border-orange-500/20">
                                                        <span>{no.id} | Dem: {no.demand}</span>
                                                        <span className="text-orange-400">Menunggu...</span>
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
                                            style={{ background: 'rgba(168,85,247,0.06)', border: '1px solid rgba(168,85,247,0.15)' }}>
                                            <p className="text-slate-500 mb-1">Payload Preview:</p>
                                            <p className="text-purple-300">nodes: <span className="text-cyan-400">{nodes.length}</span></p>
                                            <p className="text-purple-300">vehicles: <span className="text-cyan-400">{numVehicles}</span></p>
                                            <p className="text-purple-300">capacity: <span className="text-cyan-400">{vehicleCapacity}</span></p>
                                            <p className="text-purple-300">start_time: <span className="text-cyan-400">{startTime}</span></p>
                                        </div>

                                        {/* Error banner */}
                                        {error && (
                                            <div className="rounded-lg p-3 flex items-start gap-2 fade-in-up"
                                                style={{ background: 'rgba(248,113,113,0.08)', border: '1px solid rgba(248,113,113,0.25)' }}>
                                                <AlertCircle size={14} className="text-red-400 flex-shrink-0 mt-0.5" />
                                                <p className="text-xs text-red-400 font-mono">{error}</p>
                                            </div>
                                        )}
                                    </div>

                                    {/* ---- RUN BUTTON (sticky bottom) ---- */}
                                    <div className="px-4 pb-4 pt-2 border-t" style={{ borderColor: 'rgba(168,85,247,0.1)' }}>
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
                                            <Navigation size={14} className="text-cyan-400" />
                                            <span className="text-xs font-bold font-mono text-slate-300 tracking-wider">ROUTE MANIFEST</span>
                                        </div>
                                        {result && (
                                            <span className="badge-success text-xs">{result.status}</span>
                                        )}
                                    </div>

                                    {/* Empty state */}
                                    {!result && !loading && (
                                        <div className="flex-1 flex flex-col items-center justify-center py-8 text-center px-4">
                                            <div className="w-12 h-12 rounded-full flex items-center justify-center mb-3"
                                                style={{ background: 'rgba(168,85,247,0.08)', border: '1px dashed rgba(168,85,247,0.25)' }}>
                                                <PackageCheck size={22} className="text-slate-600" />
                                            </div>
                                            <p className="text-xs text-slate-600 font-mono max-w-[200px] leading-relaxed">
                                                Go to <span className="text-purple-400">Configuration</span> tab and press <span className="text-purple-400">"Run Initial Optimization"</span> to generate routes.
                                            </p>
                                        </div>
                                    )}

                                    {/* Loading state */}
                                    {loading && (
                                        <div className="flex-1 flex flex-col items-center justify-center py-8 text-center">
                                            <div className="w-10 h-10 rounded-full border-2 border-purple-500 border-t-transparent animate-spin mb-3" />
                                            <p className="text-xs text-purple-400 font-mono animate-pulse">Neural path computing...</p>
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
                                                <div className="mb-3 rounded-lg overflow-hidden fade-in-up" style={{ border: '1px solid rgba(168,85,247,0.2)' }}>
                                                    {/* Header */}
                                                    <div className="px-3 py-2 flex items-center gap-2" style={{ background: 'rgba(168,85,247,0.1)', borderBottom: '1px solid rgba(168,85,247,0.15)' }}>
                                                        <BarChart3 size={12} className="text-purple-400" />
                                                        <span className="text-xs font-bold font-mono text-slate-300 tracking-widest">SCORE BOARD</span>
                                                    </div>

                                                    {/* AI Row */}
                                                    <div className="px-3 py-2.5" style={{ background: 'rgba(168,85,247,0.04)' }}>
                                                        <div className="flex items-center justify-between mb-1">
                                                            <span className="text-xs font-bold font-mono" style={{ color: '#a855f7' }}>🤖 AI VRP</span>
                                                            <span className="text-xs font-bold font-mono" style={{ color: (result.metadata.ai_penalty_rp ?? 0) > 0 ? '#fb923c' : '#4ade80' }}>
                                                                TOTAL {formatRp(result.metadata.ai_cost_rp)}
                                                            </span>
                                                        </div>
                                                        <div className="flex gap-3 text-xs font-mono text-slate-500">
                                                            <span>⛽ {formatRp(result.metadata.ai_fuel_rp ?? result.metadata.ai_cost_rp)}</span>
                                                            <span style={{ color: (result.metadata.ai_penalty_rp ?? 0) > 0 ? '#f87171' : '#4ade80' }}>
                                                                🚨 Denda {formatRp(result.metadata.ai_penalty_rp ?? 0)}
                                                            </span>
                                                        </div>
                                                        {(result.metadata.ai_late_count ?? 0) > 0 ? (
                                                            <p className="text-xs font-mono mt-0.5" style={{ color: '#f87171' }}>{result.metadata.ai_late_count} pelanggaran time window</p>
                                                        ) : (
                                                            <p className="text-xs font-mono mt-0.5" style={{ color: '#4ade80' }}>✨ Semua tepat waktu!</p>
                                                        )}
                                                    </div>

                                                    <div style={{ height: 1, background: 'rgba(255,255,255,0.05)' }} />

                                                    {/* Standard Row */}
                                                    <div className="px-3 py-2.5" style={{ background: 'rgba(248,113,113,0.03)' }}>
                                                        <div className="flex items-center justify-between mb-1">
                                                            <span className="text-xs font-bold font-mono" style={{ color: '#94a3b8' }}>📏 Standard ETA</span>
                                                            <span className="text-xs font-bold font-mono" style={{ color: (result.metadata.bench_penalty_rp ?? 0) > 0 ? '#f87171' : '#94a3b8' }}>
                                                                TOTAL {formatRp(result.metadata.benchmark_cost_rp)}
                                                            </span>
                                                        </div>
                                                        <div className="flex gap-3 text-xs font-mono text-slate-500">
                                                            <span>⛽ {formatRp(result.metadata.bench_fuel_rp ?? result.metadata.benchmark_cost_rp)}</span>
                                                            <span style={{ color: (result.metadata.bench_penalty_rp ?? 0) > 0 ? '#f87171' : '#64748b' }}>
                                                                🚨 Denda {formatRp(result.metadata.bench_penalty_rp ?? 0)}
                                                            </span>
                                                        </div>
                                                        {(result.metadata.bench_late_count ?? 0) > 0 && (
                                                            <p className="text-xs font-mono mt-0.5" style={{ color: '#f87171' }}>
                                                                🚨 {result.metadata.bench_late_count} pelanggaran time window!
                                                            </p>
                                                        )}
                                                    </div>

                                                    {/* Winner Banner */}
                                                    <div
                                                        className="px-3 py-2 flex items-center gap-2"
                                                        style={{
                                                            background: result.metadata.savings_rp > 0 ? 'rgba(74,222,128,0.08)' : 'rgba(251,191,36,0.08)',
                                                            borderTop: `1px solid ${result.metadata.savings_rp > 0 ? 'rgba(74,222,128,0.25)' : 'rgba(251,191,36,0.25)'}`,
                                                        }}
                                                    >
                                                        <span style={{ fontSize: 14 }}>{result.metadata.savings_rp > 0 ? '🏆' : '⚠️'}</span>
                                                        {result.metadata.savings_rp > 0 ? (
                                                            <p className="text-xs font-bold font-mono" style={{ color: '#4ade80' }}>
                                                                AI Menang! Hemat {formatRp(result.metadata.savings_rp)}
                                                            </p>
                                                        ) : (
                                                            <p className="text-xs font-bold font-mono" style={{ color: '#fbbf24' }}>
                                                                Standard route is comparable
                                                            </p>
                                                        )}
                                                    </div>
                                                </div>
                                            )}

                                            {result.routes?.map((veh, i) => (
                                                <VehicleRoutePanel key={veh.vehicle_id} vehicle={veh} colorIdx={i} />
                                            ))}
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
                            <CheckCircle2 size={12} className="text-green-400" />
                            <span className="text-slate-500">Solved by OR-Tools GLS</span>
                        </div>
                        <div className="flex items-center gap-2 text-xs font-mono">
                            <Brain size={12} className="text-purple-400" />
                            <span className="text-slate-500">AI Model: XGBoost GPU</span>
                        </div>
                        <div className="flex items-center gap-2 text-xs font-mono">
                            <BarChart3 size={12} className="text-cyan-400" />
                            <span className="text-slate-500">Objective: <span className="text-cyan-300">{result.objective_value}s</span></span>
                        </div>
                        {result.metadata && (
                            <div className="flex items-center gap-2 text-xs font-mono">
                                <CloudSun size={12} className="text-orange-400" />
                                <span className="text-slate-500">Weather: <span className="text-orange-300">{result.metadata.weather}</span></span>
                            </div>
                        )}
                    </div>
                )}

            </main>

            {/* FOOTER */}
            <footer className="relative z-10 mt-8 pb-4 text-center">
                <p className="text-xs font-mono text-slate-700">
                    AI Dynamic VRP System · Bachelor Thesis 2022–2026 · Powered by XGBoost + OR-Tools + FastAPI
                </p>
            </footer>
        </div>
    )
}