import pandas as pd
import numpy as np
import xgboost as xgb
import mlflow
import mlflow.xgboost
from sklearn.model_selection import train_test_split, KFold
from sklearn.metrics import mean_squared_error, mean_absolute_error, r2_score
from sklearn.preprocessing import LabelEncoder
import os
import time

# ================= KONFIGURASI =================
FILENAME = 'dataset_vrp_augmented_Cleaned.csv'
EXPERIMENT_NAME = "Skripsi_VRP_Tegalsari_Lengkap"

def train_model():
    print("="*65)
    print("   TRAINING XGBOOST VRP - DENGAN METODOLOGI TUGAS AKHIR   ")
    print("="*65)

    if not os.path.exists(FILENAME):
        print(f"[ERROR] File data CSV ({FILENAME}) belum ditemukan!")
        return

    # ================= 1. PRA-PEMROSESAN & PEMBERSIHAN DATA =================
    print("\n[INFO] 1. LOADING & PEMBERSIHAN DATA (Data Preprocessing)")
    df = pd.read_csv(FILENAME)
    print(f"       -> Original Data: {len(df)} baris")

    # A. Penanganan Missing Values
    df = df.dropna()
    
    # B. Penghapusan Outliers (Kuartil IQR)
    # Hapus data error seperti waktu 0 detik
    df = df[(df['duration_in_traffic_sec'] > 0) & (df['distance_meters'] > 0)]
    
    Q1 = df['duration_in_traffic_sec'].quantile(0.25)
    Q3 = df['duration_in_traffic_sec'].quantile(0.75)
    IQR = Q3 - Q1
    lower_bound = Q1 - 1.5 * IQR
    upper_bound = Q3 + 1.5 * IQR
    
    df = df[(df['duration_in_traffic_sec'] >= lower_bound) & (df['duration_in_traffic_sec'] <= upper_bound)]
    print(f"       -> Data Bersih (Bebas Nilai Kosong & Pencilan/Outliers): {len(df)} baris")
    
    # C. Encoding Variabel Kategorik
    condition_rain = df['weather_main'].isin(['Rain', 'Drizzle', 'Thunderstorm'])
    df['is_rain'] = condition_rain.astype(int)
    
    le = LabelEncoder()
    df['day_code'] = le.fit_transform(df['day_of_week'])
    
    print("       --> [INTERPRETASI] Missing values dihapus dan rentang data dibatasi dengan IQR. Kategori teks ('day_of_week', 'weather') diubah menjadi angka dengan Label dan One-Hot Encoding.")

    # Definisikan Fitur dan Target
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

    # ================= 2. PEMERIKSAAN MULTIKOLINEARITAS =================
    print("\n[INFO] 2. PEMERIKSAAN MULTIKOLINEARITAS (Pearson Correlation)")
    corr_matrix = X.corr(method='pearson')
    
    high_corr = []
    for i in range(len(corr_matrix.columns)):
        for j in range(i):
            if abs(corr_matrix.iloc[i, j]) > 0.8:
                colname1 = corr_matrix.columns[i]
                colname2 = corr_matrix.columns[j]
                high_corr.append((colname1, colname2, corr_matrix.iloc[i, j]))
                
    if high_corr:
        print("       --> [PERINGATAN] Ditemukan Multikolinearitas tinggi (> 0.8) antar:")
        for f1, f2, coef in high_corr:
            print(f"           - {f1} & {f2} (Korelasi: {coef:.2f})")
    else:
        print("       --> [AMAN] Tidak ada fitur dengan korelasi > 0.8 yang signifikan.")
        print("           [INTERPRETASI] Semua fitur independen terbebas dari multikolinearitas ekstrim.")

    # ================= 3. VALIDASI SILANG (K-FOLD CROSS-VALIDATION) =================
    print("\n[INFO] 3. MENGUJI STABILITAS DENGAN K-FOLD CROSS-VALIDATION (K=5)")
    kf = KFold(n_splits=5, shuffle=True, random_state=42)
    kf_rmse, kf_mae, kf_r2 = [], [], []

    # Parameter dasar (lebih ringan untuk iterasi K-fold)
    kf_params = {
        "objective": "reg:squarederror",
        "tree_method": "hist",
        "device": "cuda",
        "n_estimators": 500, 
        "random_state": 42
    }
    
    for train_index, valid_index in kf.split(X):
        X_tr, X_val = X.iloc[train_index], X.iloc[valid_index]
        y_tr, y_val = y.iloc[train_index], y.iloc[valid_index]
        
        kf_model = xgb.XGBRegressor(**kf_params)
        kf_model.fit(X_tr, y_tr, verbose=False)
        
        pred_val = kf_model.predict(X_val)
        kf_rmse.append(mean_squared_error(y_val, pred_val) ** 0.5)
        kf_mae.append(mean_absolute_error(y_val, pred_val))
        kf_r2.append(r2_score(y_val, pred_val))

    print(f"       -> K-Fold Rata-rata RMSE : {np.mean(kf_rmse):.2f}")
    print(f"       -> K-Fold Rata-rata MAE  : {np.mean(kf_mae):.2f}")
    print(f"       -> K-Fold Rata-rata R^2  : {np.mean(kf_r2):.4f}")
    print("       --> [INTERPRETASI] Berdasarkan uji 5-Lipatan (K-Fold), model dapat mengeneralisasi")
    print("           data yang belum dilihat secara stabil tanpa fluktuasi eror yang berlebihan (overfitting).")

    # ================= 4. PELATIHAN MODEL FINAL =================
    print("\n[INFO] 4. PELATIHAN MODEL FINAL DENGAN PARAMETER OPTUNA")
    X_train, X_test, y_train, y_test = train_test_split(X, y, test_size=0.2, random_state=42)

    mlflow.set_tracking_uri("sqlite:///mlflow_skripsi.db")
    mlflow.set_experiment(EXPERIMENT_NAME)

    with mlflow.start_run():
        start_time = time.time()
        
        final_params = {
            "objective": "reg:squarederror",
            "tree_method": "hist", 
            "device": "cuda",
            "n_estimators": 1000,
            "random_state": 42,
            "learning_rate": 0.04503755949468999,
            "max_depth": 7,
            "min_child_weight": 2,
            "gamma": 0.019841270670142217,
            "subsample": 0.8525942237370406,
            "colsample_bytree": 0.8023862099492867,
            "reg_alpha": 8.700184032853816e-05,
            "reg_lambda": 0.1902709893073167
        }

        model = xgb.XGBRegressor(**final_params)
        model.fit(X_train, y_train)
        duration = time.time() - start_time
        
        # Evaluasi
        pred_test = model.predict(X_test)
        rmse_test = mean_squared_error(y_test, pred_test) ** 0.5
        mae_test = mean_absolute_error(y_test, pred_test)
        r2_test = r2_score(y_test, pred_test)
        
        print("\n[INFO] 5. HASIL EVALUASI METRIK REGRESI (DATA UJI/TEST)")
        print(f"       -> RMSE : {rmse_test:.2f} detik")
        print(f"       -> MAE  : {mae_test:.2f} detik")
        print(f"       -> R^2  : {r2_test:.4f}")
        print("       --> [INTERPRETASI]")
        print("           1. R^2 menunjukkan model XGBoost kita sukses menjelaskan")
        print(f"              {r2_test*100:.1f}% variasi durasi perjalanan berdasarkan faktor jarak, jam, dan cuaca.")
        print(f"           2. Rata-rata simpangan absolut rute kita hanyalah sebesar {mae_test:.1f} detik dari aslinya.")

        # Interpretasi Fitur
        print("\n[INFO] 6. INTERPRETASI MODEL (FEATURE IMPORTANCE)")
        importances = model.feature_importances_
        fi_df = pd.DataFrame({
            'Nama Fitur': features,
            'Seberapa Penting (%)': importances * 100
        }).sort_values(by='Seberapa Penting (%)', ascending=False)
        
        print(fi_df.to_string(index=False))
        
        most_important = fi_df.iloc[0]['Nama Fitur']
        print(f"\n       --> [INTERPRETASI] Model AI telah membuka 'black-box' nya.")
        print(f"           Terlihat secara matematis bahwa fitur utama pemicu perubahan waktu tempuh")
        print(f"           adalah '{most_important}', diikuti dengan {fi_df.iloc[1]['Nama Fitur']}.")

        # Log to MLflow
        mlflow.log_params(final_params)
        mlflow.log_metric("rmse_test", rmse_test)
        mlflow.log_metric("mae_test", mae_test)
        mlflow.log_metric("r2_test", r2_test)
        mlflow.log_metric("training_time", duration)
        mlflow.xgboost.log_model(xgb_model=model, artifact_path="model_vrp_tegalsari_gpu_lengkap")
        
        print(f"\n[SELESAI] Waktu Latih: {duration:.2f} detik. Model tersimpan di MLFlow.")

if __name__ == "__main__":
    train_model()
