"use client";

import { useState } from 'react';
import Link from 'next/link';

export default function UploadPage() {
  const [file, setFile] = useState<File | null>(null);
  const [uploading, setUploading] = useState(false);
  const [message, setMessage] = useState('');
  const [isDragging, setIsDragging] = useState(false);

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files[0]) {
      setFile(e.target.files[0]);
    }
  };

  const handleDrop = (e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    setIsDragging(false);
    
    if (e.dataTransfer.files && e.dataTransfer.files[0]) {
      const droppedFile = e.dataTransfer.files[0];
      if (droppedFile.type.startsWith('video/')) {
        setFile(droppedFile);
      }
    }
  };

  const handleDragOver = (e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    setIsDragging(true);
  };

  const handleDragLeave = () => {
    setIsDragging(false);
  };

  const handleUpload = async () => {
    if (!file) return;

    setUploading(true);
    setMessage('Getting upload URL...');

    try {
      const response = await fetch('/api/upload', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ filename: file.name, contentType: file.type }),
      });

      if (!response.ok) throw new Error('Failed to get upload URL');
      const { url, fields } = await response.json();

      setMessage('Uploading...');
      const formData = new FormData();
      Object.entries(fields).forEach(([key, value]) => {
        formData.append(key, value as string);
      });
      formData.append('file', file);

      const uploadResponse = await fetch(url, {
        method: 'POST',
        body: formData,
      });

      if (uploadResponse.ok) {
        setMessage('✓ Upload complete');
        setTimeout(() => {
          setFile(null);
          setMessage('');
        }, 2000);
      } else {
        setMessage('Upload failed');
      }
    } catch (error) {
      console.error(error);
      setMessage('An error occurred');
    } finally {
      setUploading(false);
    }
  };

  return (
    <div className="min-h-screen bg-white">
      {/* Header */}
      <div className="fixed top-0 left-0 right-0 bg-white/80 backdrop-blur-md border-b border-gray-100 z-10">
        <div className="flex items-center justify-between px-6 py-4">
          <Link href="/" className="text-2xl font-bold text-gray-900">
            TempoFlow
          </Link>
        </div>
      </div>

      {/* Main Content */}
      <div className="flex flex-col items-center justify-center min-h-screen px-6 py-24">
        <div className="w-full max-w-lg space-y-8">
          {/* Title */}
          <div className="text-center">
            <h1 className="text-4xl font-bold text-gray-900 mb-2">Upload Your Dance</h1>
            <p className="text-gray-600">Drop your video and get instant feedback</p>
          </div>

          {/* Upload Area */}
          <div
            onDrop={handleDrop}
            onDragOver={handleDragOver}
            onDragLeave={handleDragLeave}
            className={`
              relative border-2 border-dashed rounded-3xl p-12 text-center transition-all
              ${isDragging ? 'border-purple-500 bg-purple-50' : 'border-gray-200 hover:border-gray-300'}
              ${file ? 'bg-gray-50' : ''}
            `}
          >
            <input
              type="file"
              accept="video/*"
              onChange={handleFileChange}
              className="absolute inset-0 w-full h-full opacity-0 cursor-pointer"
              disabled={uploading}
            />
            
            {!file ? (
              <div className="space-y-4">
                <div className="w-16 h-16 mx-auto bg-gray-100 rounded-2xl flex items-center justify-center">
                  <svg className="w-8 h-8 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M7 16a4 4 0 01-.88-7.903A5 5 0 1115.9 6L16 6a5 5 0 011 9.9M15 13l-3-3m0 0l-3 3m3-3v12" />
                  </svg>
                </div>
                <div>
                  <p className="text-lg font-medium text-gray-900">Drop video here</p>
                  <p className="text-sm text-gray-500 mt-1">or tap to browse</p>
                </div>
              </div>
            ) : (
              <div className="space-y-4">
                <div className="w-16 h-16 mx-auto bg-purple-100 rounded-2xl flex items-center justify-center">
                  <svg className="w-8 h-8 text-purple-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 10l4.553-2.276A1 1 0 0121 8.618v6.764a1 1 0 01-1.447.894L15 14M5 18h8a2 2 0 002-2V8a2 2 0 00-2-2H5a2 2 0 00-2 2v8a2 2 0 002 2z" />
                  </svg>
                </div>
                <div>
                  <p className="text-lg font-medium text-gray-900 truncate">{file.name}</p>
                  <p className="text-sm text-gray-500 mt-1">
                    {(file.size / 1024 / 1024).toFixed(2)} MB
                  </p>
                </div>
              </div>
            )}
          </div>

          {/* Upload Button */}
          {file && !uploading && (
            <button
              onClick={handleUpload}
              className="w-full py-4 text-lg font-medium text-white bg-gray-900 rounded-full hover:bg-gray-800 transition-all active:scale-95 shadow-lg"
            >
              Analyze Dance
            </button>
          )}

          {/* Status Message */}
          {message && (
            <div className={`
              text-center py-3 px-4 rounded-2xl
              ${message.includes('✓') ? 'bg-green-50 text-green-700' : 'bg-gray-100 text-gray-700'}
            `}>
              {message}
            </div>
          )}

          {/* Loading State */}
          {uploading && (
            <div className="flex items-center justify-center gap-2 text-gray-600">
              <div className="w-5 h-5 border-2 border-gray-300 border-t-gray-900 rounded-full animate-spin" />
              <span>Processing...</span>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
