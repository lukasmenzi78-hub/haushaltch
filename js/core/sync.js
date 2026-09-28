// sync.js — OneDrive-Synchronisation über Microsoft Graph (MSAL, PKCE, ohne Server)
import { store } from './store.js';
import { mergeDocs, migrate } from './model.js';
import { debounce, now } from './util.js';

const LS_CLIENT_ID = 'swissfin.clientId';
const LS_PATH = 'swissfin.filePath';
const LS_AUTHORITY = 'swissfin.authority';
const SCOPES = ['User.Read', 'Files.ReadWrite', 'Files.ReadWrite.All'];
const GRAPH = 'https://graph.microsoft.com/v1.0';

export const syncState = {
  status: 'aus',          // aus | bereit | angemeldet | synchronisiert | fehler | arbeitet
  message: 'Nicht verbunden',
  account: null,
  lastSync: null,
  error: null,
  busy: false,
};

const listeners = new Set();
export function onSyncChange(fn) { listeners.add(fn); return () => listeners.delete(fn); }
function emit(patch = {}) {
  Object.assign(syncState, patch);
  for (const fn of listeners) { try { fn(syncState); } catch (e) { console.error(e); } }
}

/* ---------------- Konfiguration ---------------- */

export function getClientId() { return localStorage.getItem(LS_CLIENT_ID) || ''; }
export function setClientId(id) { localStorage.setItem(LS_CLIENT_ID, (id || '').trim()); }
export function getFilePath() { return localStorage.getItem(LS_PATH) || 'HaushaltCH/haushalt.json'; }
export function setFilePath(p) { localStorage.setItem(LS_PATH, (p || '').replace(/^\/+/, '')); }
export function getAuthority() { return localStorage.getItem(LS_AUTHORITY) || 'https://login.microsoftonline.com/common'; }
export function setAuthority(a) { localStorage.setItem(LS_AUTHORITY, a); }
export function redirectUri() { return window.location.origin + window.location.pathname; }

/* ---------------- MSAL ---------------- */

let msalApp = null;
let account = null;

export async function initAuth({ silent = true } = {}) {
  const clientId = getClientId();
  if (!clientId) { emit({ status: 'aus', message: 'Keine Client-ID hinterlegt' }); return false; }
  if (typeof msal === 'undefined') { emit({ status: 'fehler', message: 'MSAL-Bibliothek nicht geladen' }); return false; }
  if (!msalApp) {
    msalApp = new msal.PublicClientApplication({
      auth: { clientId, authority: getAuthority(), redirectUri: redirectUri(), navigateToLoginRequestUrl: false },
      cache: { cacheLocation: 'localStorage', storeAuthStateInCookie: false },
    });
    await msalApp.initialize();
    const result = await msalApp.handleRedirectPromise().catch(() => null);
    if (result?.account) account = result.account;
  }
  if (!account) {
    const accounts = msalApp.getAllAccounts();
    if (accounts.length) account = accounts[0];
  }
  if (account) {
    msalApp.setActiveAccount(account);
    emit({ status: 'angemeldet', account: { name: account.name, username: account.username }, message: `Angemeldet als ${account.username}` });
    if (silent) startWatching();
    return true;
  }
  emit({ status: 'bereit', message: 'Bereit zur Anmeldung' });
  return false;
}

export async function signIn() {
  if (!msalApp) { const ok = await initAuth({ silent: false }); if (!ok && !msalApp) throw new Error('Bitte zuerst die Client-ID eintragen.'); }
  try {
    const res = await msalApp.loginPopup({ scopes: SCOPES, prompt: 'select_account' });
    account = res.account;
  } catch (e) {
    if (String(e?.errorCode || '').includes('popup') || String(e).includes('popup')) {
      await msalApp.loginRedirect({ scopes: SCOPES });
      return null;
    }
    throw e;
  }
  msalApp.setActiveAccount(account);
  emit({ status: 'angemeldet', account: { name: account.name, username: account.username }, message: `Angemeldet als ${account.username}` });
  startWatching();
  return account;
}

export async function signOut() {
  stopWatching();
  if (msalApp && account) await msalApp.logoutPopup({ account }).catch(() => {});
  account = null;
  emit({ status: 'bereit', account: null, message: 'Abgemeldet' });
}

async function token() {
  if (!msalApp || !account) throw new Error('Nicht angemeldet.');
  try {
    const res = await msalApp.acquireTokenSilent({ scopes: SCOPES, account });
    return res.accessToken;
  } catch {
    const res = await msalApp.acquireTokenPopup({ scopes: SCOPES, account });
    return res.accessToken;
  }
}

/* ---------------- Graph-Aufrufe ---------------- */

async function graph(path, opts = {}) {
  const t = await token();
  const res = await fetch(path.startsWith('http') ? path : GRAPH + path, {
    ...opts,
    headers: { Authorization: `Bearer ${t}`, ...(opts.headers || {}) },
  });
  if (res.status === 404) return { notFound: true, status: 404 };
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    const err = new Error(`Graph ${res.status}: ${text.slice(0, 300)}`);
    err.status = res.status;
    throw err;
  }
  const ct = res.headers.get('content-type') || '';
  const body = ct.includes('application/json') ? await res.json() : await res.text();
  return { ok: true, status: res.status, body, headers: res.headers };
}

export async function listSharedFiles() {
  const res = await graph('/me/drive/sharedWithMe');
  if (!res.ok) return [];
  return (res.body.value || [])
    .filter((i) => i.file && /\.json$/i.test(i.name))
    .map((i) => ({
      name: i.name,
      driveId: i.remoteItem?.parentReference?.driveId || i.parentReference?.driveId,
      itemId: i.remoteItem?.id || i.id,
      owner: i.remoteItem?.createdBy?.user?.displayName || i.createdBy?.user?.displayName || '',
      modified: i.lastModifiedDateTime,
      shared: true,
    }));
}

export async function listOwnFiles(folder = '') {
  const p = folder ? `/me/drive/root:/${encodeURI(folder)}:/children` : '/me/drive/root/children';
  const res = await graph(p);
  if (!res.ok) return [];
  return (res.body.value || []).map((i) => ({
    name: i.name, isFolder: !!i.folder, driveId: i.parentReference?.driveId, itemId: i.id,
    modified: i.lastModifiedDateTime, size: i.size,
    path: (folder ? folder + '/' : '') + i.name,
  }));
}

function itemUrl(remote, suffix = '') {
  if (remote?.driveId && remote?.itemId) return `/drives/${remote.driveId}/items/${remote.itemId}${suffix}`;
  return `/me/drive/root:/${encodeURI(getFilePath())}:${suffix || ''}`;
}

/** Legt die Datei an, falls sie noch nicht existiert, und merkt sich die Kennung. */
export async function ensureRemoteFile() {
  const remote = store.meta.remote;
  if (remote?.itemId) {
    const meta = await graph(itemUrl(remote));
    if (meta.ok) {
      // eTag immer mitschreiben: ohne ihn würde ein späterer Upload ungeschützt laufen
      if (meta.body.eTag !== remote.eTag) {
        await store.saveMeta({ remote: { ...remote, eTag: meta.body.eTag } });
      }
      return meta.body;
    }
    // Die bekannte Datei ist weg (verschoben, Freigabe entzogen). Auf keinen Fall
    // still eine neue anlegen – sonst arbeiten die Geräte unbemerkt getrennt weiter.
    throw new Error('Die verbundene Datei ist nicht mehr erreichbar. Bitte unter '
      + 'Einstellungen → OneDrive-Sync erneut auswählen.');
  }
  const path = getFilePath();
  const meta = await graph(`/me/drive/root:/${encodeURI(path)}`);
  if (meta.ok) {
    await store.saveMeta({ remote: { driveId: meta.body.parentReference?.driveId, itemId: meta.body.id, name: meta.body.name, path, eTag: meta.body.eTag } });
    return meta.body;
  }
  // Neu anlegen
  const created = await graph(`/me/drive/root:/${encodeURI(path)}:/content`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(store.doc),
  });
  if (!created.ok) throw new Error('Datei konnte nicht angelegt werden.');
  await store.saveMeta({
    remote: { driveId: created.body.parentReference?.driveId, itemId: created.body.id, name: created.body.name, path, eTag: created.body.eTag },
  });
  return created.body;
}

export async function useRemoteFile({ driveId, itemId, name, path, shared }) {
  await store.saveMeta({ remote: { driveId, itemId, name, path: path || name, shared: !!shared, eTag: null } });
  await pull({ force: true });
}

/* ---------------- Pull / Push ---------------- */

export async function pull({ force = false } = {}) {
  if (!account) return { skipped: true };
  emit({ busy: true, status: 'arbeitet', message: 'Lade Daten …' });
  try {
    const item = await ensureRemoteFile();
    const remote = store.meta.remote;
    if (!force && remote.eTag && item.eTag === remote.eTag) {
      emit({ busy: false, status: 'synchronisiert', message: 'Aktuell', lastSync: now() });
      return { unchanged: true };
    }
    const content = await graph(itemUrl(remote, '/content'));
    let incoming = content.body;
    if (typeof incoming === 'string') {
      try { incoming = JSON.parse(incoming); } catch { throw new Error('Datei auf OneDrive ist kein gültiges JSON.'); }
    }
    const { doc, stats } = mergeDocs(store.doc, migrate(incoming));
    store.replaceDoc(doc, 'sync-pull');
    // Erst das Dokument sichern, dann den eTag. Andernfalls gilt ein nie gespeicherter
    // Stand als „schon geholt“ und die Daten des anderen Geräts kämen nie wieder an.
    await store.persist();
    await store.saveMeta({ remote: { ...remote, eTag: item.eTag }, lastSyncAt: now() });
    emit({ busy: false, status: 'synchronisiert', message: 'Aktuell', lastSync: now(), error: null });
    return { merged: stats };
  } catch (e) {
    emit({ busy: false, status: 'fehler', message: e.message, error: e });
    throw e;
  }
}

export async function push({ retries = 3 } = {}) {
  if (!account) return { skipped: true };
  emit({ busy: true, status: 'arbeitet', message: 'Speichere …' });
  try {
    await ensureRemoteFile();
    let remote = store.meta.remote;
    if (!remote.eTag) {
      // Ohne eTag wäre der Upload ungeschützt und könnte den Stand des anderen
      // Geräts vollständig überschreiben. Also zuerst holen und zusammenführen.
      await pull({ force: true });
      remote = store.meta.remote;
      if (!remote.eTag) throw new Error('Kein Dateistand bekannt – Synchronisation abgebrochen.');
    }
    const t = await token();
    const res = await fetch(GRAPH + itemUrl(remote, '/content'), {
      method: 'PUT',
      headers: {
        Authorization: `Bearer ${t}`,
        'Content-Type': 'application/json',
        'if-match': remote.eTag,
      },
      body: JSON.stringify(store.doc),
    });
    if (res.status === 412 || res.status === 409) {
      if (retries <= 0) throw new Error('Konflikt konnte nicht gelöst werden.');
      await pull({ force: true });
      return push({ retries: retries - 1 });
    }
    if (!res.ok) throw new Error(`Speichern fehlgeschlagen (${res.status})`);
    const body = await res.json();
    store.meta.dirty = false;
    await store.saveMeta({ remote: { ...remote, eTag: body.eTag }, lastSyncAt: now() });
    emit({ busy: false, status: 'synchronisiert', message: 'Gespeichert', lastSync: now(), error: null });
    return { ok: true };
  } catch (e) {
    emit({ busy: false, status: 'fehler', message: e.message, error: e });
    throw e;
  }
}

export async function syncNow() {
  await pull();
  if (store.meta.dirty) await push();
}

/* ---------------- Automatik ---------------- */

const autoPush = debounce(() => {
  if (!account) return;
  if (!navigator.onLine) {
    // Offline: beim nächsten „online“ greift syncNow, der Stand bleibt als dirty markiert
    emit({ message: 'Offline – Änderungen werden später hochgeladen' });
    return;
  }
  push().catch((e) => console.warn('Auto-Push:', e.message));
}, 4000);

let watchTimer = null;
let unsubscribeChange = null;

export function startWatching() {
  if (unsubscribeChange) return;
  unsubscribeChange = store.on('change', (e) => {
    if (['sync-pull', 'init', 'replace'].includes(e.detail?.reason)) return;
    autoPush();
  });
  window.addEventListener('online', () => syncNow().catch(() => {}));
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') pull().catch(() => {});
  });
  watchTimer = setInterval(() => {
    if (navigator.onLine && !syncState.busy) syncNow().catch(() => {});
  }, 90000);
  // syncNow statt pull: lokale Änderungen, die beim letzten Schliessen offen blieben,
  // gehen sonst erst beim nächsten Bearbeiten hoch.
  syncNow().catch(() => {});
}

export function stopWatching() {
  if (unsubscribeChange) { unsubscribeChange(); unsubscribeChange = null; }
  clearInterval(watchTimer); watchTimer = null;
}

/** Vor dem Schliessen noch schnell sichern. */
export function flushOnUnload() {
  window.addEventListener('beforeunload', () => {
    store.persist();
    if (account && store.meta.dirty) autoPush.flush();
  });
}
