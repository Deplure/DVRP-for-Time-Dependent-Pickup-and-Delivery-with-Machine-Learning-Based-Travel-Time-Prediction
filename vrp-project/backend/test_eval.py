import requests
import json

nodes = [
    {"id": "0_Depot_JNE", "lat": -7.265232, "lon": 112.736966, "demand": 0, "tw_start": 0, "tw_end": 86400},
    {"id": "5_SMA_Trimurti", "lat": -7.271378, "lon": 112.743125, "demand": 2, "tw_start": 0, "tw_end": 1800},
    {"id": "7_Rawon_Setan", "lat": -7.261884, "lon": 112.739778, "demand": 3, "tw_start": 0, "tw_end": 1800},
    {"id": "4_Siola_Mall", "lat": -7.256426, "lon": 112.736236, "demand": 4, "tw_start": 0, "tw_end": 900},
    {"id": "1_TP_Tunjungan", "lat": -7.262608, "lon": 112.742352, "demand": -3, "tw_start": 0, "tw_end": 900},
    {"id": "3_Pasar_Kembang", "lat": -7.269480, "lon": 112.730594, "demand": -5, "tw_start": 0, "tw_end": 900},
    {"id": "8_Pandegiling", "lat": -7.273641, "lon": 112.733470, "demand": -2, "tw_start": 900, "tw_end": 1800},
    {"id": "2_Hotel_Majapahit", "lat": -7.260656, "lon": 112.738876, "demand": -2, "tw_start": 900, "tw_end": 1800},
    {"id": "9_Gramedia", "lat": -7.266857, "lon": 112.742223, "demand": -2, "tw_start": 900, "tw_end": 1800},
    {"id": "6_Patung_Sapi", "lat": -7.263884, "lon": 112.742308, "demand": 1, "tw_start": 900, "tw_end": 1800},
    {"id": "10_SPBU_Kedungdoro", "lat": -7.261012, "lon": 112.732045, "demand": -4, "tw_start": 0, "tw_end": 900},
    {"id": "11_Apotek_K24", "lat": -7.266050, "lon": 112.731080, "demand": 2, "tw_start": 600, "tw_end": 1800},
    {"id": "12_Warkop_Pitlik", "lat": -7.264020, "lon": 112.735010, "demand": -1, "tw_start": 0, "tw_end": 1800},
    {"id": "13_Polsek_Tegalsari", "lat": -7.267088, "lon": 112.734000, "demand": 3, "tw_start": 0, "tw_end": 1800},
    {"id": "14_Sate_Klisik", "lat": -7.271015, "lon": 112.732090, "demand": -3, "tw_start": 900, "tw_end": 1800},
    {"id": "15_KFC_Basra", "lat": -7.265005, "lon": 112.740510, "demand": 4, "tw_start": 900, "tw_end": 1800},
    {"id": "16_McD_Basra", "lat": -7.263520, "lon": 112.741080, "demand": -2, "tw_start": 0, "tw_end": 3600},
    {"id": "17_Kopi_Kenangan", "lat": -7.262055, "lon": 112.738010, "demand": 2, "tw_start": 1800, "tw_end": 3600},
    {"id": "18_Plaza_BRI", "lat": -7.264510, "lon": 112.742590, "demand": -5, "tw_start": 0, "tw_end": 3600},
    {"id": "19_Taman_Apsari", "lat": -7.263080, "lon": 112.744020, "demand": 1, "tw_start": 1800, "tw_end": 3600},
    {"id": "20_Monumen_Bambu", "lat": -7.267812, "lon": 112.743050, "demand": -2, "tw_start": 1800, "tw_end": 5400},
    {"id": "21_Intiland_Tower", "lat": -7.268045, "lon": 112.741010, "demand": 5, "tw_start": 0, "tw_end": 900},
    {"id": "22_Hotel_Bumi", "lat": -7.269088, "lon": 112.742050, "demand": -4, "tw_start": 0, "tw_end": 3600},
    {"id": "23_Gereja_Hati_Kudus", "lat": -7.270510, "lon": 112.741580, "demand": 2, "tw_start": 0, "tw_end": 2700},
    {"id": "24_Pasar_Keputran", "lat": -7.273050, "lon": 112.742010, "demand": -5, "tw_start": 0, "tw_end": 900},
    {"id": "25_BCA_Darmo", "lat": -7.275520, "lon": 112.740050, "demand": 3, "tw_start": 900, "tw_end": 1800},
    {"id": "26_RS_Darmo", "lat": -7.280010, "lon": 112.738090, "demand": -3, "tw_start": 0, "tw_end": 2700},
    {"id": "27_Kantor_Pos_Dinoyo", "lat": -7.278055, "lon": 112.739020, "demand": 4, "tw_start": 1800, "tw_end": 2700},
    {"id": "28_Pecel_Madiun", "lat": -7.272045, "lon": 112.735080, "demand": -2, "tw_start": 1800, "tw_end": 3600},
    {"id": "29_Indomaret_Pregolan", "lat": -7.268510, "lon": 112.737520, "demand": 1, "tw_start": 0, "tw_end": 1800}
]
import sys
sys.path.append('.')
sys.stdout = open('test_trace.log', 'w', encoding='utf-8')

from main import optimize_route, OptimizeRequest

req = OptimizeRequest(
    nodes=nodes,
    num_vehicles=5,
    vehicle_capacity=20,
    start_hour=16
)

try:
    res = optimize_route(req)
    with open('test_output.json', 'w') as f:
        json.dump(res, f, indent=4)
    print("SAVED TO test_output.json")
except Exception as e:
    import traceback
    traceback.print_exc()
