import { ImageResponse } from 'next/og';
import { truncateUsernameForDisplay } from '../../../../lib/username';
import { loadJakartaFonts } from '../../../../lib/og-fonts';

// Node.js runtime (the default) -- loadJakartaFonts reads the bundled font
// files via node:fs, which isn't available on the edge runtime.
export const alt = 'sillajuku profile';
export const size = { width: 1200, height: 630 };
export const contentType = 'image/png';

interface Props {
  params: { username: string };
}

export default async function ProfileOgImage({ params }: Props) {
  const username = decodeURIComponent(params.username);

  // Fetch display name and rating count from Supabase REST API
  let displayName = username;
  let ratingCount = 0;

  try {
    const profileRes = await fetch(
      `${process.env.NEXT_PUBLIC_SUPABASE_URL}/rest/v1/profiles?username=eq.${encodeURIComponent(username)}&select=id,display_name`,
      {
        headers: {
          apikey: process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
          Authorization: `Bearer ${process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!}`,
        },
        next: { revalidate: 300 },
      }
    );
    const profiles: { id: string; display_name: string | null }[] = await profileRes.json();
    const profile = profiles[0];
    if (profile) {
      displayName = profile.display_name ?? username;

      const countRes = await fetch(
        `${process.env.NEXT_PUBLIC_SUPABASE_URL}/rest/v1/ratings?user_id=eq.${profile.id}&select=id`,
        {
          headers: {
            apikey: process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
            Authorization: `Bearer ${process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!}`,
            Prefer: 'count=exact',
            'Range-Unit': 'items',
            Range: '0-0',
          },
          next: { revalidate: 300 },
        }
      );
      const contentRange = countRes.headers.get('content-range');
      if (contentRange) {
        const total = contentRange.split('/')[1];
        ratingCount = total === '*' ? 0 : parseInt(total, 10);
      }
    }
  } catch {
    // Fallback to username with zero stats — still shows a valid card
  }

  const ratingLabel = ratingCount === 1 ? '1 release rated' : `${ratingCount.toLocaleString()} releases rated`;

  const fonts = await loadJakartaFonts();

  return new ImageResponse(
    (
      <div
        style={{
          width: '100%',
          height: '100%',
          display: 'flex',
          flexDirection: 'column',
          justifyContent: 'flex-end',
          background: '#F8F8F6',
          padding: '72px 80px',
          fontFamily: 'Plus Jakarta Sans',
          position: 'relative',
        }}
      >
        {/* Amber top stripe */}
        <div
          style={{
            position: 'absolute',
            top: 0,
            left: 0,
            right: 0,
            height: 6,
            background: '#2979B7',
            display: 'flex',
          }}
        />

        {/* sillajuku wordmark — top left */}
        <div
          style={{
            position: 'absolute',
            top: 56,
            left: 80,
            fontSize: 22,
            fontWeight: 700,
            color: '#8C8C8A',
            letterSpacing: '-0.5px',
            display: 'flex',
          }}
        >
          sillajuku
        </div>

        {/* Display name */}
        <div
          style={{
            fontSize: displayName.length > 20 ? 56 : 72,
            fontWeight: 800,
            color: '#1A1A18',
            letterSpacing: '-2px',
            lineHeight: 1,
            marginBottom: 16,
            display: 'flex',
          }}
        >
          {displayName}
        </div>

        {/* @username + rating count row */}
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 24,
          }}
        >
          <div
            style={{
              fontSize: 26,
              fontWeight: 500,
              color: '#8C8C8A',
              letterSpacing: '-0.3px',
              display: 'flex',
            }}
          >
            @{truncateUsernameForDisplay(username)}
          </div>

          {ratingCount > 0 && (
            <>
              <div style={{ width: 4, height: 4, borderRadius: '50%', background: '#C0C0BE', display: 'flex' }} />
              <div
                style={{
                  fontSize: 26,
                  fontWeight: 500,
                  color: '#8C8C8A',
                  letterSpacing: '-0.3px',
                  display: 'flex',
                }}
              >
                {ratingLabel}
              </div>
            </>
          )}
        </div>
      </div>
    ),
    { ...size, fonts }
  );
}
