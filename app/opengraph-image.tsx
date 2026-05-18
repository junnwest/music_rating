import { ImageResponse } from 'next/og';

export const runtime = 'edge';
export const alt = 'sillajuku — Every record you\'ve loved.';
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
          flexDirection: 'column',
          alignItems: 'flex-start',
          justifyContent: 'flex-end',
          background: '#F8F8F6',
          padding: '72px 80px',
          fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif',
        }}
      >
        {/* Top accent bar */}
        <div
          style={{
            position: 'absolute',
            top: 0,
            left: 0,
            right: 0,
            height: 6,
            background: '#E8A020',
            display: 'flex',
          }}
        />

        {/* Wordmark */}
        <div
          style={{
            fontSize: 72,
            fontWeight: 800,
            color: '#1A1A18',
            letterSpacing: '-2.5px',
            lineHeight: 1,
            marginBottom: 24,
            display: 'flex',
          }}
        >
          sillajuku
        </div>

        {/* Tagline */}
        <div
          style={{
            fontSize: 26,
            fontWeight: 500,
            color: '#8C8C8A',
            letterSpacing: '-0.3px',
            lineHeight: 1.4,
            display: 'flex',
          }}
        >
          Every record you've loved.
        </div>

        {/* Star decorations */}
        <div
          style={{
            position: 'absolute',
            top: 72,
            right: 80,
            display: 'flex',
            gap: 10,
          }}
        >
          {[1, 2, 3, 4, 5].map((i) => (
            <div
              key={i}
              style={{
                width: 48,
                height: 48,
                borderRadius: 12,
                background: i <= 4 ? '#1A1A18' : '#EBEBEB',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                fontSize: 24,
              }}
            >
              <span style={{ color: i <= 4 ? '#E8A020' : '#C0C0BE' }}>★</span>
            </div>
          ))}
        </div>

        {/* URL */}
        <div
          style={{
            marginTop: 40,
            fontSize: 16,
            fontWeight: 600,
            color: '#B0B0AE',
            letterSpacing: '0.5px',
            display: 'flex',
          }}
        >
          sillajuku.com
        </div>
      </div>
    ),
    { ...size }
  );
}
