import mlflow
import os

os.environ['MLFLOW_TRACKING_URI'] = 'sqlite:///mlflow_skripsi.db'
mlflow.set_tracking_uri('sqlite:///mlflow_skripsi.db')

client = mlflow.tracking.MlflowClient()
experiment = client.get_experiment_by_name('Skripsi_VRP_Tegalsari_Lengkap')
if experiment:
    runs = client.search_runs(experiment.experiment_id, order_by=['start_time DESC'], max_results=1)
    if runs:
        print('BEST_RUN_ID:', runs[0].info.run_id)
    else:
        print('NO RUNS FOUND.')
else:
    print('EXPERIMENT NOT FOUND.')
