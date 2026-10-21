/**
 * Persona memory: a bounded, versioned summary of the assistant's self/relationship
 * memory. It is deliberately stored outside the per-workspace work memory so the
 * two can be managed, cleared, and sized independently.
 *
 * Layout:
 *   <personaDirectory>/current.md
 *   <personaDirectory>/versions/<ISO timestamp>.md
 */

import { randomUUID } from 'node:crypto';
import { mkdir, readFile, readdir, rename, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

const CURRENT_FILE = 'current.md';
const VERSIONS_DIR = 'versions';

/**
 * Read the current persona summary.
 * @param {string} root - persona directory.
 * @returns {Promise<string>} trimmed summary, or '' when absent.
 */
export async function readPersona(root) {
  try {
    const text = await readFile(join(root, CURRENT_FILE), 'utf8');
    return text.trim();
  } catch (error) {
    if (error?.code === 'ENOENT') return '';
    throw error;
  }
}

/**
 * List version file names, oldest first.
 * @param {string} root - persona directory.
 * @returns {Promise<string[]>} version file names.
 */
export async function listPersonaVersions(root) {
  try {
    const names = await readdir(join(root, VERSIONS_DIR));
    return names.filter((name) => name.endsWith('.md')).sort();
  } catch (error) {
    if (error?.code === 'ENOENT') return [];
    throw error;
  }
}

/**
 * Write a new persona version and make it current, then prune old versions.
 * @param {string} root - persona directory.
 * @param {string} text - replacement summary.
 * @param {{ maxChars?: number, keepVersions?: number }} options - bounds.
 * @returns {Promise<{ chars: number, version: string }>} write result.
 */
export async function writePersona(root, text, options = {}) {
  const maxChars = Number.isFinite(options.maxChars) ? Math.max(200, Math.trunc(options.maxChars)) : 1200;
  const keepVersions = Number.isFinite(options.keepVersions) ? Math.max(1, Math.trunc(options.keepVersions)) : 5;
  const body = String(text ?? '').trim();
  if (body.length === 0) throw new Error('人格记忆不能为空');
  if (body.length > maxChars) {
    throw new Error(`人格记忆超过上限：${body.length} 字 > ${maxChars} 字，请先压缩再写入`);
  }

  const versionsDir = join(root, VERSIONS_DIR);
  await mkdir(versionsDir, { recursive: true });
  const stamp = new Date().toISOString().replace(/[:.]/gu, '-');
  const version = `${stamp}-${randomUUID().slice(0, 8)}.md`;
  await writeFile(join(versionsDir, version), `${body}\n`, 'utf8');

  const temp = join(root, `.current.${process.pid}.${randomUUID().slice(0, 8)}.tmp`);
  await writeFile(temp, `${body}\n`, 'utf8');
  await rename(temp, join(root, CURRENT_FILE));

  const versions = await listPersonaVersions(root);
  const excess = versions.length - keepVersions;
  for (const name of versions.slice(0, Math.max(0, excess))) {
    await rm(join(versionsDir, name), { force: true });
  }
  return { chars: body.length, version };
}

/**
 * Remove the current summary and all versions.
 * @param {string} root - persona directory.
 * @returns {Promise<void>} completion.
 */
export async function clearPersona(root) {
  await rm(join(root, CURRENT_FILE), { force: true });
  await rm(join(root, VERSIONS_DIR), { recursive: true, force: true });
}
