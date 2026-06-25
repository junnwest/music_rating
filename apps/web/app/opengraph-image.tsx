import { ImageResponse } from 'next/og';

export const runtime = 'edge';
export const alt = 'sillajuku';
export const size = { width: 1200, height: 630 };
export const contentType = 'image/png';

export default async function OgImage() {
  const logoSvg = await fetch('https://sillajuku.com/logo-dense.svg').then(r => r.text());
  const logoSrc = `data:image/svg+xml,${encodeURIComponent(logoSvg)}`;

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
        <img src={logoSrc} style={{ width: 420, objectFit: 'contain' }} />
      </div>
    ),
    { ...size }
  );
}
