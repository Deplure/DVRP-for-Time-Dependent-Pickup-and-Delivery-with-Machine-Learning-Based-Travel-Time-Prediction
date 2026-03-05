import pandas as pd
import numpy as np
import mlflow.xgboost
import mlflow
import random

# ==============================================================================
# 1. DEFINISI BATAS AREA (BOUNDING BOX TEGALSARI)
# ==============================================================================
# Ini adalah koordinat 10 Node kamu (dari script harvest sebelumnya)
nodes = {
    '0': (-7.265232, 112.736966), '1': (-7.262608, 112.742352),
    '2': (-7.260656, 112.738876), '3': (-7.269480, 112.730594),
    '4': (-7.256426, 112.736236), '5': (-7.271378, 112.743125),
    '6': (-7.266857, 112.742223), '7': (-7.261884, 112.739778),
    '8': (-7.273641, 112.733470), '9': (-7.263884, 112.742308)
}

lats = [v[0] for v in nodes.values()]
lngs = [v[1] for v in nodes.values()]

# Batas Area (Agar testing kita valid & tidak melenceng ke Sidoarjo)
MIN_LAT, MAX_LAT = min(lats), max(lats)
MIN_LNG, MAX_LNG = min(lngs), max(lngs)

print(f"📍 AREA STUDI VALID (Tegalsari):")
print(f"   Lat: {MIN_LAT:.4f} s/d {MAX_LAT:.4f}")
print(f"   Lng: {MIN_LNG:.4f} s/d {MAX_LNG:.4f}")

# ==============================================================================
# 2. GENERATE SKENARIO ACAK (DI DALAM AREA)
# ==============================================================================
num_samples = 5 # Kita coba 5 orderan acak
scenarios = []

print("\n🎲 Meng-generate 5 titik orderan acak di dalam area...")

for i in range(num_samples):
    # Acak Koordinat di dalam Bounding Box
    lat_asal = random.uniform(MIN_LAT, MAX_LAT)
    lng_asal = random.uniform(MIN_LNG, MAX_LNG)
    lat_tuju = random.uniform(MIN_LAT, MAX_LAT)
    lng_tuju = random.uniform(MIN_LNG, MAX_LNG)
    
    # Acak Waktu (Jam 7 pagi - 8 malam)
    jam = random.randint(7, 20)
    hujan = random.choice([0, 1]) # 0=Cerah, 1=Hujan
    
    # Estimasi Jarak & Waktu Normal (Dummy logic karena kita gak panggil Gmaps API)
    # Anggaplah kecepatan rata-rata dalam kota 30 km/jam
    # Jarak Euclidean kasar x faktor jalan (1.4)
    jarak_deg = ((lat_asal-lat_tuju)**2 + (lng_asal-lng_tuju)**2)**0.5
    jarak_meter = jarak_deg * 111000 * 1.4 
    waktu_normal_sec = (jarak_meter / 8.33) # 8.33 m/s = 30 km/jam
    
    scenarios.append({
        'keterangan': f'Order Acak #{i+1}',
        'origin_lat': lat_asal, 'origin_lng': lng_asal,
        'dest_lat': lat_tuju,   'dest_lng': lng_tuju,
        'distance_meters': jarak_meter,
        'duration_normal_sec': waktu_normal_sec,
        'hour': jam,
        'day_of_week': 3, # Anggap Jumat (Hari Sibuk)
        'is_rain': hujan
    })

df_scenario = pd.DataFrame(scenarios)

# ==============================================================================
# 3. PREDIKSI DENGAN MODEL
# ==============================================================================
# Load Model Terakhir
experiment_name = "TA_VRP_Coordinate_Based" 
current_exp = mlflow.get_experiment_by_name(experiment_name)
runs = mlflow.search_runs([current_exp.experiment_id], order_by=["start_time DESC"], max_results=1)
run_id = runs.iloc[0].run_id
model_uri = f"runs:/{run_id}/vrp_coordinate_model"
loaded_model = mlflow.xgboost.load_model(model_uri)

# Prediksi
features = ['origin_lat', 'origin_lng', 'dest_lat', 'dest_lng',     
            'distance_meters', 'duration_normal_sec', 'hour', 'day_of_week', 'is_rain']

X_new = df_scenario[features]
preds = loaded_model.predict(X_new)

# ==============================================================================
# 4. HASIL (BUKTI GENERALISASI)
# ==============================================================================
print("\n" + "="*80)
print("HASIL PREDIKSI ORDERAN BARU (DALAM CAKUPAN AREA)")
print("="*80)

for i, row in df_scenario.iterrows():
    pred_sec = preds[i]
    norm_sec = row['duration_normal_sec']
    diff = pred_sec - norm_sec
    kondisi = "HUJAN" if row['is_rain'] else "CERAH"
    
    print(f"\n📦 {row['keterangan']} | Pukul {row['hour']}:00 | {kondisi}")
    print(f"   ► Rute: ({row['origin_lat']:.4f}, {row['origin_lng']:.4f}) -> ({row['dest_lat']:.4f}, {row['dest_lng']:.4f})")
    print(f"   ► Jarak Est.: {row['distance_meters']:.0f} m")
    print(f"   ► Waktu Normal: {norm_sec/60:.1f} menit")
    print(f"   ► PREDIKSI    : {pred_sec/60:.1f} menit")
    
    if diff > 60: # Kalau beda lebih dari 1 menit
        print(f"   🚦 STATUS: MACET (Melambat {diff:.0f} detik)")
    else:
        print(f"   ✅ STATUS: LANCAR")