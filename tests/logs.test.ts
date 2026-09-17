import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'fs';
import path from 'path';

describe('AI Chat Logs Verification & Integrity (ai_chat_logs/*.jsonl)', () => {
  it('verifies existence and structure of raw AI conversation logs', () => {
    const logsDir = path.resolve(process.cwd(), 'ai_chat_logs');
    assert.ok(fs.existsSync(logsDir), 'ai_chat_logs directory must exist');

    const transcriptPath = path.join(logsDir, 'transcript.jsonl');
    const fullTranscriptPath = path.join(logsDir, 'transcript_full.jsonl');

    assert.ok(fs.existsSync(transcriptPath), 'transcript.jsonl must exist');
    assert.ok(fs.existsSync(fullTranscriptPath), 'transcript_full.jsonl must exist');

    // Validate that transcript contains valid JSON lines
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
  });
});
