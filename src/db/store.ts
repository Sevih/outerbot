/**
 * Store — les requêtes du bot, préparées et typées. Une instance par process,
 * construite sur la base ouverte (`openDb`). C'est la SEULE porte d'accès à
 * SQLite : les modules (listener, HTTP, commandes) ne voient que ces méthodes.
 */
import type { Db } from './db.js';
import type { Review } from '../reviews/core.js';

/** Ligne interne de la table reviews. */
interface ReviewRow {
  message_id: string;
  thread_id: string;
  slug: string;
  user_id: string;
  username: string;
  display_name: string;
  avatar: string | null;
  rating: number;
  text: string;
  score: number;
  created_at: string;
}

/** Contrat de sortie HTTP (identique à la V2 — `source` est constant). */
function toReview(r: ReviewRow): Review {
  return {
    id: r.message_id,
    userId: r.user_id,
    username: r.username,
    displayName: r.display_name,
    avatar: r.avatar,
    rating: r.rating,
    text: r.text,
    score: r.score,
    source: 'evamains',
    timestamp: r.created_at,
  };
}

export interface NewReview {
  messageId: string;
  threadId: string;
  slug: string;
  userId: string;
  username: string;
  displayName: string;
  avatar: string | null;
  rating: number;
  text: string;
  score?: number;
  createdAt: string;
}

export class Store {
  constructor(private readonly db: Db) {}

  // ── Threads (post forum ↔ perso) ──────────────────────────────────────────

  registerThread(threadId: string, slug: string): void {
    this.db
      .prepare(
        `INSERT INTO threads (thread_id, slug) VALUES (?, ?)
         ON CONFLICT(thread_id) DO UPDATE SET slug = excluded.slug`,
      )
      .run(threadId, slug);
  }

  slugForThread(threadId: string): string | undefined {
    const row = this.db.prepare('SELECT slug FROM threads WHERE thread_id = ?').get(threadId) as
      { slug: string } | undefined;
    return row?.slug;
  }

  /** Tous les mappings thread → slug. */
  allThreads(): { threadId: string; slug: string }[] {
    const rows = this.db.prepare('SELECT thread_id, slug FROM threads').all() as {
      thread_id: string;
      slug: string;
    }[];
    return rows.map((r) => ({ threadId: r.thread_id, slug: r.slug }));
  }

  /** Slugs qui ont déjà leur post forum. */
  knownSlugs(): Set<string> {
    const rows = this.db.prepare('SELECT slug FROM threads').all() as { slug: string }[];
    return new Set(rows.map((r) => r.slug));
  }

  // ── Reviews ───────────────────────────────────────────────────────────────

  hasReview(slug: string, userId: string): boolean {
    return Boolean(
      this.db.prepare('SELECT 1 FROM reviews WHERE slug = ? AND user_id = ?').get(slug, userId),
    );
  }

  addReview(r: NewReview): void {
    this.db
      .prepare(
        `INSERT INTO reviews (message_id, thread_id, slug, user_id, username, display_name,
                              avatar, rating, text, score, created_at)
         VALUES (@messageId, @threadId, @slug, @userId, @username, @displayName,
                 @avatar, @rating, @text, @score, @createdAt)`,
      )
      .run({ score: 0, ...r });
  }

  removeReviewByMessage(messageId: string): boolean {
    return this.db.prepare('DELETE FROM reviews WHERE message_id = ?').run(messageId).changes > 0;
  }

  /** Vote 👍/👎 : delta ±1 sur le score. */
  applyVote(messageId: string, delta: number): void {
    this.db
      .prepare('UPDATE reviews SET score = score + ? WHERE message_id = ?')
      .run(delta, messageId);
  }

  /** Reviews d'un perso, meilleures d'abord (score puis récence) — l'ordre V2. */
  reviewsFor(slug: string): Review[] {
    const rows = this.db
      .prepare('SELECT * FROM reviews WHERE slug = ? ORDER BY score DESC, created_at DESC')
      .all(slug) as ReviewRow[];
    return rows.map(toReview);
  }

  /** Résumé global : { slug: { count, average } } — le contrat `GET /reviews`. */
  summary(): Record<string, { count: number; average: number }> {
    const rows = this.db
      .prepare('SELECT slug, COUNT(*) AS count, AVG(rating) AS avg FROM reviews GROUP BY slug')
      .all() as { slug: string; count: number; avg: number }[];
    const out: Record<string, { count: number; average: number }> = {};
    for (const r of rows) out[r.slug] = { count: r.count, average: Math.round(r.avg * 10) / 10 };
    return out;
  }

  countReviews(): number {
    const row = this.db.prepare('SELECT COUNT(*) AS n FROM reviews').get() as { n: number };
    return row.n;
  }

  /**
   * Remplacement ATOMIQUE de tout l'index reviews + threads (resync depuis
   * Discord) : tout ou rien — un resync interrompu ne laisse pas une base vide.
   */
  replaceAll(threads: { threadId: string; slug: string }[], reviews: NewReview[]): void {
    this.db.transaction(() => {
      this.db.prepare('DELETE FROM reviews').run();
      this.db.prepare('DELETE FROM threads').run();
      for (const t of threads) this.registerThread(t.threadId, t.slug);
      for (const r of reviews) this.addReview(r);
    })();
  }

  // ── Builds curés (ex-threads.json) ────────────────────────────────────────

  setBuildThread(slug: string, threadId: string, infoThreadId?: string): void {
    this.db
      .prepare(
        `INSERT INTO build_threads (slug, thread_id, info_thread_id) VALUES (?, ?, ?)
         ON CONFLICT(slug) DO UPDATE SET thread_id = excluded.thread_id,
                                         info_thread_id = excluded.info_thread_id`,
      )
      .run(slug, threadId, infoThreadId ?? null);
  }

  buildThread(slug: string): { threadId: string; infoThreadId: string | null } | undefined {
    const row = this.db
      .prepare('SELECT thread_id, info_thread_id FROM build_threads WHERE slug = ?')
      .get(slug) as { thread_id: string; info_thread_id: string | null } | undefined;
    return row ? { threadId: row.thread_id, infoThreadId: row.info_thread_id } : undefined;
  }

  removeBuildThread(slug: string): boolean {
    return this.db.prepare('DELETE FROM build_threads WHERE slug = ?').run(slug).changes > 0;
  }

  // ── Annonces (coupons, journal du site) ───────────────────────────────────

  announcedKeys(kind: string): Set<string> {
    const rows = this.db.prepare('SELECT key FROM announcements WHERE kind = ?').all(kind) as {
      key: string;
    }[];
    return new Set(rows.map((r) => r.key));
  }

  markAnnounced(kind: string, keys: string[]): void {
    const insert = this.db.prepare(
      'INSERT INTO announcements (kind, key) VALUES (?, ?) ON CONFLICT(kind, key) DO NOTHING',
    );
    this.db.transaction(() => {
      for (const key of keys) insert.run(kind, key);
    })();
  }

  // ── Méta ──────────────────────────────────────────────────────────────────

  setMeta(key: string, value: string): void {
    this.db
      .prepare(
        'INSERT INTO meta (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value',
      )
      .run(key, value);
  }

  getMeta(key: string): string | undefined {
    const row = this.db.prepare('SELECT value FROM meta WHERE key = ?').get(key) as
      { value: string } | undefined;
    return row?.value;
  }
}
