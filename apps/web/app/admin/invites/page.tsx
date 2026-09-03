'use client';

import { useEffect, useState } from 'react';

type TeamInvite = {
  token: string;
  created_at: string;
  expires_at: string;
  revoked_at: string | null;
  redeemed_by: string | null;
  redeemed_at: string | null;
  redeemedByUsername: string | null;
};

/**
 * Admin surface for team-issued invites — generate a batch, see what's
 * outstanding. Same gating as /admin/reports (x-seed-secret, no separate
 * admin-role system). Supersedes the old SQL-editor-only
 * `SELECT generate_beta_tokens(5);` workflow.
 */
export default function AdminInvitesPage() {
  const [secret, setSecret] = useState('');
  const [authed, setAuthed] = useState(false);
  const [tokens, setTokens] = useState<TeamInvite[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [count, setCount] = useState(5);
  const [generating, setGenerating] = useState(false);
  const [justGenerated, setJustGenerated] = useState<string[]>([]);

  useEffect(() => {
    const saved = sessionStorage.getItem('sj-admin-secret');
    if (saved) {
      setSecret(saved);
      setAuthed(true);
    }
  }, []);

  useEffect(() => {
    if (authed) load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [authed]);

  const load = async () => {
    setLoading(true);
    const res = await fetch('/api/admin/team-invites', { headers: { 'x-seed-secret': secret } });
    if (res.status === 401) {
      sessionStorage.removeItem('sj-admin-secret');
      setAuthed(false);
      setError('Incorrect secret.');
      setLoading(false);
      return;
    }
    const data = await res.json();
    setTokens(data.tokens ?? []);
    setLoading(false);
  };

  const handleUnlock = () => {
    sessionStorage.setItem('sj-admin-secret', secret);
    setAuthed(true);
  };

  const generate = async () => {
    setGenerating(true);
    setJustGenerated([]);
    const res = await fetch('/api/admin/team-invites', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-seed-secret': secret },
      body: JSON.stringify({ count }),
    });
    const data = await res.json();
    setGenerating(false);
    if (data.tokens) {
      setJustGenerated(data.tokens);
      load();
    }
  };

  if (!authed) {
    return (
      <div style={{ maxWidth: 360, margin: '96px auto', padding: '0 20px' }}>
        <h1 style={{ fontSize: 18, fontWeight: 700, marginBottom: 12 }}>Admin — Invites</h1>
        <input
          type="password"
          value={secret}
          onChange={(e) => setSecret(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && handleUnlock()}
          placeholder="Admin secret"
          style={{ width: '100%', padding: '8px 12px', border: '1px solid #ddd', borderRadius: 8, marginBottom: 8 }}
        />
        {error && <p style={{ color: '#c0392b', fontSize: 13, marginBottom: 8 }}>{error}</p>}
        <button
          onClick={handleUnlock}
          style={{ padding: '8px 16px', background: '#111', color: '#fff', borderRadius: 8, border: 'none', fontWeight: 600 }}
        >
          Unlock
        </button>
      </div>
    );
  }

  return (
    <div style={{ maxWidth: 720, margin: '48px auto', padding: '0 20px' }}>
      <h1 style={{ fontSize: 20, fontWeight: 700, marginBottom: 4 }}>Team-issued invites</h1>
      <p style={{ fontSize: 13, color: '#666', marginBottom: 24 }}>
        No upstream member — these are sillajuku's own direct outreach (seeded influencers, ongoing
        recruitment). Doesn't touch any member's peer allotment.
      </p>

      <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginBottom: 8 }}>
        <input
          type="number"
          min={1}
          max={50}
          value={count}
          onChange={(e) => setCount(parseInt(e.target.value, 10) || 1)}
          style={{ width: 70, padding: '7px 10px', border: '1px solid #ddd', borderRadius: 8 }}
        />
        <button
          onClick={generate}
          disabled={generating}
          style={{ padding: '8px 16px', background: '#111', color: '#fff', borderRadius: 8, border: 'none', fontWeight: 600 }}
        >
          {generating ? 'Generating…' : 'Generate links'}
        </button>
      </div>

      {justGenerated.length > 0 && (
        <div style={{ background: '#f6f6f4', border: '1px solid #e5e5e2', borderRadius: 10, padding: 12, marginBottom: 24, fontFamily: 'monospace', fontSize: 12.5, lineHeight: 1.8 }}>
          {justGenerated.map((t) => (
            <div key={t}>https://sillajuku.com/beta/{t}</div>
          ))}
        </div>
      )}

      <p style={{ fontSize: 12, fontWeight: 700, color: '#888', marginBottom: 10, marginTop: 32 }}>
        OUTSTANDING / RECENT ({tokens.length})
      </p>
      {loading ? (
        <p style={{ fontSize: 13, color: '#888' }}>Loading…</p>
      ) : tokens.length === 0 ? (
        <p style={{ fontSize: 13, color: '#888' }}>None yet.</p>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          {tokens.map((t) => {
            const expired = new Date(t.expires_at).getTime() < Date.now();
            const state = t.redeemed_by ? 'redeemed' : t.revoked_at ? 'revoked' : expired ? 'expired' : 'pending';
            return (
              <div
                key={t.token}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                  padding: '8px 12px',
                  border: '1px solid #eee',
                  borderRadius: 8,
                  fontSize: 12.5,
                }}
              >
                <span style={{ fontFamily: 'monospace' }}>{t.token}</span>
                <span style={{ color: '#666' }}>
                  {state === 'redeemed' ? `redeemed · @${t.redeemedByUsername ?? '?'}` : state}
                </span>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
