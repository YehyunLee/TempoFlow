import pandas as pd
import re

# --- CONFIGURATION FLAGS ---
INPUT_CSV = 'refined_2M_all_video_url.csv'
OUTPUT_CSV = 'filtered_comparison_list.csv'

TARGET_CAMERA = '01'      # Filter for a specific camera (e.g., '01', '02')
MIN_DANCER_COUNT = 2      # Keep dances with at least this many different dancers
# ---------------------------

pattern = r"(g[A-Z0-9]+)_s([A-Z0-9]+)_c([0-9]+)_d([0-9]+)_m([A-Z0-9]+)_ch([0-9]+)"

def get_labels(url):
    match = re.search(pattern, str(url))
    return match.groups() if match else (None,) * 6

try:
    df = pd.read_csv(INPUT_CSV)
    url_col = df.columns[0]
    
    # 1. Extract Metadata
    metadata = df[url_col].apply(lambda x: pd.Series(get_labels(x)))
    metadata.columns = ['genre', 'situation', 'camera', 'dancer', 'music', 'choreo']
    
    # 2. Join back with URL
    clean_df = pd.concat([df[url_col], metadata], axis=1)
    clean_df.rename(columns={url_col: 'url'}, inplace=True)

    # 3. Apply Camera Flag
    if TARGET_CAMERA:
        clean_df = clean_df[clean_df['camera'] == TARGET_CAMERA].copy()
    
    # 4. Calculate Dancer Count and Apply Flag
    dance_keys = ['genre', 'situation', 'music', 'choreo']
    clean_df['dancer_count'] = clean_df.groupby(dance_keys)['dancer'].transform('nunique')
    
    final_df = clean_df[clean_df['dancer_count'] >= MIN_DANCER_COUNT].copy()
    
    # 5. Save
    final_df.to_csv(OUTPUT_CSV, index=False)
    
    print(f"--- Processing Complete ---")
    print(f"Target Camera: {TARGET_CAMERA}")
    print(f"Min Dancers Required: {MIN_DANCER_COUNT}")
    print(f"Entries saved to {OUTPUT_CSV}: {len(final_df)}")

except Exception as e:
    print(f"Error: {e}")