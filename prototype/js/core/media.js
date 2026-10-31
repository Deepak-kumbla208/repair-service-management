// Photos, signatures and attached files in IndexedDB (localStorage only holds about 5 MB).
// Photos are shrunk before saving. Each file keeps its company (tenantId).
import { uid, currentTenant } from './store.js';

const DB_NAME = 'rsm-media';
const STORE = 'files';
let dbPromise = null;

function db() {
  if (!dbPromise) {
    dbPromise = new Promise((resolve, reject) => {
      const req = indexedDB.open(DB_NAME, 1);
      req.onupgradeneeded = () => req.result.createObjectStore(STORE, { keyPath: 'id' });
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
  }
  return dbPromise;
}

function tx(mode, fn) {
  return db().then(d => new Promise((resolve, reject) => {
    const t = d.transaction(STORE, mode);
    const out = fn(t.objectStore(STORE));
    t.oncomplete = () => resolve(out?.result ?? out);
    t.onerror = () => reject(t.error);
  }));
}

export async function saveBlob(blob, meta = {}) {
  const rec = { id: uid('med_'), tenantId: currentTenant(), blob, name: meta.name || 'file', type: blob.type, size: blob.size, kind: meta.kind || 'file', at: new Date().toISOString() };
  await tx('readwrite', s => s.put(rec));
  return { id: rec.id, name: rec.name, type: rec.type, size: rec.size, kind: rec.kind };
}

export async function getBlob(id) {
  const rec = await tx('readonly', s => s.get(id));
  return rec && rec.tenantId === currentTenant() ? rec : null;
}

const urls = new Map();
export async function getUrl(id) {
  if (urls.has(id)) return urls.get(id);
  const rec = await getBlob(id);
  if (!rec) return '';
  const u = URL.createObjectURL(rec.blob);
  urls.set(id, u);
  return u;
}

export async function removeBlob(id) {
  await tx('readwrite', s => s.delete(id));
  if (urls.has(id)) { URL.revokeObjectURL(urls.get(id)); urls.delete(id); }
}

export async function clearAllMedia() {
  await tx('readwrite', s => s.clear());
  urls.forEach(u => URL.revokeObjectURL(u));
  urls.clear();
}

// Shrink a photo to at most maxSide pixels on its longest side, saved as JPEG.
export function shrinkImage(file, maxSide = 1280, quality = 0.72) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    const src = URL.createObjectURL(file);
    img.onload = () => {
      const scale = Math.min(1, maxSide / Math.max(img.width, img.height));
      const c = document.createElement('canvas');
      c.width = Math.round(img.width * scale);
      c.height = Math.round(img.height * scale);
      c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
      URL.revokeObjectURL(src);
      c.toBlob(b => (b ? resolve(b) : reject(new Error('Could not shrink photo'))), 'image/jpeg', quality);
    };
    img.onerror = () => { URL.revokeObjectURL(src); reject(new Error('Not an image')); };
    img.src = src;
  });
}

// Fill every <img data-media="id"> inside root with its stored file.
export async function hydrateImages(root) {
  for (const img of root.querySelectorAll('img[data-media]')) {
    const u = await getUrl(img.dataset.media);
    if (u) img.src = u;
  }
}

export const fmtSize = b => (b > 1048576 ? `${(b / 1048576).toFixed(1)} MB` : `${Math.max(1, Math.round(b / 1024))} KB`);
