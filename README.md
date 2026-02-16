# Bachelor-Thesis
# 🚦 Traffic Prediction - Tegalsari, Surabaya

Repositori ini berisi kode sumber dan eksperimen untuk Tugas Akhir (Skripsi) mengenai prediksi kepadatan lalu lintas di area **Tegalsari, Surabaya**. 

Proyek ini mencakup proses *data harvesting*, pengolahan data, hingga pemodelan *Machine Learning* untuk memprediksi pola lalu lintas.

## 📌 Tentang Proyek

Tujuan utama dari penelitian ini adalah mengembangkan model yang mampu memprediksi kondisi lalu lintas berdasarkan data historis yang dikumpulkan. Sistem ini dirancang untuk membantu memahami dinamika kemacetan di salah satu area tersibuk di Surabaya.

**Fokus Utama:**
* **Data Harvesting:** Pengumpulan data lalu lintas *real-time* atau historis.
* **Preprocessing:** Pembersihan dan penyiapan data untuk pemodelan.
* **Modeling:** Eksperimen menggunakan algoritma *Machine Learning* (dilacak menggunakan MLflow).
* **Analisis:** Evaluasi performa model prediksi.

## 🛠️ Teknologi yang Digunakan

Proyek ini dibangun menggunakan:

* **Bahasa:** Python 3.11
* **Environment Management:** Conda
* **Machine Learning:** Scikit-Learn (atau library lain yang kamu pakai seperti TensorFlow/PyTorch)
* **Experiment Tracking:** MLflow
* **Data Manipulation:** Pandas, NumPy
* **Tools:** VS Code, Git

## 📂 Struktur Folder

```text
/Thesis-VRP-System
│
├── /backend            <-- OTAK SISTEM (Python FastAPI)
│   ├── main.py         <-- Pintu masuk API (Server & Endpoint)
│   ├── vrp_engine.py   <-- Script AI VRP (Logic OR-Tools & XGBoost)
│   ├── geocoder.py     <-- [BARU] Script "Smart Caching" (Nominatim + SQLite)
│   ├── models.py       <-- Definisi Data (Pydantic Models)
│   ├── database.db     <-- Database (Menyimpan Orderan & Cache Alamat)
│   ├── .env            <-- Kunci API & Run ID MLflow
│   └── requirements.txt <-- [PENTING] Daftar library (fastapi, ortools, dll)
│
├── /frontend           <-- WAJAH SISTEM (React.js)
│   ├── public/
│   ├── src/
│   │   ├── components/ <-- [SARAN] Pecah komponen biar rapi
│   │   │   ├── MapView.js    <-- Khusus Peta
│   │   │   ├── OrderList.js  <-- Khusus Tabel Order
│   │   │   └── StatsCard.js  <-- Khusus Angka Statistik
│   │   ├── App.js      <-- Layout Utama
│   │   ├── api.js      <-- Jembatan ke Backend
│   │   └── index.css   <-- Styling (Tailwind/CSS)
│   └── package.json
│
└── /docker-osrm        <-- MAP SERVER (Biarkan jalan sendiri)

Dicky Eka Putra Mahasiswa Tingkat Akhir - ITS

Project Tugas Akhir - 2026