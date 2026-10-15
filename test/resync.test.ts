/**
 * Resync sur un faux forum (aucun appel à Discord ni au site) : il reconstruit
 * le même index que le direct, et ne se croise pas avec le forum-sync.
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
function fakeClient(messages: ReturnType<typeof msg>[]) {
  const thread = {
    id: 't1',
    name: 'Dahlia',
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
  store.registerThread('t1', 'dahlia');
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
    const byUser = Object.fromEntries(store.reviewsFor('dahlia').map((r) => [r.userId, r]));
    expect(byUser.u1).toMatchObject({ id: 'm1', rating: 4, text: 'Premier avis.' });
    expect(byUser.u2).toMatchObject({ id: 'm2' });
  });

  it('un message plus ancien mais hors format ne prend pas la place', async () => {
    const { client } = fakeClient([
      msg('m2', 'u1', '3/5\nAu format.', '2026-07-02T00:00:00Z'),
      msg('m1', 'u1', 'bonjour', '2026-07-01T00:00:00Z'),
    ]);
    await resyncFromDiscord(client, store);
    expect(store.reviewsFor('dahlia').map((r) => r.id)).toEqual(['m2']);
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
    const score = Object.fromEntries(store.reviewsFor('dahlia').map((r) => [r.id, r.score]));
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
    expect(store.knownSlugs()).toEqual(new Set(['dahlia']));
  });
});
