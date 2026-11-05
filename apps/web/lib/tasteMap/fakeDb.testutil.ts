/**
 * A chainable stand-in for the Supabase client in route/payload tests. Records
 * every query (table, operation, payload, filters) when it is awaited, and
 * answers from a per-test responder. Never touches a network.
 */
import type { SupabaseClient } from '@supabase/supabase-js';

export type Op = 'select' | 'insert' | 'upsert' | 'update' | 'delete';

export interface FakeCall {
  table: string;
  op: Op;
  cols?: string;
  payload?: unknown;
  options?: unknown;
  filters: [string, ...unknown[]][];
  single: boolean;
}

export interface FakeResult {
  data?: unknown;
  error?: { code?: string; message?: string } | null;
}

export type Responder = (call: FakeCall) => FakeResult | undefined;

class FakeQuery implements PromiseLike<{ data: unknown; error: FakeResult['error'] }> {
  private call: FakeCall;
  constructor(
    table: string,
    private calls: FakeCall[],
    private respond: Responder,
  ) {
    this.call = { table, op: 'select', filters: [], single: false };
  }
  private opSet = false;
  private setOp(op: Op, payload?: unknown, options?: unknown) {
    if (!this.opSet) {
      this.call.op = op;
      this.call.payload = payload;
      this.call.options = options;
      this.opSet = true;
    }
    return this;
  }
  select(cols?: string) {
    if (!this.opSet) this.setOp('select');
    if (this.call.op === 'select') this.call.cols = cols;
    return this;
  }
  insert(rows: unknown, options?: unknown) {
    return this.setOp('insert', rows, options);
  }
  upsert(rows: unknown, options?: unknown) {
    return this.setOp('upsert', rows, options);
  }
  update(values: unknown, options?: unknown) {
    return this.setOp('update', values, options);
  }
  delete(options?: unknown) {
    return this.setOp('delete', undefined, options);
  }
  private filter(name: string, ...args: unknown[]) {
    this.call.filters.push([name, ...args]);
    return this;
  }
  eq(col: string, v: unknown) {
    return this.filter('eq', col, v);
  }
  neq(col: string, v: unknown) {
    return this.filter('neq', col, v);
  }
  in(col: string, v: unknown[]) {
    return this.filter('in', col, v);
  }
  not(col: string, op: string, v: unknown) {
    return this.filter('not', col, op, v);
  }
  order(col: string, opts?: unknown) {
    return this.filter('order', col, opts);
  }
  limit(n: number) {
    return this.filter('limit', n);
  }
  range(from: number, to: number) {
    return this.filter('range', from, to);
  }
  or(expr: string) {
    return this.filter('or', expr);
  }
  overlaps(col: string, v: unknown[]) {
    return this.filter('overlaps', col, v);
  }
  maybeSingle() {
    this.call.single = true;
    return this;
  }
  single() {
    this.call.single = true;
    return this;
  }
  then<A = { data: unknown; error: FakeResult['error'] }, B = never>(
    onfulfilled?: ((value: { data: unknown; error: FakeResult['error'] }) => A | PromiseLike<A>) | null,
    onrejected?: ((reason: unknown) => B | PromiseLike<B>) | null,
  ): PromiseLike<A | B> {
    this.calls.push(this.call);
    const r = this.respond(this.call) ?? {};
    const data = 'data' in r ? r.data : this.call.op === 'select' ? (this.call.single ? null : []) : null;
    return Promise.resolve({ data, error: r.error ?? null }).then(onfulfilled, onrejected);
  }
}

export function fakeDb(respond: Responder = () => undefined): { db: SupabaseClient; calls: FakeCall[] } {
  const calls: FakeCall[] = [];
  const db = { from: (table: string) => new FakeQuery(table, calls, respond) };
  return { db: db as unknown as SupabaseClient, calls };
}

export const hasFilter = (c: FakeCall, name: string, col: string, v?: unknown) =>
  c.filters.some((f) => f[0] === name && f[1] === col && (v === undefined || f[2] === v));

/** Rows of an insert/upsert payload, always as an array. */
export const rowsOf = (c: FakeCall): Record<string, unknown>[] =>
  (Array.isArray(c.payload) ? c.payload : [c.payload]) as Record<string, unknown>[];

export const isWrite = (c: FakeCall) => c.op !== 'select';
