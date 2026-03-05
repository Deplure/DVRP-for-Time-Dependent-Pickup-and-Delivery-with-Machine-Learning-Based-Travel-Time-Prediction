import pandas as pd

# 1. Load Dataset Lama
df = pd.read_csv('dataset_kemacetan_tegalsari_final.csv')

print("--- SEBELUM MODIFIKASI ---")
print(df[df['hour_of_day'] == 17][['duration_in_traffic_sec']].mean())

# 2. DEFINISIKAN JAM SIBUK (RUSH HOUR)
# Pagi: 07-08, Sore: 16-18
jam_sibuk_pagi = [7, 8]
jam_sibuk_sore = [16, 17, 18]

# 3. KALIKAN DURASI DENGAN FAKTOR 'PARANOID'
# Kita buat macetnya 1.25 kali lipat lebih lama dari data asli
FACTOR_MACET = 1.25 

def apply_augmentation(row):
    # Jika jam sibuk, durasi dikali factor
    if row['hour_of_day'] in jam_sibuk_pagi or row['hour_of_day'] in jam_sibuk_sore:
        # Tapi hanya jika durasi traffic > durasi normal (artinya emang lagi padat)
        if row['duration_in_traffic_sec'] > row['duration_normal_sec']:
            return int(row['duration_in_traffic_sec'] * FACTOR_MACET)
    
    # Jika tidak, kembalikan nilai asli
    return row['duration_in_traffic_sec']

# Terapkan perubahan
df['duration_in_traffic_sec'] = df.apply(apply_augmentation, axis=1)

print("\n--- SESUDAH MODIFIKASI (Lebih Macet!) ---")
print(df[df['hour_of_day'] == 17][['duration_in_traffic_sec']].mean())

# 4. SIMPAN JADI FILE BARU
df.to_csv('dataset_vrp_augmented_1_25x.csv', index=False)
print("\n✅ File baru 'dataset_vrp_augmented.csv' berhasil dibuat!")
print("👉 Silakan TRAIN ULANG model pakai file baru ini.")