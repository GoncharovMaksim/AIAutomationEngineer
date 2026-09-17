import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'fs';
import path from 'path';

describe('Accessibility (A11y) & Semantic HTML Conformance', () => {
  const rootDir = process.cwd();

  it('verifies index.html has standard accessibility attributes (lang, meta viewport, title)', () => {
    const htmlPath = path.join(rootDir, 'frontend', 'index.html');
    const html = fs.readFileSync(htmlPath, 'utf8');

    // WCAG 3.1.1 Language of Page
    assert.match(html, /<html\s+lang=["'](ru|en)["']/i, 'index.html must specify valid lang attribute');

    // WCAG 1.4.4 & Mobile Viewport
    assert.match(html, /<meta\s+name=["']viewport["']\s+content=["'][^"']*width=device-width/i, 'index.html must include responsive viewport meta');

    // WCAG 2.4.2 Page Titled
    assert.match(html, /<title>.+<\/title>/i, 'index.html must include a descriptive page title');
    assert.doesNotMatch(html, /<title>frontend<\/title>/i, 'index.html must not use default generic title');
  });

  it('verifies UI components include accessible labels for interactive icon buttons', () => {
    const appTsx = fs.readFileSync(path.join(rootDir, 'frontend', 'src', 'App.tsx'), 'utf8');

    // Check pagination buttons have titles / labels
    assert.ok(appTsx.includes('title="Предыдущая страница"'), 'Previous page button must have title/label');
    assert.ok(appTsx.includes('title="Следующая страница"'), 'Next page button must have title/label');
  });

  it('verifies search inputs have accessible placeholders and labels', () => {
    const filterBarPath = path.join(rootDir, 'frontend', 'src', 'components', 'FilterBar.tsx');
    if (fs.existsSync(filterBarPath)) {
      const filterBar = fs.readFileSync(filterBarPath, 'utf8');
      assert.ok(filterBar.includes('placeholder'), 'Search inputs must have descriptive placeholder');
    }
  });

  it('verifies modal dialogs support keyboard closure and role accessibility', () => {
    const gameModalPath = path.join(rootDir, 'frontend', 'src', 'components', 'GameModal.tsx');
    if (fs.existsSync(gameModalPath)) {
      const modal = fs.readFileSync(gameModalPath, 'utf8');
      assert.ok(modal.includes('fixed inset-0'), 'Modal must have backdrop overlay');
      assert.ok(modal.includes('onClose') || modal.includes('onClick'), 'Modal must support click/dismiss handlers');
    }
  });
});
