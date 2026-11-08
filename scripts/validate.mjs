// Üretilen out/rail-tr.json + out/meta.json doğrulaması. Başarısız olursa çıkış kodu 1 (yayın yapılmaz, önceki veri canlı kalır).
//   node scripts/validate.mjs [önceki-meta.json]
// Uygulamanın stillerinin (src/map/mapHtml.ts) beklediği biçim burada KİLİTLENİR; stil değişirse hem burası hem schemaVersion güncellenir.
import { readFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { createHash } from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SUPPORTED_SCHEMA = 1;
// Türkiye sınır kutusu (uygulamadaki config.ts TURKEY_BOUNDS ile aynı)
const BBOX = { south: 35.6, west: 25.5, north: 42.3, east: 45.0 };
const WAY_CLASSES = new Set(['hs', 'main', 'branch', 'ind', 'inds', 'oth', 'siding', 'yard', 'cross', 'spur', 'nar', 'nars', 'tram', 'sub', 'lr', 'con', 'prop', 'dis', 'aba', 'raz', 'pre']);
const NODE_CLASSES = new Set(['st', 'ht', 'yd', 'ts']);
const KEYS = new Set(['h', 'm', 'b', 'i', 'l', 'u', 't']);
const ALLOWED_PROPS = new Set(['c', 'k', 's', 'd', 't', 'b', 'u', 'n', 'm']);
const MIN_BYTES = 2e6, MAX_BYTES = 15e6;
// Önceki yayına göre en az bu oran korunmalı (ana kategoriler ve toplam)
const KEEP_RATIO = 0.8;
const MAJOR = ['hs', 'main', 'branch', 'tram', 'sub', 'st'];
// Önceki yayın yoksa mutlak taban değerler (2026-11 verisinin yaklaşık yarısı)
const FLOORS = { features: 12000, hs: 1000, main: 3000, branch: 100, tram: 500, sub: 800, st: 600 };

const errors = [];
const fail = (m) => errors.push(m);

const body = await readFile(path.join(ROOT, 'out', 'rail-tr.json'));
const meta = JSON.parse(await readFile(path.join(ROOT, 'out', 'meta.json'), 'utf8'));

// boyut + sha + meta
if (body.length < MIN_BYTES || body.length > MAX_BYTES) fail(`boyut aralık dışı: ${body.length}`);
if (meta.bytes !== body.length) fail('meta.bytes uyuşmuyor');
if (meta.sha256 !== createHash('sha256').update(body).digest('hex')) fail('meta.sha256 uyuşmuyor');
if (meta.schemaVersion !== SUPPORTED_SCHEMA) fail(`schemaVersion ${meta.schemaVersion} != ${SUPPORTED_SCHEMA}`);
if (!meta.osm_base || Number.isNaN(Date.parse(meta.osm_base))) fail('osm_base geçersiz');
if (!meta.attribution || !/OpenStreetMap/.test(meta.attribution)) fail('attribution eksik');

// GeoJSON
let gj;
try { gj = JSON.parse(body.toString('utf8')); } catch (e) { fail('JSON ayrıştırılamadı: ' + e.message); }
const counts = {};
if (gj) {
  if (gj.type !== 'FeatureCollection' || !Array.isArray(gj.features)) fail('FeatureCollection değil');
  else {
    let bad = 0;
    const note = (m) => { if (bad++ < 10) fail(m); };
    for (const [i, f] of gj.features.entries()) {
      const p = f?.properties, g = f?.geometry;
      if (f?.type !== 'Feature' || !p || !g) { note(`#${i}: Feature yapısı bozuk`); continue; }
      for (const k of Object.keys(p)) if (!ALLOWED_PROPS.has(k)) note(`#${i}: bilinmeyen özellik ${k}`);
      const isNode = NODE_CLASSES.has(p.c);
      if (!isNode && !WAY_CLASSES.has(p.c)) { note(`#${i}: bilinmeyen sınıf ${p.c}`); continue; }
      counts[p.c] = (counts[p.c] || 0) + 1;
      if (p.k !== undefined && !KEYS.has(p.k)) note(`#${i}: bilinmeyen renk anahtarı ${p.k}`);
      for (const k of ['s', 'd']) if (p[k] !== undefined && !(Number.isInteger(p[k]) && p[k] > 0 && p[k] < 1000)) note(`#${i}: ${k} sayı değil`);
      for (const k of ['t', 'b', 'u', 'm']) if (p[k] !== undefined && p[k] !== 1) note(`#${i}: ${k} !== 1`);
      if (isNode) {
        if (typeof p.n !== 'string' || !p.n) note(`#${i}: istasyonda ad yok`);
        if (g.type !== 'Point') note(`#${i}: nokta bekleniyordu`);
      } else if (g.type !== 'LineString' || !Array.isArray(g.coordinates) || g.coordinates.length < 2) note(`#${i}: LineString bekleniyordu`);
      const cs = g.type === 'Point' ? [g.coordinates] : g.coordinates;
      for (const c of cs || []) {
        if (!Array.isArray(c) || typeof c[0] !== 'number' || typeof c[1] !== 'number') { note(`#${i}: koordinat sayı değil`); break; }
        if (c[0] < BBOX.west || c[0] > BBOX.east || c[1] < BBOX.south || c[1] > BBOX.north) { note(`#${i}: koordinat Türkiye kutusu dışında ${c}`); break; }
      }
    }
    if (bad > 10) fail(`... toplam ${bad} sorun`);
    if (gj.features.length !== meta.features) fail('meta.features uyuşmuyor');
  }
}

// aralık: önceki yayına göre ya da mutlak taban
const prevPath = process.argv[2];
let prev = null;
if (prevPath && existsSync(prevPath)) { try { prev = JSON.parse(await readFile(prevPath, 'utf8')); } catch { prev = null; } }
const total = gj?.features?.length ?? 0;
if (prev && prev.schemaVersion === meta.schemaVersion && prev.counts) {
  if (total < prev.features * KEEP_RATIO) fail(`toplam ${total} < önceki ${prev.features} x ${KEEP_RATIO}`);
  for (const k of MAJOR) {
    const was = prev.counts[k] || 0;
    if (was && (counts[k] || 0) < was * KEEP_RATIO) fail(`${k}: ${counts[k] || 0} < önceki ${was} x ${KEEP_RATIO}`);
  }
} else {
  if (total < FLOORS.features) fail(`toplam ${total} < taban ${FLOORS.features}`);
  for (const k of MAJOR) if ((counts[k] || 0) < FLOORS[k]) fail(`${k}: ${counts[k] || 0} < taban ${FLOORS[k]}`);
}

if (errors.length) {
  console.error('DOĞRULAMA BAŞARISIZ:\n - ' + errors.join('\n - '));
  process.exit(1);
}
console.log(`Doğrulama tamam: ${total} öğe, ${(body.length / 1e6).toFixed(2)} MB, sha256 ${meta.sha256.slice(0, 12)}…${prev ? ' (önceki yayınla karşılaştırıldı)' : ' (ilk yayın: mutlak tabanlar)'}`);
