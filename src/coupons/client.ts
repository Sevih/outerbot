/**
 * Client de la route INTERNE des codes promo du site (`/api/internal/coupons`),
 * jeton `COUPON_API_SECRET`. C'est le site qui valide et écrit (liste vivante
 * sur R2) : le bot ne fait que proposer et relayer.
 */
import { config } from '../config.js';

export interface LiveCoupon {
  code: string;
  start: string;
  end: string;
  rewards: { id: string; name: string; qty: string }[];
}

export interface RewardChoice {
  id: string;
  name: string;
}

/** Opération envoyée au site (miroir de `CouponOp` d'outerpedia). */
export type CouponOp =
  | { action: 'add'; coupon: RawCoupon }
  | { action: 'edit'; code: string; coupon: RawCoupon }
  | { action: 'remove'; code: string };

/** Format stocké : récompenses en `{ id: quantité }`. */
export interface RawCoupon {
  code: string;
  start: string;
  end: string;
  description: Record<string, string>;
}

export type ApplyResult = { ok: true } | { ok: false; errors: string[] };

async function call<T>(path: string, init: RequestInit = {}): Promise<{ status: number; body: T }> {
  const res = await fetch(`${config.wikiApiUrl}${path}`, {
    ...init,
    headers: {
      ...init.headers,
      accept: 'application/json',
      authorization: `Bearer ${config.coupons.apiSecret}`,
    },
    signal: AbortSignal.timeout(15_000),
  });
  const body = (await res.json().catch(() => ({}))) as T;
  return { status: res.status, body };
}

/** La liste bouge peu : un cache court suffit à l'autocomplétion, qui tape à chaque touche. */
const LIST_TTL_MS = 30_000;
let listCache: { data: LiveCoupon[]; at: number } | undefined;

export const couponApi = {
  enabled: (): boolean => Boolean(config.coupons.apiSecret),

  async list(force = false): Promise<LiveCoupon[]> {
    if (!force && listCache && Date.now() - listCache.at < LIST_TTL_MS) return listCache.data;
    const { status, body } = await call<LiveCoupon[]>('/api/internal/coupons');
    if (status !== 200 || !Array.isArray(body)) throw new Error(`coupons → HTTP ${status}`);
    listCache = { data: body, at: Date.now() };
    return body;
  },

  async searchRewards(query: string): Promise<RewardChoice[]> {
    const { status, body } = await call<RewardChoice[]>(
      `/api/internal/coupons/rewards?q=${encodeURIComponent(query)}`,
    );
    return status === 200 && Array.isArray(body) ? body : [];
  },

  /** Noms EN des ids (`null` = id inconnu du catalogue). */
  async rewardNames(ids: string[]): Promise<Map<string, string | null>> {
    const { status, body } = await call<{ id: string; name: string | null }[]>(
      `/api/internal/coupons/rewards?ids=${ids.map(encodeURIComponent).join(',')}`,
    );
    if (status !== 200 || !Array.isArray(body)) throw new Error(`rewards → HTTP ${status}`);
    return new Map(body.map((r) => [r.id, r.name]));
  },

  async apply(op: CouponOp): Promise<ApplyResult> {
    const { status, body } = await call<{ ok?: boolean; errors?: string[] }>(
      '/api/internal/coupons',
      { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(op) },
    );
    listCache = undefined; // la liste a (peut-être) changé
    if (status === 200 && body.ok) return { ok: true };
    return { ok: false, errors: body.errors?.length ? body.errors : [`HTTP ${status}`] };
  },
};
