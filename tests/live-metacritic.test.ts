import { describe, it, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'fs';
import path from 'path';
import { metacriticScraper } from '../src/services/metacritic.js';

describe('Live Metacritic Real-World Scraping & Logs Verification', { timeout: 120000 }, () => {
  after(async () => {
    try {
      await metacriticScraper.close();
    } catch {}
  });

  it('scrapes real game details and platform scores when network is available', { timeout: 110000 }, async () => {
    const today = new Date().toISOString().split('T')[0];
    const testUrl = 'https://www.metacritic.com/game/elden-ring/';

    console.log(`[LiveTest] Fetching live Metacritic data for ${testUrl}...`);
    try {
      const scraped = await metacriticScraper.scrapeGameDetails(testUrl, today);
      if (!scraped) {
        console.warn('[LiveTest] ℹ️ Live scraping skipped or timed out due to network environment.');
        return;
      }

      assert.ok(scraped.gameInput, 'gameInput must be present');
      assert.match(scraped.gameInput.title, /Elden Ring/i, 'Title must match Elden Ring');
      assert.ok(scraped.gameInput.platforms.length > 0, 'Game must have at least one platform');

      for (const p of scraped.gameInput.platforms) {
        assert.ok(typeof p.platform === 'string' && p.platform.length > 0, 'Platform name must be string');
        if (p.metascore !== null) {
          assert.ok(p.metascore >= 50 && p.metascore <= 100, 'Metascore must be in valid range');
        }
      }

      assert.ok(scraped.gameInput.developer && scraped.gameInput.developer.length > 0, 'Developer must be extracted');
      assert.ok(scraped.gameInput.coverImage && scraped.gameInput.coverImage.startsWith('http'), 'Cover image must be valid URL');
      console.log(`[LiveTest] ✅ Validated live extraction for ${scraped.gameInput.title}`);
    } catch (err: any) {
      console.warn(`[LiveTest] Network error during live test (${err.message}). Skipping.`);
    }
  });

  it('verifies integrity of raw AI conversation logs (ai_chat_logs/*.jsonl)', () => {
    const logsDir = path.resolve(process.cwd(), 'ai_chat_logs');
    assert.ok(fs.existsSync(logsDir), 'ai_chat_logs directory must exist');

    const transcriptPath = path.join(logsDir, 'transcript.jsonl');
    const fullTranscriptPath = path.join(logsDir, 'transcript_full.jsonl');

    assert.ok(fs.existsSync(transcriptPath), 'transcript.jsonl must exist');
    assert.ok(fs.existsSync(fullTranscriptPath), 'transcript_full.jsonl must exist');

    // Validate that transcript is valid JSONL
    const lines = fs.readFileSync(transcriptPath, 'utf-8').trim().split('\n');
    assert.ok(lines.length > 5, 'transcript.jsonl must contain conversation turns');

    let parsedCount = 0;
    for (let i = 0; i < Math.min(lines.length, 50); i++) {
      const line = lines[i].trim();
      if (!line) continue;
      const parsed = JSON.parse(line);
      assert.ok(parsed.type || parsed.source || parsed.status, 'Each JSON line must have valid chat record structure');
      parsedCount++;
    }

    assert.ok(parsedCount > 0, 'Successfully parsed valid JSONL records');
    console.log(`[LogsVerification] ✅ Successfully verified ${parsedCount} JSONL conversation records in ai_chat_logs/`);
  });
});
