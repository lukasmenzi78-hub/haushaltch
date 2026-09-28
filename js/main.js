// main.js — Start, Navigation und Gerüst der App
import { store } from './core/store.js';
import { h, el, clear, debounce } from './core/util.js';
import { toast } from './ui/components.js';
import * as sync from './core/sync.js';
import { fetchRates, lastFxUpdate } from './core/fx.js';

import { renderDashboard } from './ui/dashboard.js';
import { renderAccounts } from './ui/accounts.js';
import { renderTransactions } from './ui/transactions.js';
import { renderBudget } from './ui/budget.js';
import { renderGoals } from './ui/goals.js';
import { renderReports } from './ui/reports.js';
import { renderNetWorth } from './ui/networth.js';
import { renderInvestments } from './ui/investments.js';
import { renderImport } from './ui/importview.js';
import { renderSettings, applyTheme } from './ui/settings.js';

const ROUTES = [
  { id: 'dashboard', label: 'Übersicht', icon: '◎', render: renderDashboard },
  { id: 'konten', label: 'Konten', icon: '▤', render: renderAccounts },
  { id: 'buchungen', label: 'Buchungen', icon: '☰', render: renderTransactions },
  { id: 'budget', label: 'Budget', icon: '◐', render: renderBudget },
  { id: 'vermoegen', label: 'Vermögen', icon: '▲', render: renderNetWorth },
  { id: 'anlagen', label: 'Anlagen', icon: '📈', render: renderInvestments },
  { id: 'ziele', label: 'Sparziele', icon: '◈', render: renderGoals },
  { id: 'berichte', label: 'Berichte', icon: '◧', render: renderReports },
  { id: 'import', label: 'Import', icon: '⤓', render: renderImport, secondary: true },
  { id: 'einstellungen', label: 'Einstellungen', icon: '⚙', render: renderSettings, secondary: true },
];

const state = { route: 'dashboard', params: {} };

function currentRoute() {
  const hash = (location.hash || '#dashboard').slice(1);
  const [id, query] = hash.split('?');
  const params = Object.fromEntries(new URLSearchParams(query || ''));
  return { id: ROUTES.some((r) => r.id === id) ? id : 'dashboard', params };
}

export function navigate(routeId, params = {}) {
  const q = new URLSearchParams(params).toString();
  location.hash = routeId + (q ? `?${q}` : '');
}

function buildShell() {
  const nav = h('nav', { class: 'sidebar' },
    h('div', { class: 'brand' }, h('span', { class: 'dot' }), 'HaushaltCH'));
  const primary = ROUTES.filter((r) => !r.secondary);
  const secondary = ROUTES.filter((r) => r.secondary);
  for (const r of primary) nav.append(navButton(r));
  nav.append(h('div', { class: 'nav-spacer' }));
  const sec = h('div', { class: 'nav-secondary' });
  for (const r of secondary) sec.append(navButton(r));
  nav.append(sec);
  for (const r of secondary) nav.append(navButtonMobile(r));

  const title = h('h1', { class: 'grow' }, 'Übersicht');
  const syncPill = h('div', { class: 'sync-pill', id: 'syncPill' },
    h('span', { class: 'sync-dot' }), h('span', { class: 'label' }, 'Lokal'));
  syncPill.style.cursor = 'pointer';
  syncPill.addEventListener('click', () => navigate('einstellungen', { tab: 'sync' }));

  const topbar = h('header', { class: 'topbar' },
    title,
    h('button', {
      class: 'btn ghost sm', title: 'Jetzt synchronisieren',
      onClick: () => sync.syncNow().then(() => toast('Synchronisiert', 'success')).catch((e) => toast(e.message, 'error')),
    }, '⟳'),
    syncPill);

  const view = h('main', { class: 'view', id: 'view' });
  const main = h('div', { class: 'main' }, topbar, view);
  const app = el('#app');
  clear(app);
  app.append(nav, main);
  return { nav, title, view, syncPill };
}

function navButton(r) {
  return h('button', {
    class: 'navlink', dataset: { route: r.id },
    onClick: () => navigate(r.id),
  }, h('span', { class: 'ico' }, r.icon), h('span', {}, r.label));
}
function navButtonMobile(r) {
  const b = navButton(r);
  b.classList.add('mobile-only');
  return b;
}

let shell = null;

function renderRoute() {
  const { id, params } = currentRoute();
  state.route = id; state.params = params;
  const route = ROUTES.find((r) => r.id === id);
  shell.title.textContent = route.label;
  document.title = `${route.label} · HaushaltCH`;
  for (const b of shell.nav.querySelectorAll('.navlink')) {
    b.classList.toggle('active', b.dataset.route === id);
  }
  clear(shell.view);
  try {
    const node = route.render({ params, navigate });
    if (node) shell.view.append(node);
  } catch (e) {
    console.error(e);
    shell.view.append(h('div', { class: 'card' },
      h('h2', {}, 'Fehler beim Anzeigen'),
      h('p', { class: 'small muted' }, String(e.message || e)),
      h('pre', { class: 'small', style: { whiteSpace: 'pre-wrap' } }, String(e.stack || ''))));
  }
  shell.view.scrollTop = 0;
}

const rerender = debounce(() => renderRoute(), 60);

function updateSyncPill() {
  if (!shell) return;
  const dot = shell.syncPill.querySelector('.sync-dot');
  const label = shell.syncPill.querySelector('.label');
  const s = sync.syncState;
  dot.className = 'sync-dot ' + (s.status === 'synchronisiert' ? 'ok' : s.status === 'arbeitet' ? 'busy' : s.status === 'fehler' ? 'err' : '');
  label.textContent = s.status === 'aus' ? 'Nur auf diesem Gerät'
    : s.status === 'fehler' ? 'Sync-Fehler'
      : s.status === 'arbeitet' ? 'Synchronisiert …'
        : store.meta.dirty ? 'Änderungen offen' : 'OneDrive aktuell';
}

async function boot() {
  await store.init();
  applyTheme(store.settings.theme || 'auto');
  shell = buildShell();
  window.addEventListener('hashchange', renderRoute);
  store.on('change', () => { updateSyncPill(); rerender(); });
  store.on('meta', updateSyncPill);
  sync.onSyncChange(updateSyncPill);
  renderRoute();
  updateSyncPill();

  sync.flushOnUnload();
  sync.initAuth().catch((e) => console.warn('Sync-Init:', e.message));

  // Kurse höchstens einmal pro Tag aktualisieren
  const last = lastFxUpdate();
  if (store.settings.fxAutoUpdate !== false && Date.now() - last > 20 * 3600 * 1000 && navigator.onLine) {
    fetchRates().catch(() => {});
  }

  // In der Einzeldatei-Fassung gibt es keinen Service Worker daneben
  if ('serviceWorker' in navigator && !window.__HAUSHALT_SINGLE_FILE) {
    navigator.serviceWorker.register('./sw.js').catch(() => {});
  }

  document.addEventListener('keydown', (e) => {
    if ((e.ctrlKey || e.metaKey) && e.key === 'z' && !e.shiftKey) {
      const target = e.target;
      if (target && /input|textarea|select/i.test(target.tagName)) return;
      if (store.canUndo()) { e.preventDefault(); const l = store.undo(); toast(`Rückgängig: ${l}`); }
    }
  });
}

boot().catch((e) => {
  console.error(e);
  document.body.innerHTML = `<div style="padding:32px;font-family:system-ui">
    <h1>Start fehlgeschlagen</h1><pre>${String(e.stack || e)}</pre></div>`;
});

export { store, ROUTES };
