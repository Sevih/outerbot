/**
 * Démarrage du forum-sync : sur base vide, resync d'abord ; un resync raté ne
 * bloque pas tout, il se retente jusqu'à réussir, puis la boucle démarre.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { indexThenStart } from '../src/reviews/boot.js';

beforeEach(() => {
  vi.useFakeTimers();
});
afterEach(() => {
  vi.useRealTimers();
});

const deps = (over: Partial<Parameters<typeof indexThenStart>[0]> = {}) => ({
  isEmpty: vi.fn(() => true),
  resync: vi.fn(() => Promise.resolve()),
  start: vi.fn(),
  onError: vi.fn(),
  retryMs: 60_000,
  ...over,
});

describe('indexThenStart', () => {
  it('base déjà remplie : démarre sans resync', async () => {
    const d = deps({ isEmpty: vi.fn(() => false) });
    await indexThenStart(d);
    expect(d.resync).not.toHaveBeenCalled();
    expect(d.start).toHaveBeenCalledOnce();
  });

  it('base vide : resync, puis démarrage', async () => {
    const d = deps();
    await indexThenStart(d);
    expect(d.resync).toHaveBeenCalledOnce();
    expect(d.start).toHaveBeenCalledOnce();
  });

  it('resync raté : pas de forum-sync, nouvel essai au tick suivant, puis démarrage', async () => {
    const d = deps({
      resync: vi
        .fn<() => Promise<void>>()
        .mockRejectedValueOnce(new Error('site pas prêt'))
        .mockRejectedValueOnce(new Error('site pas prêt'))
        .mockResolvedValue(undefined),
    });
    await indexThenStart(d);
    expect(d.start).not.toHaveBeenCalled();
    expect(d.onError).toHaveBeenCalledOnce();

    await vi.advanceTimersByTimeAsync(60_000);
    expect(d.resync).toHaveBeenCalledTimes(2);
    expect(d.start).not.toHaveBeenCalled();

    await vi.advanceTimersByTimeAsync(60_000);
    expect(d.resync).toHaveBeenCalledTimes(3);
    expect(d.start).toHaveBeenCalledOnce();

    await vi.advanceTimersByTimeAsync(10 * 60_000);
    expect(d.resync).toHaveBeenCalledTimes(3);
  });

  it('base remplie entre deux essais (/admin resync) : démarre sans nouveau resync', async () => {
    let empty = true;
    const d = deps({
      isEmpty: vi.fn(() => empty),
      resync: vi.fn(() => Promise.reject(new Error('panne'))),
    });
    await indexThenStart(d);
    empty = false;
    await vi.advanceTimersByTimeAsync(60_000);
    expect(d.resync).toHaveBeenCalledOnce();
    expect(d.start).toHaveBeenCalledOnce();
  });
});
