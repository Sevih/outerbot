/**
 * Resync sur un faux forum (aucun appel à Discord ni au site) : il reconstruit
 * le même index que le direct, et ne se croise pas avec le forum-sync. Forum-sync
 * et resync remplissent les ids d'abord : ni la migration v3 ni un renommage
 * ne créent de post en double.
 */
import { ChannelType, Collection, type Client } from 'discord.js';
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.hoisted(() => {
  Object.assign(process.env, {
    GUILD_ID: 'g1',
    DISCORD_TOKEN: 'jeton-de-test',
    CLIENT_ID: 'c1',
    ADMIN_USER_ID: 'a1',
    REVIEW_FORUM_ID: 'forum',
    REVIEW_MIN_AGE_DAYS: '30',
    REVIEW_ROLE_IDS: '',
  });
});

const { getCharacters } = vi.hoisted(() => ({
  getCharacters: vi.fn<(force?: boolean) => Promise<WikiCharacter[]>>(),
}));
vi.mock('../src/wiki/client.js', () => ({ wiki: { getCharacters } }));

import { openDb } from '../src/db/db.js';
import { Store } from '../src/db/store.js';
import { resyncFromDiscord } from '../src/reviews/resync.js';
import { syncForumPosts } from '../src/reviews/forum-sync.js';
import { tryAddReview } from '../src/reviews/listener.js';
import type { WikiCharacter } from '../src/wiki/client.js';

const DAHLIA: WikiCharacter = {
  slug: 'dahlia',
  name: 'Dahlia',
  element: 'fire',
  class: 'striker',
  rarity: 3,
  id: '1',
};
const OLD_ACCOUNT = Date.UTC(2020, 0, 1);

/** Un message tel que l'API REST le rend (sans membre). */
function msg(
  id: string,
  userId: string,
  content: string,
  createdAt: string,
  reactions: [string, { count: number; me: boolean }][] = [],
) {
  const date = new Date(createdAt);
  return {
    id,
    content,
    member: null,
    createdAt: date,
    createdTimestamp: date.getTime(),
    author: {
      id: userId,
      bot: false,
      createdTimestamp: OLD_ACCOUNT,
      username: userId,
      displayName: userId,
      avatar: null,
    },
    reactions: { cache: new Map(reactions) },
  };
}

/** Faux client : un forum, un fil, ses messages du plus récent au plus ancien. */
function fakeClient(messages: ReturnType<typeof msg>[], threadName = 'Dahlia') {
  const thread = {
    id: 't1',
    name: threadName,
    messages: {
      fetch: () => Promise.resolve(new Collection(messages.map((m) => [m.id, m]))),
    },
  };
  const forum = {
    type: ChannelType.GuildForum,
    threads: {
      fetch: () => Promise.resolve({ threads: new Collection([[thread.id, thread]]) }),
      fetchArchived: () => Promise.resolve({ threads: new Collection(), hasMore: false }),
    },
  };
  const fetchChannel = vi.fn(() => Promise.resolve(forum));
  return { client: { channels: { fetch: fetchChannel } } as unknown as Client, fetchChannel };
}

let store: Store;

beforeEach(() => {
  store = new Store(openDb(':memory:'));
  store.registerThread('t1', '1', 'dahlia');
  getCharacters.mockReset();
  getCharacters.mockResolvedValue([DAHLIA]);
});

describe('resyncFromDiscord — même index que le direct', () => {
  it('doublons d’un membre : garde la plus ancienne review, comme le direct', async () => {
    const { client } = fakeClient([
      msg('m3', 'u1', '2/5\nTroisième avis.', '2026-07-03T00:00:00Z'),
      msg('m2', 'u2', '5/5\nAutre membre.', '2026-07-02T00:00:00Z'),
      msg('m1', 'u1', '4/5\nPremier avis.', '2026-07-01T00:00:00Z'),
    ]);
    const report = await resyncFromDiscord(client, store);
    expect(report.reviews).toBe(2);
    const byUser = Object.fromEntries(store.reviewsFor('1').map((r) => [r.userId, r]));
    expect(byUser.u1).toMatchObject({ id: 'm1', rating: 4, text: 'Premier avis.' });
    expect(byUser.u2).toMatchObject({ id: 'm2' });
  });

  it('un message plus ancien mais hors format ne prend pas la place', async () => {
    const { client } = fakeClient([
      msg('m2', 'u1', '3/5\nAu format.', '2026-07-02T00:00:00Z'),
      msg('m1', 'u1', 'bonjour', '2026-07-01T00:00:00Z'),
    ]);
    await resyncFromDiscord(client, store);
    expect(store.reviewsFor('1').map((r) => r.id)).toEqual(['m2']);
  });

  it('score : la réaction du bot n’est retirée que si elle est là', async () => {
    const { client } = fakeClient([
      // Amorce posée : 3 👍 dont le bot, 1 👎 (le bot seul).
      msg('m1', 'u1', '4/5\nAmorce posée.', '2026-07-01T00:00:00Z', [
        ['👍', { count: 3, me: true }],
        ['👎', { count: 1, me: true }],
      ]),
      // Amorce ratée : 2 👍 de membres, pas de 👎.
      msg('m2', 'u2', '4/5\nAmorce ratée.', '2026-07-02T00:00:00Z', [
        ['👍', { count: 2, me: false }],
      ]),
    ]);
    await resyncFromDiscord(client, store);
    const score = Object.fromEntries(store.reviewsFor('1').map((r) => [r.id, r.score]));
    expect(score).toEqual({ m1: 2, m2: 2 });
  });
});

describe('resync et forum-sync passent l’un après l’autre', () => {
  it('un resync lancé pendant un forum-sync attend sa fin', async () => {
    const { client, fetchChannel } = fakeClient([]);
    let release!: (c: WikiCharacter[]) => void;
    getCharacters.mockImplementationOnce(() => new Promise((r) => (release = r)));

    const sync = syncForumPosts(client, store, true);
    const resync = resyncFromDiscord(client, store);
    await new Promise((r) => setTimeout(r, 0));
    expect(getCharacters).toHaveBeenCalledOnce(); // le forum-sync seul
    expect(fetchChannel).not.toHaveBeenCalled(); // le resync n'a pas commencé

    release([DAHLIA]); // dahlia a son post : rien à créer
    await sync;
    await resync;
    expect(fetchChannel).toHaveBeenCalledOnce();
    expect(store.knownCharacterIds()).toEqual(new Set(['1']));
  });
});

/** Une review de dahlia (t1) telle que l'index la porte. */
function indexedReview(characterId: string | null, slug: string) {
  return {
    messageId: 'm1',
    threadId: 't1',
    characterId,
    slug,
    userId: 'u1',
    username: 'u1',
    displayName: 'u1',
    avatar: null,
    rating: 4,
    text: 'Avis.',
    createdAt: '2026-07-01T00:00:00.000Z',
  };
}

describe('id du perso : migration v3 et renommage', () => {
  it('juste après la migration, avant tout remplissage : aucun post créé', async () => {
    // L'état d'une base v2 migrée : toutes les lignes sans id.
    store.replaceAll(
      [{ threadId: 't1', characterId: null, slug: 'dahlia' }],
      [indexedReview(null, 'dahlia')],
    );
    expect(store.knownCharacterIds()).toEqual(new Set());
    const { client, fetchChannel } = fakeClient([]);

    const report = await syncForumPosts(client, store, true);
    expect(report.created).toEqual([]);
    expect(fetchChannel).not.toHaveBeenCalled(); // forum jamais ouvert : rien à créer
    expect(store.knownCharacterIds()).toEqual(new Set(['1']));
    expect(store.reviewsFor('1').map((r) => r.id)).toEqual(['m1']);
  });

  it('perso renommé (même id) : reviews, post et lien de build gardés', async () => {
    store.addReview(indexedReview('1', 'dahlia'));
    store.setBuildThread('1', 'dahlia', '111');
    getCharacters.mockResolvedValue([{ ...DAHLIA, slug: 'dahlia-prime', name: 'Dahlia Prime' }]);
    const { client, fetchChannel } = fakeClient(
      [msg('m1', 'u1', '4/5\nAvis.', '2026-07-01T00:00:00Z')],
      'Dahlia', // le post garde l'ancien nom
    );

    await syncForumPosts(client, store, true);
    expect(fetchChannel).not.toHaveBeenCalled();
    expect(store.reviewsFor('1').map((r) => r.id)).toEqual(['m1']);
    expect(store.buildThread('1')).toEqual({ threadId: '111', infoThreadId: null });

    // Le resync relie le post par l'id de la base (pas par son nom, périmé) et
    // réécrit le slug courant.
    const report = await resyncFromDiscord(client, store);
    expect(report.unresolved).toEqual([]);
    expect(store.characterForThread('t1')).toEqual({ characterId: '1', slug: 'dahlia-prime' });
    expect(Object.keys(store.summary())).toEqual(['dahlia-prime']);
    expect(store.reviewsFor('1').map((r) => r.id)).toEqual(['m1']);
  });

  it('ancien post d’un slug périmé, au nom d’un perso qui a son post : gardé sans id', async () => {
    store.registerThread('t2', null, 'dahlia-2');
    const thread = (id: string) => ({
      id,
      name: 'Dahlia',
      messages: { fetch: () => Promise.resolve(new Collection()) },
    });
    const forum = {
      type: ChannelType.GuildForum,
      threads: {
        fetch: () =>
          Promise.resolve({
            threads: new Collection([
              ['t1', thread('t1')],
              ['t2', thread('t2')],
            ]),
          }),
        fetchArchived: () => Promise.resolve({ threads: new Collection(), hasMore: false }),
      },
    };
    const client = {
      channels: { fetch: () => Promise.resolve(forum) },
    } as unknown as Client;

    const report = await resyncFromDiscord(client, store);
    expect(report.unresolved).toEqual([]);
    expect(store.characterForThread('t1')).toEqual({ characterId: '1', slug: 'dahlia' });
    expect(store.characterForThread('t2')).toBeUndefined();
    expect(store.unresolvedSlugs()).toEqual(['dahlia-2']);
  });

  it('resync sur une base pas encore remplie : ids posés d’abord', async () => {
    store.registerThread('t1', null, 'dahlia');
    const { client } = fakeClient([msg('m1', 'u1', '4/5\nAvis.', '2026-07-01T00:00:00Z')], 'Autre');
    const report = await resyncFromDiscord(client, store);
    expect(report.unresolved).toEqual([]);
    expect(store.characterForThread('t1')).toEqual({ characterId: '1', slug: 'dahlia' });
    expect(store.reviewsFor('1').map((r) => r.id)).toEqual(['m1']);
  });
});

describe('tryAddReview — dépôt en direct par id', () => {
  const live = (id: string, threadId = 't1') =>
    ({
      id,
      channelId: threadId,
      content: '4/5\nTrès bon.',
      member: null,
      createdAt: new Date('2026-07-01T00:00:00Z'),
      author: { id: 'u1', username: 'u1', displayName: 'u1', avatar: null },
    }) as unknown as Parameters<typeof tryAddReview>[1];

  it('même membre, même perso : le second est refusé', () => {
    expect(tryAddReview(store, live('m1'))).toBeNull();
    expect(tryAddReview(store, live('m2'))).toBe('duplicate');
    expect(store.reviewsFor('1').map((r) => r.id)).toEqual(['m1']);
  });

  it('post pas encore rempli : ignoré comme un fil inconnu', () => {
    store.registerThread('t1', null, 'dahlia');
    expect(tryAddReview(store, live('m1'))).toBe('unknown_thread');
  });
});
