import googlemaps
import pandas as pd
import time
import schedule
from datetime import datetime
import os
import sys
from dotenv import load_dotenv # <--- Library keamanan

# Load isi brankas (.env)
load_dotenv()

# ================= 1. KONFIGURASI =================
# Ambil kunci dari environment variable
API_KEY = os.getenv('GOOGLE_MAPS_API_KEY')
FILENAME = 'dataset_kemacetan_tegalsari_final.csv'

# Cek apakah kunci ketemu?
if not API_KEY:
    print("❌ ERROR: API Key tidak ditemukan!")
    print("Pastikan file .env sudah dibuat dan berisi GOOGLE_MAPS_API_KEY=...")
    sys.exit()

# Inisialisasi Google Maps
try:
    gmaps = googlemaps.Client(key=API_KEY)
except ValueError:
    print("❌ Error: Format API Key salah.")
    sys.exit()

# Batas Aman Harian
MAX_REQUESTS_PER_DAY = 25 
request_counter = 0

# ================= 2. DAFTAR NODE (TEGALSARI) =================
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

# ================= 3. FUNGSI UTAMA =================
def fetch_traffic_data():
    global request_counter
    
    if request_counter >= MAX_REQUESTS_PER_DAY:
        print(f"\n[LIMIT REACHED] Sudah {request_counter}x request. Stop dulu.")
        sys.exit()

    print(f"\n[SYSTEM] Request ke-{request_counter + 1} pada: {datetime.now()}")
    
    locations_coords = [f"{lat},{lng}" for lat, lng in nodes.values()]
    node_keys = list(nodes.keys())
    node_values = list(nodes.values())
    
    try:
        matrix = gmaps.distance_matrix(
            origins=locations_coords,
            destinations=locations_coords,
            mode="driving",
            departure_time=datetime.now(),
            traffic_model="best_guess"
        )
        
        data_rows = []
        for i, origin_name in enumerate(node_keys):
            for j, dest_name in enumerate(node_keys):
                if i == j: continue 
                
                element = matrix['rows'][i]['elements'][j]
                if element['status'] == 'OK':
                    orig_lat, orig_lng = node_values[i]
                    dest_lat, dest_lng = node_values[j]
                    
                    data_rows.append({
                        'timestamp': datetime.now().strftime('%Y-%m-%d %H:%M:%S'),
                        'day_of_week': datetime.now().strftime('%A'),
                        'hour_of_day': datetime.now().hour,
                        'origin_name': origin_name,
                        'dest_name': dest_name,
                        'origin_lat': orig_lat,
                        'origin_lng': orig_lng,
                        'dest_lat': dest_lat,
                        'dest_lng': dest_lng,
                        'distance_meters': element['distance']['value'],
                        'duration_normal_sec': element['duration']['value'],
                        'duration_in_traffic_sec': element['duration_in_traffic']['value']
                    })
        
        df = pd.DataFrame(data_rows)
        file_exists = os.path.exists(FILENAME)
        df.to_csv(FILENAME, mode='a', header=not file_exists, index=False)
        
        request_counter += 1
        print(f"✅ SUKSES! Data tersimpan. Total: {request_counter}/{MAX_REQUESTS_PER_DAY}")
        
    except Exception as e:
        print(f"❌ ERROR: {e}")

# ================= 4. JADWAL =================
def scheduled_job():
    h = datetime.now().hour
    if 7 <= h <= 19:
        fetch_traffic_data()
    else:
        print(f"[SLEEP] Jam {h}:00. Menunggu pagi...")

if __name__ == "__main__":
    print("🛡️ SECURE HARVESTER AKTIF (Environment: venv)")
    print("Tekan CTRL+C untuk berhenti.\n")
    
    # Tes awal
    fetch_traffic_data()
    
    schedule.every(30).minutes.do(scheduled_job)
    
    while True:
        schedule.run_pending()
        time.sleep(1)