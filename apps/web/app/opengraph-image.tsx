import { ImageResponse } from 'next/og';

export const runtime = 'edge';
export const alt = 'sillajuku';
export const size = { width: 1200, height: 630 };
export const contentType = 'image/png';

export default function OgImage() {
  return new ImageResponse(
    (
      <div
        style={{
          width: '100%',
          height: '100%',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          background: '#ffffff',
        }}
      >
        <img
          src="https://sillajuku.com/logo-flower.png"
          style={{ width: 320, height: 320, objectFit: 'contain' }}
        />
      </div>
    ),
    { ...size }
  );
}
