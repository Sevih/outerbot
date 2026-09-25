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
 */
import Database from 'better-sqlite3';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';

const MIGRATIONS: string[] = [
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
  -- kind = 'coupon' | 'news' ; key = code du coupon, ou date|titre de l'entrée.
  CREATE TABLE announcements (
    kind         TEXT NOT NULL,
    key          TEXT NOT NULL,
    announced_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
    PRIMARY KEY (kind, key)
  );
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
