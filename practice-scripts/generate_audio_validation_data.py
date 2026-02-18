import os
import json
import subprocess
import argparse
import random

# Configuration
# Local storage strategy

def degrade_audio(input_path, noise_path, output_dir):
    """
    Generates degraded audio clips by mixing with noise and applying filters.
    """
    filename = os.path.basename(input_path)
    base_name, ext = os.path.splitext(filename)
    
    metadata = []
    
    # 1. Bandpass Filter (Simulate mic quality)
    # Lowpass 3000Hz, Highpass 200Hz
    output_filter = os.path.join(output_dir, f"{base_name}_bandpass{ext}")
    subprocess.run([
        "ffmpeg", "-y", "-i", input_path, 
        "-af", "highpass=f=200,lowpass=f=3000", 
        output_filter
    ], check=True)
    metadata.append({
        "test_id": "bandpass_200_3000",
        "ref_audio": filename,
        "degraded_audio": os.path.basename(output_filter),
        "transformation": "bandpass_filter",
        "param": "200Hz-3000Hz"
    })

    # 2. Environmental Noise Injection (if noise file provided)
    if noise_path and os.path.exists(noise_path):
        output_noise = os.path.join(output_dir, f"{base_name}_noise{ext}")
        # Mix input with noise. Volume of noise adjusted.
        # ffmpeg amix
        subprocess.run([
            "ffmpeg", "-y", "-i", input_path, "-i", noise_path,
            "-filter_complex", "[0:a][1:a]amix=inputs=2:duration=first:dropout_transition=2",
            output_noise
        ], check=True)
        metadata.append({
            "test_id": "noise_injection",
            "ref_audio": filename,
            "degraded_audio": os.path.basename(output_noise),
            "transformation": "noise_injection",
            "param": noise_path
        })

    return metadata

def main():
    parser = argparse.ArgumentParser(description="Generate Audio Alignment Validation Data")
    parser.add_argument("--input", required=True, help="Path to source audio (GTZAN track)")
    parser.add_argument("--noise", help="Path to noise audio (DEMAND track)")
    parser.add_argument("--output", default="./output/audio_validation", help="Output directory")
    args = parser.parse_args()

    os.makedirs(args.output, exist_ok=True)

    print(f"Processing {args.input}...")
    metadata = degrade_audio(args.input, args.noise, args.output)

    # Save Ground Truth
    json_path = os.path.join(args.output, "audio_ground_truth.json")
    with open(json_path, "w") as f:
        json.dump(metadata, f, indent=2)
    
    print(f"Generated validation data in {args.output}")

if __name__ == "__main__":
    main()
