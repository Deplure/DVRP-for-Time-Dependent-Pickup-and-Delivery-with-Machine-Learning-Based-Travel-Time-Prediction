import os
import time
import numpy as np
import pandas as pd
from datetime import datetime, timedelta
import mlflow.xgboost
from ortools.constraint_solver import pywrapcp, routing_enums_pb2
import sys

# Menekan warning pandas/mlflow agar terminal rapi
import warnings
warnings.filterwarnings("ignore")

# Menggunakan utils dari script utama (Bisa dipanggil karena satu folder di ml_pipeline/)
from vrp_compare import (
    nodes_data, 
    get_osrm_table, 
    generate_hybrid_matrix, 
    get_realtime_weather, 
    MODEL_PATH,
    NUM_VEHICLES,
    VEHICLE_CAPACITY,
    SERVICE_TIME_SEC,
    simulate_dynamic_trip
)

# ================= 1. HELPERS DYNAMIC SOLVER =================
def solve_vrp_dynamic(cost_matrix, time_matrix, active_nodes, num_vehicles, starts, ends, objective_name="Routing"):
    """
    Dynamic VRP Solver pendukung DOD:
    - active_nodes: Subset node (mewakili matriks N x N yang terkirim)
    - starts: Array Index titik awal masing-masing kendaraan (Bisa berbeda karena posisi terakhir kurir)
    - ends: Array Index titik akhir (biasanya kembali ke depot asli)
    """
    data = {}
    data['cost_matrix'] = cost_matrix
    data['time_matrix'] = time_matrix
    data['demands'] = [n['demand'] for n in active_nodes] 
    data['time_windows'] = [n['tw'] for n in active_nodes]
    data['vehicle_capacities'] = [VEHICLE_CAPACITY] * num_vehicles
    data['num_vehicles'] = num_vehicles
    
    # Amankan node depot (index 0) walaupun starts-nya beda-beda
    # Starts merupakan index node pada subset 'active_nodes'
    manager = pywrapcp.RoutingIndexManager(len(cost_matrix), num_vehicles, starts, ends)
    routing = pywrapcp.RoutingModel(manager)

    # 1. SET COST
    def cost_callback(from_index, to_index):
        from_node = manager.IndexToNode(from_index)
        to_node = manager.IndexToNode(to_index)
        return int(data['cost_matrix'][from_node][to_node])
    transit_callback_index = routing.RegisterTransitCallback(cost_callback)
    routing.SetArcCostEvaluatorOfAllVehicles(transit_callback_index)

    # 2. SET CONSTRAINT TIME 
    def time_callback(from_index, to_index):
        from_node = manager.IndexToNode(from_index)
        to_node = manager.IndexToNode(to_index)
        val = int(data['time_matrix'][from_node][to_node])
        # Anggap node tujuan akhir 'depot original', tanpa service time
        if to_node not in ends: val += SERVICE_TIME_SEC
        return val

    time_callback_index = routing.RegisterTransitCallback(time_callback)
    routing.AddDimension(time_callback_index, 36000, 86400, False, 'Time')
    time_dimension = routing.GetDimensionOrDie('Time')
    
    for location_idx, (st, en) in enumerate(data['time_windows']):
        index = manager.NodeToIndex(location_idx)
        time_dimension.CumulVar(index).SetMin(st)
        time_dimension.SetCumulVarSoftUpperBound(index, en, 100) # Soft bound

    # 3. SET CONSTRAINT CAPACITY
    def demand_callback(from_index):
        from_node = manager.IndexToNode(from_index)
        return data['demands'][from_node]
    demand_callback_index = routing.RegisterUnaryTransitCallback(demand_callback)
    routing.AddDimension(demand_callback_index, 0, VEHICLE_CAPACITY, False, 'Capacity')

    # SOLVE
    search_parameters = pywrapcp.DefaultRoutingSearchParameters()
    search_parameters.first_solution_strategy = routing_enums_pb2.FirstSolutionStrategy.PATH_CHEAPEST_ARC
    
    solution = routing.SolveWithParameters(search_parameters)
    
    extracted_routes = []
    if solution:
        for vehicle_id in range(num_vehicles):
            index = routing.Start(vehicle_id)
            route = []
            while not routing.IsEnd(index):
                node_index = manager.IndexToNode(index)
                route.append(node_index)
                index = solution.Value(routing.NextVar(index))
            route.append(manager.IndexToNode(index))
            extracted_routes.append(route)
    return extracted_routes

# ================= 2. DOD SPLITTER =================
def split_dod_orders(percentage):
    """
    Memecah 29 Customer (Node 1 s.d 29) menjadi Offline & Online Requests (DOD)
    """
    total_customers = len(nodes_data) - 1 # Node 0 adalah depot
    online_count = int(total_customers * (percentage / 100.0))
    offline_count = total_customers - online_count
    
    # Depot selalu ikut (Index 0)
    # Node 1 s/d offline_count jadi Offline Requests
    offline_nodes = [nodes_data[0]] + nodes_data[1 : offline_count + 1]
    
    # Sisa node jadi Online Requests (Masuk mendadak jam 10:00)
    online_nodes = nodes_data[offline_count + 1 : ]
    
    return offline_nodes, online_nodes

# ================= 3. TIME SLOT EXTRACTOR =================
def extract_vehicle_states_at_time(routes, offline_nodes, start_time, interrupt_time, matrix_dist, matrix_time):
    """
    Mengekstrak keberadaan tiap kurir di jalan pada jam 10:00 (Interrupt Time).
    Mengembalikan: Node yang sudah diantar, Start Index kurir terkini, Unvisited Nodes
    """
    visited_global_ids = [0] # Depot selalu visited
    vehicle_current_positions = [] # Node ID tempat kurir terdampar di jam 10:00
    
    print(f"   [⏳] Melacak posisi armada di jalan raya pada {interrupt_time.strftime('%H:%M WIB')}...")

    for i, route_indices in enumerate(routes):
        if len(route_indices) < 2: 
            vehicle_current_positions.append(0)
            continue
            
        current_time = start_time
        last_visited_loc_id = offline_nodes[0]['id'] # Default depot
        
        for j in range(len(route_indices) - 1):
            idx_from = route_indices[j]
            idx_to = route_indices[j+1]
            
            travel_time = matrix_time[idx_from][idx_to]
            
            # Tambahkan waktu di perjalanan & pelayanan
            arrival_time = current_time + timedelta(seconds=int(travel_time))
            
            # Cek Time Window
            tw_start = offline_nodes[idx_to]['tw'][0]
            sec_since_start = (arrival_time - start_time).total_seconds()
            if sec_since_start < tw_start:
                arrival_time += timedelta(seconds=(tw_start - sec_since_start))
                
            service_finish = arrival_time + timedelta(seconds=SERVICE_TIME_SEC)
            
            # Jika selesainya SEBELUM jam 10:00 tereksekusi, maka paket ini aman 'Kirim'
            if service_finish <= interrupt_time:
                visited_global_ids.append(offline_nodes[idx_to]['id'])
                last_visited_loc_id = offline_nodes[idx_to]['id']
                current_time = service_finish
            else:
                # Sisanya berarti belum dikunjungi di jam 10:00
                break
                
        vehicle_current_positions.append(last_visited_loc_id)
        
    return visited_global_ids, vehicle_current_positions

# ================= 4. MAIN EXPERIMENT =================
def run_dod_simulation(percentage, model, is_rain):
    print("\n" + "="*60)
    print(f"🚀 MEMULAI SIMULASI DYNAMIC VRP | [DOD {percentage}%]")
    print(f"   Skenario: {(percentage/100)*29:.0f} Orderan akan masuk mendadak di jalan!")
    print("="*60)
    
    # --- PHASE 0: SETUP ---
    start_time_ph1 = datetime.now().replace(hour=8, minute=0, second=0, microsecond=0)
    
    # 🔴 GANTI DISINI: Ubah jam 10:00 menjadi 08:30 
    interrupt_time = datetime.now().replace(hour=8, minute=30, second=0, microsecond=0)
    
    offline_nodes, online_nodes = split_dod_orders(percentage)
    print(f"\n[📦] FASE 1: INITIAL ROUTING (08:00 WIB)")
    print(f"   Memproses {len(offline_nodes)-1} Order Offline yang diketahui pagi hari...")
    
    # --- PHASE 1: INITIAL VRP ---
    mat_time_ph1 = generate_hybrid_matrix(model, offline_nodes, 8, start_time_ph1.weekday(), is_rain)
    
    starts_ph1 = [0] * NUM_VEHICLES
    ends_ph1 = [0] * NUM_VEHICLES
    
    routes_ph1 = solve_vrp_dynamic(mat_time_ph1, mat_time_ph1, offline_nodes, NUM_VEHICLES, starts_ph1, ends_ph1)
    if not routes_ph1:
        print("   ❌ Gagal menemukan initial routing.")
        return
        
    # --- PHASE 2: TIME SLOT INTERRUPTION (08:30 WIB) ---
    print(f"\n[🚨] FASE 2: TIME SLOT INTERRUPTION ({interrupt_time.strftime('%H:%M WIB')})")
    print(f"   TERDETEKSI {len(online_nodes)} ORDERAN BARU MASUK! Memicu Re-Optimisasi...")
    
    visited_ids, vehicle_latest_ids = extract_vehicle_states_at_time(
        routes_ph1, offline_nodes, start_time_ph1, interrupt_time, mat_time_ph1, mat_time_ph1
    )
    
    # --- Mengumpulkan Node untuk Fase 3 ---
    # 1. Unvisited dari Offline Nodes 
    unvisited_nodes = [n for n in offline_nodes if n['id'] not in visited_ids]
    
    # 2. Sisipan Start/Depot Saat Ini (Titik Kurir Berada di 08:30)
    unique_start_loc_ids = list(set(vehicle_latest_ids))
    kurir_nodes = [n for n in offline_nodes if n['id'] in unique_start_loc_ids]
    
    # 3. Kumpulan Total Node Fase 3 (Lokasi Terakhir Kurir + Unvisited + Online Baru)
    active_nodes_ph3 = kurir_nodes + unvisited_nodes + online_nodes
    
    # Selipkan Depot Asli kembali ke active_nodes_ph3 (jika belum ada) agar Ends valid
    if nodes_data[0] not in active_nodes_ph3:
        active_nodes_ph3.append(nodes_data[0]) 

    depot_asli_idx = active_nodes_ph3.index(nodes_data[0])
    
    print(f"   Data Dirangkum: {len(unvisited_nodes)} Unvisited + {len(online_nodes)} New Orders.")
    
    # --- PHASE 3: RE-OPTIMIZATION ---
    print(f"\n[🔄] FASE 3: RE-OPTIMIZATION VRP (Mulai dari {interrupt_time.strftime('%H:%M WIB')})")
    
    # Memanggil model AI untuk prediksi kemacetan di jam 08:30
    mat_time_ph3 = generate_hybrid_matrix(model, active_nodes_ph3, 8, interrupt_time.weekday(), is_rain)
    
    starts_ph3 = []
    for loc_id in vehicle_latest_ids:
        idx = next((i for i, node in enumerate(active_nodes_ph3) if node['id'] == loc_id), depot_asli_idx)
        starts_ph3.append(idx)
        
    ends_ph3 = [depot_asli_idx] * NUM_VEHICLES 

    routes_ph3 = solve_vrp_dynamic(mat_time_ph3, mat_time_ph3, active_nodes_ph3, NUM_VEHICLES, starts_ph3, ends_ph3)
    
    if not routes_ph3:
        print("   ❌ Re-Routing GAGAL/OVERLOAD (Kapasitas & Waktu Tidak Cukup Terhadap Order Baru).")
    else:
        print(f"   ✅ Solusi Re-Routing {interrupt_time.strftime('%H:%M WIB')} Terselesaikan Terhadap Semua Sisa & Paket Baru!")
        
        # --- WASIT HASIL AKHIR BIAYA (EVALUASI) ---
        print("\n🏆 EVALUASI TOTAL RUTE TERAKHIR & DENDA:")
        dists, durs = get_osrm_table(active_nodes_ph3) # Matriks jarak asli untuk Wasit
        
        total_time_ph3_sec = 0
        total_late = 0
        for i, rute in enumerate(routes_ph3):
            if len(rute) > 1:
                dur, late = simulate_dynamic_trip(model, rute, interrupt_time, active_nodes_ph3, is_rain, dists, durs)
                total_time_ph3_sec += dur
                total_late += late
                
        biaya_bensin = int((total_time_ph3_sec / 60) * 300)
        biaya_denda = total_late * 20000
        
        print("-" * 50)
        print(f"💰 SCOREBOARD [DOD {percentage}%]")
        print(f"   Bahan Bakar & Durasi Lanjut: Rp {biaya_bensin:,}")
        print(f"   Denda Keterlambatan        : Rp {biaya_denda:,}")
        print(f"   TOTAL COST SEJAK {interrupt_time.strftime('%H:%M')}     : Rp {biaya_bensin + biaya_denda:,}")
    
    print("="*60 + "\n")

if __name__ == "__main__":
    print("\n[INIT] Menguji Skenario DVRP (Degree of Dynamism) menggunakan AI XGBoost...")
    try:
        mlflow.set_tracking_uri("sqlite:///mlflow.db")
        model = mlflow.xgboost.load_model(MODEL_PATH)
    except Exception as e:
        print(f"❌ Gagal meload MLFlow Model. Error: {e}")
        sys.exit()
        
    is_rain, desc = get_realtime_weather(nodes_data[0]['lat'], nodes_data[0]['lon'])
    print(f"🌦️ Info Cuaca Sekarang: {desc} | Is Rain: {is_rain}\n")
    
    # Testing berbagai persentase mendadak
    for dod in [20, 40, 60]:
        run_dod_simulation(dod, model, is_rain)
        time.sleep(1) # Jeda sedikit agar API nominatim/OSM tak flood
