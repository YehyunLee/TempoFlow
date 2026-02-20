import os
import pandas as pd
import requests
from tqdm import tqdm  # The progress bar library

INPUT_CSV = 'filtered_comparison_list.csv'
DEST_FOLDER = "AIST_Dances"
MANIFEST_FILE = "download_manifest.txt"

def generate_manifest(df):
    """Creates a text file previewing the folder structure and file counts."""
    print(f"Generating manifest: {MANIFEST_FILE}...")
    
    # FIX: Cast columns to string to prevent TypeError: can only concatenate str (not "int") to str
    # We use .astype(str) to ensure numbers like 01 stay as "01" (or "1")
    s_genre = df['genre'].astype(str)
    s_situation = df['situation'].astype(str)
    s_music = df['music'].astype(str)
    s_choreo = df['choreo'].astype(str)
    
    df['folder_name'] = s_genre + "_" + s_situation + "_" + s_music + "_" + s_choreo
    
    with open(MANIFEST_FILE, 'w') as f:
        f.write("AIST DOWNLOAD MANIFEST\n")
        f.write("======================\n\n")
        
        grouped = df.groupby('folder_name')
        f.write(f"Total Folders to create: {len(grouped)}\n")
        f.write(f"Total Files to download: {len(df)}\n\n")
        
        for folder, group in grouped:
            f.write(f"Folder: {folder} ({len(group)} files)\n")
            for _, row in group.iterrows():
                # Handling URL as string just in case
                filename = str(row['url']).split('/')[-1]
                f.write(f"--{filename}\n")
            f.write("\n")
    print("Manifest generated successfully.")
    return df # Return updated df with folder_name
def download_videos(updated_df):
    # MASTER PROGRESS BAR (Total Files)
    print("\nInitialising downloads...")
    master_pbar = tqdm(total=len(df), desc="Overall Progress", unit="file")

    for index, row in df.iterrows():
        url = row['url']
        filename = str(url).split('/')[-1]
        folder_path = os.path.join(DEST_FOLDER, row['folder_name'])
        
        if not os.path.exists(folder_path):
            os.makedirs(folder_path)

        file_save_path = os.path.join(folder_path, filename)

        if os.path.exists(file_save_path):
            master_pbar.update(1)
            continue
        
        try:
            r = requests.get(url, stream=True, timeout=30)
            if r.status_code == 200:
                # Get file size from headers for the nested progress bar
                total_size = int(r.headers.get('content-length', 0))
                
                # NESTED PROGRESS BAR (Current File Size)
                with open(file_save_path, 'wb') as f, tqdm(
                    desc=f" -> {filename[:20]}...",
                    total=total_size,
                    unit='B',
                    unit_scale=True,
                    unit_divisor=1024,
                    leave=False # Clears the file bar when done
                ) as file_pbar:
                    for chunk in r.iter_content(chunk_size=8192):
                        if chunk:
                            f.write(chunk)
                            file_pbar.update(len(chunk))
            else:
                print(f"\n[!] Failed {filename}: Status {r.status_code}")
        except Exception as e:
            print(f"\n[!] Error downloading {filename}: {e}")
        
        master_pbar.update(1)

    master_pbar.close()
    print("\nAll downloads complete!")
if __name__ == "__main__":
    if not os.path.exists(DEST_FOLDER):
        os.makedirs(DEST_FOLDER)

    df = pd.read_csv(INPUT_CSV)
    updated_df=generate_manifest(df)
    download_videos(df)
    