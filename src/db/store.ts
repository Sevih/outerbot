/**
 * Store — les requêtes du bot, préparées et typées. Une instance par process,
 * construite sur la base ouverte (`openDb`). C'est la SEULE porte d'accès à
 * SQLite : les modules (listener, HTTP, commandes) ne voient que ces méthodes.
 *
 * Un perso se désigne par son id (`characterId`) ; le slug n'est écrit qu'à
 * côté, pour l'affichage et le repli (cf. l'en-tête de db.ts).
 */
import type { Db } from './db.js';
import type { Review } from '../reviews/core.js';

/** Ligne interne de la table reviews. */
interface ReviewRow {
  message_id: string;
  thread_id: string;
  character_id: string | null;
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
  /**
   * Null : post pas encore rempli, ou d'un slug que le site ne connaît plus —
   * gardé par le resync et le listener, rempli par `backfillCharacterIds`.
   */
  characterId: string | null;
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

  registerThread(threadId: string, characterId: string | null, slug: string): void {
    this.db
      .prepare(
        `INSERT INTO threads (thread_id, character_id, slug) VALUES (?, ?, ?)
         ON CONFLICT(thread_id) DO UPDATE SET character_id = excluded.character_id,
                                              slug = excluded.slug`,
      )
      .run(threadId, characterId, slug);
  }

  /**
   * Le perso d'un post, et le slug écrit avec lui (repris par ses reviews).
   * Un post pas encore rempli (id NULL) n'en a pas.
   */
  characterForThread(threadId: string): { characterId: string; slug: string } | undefined {
    const row = this.db
      .prepare(
        'SELECT character_id, slug FROM threads WHERE thread_id = ? AND character_id IS NOT NULL',
      )
      .get(threadId) as { character_id: string; slug: string } | undefined;
    return row ? { characterId: row.character_id, slug: row.slug } : undefined;
  }

  /**
   * La ligne d'un post telle quelle, id NULL compris (post connu mais pas encore
   * rempli) ; undefined pour un thread absent de la base.
   */
  threadOf(threadId: string): { characterId: string | null; slug: string } | undefined {
    const row = this.db
      .prepare('SELECT character_id, slug FROM threads WHERE thread_id = ?')
      .get(threadId) as { character_id: string | null; slug: string } | undefined;
    return row ? { characterId: row.character_id, slug: row.slug } : undefined;
  }

  /** Tous les mappings thread → perso (id NULL : pas encore rempli). */
  allThreads(): { threadId: string; characterId: string | null; slug: string }[] {
    const rows = this.db.prepare('SELECT thread_id, character_id, slug FROM threads').all() as {
      thread_id: string;
      character_id: string | null;
      slug: string;
    }[];
    return rows.map((r) => ({ threadId: r.thread_id, characterId: r.character_id, slug: r.slug }));
  }

  /** Ids des persos qui ont déjà leur post forum. */
  knownCharacterIds(): Set<string> {
    const rows = this.db
      .prepare('SELECT character_id FROM threads WHERE character_id IS NOT NULL')
      .all() as { character_id: string }[];
    return new Set(rows.map((r) => r.character_id));
  }

  /** Posts indexés, remplis ou non (base vide au démarrage, /health, /status). */
  countThreads(): number {
    const row = this.db.prepare('SELECT COUNT(*) AS n FROM threads').get() as { n: number };
    return row.n;
  }

  // ── Remplissage des ids (migration v3) ────────────────────────────────────

  /**
   * Pose `character_id` d'après le slug sur les lignes qui n'en ont pas, dans
   * les trois tables, en une transaction, avec la liste de persos du site.
   * Une ligne que l'id ferait entrer en collision (index unique) reste NULL.
   * Rend les slugs encore non résolus.
   */
  backfillCharacterIds(characters: readonly { id: string; slug: string }[]): string[] {
    const updates = ['threads', 'reviews', 'build_threads'].map((table) =>
      this.db.prepare(
        `UPDATE OR IGNORE ${table} SET character_id = ? WHERE slug = ? AND character_id IS NULL`,
      ),
    );
    this.db.transaction(() => {
      for (const c of characters) for (const update of updates) update.run(c.id, c.slug);
    })();
    return this.unresolvedSlugs();
  }

  /** Slugs de lignes encore sans id, toutes tables confondues (/status). */
  unresolvedSlugs(): string[] {
    const rows = this.db
      .prepare(
        `SELECT slug FROM threads WHERE character_id IS NULL
         UNION SELECT slug FROM reviews WHERE character_id IS NULL
         UNION SELECT slug FROM build_threads WHERE character_id IS NULL
         ORDER BY slug`,
      )
      .all() as { slug: string }[];
    return rows.map((r) => r.slug);
  }

  // ── Reviews ───────────────────────────────────────────────────────────────

  hasReview(characterId: string, userId: string): boolean {
    return Boolean(
      this.db
        .prepare('SELECT 1 FROM reviews WHERE character_id = ? AND user_id = ?')
        .get(characterId, userId),
    );
  }

  /**
   * Doublon d'une review encore sans id, par son slug : l'index unique
   * (perso, utilisateur) ne couvre pas les NULL, c'est au code de dédoublonner.
   */
  hasReviewBySlug(slug: string, userId: string): boolean {
    return Boolean(
      this.db
        .prepare('SELECT 1 FROM reviews WHERE character_id IS NULL AND slug = ? AND user_id = ?')
        .get(slug, userId),
    );
  }

  addReview(r: NewReview): void {
    this.db
      .prepare(
        `INSERT INTO reviews (message_id, thread_id, character_id, slug, user_id, username,
                              display_name, avatar, rating, text, score, created_at)
         VALUES (@messageId, @threadId, @characterId, @slug, @userId, @username,
                 @displayName, @avatar, @rating, @text, @score, @createdAt)`,
      )
      .run({ score: 0, ...r });
  }

  removeReviewByMessage(messageId: string): boolean {
    return this.db.prepare('DELETE FROM reviews WHERE message_id = ?').run(messageId).changes > 0;
  }

  /** Suppression groupée (purge) : renvoie le nombre de reviews retirées. */
  removeReviewsByMessages(messageIds: Iterable<string>): number {
    const del = this.db.prepare('DELETE FROM reviews WHERE message_id = ?');
    return this.db.transaction(() => {
      let n = 0;
      for (const id of messageIds) n += del.run(id).changes;
      return n;
    })();
  }

  /** Message édité : nouvelle note et nouveau texte, score et date gardés. */
  updateReviewContent(messageId: string, rating: number, text: string): boolean {
    return (
      this.db
        .prepare('UPDATE reviews SET rating = ?, text = ? WHERE message_id = ?')
        .run(rating, text, messageId).changes > 0
    );
  }

  /** Vote 👍/👎 : delta ±1 sur le score. */
  applyVote(messageId: string, delta: number): void {
    this.db
      .prepare('UPDATE reviews SET score = score + ? WHERE message_id = ?')
      .run(delta, messageId);
  }

  /** Score recalculé depuis Discord (réactions vidées par la modération). */
  setScore(messageId: string, score: number): boolean {
    return (
      this.db.prepare('UPDATE reviews SET score = ? WHERE message_id = ?').run(score, messageId)
        .changes > 0
    );
  }

  /**
   * Post supprimé : le fil et ses reviews (cascade) sortent de l'index, et le
   * perso redevient « sans post » pour le forum-sync, comme après un resync.
   */
  removeThread(threadId: string): boolean {
    return this.db.prepare('DELETE FROM threads WHERE thread_id = ?').run(threadId).changes > 0;
  }

  /**
   * Reviews d'un perso, meilleures d'abord (score puis récence) — l'ordre V2.
   * `unfilledSlug` : y joindre les lignes de ce slug pas encore remplies.
   */
  reviewsFor(characterId: string, unfilledSlug?: string): Review[] {
    const rows = this.db
      .prepare(
        `SELECT * FROM reviews
         WHERE character_id = ? OR (character_id IS NULL AND slug = ?)
         ORDER BY score DESC, created_at DESC`,
      )
      .all(characterId, unfilledSlug ?? null) as ReviewRow[];
    return rows.map(toReview);
  }

  /** Repli quand le slug ne se résout pas en id (site injoignable) : la colonne slug. */
  reviewsForSlug(slug: string): Review[] {
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
  replaceAll(
    threads: { threadId: string; characterId: string | null; slug: string }[],
    reviews: NewReview[],
  ): void {
    this.db.transaction(() => {
      this.db.prepare('DELETE FROM reviews').run();
      this.db.prepare('DELETE FROM threads').run();
      for (const t of threads) this.registerThread(t.threadId, t.characterId, t.slug);
      for (const r of reviews) this.addReview(r);
    })();
  }

  // ── Builds curés (ex-threads.json) ────────────────────────────────────────

  /** Lien de build d'un perso ; le slug courant est réécrit avec. */
  setBuildThread(characterId: string, slug: string, threadId: string, infoThreadId?: string): void {
    this.db
      .prepare(
        `INSERT INTO build_threads (character_id, slug, thread_id, info_thread_id)
         VALUES (?, ?, ?, ?)
         ON CONFLICT(character_id) DO UPDATE SET slug = excluded.slug,
                                                 thread_id = excluded.thread_id,
                                                 info_thread_id = excluded.info_thread_id`,
      )
      .run(characterId, slug, threadId, infoThreadId ?? null);
  }

  buildThread(characterId: string): { threadId: string; infoThreadId: string | null } | undefined {
    const row = this.db
      .prepare('SELECT thread_id, info_thread_id FROM build_threads WHERE character_id = ?')
      .get(characterId) as { thread_id: string; info_thread_id: string | null } | undefined;
    return row ? { threadId: row.thread_id, infoThreadId: row.info_thread_id } : undefined;
  }

  removeBuildThread(characterId: string): boolean {
    return (
      this.db.prepare('DELETE FROM build_threads WHERE character_id = ?').run(characterId).changes >
      0
    );
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
