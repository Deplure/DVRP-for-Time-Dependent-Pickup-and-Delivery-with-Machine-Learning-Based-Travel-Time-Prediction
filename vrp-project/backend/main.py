from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
from typing import List, Tuple, Dict, Any
import pandas as pd
import xgboost as xgb
import mlflow.xgboost
from ortools.constraint_solver import routing_enums_pb2
from ortools.constraint_solver import pywrapcp
import numpy as np
import requests
from datetime import datetime, timedelta
import os
from dotenv import load_dotenv

# Database SQLite & UUID
import sqlite3
import uuid

# ================= 1. INISIALISASI SERVER & KONFIGURASI =================

load_dotenv()
OWM_API_KEY = os.getenv("OPENWEATHER_API_KEY")
RUN_ID = os.getenv("MLFLOW_RUN_ID")
MLFLOW_TRACKING_URI = os.getenv("MLFLOW_TRACKING_URI")
if MLFLOW_TRACKING_URI:
    mlflow.set_tracking_uri(MLFLOW_TRACKING_URI)
OSRM_URL = "http://localhost:5000"

app = FastAPI(title="AI VRP Backend", description="Engine Optimasi Rute Logistik")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# --- LOAD MODEL ML ---
MODEL_PATH = f"runs:/{RUN_ID}/model_vrp_tegalsari_gpu"
try:
    if RUN_ID and "PASTE" not in RUN_ID:
        print(f"📂 Memuat Model AI dari MLflow (Run ID: {RUN_ID})...")
        model = mlflow.xgboost.load_model(MODEL_PATH)
        print("✅ Model berhasil dimuat!")
    else:
        print("⚠️ RUN_ID belum diisi. AI akan menggunakan fallback.")
        model = None
except Exception as e:
    print(f"❌ Gagal memuat model: {e}")
    model = None

# ================= 2. DATABASE LOCAL (SQLITE CACHE) =================

def init_db():
    conn = sqlite3.connect("locations.db", check_same_thread=False)
    cursor = conn.cursor()
    cursor.execute("""
        CREATE TABLE IF NOT EXISTS saved_locations (
            id TEXT PRIMARY KEY,
            name TEXT NOT NULL,
            lat REAL NOT NULL,
            lon REAL NOT NULL
        )
    """)
    conn.commit()
    return conn

db_conn = init_db()

def fetch_from_nominatim(query: str) -> Dict[str, Any] | None:
    headers = {
        "User-Agent": "VRP-Bachelor-Thesis/1.0",
        "Accept-Language": "id,en;q=0.9",
        "Referer": "http://localhost:5173",
    }
    url = "https://nominatim.openstreetmap.org/search"
    params = {"q": query, "format": "json", "limit": 1, "addressdetails": 0}
    try:
        response = requests.get(url, params=params, headers=headers, timeout=10)
        if response.status_code == 200:
            data = response.json()
            if data:
                return {
                    "name": query,
                    "lat": float(data[0]["lat"]),
                    "lon": float(data[0]["lon"])
                }
    except Exception as e:
        print(f"Nominatim Error: {e}")
    return None

# ================= 3. DATA MODELS (SCHEMA JSON) =================

class NodeInfo(BaseModel):
    id: str
    lat: float
    lon: float
    demand: int
    tw_start: int
    tw_end: int

class OptimizeRequest(BaseModel):
    nodes: List[NodeInfo]
    num_vehicles: int = 2
    vehicle_capacity: int = 15
    start_hour: int = 8

class ReoptimizeRequest(BaseModel):
    current_location: NodeInfo
    unvisited_nodes: List[NodeInfo]
    new_orders: List[NodeInfo]
    vehicle_capacity: int = 15
    num_vehicles: int = 1
    current_hour: int

# ================= 4. GENERATORS & OSRM (Dari vrp_compare.py) =================

def get_realtime_weather(lat: float, lon: float) -> Tuple[int, str]:
    if not OWM_API_KEY: return 0, "No Key"
    url = f"https://api.openweathermap.org/data/2.5/weather?lat={lat}&lon={lon}&appid={OWM_API_KEY}&units=metric"
    try:
        r = requests.get(url, timeout=5)
        if r.status_code == 200:
            main_weather = r.json()['weather'][0]['main']
            is_rain = 1 if main_weather in ['Rain', 'Drizzle', 'Thunderstorm'] else 0
            return is_rain, main_weather
        return 0, "Unknown"
    except:
        return 0, "Error"

def get_osrm_table(nodes_data: List[Dict]) -> Tuple[List[List[int]], List[List[int]]]:
    coords = ";".join([f"{n['lon']},{n['lat']}" for n in nodes_data])
    url = f"{OSRM_URL}/table/v1/driving/{coords}?annotations=duration,distance"
    n = len(nodes_data)
    try:
        r = requests.get(url, timeout=10.0)
        if r.status_code == 200:
            d = r.json()
            distances = [[int(val) for val in row] for row in d['distances']]
            durations = [[int(val) for val in row] for row in d['durations']]
            return distances, durations
    except Exception as e:
        print(f"OSRM Table Error: {e}")
    return [[1000]*n for _ in range(n)], [[120]*n for _ in range(n)]

def generate_hybrid_matrix(model: Any, nodes_data: List[Dict], hour: int, day: int, is_rain: int) -> np.ndarray:
    num_nodes = len(nodes_data)
    time_matrix = np.zeros((num_nodes, num_nodes), dtype=int)
    
    predict_payload = []
    matrix_indices = []
    dists, durs = get_osrm_table(nodes_data)
    
    for i in range(num_nodes):
        for j in range(num_nodes):
            if i == j: continue 
            dist = dists[i][j]
            dur_normal = durs[i][j]
            if dist == 0: dist, dur_normal = 1000, 120
            
            row = {'origin_lat': nodes_data[i]['lat'], 'origin_lng': nodes_data[i]['lon'], 
                   'dest_lat': nodes_data[j]['lat'], 'dest_lng': nodes_data[j]['lon'],
                   'distance_meters': dist, 'duration_normal_sec': dur_normal,
                   'hour_of_day': hour, 'day_code': day, 'is_rain': is_rain}
            predict_payload.append(row)
            matrix_indices.append((i, j))

    if predict_payload and model:
        df_pred = pd.DataFrame(predict_payload)
        cols = ['origin_lat', 'origin_lng', 'dest_lat', 'dest_lng', 'distance_meters', 'duration_normal_sec', 'hour_of_day', 'day_code', 'is_rain']
        predicted = model.predict(df_pred[cols])
        
        for idx, (r, c) in enumerate(matrix_indices):
            # Simulasi Skripsi: Paksa kemacetan ganda (seperti di vrp_compare)
            pred_sec = predicted[idx]
            if 16 <= hour <= 18:
                pred_sec *= 1
            time_matrix[r][c] = max(0, int(round(pred_sec)))
    else:
        for idx, (r, c) in enumerate(matrix_indices):
            time_matrix[r][c] = predict_payload[idx]['duration_normal_sec']
            
    return time_matrix

def generate_distance_matrix(nodes_data: List[Dict]) -> Tuple[np.ndarray, np.ndarray]:
    num_nodes = len(nodes_data)
    dist_matrix = np.zeros((num_nodes, num_nodes), dtype=int)
    normal_time_matrix = np.zeros((num_nodes, num_nodes), dtype=int)
    
    dists, durs = get_osrm_table(nodes_data)
    for i in range(num_nodes):
        for j in range(num_nodes):
            if i == j: continue 
            dist = dists[i][j]
            dur = durs[i][j]
            if dist == 0: dist, dur = 1000, 120
            
            dist_matrix[i][j] = int(dist)
            normal_time_matrix[i][j] = int(dur)
            
    return dist_matrix, normal_time_matrix

def evaluate_actual_trip(routes: List[Dict], matrix_reality: np.ndarray, nodes_data: List[Dict], start_hour: int) -> Dict[str, Any]:
    """
    Mensimulasikan ulang rute yang sudah jadi menggunakan matrix_reality (Kondisi Macet Aktual).
    Fungsi ini menghitung biaya bensin real dan total pelanggaran Time Window di lapangan.
    """
    total_fuel_rp = 0
    total_late_count = 0
    SERVICE_TIME_SEC = 120
    
    base_time = datetime.now().replace(hour=start_hour, minute=0, second=0, microsecond=0)
    
    evaluated_routes = []
    
    for route in routes:
        current_time = base_time
        steps = route['steps']
        new_steps = []
        
        for i in range(len(steps)):
            step = steps[i]
            idx_curr = step['node_index']
            
            # Hitung waktu perjalanan jika bukan origin
            if i > 0:
                idx_prev = steps[i-1]['node_index']
                travel_time = matrix_reality[idx_prev][idx_curr]
                current_time += timedelta(seconds=int(travel_time))
                total_fuel_rp += int(travel_time * 5) # 5 Rupiah per detik perjalanan
            
            # Cek Time Window
            is_late = False
            seconds_since_start = (current_time - base_time).total_seconds()
            
            # Node 0 (Depot Akhir) tidak punya tw valid dalam list (bisa jadi out of bounds jika id=0). 
            # Kita amankan:
            if idx_curr < len(nodes_data) and idx_curr != 0:
                tw_start = nodes_data[idx_curr]['tw_start']
                tw_end = nodes_data[idx_curr]['tw_end']
                
                # Jika datang kepagian, tunggu
                if seconds_since_start < tw_start:
                    wait_sec = tw_start - seconds_since_start
                    current_time += timedelta(seconds=int(wait_sec))
                    seconds_since_start = tw_start
                    
                # Jika datang kemalaman, denda
                if seconds_since_start > tw_end:
                    is_late = True
                    total_late_count += 1
            
            # Update Step Info
            new_step = step.copy()
            new_step['arrival_time'] = current_time.strftime("%H:%M:%S")
            new_step['is_late'] = is_late
            new_steps.append(new_step)
            
            # Tambah service time (kecuali finish)
            if idx_curr != 0:
                current_time += timedelta(seconds=SERVICE_TIME_SEC)
                
        evaluated_routes.append({
            "vehicle_id": route["vehicle_id"],
            "steps": new_steps
        })
        
    penalty_rp = total_late_count * 20000
    
    return {
        "fuel_rp": total_fuel_rp,
        "penalty_rp": penalty_rp,
        "total_rp": total_fuel_rp + penalty_rp,
        "late_count": total_late_count,
        "routes": evaluated_routes
    }


# ================= 5. SOLVER MODULAR (MENGEMBALIKAN JSON FRONTEND) =================

def solve_vrp_modular(cost_matrix: np.ndarray, time_matrix_for_constraint: np.ndarray, nodes_data: List[Dict], start_hour: int, num_vehicles: int, vehicle_capacity: int, cost_rupiah_matrix: np.ndarray) -> Dict[str, Any]:
    """
    Fungsi Solver yang fleksibel, menggabungkan logika evaluasi vrp_compare menjadi JSON yang utuh untuk frontend.
    cost_matrix = matrix yang mau diminimalkan solver (Jarak/Waktu AI).
    time_matrix_for_constraint = constraint time window (Waktu Normal/Waktu AI).
    cost_rupiah_matrix = cost metics per-hop yang akan dikonversi ke rupiah secara murni (mengabaikan unit cost_matrix solver internal).
    """
    SERVICE_TIME_SEC = 120
    
    data = {}
    data['cost_matrix'] = cost_matrix
    data['time_matrix'] = time_matrix_for_constraint
    data['demands'] = [n['demand'] for n in nodes_data] 
    data['time_windows'] = [(n['tw_start'], n['tw_end']) for n in nodes_data]
    data['vehicle_capacities'] = [vehicle_capacity] * num_vehicles
    data['num_vehicles'] = num_vehicles
    data['depot'] = 0

    manager = pywrapcp.RoutingIndexManager(len(cost_matrix), num_vehicles, 0)
    routing = pywrapcp.RoutingModel(manager)

    # 1. SET COST PADA SOLVER
    def cost_callback(from_index, to_index):
        from_node = manager.IndexToNode(from_index)
        to_node = manager.IndexToNode(to_index)
        return int(data['cost_matrix'][from_node][to_node])
    transit_callback_index = routing.RegisterTransitCallback(cost_callback)
    routing.SetArcCostEvaluatorOfAllVehicles(transit_callback_index)

    # 2. SET CONSTRAINT TIME 
    def time_callback(from_index, to_index):
        from_node = manager.IndexToNode(from_index)
        to_node = manager.IndexToNode(to_index)
        val = int(data['time_matrix'][from_node][to_node])
        if to_node != 0: val += SERVICE_TIME_SEC
        return val
    time_callback_index = routing.RegisterTransitCallback(time_callback)
    routing.AddDimension(time_callback_index, 36000, 86400, False, 'Time')
    time_dimension = routing.GetDimensionOrDie('Time')
    
    for loc_idx, (start, end) in enumerate(data['time_windows']):
        index = manager.NodeToIndex(loc_idx)
        time_dimension.CumulVar(index).SetMin(start)
        # Soft bound: denda point yang besar agar tetap mencoba patuh jika memungkinkan
        time_dimension.SetCumulVarSoftUpperBound(index, end, 100)

    # 3. SET CONSTRAINT CAPACITY
    def demand_callback(from_index):
        from_node = manager.IndexToNode(from_index)
        return data['demands'][from_node]
    demand_callback_index = routing.RegisterUnaryTransitCallback(demand_callback)
    routing.AddDimension(demand_callback_index, 0, vehicle_capacity, False, 'Capacity')

    # 4. SOLVE DENGAN METAHEURISTIC
    search_parameters = pywrapcp.DefaultRoutingSearchParameters()
    search_parameters.first_solution_strategy = routing_enums_pb2.FirstSolutionStrategy.PATH_CHEAPEST_ARC
    search_parameters.local_search_metaheuristic = routing_enums_pb2.LocalSearchMetaheuristic.GUIDED_LOCAL_SEARCH
    search_parameters.time_limit.seconds = 5 
    
    solution = routing.SolveWithParameters(search_parameters)

    # 5. PARSING OUT - EXTRAKSI JSON LAYAK FRONTEND + HITUNG TRUE RUPIAH
    if not solution:
        return {"status": "FAILED", "message": "Solusi rute tidak ditemukan (Constraint terlalu ketat/Overload)."}
        
    base_time = datetime.now().replace(hour=start_hour, minute=0, second=0, microsecond=0)
    result_routes = []
    
    total_cost_rupiah = 0 # Biaya Bahan Bakar Aktual
    
    for vehicle_id in range(num_vehicles):
        index = routing.Start(vehicle_id)
        route_steps = []
        
        while not routing.IsEnd(index):
            node_idx = manager.IndexToNode(index)
            # Dapatkan Waktu Kedatangan Simulasinya
            time_var = solution.Value(time_dimension.CumulVar(index))
            arrival_time = base_time + timedelta(seconds=time_var)
            
            demand_val = data['demands'][node_idx]
            task = "START" if node_idx == 0 else ("PICKUP" if demand_val > 0 else ("DROP" if demand_val < 0 else "PASS"))
            
            route_steps.append({
                "node_index": node_idx,
                "location_id": nodes_data[node_idx]['id'],
                "task": task,
                "demand": demand_val,
                "arrival_time": arrival_time.strftime("%H:%M:%S")
            })
            
            previous_index = index
            index = solution.Value(routing.NextVar(index))
            
            # Hitung Bensin Pure Real (Perdetik x 5 Rupiah) 
            prev_node = manager.IndexToNode(previous_index)
            next_node = manager.IndexToNode(index)
            segment_real_sec = int(cost_rupiah_matrix[prev_node][next_node])
            if prev_node != next_node: # Avoid depot->depot cost if route is empty
                total_cost_rupiah += (segment_real_sec * 5)
            
        # Tambahkan Depot Akhir
        node_idx = manager.IndexToNode(index)
        time_var = solution.Value(time_dimension.CumulVar(index))
        arrival_time = base_time + timedelta(seconds=time_var)
        route_steps.append({
            "node_index": node_idx,
            "location_id": "0_Depot_Akhir",
            "task": "FINISH",
            "demand": 0,
            "arrival_time": arrival_time.strftime("%H:%M:%S")
        })
        
        # Omit empty routes generated by solver
        if len(route_steps) > 2:
            result_routes.append({
                "vehicle_id": len(result_routes) + 1,
                "steps": route_steps
            })

    return {
        "status": "SUCCESS",
        "objective_value": total_cost_rupiah,
        "routes": result_routes
    }

# ================= 6. REST API ENDPOINTS =================

@app.post("/optimize")
def optimize_route(req: OptimizeRequest):
    nodes_data = [{'id': n.id, 'lat': n.lat, 'lon': n.lon, 'demand': n.demand, 'tw_start': n.tw_start, 'tw_end': n.tw_end} for n in req.nodes]
    is_rain, w_desc = get_realtime_weather(nodes_data[0]['lat'], nodes_data[0]['lon'])
    day_of_week = datetime.now().weekday() # Menggunakan Hari Realita

    # Matrix A: AI Time Prediction (Sadar Macet)
    matrix_ai = generate_hybrid_matrix(model, nodes_data, req.start_hour, day_of_week, is_rain)
    
    # Matrix B: Distance (Jarak Murni / Buta Macet)
    matrix_dist, matrix_normal_time = generate_distance_matrix(nodes_data)

    # 👉 SKENARIO A (AI Optimization)
    # solver_cost: AI, constraint_time: AI, rupiah_evaluator: AI (Detik Prediksi * 5)
    result_ai = solve_vrp_modular(matrix_ai, matrix_ai, nodes_data, req.start_hour, req.num_vehicles, req.vehicle_capacity, matrix_ai)
    
    if result_ai["status"] == "FAILED":
        raise HTTPException(status_code=400, detail=result_ai["message"])

    # 👉 SKENARIO B (Traditional/Distance Optimization)
    # solver_cost: Distance, constraint_time: Normal, rupiah_evaluator: Normal (Detik Asli * 5)
    result_benchmark = solve_vrp_modular(matrix_dist, matrix_normal_time, nodes_data, req.start_hour, req.num_vehicles, req.vehicle_capacity, matrix_normal_time)

    # 1. Evaluasi Ulang Rute Memakai Kondisi Realita (matrix_ai) + Denda Lateness!
    eval_ai = evaluate_actual_trip(result_ai["routes"], matrix_ai, nodes_data, req.start_hour)
    eval_bench = evaluate_actual_trip(result_benchmark["routes"], matrix_ai, nodes_data, req.start_hour)

    # Tindih return values dengan rute yg sudah dievaluasi time windownya secara riil
    result_ai["routes"] = eval_ai["routes"]
    result_ai["objective_value"] = eval_ai["total_rp"]

    # Hitung Selisih
    savings = 0
    if result_benchmark["status"] == "SUCCESS":
        savings = eval_bench["total_rp"] - eval_ai["total_rp"]

    # Metadata Respons
    result_ai["metadata"] = {
        "weather": w_desc,
        "is_rain": is_rain,
        "ai_cost_rp": eval_ai["total_rp"],
        "ai_penalty_rp": eval_ai["penalty_rp"],
        "ai_late_count": eval_ai["late_count"],
        "benchmark_cost_rp": eval_bench["total_rp"] if result_benchmark["status"] == "SUCCESS" else 0,
        "bench_penalty_rp": eval_bench["penalty_rp"],
        "bench_late_count": eval_bench["late_count"],
        "savings_rp": savings
    }

    return result_ai

@app.post("/reoptimize")
def reoptimize_route(req: ReoptimizeRequest):
    nodes_data = [{
        'id': req.current_location.id, 'lat': req.current_location.lat, 'lon': req.current_location.lon, 
        'demand': 0, 'tw_start': req.current_location.tw_start, 'tw_end': req.current_location.tw_end
    }]
    for n in req.unvisited_nodes + req.new_orders:
        nodes_data.append({
            'id': n.id, 'lat': n.lat, 'lon': n.lon, 
            'demand': n.demand, 'tw_start': n.tw_start, 'tw_end': n.tw_end
        })

    is_rain, w_desc = get_realtime_weather(nodes_data[0]['lat'], nodes_data[0]['lon'])
    day_of_week = datetime.now().weekday()

    # Regenerate Matrices untuk Reoptimisasi
    matrix_ai = generate_hybrid_matrix(model, nodes_data, req.current_hour, day_of_week, is_rain)
    matrix_dist, matrix_normal_time = generate_distance_matrix(nodes_data)

    result_ai = solve_vrp_modular(matrix_ai, matrix_ai, nodes_data, req.current_hour, req.num_vehicles, req.vehicle_capacity, matrix_ai)
    
    if result_ai["status"] == "FAILED":
        raise HTTPException(status_code=400, detail="Tidak dapat menemukan rute re-optimasi yang valid.")
        
    result_benchmark = solve_vrp_modular(matrix_dist, matrix_normal_time, nodes_data, req.current_hour, req.num_vehicles, req.vehicle_capacity, matrix_normal_time)

    # Evaluasi Realita
    eval_ai = evaluate_actual_trip(result_ai["routes"], matrix_ai, nodes_data, req.current_hour)
    eval_bench = evaluate_actual_trip(result_benchmark["routes"], matrix_ai, nodes_data, req.current_hour)

    # Tindih rute & cost
    result_ai["routes"] = eval_ai["routes"]
    result_ai["objective_value"] = eval_ai["total_rp"]

    savings = 0
    if result_benchmark["status"] == "SUCCESS":
        savings = eval_bench["total_rp"] - eval_ai["total_rp"]

    result_ai["metadata"] = {
        "weather": w_desc, 
        "is_rain": is_rain,
        "type": "Dynamic Mid-Route Update",
        "ai_cost_rp": eval_ai["total_rp"],
        "ai_penalty_rp": eval_ai["penalty_rp"],
        "ai_late_count": eval_ai["late_count"],
        "benchmark_cost_rp": eval_bench["total_rp"] if result_benchmark["status"] == "SUCCESS" else 0,
        "bench_penalty_rp": eval_bench["penalty_rp"],
        "bench_late_count": eval_bench["late_count"],
        "savings_rp": savings
    }
    return result_ai

@app.get("/search_location")
def search_location(q: str):
    cursor = db_conn.cursor()
    cursor.execute("SELECT id, name, lat, lon FROM saved_locations WHERE name LIKE ?", (f"%{q}%",))
    row = cursor.fetchone()
    if row:
        return {"source": "local_cache", "id": row[0], "name": row[1], "lat": row[2], "lon": row[3]}
        
    osm_data = fetch_from_nominatim(q)
    if not osm_data:
        raise HTTPException(status_code=404, detail="Lokasi tidak ditemukan di database dan OpenStreetMap")
        
    new_id = str(uuid.uuid4())
    cursor.execute("INSERT INTO saved_locations (id, name, lat, lon) VALUES (?, ?, ?, ?)",
                   (new_id, q, osm_data['lat'], osm_data['lon']))
    db_conn.commit()
    return {"source": "osm_api", "id": new_id, "name": q, "lat": osm_data["lat"], "lon": osm_data["lon"]}

@app.get("/saved_locations")
def saved_locations():
    cursor = db_conn.cursor()
    cursor.execute("SELECT id, name, lat, lon FROM saved_locations")
    rows = cursor.fetchall()
    return [{"id": r[0], "name": r[1], "lat": r[2], "lon": r[3]} for r in rows]