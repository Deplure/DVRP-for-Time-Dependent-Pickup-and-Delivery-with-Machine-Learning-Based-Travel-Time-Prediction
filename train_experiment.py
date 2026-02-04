import pandas as pd
import xgboost as xgb
import mlflow
import mlflow.xgboost
from sklearn.model_selection import train_test_split
from sklearn.metrics import mean_squared_error, mean_absolute_error
from sklearn.preprocessing import LabelEncoder
import os

# ================= KONFIGURASI =================
FILENAME = 'dataset_kemacetan_tegalsari_final.csv'
EXPERIMENT_NAME = "Skripsi_VRP_Tegalsari"

def train_model():
    # 1. Cek Data
    if not os.path.exists(FILENAME):
        print("❌ File data belum ada!")
        return

    print("Loading data...")
    try:
        df = pd.read_csv(FILENAME)
    except Exception as e:
        print(f"❌ Gagal baca CSV: {e}")
        return
    
    # Cek jumlah data (Safety)
    if len(df) < 5:
        print(f"⚠️ Data terlalu sedikit ({len(df)}). Coba lagi nanti.")
        return 
    
    print(f"📊 Total Data: {len(df)} baris")

    # ================= 2. PREPROCESSING =================
    features = ['origin_lat', 'origin_lng', 'dest_lat', 'dest_lng', 'distance_meters', 'hour_of_day']
    target = 'duration_in_traffic_sec'

    # Handle Cuaca (Jika nanti ada)
    if 'weather_main' in df.columns:
        print("ℹ️ Info: Kolom cuaca terdeteksi (tapi belum dipakai di training ini).")
    
    # Encoding Hari
    le = LabelEncoder()
    df['day_code'] = le.fit_transform(df['day_of_week'])
    features.append('day_code') 

    X = df[features]
    y = df[target]

    # Split Data
    try:
        X_train, X_test, y_train, y_test = train_test_split(X, y, test_size=0.2, random_state=42)
    except ValueError:
        X_train, X_test, y_train, y_test = X, X, y, y

    # ================= 3. MLFLOW TRACKING =================
    mlflow.set_experiment(EXPERIMENT_NAME)

    with mlflow.start_run():
        print("🚀 Memulai Training...")
        
        params = {
            "objective": "reg:squarederror",
            "n_estimators": 100,
            "learning_rate": 0.1,
            "max_depth": 6
        }
        
        model = xgb.XGBRegressor(**params)
        model.fit(X_train, y_train)
        
        # --- PERUBAHAN DISINI (HITUNG DUA-DUANYA) ---
        
        # 1. Prediksi ke Data Latihan (Buat cek hafalan)
        pred_train = model.predict(X_train)
        # 2. Prediksi ke Data Ujian (Buat cek kepintaran asli)
        pred_test = model.predict(X_test)
        
        # Hitung Error (RMSE) Manual
        rmse_train = mean_squared_error(y_train, pred_train) ** 0.5
        rmse_test = mean_squared_error(y_test, pred_test) ** 0.5
        
        print(f"✅ Training Selesai!")
        print(f"   📉 Train Loss (RMSE): {rmse_train:.2f}")
        print(f"   📉 Test Loss  (RMSE): {rmse_test:.2f}")

        # LOGGING KE MLFLOW
        mlflow.log_params(params)
        mlflow.log_param("data_size", len(df))
        
        # Simpan dua metrik terpisah
        mlflow.log_metric("rmse_train", rmse_train)
        mlflow.log_metric("rmse_test", rmse_test) # Ini yang paling penting
        
        mlflow.xgboost.log_model(model, "model_xgboost_v1")
        
        print("\n📝 Cek MLflow UI sekarang. Sudah ada Train vs Test.")

if __name__ == "__main__":
    train_model()