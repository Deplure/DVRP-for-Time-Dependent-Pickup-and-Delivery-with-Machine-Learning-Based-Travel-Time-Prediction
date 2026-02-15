import pandas as pd
import xgboost as xgb
import mlflow
import mlflow.xgboost
from sklearn.model_selection import train_test_split
from sklearn.metrics import mean_squared_error, mean_absolute_error
from sklearn.preprocessing import LabelEncoder
import os
import time

# ================= KONFIGURASI =================
FILENAME = 'dataset_kemacetan_tegalsari_final.csv'
EXPERIMENT_NAME = "Skripsi_VRP_Tegalsari_GPU"

def train_model():
    print("="*50)
    print("   TRAIN MODEL XGBOOST WITH NVIDIA CUDA (GPU)   ")
    print("="*50)

    # 1. Cek Data
    if not os.path.exists(FILENAME):
        print("[ERROR] File data CSV belum ditemukan!")
        return

    print("[INFO] Loading data...")
    try:
        df = pd.read_csv(FILENAME)
    except Exception as e:
        print(f"[ERROR] Gagal membaca CSV: {e}")
        return
    
    # Hapus baris yang kosong/error
    df = df.dropna()
    
    if len(df) < 10:
        print(f"[WARNING] Data terlalu sedikit ({len(df)}). Tunggu harvesting berjalan lagi.")
        return 

    print(f"[INFO] Total Data Bersih: {len(df)} baris")

    # ================= 2. FEATURE ENGINEERING =================
    
    # A. Fitur Hujan (1/0)
    condition_rain = df['weather_main'].isin(['Rain', 'Drizzle', 'Thunderstorm'])
    df['is_rain'] = condition_rain.astype(int)
    
    # B. Encoding Hari
    le = LabelEncoder()
    df['day_code'] = le.fit_transform(df['day_of_week'])

    # C. Fitur & Target
    features = [
        'origin_lat', 'origin_lng',
        'dest_lat', 'dest_lng',
        'distance_meters',
        'duration_normal_sec',
        'hour_of_day',
        'day_code',
        'is_rain'
    ]
    
    target = 'duration_in_traffic_sec'

    X = df[features]
    y = df[target]

    # Split Data
    X_train, X_test, y_train, y_test = train_test_split(X, y, test_size=0.2, random_state=42)

    # ================= 3. TRAINING DENGAN CUDA (GPU) =================
    mlflow.set_experiment(EXPERIMENT_NAME)

    with mlflow.start_run():
        print("\n[INFO] Memulai Training di GPU (NVIDIA)...")
        start_time = time.time()
        
        # --- KONFIGURASI GPU ---
        params = {
            "objective": "reg:squarederror",
            "n_estimators": 1000,
            "learning_rate": 0.02,
            "max_depth": 8,
            "subsample": 0.8,
            "colsample_bytree": 0.8,
            
            # --- SETTING CUDA (GPU) ---
            "device": "cuda",
            "tree_method": "hist",
        }
        
        # Inisialisasi Model
        model = xgb.XGBRegressor(**params)
        
        # Proses Training (Fitting)
        model.fit(X_train, y_train)
        
        duration = time.time() - start_time
        print(f"[INFO] Training Selesai dalam {duration:.2f} detik!")
        
        # --- EVALUASI ---
        pred_train = model.predict(X_train)
        pred_test = model.predict(X_test)
        
        rmse_train = mean_squared_error(y_train, pred_train) ** 0.5
        rmse_test = mean_squared_error(y_test, pred_test) ** 0.5
        mae_test = mean_absolute_error(y_test, pred_test)
        
        print("-" * 35)
        print(f"HASIL TRAINING (GPU POWERED):")
        print(f"   Train RMSE : {rmse_train:.2f} detik")
        print(f"   Test RMSE  : {rmse_test:.2f} detik")
        print(f"   Test MAE   : {mae_test:.2f} detik")
        print("-" * 35)

        # LOGGING MLFLOW
        mlflow.log_params(params)
        mlflow.log_param("hardware", "GPU NVIDIA")
        mlflow.log_metric("rmse_test", rmse_test)
        mlflow.log_metric("training_time", duration)
        
        # Simpan Model (Perbaikan Warning 'artifact_path')
        mlflow.xgboost.log_model(xgb_model=model, artifact_path="model_vrp_tegalsari_gpu")
        
        print("\n[INFO] Model tersimpan di MLflow (Versi GPU).")

if __name__ == "__main__":
    train_model()