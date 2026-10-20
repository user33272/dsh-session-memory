window.__ModuleLoader__.load({
  id: 'dsh-session-memory',
  factory(require) {
    const React = require('react');
    const h = React.createElement;

    const NS = 'sessionMemory';
    const BUNDLE = 'dsh-session-memory';
    const ROW = 'session-memory';

    const en = {
      summary: 'Records local session memory and interaction habits, restoring habits before facts.',
      title: 'Storage and habits',
      storageTitle: 'Storage',
      directory: 'Storage root directory',
      directoryHint: 'All local data is written under this directory: fact memory and the two habit txt files. Leave blank to use the default $DSH_HOME/context-memory.',
      browse: 'Browse…',
      reset: 'Use default',
      defaultPath: 'default ($DSH_HOME/context-memory)',
      derived: 'Derived files',
      factsFile: 'Facts: <root>/<workspace>.json',
      habitsFile: 'Habits: <root>/habits/<workspace>.1.txt (latest)',
      habitsBackup: 'Habits backup: <root>/habits/<workspace>.2.txt (previous)',
      migration: 'Changing the directory affects only data written afterwards. Existing files are not moved automatically.',
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
      summary: '本地记录会话事实与交互习惯，并在下一个会话中先恢复习惯、再恢复事实。',
      title: '存储与交互习惯',
      storageTitle: '存储',
      directory: '存储根目录',
      directoryHint: '所有本地数据都写入该目录：事实记忆与两份习惯 txt 文件。留空使用默认目录 $DSH_HOME/context-memory。',
      browse: '浏览…',
      reset: '恢复默认',
      defaultPath: '默认（$DSH_HOME/context-memory）',
      derived: '派生文件',
      factsFile: '事实：<root>/<工作区>.json',
      habitsFile: '习惯：<root>/habits/<工作区>.1.txt（最新）',
      habitsBackup: '习惯备份：<root>/habits/<工作区>.2.txt（上一次）',
      migration: '更改目录只影响之后写入的数据，旧目录中的文件不会自动迁移。',
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
    };

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

      const [directory, setDirectory] = React.useState(storedDirectory);
      const [habits, setHabits] = React.useState(storedHabits);
      const [busy, setBusy] = React.useState(false);
      const [status, setStatus] = React.useState('');

      React.useEffect(() => {
        setDirectory(storedDirectory);
        setHabits(storedHabits);
      }, [storedDirectory, storedHabits, revision]);

      const dirty = directory !== storedDirectory || habits !== storedHabits;
      const disabled = !writable || busy;
      const root = directory.trim().length > 0 ? directory.trim().replace(/[\\/]+$/u, '') : '';

      async function save() {
        if (!dirty || disabled || typeof form.mutate !== 'function') return;
        const ops = [];
        if (directory !== storedDirectory) ops.push({ op: 'set', path: ['directory'], value: directory.trim() });
        if (habits !== storedHabits) ops.push({ op: 'set', path: ['habitsEnabled'], value: habits });
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
