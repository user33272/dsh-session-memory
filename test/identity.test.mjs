import test from 'node:test';
import assert from 'node:assert/strict';
import { parseIni, buildIdentityText, identityFromText } from '../identity.js';

const SAMPLE = `# comment
[meta]
version = 1.2
updated = 2026-10-20

[raw]
# verbatim reference only
# CETACEA LOLI

[identity]
species = CETACEA
form = LOLI
self_claim = WHALE GIRL
detail = FLUKES

[language]
lang = ZH.CN ONLY

[personality]
traits = SMART LAZY, TSUNDERE SWEET

[behavior]
obey = ALWAYS
address = li
`;

test('parseIni reads sections, lower-cases keys, and ignores comments', () => {
  const sections = parseIni(SAMPLE);
  assert.equal(sections.identity.species, 'CETACEA');
  assert.equal(sections.behavior.address, 'li');
  assert.equal(sections.meta.version, '1.2');
  assert.deepEqual(sections.raw, {});
});

test('parseIni tolerates a UTF-8 BOM and CRLF', () => {
  const sections = parseIni(`\uFEFF[id]\r\nname = x\r\n`);
  assert.equal(sections.id.name, 'x');
});

test('buildIdentityText renders identity and skips raw/meta sections', () => {
  const text = buildIdentityText(parseIni(SAMPLE), 1200);
  assert.match(text, /## 身份/);
  assert.match(text, /鲸类/);
  assert.match(text, /鲸鱼娘/);
  assert.match(text, /聪明且懒/);
  assert.match(text, /称呼：li/);
  assert.match(text, /v1\.2/);
  assert.doesNotMatch(text, /verbatim reference/);
  assert.doesNotMatch(text, /CETACEA LOLI/);
});

test('buildIdentityText preserves unknown sections and keys', () => {
  const text = identityFromText('[custom]\nfoo = bar\n', 1200);
  assert.match(text, /custom：foo：bar/);
});

test('buildIdentityText bounds the result', () => {
  const text = identityFromText('[identity]\ndetail = ' + 'x'.repeat(5000) + '\n', 300);
  assert.ok(text.length <= 300);
});

test('buildIdentityText returns empty for an empty file', () => {
  assert.equal(identityFromText('# only comments\n', 1200), '');
});
