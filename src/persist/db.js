// IndexedDB persistence for worlds. Every call returns a promise that rejects with a readable error,
// so the UI can report storage problems instead of crashing.
const DB_NAME = 'after-you-leave';
const DB_VERSION = 1;
let dbPromise = null;

function req(r) {
  return new Promise((resolve, reject) => {
    r.onsuccess = () => resolve(r.result);
    r.onerror = () => reject(new Error(r.error?.message || 'storage request failed'));
  });
}

export function openDb() {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve, reject) => {
    if (typeof indexedDB === 'undefined') { reject(new Error('This browser has no IndexedDB storage.')); return; }
    let r;
    try { r = indexedDB.open(DB_NAME, DB_VERSION); } catch (e) { reject(new Error('Storage is blocked: ' + e.message)); return; }
    r.onupgradeneeded = () => {
      const db = r.result;
      if (!db.objectStoreNames.contains('worlds')) db.createObjectStore('worlds', { keyPath: 'id' });
      if (!db.objectStoreNames.contains('meta')) db.createObjectStore('meta');
    };
    r.onsuccess = () => resolve(r.result);
    r.onerror = () => reject(new Error('Could not open storage: ' + (r.error?.message || 'unknown error')));
    r.onblocked = () => reject(new Error('Storage is blocked by another open tab of this game. Close it and reload.'));
  }).catch((e) => { dbPromise = null; throw e; });
  return dbPromise;
}

async function store(name, mode) {
  const db = await openDb();
  return db.transaction(name, mode).objectStore(name);
}

export async function listWorlds() {
  const s = await store('worlds', 'readonly');
  const all = await req(s.getAll());
  return all.map((S) => ({ id: S.id, name: S.name, seedText: S.seedText || String(S.seed), savedAt: S.savedAt, createdAt: S.createdAt, time: S.time, species: countSpecies(S) }))
    .sort((a, b) => (b.savedAt || 0) - (a.savedAt || 0));
}

function countSpecies(S) {
  const c = {};
  for (const p of S.plants || []) c[p.sp] = (c[p.sp] || 0) + 1;
  for (const a of S.animals || []) c[a.sp] = (c[a.sp] || 0) + 1;
  return Object.keys(c).length;
}

export async function loadWorld(id) {
  const s = await store('worlds', 'readonly');
  return (await req(s.get(id))) || null;
}

export async function saveWorld(S) {
  const s = await store('worlds', 'readwrite');
  await req(s.put(S));
}

export async function deleteWorld(id) {
  const s = await store('worlds', 'readwrite');
  await req(s.delete(id));
}

export async function getMeta(key) {
  const s = await store('meta', 'readonly');
  return (await req(s.get(key))) ?? null;
}

export async function setMeta(key, value) {
  const s = await store('meta', 'readwrite');
  await req(s.put(value, key));
}
