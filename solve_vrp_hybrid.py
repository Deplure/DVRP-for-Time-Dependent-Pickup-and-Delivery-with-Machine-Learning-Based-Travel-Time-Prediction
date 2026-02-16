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

load_dotenv()
OWM_API_KEY = os.getenv("OPENWEATHER_API_KEY")

# ⚠️ GANTI DENGAN RUN ID MLFLOW KAMU
MODEL_PATH = "runs:/4dd9685008c941b1b7b769d5a15e9bf0/model_vrp_tegalsari_gpu"

OSRM_URL = "http://localhost:5000"

# --- KONFIGURASI BARU (KAPASITAS & WAKTU) ---
NUM_VEHICLES = 2           
VEHICLE_CAPACITY = 15      # Kapasitas maks per kurir (misal: 15 paket)
SHIFT_START_HOUR = 8       # Kurir mulai kerja jam 08:00 Pagi
SERVICE_TIME_SEC = 300     # Waktu bongkar muat per toko (300 detik = 5 menit)

# Data Lengkap: Koordinat, Demand (Paket), Time Window (Jam Buka-Tutup)
# Format Time Window: (Jam Mulai, Jam Selesai) relatif dari SHIFT_START_HOUR
# Contoh: Jika Shift mulai jam 8, maka jam 8 = 0, jam 9 = 3600 detik.
nodes_data = [
    # Node 0 (DEPOT) - Demand 0 - Buka Sepanjang Shift
    {'id': '0_Depot_JNE',       'lat': -7.265232, 'lon': 112.736966, 'demand': 0, 'tw': (0, 28800)}, 
    
    # Node 1-9 (CUSTOMER)
    {'id': '1_TP_Tunjungan',    'lat': -7.262608, 'lon': 112.742352, 'demand': 3, 'tw': (3600, 14400)},  # 09.00 - 12.00
    {'id': '2_Hotel_Majapahit', 'lat': -7.260656, 'lon': 112.738876, 'demand': 2, 'tw': (0, 28800)},     # Bebas (08.00 - 16.00)
    {'id': '3_Pasar_Kembang',   'lat': -7.269480, 'lon': 112.730594, 'demand': 5, 'tw': (0, 7200)},      # Pagi (08.00 - 10.00)
    {'id': '4_Siola_Mall',      'lat': -7.256426, 'lon': 112.736236, 'demand': 2, 'tw': (3600, 28800)},  # Buka agak siang (09.00+)
    {'id': '5_SMA_Trimurti',    'lat': -7.271378, 'lon': 112.743125, 'demand': 4, 'tw': (0, 10800)},     # Sekolah (08.00 - 11.00)
    {'id': '6_Gramedia_Basra',  'lat': -7.266857, 'lon': 112.742223, 'demand': 2, 'tw': (3600, 28800)},  # Toko (09.00+)
    {'id': '7_Rawon_Setan',     'lat': -7.261884, 'lon': 112.739778, 'demand': 3, 'tw': (18000, 28800)}, # Sore/Malam (13.00+)
    {'id': '8_Pandegiling',     'lat': -7.273641, 'lon': 112.733470, 'demand': 2, 'tw': (0, 28800)},     # Bebas
    {'id': '9_Patung_Sapi',     'lat': -7.263884, 'lon': 112.742308, 'demand': 1, 'tw': (0, 28800)}      # Bebas
]

# Helper untuk memformat data nodes agar kompatibel dengan kode lama
nodes_dict = {d['id']: (d['lat'], d['lon']) for d in nodes_data}

# ================= 2. FUNGSI CUACA =================
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

# ================= 3. FUNGSI OSRM (DOCKER) =================
def get_osm_route_local(lat1, lon1, lat2, lon2):
    url = f"{OSRM_URL}/route/v1/driving/{lon1},{lat1};{lon2},{lat2}?overview=false"
    try:
        r = requests.get(url, timeout=0.5) 
        if r.status_code == 200:
            d = r.json()['routes'][0]
            return d['distance'], d['duration']
        return 0, 0
    except: return 0, 0

# ================= 4. GENERATE MATRIX (AI PREDICTION) =================
def generate_hybrid_matrix(model, nodes_data, hour, day, is_rain):
    num_nodes = len(nodes_data)
    time_matrix = np.zeros((num_nodes, num_nodes), dtype=int)
    
    print(f"\n🚀 Membangun Matrix Waktu Tempuh (AI + Capacity + TimeWindows)...")
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

# ================= 5. SOLVER VRP (COMPLEX CONSTRAINTS) =================
def solve_vrp_complex(time_matrix, nodes_data):
    # Setup Data untuk OR-Tools
    data = {}
    data['time_matrix'] = time_matrix
    data['demands'] = [n['demand'] for n in nodes_data] # List Paket per toko
    data['time_windows'] = [n['tw'] for n in nodes_data] # List Jam Buka
    data['vehicle_capacities'] = [VEHICLE_CAPACITY] * NUM_VEHICLES
    data['num_vehicles'] = NUM_VEHICLES
    data['depot'] = 0

    manager = pywrapcp.RoutingIndexManager(len(time_matrix), NUM_VEHICLES, 0)
    routing = pywrapcp.RoutingModel(manager)

    # --- A. CALLBACK WAKTU (TRAVEL + SERVICE TIME) ---
    def time_callback(from_index, to_index):
        from_node = manager.IndexToNode(from_index)
        to_node = manager.IndexToNode(to_index)
        travel_time = int(data['time_matrix'][from_node][to_node])
        # Tambah waktu bongkar muat jika sampai di Customer (Bukan Depot)
        if to_node != 0:
            return travel_time + SERVICE_TIME_SEC
        return travel_time

    transit_callback_index = routing.RegisterTransitCallback(time_callback)
    routing.SetArcCostEvaluatorOfAllVehicles(transit_callback_index)

    # --- B. CALLBACK KAPASITAS (DEMAND) ---
    def demand_callback(from_index):
        from_node = manager.IndexToNode(from_index)
        return data['demands'][from_node]

    demand_callback_index = routing.RegisterUnaryTransitCallback(demand_callback)
    
    # --- C. CONSTRAINT KAPASITAS ---
    routing.AddDimensionWithVehicleCapacity(
        demand_callback_index,
        0,  # null capacity slack
        data['vehicle_capacities'], # Array kapasitas [15, 15]
        True, # start cumul to zero
        'Capacity')

    # --- D. CONSTRAINT TIME WINDOW ---
    routing.AddDimension(
        transit_callback_index,
        36000,  # Max Waiting Time (Boleh nunggu lama kalau kepagian)
        86400,  # Max Total Time (24 Jam)
        False,  # Force start cumul to zero (False biar bisa nunggu)
        'Time')
    
    time_dimension = routing.GetDimensionOrDie('Time')
    
    # Loop untuk set Jam Buka - Tutup tiap Toko
    for location_idx, (start, end) in enumerate(data['time_windows']):
        index = manager.NodeToIndex(location_idx)
        time_dimension.CumulVar(index).SetRange(start, end)

    # --- E. PRIORITAS & FAIRNESS ---
    # Paksa Kurir 1 jalan dulu (Gratis), Kurir 2 Denda (Cadangan)
    routing.SetFixedCostOfVehicle(0, 0)
    routing.SetFixedCostOfVehicle(10000, 1)

    # Setting Algoritma
    search_parameters = pywrapcp.DefaultRoutingSearchParameters()
    search_parameters.first_solution_strategy = (
        routing_enums_pb2.FirstSolutionStrategy.PATH_CHEAPEST_ARC)
    
    # SOLVE!
    solution = routing.SolveWithParameters(search_parameters)

    # --- PRINT HASIL ---
    if solution:
        print(f"\n{'='*35} HASIL OPTIMASI KOMPLEKS {'='*35}")
        print(f"🎯 Total Waktu Travel + Service: {solution.ObjectiveValue()} detik")
        
        # Konversi detik ke Jam Asli (Mulai jam 08:00)
        base_time = datetime.now().replace(hour=SHIFT_START_HOUR, minute=0, second=0, microsecond=0)

        for vehicle_id in range(NUM_VEHICLES):
            index = routing.Start(vehicle_id)
            plan_output = f'\n🚚 KURIR {vehicle_id + 1} (Kap: {VEHICLE_CAPACITY}):\n'
            route_load = 0
            
            while not routing.IsEnd(index):
                node_index = manager.IndexToNode(index)
                load = data['demands'][node_index]
                route_load += load
                
                # Ambil waktu tiba
                time_var = solution.Value(time_dimension.CumulVar(index))
                arrival_time = base_time + timedelta(seconds=time_var)
                arrival_str = arrival_time.strftime("%H:%M")

                # Nama Node & Info
                node_name = nodes_data[node_index]['id']
                tw_start = base_time + timedelta(seconds=data['time_windows'][node_index][0])
                tw_end = base_time + timedelta(seconds=data['time_windows'][node_index][1])
                tw_str = f"[{tw_start.strftime('%H:%M')}-{tw_end.strftime('%H:%M')}]"
                
                plan_output += f'   📍 {node_name}\n'
                plan_output += f'      📦 Muat: {load} pkt | 🕒 Tiba: {arrival_str} (Jadwal: {tw_str})\n'
                plan_output += '      ↓\n'
                
                index = solution.Value(routing.NextVar(index))
            
            # End Node
            node_index = manager.IndexToNode(index)
            time_var = solution.Value(time_dimension.CumulVar(index))
            finish_time = base_time + timedelta(seconds=time_var)
            
            plan_output += f'   🏁 KEMBALI KE DEPOT (Selesai: {finish_time.strftime("%H:%M")})\n'
            plan_output += f'   📊 Total Muatan: {route_load}/{VEHICLE_CAPACITY} Paket'
            print(plan_output)
    else:
        print("❌ Solusi tidak ditemukan! Cek Constraint Time Window mungkin terlalu ketat.")

# ================= MAIN =================
if __name__ == "__main__":
    print("\n--- SISTEM VRP PRO (CAPACITY + TIME WINDOWS) ---")
    
    try:
        if "PASTE_RUN_ID" in MODEL_PATH:
            print("❌ ERROR: Isi MODEL_PATH dulu!")
            exit()
        model = mlflow.xgboost.load_model(MODEL_PATH)
    except:
        print("❌ Gagal load model.")
        exit()

    # Input Waktu
    print(f"🕒 Shift dimulai pukul: {SHIFT_START_HOUR}:00")
    h = int(input("Prediksi untuk jam berapa (0-23, saran: 8-10): "))
    d = 0 # Senin
    
    # Cuaca & Solve
    is_rain, _ = get_realtime_weather(nodes_data[0]['lat'], nodes_data[0]['lon'])
    
    try:
        matrix = generate_hybrid_matrix(model, nodes_data, h, d, is_rain)
        solve_vrp_complex(matrix, nodes_data)
    except Exception as e:
        print(f"Error: {e}")