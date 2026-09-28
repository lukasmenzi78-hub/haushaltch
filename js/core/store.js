// store.js — Zustand, Offline-Persistenz (IndexedDB) und Änderungs-Events
import { newDoc, migrate, COLLECTIONS, docStats } from './model.js';
import { now, clone, uid } from './util.js';

const DB_NAME = 'swissfin';
const DB_VERSION = 1;
const STORE = 'kv';
const DOC_KEY = 'doc';
const META_KEY = 'meta';

let dbPromise = null;
function openDB() {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE)) db.createObjectStore(STORE);
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
  return dbPromise;
}

async function idbGet(key) {
  const db = await openDB();
  return new Promise((res, rej) => {
    const tx = db.transaction(STORE, 'readonly');
    const r = tx.objectStore(STORE).get(key);
    r.onsuccess = () => res(r.result);
    r.onerror = () => rej(r.error);
  });
}

async function idbSet(key, value) {
  const db = await openDB();
  return new Promise((res, rej) => {
    const tx = db.transaction(STORE, 'readwrite');
    tx.objectStore(STORE).put(value, key);
    tx.oncomplete = () => res();
    tx.onerror = () => rej(tx.error);
  });
}

/* ---------------- Store ---------------- */

class Store extends EventTarget {
  constructor() {
    super();
    this.doc = newDoc();
    this.meta = {
      deviceId: null,
      dirty: false,
      lastLocalSave: null,
      lastSyncAt: null,
      remote: null,        // { driveId, itemId, name, path, eTag, source }
      lastRemoteHash: null,
    };
    this._indexes = null;
    this._undo = [];
    this._redo = [];
    this._saveTimer = null;
    this.ready = false;
  }

  /* ----- Laden / Speichern ----- */

  async init() {
    const storedMeta = (await idbGet(META_KEY)) || {};
    this.meta = { ...this.meta, ...storedMeta };
    if (!this.meta.deviceId) {
      this.meta.deviceId = uid('dev');
      await idbSet(META_KEY, this.meta);
    }
    const storedDoc = await idbGet(DOC_KEY);
    this.doc = storedDoc ? migrate(storedDoc) : newDoc();
    this.ready = true;
    this._invalidate();
    this.emit('ready');
    this.emit('change', { reason: 'init' });
    return this.doc;
  }

  async persist() {
    clearTimeout(this._saveTimer);
    this.meta.lastLocalSave = now();
    await idbSet(DOC_KEY, this.doc);
    await idbSet(META_KEY, this.meta);
  }

  schedulePersist() {
    clearTimeout(this._saveTimer);
    this._saveTimer = setTimeout(() => this.persist().catch(console.error), 400);
  }

  async saveMeta(patch = {}) {
    Object.assign(this.meta, patch);
    await idbSet(META_KEY, this.meta);
    this.emit('meta');
  }

  /* ----- Events ----- */

  emit(name, detail = {}) { this.dispatchEvent(new CustomEvent(name, { detail })); }
  on(name, fn) { this.addEventListener(name, fn); return () => this.removeEventListener(name, fn); }

  /* ----- Mutationen ----- */

  /** Führt eine Mutation aus, markiert das Dokument als geändert und
   *  legt einen Undo-Punkt für die berührten Sammlungen an. */
  mutate(label, collections, fn) {
    const affected = Array.isArray(collections) ? collections : [collections];
    const snapshot = {};
    for (const c of affected) snapshot[c] = clone(this.doc[c] ?? null);
    if (affected.includes('settings')) snapshot.settings = clone(this.doc.settings);
    const result = fn(this.doc);
    this._undo.push({ label, snapshot, at: now() });
    if (this._undo.length > 12) this._undo.shift();
    this._redo.length = 0;
    this.markDirty(label);
    return result;
  }

  markDirty(reason = '') {
    this.meta.dirty = true;
    this._invalidate();
    this.schedulePersist();
    this.emit('change', { reason });
  }

  canUndo() { return this._undo.length > 0; }
  undoLabel() { return this._undo.length ? this._undo[this._undo.length - 1].label : null; }

  /** Stellt einen Stand wieder her und stempelt nur das, was sich wirklich ändert.
   *  Ohne neuen Zeitstempel würde der Sync das Rückgängigmachen sofort überschreiben,
   *  weil der Stand auf dem anderen Gerät „neuer“ aussieht. */
  _restore(snapshot) {
    const t = now();
    for (const [coll, value] of Object.entries(snapshot)) {
      if (coll === 'settings') {
        this.doc.settings = { ...value, updatedAt: t };
        continue;
      }
      const currentById = new Map((this.doc[coll] || []).map((r) => [r.id, r]));
      this.doc[coll] = value.map((r) => {
        const cur = currentById.get(r.id);
        const unchanged = cur && JSON.stringify({ ...cur, updatedAt: 0 }) === JSON.stringify({ ...r, updatedAt: 0 });
        return unchanged ? cur : { ...r, updatedAt: t };
      });
      // Datensätze, die es vor dem Wiederherstellen gab und danach nicht mehr,
      // werden als gelöscht markiert statt still zu verschwinden
      const restoredIds = new Set(this.doc[coll].map((r) => r.id));
      for (const [id, rec] of currentById) {
        if (!restoredIds.has(id)) this.doc[coll].push({ ...rec, deleted: true, updatedAt: t });
      }
    }
  }

  undo() {
    const entry = this._undo.pop();
    if (!entry) return false;
    const redoSnap = {};
    for (const c of Object.keys(entry.snapshot)) redoSnap[c] = clone(this.doc[c] ?? null);
    this._redo.push({ label: entry.label, snapshot: redoSnap, at: now() });
    this._restore(entry.snapshot);
    this.markDirty('undo');
    return entry.label;
  }

  redo() {
    const entry = this._redo.pop();
    if (!entry) return false;
    const undoSnap = {};
    for (const c of Object.keys(entry.snapshot)) undoSnap[c] = clone(this.doc[c] ?? null);
    this._undo.push({ label: entry.label, snapshot: undoSnap, at: now() });
    this._restore(entry.snapshot);
    this.markDirty('redo');
    return entry.label;
  }

  /* ----- CRUD-Helfer ----- */

  upsert(coll, record, label = 'Änderung') {
    return this.mutate(label, coll, (doc) => {
      const arr = doc[coll];
      const i = arr.findIndex((r) => r.id === record.id);
      const rec = { ...record, updatedAt: now() };
      if (i >= 0) arr[i] = rec; else arr.push(rec);
      return rec;
    });
  }

  upsertMany(coll, records, label = 'Änderung') {
    return this.mutate(label, coll, (doc) => {
      const arr = doc[coll];
      const idx = new Map(arr.map((r, i) => [r.id, i]));
      const t = now();
      for (const record of records) {
        const rec = { ...record, updatedAt: t };
        const i = idx.get(rec.id);
        if (i !== undefined) arr[i] = rec;
        else { idx.set(rec.id, arr.length); arr.push(rec); }
      }
      return records.length;
    });
  }

  patch(coll, id, patch, label = 'Änderung') {
    return this.mutate(label, coll, (doc) => {
      const arr = doc[coll];
      const i = arr.findIndex((r) => r.id === id);
      if (i < 0) return null;
      arr[i] = { ...arr[i], ...patch, updatedAt: now() };
      return arr[i];
    });
  }

  patchMany(coll, ids, patch, label = 'Änderung') {
    const set = new Set(ids);
    return this.mutate(label, coll, (doc) => {
      let n = 0;
      const t = now();
      doc[coll] = doc[coll].map((r) => (set.has(r.id) ? (n++, { ...r, ...patch, updatedAt: t }) : r));
      return n;
    });
  }

  /** Löschen = Tombstone, damit gelöschte Datensätze nicht per Sync zurückkehren. */
  remove(coll, id, label = 'Löschen') {
    return this.patch(coll, id, { deleted: true }, label);
  }

  removeMany(coll, ids, label = 'Löschen') {
    return this.patchMany(coll, ids, { deleted: true }, label);
  }

  hardRemove(coll, id, label = 'Entfernen') {
    return this.mutate(label, coll, (doc) => {
      doc[coll] = doc[coll].filter((r) => r.id !== id);
    });
  }

  setSettings(patch, label = 'Einstellung') {
    return this.mutate(label, 'settings', (doc) => {
      doc.settings = { ...doc.settings, ...patch, updatedAt: now() };
      return doc.settings;
    });
  }

  replaceDoc(doc, reason = 'replace') {
    this.doc = migrate(doc);
    this._undo.length = 0; this._redo.length = 0;
    this._invalidate();
    this.schedulePersist();
    this.emit('change', { reason });
  }

  /* ----- Abfragen / Indizes ----- */

  _invalidate() { this._indexes = null; }

  get idx() {
    if (this._indexes) return this._indexes;
    const d = this.doc;
    const live = (coll) => d[coll].filter((r) => !r.deleted);
    const map = (arr) => new Map(arr.map((r) => [r.id, r]));
    const accounts = live('accounts');
    const categories = live('categories');
    const groups = live('categoryGroups');
    const transactions = live('transactions');
    this._indexes = {
      accounts, accountById: map(accounts),
      categories, categoryById: map(categories),
      groups, groupById: map(groups),
      transactions,
      txnByAccount: transactions.reduce((m, t) => {
        if (!m.has(t.accountId)) m.set(t.accountId, []);
        m.get(t.accountId).push(t); return m;
      }, new Map()),
      goals: live('goals'), assets: live('assets'), rules: live('rules'),
      budgets: live('budgets'), reports: live('reports'), widgets: live('widgets'),
      fxRates: live('fxRates'), imports: live('imports'),
      recurring: live('recurring'),
      holdings: live('holdings').filter((x) => !x.archived),
      allHoldings: live('holdings'),
      dividends: live('dividends'),
      snapshots: live('snapshots').sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0)),
      members: d.settings.members || [],
      memberById: map(d.settings.members || []),
      dedupKeys: new Set(transactions.map((t) => t.dedupKey).filter(Boolean)),
    };
    return this._indexes;
  }

  get settings() { return this.doc.settings; }
  get baseCurrency() { return this.doc.settings.baseCurrency || 'CHF'; }
  get stats() { return docStats(this.doc); }

  account(id) { return this.idx.accountById.get(id) || null; }
  holding(id) { return this.idx.holdings.find((h) => h.id === id) || null; }
  category(id) { return this.idx.categoryById.get(id) || null; }
  group(id) { return this.idx.groupById.get(id) || null; }
  member(id) { return this.idx.memberById.get(id) || null; }

  categoriesOfGroup(groupId) {
    return this.idx.categories.filter((c) => c.groupId === groupId && !c.archived)
      .sort((a, b) => (a.sort ?? 999) - (b.sort ?? 999));
  }

  /** Alle Buchungen, optional gefiltert. */
  txns({ includeHidden = false } = {}) {
    return this.idx.transactions.filter((t) => includeHidden || !t.hidden);
  }

  exportJSON() {
    return JSON.stringify({ ...this.doc, exportedAt: new Date().toISOString(), app: 'HaushaltCH' }, null, 2);
  }
}

export const store = new Store();
export { COLLECTIONS };
