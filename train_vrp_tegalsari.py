import pandas as pd
import xgboost as xgb
import mlflow
import mlflow.xgboost
from sklearn.model_selection import train_test_split
from sklearn.metrics import mean_absolute_error

# ==============================================================================
# 1. KONFIGURASI FILE & KOLOM
# ==============================================================================
NAMA_FILE_CSV = 'dataset_kemacetan_tegalsari_final.csv'

# Kolom Koordinat (Ini kuncinya!)
COL_ORIGIN_LAT  = 'origin_lat'
COL_ORIGIN_LNG  = 'origin_lng'
COL_DEST_LAT    = 'dest_lat'
COL_DEST_LNG    = 'dest_lng'

# Kolom Lainnya
COL_TIMESTAMP   = 'timestamp'
COL_WEATHER     = 'weather_main'          
COL_DISTANCE    = 'distance_meters'
COL_BASE_DUR    = 'duration_normal_sec'   
COL_TARGET      = 'duration_in_traffic_sec' 

# ==============================================================================
# 2. PREPROCESSING (Hapus Node ID, Pakai Lat/Lon)
# ==============================================================================
print(f"📂 Membaca file: {NAMA_FILE_CSV}...")
try:
    df = pd.read_csv(NAMA_FILE_CSV)
except FileNotFoundError:
    print("❌ File tidak ditemukan."); exit()

def preprocess_coordinate_data(df):
    df = df.copy()
    
    # A. Parsing Waktu
    df[COL_TIMESTAMP] = pd.to_datetime(df[COL_TIMESTAMP])
    df['hour'] = df[COL_TIMESTAMP].dt.hour
    df['day_of_week'] = df[COL_TIMESTAMP].dt.dayofweek
    
    # B. Filter Jam Operasional (07.00 - 20.00)
    df = df[(df['hour'] >= 7) & (df['hour'] <= 20)]
    
    # C. Logika Hujan
    df['is_rain'] = df[COL_WEATHER].apply(lambda x: 1 if 'rain' in str(x).lower() else 0)
    
    # D. Pastikan Semua Angka Aman
    cols_to_numeric = [COL_BASE_DUR, COL_TARGET, 
                       COL_ORIGIN_LAT, COL_ORIGIN_LNG, 
                       COL_DEST_LAT, COL_DEST_LNG]
    
    for col in cols_to_numeric:
        df[col] = pd.to_numeric(df[col], errors='coerce')
        
    return df.dropna()

df_ready = preprocess_coordinate_data(df)
print(f"✅ Data siap (Mode Koordinat): {len(df_ready)} baris")

# ==============================================================================
# 3. SPLIT DATA (FITUR BARU: LAT/LON)
# ==============================================================================
# Perhatikan: Kita TIDAK LAGI pakai origin_id/dest_id
features = [
    COL_ORIGIN_LAT, COL_ORIGIN_LNG, # Koordinat Asal
    COL_DEST_LAT, COL_DEST_LNG,     # Koordinat Tujuan
    COL_DISTANCE,                   # Jarak (Meter)
    COL_BASE_DUR,                   # Durasi Normal (Detik)
    'hour', 
    'day_of_week', 
    'is_rain'
]

X = df_ready[features]
y = df_ready[COL_TARGET]

X_train, X_test, y_train, y_test = train_test_split(X, y, test_size=0.2, random_state=42)

# ==============================================================================
# 4. TRAINING (MLflow)
# ==============================================================================
mlflow.set_experiment("TA_VRP_Coordinate_Based") # Nama Eksperimen Baru

with mlflow.start_run(run_name="XGB_LatLon_Generalization"):
    mlflow.xgboost.autolog()
    
    # Model XGBoost (Tree-based sangat bagus membagi wilayah berdasarkan Lat/Lon)
    model = xgb.XGBRegressor(
        objective='reg:squarederror',
        n_estimators=300,
        learning_rate=0.05,
        max_depth=7,          # Sedikit lebih dalam agar bisa memetakan area
        subsample=0.8,
        early_stopping_rounds=20
    )
    
    print("🚀 Melatih model dengan input Koordinat...")
    model.fit(X_train, y_train, eval_set=[(X_test, y_test)], verbose=False)
    
    # Evaluasi
    preds = model.predict(X_test)
    mae = mean_absolute_error(y_test, preds)
    mlflow.log_metric("MAE_Test_Score", mae)
    
    print(f"✅ Training Selesai! MAE: {mae:.2f} detik")
    
    # Simpan Model
    mlflow.xgboost.log_model(model, "vrp_coordinate_model")

    # ==============================================================================
    # 5. ANALISIS ERROR & GEOSPATIAL CHECK
    # ==============================================================================
    results = X_test.copy()
    results['Actual'] = y_test
    results['Predicted'] = preds
    results['Abs_Error'] = (results['Actual'] - results['Predicted']).abs()
    
    # Urutkan Error Terbesar
    results_sorted = results.sort_values(by='Abs_Error', ascending=False)
    
    # Simpan
    results_sorted.to_csv("hasil_test_koordinat.csv", index=False)
    print("\n📊 Cek file 'hasil_test_koordinat.csv'.")
    print("   Lihat kolom Lat/Lng untuk tahu AREA mana yang paling susah ditebak.")