import pandas as pd
import numpy as np
import xgboost as xgb
import optuna
import mlflow
import mlflow.xgboost
from sklearn.model_selection import train_test_split
from sklearn.metrics import mean_absolute_error
from sklearn.preprocessing import LabelEncoder

# 1. Load Dataset Riil
df = pd.read_csv('dataset_vrp_augmented_Cleaned.csv')

# 2. Preprocessing: Encoding Kolom Kategori
categorical_cols = ['day_of_week', 'origin_name', 'dest_name', 'weather_main', 'weather_desc']
le = LabelEncoder()

for col in categorical_cols:
    df[col] = le.fit_transform(df[col].astype(str))

# 3. Pilih Fitur (X) dan Target (y)
# Kita sertakan koordinat, jarak, jam, dan cuaca
X = df[['day_of_week', 'hour_of_day', 'origin_lat', 'origin_lng', 
        'dest_lat', 'dest_lng', 'distance_meters', 'duration_normal_sec', 
        'temp_celsius', 'weather_main']]
y = df['duration_in_traffic_sec']

X_train, X_valid, y_train, y_valid = train_test_split(X, y, test_size=0.2, random_state=42)

# 4. Setup MLflow
mlflow.set_tracking_uri("sqlite:///mlflow_tuning_new.db")
mlflow.set_experiment("XGBoost_VRP_Tegalsari_Tuning")

def objective(trial):
    with mlflow.start_run(nested=True):
        # Search Space Parameter (Fokus mencegah Overfitting)
        param = {
            "objective": "reg:squarederror",
            "eval_metric": "mae",
            "n_estimators": 2000, # Gunakan angka besar, nanti berhenti lewat early_stopping
            "early_stopping_rounds": 50, # Pindah ke sini untuk XGBoost >= 2.0
            "learning_rate": trial.suggest_float("learning_rate", 0.01, 0.1, log=True),
            "max_depth": trial.suggest_int("max_depth", 3, 8),
            "min_child_weight": trial.suggest_int("min_child_weight", 1, 10),
            "gamma": trial.suggest_float("gamma", 1e-5, 0.5, log=True),
            "subsample": trial.suggest_float("subsample", 0.6, 0.9),
            "colsample_bytree": trial.suggest_float("colsample_bytree", 0.6, 0.9),
            "reg_alpha": trial.suggest_float("reg_alpha", 1e-5, 1.0, log=True), # L1
            "reg_lambda": trial.suggest_float("reg_lambda", 1e-5, 1.0, log=True), # L2
            "random_state": 42
        }

        # Training dengan Early Stopping
        model = xgb.XGBRegressor(**param)
        model.fit(
            X_train, y_train,
            eval_set=[(X_valid, y_valid)],
            verbose=False
        )

        # Evaluasi
        preds = model.predict(X_valid)
        mae = mean_absolute_error(y_valid, preds)

        # Logging ke MLflow
        mlflow.log_params(param)
        mlflow.log_metric("mae", mae)
        mlflow.xgboost.log_model(model, "model")

        return mae # Kita ingin meminimalkan MAE

# 5. Jalankan Optimasi
with mlflow.start_run(run_name="Main_Optuna_Tuning"):
    study = optuna.create_study(direction="minimize")
    study.optimize(objective, n_trials=30) # 30 percobaan cukup untuk data 16rb

print(f"Selesai! MAE Terkecil: {study.best_value}")
print(f"Parameter Terbaik: {study.best_params}")