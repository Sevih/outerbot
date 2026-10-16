/**
 * SQLite — l'ÉTAT DE TRAVAIL du bot, jamais la source de vérité.
 *
 * Discord porte le contenu (messages du forum, réactions) : cette base n'est
 * qu'un INDEX reconstructible à tout moment (`/resync`). Elle remplace les
 * fichiers JSON plats du bot V2 (reviews.json / review-threads.json /
 * threads.json), qui étaient committés dans le repo et réécrits en entier à
 * chaque mutation.
 *
 * better-sqlite3 : API synchrone — parfait ici (volumes minuscules, un seul
 * process), transactions réelles, pas de corruption sur un kill. WAL pour que
 * les lectures HTTP ne bloquent jamais les écritures des events Discord.
 *
 * Migrations : un tableau ordonné de scripts, `user_version` comme curseur.
 * Ajouter une migration = pousser un élément — jamais modifier un existant.
 *
 * Clé d'un perso : son ID (`WikiCharacter.id`, stable), depuis v3. Le slug,
 * dérivé du nom anglais affiché et recalculé à chaque build du site, change
 * quand le jeu renomme un perso : il ne sert plus qu'à l'affichage et au repli
 * (lignes pas encore remplies, site injoignable). Les commentaires de v1
 * décrivent le schéma d'alors ; v3 dit ce qui change.
 */
import Database from 'better-sqlite3';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';

/** Exporté pour les tests (une base d'une version donnée). */
export const MIGRATIONS: readonly string[] = [
  // v1 — schéma initial.
  `
  -- Un post du forum #hero-reviews ↔ un perso du wiki. Le slug est POSÉ par le
  -- bot à la création du post (slug canonique du site), jamais déduit du nom
  -- du thread — renommer un post Discord ne casse rien (bug V2).
  CREATE TABLE threads (
    thread_id  TEXT PRIMARY KEY,
    slug       TEXT NOT NULL UNIQUE,
    created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
  );

  -- Une review = un message Discord (PK = message_id). Le score est entretenu
  -- par les events de réaction ; le resync le recalcule depuis Discord.
  CREATE TABLE reviews (
    message_id   TEXT PRIMARY KEY,
    thread_id    TEXT NOT NULL REFERENCES threads(thread_id) ON DELETE CASCADE,
    slug         TEXT NOT NULL,
    user_id      TEXT NOT NULL,
    username     TEXT NOT NULL,
    display_name TEXT NOT NULL,
    avatar       TEXT,
    rating       REAL NOT NULL CHECK (rating BETWEEN 1 AND 5),
    text         TEXT NOT NULL,
    score        INTEGER NOT NULL DEFAULT 0,
    created_at   TEXT NOT NULL,
    UNIQUE (slug, user_id)
  );
  CREATE INDEX idx_reviews_slug ON reviews(slug);

  -- Liens curés vers les threads de build EvaMains (ex-threads.json du bot V2,
  -- maintenu à la main). Édité par la commande admin /link — plus jamais de
  -- commit de donnée. \`info_thread_id\` : l'infographic éventuelle.
  CREATE TABLE build_threads (
    slug            TEXT PRIMARY KEY,
    thread_id       TEXT NOT NULL,
    info_thread_id  TEXT
  );

  -- Métadonnées libres (dernier sync, horodatages…).
  CREATE TABLE meta (
    key   TEXT PRIMARY KEY,
    value TEXT NOT NULL
  );
  `,

  // v2 — annonces Discord déjà postées (coupons, journal du site).
  `
  -- Ce que le bot a DÉJÀ annoncé (ou marqué vu au premier passage). Seule table
  -- non reconstructible depuis Discord : si elle est perdue, le premier passage
  -- suivant remarque tout comme vu SANS poster (pas de rafale d'historique).
  -- kind = 'coupon' | 'news' ; key = code du coupon, ou id de l'entrée du journal
  -- (date|titre pour les anciennes, d'avant l'id servi par le site).
  CREATE TABLE announcements (
    kind         TEXT NOT NULL,
    key          TEXT NOT NULL,
    announced_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
    PRIMARY KEY (kind, key)
  );
  `,

  // v3 — l'id du perso devient la clé ; le slug n'est plus que l'affichage.
  `
  -- Colonnes AJOUTÉES, tables gardées : sous foreign_keys = ON, reconstruire
  -- threads (DROP TABLE) effacerait les reviews par la cascade de
  -- reviews.thread_id, et PRAGMA foreign_keys est sans effet dans la
  -- transaction d'une migration. character_id reste NULL jusqu'au remplissage
  -- (Store.backfillCharacterIds, en tête de chaque forum-sync et resync, avec
  -- la liste de persos du site) ; plusieurs NULL passent un index unique.
  --
  -- Les contraintes de v1 sur slug (threads.slug UNIQUE, reviews UNIQUE (slug,
  -- user_id), build_threads.slug clé primaire) restent. Leur seul effet
  -- désormais : une collision si le slug libéré par un renommage est repris
  -- par un autre perso tant que l'ancienne ligne le porte encore (un resync
  -- réécrit le slug courant de chaque post).
  ALTER TABLE threads ADD COLUMN character_id TEXT;
  ALTER TABLE reviews ADD COLUMN character_id TEXT;
  ALTER TABLE build_threads ADD COLUMN character_id TEXT;

  -- Un post par perso, une review par (perso, membre), un lien de build par perso.
  CREATE UNIQUE INDEX idx_threads_character ON threads(character_id);
  CREATE UNIQUE INDEX idx_reviews_character_user ON reviews(character_id, user_id);
  CREATE UNIQUE INDEX idx_build_threads_character ON build_threads(character_id);
  `,
];

export type Db = Database.Database;

/** Ouvre (et migre) la base. `':memory:'` pour les tests. */
export function openDb(path: string): Db {
  if (path !== ':memory:') mkdirSync(dirname(path), { recursive: true });
  const db = new Database(path);
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');

  const version = db.pragma('user_version', { simple: true }) as number;
  for (let v = version; v < MIGRATIONS.length; v++) {
    const script = MIGRATIONS[v]!;
    db.transaction(() => {
      db.exec(script);
      db.pragma(`user_version = ${v + 1}`);
    })();
  }
  return db;
}
