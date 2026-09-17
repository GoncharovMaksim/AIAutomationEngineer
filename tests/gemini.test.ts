import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { geminiService } from '../src/services/gemini.js';

describe('Gemini Service & Structured Output Schema', () => {
  it('returns honest localized fallback without API call when 0 reviews provided', async () => {
    const res = await geminiService.summarizeReviews('Elden Ring Shadow of the Erdtree', [], []);
    assert.ok(res.criticsSummaryPros.includes('отсутствуют') || res.criticsSummaryPros.includes('пока'));
    assert.ok(res.criticsSummaryCons.length > 0);
    assert.ok(res.usersSummaryPros.includes('отсутствуют') || res.usersSummaryPros.includes('пока'));
    assert.ok(res.usersSummaryCons.length > 0);
  });

  it('validates structured response object contract', async () => {
    // Mock the internal postJson method to verify structured output mapping
    const originalPostJson = (geminiService as any).postJson;
    try {
      (geminiService as any).postJson = async (endpoint: string, payload: any) => {
        assert.ok(endpoint.includes('generateContent'));
        assert.equal(payload.generationConfig.responseMimeType, 'application/json');
        assert.ok(payload.generationConfig.responseSchema);
        assert.deepEqual(payload.generationConfig.responseSchema.required, [
          'critics_summary_pros',
          'critics_summary_cons',
          'users_summary_pros',
          'users_summary_cons'
        ]);

        return {
          candidates: [
            {
              content: {
                parts: [
                  {
                    text: JSON.stringify({
                      critics_summary_pros: 'Шедевральный визуальный стиль и богатый лор.',
                      critics_summary_cons: 'Повышенная сложность некоторых боссов.',
                      users_summary_pros: 'Огромный простор для исследования и кастомизации.',
                      users_summary_cons: 'Просадки FPS в открытых локациях.'
                    })
                  }
                ]
              }
            }
          ]
        };
      };

      const summary = await geminiService.summarizeReviews(
        'Elden Ring',
        ['Incredible world design and challenging combat.'],
        ['Best action RPG ever made, though runs poorly on older GPUs.']
      );

      assert.equal(summary.criticsSummaryPros, 'Шедевральный визуальный стиль и богатый лор.');
      assert.equal(summary.criticsSummaryCons, 'Повышенная сложность некоторых боссов.');
      assert.equal(summary.usersSummaryPros, 'Огромный простор для исследования и кастомизации.');
      assert.equal(summary.usersSummaryCons, 'Просадки FPS в открытых локациях.');
    } finally {
      (geminiService as any).postJson = originalPostJson;
    }
  });

  it('gracefully handles malformed LLM response without crashing', async () => {
    const originalPostJson = (geminiService as any).postJson;
    try {
      (geminiService as any).postJson = async () => ({
        candidates: [{ content: { parts: [{ text: 'INVALID_JSON_RESPONSE' }] } }]
      });

      const summary = await geminiService.summarizeReviews(
        'Test Game',
        ['Good game'],
        ['Fun to play']
      );

      assert.ok(summary.criticsSummaryPros.length > 0);
      assert.ok(summary.criticsSummaryCons.length > 0);
      assert.ok(summary.usersSummaryPros.length > 0);
      assert.ok(summary.usersSummaryCons.length > 0);
    } finally {
      (geminiService as any).postJson = originalPostJson;
    }
  });

  it('parses embeddings correctly', async () => {
    const originalPostJson = (geminiService as any).postJson;
    try {
      (geminiService as any).postJson = async (endpoint: string) => {
        assert.ok(endpoint.includes('embedContent'));
        return {
          embedding: {
            values: [0.123, 0.456, 0.789]
          }
        };
      };

      const emb = await geminiService.getEmbedding('Action RPG game with dragons and knights');
      assert.deepEqual(emb, [0.123, 0.456, 0.789]);
    } finally {
      (geminiService as any).postJson = originalPostJson;
    }
  });

  it('summarizes blogger video transcript cleanly', async () => {
    const originalPostJson = (geminiService as any).postJson;
    try {
      (geminiService as any).postJson = async (endpoint: string, payload: any) => {
        assert.ok(payload.contents[0].parts[0].text.includes('Dark Souls'));
        return {
          candidates: [
            {
              content: {
                parts: [{ text: 'Блогер восторженно отозвался о сложности и рекомендует всем фанатам Souls-like.' }]
              }
            }
          ]
        };
      };

      const conclusion = await geminiService.summarizeBloggerVideo(
        'Dark Souls',
        'Hello everyone today we play Dark Souls and fight the first boss.'
      );
      assert.ok(conclusion.includes('Блогер'));
    } finally {
      (geminiService as any).postJson = originalPostJson;
    }
  });
});
