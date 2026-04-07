import pandas as pd
import xgboost as xgb
import mlflow.xgboost
from ortools.constraint_solver import routing_enums_pb2
from ortools.constraint_solver import pywrapcp
import numpy as np
import requests
import json
import time
from datetime import datetime, timedelta
import os
from dotenv import load_dotenv

# ================= 1. KONFIGURASI =================
load_dotenv()
OWM_API_KEY = os.getenv("OPENWEATHER_API_KEY")
RUN_ID = os.getenv("MLFLOW_RUN_ID") 
MODEL_PATH = f"runs:/{RUN_ID}/model_vrp_tegalsari_gpu"
OSRM_URL = "http://localhost:5000"

NUM_VEHICLES = 5           
VEHICLE_CAPACITY = 20      
SHIFT_START_HOUR = 8       
SERVICE_TIME_SEC = 120     

# UPDATE DATA DI FILE compare_vrp_approaches.py

# SKENARIO: RUSH HOUR SORE (Start 16:00 / Jam 4 Sore)
# Asumsi: Macet parah di area Tunjungan & Siola.

# ================= GANTI BAGIAN INI =================

# SKENARIO: THE DEADLY TRAP (Start 16:00)
# Kita memancing Distance VRP ke jalan macet dengan iming-iming jarak dekat.

# UPDATE DATA DI FILE compare_vrp_approaches.py

# Skenario: SHIFT PAGI (Start 08:00)
# 1 Jam = 3600 detik.
# Time Window dibuat "TIGHT" (Sempit) agar salah perhitungan dikit aja langsung telat.

# ================= GANTI BAGIAN INI =================

# SKENARIO: THE TOXIC LINK TRAP (Start 16:00)
# Memaksa Distance VRP masuk ke jalur SMA -> Rawon yang macet parah.

nodes_data = [
    # ================= 0-9: DATA LAMA (TERMASUK JEBAKAN) =================
    {'id': '0_Depot_JNE',       'lat': -7.265232, 'lon': 112.736966, 'demand': 0,  'tw': (0, 86400)}, 

    # --- URUTAN JEBAKAN 1 & 2 ---
    {'id': '5_SMA_Trimurti',    'lat': -7.271378, 'lon': 112.743125, 'demand': 2,  'tw': (0, 1800)}, 
    {'id': '7_Rawon_Setan',     'lat': -7.261884, 'lon': 112.739778, 'demand': 3,  'tw': (0, 1800)},

    # --- FILLER LAMA ---
    {'id': '4_Siola_Mall',      'lat': -7.256426, 'lon': 112.736236, 'demand': 4,  'tw': (0, 900)},
    {'id': '1_TP_Tunjungan',    'lat': -7.262608, 'lon': 112.742352, 'demand': -3, 'tw': (0, 900)},
    {'id': '3_Pasar_Kembang',   'lat': -7.269480, 'lon': 112.730594, 'demand': -5, 'tw': (0, 900)},
    {'id': '8_Pandegiling',     'lat': -7.273641, 'lon': 112.733470, 'demand': -2, 'tw': (900, 1800)},
    {'id': '2_Hotel_Majapahit', 'lat': -7.260656, 'lon': 112.738876, 'demand': -2, 'tw': (900, 1800)},
    {'id': '9_Gramedia',        'lat': -7.266857, 'lon': 112.742223, 'demand': -2, 'tw': (900, 1800)},
    {'id': '6_Patung_Sapi',     'lat': -7.263884, 'lon': 112.742308, 'demand': 1,  'tw': (900, 1800)},

    # ================= 10-29: DATA BARU (AREA TEGALSARI) =================
    
    # KORIDOR KEDUNGDORO & SEKITARNYA
    {'id': '10_SPBU_Kedungdoro',  'lat': -7.261012, 'lon': 112.732045, 'demand': -4, 'tw': (0, 900)},
    {'id': '11_Apotek_K24',       'lat': -7.266050, 'lon': 112.731080, 'demand': 2,  'tw': (600, 1800)},
    {'id': '12_Warkop_Pitlik',    'lat': -7.264020, 'lon': 112.735010, 'demand': -1, 'tw': (0, 1800)},
    {'id': '13_Polsek_Tegalsari', 'lat': -7.267088, 'lon': 112.734000, 'demand': 3,  'tw': (0, 1800)},
    {'id': '14_Sate_Klisik',      'lat': -7.271015, 'lon': 112.732090, 'demand': -3, 'tw': (900, 1800)},

    # KORIDOR BASUKI RAHMAT & EMBONG MALANG
    {'id': '15_KFC_Basra',        'lat': -7.265005, 'lon': 112.740510, 'demand': 4,  'tw': (900, 1800)},
    {'id': '16_McD_Basra',        'lat': -7.263520, 'lon': 112.741080, 'demand': -2, 'tw': (0, 3600)},
    {'id': '17_Kopi_Kenangan',    'lat': -7.262055, 'lon': 112.738010, 'demand': 2,  'tw': (1800, 3600)},
    {'id': '18_Plaza_BRI',        'lat': -7.264510, 'lon': 112.742590, 'demand': -5, 'tw': (0, 3600)},
    {'id': '19_Taman_Apsari',     'lat': -7.263080, 'lon': 112.744020, 'demand': 1,  'tw': (1800, 3600)},

    # KORIDOR PANGLIMA SUDIRMAN & KEPUTRAN
    {'id': '20_Monumen_Bambu',    'lat': -7.267812, 'lon': 112.743050, 'demand': -2, 'tw': (1800, 5400)},
    {'id': '21_Intiland_Tower',   'lat': -7.268045, 'lon': 112.741010, 'demand': 5,  'tw': (0, 900)},
    {'id': '22_Hotel_Bumi',       'lat': -7.269088, 'lon': 112.742050, 'demand': -4, 'tw': (0, 3600)},
    {'id': '23_Gereja_Hati_Kudus','lat': -7.270510, 'lon': 112.741580, 'demand': 2,  'tw': (0, 2700)},
    {'id': '24_Pasar_Keputran',   'lat': -7.273050, 'lon': 112.742010, 'demand': -5, 'tw': (0, 900)},

    # KORIDOR DARMO & DINOYO (BATAS SELATAN TEGALSARI)
    {'id': '25_BCA_Darmo',        'lat': -7.275520, 'lon': 112.740050, 'demand': 3,  'tw': (900, 1800)},
    {'id': '26_RS_Darmo',         'lat': -7.280010, 'lon': 112.738090, 'demand': -3, 'tw': (0, 2700)},
    {'id': '27_Kantor_Pos_Dinoyo','lat': -7.278055, 'lon': 112.739020, 'demand': 4,  'tw': (1800, 2700)},
    {'id': '28_Pecel_Madiun',     'lat': -7.272045, 'lon': 112.735080, 'demand': -2, 'tw': (1800, 3600)},
    {'id': '29_Indomaret_Pregolan','lat':-7.268510, 'lon': 112.737520, 'demand': 1,  'tw': (0, 1800)}
]

# ================= 2. HELPERS =================
def get_realtime_weather(lat, lon):
    # (Kode sama seperti sebelumnya - disingkat biar rapi)
    if not OWM_API_KEY: return 0, "No Key"
    url = f"https://api.openweathermap.org/data/2.5/weather?lat={lat}&lon={lon}&appid={OWM_API_KEY}&units=metric"
    try:
        r = requests.get(url, timeout=5)
        if r.status_code == 200:
            d = r.json()
            main = d['weather'][0]['main']
            is_rain = 1 if main in ['Rain', 'Drizzle', 'Thunderstorm'] else 0
            return is_rain, main
        return 0, "Unknown"
    except: return 0, "Error"

def get_osrm_table(nodes_data):
    """Mengambil matrix jarak dan waktu dari OSRM dalam sekali jalan via Bulk API."""
    coords = ";".join([f"{n['lon']},{n['lat']}" for n in nodes_data])
    url = f"{OSRM_URL}/table/v1/driving/{coords}?annotations=duration,distance"
    
    n = len(nodes_data)
    try:
        r = requests.get(url, timeout=10.0)
        if r.status_code == 200:
            d = r.json()
            # Convert float m/s to int
            distances = [[int(val) for val in row] for row in d['distances']]
            durations = [[int(val) for val in row] for row in d['durations']]
            return distances, durations
    except Exception as e:
        print(f"OSRM Error: {e}")
        pass
        
    return [[1000]*n for _ in range(n)], [[120]*n for _ in range(n)]

# ================= 3. GENERATORS =================

# --- MATRIX A: HYBRID AI (Cost = Waktu Macet) ---
def generate_hybrid_matrix(model, nodes_data, hour, day, is_rain):
    num_nodes = len(nodes_data)
    time_matrix = np.zeros((num_nodes, num_nodes), dtype=int)
    print(f"   🤖 Generate Matrix AI (Traffic Prediction)...")
    
    predict_payload = []
    matrix_indices = [] 
    
    dists, durs = get_osrm_table(nodes_data)
    
    for i in range(num_nodes):
        for j in range(num_nodes):
            if i == j: continue 
            lat1, lon1 = nodes_data[i]['lat'], nodes_data[i]['lon']
            lat2, lon2 = nodes_data[j]['lat'], nodes_data[j]['lon']
            
            dist = dists[i][j]
            dur_normal = durs[i][j]
            if dist == 0: dist, dur_normal = 1000, 120
            
            row = {'origin_lat': lat1, 'origin_lng': lon1, 'dest_lat': lat2, 'dest_lng': lon2,
                   'distance_meters': dist, 'duration_normal_sec': dur_normal,
                   'hour_of_day': hour, 'day_code': day, 'is_rain': is_rain}
            predict_payload.append(row)
            matrix_indices.append((i, j))

    if predict_payload:
        df_pred = pd.DataFrame(predict_payload)
        # Pastikan urutan kolom sesuai training
        cols = ['origin_lat', 'origin_lng', 'dest_lat', 'dest_lng', 'distance_meters', 'duration_normal_sec', 'hour_of_day', 'day_code', 'is_rain']
        predicted = model.predict(df_pred[cols])
        for idx, (r, c) in enumerate(matrix_indices):
            time_matrix[r][c] = max(0, int(round(predicted[idx])))
            
    return time_matrix

# --- MATRIX B: TRADITIONAL (Cost = Jarak Meter) ---
def generate_distance_matrix(nodes_data):
    num_nodes = len(nodes_data)
    dist_matrix = np.zeros((num_nodes, num_nodes), dtype=int)
    normal_time_matrix = np.zeros((num_nodes, num_nodes), dtype=int) # Tetap butuh waktu normal buat constraint TimeWindow
    
    print(f"   📏 Generate Matrix Jarak (OSRM Distance)...")
    
    dists, durs = get_osrm_table(nodes_data)
    
    for i in range(num_nodes):
        for j in range(num_nodes):
            if i == j: continue 
            lat1, lon1 = nodes_data[i]['lat'], nodes_data[i]['lon']
            lat2, lon2 = nodes_data[j]['lat'], nodes_data[j]['lon']
            
            dist = dists[i][j]
            dur = durs[i][j]
            if dist == 0: dist, dur = 1000, 120
            
            dist_matrix[i][j] = int(dist) # Cost optimization pakai Meter
            normal_time_matrix[i][j] = int(dur) # Constraint pakai Detik Normal
            
    return dist_matrix, normal_time_matrix

# ================= 4. SOLVER (MODULAR) =================

def solve_vrp_modular(cost_matrix, time_matrix_for_constraint, nodes_data, objective_name):
    """
    Fungsi Solver yang fleksibel.
    - cost_matrix: Matrix yang mau di-minimalkan (bisa Waktu AI atau Jarak).
    - time_matrix_for_constraint: Matrix waktu (untuk validasi Time Window).
    """
    data = {}
    data['cost_matrix'] = cost_matrix
    data['time_matrix'] = time_matrix_for_constraint
    data['demands'] = [n['demand'] for n in nodes_data] 
    data['time_windows'] = [n['tw'] for n in nodes_data]
    data['vehicle_capacities'] = [VEHICLE_CAPACITY] * NUM_VEHICLES
    data['num_vehicles'] = NUM_VEHICLES
    data['depot'] = 0

    manager = pywrapcp.RoutingIndexManager(len(cost_matrix), NUM_VEHICLES, 0)
    routing = pywrapcp.RoutingModel(manager)

    # 1. SET COST (Apa yang mau dihemat?)
    def cost_callback(from_index, to_index):
        from_node = manager.IndexToNode(from_index)
        to_node = manager.IndexToNode(to_index)
        return int(data['cost_matrix'][from_node][to_node])
    
    transit_callback_index = routing.RegisterTransitCallback(cost_callback)
    routing.SetArcCostEvaluatorOfAllVehicles(transit_callback_index)

    # 2. SET CONSTRAINT TIME (Tetap Wajib Pakai Waktu)
    def time_callback(from_index, to_index):
        from_node = manager.IndexToNode(from_index)
        to_node = manager.IndexToNode(to_index)
        # Jika tujuan bukan depot, tambah service time
        val = int(data['time_matrix'][from_node][to_node])
        if to_node != 0: val += SERVICE_TIME_SEC
        return val

    time_callback_index = routing.RegisterTransitCallback(time_callback)
    
    routing.AddDimension(
        time_callback_index,
        36000, 86400, False, 'Time')
    
    time_dimension = routing.GetDimensionOrDie('Time')
    for location_idx, (start, end) in enumerate(data['time_windows']):
        index = manager.NodeToIndex(location_idx)
        time_dimension.CumulVar(index).SetMin(start)
        # Gunakan Soft Upper Bound agar AI tidak menyerah gagal jika terpaksa telat
        # Denda 100 points per detik jika melewati 'end'
        time_dimension.SetCumulVarSoftUpperBound(index, end, 100)

    # 3. SET CONSTRAINT CAPACITY
    def demand_callback(from_index):
        from_node = manager.IndexToNode(from_index)
        return data['demands'][from_node]
    demand_callback_index = routing.RegisterUnaryTransitCallback(demand_callback)
    routing.AddDimension(demand_callback_index, 0, VEHICLE_CAPACITY, False, 'Capacity')

    # SOLVE
    search_parameters = pywrapcp.DefaultRoutingSearchParameters()
    search_parameters.first_solution_strategy = routing_enums_pb2.FirstSolutionStrategy.PATH_CHEAPEST_ARC
    
    solution = routing.SolveWithParameters(search_parameters)

    # OUTPUT HASIL (Return Routes)
    extracted_routes = []
    
    if solution:
        print(f"\n✅ Solusi Ditemukan untuk: {objective_name}")
        print(f"   Objective Cost: {solution.ObjectiveValue()}")
        
        for vehicle_id in range(NUM_VEHICLES):
            index = routing.Start(vehicle_id)
            route = []
            while not routing.IsEnd(index):
                node_index = manager.IndexToNode(index)
                route.append(node_index)
                index = solution.Value(routing.NextVar(index))
            route.append(manager.IndexToNode(index)) # Add Depot Akhir
            extracted_routes.append(route)
            
        return extracted_routes
    else:
        print(f"❌ Tidak ada solusi untuk {objective_name}")
        return []

# ================= 5. SIMULATOR (WASIT) - VERSI DETAIL =================

def simulate_dynamic_trip(model, route_list, start_time, nodes_data, is_rain, matrix_dist, matrix_normal, shift_start_time=None):
    if shift_start_time is None:
        shift_start_time = start_time
    current_time = start_time
    total_duration_sec = 0
    total_lateness_count = 0 # Hitung berapa kali telat
    
    print(f"      {'ASAL':<15} -> {'TUJUAN':<15} | {'DURASI':<10} | {'TIBA':<8} | {'STATUS TW'}")
    print(f"      {'-'*85}")

    for i in range(len(route_list) - 1):
        idx_from = route_list[i]
        idx_to = route_list[i+1]
        node_from = nodes_data[idx_from]
        node_to = nodes_data[idx_to]
        
        # 1. Ambil Data Real (OSRM)
        dist = matrix_dist[idx_from][idx_to]
        dur_normal = matrix_normal[idx_from][idx_to]
        
        # 2. Prediksi AI (Real Traffic)
        # Kita gunakan logic AI untuk simulasi karena ini dianggap 'Kenyataan'
        row = pd.DataFrame([{
            'origin_lat': node_from['lat'], 'origin_lng': node_from['lon'],
            'dest_lat': node_to['lat'], 'dest_lng': node_to['lon'],
            'distance_meters': dist, 'duration_normal_sec': dur_normal,
            'hour_of_day': current_time.hour + (current_time.minute/60.0),
            'day_code': current_time.weekday(), 'is_rain': is_rain
        }])
        
        # Prediksi Waktu Tempuh Nyata
        cols = ['origin_lat', 'origin_lng', 'dest_lat', 'dest_lng', 'distance_meters', 'duration_normal_sec', 'hour_of_day', 'day_code', 'is_rain']
        pred_sec = model.predict(row[cols])[0]
        travel_time = int(max(0, pred_sec))
        
        # Hitung Waktu Tiba
        arrival_time = current_time + timedelta(seconds=travel_time)
        
        # 3. CEK TIME WINDOW (WASIT)
        tw_start, tw_end = nodes_data[idx_to]['tw']
        seconds_since_start = (arrival_time - shift_start_time).total_seconds()
        
        status_msg = "✅ OK"
        
        # KASUS A: KEPAGIAN (Harus Nunggu)
        if seconds_since_start < tw_start:
            wait = tw_start - seconds_since_start
            arrival_time += timedelta(seconds=wait)
            status_msg = f"⏳ Wait {int(wait/60)}m"
            travel_time += wait # Durasi nambah karena nunggu
            
        # KASUS B: KESIANGAN (VIOLATION!)
        elif seconds_since_start > tw_end:
            late_min = int((seconds_since_start - tw_end) / 60)
            status_msg = f"❌ LATE {late_min}m"
            total_lateness_count += 1
            
        # Update Waktu & Durasi
        actual_segment_time = travel_time
        if idx_to != 0: actual_segment_time += SERVICE_TIME_SEC
            
        current_time += timedelta(seconds=actual_segment_time)
        total_duration_sec += actual_segment_time
        
        # Print
        from_n = node_from['id'][:12]
        to_n = node_to['id'][:12]
        print(f"      {from_n:<15} -> {to_n:<15} | {int(travel_time/60):<2} mnt     | {arrival_time.strftime('%H:%M'):<8} | {status_msg}")

    print(f"      {'-'*85}")
    if total_lateness_count > 0:
        print(f"      🚨 PELANGGARAN TIME WINDOW: {total_lateness_count} Lokasi!")
    else:
        print(f"      ✨ SEMUA ON-TIME!")
        
    return total_duration_sec, total_lateness_count

# ================= MAIN BATTLE =================

if __name__ == "__main__":
    print("\n--- 🥊 VRP BATTLE: AI vs TRADITIONAL (TIGHT WINDOWS) ---")
    
    # 1. Load Model & Setup
    try:
        if "PASTE_RUN_ID" in MODEL_PATH:
            print("❌ ERROR: Isi MODEL_PATH di baris 20 dulu!")
            exit()
        mlflow.set_tracking_uri("http://127.0.0.1:5000")
        model = mlflow.xgboost.load_model(MODEL_PATH)
    except Exception as e:
        print(f"❌ Gagal load model. Pastikan Run ID benar. Detail: {e}")
        exit()

    # Input Manual Jam Simulasi
    h = int(input("Simulasi Jam Berapa? (Saran: 8 untuk Pagi): "))
    base_time = datetime.now().replace(hour=h, minute=0, second=0)
    
    # Cek Cuaca
    is_rain, _ = get_realtime_weather(nodes_data[0]['lat'], nodes_data[0]['lon'])

    # 2. GENERATE MATRICES
    # Matrix A: AI Time Prediction (Sadar Macet)
    matrix_ai = generate_hybrid_matrix(model, nodes_data, h, 0, is_rain)
    
    # Matrix B: Distance (Buta Macet, cuma tau Jarak)
    matrix_dist, matrix_normal_time = generate_distance_matrix(nodes_data)

    # 3. SOLVE KEDUANYA
    print("\n🧐 Sedang Mengoptimasi Rute...")
    
    # A. Solve pakai AI (Cost = Waktu Macet)
    routes_ai = solve_vrp_modular(matrix_ai, matrix_ai, nodes_data, "SKENARIO A (AI Optimization)")
    
    # B. Solve pakai Jarak (Cost = Jarak Meter)
    # Note: Constraint tetap pakai matrix_normal_time agar Distance VRP tetap patuh Time Window (secara teori)
    routes_dist = solve_vrp_modular(matrix_dist, matrix_normal_time, nodes_data, "SKENARIO B (Distance Optimization)")

    # =========================================================================
    # MULAI DARI SINI ADALAH BAGIAN YANG KAMU TANYAKAN (GANTI YANG LAMA)
    # =========================================================================

    # 4. BANDINGKAN HASIL (SIMULASI WASIT)
    print(f"\n{'='*20} HASIL PERBANDINGAN {'='*20}")
    
    total_time_ai_scenario = 0
    total_time_dist_scenario = 0
    
    # --- Simulasi Rute AI ---
    print("\n🚀 1. Evaluasi Rute AI:")
    ai_lateness = 0
    for i, rute in enumerate(routes_ai):
        if len(rute) > 2:
            # Panggil fungsi simulate yang baru (return 2 nilai: durasi & jumlah telat)
            dur, late = simulate_dynamic_trip(model, rute, base_time, nodes_data, is_rain, matrix_dist, matrix_normal_time) 
            total_time_ai_scenario += dur
            ai_lateness += late
            print(f"   👉 Total Durasi Kurir {i+1}: {dur/60:.1f} menit")

    # --- Simulasi Rute Tradisional ---
    print("\n📏 2. Evaluasi Rute Tradisional (Jarak):")
    dist_lateness = 0
    for i, rute in enumerate(routes_dist):
        if len(rute) > 2:
            # Panggil fungsi simulate yang baru
            dur, late = simulate_dynamic_trip(model, rute, base_time, nodes_data, is_rain, matrix_dist, matrix_normal_time)
            total_time_dist_scenario += dur
            dist_lateness += late
            print(f"   👉 Total Durasi Kurir {i+1}: {dur/60:.1f} menit")

    # 5. SCORE BOARD UPDATE (BIAYA BENSIN & DENDA)
    print(f"\n{'='*20} SCORE BOARD {'='*20}")
    
    # AI Cost
    bensin_ai = int((total_time_ai_scenario / 60) * 300)
    denda_ai = ai_lateness * 20000
    total_rp_ai = bensin_ai + denda_ai
    
    # Dist Cost (Standard ETA)
    bensin_dist = int((total_time_dist_scenario / 60) * 300)
    denda_dist = dist_lateness * 20000
    total_rp_dist = bensin_dist + denda_dist
    
    print(f"🤖 AI VRP       : Bensin Rp {bensin_ai:,} | Denda Rp {denda_ai:,} | TOTAL Rp {total_rp_ai:,}")
    print(f"📏 Standard VRP : Bensin Rp {bensin_dist:,} | Denda Rp {denda_dist:,} | TOTAL Rp {total_rp_dist:,}")
    
    if total_rp_ai < total_rp_dist:
        hemat = total_rp_dist - total_rp_ai
        print(f"\n🏆 AI MENANG! (Lebih hemat Rp {hemat:,}).")
    elif total_rp_ai > total_rp_dist:
        hemat = total_rp_ai - total_rp_dist
        print(f"\n🏆 LAMA MENANG! (Standard ETA lebih hemat Rp {hemat:,}).")
    else:
        print("\n🤝 SERI / Biaya sama persis.")