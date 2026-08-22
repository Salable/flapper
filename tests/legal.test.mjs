import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { LEGAL_DOCUMENTS, legalDocument, TERMS_VERSION, COMPANY_LINE, PRIVACY_CONTACT } from '../lib/legal/documents.mjs';

const file = (doc) => new URL(`../docs/legal/${doc.file}`, import.meta.url);

test('every legal document in the registry exists, has a title, and is reachable by slug', () => {
  assert.deepEqual(LEGAL_DOCUMENTS.map((d) => d.slug), ['terms', 'privacy', 'cookies', 'eula', 'company']);
  for (const doc of LEGAL_DOCUMENTS) {
    assert.ok(existsSync(file(doc)), `${doc.file} missing`);
    assert.match(readFileSync(file(doc), 'utf8'), new RegExp(`^# ${doc.title}`), `${doc.file} should open with its title`);
    assert.equal(legalDocument(doc.slug), doc);
  }
  assert.equal(legalDocument('nope'), null);
});

test('a placeholder document says so in its text, and a published one has stopped saying so', () => {
  for (const doc of LEGAL_DOCUMENTS) {
    const text = readFileSync(file(doc), 'utf8');
    if (doc.status === 'placeholder') {
      assert.ok(text.includes('[[PLACEHOLDER'), `${doc.file} is marked placeholder but carries no [[PLACEHOLDER marker`);
      assert.equal(doc.effectiveDate, null, `${doc.slug}: a placeholder has no effective date`);
    } else {
      assert.equal(doc.status, 'published');
      assert.ok(!text.includes('[[PLACEHOLDER'), `${doc.file} is published but still has placeholder text`);
      assert.match(String(doc.effectiveDate), /^\d{4}-\d{2}-\d{2}$/);
    }
  }
});

test('placeholders that reach the UI are unmistakable, and the terms version is pinned', () => {
  assert.match(COMPANY_LINE, /\[\[PLACEHOLDER/);
  assert.match(PRIVACY_CONTACT, /\[\[PLACEHOLDER/);
  assert.equal(typeof TERMS_VERSION, 'string');
  assert.ok(TERMS_VERSION.length > 0);
});

test('the privacy notice names every processor the app actually uses', () => {
  const text = readFileSync(file(legalDocument('privacy')), 'utf8');
  for (const processor of ['Vercel', 'Neon', 'Upstash']) assert.ok(text.includes(processor), processor);
});
