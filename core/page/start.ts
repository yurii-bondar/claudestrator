// Start: which Claude account the agents run under, as a browser's profile picker asks whose it is. The desktop app
// opens on it (Claudestrator → Switch Account… brings it back); the first time there is only the tile that adds an account.
// An account is a Claude Code config folder (~/.claude, ~/.claude-*), or several signed in to one email: one tile.
// Adding one makes a new folder and signs in to it in a terminal. A tile can get a short name (an alias), be signed
// out of and removed, and swap places with another (drag it onto it, or Alt+← →); the host keeps all of that.

interface StartView extends View {
  data: Rpc['accounts']['result'] | null;
  /** The key of the tile whose alias is being written, or null. */
  editing: string | null;
  load(): Promise<void>;
  render(): void;
}

// Merged into the Views of globals.d.ts: the compiler sees `views.start` as a StartView.
// eslint-disable-next-line @typescript-eslint/no-unused-vars
interface Views {
  start: StartView;
}

(function () {
  const { call, attempt, icon, esc, $, $$, views, go, patch, LOGO, accountKey } = window.CS;

  /** Each account keeps one of the agents' hues, picked by its key: the same tile looks the same every time. */
  const HUES = ['blue', 'green', 'purple', 'orange', 'cyan', 'pink', 'yellow', 'red'];
  const hueOf = (key: string) => {
    let h = 0;
    for (const ch of key) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
    return `c-${HUES[h % HUES.length]}`;
  };
  const home = (dir: string) => dir.replace(/^(\/Users|\/home)\/[^/]+/, '~');
  const ALIAS_MAX = 40;

  /** A Claude account, which may be signed in to in more than one config folder (~/.claude and ~/.claude-work). */
  interface AccountTile {
    key: string;
    /** Its email, else its folder's label. */
    name: string;
    alias: string | undefined;
    /** The folder the agents work under when the tile is picked. */
    dir: string;
    dirs: string[];
    current: boolean;
    loggedIn: boolean | undefined;
    plan: string | undefined;
  }

  /**
   * One tile per account: the folders of one email together; a folder whose email is not known yet is a tile of its
   * own. A tile works under the folder in use now, else one signed in to, else the first.
   */
  function tilesOf(entries: readonly AccountEntry[], aliases: Readonly<Record<string, string>>): AccountTile[] {
    const groups = new Map<string, AccountEntry[]>();
    for (const e of entries) {
      const key = accountKey(e);
      groups.set(key, [...(groups.get(key) ?? []), e]);
    }
    return [...groups].map(([key, list]) => {
      const pick = list.find((e) => e.current) ?? list.find((e) => e.loggedIn) ?? list[0]!;
      return { key, name: pick.email || pick.label, alias: aliases[key] || undefined, dir: pick.dir, dirs: list.map((e) => e.dir), current: list.some((e) => e.current), loggedIn: pick.loggedIn, plan: list.find((e) => e.plan)?.plan };
    });
  }

  /** The tiles in the order you put them (`order`, their keys); tiles it does not name follow, as they came. */
  function ordered(tiles: AccountTile[], order: readonly string[]): AccountTile[] {
    const at = (t: AccountTile) => {
      const i = order.indexOf(t.key);
      return i === -1 ? order.length : i;
    };
    return tiles.map((t, i) => ({ t, i })).sort((a, b) => at(a.t) - at(b.t) || a.i - b.i).map((x) => x.t);
  }

  /** `keys` with the two named swapped. */
  function swapped(keys: readonly string[], a: string, b: string): string[] {
    const i = keys.indexOf(a);
    const j = keys.indexOf(b);
    if (i === -1 || j === -1 || i === j) return [...keys];
    const out = [...keys];
    [out[i], out[j]] = [out[j]!, out[i]!];
    return out;
  }

  /** The tiles as they show now, in order. */
  const shown = (d: Rpc['accounts']['result']) => ordered(tilesOf(d.accounts, d.aliases), d.order);
  const tileByKey = (key: string | undefined) => {
    const d = views.start.data;
    return d && key ? shown(d).find((t) => t.key === key) : undefined;
  };

  /** Puts the tiles in this order, at once on the page, and has the host keep it. */
  function arrange(keys: string[]) {
    const v = views.start;
    if (!v.data) return;
    v.data = { ...v.data, order: keys };
    v.render();
    void attempt('setAccountOrder', { order: keys }, null);
  }

  /** The account tile an event happened in (not the add tile, which stays last). */
  const tileOf = (target: EventTarget | null) => (target instanceof Element ? target.closest<HTMLElement>('.acc-tile[data-key]') : null);

  /** Drag a tile onto another to swap them; Alt+← → swaps the focused one with its neighbour; Esc leaves an alias. */
  function listen(region: HTMLElement) {
    let dragged: string | null = null;
    const clear = () => $$('.acc-tile.drop-target, .acc-tile.dragging', region).forEach((t) => t.classList.remove('drop-target', 'dragging'));
    region.addEventListener('dragstart', (e) => {
      const t = tileOf(e.target);
      if (!t || !e.dataTransfer) return;
      dragged = t.dataset.key!;
      t.classList.add('dragging');
      e.dataTransfer.effectAllowed = 'move';
      e.dataTransfer.setData('text/plain', dragged);
    });
    region.addEventListener('dragover', (e) => {
      const t = tileOf(e.target);
      if (!dragged || !t || t.dataset.key === dragged) return;
      e.preventDefault();
      if (!t.classList.contains('drop-target')) {
        $$('.acc-tile.drop-target', region).forEach((x) => x.classList.remove('drop-target'));
        t.classList.add('drop-target');
      }
    });
    region.addEventListener('drop', (e) => {
      const t = tileOf(e.target);
      const d = views.start.data;
      if (!dragged || !t || !d) return;
      e.preventDefault();
      const from = dragged;
      dragged = null;
      clear();
      arrange(swapped(shown(d).map((x) => x.key), from, t.dataset.key!));
    });
    region.addEventListener('dragend', () => {
      dragged = null;
      clear();
    });
    region.addEventListener('keydown', (e) => {
      const v = views.start;
      if (e.key === 'Escape' && v.editing) {
        v.editing = null;
        v.render();
        return;
      }
      if (!e.altKey || (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight')) return;
      const t = tileOf(e.target);
      const d = v.data;
      if (!t || !d) return;
      const keys = shown(d).map((x) => x.key);
      const other = keys[keys.indexOf(t.dataset.key!) + (e.key === 'ArrowLeft' ? -1 : 1)];
      if (!other) return;
      e.preventDefault();
      // The tile keeps the focus as it moves: patch finds it again by its folder.
      arrange(swapped(keys, t.dataset.key!, other));
    });
  }

  function accountTile(a: AccountTile, editing: boolean) {
    const shownName = a.alias || a.name;
    const state = a.loggedIn === undefined ? '' : a.loggedIn ? `<span class="acc-state ok">Signed in</span>` : `<span class="acc-state warn">Signed out · sign in</span>`;
    const more = a.dirs.length > 1 ? ` +${a.dirs.length - 1}` : '';
    const meta = [a.plan ? a.plan[0]!.toUpperCase() + a.plan.slice(1) : '', `${home(a.dir)}${more}`].filter(Boolean).join(' · ');
    const avatar = `<span class="acc-avatar ${hueOf(a.key)}" aria-hidden="true">${esc(shownName.charAt(0).toUpperCase())}</span>`;
    const email = a.alias ? `<span class="acc-email">${esc(a.name)}</span>` : '';
    if (editing) {
      return `<div class="acc-tile editing" data-key="${esc(a.key)}">
        <div class="acc-main">
          ${avatar}
          <input class="input sm acc-alias" data-change="start-alias" data-key="${esc(a.key)}" value="${esc(a.alias || '')}" placeholder="${esc(a.name.split('@')[0] || 'Alias')}" maxlength="${ALIAS_MAX}" aria-label="A short name for ${esc(a.name)}">
          <span class="acc-meta wrap">Enter to keep · Esc to leave</span>
        </div>
      </div>`;
    }
    const title = [a.name, ...a.dirs.map((d) => `${d}${d === a.dir ? ' (used)' : ''}`), 'Drag onto another to swap them, or Alt+← →'].join('\n');
    return `<div class="acc-tile ${a.current ? 'current' : ''}" data-key="${esc(a.key)}" draggable="true">
      <button class="acc-main" data-action="start-pick" data-dir="${esc(a.dir)}" ${a.current ? 'aria-current="true"' : ''} title="${esc(title)}">
        ${avatar}
        <span class="acc-name">${esc(shownName)}</span>
        ${email}
        <span class="acc-meta">${esc(meta)}</span>
        ${state}
        ${a.current ? '<span class="acc-inuse">In use</span>' : ''}
      </button>
      <span class="acc-tools">
        <button class="icon-btn" data-action="start-rename" data-key="${esc(a.key)}" title="${a.alias ? 'Rename' : 'Give it a short name'}" aria-label="Alias for ${esc(a.name)}">${icon('edit')}</button>
        <button class="icon-btn" data-action="start-remove" data-key="${esc(a.key)}" title="Sign out and remove" aria-label="Sign out of ${esc(a.name)} and remove it">${icon('trash')}</button>
      </span>
    </div>`;
  }

  function addTile(signingIn: boolean, alone: boolean) {
    if (signingIn) {
      return `<div class="acc-tile pending" role="status">
        <span class="acc-avatar" aria-hidden="true"><span class="spinner"></span></span>
        <span class="acc-name">Signing in…</span>
        <span class="acc-meta wrap">Finish in the terminal window that opened</span>
        <button class="btn ghost sm" data-action="start-cancel">Cancel</button>
      </div>`;
    }
    return `<button class="acc-tile add ${alone ? 'alone' : ''}" data-action="start-add">
      <span class="acc-avatar" aria-hidden="true">${icon('plus')}</span>
      <span class="acc-name">Add account</span>
      <span class="acc-meta">Sign in to Claude</span>
    </button>`;
  }

  views.start = {
    data: null,
    editing: null,
    async enter() {
      this.editing = null;
      $('#view')!.innerHTML = `<div class="start" data-region="start"><div class="loading"><div class="spinner"></div></div></div>`;
      listen($('[data-region="start"]')!);
      await this.load();
      // Whether each account is signed in is known once Claude Code was found (the checks run when first needed);
      // the tiles say so as soon as they are done, and again when the sign-in states come in (a `changed`).
      void call('health', {}).then(() => this.load(), () => undefined);
    },
    async load() {
      this.data = await call('accounts');
      this.render();
    },
    // A sign-in that ended, an account checked again: the tiles say so.
    refresh() {
      return this.load();
    },
    render() {
      const d = this.data;
      if (!d) return;
      const first = !d.accounts.length;
      patch(
        'start',
        `${first ? '' : `<button class="btn ghost sm start-back" data-action="go-home" title="Back to the tasks, under the account in use">${icon('back')}Tasks</button>`}
        <span class="logo start-logo">${LOGO}</span>
        <h1>${first ? 'Welcome to Claudestrator' : 'Choose an account'}</h1>
        <p class="start-sub">${first ? 'Sign in to a Claude account to start. Agents run under it, and its usage limits show in the side rail.' : 'Agents run under the account you choose. Switch any time from the account menu in the side rail.'}</p>
        <div class="start-tiles">${shown(d).map((t) => accountTile(t, t.key === this.editing)).join('')}${addTile(d.signingIn, first)}</div>
        <p class="start-foot">Accounts are read from Claude Code's config folders: ~/.claude, ~/.claude-*</p>`
      );
    },
    actions: {
      // A signed-in account: work under it. A signed-out one is signed in to first, here.
      'start-pick': async (el) => {
        const v = views.start;
        const account = v.data && v.data.accounts.find((a) => a.dir === el.dataset.dir);
        if (!account) return;
        if ((await attempt('setAccount', { dir: account.dir })) === undefined) return;
        if (account.loggedIn === false) {
          await attempt('claudeLogin');
          return v.load();
        }
        return go({ name: 'home' });
      },
      'start-rename': (el) => {
        const v = views.start;
        v.editing = el.dataset.key ?? null;
        v.render();
        const input = $<HTMLInputElement>('.acc-alias');
        if (input) {
          input.focus();
          input.select();
        }
      },
      // The host asks you first (Claude Code signs out in the account's folders); the tile goes once it did.
      'start-remove': async (el) => {
        const tile = tileByKey(el.dataset.key);
        if (!tile) return;
        const r = await attempt('removeAccount', { dirs: tile.dirs }, null);
        if (r && r.removed) await views.start.load();
      },
      'start-add': async () => {
        await attempt('addAccount');
        return views.start.load();
      },
      'start-cancel': async () => {
        await attempt('cancelClaudeLogin');
        return views.start.load();
      },
    },
    changes: {
      // Enter (or leaving the field) keeps the alias; an empty one takes it off.
      'start-alias': (el) => {
        const v = views.start;
        const key = el.dataset.key;
        if (!v.data || !key || v.editing !== key) return;
        const alias = el.value.trim().slice(0, ALIAS_MAX);
        const { [key]: _old, ...rest } = v.data.aliases;
        v.data = { ...v.data, aliases: alias ? { ...rest, [key]: alias } : rest };
        v.editing = null;
        v.render();
        void attempt('setAccountAlias', { key, alias }, null);
      },
    },
  };
})();
