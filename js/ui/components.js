// components.js — wiederverwendbare Bausteine der Oberfläche
import { h, el, fmtMoney, fmtDate, monthLabel, currentMonthKey, addMonths, escapeHtml } from '../core/util.js';
import { store } from '../core/store.js';

/* ---------------- Hinweise ---------------- */

export function toast(message, type = 'info', { action, timeout = 4200 } = {}) {
  let host = el('#toasts');
  if (!host) { host = h('div', { id: 'toasts' }); document.body.append(host); }
  const node = h('div', { class: `toast ${type}` }, h('span', { class: 'grow' }, message));
  if (action) node.append(h('button', { onClick: () => { action.onClick(); node.remove(); } }, action.label));
  host.append(node);
  if (timeout) setTimeout(() => node.remove(), timeout);
  return node;
}

/* ---------------- Dialoge ---------------- */

export function modal({ title, body, actions = [], wide = false, onClose } = {}) {
  const dlg = h('dialog', { class: 'modal' + (wide ? ' wide' : '') });
  const content = h('div', { class: 'modal-body' });
  if (body) content.append(body);
  const foot = h('div', { class: 'modal-foot' });
  for (const a of actions) {
    foot.append(h('button', {
      class: `btn ${a.variant || ''}`,
      onClick: async () => {
        const res = a.onClick ? await a.onClick(dlg) : true;
        if (res !== false && a.close !== false) dlg.close();
      },
    }, a.label));
  }
  dlg.append(
    h('div', { class: 'modal-head' },
      h('h2', { class: 'grow' }, title || ''),
      h('button', { class: 'btn ghost sm', onClick: () => dlg.close(), 'aria-label': 'Schliessen' }, '✕')),
    content,
    actions.length ? foot : null,
  );
  dlg.addEventListener('close', () => { onClose?.(); dlg.remove(); });
  document.body.append(dlg);
  dlg.showModal();
  return dlg;
}

export function confirmDialog(message, { title = 'Bestätigen', confirmLabel = 'Ja, ausführen', danger = true } = {}) {
  return new Promise((resolve) => {
    let done = false;
    const dlg = modal({
      title,
      body: h('p', {}, message),
      actions: [
        { label: 'Abbrechen', onClick: () => { done = true; resolve(false); } },
        { label: confirmLabel, variant: danger ? 'danger' : 'primary', onClick: () => { done = true; resolve(true); } },
      ],
      onClose: () => { if (!done) resolve(false); },
    });
    return dlg;
  });
}

export function formModal({ title, fields, submitLabel = 'Speichern', onSubmit, wide = false }) {
  const values = {};
  const body = h('div', { class: 'form-grid' });
  const inputs = {};
  for (const f of fields) {
    if (f.type === 'section') { body.append(h('h3', { style: { gridColumn: '1 / -1', marginTop: '8px' } }, f.label)); continue; }
    const input = fieldInput(f, (v) => { values[f.name] = v; });
    inputs[f.name] = input;
    values[f.name] = f.value ?? '';
    const wrap = h('label', { class: 'field', style: f.full ? { gridColumn: '1 / -1' } : {} },
      h('span', {}, f.label), input, f.hint ? h('span', { class: 'small muted' }, f.hint) : null);
    body.append(wrap);
  }
  const dlg = modal({
    title, body, wide,
    actions: [
      { label: 'Abbrechen' },
      {
        label: submitLabel, variant: 'primary',
        onClick: () => onSubmit(values, inputs),
      },
    ],
  });
  return dlg;
}

function fieldInput(f, onChange) {
  if (f.type === 'select') {
    const sel = h('select', { onChange: (e) => onChange(e.target.value) });
    for (const o of f.options) sel.append(h('option', { value: o.value, selected: String(o.value) === String(f.value) }, o.label));
    sel.value = f.value ?? '';
    return sel;
  }
  if (f.type === 'textarea') {
    return h('textarea', { rows: f.rows || 3, onInput: (e) => onChange(e.target.value) }, f.value ?? '');
  }
  if (f.type === 'checkbox') {
    const inp = h('input', { type: 'checkbox', checked: !!f.value, onChange: (e) => onChange(e.target.checked) });
    return inp;
  }
  const inp = h('input', {
    type: f.type || 'text', value: f.value ?? '', step: f.step, min: f.min, max: f.max, placeholder: f.placeholder,
    onInput: (e) => onChange(f.type === 'number' ? Number(e.target.value) : e.target.value),
  });
  return inp;
}

/* ---------------- Auswahlfelder ---------------- */

export function categorySelect({ value, onChange, includeEmpty = true, id } = {}) {
  const sel = h('select', { id, onChange: (e) => onChange?.(e.target.value || null) });
  if (includeEmpty) sel.append(h('option', { value: '' }, '— keine Kategorie —'));
  for (const g of store.idx.groups.slice().sort((a, b) => (a.sort ?? 0) - (b.sort ?? 0))) {
    const og = h('optgroup', { label: `${g.icon || ''} ${g.name}`.trim() });
    for (const c of store.categoriesOfGroup(g.id)) {
      og.append(h('option', { value: c.id, selected: c.id === value }, `${c.icon || ''} ${c.name}`.trim()));
    }
    if (og.children.length) sel.append(og);
  }
  sel.value = value || '';
  return sel;
}

export function accountSelect({ value, onChange, includeEmpty = false, emptyLabel = 'Alle Konten' } = {}) {
  const sel = h('select', { onChange: (e) => onChange?.(e.target.value || null) });
  if (includeEmpty) sel.append(h('option', { value: '' }, emptyLabel));
  for (const a of store.idx.accounts.filter((x) => !x.archived)) {
    sel.append(h('option', { value: a.id, selected: a.id === value }, `${a.name} (${a.currency})`));
  }
  sel.value = value || '';
  return sel;
}

export function memberSelect({ value, onChange, includeEmpty = true, emptyLabel = '— keine Person —' } = {}) {
  const sel = h('select', { onChange: (e) => onChange?.(e.target.value || null) });
  if (includeEmpty) sel.append(h('option', { value: '' }, emptyLabel));
  for (const m of store.idx.members) sel.append(h('option', { value: m.id, selected: m.id === value }, m.name));
  sel.value = value || '';
  return sel;
}

export function monthPicker(period, onChange) {
  const label = h('button', { class: 'btn ghost', style: { minWidth: '150px', justifyContent: 'center' } }, monthLabel(period));
  const wrap = h('div', { class: 'row tight' },
    h('button', { class: 'btn ghost sm', onClick: () => onChange(addMonths(period, -1)), 'aria-label': 'Vorheriger Monat' }, '‹'),
    label,
    h('button', { class: 'btn ghost sm', onClick: () => onChange(addMonths(period, 1)), 'aria-label': 'Nächster Monat' }, '›'),
    period !== currentMonthKey()
      ? h('button', { class: 'btn ghost sm', onClick: () => onChange(currentMonthKey()) }, 'Heute')
      : null,
  );
  label.addEventListener('click', () => {
    const inp = h('input', { type: 'month', value: period });
    modal({
      title: 'Monat wählen',
      body: h('label', { class: 'field' }, h('span', {}, 'Monat'), inp),
      actions: [{ label: 'Abbrechen' }, { label: 'Übernehmen', variant: 'primary', onClick: () => onChange(inp.value) }],
    });
  });
  return wrap;
}

export function segmented(options, value, onChange) {
  const box = h('div', { class: 'segmented' });
  for (const o of options) {
    box.append(h('button', { class: value === o.value ? 'active' : '', onClick: () => onChange(o.value) }, o.label));
  }
  return box;
}

/* ---------------- Anzeige-Bausteine ---------------- */

export function statTile({ label, value, sub, tone, hero = false }) {
  return h('div', { class: 'stat' },
    h('span', { class: 'label' }, label),
    h('span', { class: `value${hero ? ' hero' : ''}${tone ? ' ' + tone : ''}` }, value),
    sub ? h('span', { class: 'delta muted' }, sub) : null);
}

export function emptyState(icon, title, text, action) {
  return h('div', { class: 'empty' },
    h('div', { class: 'big' }, icon),
    h('div', { style: { fontWeight: '600', color: 'var(--ink)' } }, title),
    text ? h('p', { class: 'small' }, text) : null,
    action ? h('button', { class: 'btn primary', onClick: action.onClick }, action.label) : null);
}

export function categoryChip(categoryId) {
  const c = store.category(categoryId);
  if (!c) return h('span', { class: 'muted small' }, 'Nicht zugeordnet');
  const g = store.group(c.groupId);
  return h('span', { class: 'nowrap' },
    h('i', { class: 'cat-dot', style: { background: c.color || g?.color || 'var(--ink-muted)' } }),
    `${c.name}`);
}

export function money(amount, currency = null, opts = {}) {
  const cur = currency || store.baseCurrency;
  const cls = amount > 0 ? 'pos' : amount < 0 ? '' : 'muted';
  return h('span', { class: `mono ${opts.colored === false ? '' : cls}` }, fmtMoney(amount, cur, opts));
}

/** Hinweisbalken für Fälle, in denen die App sonst still falsch rechnen würde. */
export function warningCard(title, text, action = null) {
  return h('section', { class: 'card', style: { borderLeft: '3px solid var(--warning)' } },
    h('div', { class: 'row' },
      h('div', { class: 'grow' },
        h('div', { style: { fontWeight: '600' } }, title),
        h('div', { class: 'small muted' }, text)),
      action ? h('button', { class: 'btn', onClick: action.onClick }, action.label) : null));
}

export function sectionTitle(title, right) {
  return h('div', { class: 'card-head' }, h('h2', { class: 'grow' }, title), right);
}

export function tableFrom(columns, rows, { onRowClick, rowClass } = {}) {
  const thead = h('thead', {}, h('tr', {}, columns.map((c) => h('th', { class: c.num ? 'num' : '', style: c.width ? { width: c.width } : {} }, c.label))));
  const tbody = h('tbody', {});
  for (const r of rows) {
    const tr = h('tr', { class: rowClass ? rowClass(r) : '' },
      columns.map((c) => h('td', { class: c.num ? 'num' : '' }, c.render ? c.render(r) : r[c.key])));
    if (onRowClick) { tr.style.cursor = 'pointer'; tr.addEventListener('click', (e) => onRowClick(r, e)); }
    tbody.append(tr);
  }
  return h('div', { class: 'table-wrap' }, h('table', { class: 'data' }, thead, tbody));
}

export function colorSwatches(value, onChange) {
  const box = h('div', { class: 'pill-row' });
  const options = [1, 2, 3, 4, 5, 6, 7, 8].map((n) => `var(--series-${n})`).concat(['var(--ink-muted)']);
  for (const c of options) {
    box.append(h('button', {
      class: 'chip' + (c === value ? ' active' : ''), type: 'button',
      onClick: () => { onChange(c); Array.from(box.children).forEach((x) => x.classList.remove('active')); },
    }, h('i', { style: { background: c } }), ''));
  }
  return box;
}
