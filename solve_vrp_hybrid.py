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

# ================= 1. KONFIGURASI SISTEM =================

# Load API Key
load_dotenv()
OWM_API_KEY = os.getenv("OPENWEATHER_API_KEY")

RUN_ID = os.getenv("MLFLOW_RUN_ID")  # <--- Ambil Run ID dari .env

# Validasi Error Biar Gak Bingung
if not RUN_ID:
    raise ValueError("❌ ERROR: Harap isi 'MLFLOW_RUN_ID' di file .env!")

# Susun Path Model Otomatis
MODEL_PATH = f"runs:/{RUN_ID}/model_vrp_tegalsari_gpu"

print(f"📂 Menggunakan Model dari Run ID: {RUN_ID}")

# Server Peta Offline (Docker)
OSRM_URL = "http://localhost:5000"

# --- KONFIGURASI LOGISTIK ---
NUM_VEHICLES = 2           
VEHICLE_CAPACITY = 15      # Kapasitas Maksimal (Paket)
SHIFT_START_HOUR = 8       # Jam Kerja Mulai 08:00
SERVICE_TIME_SEC = 300     # Waktu Bongkar Muat (5 Menit)

# --- DATA NODES (VRPSPD: PICKUP & DELIVERY) ---
# Demand (-): DELIVERY / DROP (Mengurangi muatan mobil)
# Demand (+): PICKUP / AMBIL (Menambah muatan mobil)
# Time Window (Detik): (Jam Buka, Jam Tutup) relatif dari jam 08:00

nodes_data = [
    # 0. DEPOT (Netral)
    {'id': '0_Depot_JNE',       'lat': -7.265232, 'lon': 112.736966, 'demand': 0,  'tw': (0, 40000)}, 
    
    # 1-3. DELIVERY (Harus Drop Barang) -> Demand NEGATIF
    {'id': '1_TP_Tunjungan',    'lat': -7.262608, 'lon': 112.742352, 'demand': -3, 'tw': (3600, 14400)}, # Buka 09.00-12.00
    {'id': '2_Hotel_Majapahit', 'lat': -7.260656, 'lon': 112.738876, 'demand': -2, 'tw': (0, 28800)},    # Bebas
    {'id': '3_Pasar_Kembang',   'lat': -7.269480, 'lon': 112.730594, 'demand': -5, 'tw': (0, 7200)},     # Pagi 08.00-10.00
    
    # 4-6. PICKUP (Harus Ambil Barang) -> Demand POSITIF
    {'id': '4_Siola_Mall',      'lat': -7.256426, 'lon': 112.736236, 'demand': 4,  'tw': (3600, 28800)}, # Buka 09.00+
    {'id': '5_SMA_Trimurti',    'lat': -7.271378, 'lon': 112.743125, 'demand': 2,  'tw': (0, 10800)},    # Pagi 08.00-11.00
    {'id': '6_Patung_Sapi',     'lat': -7.263884, 'lon': 112.742308, 'demand': 1,  'tw': (0, 28800)},    # Bebas

    # 7-9. CAMPURAN
    {'id': '7_Rawon_Setan',     'lat': -7.261884, 'lon': 112.739778, 'demand': 3,  'tw': (18000, 28800)}, # Sore 13.00+ (Pickup)
    {'id': '8_Pandegiling',     'lat': -7.273641, 'lon': 112.733470, 'demand': -2, 'tw': (0, 28800)},     # Bebas (Drop)
    {'id': '9_Gramedia',        'lat': -7.266857, 'lon': 112.742223, 'demand': -2, 'tw': (3600, 28800)}   # Bebas (Drop)
]

# ================= 2. FUNGSI UTILITAS =================

def get_realtime_weather(lat, lon):
    if not OWM_API_KEY: return 0, "No Key"
    url = f"https://api.openweathermap.org/data/2.5/weather?lat={lat}&lon={lon}&appid={OWM_API_KEY}&units=metric"
    print(f"☁️ Cek Cuaca ({lat}, {lon})...")
    try:
        r = requests.get(url, timeout=5)
        if r.status_code == 200:
            d = r.json()
            main = d['weather'][0]['main']
            rain_cond = ['Rain', 'Drizzle', 'Thunderstorm']
            is_rain = 1 if main in rain_cond else 0
            print(f"   🌡️ Suhu: {d['main']['temp']}°C | Kondisi: {main}")
            return is_rain, main
        return 0, "Unknown"
    except: return 0, "Error"

def get_osm_route_local(lat1, lon1, lat2, lon2):
    url = f"{OSRM_URL}/route/v1/driving/{lon1},{lat1};{lon2},{lat2}?overview=false"
    try:
        r = requests.get(url, timeout=0.5) 
        if r.status_code == 200:
            d = r.json()['routes'][0]
            return d['distance'], d['duration']
        return 0, 0
    except: return 0, 0

# ================= 3. GENERATE MATRIX (AI PREDICTION) =================

def generate_hybrid_matrix(model, nodes_data, hour, day, is_rain):
    num_nodes = len(nodes_data)
    time_matrix = np.zeros((num_nodes, num_nodes), dtype=int)
    
    print(f"\n🚀 Membangun Matrix Waktu Tempuh (AI + OSRM)...")
    predict_payload = []
    matrix_indices = [] 

    for i in range(num_nodes):
        for j in range(num_nodes):
            if i == j: continue 
            
            lat1, lon1 = nodes_data[i]['lat'], nodes_data[i]['lon']
            lat2, lon2 = nodes_data[j]['lat'], nodes_data[j]['lon']
            
            dist, dur_normal = get_osm_route_local(lat1, lon1, lat2, lon2)
            if dist == 0: dist, dur_normal = 1000, 120 # Fallback
            
            row = {
                'origin_lat': lat1, 'origin_lng': lon1,
                'dest_lat': lat2, 'dest_lng': lon2,
                'distance_meters': dist, 'duration_normal_sec': dur_normal,
                'hour_of_day': hour, 'day_code': day, 'is_rain': is_rain
            }
            predict_payload.append(row)
            matrix_indices.append((i, j))

    if predict_payload:
        df_pred = pd.DataFrame(predict_payload)
        cols = ['origin_lat', 'origin_lng', 'dest_lat', 'dest_lng',
                'distance_meters', 'duration_normal_sec', 
                'hour_of_day', 'day_code', 'is_rain']
        df_pred = df_pred[cols]
        predicted = model.predict(df_pred)
        
        for idx, (r, c) in enumerate(matrix_indices):
            val = int(round(predicted[idx])) 
            time_matrix[r][c] = max(0, val)
            
    return time_matrix

# ================= 4. SIMULASI DINAMIS (REAL-TIME RE-CALCULATION) =================

def simulate_dynamic_trip(model, route_list, start_time, nodes_data, is_rain):
    print(f"\n🚀 SIMULASI REAL-TIME (Dynamic Traffic Update)...")
    print(f"   🕒 Start Awal: {start_time.strftime('%H:%M:%S')}")
    
    current_time = start_time
    
    for i in range(len(route_list) - 1):
        idx_from = route_list[i]
        idx_to = route_list[i+1]
        
        node_from = nodes_data[idx_from]
        node_to = nodes_data[idx_to]
        
        # 1. Ambil Jarak
        dist, dur_normal = get_osm_route_local(node_from['lat'], node_from['lon'], 
                                               node_to['lat'], node_to['lon'])
        
        # 2. Update Jam untuk AI (Dynamic!)
        current_hour_float = current_time.hour + (current_time.minute / 60.0)
        day_code = current_time.weekday()
        
        # 3. Prediksi Ulang
        row = pd.DataFrame([{
            'origin_lat': node_from['lat'], 'origin_lng': node_from['lon'],
            'dest_lat': node_to['lat'], 'dest_lng': node_to['lon'],
            'distance_meters': dist, 'duration_normal_sec': dur_normal,
            'hour_of_day': current_hour_float, # <--- JAM DINAMIS
            'day_code': day_code, 'is_rain': is_rain
        }])
        
        pred_sec = model.predict(row)[0]
        travel_time = int(max(0, pred_sec))
        
        # 4. Hitung Tiba & Berangkat
        arrival_time = current_time + timedelta(seconds=travel_time)
        departure_time = arrival_time + timedelta(seconds=SERVICE_TIME_SEC)
        
        # Cek Tipe Tugas (Pickup/Drop)
        demand = node_to['demand']
        task = "🛑 Lewat"
        if demand < 0: task = f"🔽 DROP {-demand}"
        elif demand > 0: task = f"🔼 PICKUP {demand}"
        elif idx_to == 0: task = "🏁 SELESAI"

        print(f"   🚗 Ke {node_to['id']:<20} | {task:<12} | Tiba: {arrival_time.strftime('%H:%M:%S')} (Macet: {travel_time//60} mnt)")
        
        current_time = departure_time

# ================= 5. MAIN SOLVER (VRPSPD + CONSTRAINTS) =================

def solve_vrp_final(time_matrix, nodes_data, model, start_hour, is_rain):
    # Setup Data OR-Tools
    data = {}
    data['time_matrix'] = time_matrix
    data['demands'] = [n['demand'] for n in nodes_data] 
    data['time_windows'] = [n['tw'] for n in nodes_data]
    data['vehicle_capacities'] = [VEHICLE_CAPACITY] * NUM_VEHICLES
    data['num_vehicles'] = NUM_VEHICLES
    data['depot'] = 0

    manager = pywrapcp.RoutingIndexManager(len(time_matrix), NUM_VEHICLES, 0)
    routing = pywrapcp.RoutingModel(manager)

    # A. Callback Waktu (Travel + Service)
    def time_callback(from_index, to_index):
        from_node = manager.IndexToNode(from_index)
        to_node = manager.IndexToNode(to_index)
        travel_time = int(data['time_matrix'][from_node][to_node])
        if to_node != 0: return travel_time + SERVICE_TIME_SEC
        return travel_time

    transit_callback_index = routing.RegisterTransitCallback(time_callback)
    routing.SetArcCostEvaluatorOfAllVehicles(transit_callback_index)

    # B. Callback Kapasitas (+/- Muatan)
    def demand_callback(from_index):
        from_node = manager.IndexToNode(from_index)
        return data['demands'][from_node]

    demand_callback_index = routing.RegisterUnaryTransitCallback(demand_callback)
    
    # C. Constraint Kapasitas (VRPSPD Logic)
    routing.AddDimension(
        demand_callback_index,
        0,                 # Null capacity slack
        VEHICLE_CAPACITY,  # Max Capacity
        False,              # Fix start cumul to zero
        'Capacity')

    # D. Constraint Time Window
    routing.AddDimension(
        transit_callback_index,
        36000, 86400, False, 'Time')
    
    time_dimension = routing.GetDimensionOrDie('Time')
    for location_idx, (start, end) in enumerate(data['time_windows']):
        index = manager.NodeToIndex(location_idx)
        time_dimension.CumulVar(index).SetRange(start, end)

    # E. Prioritas Kendaraan (SUDAH DIHAPUS)
    # Kita biarkan kosong agar OR-Tools memilih murni berdasarkan Cost (Waktu).
    # routing.SetFixedCostOfVehicle(0, 0)     <-- HAPUS
    # routing.SetFixedCostOfVehicle(10000, 1) <-- HAPUS

    # F. Solving
    search_parameters = pywrapcp.DefaultRoutingSearchParameters()
    search_parameters.first_solution_strategy = routing_enums_pb2.FirstSolutionStrategy.PATH_CHEAPEST_ARC
    
    solution = routing.SolveWithParameters(search_parameters)

    # --- PRINT HASIL PERENCANAAN & JALANKAN SIMULASI ---
    if solution:
        print(f"\n{'='*40} HASIL PERENCANAAN RUTE (STATIC) {'='*40}")
        print(f"🎯 Objective Value: {solution.ObjectiveValue()}")
        
        base_time = datetime.now().replace(hour=start_hour, minute=0, second=0)

        for vehicle_id in range(NUM_VEHICLES):
            index = routing.Start(vehicle_id)
            route_sequence = []
            plan_output = f'\n🚚 KURIR {vehicle_id + 1} (Rencana Awal):\n'
            
            while not routing.IsEnd(index):
                node_index = manager.IndexToNode(index)
                route_sequence.append(node_index)
                
                # Info Load
                load_change = data['demands'][node_index]
                task = "START"
                if load_change < 0: task = f"DROP {-load_change}"
                elif load_change > 0: task = f"AMBIL {load_change}"
                
                # Info Waktu
                time_var = solution.Value(time_dimension.CumulVar(index))
                arrival_time = base_time + timedelta(seconds=time_var)
                
                plan_output += f'   📍 {nodes_data[node_index]["id"]} ({task}) -> Tiba: {arrival_time.strftime("%H:%M")}\n'
                index = solution.Value(routing.NextVar(index))
            
            # End Node
            node_index = manager.IndexToNode(index)
            route_sequence.append(node_index)
            plan_output += f'   🏁 KEMBALI KE DEPOT'
            print(plan_output)
            
            # --- JALANKAN SIMULASI DINAMIS UNTUK RUTE INI ---
            if len(route_sequence) > 2:
                simulate_dynamic_trip(model, route_sequence, base_time, nodes_data, is_rain)
                
    else:
        print("❌ Solusi tidak ditemukan! Cek Constraint.")

# ================= MAIN EXECUTION =================

if __name__ == "__main__":
    print("\n--- FINAL THESIS VRP SYSTEM (HYBRID AI + OSRM + VRPSPD) ---")
    
    try:
        if "PASTE_RUN_ID" in MODEL_PATH:
            print("❌ ERROR: Isi MODEL_PATH di baris 20 dulu!")
            exit()
        model = mlflow.xgboost.load_model(MODEL_PATH)
    except:
        print("❌ Gagal load model.")
        exit()

    # Input Pagi Hari
    print(f"🕒 Shift dimulai pukul: {SHIFT_START_HOUR}:00")
    h = int(input("Masukkan Jam Prediksi (Saran: 8): "))
    d = 0 # Senin
    
    # Cek Cuaca & Solve
    is_rain, _ = get_realtime_weather(nodes_data[0]['lat'], nodes_data[0]['lon'])
    
    try:
        # 1. Generate Matrix Awal
        matrix = generate_hybrid_matrix(model, nodes_data, h, d, is_rain)
        # 2. Solve & Simulate
        solve_vrp_final(matrix, nodes_data, model, h, is_rain)
    except Exception as e:
        print(f"Error Runtime: {e}")