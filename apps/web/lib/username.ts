// Single source of truth for username format on web, mirrored by the DB
// CHECK constraint (20260706000014_username_format_constraint.sql) and the
// iOS app (Models/Username.swift). Keep all three in sync if this changes.
export const USERNAME_MIN_LENGTH = 3;
export const USERNAME_MAX_LENGTH = 20;
export const USERNAME_REGEX = /^[a-z0-9_]{3,20}$/;

export function isValidUsername(value: string): boolean {
  return USERNAME_REGEX.test(value);
}

// Live-typing sanitizer: lowercases, strips disallowed characters, caps length.
export function normalizeUsername(raw: string): string {
  return raw.toLowerCase().replace(/[^a-z0-9_]/g, '').slice(0, USERNAME_MAX_LENGTH);
}

// Defensive truncation for fixed-canvas renders (OG images, share cards)
// that predate this constraint and can't rely on CSS truncation.
export function truncateUsernameForDisplay(value: string): string {
  return value.length > USERNAME_MAX_LENGTH ? `${value.slice(0, USERNAME_MAX_LENGTH - 1)}…` : value;
}
