import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { readPersona, writePersona, listPersonaVersions, clearPersona } from '../persona.js';

test('writePersona stores a bounded current summary and a version', async () => {
  const root = await mkdtemp(join(tmpdir(), 'dsh-persona-'));
  try {
    const result = await writePersona(root, '  这是人格记忆。  ', { maxChars: 1200, keepVersions: 5 });
    assert.equal(result.chars, 7);
    assert.equal(await readPersona(root), '这是人格记忆。');
    assert.equal((await listPersonaVersions(root)).length, 1);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('writePersona rejects empty and oversized summaries', async () => {
  const root = await mkdtemp(join(tmpdir(), 'dsh-persona-'));
  try {
    await assert.rejects(() => writePersona(root, '   ', { maxChars: 1200 }));
    await assert.rejects(() => writePersona(root, 'x'.repeat(201), { maxChars: 200 }));
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('writePersona prunes old versions', async () => {
  const root = await mkdtemp(join(tmpdir(), 'dsh-persona-'));
  try {
    for (let index = 0; index < 5; index += 1) {
      await writePersona(root, `版本 ${index}`, { maxChars: 1200, keepVersions: 2 });
    }
    const versions = await listPersonaVersions(root);
    assert.equal(versions.length, 2);
    assert.equal(await readPersona(root), '版本 4');
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('clearPersona removes current and versions', async () => {
  const root = await mkdtemp(join(tmpdir(), 'dsh-persona-'));
  try {
    await writePersona(root, '要清除的内容', { maxChars: 1200, keepVersions: 5 });
    await clearPersona(root);
    assert.equal(await readPersona(root), '');
    assert.deepEqual(await listPersonaVersions(root), []);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
