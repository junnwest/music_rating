import { ImageResponse } from 'next/og';
import type { NextRequest } from 'next/server';

export const runtime = 'edge';

// GET /api/daily-question/card?question=…&title=…&artist=…&cover=…&username=…&date=…&format=story|square
// Generates a shareable PNG card (1080×1920 story or 1080×1080 square).
export async function GET(req: NextRequest) {
  const { searchParams } = req.nextUrl;
  const question = searchParams.get('question') ?? "Today's question";
  const title    = searchParams.get('title')    ?? '';
  const artist   = searchParams.get('artist')   ?? '';
  const cover    = searchParams.get('cover')    ?? '';
  const username = searchParams.get('username') ?? '';
  const date     = searchParams.get('date')     ?? '';
  const format   = searchParams.get('format')   ?? 'story';

  const isStory = format !== 'square';
  const W = 1080;
  const H = isStory ? 1920 : 1080;

  const coverSrc = cover || null;
  const coverSize = isStory ? 720 : 560;

  return new ImageResponse(
    (
      <div
        style={{
          width: W,
          height: H,
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          background: '#F8F8F6',
          position: 'relative',
          fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif',
        }}
      >
        {/* Amber top stripe */}
        <div
          style={{
            position: 'absolute',
            top: 0,
            left: 0,
            right: 0,
            height: 8,
            background: '#E8A020',
            display: 'flex',
          }}
        />

        {/* Top bar: branding + date */}
        <div
          style={{
            display: 'flex',
            width: '100%',
            alignItems: 'center',
            justifyContent: 'space-between',
            padding: isStory ? '60px 72px 0' : '48px 72px 0',
          }}
        >
          <div
            style={{
              fontSize: isStory ? 36 : 28,
              fontWeight: 800,
              color: '#1A1A18',
              letterSpacing: '-1px',
              display: 'flex',
            }}
          >
            sillajuku
          </div>
          {date && (
            <div
              style={{
                fontSize: isStory ? 24 : 20,
                color: '#8C8C8A',
                fontWeight: 500,
                display: 'flex',
              }}
            >
              {date}
            </div>
          )}
        </div>

        {/* "Daily Question" label */}
        <div
          style={{
            display: 'flex',
            marginTop: isStory ? 72 : 48,
            paddingLeft: 72,
            paddingRight: 72,
            width: '100%',
          }}
        >
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 12,
              background: '#FEF3DC',
              border: '2px solid #E8A020',
              borderRadius: 14,
              padding: '10px 20px',
            }}
          >
            <div style={{ fontSize: isStory ? 28 : 22, display: 'flex' }}>🎵</div>
            <div
              style={{
                fontSize: isStory ? 26 : 20,
                fontWeight: 700,
                color: '#B87010',
                letterSpacing: '-0.3px',
                display: 'flex',
              }}
            >
              Daily Question
            </div>
          </div>
        </div>

        {/* Question text */}
        <div
          style={{
            display: 'flex',
            width: '100%',
            padding: isStory ? '40px 72px' : '28px 72px',
          }}
        >
          <div
            style={{
              fontSize: isStory ? 52 : 40,
              fontWeight: 800,
              color: '#1A1A18',
              letterSpacing: '-1.5px',
              lineHeight: 1.2,
              display: 'flex',
              flexWrap: 'wrap',
            }}
          >
            {question}
          </div>
        </div>

        {/* Album cover */}
        <div
          style={{
            display: 'flex',
            width: coverSize,
            height: coverSize,
            borderRadius: 24,
            overflow: 'hidden',
            background: '#EBEBEB',
            border: '3px solid #E0E0DE',
            marginTop: isStory ? 16 : 8,
            flexShrink: 0,
          }}
        >
          {coverSrc ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={coverSrc}
              alt={title}
              width={coverSize}
              height={coverSize}
              style={{ objectFit: 'cover', width: '100%', height: '100%', display: 'flex' }}
            />
          ) : (
            <div
              style={{
                width: '100%',
                height: '100%',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                fontSize: 72,
                color: '#C0C0BE',
              }}
            >
              ♪
            </div>
          )}
        </div>

        {/* Album info */}
        <div
          style={{
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            marginTop: isStory ? 36 : 24,
            padding: '0 72px',
            width: '100%',
          }}
        >
          <div
            style={{
              fontSize: isStory ? 48 : 38,
              fontWeight: 800,
              color: '#1A1A18',
              letterSpacing: '-1px',
              textAlign: 'center',
              display: 'flex',
              flexWrap: 'wrap',
              justifyContent: 'center',
              lineHeight: 1.15,
            }}
          >
            {title}
          </div>
          <div
            style={{
              fontSize: isStory ? 32 : 26,
              fontWeight: 500,
              color: '#5C5C5A',
              marginTop: 12,
              display: 'flex',
              textAlign: 'center',
            }}
          >
            {artist}
          </div>
        </div>

        {/* Bottom: username + site URL */}
        <div
          style={{
            position: 'absolute',
            bottom: isStory ? 72 : 56,
            left: 72,
            right: 72,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
          }}
        >
          {username ? (
            <div
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 14,
                background: '#1A1A18',
                borderRadius: 100,
                padding: '12px 22px',
              }}
            >
              <div
                style={{
                  width: isStory ? 40 : 32,
                  height: isStory ? 40 : 32,
                  borderRadius: '50%',
                  background: '#E8A020',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  fontSize: isStory ? 18 : 14,
                  fontWeight: 800,
                  color: '#fff',
                }}
              >
                {username[0]?.toUpperCase() ?? '?'}
              </div>
              <div
                style={{
                  fontSize: isStory ? 26 : 20,
                  fontWeight: 600,
                  color: '#fff',
                  display: 'flex',
                }}
              >
                @{username}
              </div>
            </div>
          ) : (
            <div style={{ display: 'flex' }} />
          )}

          <div
            style={{
              fontSize: isStory ? 22 : 18,
              fontWeight: 600,
              color: '#B0B0AE',
              display: 'flex',
            }}
          >
            sillajuku.com
          </div>
        </div>
      </div>
    ),
    { width: W, height: H }
  );
}
