import pandas as pd
import xgboost as xgb
import mlflow.xgboost
from ortools.constraint_solver import routing_enums_pb2
from ortools.constraint_solver import pywrapcp
import numpy as np
import requests
import json
import time
from datetime import datetime
import os
from dotenv import load_dotenv

# ================= 1. KONFIGURASI SISTEM =================

# Load API Key dari file .env
load_dotenv()
OWM_API_KEY = os.getenv("OPENWEATHER_API_KEY")

# ⚠️ PENTING: GANTI INI DENGAN RUN ID DARI MLFLOW KAMU
# Contoh: "runs:/8362a7b8c.../model_vrp_tegalsari_gpu"
MODEL_PATH = "runs:/4dd9685008c941b1b7b769d5a15e9bf0/model_vrp_tegalsari_gpu"

# Konfigurasi Server Peta (Docker)
OSRM_URL = "http://localhost:5000"

# Konfigurasi Logistik
NUM_VEHICLES = 2           # Jumlah Kurir
DEPOT_INDEX = 0            # Titik Awal (Node 0)
MAX_TRIP_TIME = 28800      # Maksimal kerja 8 Jam (28800 detik)

# Daftar Koordinat Titik Pengiriman (Tegalsari, Surabaya)
nodes = {
    '0_Depot_JNE_Kedungdoro': (-7.265232, 112.736966),
    '1_TP_TunjunganPlaza': (-7.262608, 112.742352),
    '2_Hotel_Majapahit': (-7.260656, 112.738876),
    '3_Pasar_Kembang': (-7.269480, 112.730594),
    '4_Siola_MallPelayanan': (-7.256426, 112.736236),
    '5_SMA_Trimurti': (-7.271378, 112.743125),
    '6_Gramedia_Basra': (-7.266857, 112.742223),
    '7_Rawon_Setan': (-7.261884, 112.739778),
    '8_Pandegiling_Residential': (-7.273641, 112.733470),
    '9_Patung_KarapanSapi': (-7.263884, 112.742308)
}

# ================= 2. FUNGSI CUACA (REAL-TIME) =================
def get_realtime_weather(lat, lon):
    """
    Mengambil data cuaca langsung dari OpenWeatherMap.
    """
    if not OWM_API_KEY:
        print("⚠️ API Key Cuaca tidak ditemukan. Menganggap cuaca Cerah (0).")
        return 0, "No Key"

    url = f"https://api.openweathermap.org/data/2.5/weather?lat={lat}&lon={lon}&appid={OWM_API_KEY}&units=metric"
    
    print(f"☁️ Mengecek cuaca di lokasi ({lat}, {lon})...")
    
    try:
        response = requests.get(url, timeout=5)
        if response.status_code == 200:
            data = response.json()
            weather_main = data['weather'][0]['main']
            desc = data['weather'][0]['description']
            temp = data['main']['temp']
            
            # Logika: Jika hujan, set is_rain = 1
            rain_conditions = ['Rain', 'Drizzle', 'Thunderstorm']
            is_rain = 1 if weather_main in rain_conditions else 0
            
            print(f"   🌡️ Suhu: {temp}°C | Kondisi: {weather_main} ({desc})")
            print(f"   ☔ Status Hujan (Input AI): {is_rain}")
            return is_rain, weather_main
        else:
            print(f"⚠️ Gagal ambil cuaca: {response.status_code}")
            return 0, "Unknown"
    except Exception as e:
        print(f"⚠️ Error Koneksi Cuaca: {e}")
        return 0, "Error"

# ================= 3. FUNGSI OSRM (DOCKER LOKAL) =================
def get_osm_route_local(lat1, lon1, lat2, lon2):
    """
    Mengambil Jarak & Waktu Normal dari Server Docker (Offline).
    """
    # URL ke localhost:5000
    url = f"{OSRM_URL}/route/v1/driving/{lon1},{lat1};{lon2},{lat2}?overview=false"
    
    try:
        # Timeout super cepat karena lokal
        r = requests.get(url, timeout=0.5) 
        if r.status_code == 200:
            data = r.json()
            route = data['routes'][0]
            dist = route['distance']
            dur = route['duration']
            return dist, dur
        return None, None
    except Exception:
        return None, None

# ================= 4. GENERATE PREDIKSI MATRIX (FIXED INTEGER) =================
def generate_hybrid_matrix(model, node_list, hour, day_code, is_rain):
    num_nodes = len(node_list)
    node_names = list(node_list.keys())
    node_coords = list(node_list.values())
    
    # PERBAIKAN 1: Tambah dtype=int agar Matrix isinya Angka Bulat Murni
    time_matrix = np.zeros((num_nodes, num_nodes), dtype=int)
    
    print(f"\n🚀 Membangun Matrix Waktu Tempuh (Hybrid AI)...")
    
    predict_payload = []
    matrix_indices = [] 

    # Loop Data OSRM
    for i in range(num_nodes):
        for j in range(num_nodes):
            if i == j: continue 
            
            lat1, lon1 = node_coords[i]
            lat2, lon2 = node_coords[j]
            
            # Panggil Docker
            dist, dur_normal = get_osm_route_local(lat1, lon1, lat2, lon2)
            if dist is None: dist, dur_normal = 0, 0
            
            row = {
                'origin_lat': lat1, 'origin_lng': lon1,
                'dest_lat': lat2, 'dest_lng': lon2,
                'distance_meters': dist,
                'duration_normal_sec': dur_normal,
                'hour_of_day': hour,
                'day_code': day_code,
                'is_rain': is_rain
            }
            predict_payload.append(row)
            matrix_indices.append((i, j))

    # Prediksi AI
    if predict_payload:
        df_pred = pd.DataFrame(predict_payload)
        
        # Kolom wajib sama
        cols = ['origin_lat', 'origin_lng', 'dest_lat', 'dest_lng',
                'distance_meters', 'duration_normal_sec', 
                'hour_of_day', 'day_code', 'is_rain']
        df_pred = df_pred[cols]
        
        predicted_durations = model.predict(df_pred)
        
        # DEBUG: Intip sedikit hasil AI biar tenang
        print(f"   👀 Contoh Prediksi AI: {predicted_durations[:3]} (Detik)")

        # Isi Matrix
        for idx, (r, c) in enumerate(matrix_indices):
            # PERBAIKAN 2: Pastikan masuk sebagai Integer
            val = int(round(predicted_durations[idx])) 
            time_matrix[r][c] = max(0, val)
            
    return time_matrix, node_names

# ================= 5. SOLVER VRP (FIXED CALLBACK) =================
def solve_vrp(time_matrix, node_names):
    # Print Matrix pojok kiri atas untuk memastikan isinya BUKAN 0
    print("\n   🔍 Cek Matrix Sebelum Masuk VRP (Harusnya ada angka ratusan):")
    print(time_matrix[:3, :3]) 

    data = {}
    data['time_matrix'] = time_matrix
    data['num_vehicles'] = NUM_VEHICLES
    data['depot'] = DEPOT_INDEX
    
    manager = pywrapcp.RoutingIndexManager(len(time_matrix), data['num_vehicles'], data['depot'])
    routing = pywrapcp.RoutingModel(manager)

    def time_callback(from_index, to_index):
        from_node = manager.IndexToNode(from_index)
        to_node = manager.IndexToNode(to_index)
        # PERBAIKAN 3: Paksa return int() di sini juga
        return int(data['time_matrix'][from_node][to_node])

    transit_callback_index = routing.RegisterTransitCallback(time_callback)
    routing.SetArcCostEvaluatorOfAllVehicles(transit_callback_index)
    
    # Dimensi Waktu
    routing.AddDimension(
        transit_callback_index,
        300,  # Slack
        MAX_TRIP_TIME, 
        True, 
        'Time')

    search_parameters = pywrapcp.DefaultRoutingSearchParameters()
    search_parameters.first_solution_strategy = (
        routing_enums_pb2.FirstSolutionStrategy.PATH_CHEAPEST_ARC)

    solution = routing.SolveWithParameters(search_parameters)

    if solution:
        print(f"\n{'='*30} HASIL OPTIMASI RUTE {'='*30}")
        print(f"🎯 Total Waktu Armada: {solution.ObjectiveValue()} detik")
        
        for vehicle_id in range(data['num_vehicles']):
            index = routing.Start(vehicle_id)
            plan_output = f'\n🚚 KURIR {vehicle_id + 1}:\n'
            route_time = 0
            
            while not routing.IsEnd(index):
                node_index = manager.IndexToNode(index)
                time_var = solution.Value(routing.GetDimensionOrDie('Time').CumulVar(index))
                
                # Format menit
                menit_tiba = time_var // 60
                
                plan_output += f'   📍 {node_names[node_index]} (Tiba: {menit_tiba} mnt)\n'
                plan_output += '      ↓\n'
                
                previous_index = index
                index = solution.Value(routing.NextVar(index))
                route_time += routing.GetArcCostForVehicle(previous_index, index, vehicle_id)
            
            node_index = manager.IndexToNode(index)
            time_var = solution.Value(routing.GetDimensionOrDie('Time').CumulVar(index))
            plan_output += f'   🏁 {node_names[node_index]} (Selesai: {time_var//60} mnt)'
            
            print(plan_output)
            print(f"   ⏱️ Durasi Kerja: {route_time/60:.1f} menit")
    else:
        print("❌ Solusi tidak ditemukan!")

# ================= MAIN EXECUTION =================
if __name__ == "__main__":
    print("\n--- SISTEM VRP HYBRID (AI + DOCKER + WEATHER) ---")
    
    # 1. Load Model (Pastikan path benar!)
    try:
        # Cek apakah user sudah ganti path
        if "PASTE_RUN_ID" in MODEL_PATH:
            print("❌ ERROR: Harap isi MODEL_PATH di baris 17 dengan Run ID MLflow yang benar!")
            exit()
            
        print("📂 Sedang memuat model AI...")
        model = mlflow.xgboost.load_model(MODEL_PATH)
        print("✅ Model berhasil dimuat.")
    except Exception as e:
        print(f"❌ Gagal load model: {e}")
        exit()

    # 2. Input Waktu
    now = datetime.now()
    print(f"\n🕒 Waktu Sistem: {now.strftime('%A, %H:%M')}")
    use_manual = input("Gunakan waktu sistem sekarang? (y/n): ").lower()
    
    if use_manual == 'n':
        h = int(input("Jam Berapa? (0-23): "))
        d = int(input("Kode Hari (0=Senin, 6=Minggu): "))
    else:
        h = now.hour
        d = now.weekday()

    # 3. Cek Cuaca
    lat_depot, lon_depot = nodes['0_Depot_JNE_Kedungdoro']
    is_rain, _ = get_realtime_weather(lat_depot, lon_depot)

    # 4. Eksekusi Utama
    try:
        time_matrix, names = generate_hybrid_matrix(model, nodes, h, d, is_rain)
        solve_vrp(time_matrix, names)
    except Exception as e:
        print(f"\n❌ Terjadi kesalahan saat runtime: {e}")
        print("Tip: Pastikan Docker OSRM sudah jalan (docker ps).")