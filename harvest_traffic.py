import googlemaps
import pandas as pd
import time
import schedule
import requests 
from datetime import datetime
import os
import sys
from dotenv import load_dotenv

# Load kunci dari brankas .env
load_dotenv()

# ================= 1. KONFIGURASI =================
GMAPS_KEY = os.getenv('GOOGLE_MAPS_API_KEY')
WEATHER_KEY = os.getenv('OPENWEATHER_API_KEY') 
FILENAME = 'dataset_kemacetan_tegalsari_final.csv'

# Cek Kelengkapan Kunci
if not GMAPS_KEY or not WEATHER_KEY:
    print("❌ ERROR: API Key tidak lengkap!")
    print("Pastikan GOOGLE_MAPS_API_KEY dan OPENWEATHER_API_KEY ada di file .env")
    sys.exit()

# Inisialisasi Google Maps
try:
    gmaps = googlemaps.Client(key=GMAPS_KEY)
except ValueError:
    print("❌ Error: Format API Key Google salah.")
    sys.exit()

MAX_REQUESTS_PER_DAY = 25 
request_counter = 0

# Titik Tengah Tegalsari (Untuk patokan cuaca satu kecamatan)
CENTER_LAT = -7.262608
CENTER_LON = 112.742352

# Daftar Node (Lokasi)
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

# ================= 2. FUNGSI AMBIL CUACA =================
def get_current_weather():
    try:
        # Tembak API OpenWeatherMap
        url = f"https://api.openweathermap.org/data/2.5/weather?lat={CENTER_LAT}&lon={CENTER_LON}&appid={WEATHER_KEY}&units=metric"
        response = requests.get(url)
        data = response.json()
        
        if response.status_code == 200:
            return {
                'temp': data['main']['temp'],               # Suhu (Celcius)
                'weather_main': data['weather'][0]['main'],      # Rain/Clear/Clouds
                'weather_desc': data['weather'][0]['description'] # light rain/heavy intensity rain
            }
        elif response.status_code == 401:
            print("⚠️ API Key OpenWeather belum aktif. Tunggu 10-30 menit.")
            return {'temp': 0, 'weather_main': 'Pending', 'weather_desc': 'Pending'}
        else:
            print(f"⚠️ Weather API Error: {data}")
            return {'temp': 0, 'weather_main': 'Unknown', 'weather_desc': 'Unknown'}
    except Exception as e:
        print(f"⚠️ Gagal koneksi ke OpenWeather: {e}")
        return {'temp': 0, 'weather_main': 'Error', 'weather_desc': 'Error'}

# ================= 3. FUNGSI UTAMA (TRAFFIC + CUACA) =================
def fetch_traffic_data():
    global request_counter
    
    # Cek kuota harian
    if request_counter >= MAX_REQUESTS_PER_DAY:
        print(f"\n[LIMIT REACHED] Sudah {request_counter}x request. Stop dulu.")
        sys.exit() 

    print(f"\n[SYSTEM] Request ke-{request_counter + 1} pada: {datetime.now()}")
    
    # A. Ambil Data Cuaca Dulu
    weather = get_current_weather()
    print(f"🌦️ Info Cuaca: {weather['weather_main']} ({weather['weather_desc']}) | Suhu: {weather['temp']}°C")
    
    # B. Siapkan Koordinat untuk Google Maps
    locations_coords = [f"{lat},{lng}" for lat, lng in nodes.values()]
    node_keys = list(nodes.keys())
    node_values = list(nodes.values())
    
    try:
        # C. Tembak API Google Maps
        matrix = gmaps.distance_matrix(
            origins=locations_coords,
            destinations=locations_coords,
            mode="driving",
            departure_time=datetime.now(),
            traffic_model="best_guess"
        )
        
        # D. Bongkar Hasil (Parsing)
        data_rows = []
        for i, origin_name in enumerate(node_keys):
            for j, dest_name in enumerate(node_keys):
                if i == j: continue 
                
                element = matrix['rows'][i]['elements'][j]
                if element['status'] == 'OK':
                    orig_lat, orig_lng = node_values[i]
                    dest_lat, dest_lng = node_values[j]
                    
                    data_rows.append({
                        # Waktu
                        'timestamp': datetime.now().strftime('%Y-%m-%d %H:%M:%S'),
                        'day_of_week': datetime.now().strftime('%A'),
                        'hour_of_day': datetime.now().hour,
                        
                        # Rute
                        'origin_name': origin_name,
                        'dest_name': dest_name,
                        
                        # Data Cuaca (PENTING!)
                        'weather_main': weather['weather_main'], 
                        'weather_desc': weather['weather_desc'], 
                        'temp_celsius': weather['temp'],
                        
                        # Koordinat
                        'origin_lat': orig_lat,
                        'origin_lng': orig_lng,
                        'dest_lat': dest_lat,
                        'dest_lng': dest_lng,
                        
                        # Data Macet
                        'distance_meters': element['distance']['value'],
                        'duration_normal_sec': element['duration']['value'],
                        'duration_in_traffic_sec': element['duration_in_traffic']['value']
                    })
        
        # E. Simpan ke CSV
        df = pd.DataFrame(data_rows)
        file_exists = os.path.exists(FILENAME)
        
        # Mode 'a' = Append (Nambah di bawah)
        df.to_csv(FILENAME, mode='a', header=not file_exists, index=False)
        
        request_counter += 1
        print(f"✅ SUKSES! Data Traffic & Cuaca tersimpan.")
        
    except Exception as e:
        print(f"❌ ERROR Google Maps: {e}")

# ================= 4. JADWAL (SCHEDULER) =================
def scheduled_job():
    h = datetime.now().hour
    # Hanya jalan jam 07.00 sampai 19.00
    if 7 <= h <= 19:
        fetch_traffic_data()
    else:
        print(f"[SLEEP] Jam {h}:00. Di luar jam kerja (07-19). Menunggu...")

if __name__ == "__main__":
    print("==============================================")
    print("🛡️  TRAFFIC + WEATHER HARVESTER (TEGALSARI)  🛡️")
    print("==============================================")
    print("Tekan CTRL+C untuk berhenti.\n")
    
    # 1. Tes Awal (Sekali jalan pas dinyalakan)
    fetch_traffic_data()
    
    # 2. Jadwal Rutin (Tiap 30 menit)
    schedule.every(30).minutes.do(scheduled_job)
    
    while True:
        schedule.run_pending()
        time.sleep(1)