<<<<<<< HEAD
# Bachelor-Thesis: AI-Driven VRP
# 🚦 Prediksi Kemacetan & Optimasi Rute (Tegalsari, Surabaya)

Repositori ini berisi kode sumber dan eksperimen untuk **Tugas Akhir (Skripsi)** mengenai prediksi kepadatan lalu lintas dan integrasinya ke dalam *Vehicle Routing Problem (VRP)* di area **Tegalsari, Surabaya**.

Proyek ini terstruktur menggunakan pendekatan *Clean Architecture*, memisahkan alur eksperimen *Data Science* dari sistem *Fullstack Web Application* agar pengelolaan kode menjadi rapi, modular, dan *production-grade*.

## 📌 Tentang Proyek

Sistem ini dikembangkan untuk menentukan rute kurir logistik paling efisien dengan menimbang realita **hambatan waktu akibat kemacetan lalu lintas**. 

**Fokus Utama Eksperimen AI:**
* **Data Harvesting:** Pengumpulan data lalu lintas *real-time* via API pemetaan.
* **Predictive Modeling:** Pemodelan Machine Learning (Predictive Traffic) dengan metrik yang dipantau ketat.
* **Routing Solver:** Penerapan Heuristic Guided Local Search (GLS) pada model OR-Tools untuk mencari jarak/biaya *bensin* terendah dan meminimalisir pinalti keterlambatan *Time Window*.

## 🛠️ Teknologi yang Digunakan

Proyek ini dibangun menggunakan gabungan ekosistem AI dan Web:

* **Machine Learning Ops:** XGBoost, Scikit-Learn, Pandas, MLflow
* **Routing Engine Ops:** Google OR-Tools, Dockerized OSRM (Open Source Routing Machine)
* **Backend API Server:** Python FastAPI, Uvicorn, SQLite
* **Frontend Web App:** React.js, Vite, TailwindCSS, Chakra UI / Horizon UI
* **Other Tools:** Conda, Git

## 📂 Struktur Repositori (Clean Architecture)

```text
/Bachelor-Thesis
│
├── 📁 infrastructure/             <-- OSRM MAP SERVER
│   └── 📁 osrm/                   <-- Konfigurasi & Data Peta Java/Surabaya
│       ├── docker-compose.yml     <-- Script Runner OSRM MLD Server
│       └── java-latest.osrm.*     <-- Data Geometri & Routing Index
│
├── 📁 ml_pipeline/                <-- ML EXPERIMENTATION ZONE
│   ├── dataset_*.csv              <-- Data Latih Historis
│   ├── harvest_traffic.py         <-- Script Scraper Kemacetan
│   ├── parameter_tuning.py        <-- Tuning Hyperparameter
│   ├── train_experiment.py        <-- Script Training Model AI
│   ├── solve_vrp_hybrid.py        <-- Script Optimisasi Dasar
│   ├── vrp_compare.py             <-- Script Wasit (Benchmarking) AI vs Traditional
│   ├── mlflow.db                  <-- Database Log Eksperimen MLflow
│   └── 📁 models/                 <-- Model XGBoost tersimpan
│
└── 📁 vrp-project/                <-- FULLSTACK WEB APPLICATION
    │
    ├── 📁 backend/                <-- OTAK SISTEM VRP (Python FastAPI)
    │   ├── main.py                <-- Endpoint API Utama & Integrasi Solver
    │   ├── locations.db           <-- Cache Alamat Geocoding
    │   ├── .env                   <-- API Keys & Pointer Model Tracking
    │   └── requirements.txt       <-- Library Dependency Induk
    │
    └── 📁 frontend/               <-- WAJAH SISTEM VRP (React.js)
        ├── package.json           <-- NPM Dependency
        └── 📁 src/                
            ├── 📁 components/     <-- Konfigurasi Peta (Leaflet) dsb.
            ├── 📁 views/          <-- Halaman Utama Dashboard
            └── App.jsx            <-- Layout Utama Routing & Visualisasi
```

## 🚀 Panduan Eksekusi

### 1. Menjalankan OSRM (Map Engine)
Pastikan Docker dan Docker Compose berjalan.
```bash
cd infrastructure/osrm
docker-compose up -d
```

### 2. Menjalankan Backend (FastAPI VRP Solver)
Buka terminal baru pada environment conda project ini.
```bash
cd vrp-project/backend
uvicorn main:app --reload
```

### 3. Menjalankan Frontend (React Dashboard)
Buka terminal baru untuk NodeJS.
```bash
cd vrp-project/frontend
npm run dev
```

---
**Dicky Eka Putra** | Mahasiswa Tingkat Akhir - ITS
Project Tugas Akhir - 2026
=======
# DVRP-for-Time-Dependent-Pickup-and-Delivery-with-Machine-Learning-Based-Travel-Time-Prediction
>>>>>>> 3b27926b6b0e58c74ca6769addb22fb2673876e4
