import { describe, it } from 'node:test';
import assert from 'node:assert';

describe('Daily Crawl & Rotation Policy', () => {
  function getCrawlPlan(state: { last_run_date: string; total_processed_today: number; see_all_page: number }, todayDate: string) {
    let effectiveState = { ...state };
    let wasReset = false;

    if (effectiveState.last_run_date !== todayDate) {
      effectiveState = {
        last_run_date: todayDate,
        total_processed_today: 0,
        see_all_page: 1
      };
      wasReset = true;
    }

    const isFirstBatch = effectiveState.total_processed_today === 0;
    const primarySource = isFirstBatch ? 'new-releases' : 'see-all';
    const seeAllPage = isFirstBatch ? 1 : effectiveState.see_all_page;

    return {
      wasReset,
      primarySource,
      seeAllPage,
      effectiveState
    };
  }

  it('resets daily counters when a new day is detected', () => {
    const yesterdayState = {
      last_run_date: '2026-09-15',
      total_processed_today: 60,
      see_all_page: 4
    };

    const plan = getCrawlPlan(yesterdayState, '2026-09-16');
    assert.strictEqual(plan.wasReset, true);
    assert.strictEqual(plan.primarySource, 'new-releases');
    assert.strictEqual(plan.effectiveState.total_processed_today, 0);
    assert.strictEqual(plan.effectiveState.see_all_page, 1);
  });

  it('uses New Releases for the first batch of the day', () => {
    const freshDayState = {
      last_run_date: '2026-09-16',
      total_processed_today: 0,
      see_all_page: 1
    };

    const plan = getCrawlPlan(freshDayState, '2026-09-16');
    assert.strictEqual(plan.wasReset, false);
    assert.strictEqual(plan.primarySource, 'new-releases');
  });

  it('uses SEE ALL with current page for subsequent runs on the same day', () => {
    const middayState = {
      last_run_date: '2026-09-16',
      total_processed_today: 20,
      see_all_page: 2
    };

    const plan = getCrawlPlan(middayState, '2026-09-16');
    assert.strictEqual(plan.wasReset, false);
    assert.strictEqual(plan.primarySource, 'see-all');
    assert.strictEqual(plan.seeAllPage, 2);
  });

  it('extracts valid game slugs and filters navigation blacklisted paths', () => {
    const blacklist = ['all', 'pc', 'ps5', 'ps4', 'xbox-series-x', 'xbox-one', 'nintendo-switch', 'news', 'features'];
    
    function parseGameSlug(href: string): string | null {
      const match = href.match(/^\/game\/([a-z0-9-]+)\/?$/i);
      if (!match) return null;
      const slug = match[1].toLowerCase();
      return blacklist.includes(slug) ? null : slug;
    }

    assert.strictEqual(parseGameSlug('/game/marvels-wolverine/'), 'marvels-wolverine');
    assert.strictEqual(parseGameSlug('/game/nhl-27/'), 'nhl-27');
    assert.strictEqual(parseGameSlug('/game/valheim'), 'valheim');
    assert.strictEqual(parseGameSlug('/game/pc/'), null);
    assert.strictEqual(parseGameSlug('/game/all/'), null);
    assert.strictEqual(parseGameSlug('/movie/some-movie/'), null);
  });
});
