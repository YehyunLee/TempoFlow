import { NextResponse } from 'next/server';
import { S3Client } from '@aws-sdk/client-s3';
import { createPresignedPost } from '@aws-sdk/s3-presigned-post';

export async function POST(request: Request) {
  try {
    const { filename, contentType } = await request.json();

    const s3Client = new S3Client({ region: process.env.AWS_REGION || 'us-east-1' });
    const bucketName = process.env.USER_VIDEO_BUCKET_NAME;

    if (!bucketName) {
        return NextResponse.json({ error: 'Bucket name not configured' }, { status: 500 });
    }

    const { url, fields } = await createPresignedPost(s3Client, {
      Bucket: bucketName,
      Key: `raw/${Date.now()}-${filename}`,
      Conditions: [
        ['content-length-range', 0, 104857600], // up to 100 MB
        ['eq', '$Content-Type', contentType],
      ],
      Fields: {
        'Content-Type': contentType,
      },
      Expires: 600, // Seconds before the presigned post expires. 3600 by default.
    });

    return NextResponse.json({ url, fields });
  } catch (error) {
    console.error(error);
    return NextResponse.json({ error: 'Failed to create presigned URL' }, { status: 500 });
  }
}
