import { describe, it } from 'node:test';
import assert from 'node:assert';
import { cosineSimilarity } from '../src/db/database.js';

describe('Vector Cosine Similarity', () => {
  it('returns 1.0 for identical vectors', () => {
    const vec = [1, 2, 3, 4, 5];
    const score = cosineSimilarity(vec, vec);
    assert.strictEqual(Math.round(score * 1000) / 1000, 1);
  });

  it('returns 0 for orthogonal vectors', () => {
    const vecA = [1, 0];
    const vecB = [0, 1];
    const score = cosineSimilarity(vecA, vecB);
    assert.strictEqual(score, 0);
  });

  it('returns -1 for diametrically opposite vectors', () => {
    const vecA = [1, 2, 3];
    const vecB = [-1, -2, -3];
    const score = cosineSimilarity(vecA, vecB);
    assert.strictEqual(Math.round(score * 1000) / 1000, -1);
  });

  it('handles empty vectors or length mismatches gracefully', () => {
    assert.strictEqual(cosineSimilarity([], []), 0);
    assert.strictEqual(cosineSimilarity([1, 2], [1, 2, 3]), 0);
  });

  it('correctly calculates similarity for realistic high-dimensional vectors', () => {
    // Two similar embeddings
    const vecA = [0.2, 0.8, -0.1, 0.5];
    const vecB = [0.25, 0.75, -0.12, 0.48];
    const score = cosineSimilarity(vecA, vecB);
    assert.ok(score > 0.95 && score <= 1.0, `Score should be close to 1, got ${score}`);
  });
});
