from typing import BinaryIO, Tuple, Union
import numpy as np
import librosa
from fastapi import UploadFile

def load_audio_files(
    file_a: Union[BinaryIO, UploadFile], 
    file_b: Union[BinaryIO, UploadFile]
) -> Tuple[np.ndarray, np.ndarray, int]:
    """
    Load two audio files and normalize their audio tracks to a shared sample rate.
    
    Args:
        file_a: File object or UploadFile
        file_b: File object or UploadFile
        
    Returns:
        y_a:  Audio array for file A
        y_b:  Audio array for file B
        sr:   Shared sample rate (minimum of the two source rates)
    """
    # If the input is an UploadFile, access its underlying file-like object
    f_a = file_a.file if isinstance(file_a, UploadFile) else file_a
    f_b = file_b.file if isinstance(file_b, UploadFile) else file_b

    # load returns (audio_time_series, sampling_rate)
    y_a_raw, sr_a = librosa.load(f_a, sr=None)
    y_b_raw, sr_b = librosa.load(f_b, sr=None)

    # Use the minimum sample rate to avoid upsampling artifacts if possible
    sr = min(sr_a, sr_b)

    # Resample if necessary
    if sr_a != sr:
        y_a = librosa.resample(y_a_raw, orig_sr=sr_a, target_sr=sr)
    else:
        y_a = y_a_raw
        
    if sr_b != sr:
        y_b = librosa.resample(y_b_raw, orig_sr=sr_b, target_sr=sr)
    else:
        y_b = y_b_raw

    return y_a, y_b, sr

def check_less_than_one_minute(y: np.ndarray, sr: int) -> None:
    """
    Raise ValueError if the audio track is longer than 1 minute.
    """
    duration_sec = len(y) / sr
    if duration_sec > 60:
        raise ValueError(f"Audio track is too long ({duration_sec:.2f} seconds). Maximum allowed is 60 seconds.")

def check_audio_not_silent(y: np.ndarray, threshold_db: float = -60.0) -> None:
    """
    Raise ValueError if the audio track is effectively silent.
    """
    rms = np.sqrt(np.mean(y**2))
    if rms <= 1e-9: # Avoid log(0)
        raise ValueError("Audio track is completely silent.")
        
    rms_db = librosa.amplitude_to_db(np.array([rms]))[0]
    
    if rms_db < threshold_db:
        raise ValueError(f"Audio track is effectively silent (RMS: {rms_db:.1f} dB)")

def extract_chroma(y: np.ndarray, sr: int) -> np.ndarray:
    """
    Extract Chroma STFT features from an audio time series.
    Returns array of shape (n_chroma, t).
    """
    return librosa.feature.chroma_stft(y=y, sr=sr)

def map_segments_to_clips(
    segment_points: list[float],
    clip_start_time: float,
    clip_end_time: float
) -> list[tuple[float, float]]:
    """
    Map relative segmentation points to absolute clip times.
    
    Args:
        segment_points: List of relative timestamps [t0, t1, t2...] from the start of the aligned region.
        clip_start_time: Absolute start time of the aligned region in the clip.
        clip_end_time: Absolute end time of the aligned region in the clip.
        
    Returns:
        List of (start, end) tuples in absolute clip time.
    """
    segments = []
    if not segment_points or len(segment_points) < 2:
        return []
    
    for i in range(len(segment_points) - 1):
        rel_start = segment_points[i]
        rel_end = segment_points[i+1]
        
        # Convert to absolute time
        abs_start = clip_start_time + rel_start
        abs_end = clip_start_time + rel_end
        
        # Ensure we don't go beyond the clip's valid aligned region
        # (Though extrapolation in generate_segments might intentionally go slightly over,
        # usually we want to clamp to the file/alignment limits if strict)
        
        # Allow slight overshoot if it's the last segment? 
        # For safety, let's clamp to clip_end_time provided by the alignment context.
        # But if clip_end_time is just "end of alignment", and the beat goes slightly past,
        # we might want to keep it. 
        # However, the user asked for "start and endtime for all audio clips".
        
        start_final = abs_start
        end_final = abs_end
        
        # Filter out segments that strictly start after the clip ends (shouldn't happen with correct logic)
        if start_final >= clip_end_time:
            continue
            
        segments.append((float(start_final), float(end_final)))
        
    return segments


