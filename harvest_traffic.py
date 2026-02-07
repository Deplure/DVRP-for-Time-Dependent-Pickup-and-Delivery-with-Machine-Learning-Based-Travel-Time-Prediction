import googlemaps
import pandas as pd
import time
import schedule
import requests 
from datetime import datetime
import os
import sys
from dotenv import load_dotenv

# Load kunci dari file .env
load_dotenv()

# ================= 1. KONFIGURASI =================
GMAPS_KEY = os.getenv('GOOGLE_MAPS_API_KEY')
WEATHER_KEY = os.getenv('OPENWEATHER_API_KEY') 
FILENAME = 'dataset_kemacetan_tegalsari_final.csv'

# Cek Kunci
if not GMAPS_KEY or not WEATHER_KEY:
    print("❌ ERROR: API Key tidak lengkap di file .env!")
    sys.exit()

try:
    gmaps = googlemaps.Client(key=GMAPS_KEY)
except ValueError:
    print("❌ Error: Format API Key Google salah.")
    sys.exit()

MAX_REQUESTS_PER_DAY = 25 
request_counter = 0

# Titik Tengah Tegalsari (Untuk Cuaca)
CENTER_LAT = -7.262608
CENTER_LON = 112.742352

# DAFTAR NODE (HATI-HATI JANGAN KEHAPUS)
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
        url = f"https://api.openweathermap.org/data/2.5/weather?lat={CENTER_LAT}&lon={CENTER_LON}&appid={WEATHER_KEY}&units=metric"
        response = requests.get(url)
        
        if response.status_code == 200:
            data = response.json()
            return {
                'temp': data['main']['temp'],
                'weather_main': data['weather'][0]['main'],
                'weather_desc': data['weather'][0]['description']
            }
        elif response.status_code == 401:
            print("⚠️ API Key OpenWeather belum aktif. Tunggu sebentar.")
            return {'temp': 0, 'weather_main': 'Pending', 'weather_desc': 'Pending'}
        else:
            return {'temp': 0, 'weather_main': 'Unknown', 'weather_desc': 'Unknown'}
    except Exception as e:
        print(f"⚠️ Error Cuaca: {e}")
        return {'temp': 0, 'weather_main': 'Error', 'weather_desc': 'Error'}

# ================= 3. FUNGSI UTAMA =================
def fetch_traffic_data():
    global request_counter
    
    if request_counter >= MAX_REQUESTS_PER_DAY:
        print(f"\n[LIMIT] Sudah {request_counter}x request. Stop.")
        sys.exit() 

    print(f"\n[SYSTEM] Request ke-{request_counter + 1}...")
    
    # --- INI YANG TADI HILANG (VARIABLE WEATHER) ---
    weather = get_current_weather()
    print(f"🌦️ Cuaca: {weather['weather_main']} | Suhu: {weather['temp']}°C")
    
    # Siapkan Data Maps
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
                        # Data Cuaca Masuk Sini
                        'weather_main': weather['weather_main'], 
                        'weather_desc': weather['weather_desc'], 
                        'temp_celsius': weather['temp'],
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
        print(f"✅ SUKSES tersimpan!")
        
    except Exception as e:
        print(f"❌ ERROR: {e}")

# ================= 4. JADWAL =================
def scheduled_job():
    h = datetime.now().hour
    if 7 <= h <= 19:
        fetch_traffic_data()
    else:
        print(f"[SLEEP] Menunggu pagi...")

if __name__ == "__main__":
    print("🛡️ HARVESTER START")
    fetch_traffic_data()
    schedule.every(30).minutes.do(scheduled_job)
    while True:
        schedule.run_pending()
        time.sleep(1)