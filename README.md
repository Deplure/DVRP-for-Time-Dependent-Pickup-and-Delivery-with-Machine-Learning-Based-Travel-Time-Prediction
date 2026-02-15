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
├── data/               # Dataset (mentah dan hasil proses) - *Tidak diupload ke Git*
├── notebooks/          # Jupyter Notebooks untuk eksperimen awal
├── src/                # Source code utama (harvesting, training, dll)
├── mlruns/             # Log eksperimen MLflow (Local only - *Di-ignore di Git*)
├── requirements.txt    # Daftar dependensi Python
└── README.md           # Dokumentasi proyek ini

Dicky Eka Putra Mahasiswa Tingkat Akhir - ITS

Project Tugas Akhir - 2026