/**
 * Verrou partagé du forum-sync et du resync : un passage attend la fin du
 * précédent, et un passage en échec ne bloque pas les suivants.
 */
import { describe, expect, it } from 'vitest';
import { withIndexLock } from '../src/reviews/index-lock.js';

const deferred = () => {
  let resolve!: () => void;
  let reject!: (e: Error) => void;
  const promise = new Promise<void>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
};

describe('withIndexLock', () => {
  it('le second passage ne commence qu’après la fin du premier', async () => {
    const order: string[] = [];
    const gate = deferred();
    const first = withIndexLock(async () => {
      order.push('début 1');
      await gate.promise;
      order.push('fin 1');
      return 1;
    });
    const second = withIndexLock(() => {
      order.push('début 2');
      return Promise.resolve(2);
    });
    await Promise.resolve();
    expect(order).toEqual(['début 1']);
    gate.resolve();
    expect(await Promise.all([first, second])).toEqual([1, 2]);
    expect(order).toEqual(['début 1', 'fin 1', 'début 2']);
  });

  it('un passage en échec rend son erreur et libère le verrou', async () => {
    const gate = deferred();
    const failing = withIndexLock(() => gate.promise);
    const next = withIndexLock(() => Promise.resolve('ok'));
    gate.reject(new Error('site injoignable'));
    await expect(failing).rejects.toThrow('site injoignable');
    expect(await next).toBe('ok');
  });
});
