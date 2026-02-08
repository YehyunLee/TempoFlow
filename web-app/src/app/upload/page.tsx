"use client";

import { useState } from 'react';

export default function UploadPage() {
  const [file, setFile] = useState<File | null>(null);
  const [uploading, setUploading] = useState(false);
  const [message, setMessage] = useState('');

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files) {
      setFile(e.target.files[0]);
    }
  };

  const handleUpload = async () => {
    if (!file) return;

    setUploading(true);
    setMessage('Getting upload URL...');

    try {
      // 1. Get Presigned URL
      const response = await fetch('/api/upload', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ filename: file.name, contentType: file.type }),
      });

      if (!response.ok) throw new Error('Failed to get upload URL');
      const { url, fields } = await response.json();

      // 2. Upload to S3
      setMessage('Uploading to S3...');
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
        setMessage('Upload successful!');
      } else {
        setMessage('Upload failed.');
      }
    } catch (error) {
      console.error(error);
      setMessage('An error occurred.');
    } finally {
      setUploading(false);
    }
  };

  return (
    <div className="min-h-screen bg-gray-100 flex flex-col items-center justify-center p-4">
      <div className="bg-white p-8 rounded shadow-md w-full max-w-md">
        <h1 className="text-2xl font-bold mb-4">Upload Dance Video</h1>
        <input
          type="file"
          accept="video/*"
          onChange={handleFileChange}
          className="mb-4 w-full p-2 border border-gray-300 rounded"
        />
        <button
          onClick={handleUpload}
          disabled={!file || uploading}
          className={`w-full p-2 text-white rounded ${
            !file || uploading ? 'bg-gray-400' : 'bg-blue-600 hover:bg-blue-700'
          }`}
        >
          {uploading ? 'Uploading...' : 'Upload'}
        </button>
        {message && <p className="mt-4 text-center text-sm">{message}</p>}
      </div>
    </div>
  );
}
