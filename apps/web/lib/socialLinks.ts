// Profile social links (migration 20261013000000). Mirrored by the DB CHECK
// (_sj_social_links_valid) and the iOS app (Models/SocialLinks.swift). Keep
// all three in sync if the rules or the platform list change.
export const SOCIAL_LINKS_MAX = 5;
export const SOCIAL_LINK_MAX_LENGTH = 300;

const DB_PATTERN = /^https?:\/\/[^\s/?#]+\.[^\s/?#]+([/?#]\S*)?$/i;

// Host suffix → label. First match wins, so subdomains go before their parent
// (chzzk.naver.com before a generic naver.com would). `icon` keys
// SOCIAL_ICON_PATHS; platforms without one use the generic link icon.
const PLATFORMS: { hosts: string[]; label: string; icon?: string }[] = [
  { hosts: ['youtube.com', 'youtu.be'], label: 'YouTube', icon: 'youtube' },
  { hosts: ['instagram.com'], label: 'Instagram', icon: 'instagram' },
  { hosts: ['tiktok.com'], label: 'TikTok', icon: 'tiktok' },
  { hosts: ['x.com', 'twitter.com'], label: 'X', icon: 'x' },
  { hosts: ['threads.net', 'threads.com'], label: 'Threads', icon: 'threads' },
  { hosts: ['facebook.com'], label: 'Facebook', icon: 'facebook' },
  { hosts: ['spotify.com'], label: 'Spotify', icon: 'spotify' },
  { hosts: ['music.apple.com'], label: 'Apple Music', icon: 'applemusic' },
  { hosts: ['soundcloud.com'], label: 'SoundCloud', icon: 'soundcloud' },
  { hosts: ['bandcamp.com'], label: 'Bandcamp', icon: 'bandcamp' },
  { hosts: ['melon.com'], label: 'Melon' },
  { hosts: ['twitch.tv'], label: 'Twitch', icon: 'twitch' },
  { hosts: ['chzzk.naver.com'], label: 'CHZZK' },
  { hosts: ['sooplive.co.kr', 'afreecatv.com'], label: 'SOOP' },
  { hosts: ['blog.naver.com'], label: 'Naver Blog', icon: 'naver' },
];

/** Turns what a user typed into a storable URL, or null if it isn't one. */
export function normalizeSocialLink(raw: string): string | null {
  let value = raw.trim();
  if (!value) return null;
  if (!/^[a-z][a-z0-9+.-]*:/i.test(value)) value = `https://${value}`;
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return null;
  }
  if (url.protocol !== 'https:' && url.protocol !== 'http:') return null;
  const out = url.toString();
  if (out.length > SOCIAL_LINK_MAX_LENGTH || !DB_PATTERN.test(out)) return null;
  return out;
}

function hostOf(url: string): string | null {
  try {
    return new URL(url).hostname.toLowerCase().replace(/^(www|m)\./, '');
  } catch {
    return null;
  }
}

/** Label (platform name, or the bare host) and icon key (null = generic link). */
export function socialLinkPlatform(url: string): { label: string; icon: string | null } {
  const host = hostOf(url);
  if (!host) return { label: url, icon: null };
  const match = PLATFORMS.find((p) => p.hosts.some((h) => host === h || host.endsWith(`.${h}`)));
  return { label: match?.label ?? host, icon: match?.icon ?? null };
}

export function socialLinkLabel(url: string): string {
  return socialLinkPlatform(url).label;
}

/** Only links that are safe to render as an href (defends against old/bad rows). */
export function renderableSocialLinks(links: string[] | null | undefined): string[] {
  return (links ?? []).filter((l) => DB_PATTERN.test(l)).slice(0, SOCIAL_LINKS_MAX);
}
