import { describe, expect, it } from 'vitest';
import { normalizeSocialLink, renderableSocialLinks, socialLinkLabel, socialLinkPlatform } from './socialLinks';
import { SOCIAL_ICON_PATHS } from './socialIcons';

describe('normalizeSocialLink', () => {
  it('adds https to a bare domain', () => {
    expect(normalizeSocialLink('  instagram.com/sillajuku ')).toBe('https://instagram.com/sillajuku');
  });
  it('keeps http(s) URLs', () => {
    expect(normalizeSocialLink('https://www.youtube.com/@foo')).toBe('https://www.youtube.com/@foo');
  });
  it('rejects non-web schemes and junk', () => {
    expect(normalizeSocialLink('javascript:alert(1)')).toBeNull();
    expect(normalizeSocialLink('mailto:a@b.com')).toBeNull();
    expect(normalizeSocialLink('not a link')).toBeNull();
    expect(normalizeSocialLink('localhost')).toBeNull();
    expect(normalizeSocialLink('')).toBeNull();
  });
  it('rejects overlong URLs', () => {
    expect(normalizeSocialLink(`https://a.com/${'x'.repeat(300)}`)).toBeNull();
  });
});

describe('socialLinkLabel', () => {
  it('names known platforms, including subdomains', () => {
    expect(socialLinkLabel('https://youtu.be/abc')).toBe('YouTube');
    expect(socialLinkLabel('https://m.youtube.com/@foo')).toBe('YouTube');
    expect(socialLinkLabel('https://open.spotify.com/artist/1')).toBe('Spotify');
    expect(socialLinkLabel('https://chzzk.naver.com/abc')).toBe('CHZZK');
    expect(socialLinkLabel('https://x.com/foo')).toBe('X');
  });
  it('does not match lookalike hosts', () => {
    expect(socialLinkLabel('https://notyoutube.com/foo')).toBe('notyoutube.com');
  });
  it('falls back to the host', () => {
    expect(socialLinkLabel('https://www.example.co.kr/me')).toBe('example.co.kr');
  });
});

describe('socialLinkPlatform', () => {
  it('gives known platforms an icon that exists', () => {
    const { icon } = socialLinkPlatform('https://www.instagram.com/foo');
    expect(icon).toBe('instagram');
    expect(SOCIAL_ICON_PATHS[icon!]).toBeTruthy();
  });
  it('has no icon for platforms without a logo or unknown hosts', () => {
    expect(socialLinkPlatform('https://chzzk.naver.com/abc')).toEqual({ label: 'CHZZK', icon: null });
    expect(socialLinkPlatform('https://example.com')).toEqual({ label: 'example.com', icon: null });
  });
});

describe('renderableSocialLinks', () => {
  it('drops unsafe entries and caps the count', () => {
    expect(renderableSocialLinks(['javascript:alert(1)', 'https://a.com'])).toEqual(['https://a.com']);
    expect(renderableSocialLinks(null)).toEqual([]);
    expect(renderableSocialLinks(Array.from({ length: 7 }, (_, i) => `https://a${i}.com`))).toHaveLength(5);
  });
});
