import os
import json
import subprocess
import argparse
import random
import boto3
from pathlib import Path

# Configuration
BUCKET_NAME = os.environ.get("VALIDATION_VIDEO_BUCKET_NAME", "tempoflow-validation-videos")
S3_PREFIX = "dancer_alignment_validation/"

def apply_transformations(input_path, output_dir):
    """
    Generates 'Student' clips by applying affine transformations to the reference clip.
    """
    filename = os.path.basename(input_path)
    base_name, ext = os.path.splitext(filename)
    
    metadata = []
    
    even_scale = "scale='trunc(iw/2)*2':'trunc(ih/2)*2'"

    # 1. Scaling (0.8x - 1.2x)
    scale_factor = random.uniform(0.8, 1.2)
    output_scale = os.path.join(output_dir, f"{base_name}_scale_{scale_factor:.2f}{ext}")
    # ensure resulting width/height stay even for libx264
    subprocess.run([
        "ffmpeg", "-y", "-i", input_path, 
        "-vf", f"scale=iw*{scale_factor}:ih*{scale_factor},{even_scale}", 
        output_scale
    ], check=True)
    metadata.append({
        "test_id": f"scale_{scale_factor:.2f}",
        "ref_video": filename,
        "student_video": os.path.basename(output_scale),
        "transformation": "spatial_scale",
        "param": scale_factor
    })

    # 2. Rotation (+/- 15 degrees)
    angle = random.uniform(-15, 15)
    output_rotate = os.path.join(output_dir, f"{base_name}_rotate_{angle:.2f}{ext}")
    # ffmpeg rotate filter: rotate=Angle*PI/180
    subprocess.run([
        "ffmpeg", "-y", "-i", input_path, 
        "-vf", f"rotate={angle}*PI/180,{even_scale}", 
        output_rotate
    ], check=True)
    metadata.append({
        "test_id": f"rotate_{angle:.2f}",
        "ref_video": filename,
        "student_video": os.path.basename(output_rotate),
        "transformation": "spatial_rotation",
        "param": angle
    })

    # 3. Temporal Drift (Trim start)
    drift = random.uniform(0.1, 0.5)
    output_drift = os.path.join(output_dir, f"{base_name}_drift_{drift:.2f}s{ext}")
    subprocess.run([
        "ffmpeg", "-y", "-i", input_path, 
        "-ss", str(drift), 
        output_drift
    ], check=True)
    metadata.append({
        "test_id": f"drift_{drift:.2f}s",
        "ref_video": filename,
        "student_video": os.path.basename(output_drift),
        "transformation": "temporal_drift",
        "param": drift
    })

    return metadata

def upload_to_s3(file_path, s3_key):
    s3 = boto3.client('s3')
    try:
        s3.upload_file(file_path, BUCKET_NAME, s3_key)
        print(f"Uploaded {file_path} to s3://{BUCKET_NAME}/{s3_key}")
        return True
    except Exception as e:
        print(f"Failed to upload {file_path}: {e}")
        return False

def main():
    parser = argparse.ArgumentParser(description="Generate Dancer Alignment Validation Data")
    parser.add_argument("--input", required=True, help="Path to reference video")
    parser.add_argument("--output", default="./output/dancer_validation", help="Output directory")
    args = parser.parse_args()

    os.makedirs(args.output, exist_ok=True)

    print(f"Processing {args.input}...")
    metadata = apply_transformations(args.input, args.output)

    # Save Ground Truth JSON
    json_path = os.path.join(args.output, "ground_truth.json")
    with open(json_path, "w") as f:
        json.dump(metadata, f, indent=2)
    
    # Upload to S3 (Optional/If configured)
    if os.environ.get("UPLOAD_TO_S3"):
        for item in metadata:
            local_path = os.path.join(args.output, item["student_video"])
            key = f"{S3_PREFIX}{item['student_video']}"
            upload_to_s3(local_path, key)
        upload_to_s3(json_path, f"{S3_PREFIX}ground_truth.json")

if __name__ == "__main__":
    main()
