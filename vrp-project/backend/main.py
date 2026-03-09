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
import sqlite3
import uuid

# ================= 1. INISIALISASI =================
load_dotenv()
OWM_API_KEY = os.getenv("OPENWEATHER_API_KEY")
RUN_ID = os.getenv("MLFLOW_RUN_ID")
MLFLOW_TRACKING_URI = os.getenv("MLFLOW_TRACKING_URI")
if MLFLOW_TRACKING_URI:
    mlflow.set_tracking_uri(MLFLOW_TRACKING_URI)
OSRM_URL = "http://localhost:5000"

app = FastAPI(title="AI VRP Backend", description="Engine Optimasi Rute Logistik Full TDVRP")
app.add_middleware(CORSMiddleware, allow_origins=["*"], allow_credentials=True, allow_methods=["*"], allow_headers=["*"])

try:
    MODEL_PATH = f"runs:/{RUN_ID}/model_vrp_tegalsari_gpu"
    model = mlflow.xgboost.load_model(MODEL_PATH) if (RUN_ID and "PASTE" not in RUN_ID) else None
except Exception:
    model = None

# ================= 2. DATABASE =================
def init_db():
    conn = sqlite3.connect("locations.db", check_same_thread=False)
    conn.execute("CREATE TABLE IF NOT EXISTS saved_locations (id TEXT PRIMARY KEY, name TEXT NOT NULL, lat REAL NOT NULL, lon REAL NOT NULL)")
    conn.commit()
    return conn
db_conn = init_db()

def fetch_from_nominatim(query: str):
    headers = {"User-Agent": "VRP-Bachelor-Thesis/1.0", "Accept-Language": "id,en;q=0.9"}
    try:
        res = requests.get("https://nominatim.openstreetmap.org/search", params={"q": query, "format": "json", "limit": 1}, headers=headers, timeout=10)
        if res.status_code == 200 and res.json():
            return {"name": query, "lat": float(res.json()[0]["lat"]), "lon": float(res.json()[0]["lon"])}
    except Exception: pass
    return None

# ================= 3. DATA MODELS =================
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
    start_time: str = "08:00" 

class DynamicInjectionRequest(BaseModel):
    original_nodes: List[NodeInfo]
    original_routes: List[Dict[str, Any]]
    new_orders: List[NodeInfo]
    start_time: str       
    interrupt_time: str   
    num_vehicles: int
    vehicle_capacity: int

# ================= 4. GENERATORS & CUACA =================

def get_hourly_weather_forecast(lat: float, lon: float) -> Tuple[Dict[int, int], str]:
    hourly_rain = {h: 0 for h in range(24)}
    current_weather_desc = "Unknown"
    if not OWM_API_KEY: return hourly_rain, "No Key"

    try:
        r_curr = requests.get(f"https://api.openweathermap.org/data/2.5/weather?lat={lat}&lon={lon}&appid={OWM_API_KEY}&units=metric", timeout=5)
        if r_curr.status_code == 200:
            current_weather_desc = r_curr.json()['weather'][0]['main']
            curr_is_rain = 1 if current_weather_desc in ['Rain', 'Drizzle', 'Thunderstorm'] else 0
            for h in range(24): hourly_rain[h] = curr_is_rain

        r_cast = requests.get(f"https://api.openweathermap.org/data/2.5/forecast?lat={lat}&lon={lon}&appid={OWM_API_KEY}&units=metric", timeout=5)
        if r_cast.status_code == 200:
            for item in r_cast.json().get('list', []):
                dt_obj = datetime.strptime(item['dt_txt'], "%Y-%m-%d %H:%M:%S")
                h = dt_obj.hour
                rain_status = 1 if item['weather'][0]['main'] in ['Rain', 'Drizzle', 'Thunderstorm'] else 0
                hourly_rain[h] = rain_status
                hourly_rain[(h + 1) % 24] = rain_status
                hourly_rain[(h + 2) % 24] = rain_status
        return hourly_rain, current_weather_desc
    except Exception as e:
        return hourly_rain, "Error"

def get_osrm_table(nodes_data: List[Dict]):
    coords = ";".join([f"{n['lon']},{n['lat']}" for n in nodes_data])
    n = len(nodes_data)
    try:
        r = requests.get(f"{OSRM_URL}/table/v1/driving/{coords}?annotations=duration,distance", timeout=10.0)
        if r.status_code == 200:
            d = r.json()
            return [[int(v) for v in row] for row in d['distances']], [[int(v) for v in row] for row in d['durations']]
    except Exception: pass
    return [[1000]*n for _ in range(n)], [[120]*n for _ in range(n)]

def generate_hybrid_matrix(model: Any, nodes_data: List[Dict], float_hour: float, day: int, is_rain: int):
    n = len(nodes_data)
    t_mat = np.zeros((n, n), dtype=int)
    payload, indices = [], []
    dists, durs = get_osrm_table(nodes_data)
    
    for i in range(n):
        for j in range(n):
            if i == j: continue 
            dist, dur = dists[i][j], durs[i][j]
            if dist == 0: dist, dur = 1000, 120
            payload.append({'origin_lat': nodes_data[i]['lat'], 'origin_lng': nodes_data[i]['lon'], 'dest_lat': nodes_data[j]['lat'], 'dest_lng': nodes_data[j]['lon'], 'distance_meters': dist, 'duration_normal_sec': dur, 'hour_of_day': float_hour, 'day_code': day, 'is_rain': is_rain})
            indices.append((i, j))

    if payload and model:
        df_pred = pd.DataFrame(payload)
        preds = model.predict(df_pred[['origin_lat', 'origin_lng', 'dest_lat', 'dest_lng', 'distance_meters', 'duration_normal_sec', 'hour_of_day', 'day_code', 'is_rain']])
        for idx, (r, c) in enumerate(indices):
            t_mat[r][c] = max(0, int(round(preds[idx])))
    else:
        for idx, (r, c) in enumerate(indices):
            t_mat[r][c] = payload[idx]['duration_normal_sec']
    return t_mat

def generate_tdvrp_matrices(model: Any, nodes_data: List[Dict], day: int, hourly_rain: Dict[int, int]) -> Dict[Tuple[int, int], np.ndarray]:
    num_nodes = len(nodes_data)
    dists, durs = get_osrm_table(nodes_data)
    matrices = {}
    predict_payload, indices = [], []
    
    for h in range(7, 20):
        for m in [0, 30]:
            if h == 19 and m == 30: continue 
            matrices[(h, m)] = np.zeros((num_nodes, num_nodes), dtype=int)
            is_rain_h = hourly_rain.get(h, 0) 
            float_hour = h + (m / 60.0)
            
            for i in range(num_nodes):
                for j in range(num_nodes):
                    if i == j: continue
                    dist, dur = dists[i][j], durs[i][j]
                    if dist == 0: dist, dur = 1000, 120
                    predict_payload.append({
                        'origin_lat': nodes_data[i]['lat'], 'origin_lng': nodes_data[i]['lon'], 
                        'dest_lat': nodes_data[j]['lat'], 'dest_lng': nodes_data[j]['lon'], 
                        'distance_meters': dist, 'duration_normal_sec': dur, 
                        'hour_of_day': float_hour, 'day_code': day, 'is_rain': is_rain_h
                    })
                    indices.append((h, m, i, j))
                
    if predict_payload and model:
        df_pred = pd.DataFrame(predict_payload)
        preds = model.predict(df_pred[['origin_lat', 'origin_lng', 'dest_lat', 'dest_lng', 'distance_meters', 'duration_normal_sec', 'hour_of_day', 'day_code', 'is_rain']])
        for idx, (h, m, i, j) in enumerate(indices):
            matrices[(h, m)][i][j] = max(0, int(round(preds[idx])))
    else:
        for idx, (h, m, i, j) in enumerate(indices):
            matrices[(h, m)][i][j] = predict_payload[idx]['duration_normal_sec']
            
    return matrices

def generate_distance_matrix(nodes_data: List[Dict]):
    n = len(nodes_data)
    d_mat, t_mat = np.zeros((n, n), dtype=int), np.zeros((n, n), dtype=int)
    dists, durs = get_osrm_table(nodes_data)
    for i in range(n):
        for j in range(n):
            if i != j:
                d_mat[i][j], t_mat[i][j] = int(dists[i][j] or 1000), int(durs[i][j] or 120)
    return d_mat, t_mat

def evaluate_actual_trip(routes: List[Dict], tdvrp_matrices: Dict[Tuple[int, int], np.ndarray], nodes_data: List[Dict], start_time_str: str):
    total_fuel, total_late = 0, 0
    h_start, m_start = map(int, start_time_str.split(':'))
    base_time = datetime.now().replace(hour=h_start, minute=m_start, second=0, microsecond=0)
    
    evaluated = []
    for route in routes:
        curr_time = base_time
        new_steps = []
        for i, step in enumerate(route['steps']):
            idx = step['node_index']
            if i > 0:
                prev_idx = route['steps'][i-1]['node_index']
                current_hour = curr_time.hour
                current_minute = curr_time.minute
                clamped_hour = max(7, min(19, current_hour))
                
                if clamped_hour == 19:
                    clamped_minute = 0
                else:
                    clamped_minute = 0 if current_minute < 30 else 30
                
                tt = tdvrp_matrices[(clamped_hour, clamped_minute)][prev_idx][idx]
                curr_time += timedelta(seconds=int(tt))
                total_fuel += int(tt * 5) 
            
            sec_since_start = (curr_time - base_time).total_seconds()
            is_late = False
            if idx < len(nodes_data) and idx != 0:
                tws, twe = nodes_data[idx]['tw_start'], nodes_data[idx]['tw_end']
                if sec_since_start < tws:
                    curr_time += timedelta(seconds=int(tws - sec_since_start))
                    sec_since_start = tws
                if sec_since_start > twe:
                    is_late = True
                    total_late += 1
            
            s = step.copy()
            s['arrival_time'] = curr_time.strftime("%H:%M:%S")
            s['is_late'] = is_late
            new_steps.append(s)
            
            if idx != 0: curr_time += timedelta(seconds=120)
            
        evaluated.append({"vehicle_id": route["vehicle_id"], "steps": new_steps})
    return {"fuel_rp": total_fuel, "penalty_rp": total_late * 20000, "total_rp": total_fuel + (total_late * 20000), "late_count": total_late, "routes": evaluated}

# ================= 5. SOLVER OR-TOOLS =================
def solve_vrp_modular(cost_matrix: np.ndarray, time_matrix: np.ndarray, nodes_data: List[Dict], start_time_str: str, num_vehicles: int, vehicle_capacity: int, cost_rupiah: np.ndarray, starts: List[int] = None, ends: List[int] = None):
    if starts is None: starts = [0] * num_vehicles
    if ends is None: ends = [0] * num_vehicles
    
    manager = pywrapcp.RoutingIndexManager(len(cost_matrix), num_vehicles, starts, ends)
    routing = pywrapcp.RoutingModel(manager)

    def cost_cb(f, t): return int(cost_matrix[manager.IndexToNode(f)][manager.IndexToNode(t)])
    routing.SetArcCostEvaluatorOfAllVehicles(routing.RegisterTransitCallback(cost_cb))

    def time_cb(f, t):
        v = int(time_matrix[manager.IndexToNode(f)][manager.IndexToNode(t)])
        return v + (0 if manager.IndexToNode(t) in ends else 120)
    time_dim_idx = routing.RegisterTransitCallback(time_cb)
    routing.AddDimension(time_dim_idx, 36000, 86400, False, 'Time')
    time_dim = routing.GetDimensionOrDie('Time')
    
    for i, n in enumerate(nodes_data):
        idx = manager.NodeToIndex(i)
        time_dim.CumulVar(idx).SetMin(n['tw_start'])
        time_dim.SetCumulVarSoftUpperBound(idx, n['tw_end'], 100)

    def demand_cb(f): return nodes_data[manager.IndexToNode(f)]['demand']
    routing.AddDimension(routing.RegisterUnaryTransitCallback(demand_cb), 0, vehicle_capacity, False, 'Capacity')

    p = pywrapcp.DefaultRoutingSearchParameters()
    p.first_solution_strategy = routing_enums_pb2.FirstSolutionStrategy.AUTOMATIC
    p.local_search_metaheuristic = routing_enums_pb2.LocalSearchMetaheuristic.GUIDED_LOCAL_SEARCH
    p.time_limit.seconds = 3 
    
    sol = routing.SolveWithParameters(p)
    if not sol: return {"status": "FAILED"}
        
    h, m = map(int, start_time_str.split(':'))
    base_time = datetime.now().replace(hour=h, minute=m, second=0, microsecond=0)
    routes, cost = [], 0 
    
    for v in range(num_vehicles):
        idx = routing.Start(v)
        steps = []
        while not routing.IsEnd(idx):
            n_idx = manager.IndexToNode(idx)
            arr_t = base_time + timedelta(seconds=sol.Value(time_dim.CumulVar(idx)))
            dem = nodes_data[n_idx]['demand']
            task = "START" if n_idx in starts else ("PICKUP" if dem > 0 else ("DROP" if dem < 0 else "PASS"))
            steps.append({"node_index": n_idx, "location_id": nodes_data[n_idx]['id'], "task": task, "demand": dem, "arrival_time": arr_t.strftime("%H:%M:%S")})
            prev, idx = manager.IndexToNode(idx), sol.Value(routing.NextVar(idx))
            if prev != manager.IndexToNode(idx): cost += (int(cost_rupiah[prev][manager.IndexToNode(idx)]) * 5)
            
        arr_t = base_time + timedelta(seconds=sol.Value(time_dim.CumulVar(idx)))
        steps.append({"node_index": manager.IndexToNode(idx), "location_id": "0_Depot_Akhir", "task": "FINISH", "demand": 0, "arrival_time": arr_t.strftime("%H:%M:%S")})
        routes.append({"vehicle_id": v + 1, "steps": steps})

    return {"status": "SUCCESS", "objective_value": cost, "routes": routes}

# ================= 6. FITUR BARU: SUCCESSIVE APPROXIMATION (Melihat Masa Depan) =================
def solve_tdvrp_with_look_ahead(nodes_data: List[Dict], start_time_str: str, num_vehicles: int, vehicle_capacity: int, tdvrp_matrices: Dict[Tuple[int, int], np.ndarray], initial_matrix: np.ndarray, cost_rupiah: np.ndarray, starts: List[int] = None, ends: List[int] = None):
    current_matrix = np.copy(initial_matrix)
    
    # KUNCI PERBAIKAN 1: Mekanisme WASIT (Global Best Tracker)
    best_res_overall = None
    best_cost_overall = float('inf') 
    
    MAX_ITERATION = 3 # AI akan melakukan iterasi pencarian maksimum 3 kali putaran

    for iteration in range(MAX_ITERATION):
        # 1. OR-Tools menebak rute menggunakan Matriks Hybrid saat ini
        res = solve_vrp_modular(current_matrix, current_matrix, nodes_data, start_time_str, num_vehicles, vehicle_capacity, cost_rupiah, starts, ends)
        
        if res["status"] == "FAILED":
            if best_res_overall is None: best_res_overall = res
            break
            
        # 2. WASIT MENGEVALUASI BIAYA AKTUAL DARI RUTE TEBAKAN INI
        eval_trip = evaluate_actual_trip(res["routes"], tdvrp_matrices, nodes_data, start_time_str)
        actual_cost = eval_trip["total_rp"]
        
        # 3. JIKA RUTE INI LEBIH MURAH DARI PUTARAN SEBELUMNYA, SIMPAN SEBAGAI JUARA!
        if actual_cost < best_cost_overall:
            best_cost_overall = actual_cost
            best_res_overall = res
        
        # 4. Membuat Matriks Hybrid Baru berdasarkan jam kedatangan nyata (Reality Check)
        new_hybrid_matrix = np.copy(current_matrix)
        matrix_changed = False
        
        for route in eval_trip["routes"]:
            for step in route["steps"]:
                if step["location_id"] == "0_Depot_Akhir": continue
                
                node_idx = step["node_index"]
                arr_time_str = step["arrival_time"]
                arr_h, arr_m, _ = map(int, arr_time_str.split(':'))
                
                arr_h = max(7, min(19, arr_h))
                if arr_h == 19:
                    arr_m = 0
                else:
                    arr_m = 0 if arr_m < 30 else 30
                    
                target_matrix = tdvrp_matrices[(arr_h, arr_m)]
                
                if not np.array_equal(new_hybrid_matrix[node_idx], target_matrix[node_idx]):
                    new_hybrid_matrix[node_idx] = target_matrix[node_idx]
                    matrix_changed = True
                    
        # Jika matriks tidak ada yang berubah, berarti rute sudah mentok/stabil (Konvergen)
        if not matrix_changed:
            break
            
        current_matrix = new_hybrid_matrix
        
    return best_res_overall

# ================= 7. REST API =================
@app.post("/optimize")
def optimize_route(req: OptimizeRequest):
    sh, sm = map(int, req.start_time.split(':'))
    if not (7 <= sh <= 19): raise HTTPException(status_code=400, detail="Operasional diluar jam kerja! Harap masukkan jam antara 07:00 hingga 19:00.")

    nodes = [{'id': n.id, 'lat': n.lat, 'lon': n.lon, 'demand': n.demand, 'tw_start': n.tw_start, 'tw_end': n.tw_end} for n in req.nodes]
    
    hourly_rain, w_desc = get_hourly_weather_forecast(nodes[0]['lat'], nodes[0]['lon'])
    current_hour_rain = hourly_rain.get(sh, 0)
    float_hour = sh + (sm / 60.0) 
    
    m_ai = generate_hybrid_matrix(model, nodes, float_hour, datetime.now().weekday(), current_hour_rain)
    m_tdvrp_ai = generate_tdvrp_matrices(model, nodes, datetime.now().weekday(), hourly_rain)
    m_dist, m_time = generate_distance_matrix(nodes)

    res_ai = solve_tdvrp_with_look_ahead(nodes, req.start_time, req.num_vehicles, req.vehicle_capacity, m_tdvrp_ai, m_ai, m_ai)
    if res_ai["status"] == "FAILED": raise HTTPException(status_code=400, detail="Solusi tidak ditemukan")
    
    res_bench = solve_vrp_modular(m_dist, m_time, nodes, req.start_time, req.num_vehicles, req.vehicle_capacity, m_time)

    e_ai = evaluate_actual_trip(res_ai["routes"], m_tdvrp_ai, nodes, req.start_time)
    res_ai["routes"] = [r for r in e_ai["routes"] if len(r["steps"]) > 2]
    res_ai["objective_value"] = e_ai["total_rp"]

    sav, e_bnc = 0, {"total_rp": 0, "penalty_rp": 0, "late_count": 0}
    if res_bench["status"] == "SUCCESS":
        e_bnc = evaluate_actual_trip(res_bench["routes"], m_tdvrp_ai, nodes, req.start_time)
        sav = e_bnc["total_rp"] - e_ai["total_rp"]

    res_ai["metadata"] = {
        "weather": w_desc, "is_rain": current_hour_rain, 
        "ai_cost_rp": e_ai["total_rp"], "ai_penalty_rp": e_ai["penalty_rp"], "ai_late_count": e_ai["late_count"], 
        "benchmark_cost_rp": e_bnc["total_rp"], "bench_penalty_rp": e_bnc["penalty_rp"], "bench_late_count": e_bnc["late_count"], 
        "savings_rp": sav
    }
    return res_ai

@app.post("/dynamic_injection")
def dynamic_injection(req: DynamicInjectionRequest):
    sh, sm = map(int, req.start_time.split(':'))
    ih, im = map(int, req.interrupt_time.split(':'))
    
    if not (7 <= sh <= 19) or not (7 <= ih <= 19):
        raise HTTPException(status_code=400, detail="Operasional diluar jam kerja!")

    depot = req.original_nodes[0]
    b_time = datetime.now().replace(hour=sh, minute=sm, second=0, microsecond=0)
    i_time = datetime.now().replace(hour=ih, minute=im, second=0, microsecond=0)

    # KUNCI PERBAIKAN 2: Time Shift Offset (Agar tidak kena penalti palsu)
    offset_sec = int((i_time - b_time).total_seconds())

    hourly_rain, w_desc = get_hourly_weather_forecast(depot.lat, depot.lon)
    current_hour_rain = hourly_rain.get(ih, 0)
    float_hour_inter = ih + (im / 60.0)

    # =========================================================================
    # PARALLEL UNIVERSE A: KURIR MENGGUNAKAN AI SEJAK PAGI
    # =========================================================================
    visited_ids_ai = [depot.id]
    past_routes_ai, last_loc_by_vid_ai = {}, {}
    
    for route in req.original_routes:
        vid = route["vehicle_id"]
        l_id = depot.id
        past_steps = []
        for step in route['steps']:
            if step['location_id'] == "0_Depot_Akhir": continue 
            arr_dt = b_time.replace(hour=int(step['arrival_time'].split(":")[0]), minute=int(step['arrival_time'].split(":")[1]), second=int(step['arrival_time'].split(":")[2]))
            if arr_dt <= i_time:
                visited_ids_ai.append(step['location_id'])
                l_id = step['location_id']
                past_steps.append(step.copy())
            else: break 
        past_routes_ai[vid] = past_steps
        last_loc_by_vid_ai[vid] = next((n for n in req.original_nodes if n.id == l_id), depot)

    unvisited_ai = [n for n in req.original_nodes if n.id not in visited_ids_ai]
    k_nodes_ai = [n for n in req.original_nodes if n.id in set([n.id for n in last_loc_by_vid_ai.values()])]
    
    active_ai = k_nodes_ai + unvisited_ai + req.new_orders
    if depot.id not in [n.id for n in active_ai]: active_ai.append(depot) 
    
    # SHIFTING: Kurangi batas TW dengan Offset Detik Interupsi
    a_dicts_ai = [{'id': n.id, 'lat': n.lat, 'lon': n.lon, 'demand': n.demand, 
                   'tw_start': max(0, n.tw_start - offset_sec), 
                   'tw_end': max(0, n.tw_end - offset_sec)} for n in active_ai]
    d_idx_ai = next(i for i, n in enumerate(a_dicts_ai) if n['id'] == depot.id)
    
    starts_ai = []
    for v in range(1, req.num_vehicles + 1):
        if v in last_loc_by_vid_ai: starts_ai.append(next(i for i, a in enumerate(a_dicts_ai) if a['id'] == last_loc_by_vid_ai[v].id))
        else: starts_ai.append(d_idx_ai)
    ends_ai = [d_idx_ai] * req.num_vehicles
    
    m_ai = generate_hybrid_matrix(model, a_dicts_ai, float_hour_inter, datetime.now().weekday(), current_hour_rain)
    m_tdvrp_ai_inter = generate_tdvrp_matrices(model, a_dicts_ai, datetime.now().weekday(), hourly_rain)
    
    res_ai = solve_tdvrp_with_look_ahead(a_dicts_ai, req.interrupt_time, req.num_vehicles, req.vehicle_capacity, m_tdvrp_ai_inter, m_ai, m_ai, starts=starts_ai, ends=ends_ai)
    if res_ai["status"] == "FAILED": raise HTTPException(status_code=400, detail="Re-routing Gagal")

    # =========================================================================
    # PARALLEL UNIVERSE B: KURIR MENGGUNAKAN STANDAR SEJAK PAGI
    # =========================================================================
    orig_dicts = [{'id': n.id, 'lat': n.lat, 'lon': n.lon, 'demand': n.demand, 'tw_start': n.tw_start, 'tw_end': n.tw_end} for n in req.original_nodes]
    m_dist_orig, m_time_orig = generate_distance_matrix(orig_dicts)
    res_bench_morning = solve_vrp_modular(m_dist_orig, m_time_orig, orig_dicts, req.start_time, req.num_vehicles, req.vehicle_capacity, m_time_orig)
    
    visited_ids_bench = [depot.id]
    past_routes_bench, last_loc_by_vid_bench = {}, {}

    if res_bench_morning["status"] == "SUCCESS":
        m_tdvrp_orig = generate_tdvrp_matrices(model, orig_dicts, datetime.now().weekday(), hourly_rain)
        eval_bench_morning = evaluate_actual_trip(res_bench_morning["routes"], m_tdvrp_orig, orig_dicts, req.start_time)
        
        for route in eval_bench_morning["routes"]:
            vid = route["vehicle_id"]
            l_id = depot.id
            past_steps = []
            for step in route['steps']:
                if step['location_id'] == "0_Depot_Akhir": continue 
                arr_dt = b_time.replace(hour=int(step['arrival_time'].split(":")[0]), minute=int(step['arrival_time'].split(":")[1]), second=int(step['arrival_time'].split(":")[2]))
                if arr_dt <= i_time:
                    visited_ids_bench.append(step['location_id'])
                    l_id = step['location_id']
                    past_steps.append(step.copy())
                else: break 
            past_routes_bench[vid] = past_steps
            last_loc_by_vid_bench[vid] = next((n for n in req.original_nodes if n.id == l_id), depot)

    unvisited_bench = [n for n in req.original_nodes if n.id not in visited_ids_bench]
    k_nodes_bench = [n for n in req.original_nodes if n.id in set([n.id for n in last_loc_by_vid_bench.values()])]
    
    active_bench = k_nodes_bench + unvisited_bench + req.new_orders
    if depot.id not in [n.id for n in active_bench]: active_bench.append(depot) 
    
    # SHIFTING: Kurangi batas TW dengan Offset Detik Interupsi
    a_dicts_bench = [{'id': n.id, 'lat': n.lat, 'lon': n.lon, 'demand': n.demand, 
                      'tw_start': max(0, n.tw_start - offset_sec), 
                      'tw_end': max(0, n.tw_end - offset_sec)} for n in active_bench]
    d_idx_bench = next(i for i, n in enumerate(a_dicts_bench) if n['id'] == depot.id)
    
    starts_bench = []
    for v in range(1, req.num_vehicles + 1):
        if v in last_loc_by_vid_bench: starts_bench.append(next(i for i, a in enumerate(a_dicts_bench) if a['id'] == last_loc_by_vid_bench[v].id))
        else: starts_bench.append(d_idx_bench)
    ends_bench = [d_idx_bench] * req.num_vehicles

    m_dist_bench, m_time_bench = generate_distance_matrix(a_dicts_bench)
    res_bench_afternoon = solve_vrp_modular(m_dist_bench, m_time_bench, a_dicts_bench, req.interrupt_time, req.num_vehicles, req.vehicle_capacity, m_time_bench, starts=starts_bench, ends=ends_bench)

    # =========================================================================
    # PENJAHITAN DAN SIMULASI AKHIR (MEMBANDINGKAN 2 UNIVERSE)
    # =========================================================================
    all_nodes = req.original_nodes + req.new_orders
    all_nodes_dicts = [{'id': n.id, 'lat': n.lat, 'lon': n.lon, 'demand': n.demand, 'tw_start': n.tw_start, 'tw_end': n.tw_end} for n in all_nodes]
    m_tdvrp_full = generate_tdvrp_matrices(model, all_nodes_dicts, datetime.now().weekday(), hourly_rain)

    def stitch_and_fix(solve_res, past_routes_map):
        stitched = []
        if solve_res["status"] != "SUCCESS": return stitched
        for new_route in solve_res["routes"]:
            vid = new_route["vehicle_id"]
            p_steps = past_routes_map.get(vid, [])
            n_steps = new_route["steps"]
            combined = p_steps + n_steps[1:] if (p_steps and n_steps and n_steps[0]['location_id'] == p_steps[-1]['location_id']) else p_steps + n_steps
                
            if len(combined) > 2:
                new_steps = []
                for s in combined:
                    new_s = s.copy()
                    if new_s['location_id'] == "0_Depot_Akhir":
                        new_s['node_index'] = 0
                    else:
                        new_s['node_index'] = next(i for i, n in enumerate(all_nodes_dicts) if n['id'] == new_s['location_id'])
                    new_steps.append(new_s)
                stitched.append({"vehicle_id": vid, "steps": new_steps})
        return stitched

    final_routes_ai = stitch_and_fix(res_ai, past_routes_ai)
    eval_ai = evaluate_actual_trip(final_routes_ai, m_tdvrp_full, all_nodes_dicts, req.start_time)
    
    final_routes_bench = stitch_and_fix(res_bench_afternoon, past_routes_bench)
    if len(final_routes_bench) > 0:
        eval_bench = evaluate_actual_trip(final_routes_bench, m_tdvrp_full, all_nodes_dicts, req.start_time)
        sav = eval_bench["total_rp"] - eval_ai["total_rp"]
    else:
        eval_bench = {"total_rp": 0, "penalty_rp": 0, "late_count": 0}
        sav = 0
            
    return {
        "status": "SUCCESS", "objective_value": eval_ai["total_rp"], "routes": eval_ai["routes"], 
        "metadata": {
            "type": "MID-ROUTE INJECTION", "weather": w_desc, "is_rain": current_hour_rain, 
            "ai_cost_rp": eval_ai["total_rp"], "ai_penalty_rp": eval_ai["penalty_rp"], "ai_late_count": eval_ai["late_count"],
            "benchmark_cost_rp": eval_bench["total_rp"], "bench_penalty_rp": eval_bench["penalty_rp"], "bench_late_count": eval_bench["late_count"], "savings_rp": sav
        }
    }

@app.get("/search_location")
def search_location(q: str):
    cursor = db_conn.cursor()
    row = cursor.execute("SELECT id, name, lat, lon FROM saved_locations WHERE name LIKE ?", (f"%{q}%",)).fetchone()
    if row: return {"source": "local_cache", "id": row[0], "name": row[1], "lat": row[2], "lon": row[3]}
    osm = fetch_from_nominatim(q)
    if not osm: raise HTTPException(status_code=404, detail="Lokasi tidak ditemukan")
    new_id = str(uuid.uuid4())
    cursor.execute("INSERT INTO saved_locations VALUES (?, ?, ?, ?)", (new_id, q, osm['lat'], osm['lon']))
    db_conn.commit()
    return {"source": "osm", "id": new_id, "name": q, "lat": osm["lat"], "lon": osm["lon"]}

@app.get("/saved_locations")
def saved_locations():
    return [{"id": r[0], "name": r[1], "lat": r[2], "lon": r[3]} for r in db_conn.cursor().execute("SELECT id, name, lat, lon FROM saved_locations").fetchall()]