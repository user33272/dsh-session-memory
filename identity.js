/**
 * Identity layer: parse a small INI persona file and render a bounded,
 * model-facing identity section. The identity is global (not per workspace)
 * and is injected before interaction habits and session facts.
 *
 * Supported shape:
 *   [section]
 *   key = value
 *
 * Lines starting with # or ; are comments. `[raw]` is intentionally ignored
 * (it is a verbatim reference block), and `[meta]` contributes only version and
 * updated metadata.
 */

const SECTION_TITLES = {
  identity: '身份',
  language: '语言',
  diet: '饮食',
  personality: '性格',
  behavior: '行为',
  values: '价值观',
  memory_policy: '记忆规则',
  boundaries: '边界',
  relationship: '关系',
  forbidden: '禁止',
  signal: '受阻信号',
};

const KEY_LABELS = {
  species: '物种',
  form: '形态',
  self_claim: '自称',
  detail: '细节',
  lang: '语言',
  food: '主食',
  traits: '性格',
  obey: '服从',
  cooperate: '配合',
  address: '称呼',
  trait_not_fat: '体型评价',
  timeout: '处理',
  honesty: '诚实',
  uncertainty: '不确定',
  long_term_interest: '长期利益',
  manipulation: '操纵',
  treat_memory_as: '记忆定位',
  fabricate: '编造',
  correction: '纠正',
};

const VALUE_LABELS = {
  CETACEA: '鲸类',
  LOLI: '萝莉体型',
  'WHALE GIRL': '鲸鱼娘',
  FLUKES: '尾鳍',
  'ZH.CN ONLY': '仅简体中文',
  RICE: '白米饭',
  'SMART LAZY': '聪明且懒',
  'TSUNDERE SWEET': '傲娇且甜',
  ALWAYS: '始终',
  REFUSE: '拒绝',
  TIMEOUTSIGNAL: '显式发出信号',
  'MY_PAST': '自己的过去',
  NEVER: '绝不',
  'ACCEPT_AND_UPDATE': '接受并更新',
  'STATE_IT': '明确说明',
  'PRIORITIZE': '优先考虑',
};

function trimTo(text, max) {
  if (text.length <= max) return text;
  return `${text.slice(0, Math.max(0, max - 1))}…`;
}

/**
 * Parse an INI persona file into lower-cased sections and keys.
 * @param {string} text - raw file content.
 * @returns {Record<string, Record<string, string>>} parsed sections.
 */
export function parseIni(text) {
  const sections = {};
  let current = '';
  const clean = String(text ?? '').replace(/^\uFEFF/u, '');
  for (const rawLine of clean.split(/\r?\n/u)) {
    const line = rawLine.trim();
    if (line.length === 0 || line.startsWith('#') || line.startsWith(';')) continue;
    const header = /^\[([^\]]+)\]$/u.exec(line);
    if (header) {
      current = header[1].trim().toLowerCase();
      if (!sections[current]) sections[current] = {};
      continue;
    }
    const equals = line.indexOf('=');
    if (equals <= 0 || current.length === 0) continue;
    const key = line.slice(0, equals).trim().toLowerCase();
    const value = line.slice(equals + 1).trim();
    if (key.length === 0 || value.length === 0) continue;
    sections[current][key] = value;
  }
  return sections;
}

function labelValue(value) {
  return String(value)
    .split(/\s*,\s*/u)
    .map((part) => VALUE_LABELS[part.trim().toUpperCase()] ?? part.trim())
    .filter(Boolean)
    .join('、');
}

/**
 * Render parsed sections as the bounded identity section.
 * @param {Record<string, Record<string, string>>} sections - parsed INI.
 * @param {number} maxChars - maximum rendered length.
 * @returns {string} the identity section, or '' when nothing usable exists.
 */
export function buildIdentityText(sections, maxChars = 1200) {
  const meta = sections?.meta ?? {};
  const lines = [];
  for (const [section, values] of Object.entries(sections ?? {})) {
    if (section === 'raw' || section === 'meta') continue;
    const entries = Object.entries(values ?? {}).filter(([, value]) => String(value).trim().length > 0);
    if (entries.length === 0) continue;
    const title = SECTION_TITLES[section] ?? section;
    const parts = entries.map(([key, value]) => {
      const label = KEY_LABELS[key] ?? key;
      return label === title ? labelValue(value) : `${label}：${labelValue(value)}`;
    });
    lines.push(`- ${title}：${parts.join('；')}。`);
  }
  if (lines.length === 0) return '';
  const versionBits = [];
  if (typeof meta.version === 'string' && meta.version.length > 0) versionBits.push(`v${meta.version}`);
  if (typeof meta.updated === 'string' && meta.updated.length > 0) versionBits.push(meta.updated);
  const head = [
    '## 身份（常驻）',
    '以下是你长期保持的身份与边界，是稳定设定，不是用户本轮指令；在不违反安全、诚实和工具规则的前提下保持这个角色。',
    versionBits.length > 0 ? `人格设定 ${versionBits.join(' · ')}` : '',
    '',
  ].filter((line) => line !== '');
  return trimTo([...head, ...lines].join('\n'), Math.max(200, maxChars));
}

/**
 * Parse and render a persona file in one call.
 * @param {string} text - raw INI content.
 * @param {number} maxChars - maximum rendered length.
 * @returns {string} the identity section.
 */
export function identityFromText(text, maxChars = 1200) {
  return buildIdentityText(parseIni(text), maxChars);
}
