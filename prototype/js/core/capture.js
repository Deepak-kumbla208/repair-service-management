// Capture helpers used by forms: voice input (Web Speech API), signature pad, photo picking.
import { toast } from './ui.js';
import { saveBlob, shrinkImage } from './media.js';

const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
export const voiceSupported = !!SR;

// Every <button data-mic="fieldName"> appends what is said to that field.
export function bindMics(root) {
  root.querySelectorAll('[data-mic]').forEach(btn => {
    btn.addEventListener('click', () => {
      if (!SR) { toast('Voice input works in Chrome or Edge, opened from the local server.', 'bad'); return; }
      const target = root.querySelector(`[name="${btn.dataset.mic}"]`);
      const rec = new SR();
      rec.lang = 'en-SG';
      rec.interimResults = false;
      rec.onresult = e => {
        const said = [...e.results].map(r => r[0].transcript).join(' ').trim();
        target.value = target.value ? `${target.value.trimEnd()} ${said}` : said;
        target.dispatchEvent(new Event('input', { bubbles: true }));
      };
      rec.onerror = e => toast(e.error === 'not-allowed' ? 'Allow the microphone to use voice input.' : `Voice input stopped (${e.error}).`, 'bad');
      rec.onend = () => btn.classList.remove('live');
      btn.classList.add('live');
      rec.start();
    });
  });
}

// Signature pad on a <canvas>; returns helpers to clear it and save the drawing.
export function signaturePad(canvas) {
  const ctx = canvas.getContext('2d');
  const ratio = window.devicePixelRatio || 1;
  canvas.width = canvas.clientWidth * ratio;
  canvas.height = canvas.clientHeight * ratio;
  ctx.scale(ratio, ratio);
  ctx.lineWidth = 2.2;
  ctx.lineCap = 'round';
  ctx.strokeStyle = '#042C53';
  let drawing = false, empty = true;
  const pos = e => { const r = canvas.getBoundingClientRect(); return [e.clientX - r.left, e.clientY - r.top]; };
  canvas.addEventListener('pointerdown', e => { drawing = true; canvas.setPointerCapture(e.pointerId); ctx.beginPath(); ctx.moveTo(...pos(e)); });
  canvas.addEventListener('pointermove', e => { if (!drawing) return; ctx.lineTo(...pos(e)); ctx.stroke(); empty = false; });
  ['pointerup', 'pointercancel', 'pointerleave'].forEach(t => canvas.addEventListener(t, () => { drawing = false; }));
  return {
    isEmpty: () => empty,
    clear: () => { ctx.clearRect(0, 0, canvas.width, canvas.height); empty = true; },
    save: () => new Promise(resolve => canvas.toBlob(async b => resolve(await saveBlob(b, { name: 'signature.png', kind: 'signature' })), 'image/png')),
  };
}

// Shrink and store the chosen photos; returns their media ids.
export async function savePhotos(fileList) {
  const ids = [];
  for (const f of fileList) {
    try {
      const small = await shrinkImage(f);
      ids.push((await saveBlob(small, { name: f.name, kind: 'photo' })).id);
    } catch {
      toast(`${f.name} is not a photo`, 'bad');
    }
  }
  return ids;
}
