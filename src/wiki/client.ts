/**
 * Client de l'API interne du site — LA source des données wiki du bot.
 *
 * Le bot V2 embarquait une COPIE des données (GitHub raw → fichiers committés
 * dans son repo, resync manuel à chaque perso). Ici : zéro copie, zéro commit —
 * on interroge le site (réseau Docker en prod, localhost en dev) qui sert des
 * routes dédiées `/api/bot/*` (ISR côté site). Contrat volontairement MINCE :
 * uniquement ce que les embeds Discord affichent.
 *
 * Cache mémoire TTL : les commandes ne déclenchent jamais un fetch synchrone
 * pénible — un autocomplete tape dans le cache, point. Si le site est
 * injoignable au refresh, on GARDE la version précédente (stale) : le bot
 * dégrade, il ne casse pas.
 */
import { config } from '../config.js';
import { logger } from '../lib/logger.js';

/** Un perso tel que le bot en a besoin (création de post forum + /char). */
export interface WikiCharacter {
  slug: string;
  name: string;
  element: string;
  class: string;
  rarity: number;
  /** Id du jeu — sert l'URL du portrait ATB dans les embeds. */
  id: string;
}

/** Un guide (catégorie + slug + titre EN) pour /guide. */
export interface WikiGuide {
  category: string;
  slug: string;
  title: string;
}

/** Un équipement pour /item — champs des embeds V2, rien de plus. */
export interface WikiItem {
  type: 'weapon' | 'amulet' | 'set' | 'talisman' | 'ee';
  slug: string;
  name: string;
  icon: string;
  classLimit?: string;
  /** Nom + paliers du passif, pré-formatés côté site. */
  effectName?: string;
  effectTiers?: string[];
  /** Source d'obtention en clair (boss, boutique…). */
  source?: string;
  /** EE : le porteur. */
  characterName?: string;
}

interface CacheEntry<T> {
  data: T;
  fetchedAt: number;
}

const TTL_MS = 60 * 60 * 1000; // 1 h — le cron de sync force un refresh de toute façon.

export class WikiClient {
  private characters?: CacheEntry<WikiCharacter[]>;
  private guides?: CacheEntry<WikiGuide[]>;
  private items?: CacheEntry<WikiItem[]>;

  private async fetchJson<T>(path: string): Promise<T> {
    const res = await fetch(`${config.wikiApiUrl}${path}`, {
      headers: { accept: 'application/json' },
      signal: AbortSignal.timeout(15_000),
    });
    if (!res.ok) throw new Error(`${path} → HTTP ${res.status}`);
    return (await res.json()) as T;
  }

  /**
   * Lecture avec cache TTL + repli stale : une erreur de refresh LOG et sert
   * l'ancienne donnée ; elle ne remonte que s'il n'y a jamais rien eu.
   */
  private async cached<T>(
    entry: CacheEntry<T> | undefined,
    path: string,
    put: (e: CacheEntry<T>) => void,
    force = false,
  ): Promise<T> {
    const fresh = entry && !force && Date.now() - entry.fetchedAt < TTL_MS;
    if (fresh) return entry.data;
    try {
      const data = await this.fetchJson<T>(path);
      put({ data, fetchedAt: Date.now() });
      return data;
    } catch (e) {
      if (entry) {
        logger.warn(`wiki: refresh ${path} échoué, données stale servies`, e);
        return entry.data;
      }
      throw e;
    }
  }

  getCharacters(force = false): Promise<WikiCharacter[]> {
    return this.cached(this.characters, '/api/bot/characters', (e) => (this.characters = e), force);
  }

  getGuides(force = false): Promise<WikiGuide[]> {
    return this.cached(this.guides, '/api/bot/guides', (e) => (this.guides = e), force);
  }

  getItems(force = false): Promise<WikiItem[]> {
    return this.cached(this.items, '/api/bot/items', (e) => (this.items = e), force);
  }

  /** État pour /status et /health. */
  status(): { charactersCount: number; lastFetch: string | null } {
    return {
      charactersCount: this.characters?.data.length ?? 0,
      lastFetch: this.characters ? new Date(this.characters.fetchedAt).toISOString() : null,
    };
  }
}

/** Singleton du process. */
export const wiki = new WikiClient();
