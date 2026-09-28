// settings.js — Einstellungen, OneDrive-Verbindung, Kategorien, Regeln
import { store } from '../core/store.js';
import { h, fmtMoney, fmtDate, fmtNumber, uid, now, todayISO, sortBy, CURRENCIES, escapeHtml } from '../core/util.js';
import { newCategory, newRule, BUDGET_TYPES, newDoc } from '../core/model.js';
import { RULE_FIELDS, RULE_OPS, applyRulesTo } from '../core/rules.js';
import { fetchRates, setRate, rateToBase, currenciesInUse, unknownCurrencies, seededOnlyCurrencies, SEED_RATES } from '../core/fx.js';
import * as sync from '../core/sync.js';
import { PROVIDERS, getProvider, setProvider, getKey, setKey, testConnection } from '../core/quotes.js';
import { modal, toast, confirmDialog, categorySelect, memberSelect, colorSwatches, statTile, emptyState, segmented } from './components.js';

const TABS = [
  { id: 'allgemein', label: 'Allgemein' },
  { id: 'sync', label: 'OneDrive-Sync' },
  { id: 'kategorien', label: 'Kategorien' },
  { id: 'regeln', label: 'Regeln' },
  { id: 'waehrungen', label: 'Währungen' },
  { id: 'kurse', label: 'Kurse' },
  { id: 'daten', label: 'Daten' },
];

let activeTab = 'allgemein';

export function renderSettings({ params, navigate }) {
  if (params.tab) activeTab = params.tab;
  const root = h('div', {});
  root.append(h('div', { class: 'card', style: { marginBottom: '14px' } },
    h('div', { class: 'pill-row' },
      TABS.map((t) => h('button', {
        class: 'chip' + (t.id === activeTab ? ' active' : ''),
        onClick: () => { activeTab = t.id; rerender(); },
      }, t.label)))));

  const body = h('div', {});
  root.append(body);
  switch (activeTab) {
    case 'sync': body.append(syncTab(rerender)); break;
    case 'kategorien': body.append(categoriesTab(rerender)); break;
    case 'regeln': body.append(rulesTab(rerender)); break;
    case 'waehrungen': body.append(currencyTab(rerender)); break;
    case 'kurse': body.append(quotesTab(rerender)); break;
    case 'daten': body.append(dataTab(rerender)); break;
    default: body.append(generalTab(rerender));
  }
  return root;

  function rerender() {
    const parent = root.parentElement;
    if (parent) parent.replaceChild(renderSettings({ params: {}, navigate }), root);
  }
}

/* ---------------- Allgemein ---------------- */

function generalTab(rerender) {
  const s = store.settings;
  const card = h('section', { class: 'card' });
  card.append(h('div', { class: 'card-head' }, h('h3', { class: 'grow' }, 'Haushalt')));

  card.append(h('div', { class: 'form-grid' },
    h('label', { class: 'field' }, h('span', {}, 'Bezeichnung'),
      h('input', { type: 'text', value: s.householdName, onChange: (e) => store.setSettings({ householdName: e.target.value }) })),
    h('label', { class: 'field' }, h('span', {}, 'Basiswährung'),
      h('select', { onChange: (e) => { store.setSettings({ baseCurrency: e.target.value }); rerender(); } },
        CURRENCIES.map((c) => h('option', { value: c, selected: c === s.baseCurrency }, c)))),
    h('label', { class: 'field' }, h('span', {}, 'Darstellung'),
      h('select', {
        onChange: (e) => {
          store.setSettings({ theme: e.target.value });
          applyTheme(e.target.value);
        },
      },
        h('option', { value: 'auto', selected: s.theme === 'auto' }, 'Automatisch (Systemeinstellung)'),
        h('option', { value: 'light', selected: s.theme === 'light' }, 'Hell'),
        h('option', { value: 'dark', selected: s.theme === 'dark' }, 'Dunkel'))),
    h('label', { class: 'field' }, h('span', {}, 'Sicherheitspuffer auf dem Flex-Topf (%)'),
      h('input', {
        type: 'number', min: 0, max: 40, value: s.flexBufferPct || 0,
        onChange: (e) => store.setSettings({ flexBufferPct: Number(e.target.value) }),
      }))));

  const memberCard = h('section', { class: 'card' });
  memberCard.append(h('div', { class: 'card-head' },
    h('h3', { class: 'grow' }, 'Personen im Haushalt'),
    h('button', { class: 'btn sm', onClick: () => editMember(null, rerender) }, '+ Person')));
  for (const m of s.members) {
    memberCard.append(h('div', { class: 'list-row' },
      h('i', { class: 'cat-dot', style: { background: m.color } }),
      h('span', { class: 'grow' }, m.name),
      h('button', { class: 'btn ghost sm', onClick: () => editMember(m, rerender) }, 'Bearbeiten')));
  }
  memberCard.append(h('p', { class: 'small muted' },
    'Buchungen können einer Person zugeordnet werden – nützlich für Auswertungen und für getrennte Kartenkonten.'));

  return h('div', {}, card, memberCard);
}

export function applyTheme(theme) {
  try { localStorage.setItem('swissfin.theme', theme); } catch (e) { /* egal */ }
  if (theme === 'auto') document.documentElement.removeAttribute('data-theme');
  else document.documentElement.setAttribute('data-theme', theme);
}

function editMember(member, rerender) {
  const isNew = !member;
  const m = member ? { ...member } : { id: uid('u'), name: '', color: 'var(--series-3)' };
  const nameI = h('input', { type: 'text', value: m.name, onInput: (e) => { m.name = e.target.value; } });
  modal({
    title: isNew ? 'Person hinzufügen' : 'Person bearbeiten',
    body: h('div', {},
      h('label', { class: 'field' }, h('span', {}, 'Name'), nameI),
      h('div', { style: { marginTop: '10px' } }, h('span', { class: 'small muted' }, 'Farbe'), colorSwatches(m.color, (c) => { m.color = c; }))),
    actions: [
      { label: 'Abbrechen' },
      !isNew && store.settings.members.length > 1 ? {
        label: 'Entfernen', variant: 'danger',
        onClick: async () => {
          if (!await confirmDialog(`${m.name} entfernen? Buchungen bleiben erhalten, verlieren aber die Zuordnung.`)) return false;
          store.setSettings({ members: store.settings.members.filter((x) => x.id !== m.id) }, 'Person entfernt');
          rerender();
        },
      } : null,
      {
        label: 'Speichern', variant: 'primary',
        onClick: () => {
          const list = isNew ? [...store.settings.members, m]
            : store.settings.members.map((x) => (x.id === m.id ? m : x));
          store.setSettings({ members: list }, 'Person gespeichert');
          rerender();
        },
      },
    ].filter(Boolean),
  });
}

/* ---------------- OneDrive ---------------- */

function syncTab(rerender) {
  const st = sync.syncState;
  const card = h('section', { class: 'card' });
  card.append(h('div', { class: 'card-head' }, h('h3', { class: 'grow' }, 'OneDrive-Synchronisation'),
    h('span', { class: `badge ${st.status === 'synchronisiert' ? 'good' : st.status === 'fehler' ? 'crit' : ''}` }, st.message)));

  card.append(h('p', { class: 'small muted' },
    'Die App speichert alle Daten in einer einzigen JSON-Datei in deinem OneDrive. Gib den Ordner für Lea frei, dann arbeiten beide Geräte auf demselben Stand. Es gibt keinen fremden Server – die Daten gehen direkt von deinem Gerät zu Microsoft.'));

  const clientI = h('input', { type: 'text', value: sync.getClientId(), placeholder: '00000000-0000-0000-0000-000000000000' });
  const pathI = h('input', { type: 'text', value: sync.getFilePath(), placeholder: 'HaushaltCH/haushalt.json' });
  const redirect = sync.redirectUri();

  card.append(h('div', { class: 'form-grid' },
    h('label', { class: 'field' }, h('span', {}, 'Anwendungs-ID (Client-ID) aus Azure'), clientI,
      h('span', { class: 'small muted' }, 'Einmalig im Microsoft-Entra-Portal anlegen – siehe Anleitung unten.')),
    h('label', { class: 'field' }, h('span', {}, 'Dateipfad in OneDrive'), pathI,
      h('span', { class: 'small muted' }, 'Wird beim ersten Start automatisch angelegt.')),
    h('label', { class: 'field', style: { gridColumn: '1 / -1' } }, h('span', {}, 'Umleitungs-URI (im Portal eintragen)'),
      h('input', { type: 'text', value: redirect, readonly: true, onClick: (e) => e.target.select() }))));

  card.append(h('div', { class: 'row', style: { marginTop: '14px' } },
    h('button', {
      class: 'btn primary', onClick: async () => {
        sync.setClientId(clientI.value);
        sync.setFilePath(pathI.value);
        try {
          await sync.initAuth({ silent: false });
          await sync.signIn();
          await sync.syncNow();
          toast('Mit OneDrive verbunden', 'success');
          rerender();
        } catch (e) { toast(e.message, 'error', { timeout: 9000 }); }
      },
    }, st.account ? 'Erneut anmelden' : 'Mit Microsoft anmelden'),
    st.account ? h('button', {
      class: 'btn', onClick: async () => { await sync.syncNow(); toast('Synchronisiert', 'success'); rerender(); },
    }, 'Jetzt synchronisieren') : null,
    st.account ? h('button', {
      class: 'btn', onClick: () => openSharedPicker(rerender),
    }, 'Gemeinsame Datei wählen') : null,
    st.account ? h('button', {
      class: 'btn ghost danger', onClick: async () => { await sync.signOut(); rerender(); },
    }, 'Abmelden') : null));

  if (store.meta.remote?.itemId) {
    card.append(h('p', { class: 'small muted', style: { marginTop: '10px' } },
      `Verbunden mit: ${store.meta.remote.name || store.meta.remote.path}${store.meta.remote.shared ? ' (freigegeben)' : ''} · zuletzt ${store.meta.lastSyncAt ? new Date(store.meta.lastSyncAt).toLocaleString('de-CH') : 'nie'}`));
  }

  const guide = h('section', { class: 'card' });
  guide.append(h('div', { class: 'card-head' }, h('h3', { class: 'grow' }, 'Einmalige Einrichtung (ca. 10 Minuten)')));
  guide.append(h('ol', { class: 'small' },
    h('li', {}, 'Auf ', h('a', { href: 'https://entra.microsoft.com', target: '_blank', rel: 'noopener' }, 'entra.microsoft.com'), ' mit dem Microsoft-Konto anmelden.'),
    h('li', {}, '„Identität → Anwendungen → App-Registrierungen“ öffnen und ', h('b', {}, 'Neue Registrierung'), ' wählen.'),
    h('li', {}, 'Name z. B. „HaushaltCH“. Bei den unterstützten Kontotypen ', h('b', {}, '„Konten in einem beliebigen Organisationsverzeichnis und persönliche Microsoft-Konten“'), ' auswählen.'),
    h('li', {}, 'Als Plattform ', h('b', {}, 'Einzelseitenanwendung (SPA)'), ' wählen und diese Umleitungs-URI eintragen: ', h('span', { class: 'kbd' }, redirect)),
    h('li', {}, 'Nach dem Anlegen die ', h('b', {}, 'Anwendungs-ID (Client)'), ' kopieren und oben einfügen.'),
    h('li', {}, 'Unter „API-Berechtigungen“ die delegierten Microsoft-Graph-Rechte ', h('span', { class: 'kbd' }, 'Files.ReadWrite'), ', ', h('span', { class: 'kbd' }, 'Files.ReadWrite.All'), ' und ', h('span', { class: 'kbd' }, 'User.Read'), ' hinzufügen.'),
    h('li', {}, 'Auf „Mit Microsoft anmelden“ klicken – fertig.'),
    h('li', {}, 'Für Lea: in OneDrive den Ordner der Datei für ihr Konto freigeben (Bearbeiten erlauben). Sie meldet sich mit ihrem eigenen Konto an und wählt „Gemeinsame Datei wählen“.')));

  return h('div', {}, card, guide);
}

function openSharedPicker(rerender) {
  const body = h('div', {}, h('p', { class: 'small muted' }, 'Lade Dateien …'));
  const dlg = modal({ title: 'Gemeinsame Datei wählen', body, actions: [{ label: 'Schliessen' }] });
  Promise.all([sync.listSharedFiles(), sync.listOwnFiles()]).then(([shared, own]) => {
    body.replaceChildren();
    const all = [...shared, ...own.filter((f) => !f.isFolder && /\.json$/i.test(f.name))];
    if (!all.length) { body.append(h('p', { class: 'small muted' }, 'Keine JSON-Dateien gefunden. Lea muss den Ordner zuerst freigeben.')); return; }
    for (const f of all) {
      body.append(h('div', { class: 'list-row' },
        h('div', { class: 'grow' },
          h('div', { class: 'title' }, f.name),
          h('div', { class: 'txn-sub' }, `${f.shared ? 'freigegeben von ' + (f.owner || '–') : 'eigene Datei'}${f.modified ? ' · ' + new Date(f.modified).toLocaleString('de-CH') : ''}`)),
        h('button', {
          class: 'btn sm primary', onClick: async () => {
            try {
              await sync.useRemoteFile(f);
              toast('Datei verbunden und synchronisiert', 'success');
              dlg.close(); rerender();
            } catch (e) { toast(e.message, 'error'); }
          },
        }, 'Verwenden')));
    }
  }).catch((e) => { body.replaceChildren(h('p', { class: 'small' }, e.message)); });
}

/* ---------------- Kategorien ---------------- */

function categoriesTab(rerender) {
  const root = h('div', {});
  const card = h('section', { class: 'card' });
  card.append(h('div', { class: 'card-head' },
    h('h3', { class: 'grow' }, 'Kategorien'),
    h('button', { class: 'btn sm', onClick: () => editGroup(null, rerender) }, '+ Gruppe'),
    h('button', { class: 'btn sm primary', onClick: () => editCategory(null, rerender) }, '+ Kategorie')));

  for (const g of sortBy(store.idx.groups, (x) => x.sort ?? 0)) {
    const det = h('details', { class: 'acc' });
    const cats = store.categoriesOfGroup(g.id);
    det.append(h('summary', {},
      h('i', { class: 'cat-dot', style: { background: g.color } }),
      `${g.icon || ''} ${g.name}`,
      h('span', { class: 'small muted' }, ` (${cats.length})`),
      h('button', {
        class: 'btn ghost sm', style: { float: 'right' },
        onClick: (e) => { e.preventDefault(); editGroup(g, rerender); },
      }, 'Bearbeiten')));
    for (const c of cats) {
      det.append(h('div', { class: 'list-row' },
        h('span', { class: 'grow' }, `${c.icon || ''} ${c.name}`),
        h('span', { class: 'badge' }, BUDGET_TYPES.find((b) => b.id === c.budgetType)?.label || c.budgetType),
        c.rollover ? h('span', { class: 'badge' }, 'Übertrag') : null,
        c.annualAmount ? h('span', { class: 'badge' }, `${fmtMoney(c.annualAmount, store.baseCurrency, { noDecimals: true })}/Jahr`) : null,
        h('button', { class: 'btn ghost sm', onClick: () => editCategory(c, rerender) }, 'Bearbeiten')));
    }
    card.append(det);
  }
  root.append(card);
  return root;
}

function editCategory(cat, rerender) {
  const isNew = !cat;
  const c = cat ? { ...cat } : newCategory({ groupId: store.idx.groups[0]?.id });
  const nameI = h('input', { type: 'text', value: c.name, onInput: (e) => { c.name = e.target.value; } });
  const iconI = h('input', { type: 'text', value: c.icon || '', maxlength: 3, onInput: (e) => { c.icon = e.target.value; } });
  const groupI = h('select', { onChange: (e) => { c.groupId = e.target.value; } },
    store.idx.groups.map((g) => h('option', { value: g.id, selected: g.id === c.groupId }, g.name)));
  const typeI = h('select', { onChange: (e) => { c.budgetType = e.target.value; } },
    BUDGET_TYPES.map((b) => h('option', { value: b.id, selected: b.id === c.budgetType }, b.label)));
  const annualI = h('input', { type: 'number', step: '10', value: c.annualAmount ?? '', onInput: (e) => { c.annualAmount = e.target.value ? Number(e.target.value) : null; } });
  const rollI = h('input', { type: 'checkbox', checked: !!c.rollover, onChange: (e) => { c.rollover = e.target.checked; } });

  modal({
    title: isNew ? 'Neue Kategorie' : 'Kategorie bearbeiten', wide: true,
    body: h('div', {},
      h('div', { class: 'form-grid' },
        h('label', { class: 'field' }, h('span', {}, 'Name'), nameI),
        h('label', { class: 'field' }, h('span', {}, 'Symbol'), iconI),
        h('label', { class: 'field' }, h('span', {}, 'Gruppe'), groupI),
        h('label', { class: 'field' }, h('span', {}, 'Budgettyp'), typeI),
        h('label', { class: 'field' }, h('span', {}, 'Jahresbetrag (optional)'), annualI),
        h('label', { class: 'row tight' }, rollI, h('span', {}, 'Restbudget übertragen'))),
      h('div', { style: { marginTop: '10px' } }, h('span', { class: 'small muted' }, 'Farbe'), colorSwatches(c.color, (v) => { c.color = v; }))),
    actions: [
      { label: 'Abbrechen' },
      !isNew ? {
        label: c.archived ? 'Reaktivieren' : 'Archivieren',
        onClick: () => { store.patch('categories', c.id, { archived: !c.archived }, 'Kategorie archiviert'); rerender(); },
      } : null,
      {
        label: 'Speichern', variant: 'primary',
        onClick: () => { store.upsert('categories', c, isNew ? 'Kategorie angelegt' : 'Kategorie geändert'); rerender(); },
      },
    ].filter(Boolean),
  });
}

function editGroup(group, rerender) {
  const isNew = !group;
  const g = group ? { ...group } : { id: uid('grp'), name: '', icon: '📁', color: 'var(--series-1)', sort: store.idx.groups.length, updatedAt: now() };
  const nameI = h('input', { type: 'text', value: g.name, onInput: (e) => { g.name = e.target.value; } });
  const iconI = h('input', { type: 'text', value: g.icon || '', maxlength: 3, onInput: (e) => { g.icon = e.target.value; } });
  modal({
    title: isNew ? 'Neue Gruppe' : 'Gruppe bearbeiten',
    body: h('div', {},
      h('div', { class: 'form-grid' },
        h('label', { class: 'field' }, h('span', {}, 'Name'), nameI),
        h('label', { class: 'field' }, h('span', {}, 'Symbol'), iconI)),
      h('div', { style: { marginTop: '10px' } }, h('span', { class: 'small muted' }, 'Farbe'), colorSwatches(g.color, (v) => { g.color = v; }))),
    actions: [
      { label: 'Abbrechen' },
      { label: 'Speichern', variant: 'primary', onClick: () => { store.upsert('categoryGroups', g, 'Gruppe gespeichert'); rerender(); } },
    ],
  });
}

/* ---------------- Regeln ---------------- */

function rulesTab(rerender) {
  const root = h('div', {});
  const card = h('section', { class: 'card' });
  const rules = sortBy(store.idx.rules, (r) => r.sort ?? 500);
  const own = rules.filter((r) => !r.system);
  const sys = rules.filter((r) => r.system);

  card.append(h('div', { class: 'card-head' },
    h('h3', { class: 'grow' }, 'Zuordnungsregeln'),
    h('button', {
      class: 'btn sm', onClick: () => {
        const updates = applyRulesTo(store.idx.transactions, store.idx.rules, { onlyUncategorized: true });
        store.upsertMany('transactions', updates, 'Regeln angewendet');
        toast(`${updates.length} Buchungen aktualisiert`, 'success');
      },
    }, '⚡ Auf alle anwenden'),
    h('button', { class: 'btn sm primary', onClick: () => editRule(null, rerender) }, '+ Regel')));

  card.append(h('p', { class: 'small muted' },
    'Regeln laufen beim Import und auf Knopfdruck. Die Regel mit der kleinsten Priorität gewinnt. Eigene Regeln stehen vor den mitgelieferten.'));

  if (!own.length) card.append(h('p', { class: 'small muted' }, 'Noch keine eigenen Regeln. Aus einer Buchung heraus geht das am schnellsten.'));
  for (const r of own) card.append(ruleRow(r, rerender));

  const det = h('details', { class: 'acc' }, h('summary', {}, `Mitgelieferte Regeln (${sys.length})`));
  for (const r of sys) det.append(ruleRow(r, rerender));
  card.append(det);
  root.append(card);
  return root;
}

function ruleRow(r, rerender) {
  const cond = (r.conditions || []).map((c) =>
    `${RULE_FIELDS.find((f) => f.id === c.field)?.label || c.field} ${RULE_OPS.find((o) => o.id === c.op)?.label || c.op} „${c.value}“`).join(r.match === 'any' ? ' ODER ' : ' UND ');
  return h('div', { class: 'list-row' },
    h('input', {
      type: 'checkbox', checked: r.enabled !== false,
      onChange: (e) => store.patch('rules', r.id, { enabled: e.target.checked }, 'Regel geändert'),
    }),
    h('div', { class: 'grow truncate' },
      h('div', { class: 'title truncate' }, r.name || cond),
      h('div', { class: 'txn-sub truncate' }, `${cond} → ${store.category(r.actions?.categoryId)?.name || '–'}`)),
    h('span', { class: 'badge' }, `Prio ${r.sort ?? 500}`),
    h('button', { class: 'btn ghost sm', onClick: () => editRule(r, rerender) }, 'Bearbeiten'));
}

function editRule(rule, rerender) {
  const isNew = !rule;
  const r = rule ? { ...rule, conditions: [...rule.conditions], actions: { ...rule.actions } } : newRule();
  const body = h('div', {});
  const condBox = h('div', {});

  function refreshConds() {
    condBox.replaceChildren();
    r.conditions.forEach((c, i) => {
      const fieldI = h('select', { onChange: (e) => { c.field = e.target.value; } },
        RULE_FIELDS.map((f) => h('option', { value: f.id, selected: f.id === c.field }, f.label)));
      const opI = h('select', { onChange: (e) => { c.op = e.target.value; } },
        RULE_OPS.map((o) => h('option', { value: o.id, selected: o.id === c.op }, o.label)));
      const valI = h('input', { type: 'text', value: c.value, onInput: (e) => { c.value = e.target.value; } });
      condBox.append(h('div', { class: 'row', style: { marginBottom: '6px' } }, fieldI, opI, valI,
        h('button', {
          class: 'btn ghost sm', onClick: () => { r.conditions.splice(i, 1); refreshConds(); },
          disabled: r.conditions.length < 2,
        }, '✕')));
    });
  }
  refreshConds();

  const matchI = h('select', { onChange: (e) => { r.match = e.target.value; } },
    h('option', { value: 'all', selected: r.match === 'all' }, 'Alle Bedingungen müssen zutreffen'),
    h('option', { value: 'any', selected: r.match === 'any' }, 'Eine Bedingung genügt'));
  const nameI = h('input', { type: 'text', value: r.name, onInput: (e) => { r.name = e.target.value; } });
  const catI = categorySelect({ value: r.actions.categoryId, onChange: (v) => { r.actions.categoryId = v; } });
  const ownI = memberSelect({ value: r.actions.ownerId, onChange: (v) => { r.actions.ownerId = v; } });
  const renameI = h('input', { type: 'text', value: r.actions.payeeRename || '', placeholder: 'Empfänger umbenennen (optional)', onInput: (e) => { r.actions.payeeRename = e.target.value || null; } });
  const prioI = h('input', { type: 'number', value: r.sort ?? 100, onInput: (e) => { r.sort = Number(e.target.value); } });
  const transferI = h('input', { type: 'checkbox', checked: !!r.actions.isTransfer, onChange: (e) => { r.actions.isTransfer = e.target.checked; } });

  body.append(
    h('label', { class: 'field' }, h('span', {}, 'Name'), nameI),
    h('h3', { style: { marginTop: '14px' } }, 'Bedingungen'),
    matchI, condBox,
    h('button', { class: 'btn sm', onClick: () => { r.conditions.push({ field: 'payee', op: 'contains', value: '' }); refreshConds(); } }, '+ Bedingung'),
    h('h3', { style: { marginTop: '16px' } }, 'Aktionen'),
    h('div', { class: 'form-grid' },
      h('label', { class: 'field' }, h('span', {}, 'Kategorie'), catI),
      h('label', { class: 'field' }, h('span', {}, 'Person'), ownI),
      h('label', { class: 'field' }, h('span', {}, 'Empfänger ersetzen'), renameI),
      h('label', { class: 'field' }, h('span', {}, 'Priorität'), prioI),
      h('label', { class: 'row tight' }, transferI, h('span', {}, 'Als Übertrag markieren'))));

  modal({
    title: isNew ? 'Neue Regel' : 'Regel bearbeiten', body, wide: true,
    actions: [
      { label: 'Abbrechen' },
      !isNew ? {
        label: 'Löschen', variant: 'danger',
        onClick: async () => {
          if (!await confirmDialog('Regel löschen?')) return false;
          store.remove('rules', r.id, 'Regel gelöscht'); rerender();
        },
      } : null,
      {
        label: 'Speichern & anwenden', variant: 'primary',
        onClick: () => {
          store.upsert('rules', r, isNew ? 'Regel angelegt' : 'Regel geändert');
          const updates = applyRulesTo(store.idx.transactions, [r], { onlyUncategorized: true, skipManual: true });
          if (updates.length) store.upsertMany('transactions', updates, 'Regel angewendet');
          toast(`Regel gespeichert – ${updates.length} Buchungen zugeordnet`, 'success');
          rerender();
        },
      },
    ].filter(Boolean),
  });
}

/* ---------------- Währungen ---------------- */

function currencyTab(rerender) {
  const card = h('section', { class: 'card' });
  card.append(h('div', { class: 'card-head' },
    h('h3', { class: 'grow' }, 'Wechselkurse'),
    h('button', {
      class: 'btn sm', onClick: async () => {
        try { const r = await fetchRates(); toast(`${r.updated} Kurse aktualisiert (${r.date})`, 'success'); rerender(); }
        catch (e) { toast(`Kurse konnten nicht geladen werden: ${e.message}`, 'error'); }
      },
    }, '⟳ Kurse aktualisieren')));

  card.append(h('p', { class: 'small muted' },
    'Alle Beträge werden zur Auswertung in die Basiswährung umgerechnet. Kartenbuchungen in Fremdwährung behalten zusätzlich den Originalbetrag. Quelle: EZB-Referenzkurse (frankfurter.app).'));

  const table = h('table', { class: 'data' },
    h('thead', {}, h('tr', {}, h('th', {}, 'Währung'), h('th', { class: 'num' }, 'Kurs in CHF'), h('th', {}, 'Stand'), h('th', {}, ''))));
  const tbody = h('tbody', {});
  for (const cur of currenciesInUse()) {
    if (cur === 'CHF') continue;
    const rate = rateToBase(cur);
    const latest = sortBy(store.idx.fxRates.filter((r) => r.quote === cur), (r) => r.date, -1)[0];
    const input = h('input', {
      type: 'number', step: '0.0001', value: fmtNumber(rate, 4).replace(/[’']/g, ''),
      style: { maxWidth: '120px', textAlign: 'right' },
      onChange: (e) => { setRate(cur, Number(e.target.value)); toast(`Kurs ${cur} gespeichert`); rerender(); },
    });
    tbody.append(h('tr', {},
      h('td', {}, `1 ${cur} =`),
      h('td', { class: 'num' }, input),
      h('td', { class: 'small muted' }, latest ? fmtDate(latest.date) : 'Startwert'),
      h('td', { class: 'small muted' }, latest ? '' : 'bitte prüfen')));
  }
  table.append(tbody);
  card.append(h('div', { class: 'table-wrap' }, table));

  const auto = h('label', { class: 'row tight', style: { marginTop: '12px' } },
    h('input', {
      type: 'checkbox', checked: store.settings.fxAutoUpdate !== false,
      onChange: (e) => store.setSettings({ fxAutoUpdate: e.target.checked }),
    }),
    h('span', {}, 'Kurse automatisch einmal täglich aktualisieren'));
  card.append(auto);
  return card;
}

/* ---------------- Kurse ---------------- */

function quotesTab(rerender) {
  const card = h('section', { class: 'card' });
  card.append(h('div', { class: 'card-head' }, h('h3', { class: 'grow' }, 'Kursabruf für Wertschriften')));
  card.append(h('p', { class: 'small muted' },
    'Für tagesaktuelle Kurse braucht die App einen Gratis-Schlüssel bei einem Kursanbieter. '
    + 'Der Schlüssel bleibt auf diesem Gerät und wird nicht über OneDrive geteilt – Lea trägt auf '
    + 'ihrem Gerät denselben oder einen eigenen ein. Ohne Schlüssel funktioniert alles weiter, '
    + 'die Kurse werden dann von Hand gepflegt.'));

  const provSel = h('select', { onChange: (e) => { setProvider(e.target.value); rerender(); } },
    Object.values(PROVIDERS).map((p) => h('option', { value: p.id, selected: p.id === getProvider() }, p.label)));
  const keyI = h('input', { type: 'text', value: getKey(), placeholder: 'Schlüssel einfügen' });
  const provider = PROVIDERS[getProvider()];

  card.append(h('div', { class: 'form-grid' },
    h('label', { class: 'field' }, h('span', {}, 'Anbieter'), provSel,
      h('span', { class: 'small muted' }, provider.hint)),
    h('label', { class: 'field' }, h('span', {}, 'API-Schlüssel'), keyI,
      h('span', { class: 'small muted' },
        'Kostenlos erhältlich unter ', h('a', { href: provider.signup, target: '_blank', rel: 'noopener' }, provider.signup)))));

  const result = h('div', { class: 'small', style: { marginTop: '10px' } });
  card.append(h('div', { class: 'row', style: { marginTop: '12px' } },
    h('button', {
      class: 'btn primary', onClick: async () => {
        setKey(keyI.value);
        result.textContent = 'Wird geprüft …';
        try {
          const r = await testConnection('AAPL');
          result.innerHTML = '';
          result.append(h('span', { class: 'badge good' }, `${r.provider} antwortet: AAPL ${r.price} USD`));
        } catch (e) {
          result.innerHTML = '';
          result.append(h('span', { class: 'badge crit' }, e.message));
        }
      },
    }, 'Speichern und prüfen'),
    h('button', { class: 'btn ghost', onClick: () => { setKey(''); keyI.value = ''; rerender(); } }, 'Schlüssel entfernen')));
  card.append(result);

  const info = h('section', { class: 'card' });
  info.append(h('div', { class: 'card-head' }, h('h3', { class: 'grow' }, 'Kürzel für Schweizer Titel')));
  info.append(h('p', { class: 'small muted' },
    'US-Titel funktionieren mit dem normalen Kürzel (VT, SCHD, AMZN). Für Titel an der SIX verlangt '
    + 'Twelve Data den Börsenzusatz, zum Beispiel ', h('span', { class: 'kbd' }, 'NESN:SIX'), ', ',
    h('span', { class: 'kbd' }, 'UHR:SIX'), ' oder ', h('span', { class: 'kbd' }, 'CHSPI:SIX'),
    '. Das Kürzel lässt sich in jeder Position anpassen.'));
  return h('div', {}, card, info);
}

/* ---------------- Daten ---------------- */

function dataTab(rerender) {
  const s = store.stats;
  const card = h('section', { class: 'card' });
  card.append(h('div', { class: 'card-head' }, h('h3', { class: 'grow' }, 'Datenbestand')));
  card.append(h('div', { class: 'stat-row' },
    statTile({ label: 'Buchungen', value: String(s.transactions) }),
    statTile({ label: 'Konten', value: String(s.accounts) }),
    statTile({ label: 'Kategorien', value: String(s.categories) }),
    statTile({ label: 'Regeln', value: String(s.rules) }),
    statTile({ label: 'Sparziele', value: String(s.goals) })));

  card.append(h('div', { class: 'row', style: { marginTop: '16px' } },
    h('button', {
      class: 'btn', onClick: () => {
        const blob = new Blob([store.exportJSON()], { type: 'application/json' });
        const a = document.createElement('a');
        a.href = URL.createObjectURL(blob);
        a.download = `haushaltch_sicherung_${todayISO()}.json`;
        a.click();
      },
    }, '⤓ Vollsicherung (JSON)'),
    h('button', {
      class: 'btn ghost danger', onClick: async () => {
        if (!await confirmDialog('Wirklich alle lokalen Daten löschen? Falls OneDrive verbunden ist, bleibt die Datei dort erhalten und wird beim nächsten Start wieder geladen.', { confirmLabel: 'Alles löschen' })) return;
        store.replaceDoc(newDoc(), 'reset');
        await store.persist();
        toast('Zurückgesetzt', 'success');
        rerender();
      },
    }, 'Alle Daten zurücksetzen')));

  const info = h('section', { class: 'card' });
  info.append(h('div', { class: 'card-head' }, h('h3', { class: 'grow' }, 'Über die App')));
  info.append(h('p', { class: 'small muted' },
    'HaushaltCH läuft vollständig in deinem Browser bzw. als installierte App. Es gibt keine Serverkomponente und keine Bankanbindung – Daten kommen über Excel-/CSV-Import herein und liegen in deinem OneDrive. Offline funktioniert alles weiter; Änderungen werden synchronisiert, sobald wieder Verbindung besteht.'));
  info.append(h('p', { class: 'small muted' }, `Gerätekennung: ${store.meta.deviceId}`));
  return h('div', {}, card, info);
}
