/**
 * Offline mock Supabase backend — run the web app with zero network/database.
 *
 *   npm run mock          # this server on http://localhost:54321
 *   npm run dev:mock      # Next dev on http://localhost:3100 pointed at it
 *
 * Implements just enough of GoTrue (implicit-flow OAuth, /user, refresh,
 * logout) and PostgREST (filters, order/limit, single-object Accept, count
 * headers, insert/upsert/patch/delete, /rpc) for the rebuilt web app.
 * Data lives in ./data.ts, in-memory only — restart to reset.
 *
 * Sign-in mapping: Spotify/Apple buttons → the seeded "demo" user (onboarded);
 * Google button → a fresh "newbie" user with no profile row (tests onboarding).
 */

import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { randomUUID } from 'node:crypto';
import { AUTH_USERS, tables, rpcs, hydrators, conflictKeys } from './data';

const PORT = Number(process.env.MOCK_PORT ?? 54321);

// ── auth plumbing ───────────────────────────────────────────────────────────

type UserKey = keyof typeof AUTH_USERS;
const accessTokens = new Map<string, UserKey>();
const refreshTokens = new Map<string, UserKey>();

function b64url(obj: unknown): string {
  return Buffer.from(JSON.stringify(obj)).toString('base64url');
}

function makeSession(key: UserKey) {
  const u = AUTH_USERS[key];
  const expiresIn = 60 * 60 * 24 * 7;
  const exp = Math.floor(Date.now() / 1000) + expiresIn;
  const access = `${b64url({ alg: 'none', typ: 'JWT' })}.${b64url({
    sub: u.id,
    role: 'authenticated',
    aud: 'authenticated',
    email: u.email,
    exp,
    session_id: randomUUID(),
  })}.mock`;
  const refresh = `mockrt-${randomUUID()}`;
  accessTokens.set(access, key);
  refreshTokens.set(refresh, key);
  return { access, refresh, expiresIn, exp };
}

function gotrueUser(key: UserKey) {
  const u = AUTH_USERS[key];
  const now = new Date().toISOString();
  return {
    id: u.id,
    aud: 'authenticated',
    role: 'authenticated',
    email: u.email,
    email_confirmed_at: now,
    phone: '',
    confirmed_at: now,
    last_sign_in_at: now,
    app_metadata: { provider: key === 'newbie' ? 'google' : 'spotify', providers: ['spotify'] },
    user_metadata: u.user_metadata,
    identities: [],
    created_at: now,
    updated_at: now,
  };
}

function sessionPayload(key: UserKey) {
  const s = makeSession(key);
  return {
    access_token: s.access,
    token_type: 'bearer',
    expires_in: s.expiresIn,
    expires_at: s.exp,
    refresh_token: s.refresh,
    user: gotrueUser(key),
  };
}

// ── tiny http helpers ───────────────────────────────────────────────────────

function cors(res: ServerResponse) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET,HEAD,POST,PATCH,PUT,DELETE,OPTIONS');
  res.setHeader(
    'Access-Control-Allow-Headers',
    'authorization, apikey, content-type, prefer, accept, accept-profile, content-profile, x-client-info, x-supabase-api-version, range',
  );
  res.setHeader('Access-Control-Expose-Headers', 'Content-Range, X-Total-Count');
}

function json(res: ServerResponse, status: number, body: unknown, headers: Record<string, string> = {}) {
  cors(res);
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', ...headers });
  res.end(JSON.stringify(body));
}

async function readBody(req: IncomingMessage): Promise<any> {
  const chunks: Buffer[] = [];
  for await (const c of req) chunks.push(c as Buffer);
  const raw = Buffer.concat(chunks).toString('utf8');
  if (!raw) return null;
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

// ── PostgREST filter engine ─────────────────────────────────────────────────

const RESERVED = new Set(['select', 'order', 'limit', 'offset', 'on_conflict', 'columns', 'apikey']);

function coerce(v: string): unknown {
  if (v === 'null') return null;
  if (v === 'true') return true;
  if (v === 'false') return false;
  if (v !== '' && !Number.isNaN(Number(v))) return Number(v);
  return v;
}

function matchOp(rowVal: unknown, op: string, rawVal: string): boolean {
  switch (op) {
    case 'eq':
      // eslint-disable-next-line eqeqeq
      return rowVal == coerce(rawVal);
    case 'neq':
      // eslint-disable-next-line eqeqeq
      return rowVal != coerce(rawVal);
    case 'gt':
      return rowVal != null && Number(rowVal) > Number(rawVal);
    case 'gte':
      return rowVal != null && Number(rowVal) >= Number(rawVal);
    case 'lt':
      return rowVal != null && Number(rowVal) < Number(rawVal);
    case 'lte':
      return rowVal != null && Number(rowVal) <= Number(rawVal);
    case 'is':
      if (rawVal === 'null') return rowVal == null;
      return rowVal === coerce(rawVal);
    case 'in': {
      const vals = rawVal
        .replace(/^\(/, '')
        .replace(/\)$/, '')
        .split(',')
        .map((s) => s.trim().replace(/^"|"$/g, ''));
      return vals.includes(String(rowVal));
    }
    case 'like':
    case 'ilike': {
      const pat = rawVal.replace(/[.+?^${}()|[\]\\]/g, '\\$&').replace(/[*%]/g, '.*');
      return new RegExp(`^${pat}$`, op === 'ilike' ? 'i' : '').test(String(rowVal ?? ''));
    }
    case 'cs': // array contains
    case 'ov': { // arrays overlap
      const vals = rawVal.replace(/^\{/, '').replace(/\}$/, '').split(',').map((s) => s.trim().replace(/^"|"$/g, ''));
      const arr = Array.isArray(rowVal) ? rowVal.map(String) : [];
      return op === 'cs' ? vals.every((v) => arr.includes(v)) : vals.some((v) => arr.includes(v));
    }
    default:
      return true; // unknown operator: don't filter (mock leniency)
  }
}

function applyFilters(rows: any[], params: URLSearchParams): any[] {
  let out = rows;
  for (const [key, raw] of params.entries()) {
    if (RESERVED.has(key)) continue;
    if (key === 'or' || key === 'and' || key.includes('.')) continue; // embedded/or filters: skip
    const m = /^(not\.)?([a-z]+)\.([\s\S]*)$/.exec(raw);
    if (!m) continue;
    const [, not, op, val] = m;
    out = out.filter((r) => {
      if (!(key in r)) return true; // unknown column: don't exclude
      const hit = matchOp(r[key], op, val);
      return not ? !hit : hit;
    });
  }
  return out;
}

function applyOrder(rows: any[], params: URLSearchParams): any[] {
  const order = params.get('order');
  if (!order) return rows;
  const keys = order.split(',').map((part) => {
    const bits = part.split('.');
    return { col: bits[0], desc: bits.includes('desc') };
  });
  return [...rows].sort((a, b) => {
    for (const { col, desc } of keys) {
      const av = a[col];
      const bv = b[col];
      if (av === bv) continue;
      if (av == null) return 1;
      if (bv == null) return -1;
      const cmp = av < bv ? -1 : 1;
      return desc ? -cmp : cmp;
    }
    return 0;
  });
}

// ── request handler ─────────────────────────────────────────────────────────

const server = createServer(async (req, res) => {
  const url = new URL(req.url ?? '/', `http://localhost:${PORT}`);
  const path = url.pathname;
  const method = req.method ?? 'GET';

  if (method === 'OPTIONS') {
    cors(res);
    // Echo whatever headers the browser asks for — more robust than a fixed list.
    const wanted = req.headers['access-control-request-headers'];
    if (wanted) res.setHeader('Access-Control-Allow-Headers', wanted);
    res.writeHead(204);
    res.end();
    return;
  }

  try {
    // ── GoTrue ──────────────────────────────────────────────────────────
    if (path === '/auth/v1/authorize') {
      const provider = url.searchParams.get('provider') ?? 'spotify';
      const redirectTo = url.searchParams.get('redirect_to') ?? 'http://localhost:3100/auth/callback';
      const key: UserKey = provider === 'google' ? 'newbie' : 'demo';
      const s = makeSession(key);
      const hash =
        `#access_token=${encodeURIComponent(s.access)}` +
        `&expires_at=${s.exp}&expires_in=${s.expiresIn}` +
        `&provider_token=mock&refresh_token=${encodeURIComponent(s.refresh)}` +
        `&token_type=bearer`;
      cors(res);
      res.writeHead(302, { Location: `${redirectTo}${hash}` });
      res.end();
      console.log(`[auth] ${provider} → ${key}`);
      return;
    }

    if (path === '/auth/v1/user' && method === 'GET') {
      const token = (req.headers.authorization ?? '').replace(/^Bearer\s+/i, '');
      const key = accessTokens.get(token);
      if (!key) {
        json(res, 401, { code: 401, msg: 'invalid token' });
        return;
      }
      json(res, 200, gotrueUser(key));
      return;
    }

    if (path === '/auth/v1/token' && method === 'POST') {
      const grant = url.searchParams.get('grant_type');
      const body = await readBody(req);
      if (grant === 'refresh_token') {
        const key = refreshTokens.get(body?.refresh_token ?? '');
        if (!key) {
          json(res, 400, { error: 'invalid_grant', error_description: 'unknown refresh token' });
          return;
        }
        json(res, 200, sessionPayload(key));
        return;
      }
      if (grant === 'password') {
        const key = (Object.keys(AUTH_USERS) as UserKey[]).find(
          (k) => AUTH_USERS[k].email === body?.email,
        );
        if (!key) {
          json(res, 400, { error: 'invalid_grant', error_description: 'unknown user' });
          return;
        }
        json(res, 200, sessionPayload(key));
        return;
      }
      json(res, 400, { error: 'unsupported_grant_type' });
      return;
    }

    if (path === '/auth/v1/logout' && method === 'POST') {
      cors(res);
      res.writeHead(204);
      res.end();
      return;
    }

    // ── PostgREST: RPC ──────────────────────────────────────────────────
    const rpcMatch = /^\/rest\/v1\/rpc\/([a-z0-9_]+)$/.exec(path);
    if (rpcMatch) {
      const fn = rpcMatch[1];
      const args = method === 'POST' ? await readBody(req) : Object.fromEntries(url.searchParams);
      const handler = rpcs[fn];
      const result = handler ? handler(args ?? {}) : [];
      if (!handler) console.log(`[rpc] ${fn} (no handler → [])`);
      json(res, 200, result ?? []);
      return;
    }

    // ── PostgREST: tables ───────────────────────────────────────────────
    const tableMatch = /^\/rest\/v1\/([a-z0-9_]+)$/.exec(path);
    if (tableMatch) {
      const table = tableMatch[1];
      const store = (tables[table] ||= []);
      const prefer = String(req.headers.prefer ?? '');
      const accept = String(req.headers.accept ?? '');
      const wantsObject = accept.includes('vnd.pgrst.object');
      const wantsCount = /count=(exact|planned|estimated)/.test(prefer);

      if (method === 'GET' || method === 'HEAD') {
        let rows = applyFilters(store, url.searchParams);
        rows = applyOrder(rows, url.searchParams);
        const total = rows.length;
        const offset = Number(url.searchParams.get('offset') ?? 0);
        const limit = Number(url.searchParams.get('limit') ?? Infinity);
        rows = rows.slice(offset, offset + (Number.isFinite(limit) ? limit : rows.length));

        const headers: Record<string, string> = {};
        if (wantsCount || method === 'HEAD') {
          headers['Content-Range'] = rows.length
            ? `${offset}-${offset + rows.length - 1}/${total}`
            : `*/${total}`;
        }
        if (method === 'HEAD') {
          cors(res);
          res.writeHead(200, { 'Content-Type': 'application/json', ...headers });
          res.end();
          return;
        }
        if (wantsObject) {
          if (rows.length === 0) {
            json(res, 406, {
              code: 'PGRST116',
              message: 'JSON object requested, multiple (or no) rows returned',
              details: 'The result contains 0 rows',
              hint: null,
            });
            return;
          }
          json(res, 200, rows[0], headers);
          return;
        }
        json(res, 200, rows, headers);
        return;
      }

      if (method === 'POST') {
        const body = await readBody(req);
        const incoming: any[] = Array.isArray(body) ? body : body ? [body] : [];
        const isUpsert =
          prefer.includes('resolution=merge-duplicates') || url.searchParams.has('on_conflict');
        const conflictCols =
          url.searchParams.get('on_conflict')?.split(',') ?? conflictKeys[table] ?? ['id'];
        const results: any[] = [];
        for (const row of incoming) {
          let target: any | undefined;
          if (isUpsert || table === 'profiles') {
            target = store.find((r) => conflictCols.every((c) => r[c] === row[c]));
          }
          if (target) {
            Object.assign(target, row);
            hydrators[table]?.(target);
            results.push(target);
          } else {
            const fresh = { id: randomUUID(), created_at: new Date().toISOString(), ...row };
            hydrators[table]?.(fresh);
            store.push(fresh);
            results.push(fresh);
          }
        }
        console.log(`[rest] insert ${table} ×${results.length}`);
        if (prefer.includes('return=representation')) {
          json(res, 201, wantsObject ? results[0] : results);
        } else {
          cors(res);
          res.writeHead(201, { 'Content-Type': 'application/json' });
          res.end();
        }
        return;
      }

      if (method === 'PATCH') {
        const body = await readBody(req);
        const rows = applyFilters(store, url.searchParams);
        for (const r of rows) {
          Object.assign(r, body);
          hydrators[table]?.(r);
        }
        console.log(`[rest] patch ${table} ×${rows.length}`);
        if (prefer.includes('return=representation')) json(res, 200, rows);
        else {
          cors(res);
          res.writeHead(204);
          res.end();
        }
        return;
      }

      if (method === 'DELETE') {
        const doomed = new Set(applyFilters(store, url.searchParams));
        tables[table] = store.filter((r) => !doomed.has(r));
        console.log(`[rest] delete ${table} ×${doomed.size}`);
        cors(res);
        res.writeHead(204);
        res.end();
        return;
      }
    }

    json(res, 404, { message: `mock: no handler for ${method} ${path}` });
  } catch (e) {
    console.error('[mock] handler error:', e);
    json(res, 500, { message: 'mock server error', details: String(e) });
  }
});

server.listen(PORT, () => {
  console.log(`Mock Supabase running on http://localhost:${PORT}`);
  console.log('Sign-in mapping: Spotify/Apple → "demo" (onboarded), Google → "newbie" (onboarding flow)');
  console.log(`Data: ${Object.entries(tables).filter(([, v]) => v.length).map(([k, v]) => `${k}:${v.length}`).join('  ')}`);
});
