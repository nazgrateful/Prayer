// Stores user-chosen audio files (e.g. a favourite adhan recording) in
// IndexedDB so they work offline. Kept separate from the settings in
// localStorage, which are small and JSON-only.

const DB = 'prayer-media';
const STORE = 'files';

function open() {
  return new Promise((resolve, reject) => {
    if (typeof indexedDB === 'undefined') return reject(new Error('Storage unavailable'));
    const req = indexedDB.open(DB, 1);
    req.onupgradeneeded = () => req.result.createObjectStore(STORE);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function tx(mode, fn) {
  const db = await open();
  return new Promise((resolve, reject) => {
    const t = db.transaction(STORE, mode);
    const req = fn(t.objectStore(STORE));
    t.oncomplete = () => resolve(req?.result);
    t.onerror = () => reject(t.error);
  });
}

/** Save a File/Blob under `key` together with its original name. */
export function putFile(key, file) {
  return tx('readwrite', (s) => s.put({ blob: file, name: file.name || 'audio', type: file.type, size: file.size, saved: Date.now() }, key));
}

/** { blob, name, type, size } or undefined. */
export async function getFile(key) {
  try {
    return await tx('readonly', (s) => s.get(key));
  } catch {
    return undefined;
  }
}

export function deleteFile(key) {
  return tx('readwrite', (s) => s.delete(key));
}
