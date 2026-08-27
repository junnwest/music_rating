'use client';

import { useEffect, useState } from 'react';

type Report = {
  id: string;
  reporterUsername: string;
  reportedUsername: string;
  rating_id: string | null;
  reason: string;
  status: string;
  created_at: string;
};

type ContactSubmission = {
  id: string;
  email: string | null;
  category: string;
  message: string;
  status: string;
  created_at: string;
};

const STATUSES = ['open', 'reviewed', 'actioned', 'dismissed'];

export default function AdminReportsPage() {
  const [secret, setSecret] = useState('');
  const [authed, setAuthed] = useState(false);
  const [status, setStatus] = useState('open');
  const [reports, setReports] = useState<Report[]>([]);
  const [contacts, setContacts] = useState<ContactSubmission[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

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
  }, [authed, status]);

  const load = async () => {
    setLoading(true);
    setError(null);
    const res = await fetch(`/api/admin/reports?status=${status}`, {
      headers: { 'x-seed-secret': secret },
    });
    if (res.status === 401) {
      setAuthed(false);
      sessionStorage.removeItem('sj-admin-secret');
      setError('Incorrect secret.');
      setLoading(false);
      return;
    }
    const data = await res.json();
    setReports(data.reports ?? []);
    setContacts(data.contactSubmissions ?? []);
    setLoading(false);
  };

  const handleUnlock = () => {
    sessionStorage.setItem('sj-admin-secret', secret);
    setAuthed(true);
  };

  const updateStatus = async (table: 'reports' | 'contact_submissions', id: string, newStatus: string) => {
    await fetch('/api/admin/reports', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json', 'x-seed-secret': secret },
      body: JSON.stringify({ table, id, status: newStatus }),
    });
    load();
  };

  if (!authed) {
    return (
      <div style={{ maxWidth: 360, margin: '96px auto', padding: '0 20px' }}>
        <h1 style={{ fontSize: 18, fontWeight: 700, marginBottom: 12 }}>Admin — Reports</h1>
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
    <div style={{ maxWidth: 860, margin: '48px auto', padding: '0 20px' }}>
      <h1 style={{ fontSize: 20, fontWeight: 700, marginBottom: 4 }}>Moderation queue</h1>
      <p style={{ fontSize: 13, color: '#666', marginBottom: 20 }}>
        User reports and Help-page submissions. Not linked from anywhere in the app UI — bookmark this URL.
      </p>

      <div style={{ display: 'flex', gap: 6, marginBottom: 20 }}>
        {STATUSES.map((s) => (
          <button
            key={s}
            onClick={() => setStatus(s)}
            style={{
              padding: '5px 12px',
              borderRadius: 999,
              fontSize: 12,
              fontWeight: 600,
              border: status === s ? '1px solid #111' : '1px solid #ddd',
              background: status === s ? '#111' : '#fff',
              color: status === s ? '#fff' : '#333',
            }}
          >
            {s}
          </button>
        ))}
      </div>

      {loading && <p style={{ fontSize: 13, color: '#888' }}>Loading…</p>}

      <h2 style={{ fontSize: 14, fontWeight: 700, marginTop: 8, marginBottom: 8 }}>Reports ({reports.length})</h2>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginBottom: 28 }}>
        {reports.map((r) => (
          <div key={r.id} style={{ border: '1px solid #eee', borderRadius: 10, padding: 14 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12 }}>
              <div style={{ fontSize: 13 }}>
                <b>@{r.reporterUsername}</b> reported <b>@{r.reportedUsername}</b>
                {r.rating_id && <span style={{ color: '#888' }}> · rating {r.rating_id.slice(0, 8)}</span>}
              </div>
              <span style={{ fontSize: 11, color: '#888', whiteSpace: 'nowrap' }}>
                {new Date(r.created_at).toLocaleString()}
              </span>
            </div>
            <p style={{ fontSize: 12, color: '#666', marginTop: 4 }}>Reason: {r.reason}</p>
            <div style={{ display: 'flex', gap: 6, marginTop: 8 }}>
              {STATUSES.filter((s) => s !== r.status).map((s) => (
                <button
                  key={s}
                  onClick={() => updateStatus('reports', r.id, s)}
                  style={{ fontSize: 11, padding: '4px 10px', borderRadius: 6, border: '1px solid #ddd', background: '#fafafa' }}
                >
                  Mark {s}
                </button>
              ))}
            </div>
          </div>
        ))}
        {!loading && reports.length === 0 && <p style={{ fontSize: 13, color: '#999' }}>Nothing here.</p>}
      </div>

      <h2 style={{ fontSize: 14, fontWeight: 700, marginBottom: 8 }}>Help page submissions ({contacts.length})</h2>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
        {contacts.map((c) => (
          <div key={c.id} style={{ border: '1px solid #eee', borderRadius: 10, padding: 14 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12 }}>
              <span style={{ fontSize: 12, fontWeight: 700, textTransform: 'uppercase', color: '#7A4F0A' }}>{c.category}</span>
              <span style={{ fontSize: 11, color: '#888' }}>{new Date(c.created_at).toLocaleString()}</span>
            </div>
            <p style={{ fontSize: 13, marginTop: 6, whiteSpace: 'pre-wrap' }}>{c.message}</p>
            {c.email && <p style={{ fontSize: 12, color: '#666', marginTop: 4 }}>Reply to: {c.email}</p>}
            <div style={{ display: 'flex', gap: 6, marginTop: 8 }}>
              {['open', 'reviewed', 'closed'].filter((s) => s !== c.status).map((s) => (
                <button
                  key={s}
                  onClick={() => updateStatus('contact_submissions', c.id, s)}
                  style={{ fontSize: 11, padding: '4px 10px', borderRadius: 6, border: '1px solid #ddd', background: '#fafafa' }}
                >
                  Mark {s}
                </button>
              ))}
            </div>
          </div>
        ))}
        {!loading && contacts.length === 0 && <p style={{ fontSize: 13, color: '#999' }}>Nothing here.</p>}
      </div>
    </div>
  );
}
