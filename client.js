window.__ModuleLoader__.load({
  id: 'dsh-session-memory',
  factory(require) {
    const React = require('react');
    const ReactDOM = require('react-dom');
    const h = React.createElement;

    const NS = 'sessionMemory';
    const BUNDLE = 'dsh-session-memory';
    const ROW = 'session-memory';

    const en = {
      summary: 'Separates global persona memory from per-workspace work memory; injects identity, persona, habits, then facts.',
      title: 'Persona, identity and work',
      storageTitle: 'Work storage',
      directory: 'Work storage directory',
      directoryHint: 'Per-workspace facts and habit txt files only. Leave blank to use the default $DSH_HOME/context-memory.',
      browse: 'Browse…',
      reset: 'Use default',
      defaultPath: 'default ($DSH_HOME/context-memory)',
      derived: 'Work files',
      factsFile: 'Facts: <root>/<workspace>.json',
      habitsFile: 'Habits: <root>/habits/<workspace>.1.txt (latest)',
      habitsBackup: 'Habits backup: <root>/habits/<workspace>.2.txt (previous)',
      migration: 'Changing the directory affects only data written afterwards. Existing files are not moved automatically.',
      identityTitle: 'Identity',
      identityFile: 'Identity INI file',
      identityHint: 'Optional INI template. In workspace-scoped mode, use /memory identity import to copy it into the current workspace; other workspaces start empty.',
      identityPlaceholder: 'D:\\path\\to\\persona.zh-cn.ini',
      personaTitle: 'Persona memory',
      personaScoped: 'Isolate persona per workspace',
      personaScopedHint: 'Each workspace gets its own identity.ini and current.md. The identity file above is only an import template; other workspaces start empty.',
      personaDirectory: 'Persona directory',
      personaHint: 'Bounded self/relationship memory. In workspace-scoped mode, each workspace has its own current.md and versions.',
      personaDefaultPath: 'default ($DSH_HOME/persona)',
      personaDerived: 'Persona: <root>/workspaces/<workspaceKey>/current.md · versions/',
      personaDerivedGlobal: 'Persona: <root>/current.md · versions/',
      crossTitle: 'Cross-workspace',
      crossAllow: 'Allow reading other workspaces',
      crossAllowHint: 'Work facts only. Identity and persona data are never shared.',
      crossAttach: 'Auto-inject recent records from other workspaces',
      crossAttachHint: 'Adds a separate section after the current facts; off by default.',
      crossPicker: 'Choose workspaces…',
      crossPickerTitle: 'Choose workspaces to share work memory',
      crossPickerHint: 'Only selected workspaces can be read across workspaces. No selection means no sharing. Identity and persona are never shared.',
      crossSelectAll: 'Select all',
      crossClearAll: 'Clear all',
      crossNoWorkspaces: 'No registered workspaces were found. Add a path manually below.',
      crossManual: 'Add a path',
      crossManualPlaceholder: 'D:\\path\\to\\workspace',
      crossAdd: 'Add',
      crossSelected: 'Selected: {count}',
      crossEmpty: 'No selection means no other workspaces are shared.',
      pinsNav: 'Pinned memory',
      pinsTitle: 'Pinned memory',
      pinsEmpty: 'No pinned entries in any workspace.',
      pinsRefresh: 'Refresh',
      pinsClose: 'Close',
      pinsLoading: 'Loading pinned memory…',
      pinsError: 'Could not load pinned memory.',
      pinsLocalOnly: 'This panel is available only in the local Web UI.',
      pinsCount: '{count} pinned',
      pinsWhy: 'Why',
      pinsNote: 'Note',
      pinsTodo: 'Todo',
      cancel: 'Cancel',
      apply: 'Apply',
      habitsTitle: 'Interaction habits',
      habits: 'Summarize interaction habits',
      habitsHint: 'Keeps at most two concise txt summaries per workspace and restores habits before facts in the next session.',
      save: 'Save',
      saving: 'Saving…',
      saved: 'Saved.',
      saveFailed: 'The deployment rejected these values; adjust them and try again.',
      unavailable: 'Configuration is unavailable because the Host entry is not loaded.',
      readOnly: 'This deployment stores settings read-only.',
    };

    const zh = {
      summary: '人格记忆与工作记忆分开存储；按身份、人格、习惯、事实的顺序接入。',
      title: '人格、身份与工作',
      storageTitle: '工作存储',
      directory: '工作存储目录',
      directoryHint: '只放当前工作区的事实与习惯 txt 文件；留空使用默认目录 $DSH_HOME/context-memory。',
      browse: '浏览…',
      reset: '恢复默认',
      defaultPath: '默认（$DSH_HOME/context-memory）',
      derived: '工作文件',
      factsFile: '事实：<root>/<工作区>.json',
      habitsFile: '习惯：<root>/habits/<工作区>.1.txt（最新）',
      habitsBackup: '习惯备份：<root>/habits/<工作区>.2.txt（上一次）',
      migration: '更改目录只影响之后写入的数据，旧目录中的文件不会自动迁移。',
      identityTitle: '身份层',
      identityFile: '身份 INI 文件',
      identityHint: '可选。INI 人格模板；按工作区隔离时，用 /memory identity import 复制到当前工作区，其他工作区从空白开始。',
      identityPlaceholder: 'D:\\path\\to\\persona.zh-cn.ini',
      personaTitle: '人格记忆',
      personaScoped: '人格按工作区隔离',
      personaScopedHint: '每个工作区独立 identity.ini 与 current.md；上面的身份文件只作为导入模板，其他工作区从空白开始。',
      personaDirectory: '人格目录',
      personaHint: '有上限的自我/关系记忆；按工作区隔离时，每个工作区各自的 current.md 与版本。',
      personaDefaultPath: '默认（$DSH_HOME/persona）',
      personaDerived: '人格：<root>/workspaces/<工作区哈希>/current.md · versions/',
      personaDerivedGlobal: '人格：<root>/current.md · versions/',
      crossTitle: '跨工作区',
      crossAllow: '允许读取其他工作区的工作记录',
      crossAllowHint: '只共享工作事实；身份与人格数据永远不会被共享。',
      crossAttach: '自动注入其他工作区的最近记录',
      crossAttachHint: '在当前事实之后追加独立段落；默认关闭。',
      crossPicker: '选择工作区…',
      crossPickerTitle: '选择允许共享工作记忆的工作区',
      crossPickerHint: '只有选中的工作区可被跨工作区读取；不选表示不共享。身份与人格数据永远不会共享。',
      crossSelectAll: '全选',
      crossClearAll: '清空',
      crossNoWorkspaces: '未找到已注册的工作区；可在下方手动添加路径。',
      crossManual: '添加路径',
      crossManualPlaceholder: 'D:\\path\\to\\workspace',
      crossAdd: '添加',
      crossSelected: '已选择：{count}',
      crossEmpty: '不选表示不共享任何其他工作区。',
      pinsNav: '钉住记忆',
      pinsTitle: '钉住记忆',
      pinsEmpty: '所有工作区都没有钉住的条目。',
      pinsRefresh: '刷新',
      pinsClose: '关闭',
      pinsLoading: '正在读取钉住记忆…',
      pinsError: '读取钉住记忆失败。',
      pinsLocalOnly: '该面板只在本机 Web UI 可用。',
      pinsCount: '共 {count} 条',
      pinsWhy: '为什么',
      pinsNote: '要点',
      pinsTodo: '待办',
      cancel: '取消',
      apply: '确定',
      habitsTitle: '交互习惯',
      habits: '归纳交互习惯',
      habitsHint: '每个工作区最多保留两份简短的 txt 总结；下一个会话会先恢复习惯，再恢复事实。',
      save: '保存',
      saving: '保存中…',
      saved: '已保存。',
      saveFailed: '本部署没有接受这些值，请调整后重试。',
      unavailable: '该 Host 条目未加载，暂时无法配置。',
      readOnly: '本部署的设置为只读。',
    };

    const styles = {
      page: {
        display: 'grid',
        gap: '18px',
        padding: '4px 0 10px',
        color: 'var(--dsw-alias-label-primary)',
        fontSize: '13px',
        lineHeight: '1.5',
      },
      section: { display: 'grid', gap: '8px' },
      heading: { margin: 0, fontSize: '14px', fontWeight: '600' },
      field: { display: 'grid', gap: '6px' },
      label: { fontWeight: '600' },
      hint: { margin: 0, color: 'var(--dsw-alias-label-secondary)', fontSize: '12px' },
      input: {
        width: '100%',
        boxSizing: 'border-box',
        padding: '8px 10px',
        borderRadius: '8px',
        border: '1px solid var(--dsw-alias-border-l1)',
        background: 'var(--dsw-alias-bg-base)',
        color: 'var(--dsw-alias-label-primary)',
        fontSize: '13px',
      },
      row: { display: 'flex', gap: '8px', alignItems: 'center', flexWrap: 'wrap' },
      button: {
        padding: '7px 12px',
        borderRadius: '8px',
        border: '1px solid var(--dsw-alias-border-l1)',
        background: 'var(--dsw-alias-bg-layer-1)',
        color: 'var(--dsw-alias-label-primary)',
        fontSize: '13px',
        cursor: 'pointer',
      },
      primary: {
        padding: '7px 14px',
        borderRadius: '8px',
        border: '1px solid var(--dsw-alias-brand-primary)',
        background: 'var(--dsw-alias-brand-primary)',
        color: 'var(--dsw-alias-bg-base)',
        fontSize: '13px',
        fontWeight: '600',
        cursor: 'pointer',
      },
      mono: {
        fontFamily: 'ui-monospace, SFMono-Regular, Consolas, monospace',
        fontSize: '12px',
        padding: '8px 10px',
        borderRadius: '8px',
        background: 'var(--dsw-alias-bg-layer-1)',
        border: '1px solid var(--dsw-alias-border-l1)',
        color: 'var(--dsw-alias-label-secondary)',
        whiteSpace: 'pre-wrap',
        wordBreak: 'break-all',
      },
      status: { minHeight: '18px', color: 'var(--dsw-alias-label-secondary)', fontSize: '12px' },
      checkboxRow: { display: 'flex', gap: '8px', alignItems: 'flex-start' },
      overlay: {
        position: 'fixed',
        inset: 0,
        zIndex: 1000,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        padding: '24px',
        background: 'rgba(0, 0, 0, 0.45)',
      },
      dialog: {
        width: 'min(620px, 100%)',
        maxHeight: '82vh',
        display: 'flex',
        flexDirection: 'column',
        gap: '12px',
        padding: '18px',
        borderRadius: '12px',
        border: '1px solid var(--dsw-alias-border-l1)',
        background: 'var(--dsw-alias-bg-overlay)',
        color: 'var(--dsw-alias-label-primary)',
        boxShadow: '0 18px 60px rgba(0, 0, 0, 0.35)',
      },
      modalHead: { margin: 0, fontSize: '15px', fontWeight: '600' },
      modalList: {
        display: 'grid',
        gap: '4px',
        maxHeight: '42vh',
        overflowY: 'auto',
        padding: '4px',
        border: '1px solid var(--dsw-alias-border-l1)',
        borderRadius: '8px',
        background: 'var(--dsw-alias-bg-layer-1)',
      },
      option: {
        display: 'flex',
        gap: '8px',
        alignItems: 'flex-start',
        padding: '6px 8px',
        borderRadius: '6px',
      },
      modalFooter: { display: 'flex', justifyContent: 'flex-end', gap: '8px', flexWrap: 'wrap' },
    };

    function workspaceOptionsFrom(snapshot) {
      const raw = snapshot?.workspaces ?? snapshot?.items ?? snapshot?.list ?? snapshot;
      if (!Array.isArray(raw)) return [];
      const seen = new Set();
      const options = [];
      for (const item of raw) {
        const path = item?.path ?? item?.cwd ?? item?.root ?? item?.directory;
        if (typeof path !== 'string' || path.trim().length === 0) continue;
        const key = path.toLowerCase();
        if (seen.has(key)) continue;
        seen.add(key);
        options.push({
          path,
          label: item?.title ?? item?.name ?? path,
        });
      }
      return options;
    }

    function WorkspacePickerDialog({ useWorkspaces, selected, onApply, onClose, t }) {
      const snapshot = typeof useWorkspaces === 'function' ? useWorkspaces((value) => value) : undefined;
      const options = React.useMemo(() => workspaceOptionsFrom(snapshot), [snapshot]);
      const [draft, setDraft] = React.useState(selected);
      const [manual, setManual] = React.useState('');
      const has = (path) => draft.some((entry) => entry.toLowerCase() === path.toLowerCase());

      React.useEffect(() => {
        const onKeyDown = (event) => {
          if (event.key === 'Escape') onClose();
        };
        window.addEventListener('keydown', onKeyDown);
        return () => window.removeEventListener('keydown', onKeyDown);
      }, [onClose]);

      const toggle = (path) => {
        setDraft((previous) => (has(path)
          ? previous.filter((entry) => entry.toLowerCase() !== path.toLowerCase())
          : [...previous, path]));
      };

      const addManual = () => {
        const value = manual.trim();
        if (value.length === 0) return;
        if (!has(value)) setDraft((previous) => [...previous, value]);
        setManual('');
      };

      const list = options.length === 0
        ? h('p', { style: styles.hint }, t('crossNoWorkspaces'))
        : h('div', { style: styles.modalList },
          options.map((option) => h('label', { key: option.path, style: styles.option },
            h('input', {
              type: 'checkbox',
              checked: has(option.path),
              onChange: () => toggle(option.path),
            }),
            h('span', { style: { display: 'grid', gap: '2px' } },
              h('span', { style: styles.label }, option.label),
              h('span', { style: { ...styles.hint, wordBreak: 'break-all' } }, option.path)))));

      const controls = h('div', { style: styles.row },
        h('button', {
          type: 'button',
          style: styles.button,
          onClick: () => setDraft(options.map((option) => option.path)),
        }, t('crossSelectAll')),
        h('button', {
          type: 'button',
          style: styles.button,
          onClick: () => setDraft([]),
        }, t('crossClearAll')));

      const manualRow = h('div', { style: styles.field },
        h('span', { style: styles.label }, t('crossManual')),
        h('div', { style: styles.row },
          h('input', {
            type: 'text',
            value: manual,
            spellCheck: false,
            placeholder: t('crossManualPlaceholder'),
            style: { ...styles.input, flex: '1 1 260px' },
            onChange: (event) => setManual(event.target.value),
            onKeyDown: (event) => {
              if (event.key === 'Enter') addManual();
            },
          }),
          h('button', { type: 'button', style: styles.button, onClick: addManual }, t('crossAdd'))));

      const footer = h('div', { style: styles.modalFooter },
        h('span', { style: styles.hint }, t('crossSelected', { count: draft.length })),
        h('button', { type: 'button', style: styles.button, onClick: onClose }, t('cancel')),
        h('button', {
          type: 'button',
          style: styles.primary,
          onClick: () => onApply(draft),
        }, t('apply')));

      return h('div', {
        style: styles.overlay,
        onMouseDown: (event) => {
          if (event.target === event.currentTarget) onClose();
        },
      }, h('div', {
        style: styles.dialog,
        role: 'dialog',
        'aria-modal': 'true',
        'aria-label': t('crossPickerTitle'),
      },
        h('h3', { style: styles.modalHead }, t('crossPickerTitle')),
        h('p', { style: styles.hint }, t('crossPickerHint')),
        controls,
        list,
        manualRow,
        footer));
    }

    function PinnedPanelButton({ wide, t }) {
      const [open, setOpen] = React.useState(false);
      const [data, setData] = React.useState(null);
      const [status, setStatus] = React.useState('idle');
      const [error, setError] = React.useState('');

      const load = React.useCallback(async () => {
        setStatus('loading');
        setError('');
        try {
          const response = await fetch('/session-memory/pins', { cache: 'no-store', credentials: 'same-origin' });
          if (response.status === 403) {
            setStatus('local-only');
            return;
          }
          if (!response.ok) throw new Error(`HTTP ${response.status}`);
          setData(await response.json());
          setStatus('ready');
        } catch {
          setStatus('error');
          setError(t('pinsError'));
        }
      }, [t]);

      React.useEffect(() => {
        if (!open) return undefined;
        void load();
        const onKeyDown = (event) => {
          if (event.key === 'Escape') setOpen(false);
        };
        window.addEventListener('keydown', onKeyDown);
        return () => window.removeEventListener('keydown', onKeyDown);
      }, [open, load]);

      const icon = h('svg', {
        width: 18,
        height: 18,
        viewBox: '0 0 24 24',
        fill: 'none',
        stroke: 'currentColor',
        strokeWidth: 2,
        strokeLinecap: 'round',
        strokeLinejoin: 'round',
        'aria-hidden': 'true',
      }, h('path', { d: 'M6 3h12v18l-6-4-6 4V3z' }));

      const total = data?.total ?? 0;
      const renderItem = (item) => h('div', {
        key: item.id,
        style: {
          display: 'grid', gap: '6px', padding: '10px 12px',
          border: '1px solid var(--dsw-alias-border-l1)',
          borderRadius: '8px', background: 'var(--dsw-alias-bg-layer-1)',
        },
      },
        h('div', { style: { display: 'flex', gap: '8px', alignItems: 'flex-start' } },
          h('span', {
            style: {
              flex: '0 0 auto', fontSize: '11px', padding: '1px 6px',
              borderRadius: '999px', background: 'var(--dsw-alias-bg-base)',
              color: 'var(--dsw-alias-label-secondary)',
            },
          }, item.kind === 'todo' ? `${t('pinsTodo')} · ${item.status === 'blocked' ? '阻塞' : '未完成'}` : t('pinsNote')),
          h('span', { style: { flex: '1 1 auto', wordBreak: 'break-word' } }, item.text)),
        item.why ? h('div', { style: styles.hint }, `${t('pinsWhy')}：${item.why}`) : null,
        h('div', {
          style: {
            display: 'flex', gap: '8px', flexWrap: 'wrap',
            fontSize: '11px', color: 'var(--dsw-alias-label-secondary)',
          },
        },
          ...(item.tags ?? []).map((tag) => h('span', { key: tag }, `#${tag}`)),
          h('code', { style: { wordBreak: 'break-all' } }, item.id),
          h('span', {}, new Date(item.time).toLocaleString('zh-CN'))));

      const workspaceNodes = (data?.workspaces ?? []).map((workspace) => {
        const items = [
          ...(workspace.notes ?? []).map((note) => ({ ...note, kind: 'note' })),
          ...(workspace.todos ?? []).map((todo) => ({ ...todo, kind: 'todo' })),
        ].map(renderItem);
        return h('section', {
          key: workspace.cwd,
          style: { display: 'grid', gap: '8px' },
        },
          h('div', {
            style: {
              fontSize: '12px', color: 'var(--dsw-alias-label-secondary)',
              wordBreak: 'break-all',
            },
          }, workspace.cwd),
          items);
      });

      const body = status === 'loading'
        ? h('p', { style: styles.hint }, t('pinsLoading'))
        : status === 'local-only'
          ? h('p', { style: styles.hint }, t('pinsLocalOnly'))
          : status === 'error'
            ? h('p', { style: styles.hint }, error)
            : status === 'ready' && total === 0
              ? h('p', { style: styles.hint }, t('pinsEmpty'))
              : workspaceNodes;

      const overlay = open ? ReactDOM.createPortal(h('div', {
        style: {
          position: 'fixed', inset: 0, zIndex: 1000, display: 'flex',
          alignItems: 'center', justifyContent: 'center', padding: '24px',
          background: 'rgba(0, 0, 0, 0.45)',
        },
        onMouseDown: (event) => {
          if (event.target === event.currentTarget) setOpen(false);
        },
      }, h('div', {
        role: 'dialog',
        'aria-modal': 'true',
        'aria-label': t('pinsTitle'),
        style: {
          width: 'min(760px, 100%)', maxHeight: '82vh', display: 'flex',
          flexDirection: 'column', gap: '12px', padding: '18px',
          borderRadius: '12px', border: '1px solid var(--dsw-alias-border-l1)',
          background: 'var(--dsw-alias-bg-overlay)',
          color: 'var(--dsw-alias-label-primary)',
          boxShadow: '0 18px 60px rgba(0, 0, 0, 0.35)',
        },
      },
        h('div', { style: { display: 'flex', alignItems: 'center', gap: '10px' } },
          h('span', { style: { display: 'inline-flex' } }, icon),
          h('h3', { style: { margin: 0, flex: '1 1 auto', fontSize: '15px', fontWeight: '600' } }, t('pinsTitle')),
          status === 'ready' ? h('span', { style: { color: 'var(--dsw-alias-label-secondary)', fontSize: '12px' } }, t('pinsCount', { count: total })) : null,
          h('button', { type: 'button', style: styles.button, onClick: () => void load() }, t('pinsRefresh')),
          h('button', { type: 'button', style: styles.button, onClick: () => setOpen(false) }, t('pinsClose'))),
        h('div', {
          style: { overflowY: 'auto', display: 'grid', gap: '14px', paddingRight: '4px' },
        }, body))), document.body) : null;      return h(React.Fragment, null,
        h('button', {
          type: 'button',
          title: t('pinsNav'),
          'aria-label': t('pinsNav'),
          'aria-expanded': open,
          onClick: () => setOpen((value) => !value),
          style: {
            display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
            gap: '8px', padding: wide ? '6px 10px' : '6px',
            border: '1px solid var(--dsw-alias-border-l1)',
            borderRadius: '8px', background: 'transparent',
            color: 'var(--dsw-alias-label-primary)', cursor: 'pointer',
            fontSize: '12px', minHeight: '32px',
          },
        }, icon, wide ? h('span', null, t('pinsNav')) : null),
        overlay);
    }

    function SessionMemoryPage(props) {
      const { view } = props;
      const form = props.form ?? (typeof props.getConfigForm === 'function' ? props.getConfigForm() : undefined);
      const t = typeof props.t === 'function' ? props.t : (key) => key;
      if (view === 'summary') return t('summary');
      if (!form) return h('p', { style: styles.hint }, t('unavailable'));

      const state = typeof form.state === 'function' ? form.state() : (form.state ?? {});
      const value = state.value ?? state.values ?? form.value ?? {};
      const revision = state.revision ?? form.revision;
      const writable = (state.writable ?? form.writable) !== false;
      const storedDirectory = typeof value.directory === 'string' ? value.directory : '';
      const storedHabits = value.habitsEnabled !== false;
      const storedIdentity = typeof value.identityFile === 'string' ? value.identityFile : '';
      const storedPersona = typeof value.personaDirectory === 'string' ? value.personaDirectory : '';
      const storedScoped = value.personaWorkspaceScoped !== false;
      const storedCross = value.crossWorkspaceEnabled === true;
      const storedCrossAttach = value.crossWorkspaceAttach === true;
      const storedAllowlist = Array.isArray(value.crossWorkspaceAllowlist)
        ? value.crossWorkspaceAllowlist.filter((entry) => typeof entry === 'string' && entry.length > 0)
        : [];

      const [directory, setDirectory] = React.useState(storedDirectory);
      const [habits, setHabits] = React.useState(storedHabits);
      const [identityFile, setIdentityFile] = React.useState(storedIdentity);
      const [personaDirectory, setPersonaDirectory] = React.useState(storedPersona);
      const [personaScoped, setPersonaScoped] = React.useState(storedScoped);
      const [cross, setCross] = React.useState(storedCross);
      const [crossAttach, setCrossAttach] = React.useState(storedCrossAttach);
      const [allowlist, setAllowlist] = React.useState(storedAllowlist);
      const [pickerOpen, setPickerOpen] = React.useState(false);
      const [busy, setBusy] = React.useState(false);
      const [status, setStatus] = React.useState('');

      React.useEffect(() => {
        setDirectory(storedDirectory);
        setHabits(storedHabits);
        setIdentityFile(storedIdentity);
        setPersonaDirectory(storedPersona);
        setPersonaScoped(storedScoped);
        setCross(storedCross);
        setCrossAttach(storedCrossAttach);
        setAllowlist(storedAllowlist);
      }, [storedDirectory, storedHabits, storedIdentity, storedPersona, storedScoped, storedCross, storedCrossAttach, JSON.stringify(storedAllowlist), revision]);

      const dirty = directory !== storedDirectory
        || habits !== storedHabits
        || identityFile !== storedIdentity
        || personaDirectory !== storedPersona
        || personaScoped !== storedScoped
        || cross !== storedCross
        || crossAttach !== storedCrossAttach
        || allowlist.join('\n') !== storedAllowlist.join('\n');
      const disabled = !writable || busy;
      const root = directory.trim().length > 0 ? directory.trim().replace(/[\\/]+$/u, '') : '';
      const personaRoot = personaDirectory.trim().length > 0 ? personaDirectory.trim().replace(/[\\/]+$/u, '') : '';

      async function save() {
        if (!dirty || disabled || typeof form.mutate !== 'function') return;
        const ops = [];
        if (directory !== storedDirectory) ops.push({ op: 'set', path: ['directory'], value: directory.trim() });
        if (habits !== storedHabits) ops.push({ op: 'set', path: ['habitsEnabled'], value: habits });
        if (identityFile !== storedIdentity) ops.push({ op: 'set', path: ['identityFile'], value: identityFile.trim() });
        if (personaDirectory !== storedPersona) ops.push({ op: 'set', path: ['personaDirectory'], value: personaDirectory.trim() });
        if (personaScoped !== storedScoped) ops.push({ op: 'set', path: ['personaWorkspaceScoped'], value: personaScoped });
        if (cross !== storedCross) ops.push({ op: 'set', path: ['crossWorkspaceEnabled'], value: cross });
        if (crossAttach !== storedCrossAttach) ops.push({ op: 'set', path: ['crossWorkspaceAttach'], value: crossAttach });
        if (allowlist.join('\n') !== storedAllowlist.join('\n')) ops.push({ op: 'set', path: ['crossWorkspaceAllowlist'], value: allowlist });
        if (ops.length === 0) return;
        setBusy(true);
        setStatus('');
        try {
          await form.mutate(ops, revision);
          setStatus(t('saved'));
        } catch {
          setStatus(t('saveFailed'));
        } finally {
          setBusy(false);
        }
      }

      async function browse() {
        if (disabled || typeof props.pickDirectory !== 'function') return;
        try {
          const picked = await props.pickDirectory();
          if (typeof picked === 'string' && picked.length > 0) setDirectory(picked);
        } catch {
          /* the picker may be unavailable in this deployment */
        }
      }

      async function browsePersona() {
        if (disabled || typeof props.pickDirectory !== 'function') return;
        try {
          const picked = await props.pickDirectory();
          if (typeof picked === 'string' && picked.length > 0) setPersonaDirectory(picked);
        } catch {
          /* the picker may be unavailable in this deployment */
        }
      }

      return h('div', { style: styles.page },
        h('section', { style: styles.section },
          h('h3', { style: styles.heading }, t('title')),
          h('div', { style: styles.field },
            h('label', { style: styles.label, htmlFor: 'session-memory-directory' }, t('directory')),
            h('input', {
              id: 'session-memory-directory',
              type: 'text',
              value: directory,
              disabled,
              spellCheck: false,
              placeholder: t('defaultPath'),
              style: styles.input,
              onChange: (event) => setDirectory(event.target.value),
            }),
            h('div', { style: styles.row },
              h('button', { type: 'button', style: styles.button, disabled, onClick: browse }, t('browse')),
              h('button', {
                type: 'button',
                style: styles.button,
                disabled,
                onClick: () => setDirectory(''),
              }, t('reset'))),
            h('p', { style: styles.hint }, t('directoryHint')),
            h('p', { style: styles.hint }, t('migration'))),
          h('div', { style: styles.field },
            h('span', { style: styles.label }, t('derived')),
            h('div', { style: styles.mono },
              `${t('factsFile')}\n${t('habitsFile')}\n${t('habitsBackup')}`.replace(/<root>/gu, root || t('defaultPath')))),
        ),
        h('section', { style: styles.section },
          h('h3', { style: styles.heading }, t('identityTitle')),
          h('div', { style: styles.field },
            h('label', { style: styles.label, htmlFor: 'session-memory-identity' }, t('identityFile')),
            h('input', {
              id: 'session-memory-identity',
              type: 'text',
              value: identityFile,
              disabled,
              spellCheck: false,
              placeholder: t('identityPlaceholder'),
              style: styles.input,
              onChange: (event) => setIdentityFile(event.target.value),
            }),
            h('p', { style: styles.hint }, t('identityHint')))),
        h('section', { style: styles.section },
          h('h3', { style: styles.heading }, t('personaTitle')),
          h('label', { style: styles.checkboxRow },
            h('input', {
              type: 'checkbox',
              checked: personaScoped,
              disabled,
              onChange: (event) => setPersonaScoped(event.target.checked),
            }),
            h('span', { style: styles.label }, t('personaScoped'))),
          h('p', { style: styles.hint }, t('personaScopedHint')),
          h('div', { style: styles.field },
            h('label', { style: styles.label, htmlFor: 'session-memory-persona' }, t('personaDirectory')),
            h('input', {
              id: 'session-memory-persona',
              type: 'text',
              value: personaDirectory,
              disabled,
              spellCheck: false,
              placeholder: t('personaDefaultPath'),
              style: styles.input,
              onChange: (event) => setPersonaDirectory(event.target.value),
            }),
            h('div', { style: styles.row },
              h('button', { type: 'button', style: styles.button, disabled, onClick: browsePersona }, t('browse')),
              h('button', {
                type: 'button',
                style: styles.button,
                disabled,
                onClick: () => setPersonaDirectory(''),
              }, t('reset'))),
            h('p', { style: styles.hint }, t('personaHint')),
            h('div', { style: styles.mono },
              t(personaScoped ? 'personaDerived' : 'personaDerivedGlobal').replace(/<root>/gu, personaRoot || t('personaDefaultPath'))))),
        h('section', { style: styles.section },
          h('h3', { style: styles.heading }, t('crossTitle')),
          h('label', { style: styles.checkboxRow },
            h('input', {
              type: 'checkbox',
              checked: cross,
              disabled,
              onChange: (event) => setCross(event.target.checked),
            }),
            h('span', { style: styles.label }, t('crossAllow'))),
          h('p', { style: styles.hint }, t('crossAllowHint')),
          h('div', { style: styles.row },
            h('button', {
              type: 'button',
              style: styles.button,
              disabled: disabled || !cross,
              onClick: () => setPickerOpen(true),
            }, t('crossPicker')),
            h('span', { style: styles.hint }, allowlist.length > 0 ? t('crossSelected', { count: allowlist.length }) : t('crossEmpty'))),
          allowlist.length > 0 ? h('div', { style: styles.mono }, allowlist.join('\n')) : null,
          h('label', { style: styles.checkboxRow },
            h('input', {
              type: 'checkbox',
              checked: crossAttach,
              disabled: disabled || !cross,
              onChange: (event) => setCrossAttach(event.target.checked),
            }),
            h('span', { style: styles.label }, t('crossAttach'))),
          h('p', { style: styles.hint }, t('crossAttachHint'))),
        h('section', { style: styles.section },
          h('h3', { style: styles.heading }, t('habitsTitle')),
          h('label', { style: styles.checkboxRow },
            h('input', {
              type: 'checkbox',
              checked: habits,
              disabled,
              onChange: (event) => setHabits(event.target.checked),
            }),
            h('span', { style: styles.label }, t('habits'))),
          h('p', { style: styles.hint }, t('habitsHint'))),
        h('div', { style: styles.row },
          h('button', {
            type: 'button',
            style: styles.primary,
            disabled: !dirty || disabled,
            onClick: save,
          }, busy ? t('saving') : t('save')),
          h('span', { style: styles.status }, writable ? status : t('readOnly'))),
        pickerOpen ? h(WorkspacePickerDialog, {
          useWorkspaces: props.useWorkspaces,
          selected: allowlist,
          t,
          onApply: (next) => {
            setAllowlist(next);
            setPickerOpen(false);
          },
          onClose: () => setPickerOpen(false),
        }) : null,
      );
    }

    function apply(ctx) {
      const t = ctx.locale.bind(NS);
      const uiWorkspace = typeof ctx.get === 'function' ? ctx.get('uiWorkspace') : ctx.uiWorkspace;
      const configForms = typeof ctx.get === 'function' ? ctx.get('configForms') : undefined;
      const pickDirectory = () => (uiWorkspace && typeof uiWorkspace.pickDirectory === 'function' ? uiWorkspace.pickDirectory() : Promise.resolve(null));
      const getConfigForm = () => {
        if (!configForms || typeof configForms.get !== 'function') return undefined;
        let candidates = [`include:${ROW}`, ROW];
        try {
          const mirror = configForms.getSnapshot?.() ?? configForms.describe?.();
          const namespaces = mirror?.view?.namespaces ?? mirror?.namespaces ?? (Array.isArray(mirror) ? mirror : []);
          const match = namespaces.find((view) => typeof view?.ns === 'string' && view.ns.includes('session-memory'));
          if (match) candidates = [match.ns, ...candidates];
        } catch {
          /* fall back to the two known spellings */
        }
        for (const ns of [...new Set(candidates)]) {
          try {
            const form = configForms.get(ns);
            const state = form?.getSnapshot?.();
            if (state && typeof form.mutate === 'function') {
              return { state, mutate: (ops, revision) => form.mutate(ops, revision) };
            }
          } catch {
            /* try the next namespace spelling */
          }
        }
        return undefined;
      };
      ctx.effect(() => ctx.locale.register(NS, { zh, en }), 'session-memory: dictionaries');
      // The manager keys a row's page by `<package>#<row id>`; the row id is the
      // patch id in some builds and the Loader entry id in others. Register both
      // so the row's configure affordance appears either way.
      for (const key of [`${BUNDLE}#${ROW}`, `${BUNDLE}#include:${ROW}`]) {
        ctx.slots.inject('plugins.row.config', () => ctx.slots.register({
          name: 'plugins.row.config',
          key,
          locale: NS,
          inject: () => ({ pickDirectory, getConfigForm }),
        }, SessionMemoryPage));
      }
      // A global panel entry beside Settings: the button opens a portal dialog
      // with all pinned work-memory entries. The Host route is local-only.
      ctx.slots.inject('sidebar.footer.action', () => ctx.slots.register({
        name: 'sidebar.footer.action',
        id: 'session-memory-pins',
        order: 20,
        label: () => t('pinsNav'),
        locale: NS,
      }, (props) => h(PinnedPanelButton, { ...props, t })));
      // A settings entry keyed by the Host entry id also gives the manager a
      // row-independent page whose form it can supply directly.
      ctx.slots.inject('plugins.item', () => ctx.slots.register({
        name: 'plugins.item',
        id: `include:${ROW}`,
        order: 60,
        label: () => t('title'),
        locale: NS,
        inject: () => ({ pickDirectory, getConfigForm }),
      }, SessionMemoryPage));
    }

    return {
      inject: ['slots', 'locale'],
      apply,
    };
  },
});
