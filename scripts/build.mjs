// Türkiye demiryolu verisi üreticisi (TR Demiryolu uygulaması için).  Tek doğruluk kaynağı bu betiktir.
//   node scripts/build.mjs  ->  out/rail-tr.json (GeoJSON FeatureCollection) + out/meta.json
//
// SADECE Türkiye: Overpass sorguları area["ISO3166-1"="TR"][admin_level=2] ile sınırlıdır; dünya verisi indirilmez/işlenmez.
// Geometri: 5 ondalık yuvarlama + Douglas-Peucker (~1.3 m). Özellikler kısadır (tam liste: README.md):
//   Stil anahtarları (DEĞİŞMEZ): c sınıf, k renk anahtarı, s azami hız, d yönlü hız, t tünel, b köprü, u usage var, n ad, m metro/hafif raylı istasyonu.
//   Bilgi kartı (schemaVersion 2): r hat no, o işletmeci, e/v/f elektrifikasyon (kod, 4-7 = yaygın birleşimler / volt / Hz), x hat sayısı, g ray açıklığı (mm; 1 = 1435),
//   us/sv ham usage/service (sınıftan çıkarılamıyorsa); yerler (c:'pl'): n ad, p yer türü, q idari seviye (4 il, 6 ilçe merkezi).
//
// schemaVersion: uygulamanın stillerinin dayandığı özellik adları / kategori değerleri değişirse ARTIRIN (ör. yeni 'c' sınıfı,
// bir özelliğin adı ya da anlamı değişimi). Yalnızca veri güncellenirse (yeni OSM verisi) ARTIRMAYIN. Uygulama yalnızca kendi
// desteklediği schemaVersion'ı indirir; bu sayı artınca eski uygulamalar güncellemeyi yok sayar (görünüm bozulmaz).
//
// Veri © OpenStreetMap katkıda bulunanlar, ODbL 1.0 — https://www.openstreetmap.org/copyright

import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { createHash } from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ENDPOINT = 'https://overpass-api.de/api/interpreter';
const USER_AGENT = 'tr-demiryolu-build/1.0 (https://tr-demiryolu.app; Turkey railway map build script)';
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const OUT_DIR = path.join(ROOT, 'out');
export const SCHEMA_VERSION = 2;
const ATTRIBUTION = 'Demiryolu verisi © OpenStreetMap katkıda bulunanlar (ODbL 1.0) — https://www.openstreetmap.org/copyright';
const CACHE_DIR = process.env.RAIL_CACHE_DIR || null;

const AREA = 'area["ISO3166-1"="TR"][admin_level=2]->.tr;';
const HEAD = '[out:json][timeout:300];';

// Not: funicular ve monorail çekilir ama OpenRailwayMap bunları çizmez; çıktıya alınmaz (sayısı metaya yazılır).
const QUERIES = {
  ways_rail: `${HEAD}${AREA}way["railway"="rail"](area.tr);out geom;`,
  ways_other: `${HEAD}${AREA}way["railway"~"^(light_rail|subway|tram|narrow_gauge|construction|proposed|disused|abandoned|preserved|razed|funicular|monorail)$"](area.tr);out geom;`,
  nodes: `${HEAD}${AREA}(node["railway"~"^(station|halt|tram_stop|yard)$"](area.tr);node["public_transport"="station"]["train"="yes"](area.tr);node["public_transport"="station"]["subway"="yes"](area.tr);node["public_transport"="station"]["light_rail"="yes"](area.tr);node["public_transport"="station"]["tram"="yes"](area.tr););out geom;`,
};

// Yerler (arama için): şehir/kasaba düğümleri + il (admin_level=4) ve ilçe (6) idari merkezleri.
// İlişkiler (area.tr) yerine sınır kutusuyla aranır (area ile ilişki sorgusu Overpass'ta 502 veriyordu); merkez düğümler yine yalnızca Türkiye alanında kalır.
const PLACE_QUERIES = {
  places: `${HEAD}${AREA}node["place"~"^(city|town)$"]["name"](area.tr);out;`,
  admin4: `${HEAD}${AREA}rel["boundary"="administrative"]["admin_level"="4"](35.5,25.5,42.5,45.1)->.r;node(r.r:"admin_centre")(area.tr);out;`,
  admin6: `${HEAD}${AREA}rel["boundary"="administrative"]["admin_level"="6"](35.5,25.5,42.5,45.1)->.r;node(r.r:"admin_centre")(area.tr);out;`,
};

async function overpass(name, query) {
  const cacheFile = CACHE_DIR ? path.join(CACHE_DIR, `${name}.json`) : null;
  if (cacheFile && existsSync(cacheFile)) {
    console.log(`[${name}] önbellekten okunuyor`);
    return JSON.parse(await readFile(cacheFile, 'utf8'));
  }
  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      console.log(`[${name}] Overpass isteği (deneme ${attempt})...`);
      const res = await fetch(ENDPOINT, {
        method: 'POST',
        headers: {
          'User-Agent': USER_AGENT,
          Accept: 'application/json',
          'Content-Type': 'application/x-www-form-urlencoded',
        },
        body: 'data=' + encodeURIComponent(query),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const text = await res.text();
      const json = JSON.parse(text);
      if (json.remark && /error|timed out|out of memory/i.test(json.remark)) throw new Error(json.remark);
      console.log(`[${name}] ${json.elements.length} öğe, ${(text.length / 1e6).toFixed(1)} MB`);
      if (cacheFile) {
        await mkdir(CACHE_DIR, { recursive: true });
        await writeFile(cacheFile, text);
      }
      return json;
    } catch (e) {
      console.warn(`[${name}] hata: ${e.message}`);
      if (attempt === 3) throw e; // iki yeniden deneme
      await new Promise((r) => setTimeout(r, 90000));
    }
  }
}

// ---------- sınıflandırma ----------

const NUM = /^[1-9][0-9]*$/;
const MPH = /^([1-9][0-9]*) mph$/;
function speedOf(v) {
  if (v == null) return null;
  v = String(v).trim();
  if (NUM.test(v)) return Number(v);
  const m = MPH.exec(v);
  if (m) return Math.round(Number(m[1]) * 1.609344);
  return null;
}

/** Raylı hat (rail / narrow_gauge) için hat türü. */
function railClass(t, usage, service) {
  if (usage === 'military') return 'oth';
  if (!service) {
    if (usage === 'main') return t.highspeed === 'yes' ? 'hs' : 'main';
    if (usage === 'branch') return 'branch';
    if (usage === 'industrial') return 'ind';
    return 'oth'; // kullanım yok / turizm / test
  }
  if (usage === 'industrial') return 'inds';
  if (!usage && service === 'spur') return 'spur';
  if (service === 'yard') return 'yard';
  if (service === 'crossover') return 'cross';
  return 'siding';
}

/** Renk anahtarı (standart katman): h ana hızlı, m ana, b tali, i sanayi/spur kahverengi; null = siyah. */
function colorKey(rc) {
  switch (rc) {
    case 'hs': return 'h';
    case 'main': return 'm';
    case 'branch': return 'b';
    case 'ind':
    case 'inds':
    case 'spur': return 'i';
    default: return null;
  }
}

const BRIDGES = new Set(['yes', 'cantilever', 'covered', 'movable', 'trestle', 'viaduct']);
const MODE_KEY = { light_rail: 'l', subway: 'u', tram: 't' };

// ---------- bilgi kartı alanları (schemaVersion 2) ----------

const clean = (v, max) => {
  if (v == null) return null;
  const s = String(v).replace(/\s+/g, ' ').trim();
  return s ? s.slice(0, max) : null;
};
const firstInt = (v, re) => {
  if (v == null) return null;
  const m = re.exec(String(v).split(';')[0].trim());
  return m ? Math.round(Number(m[1])) : null;
};
// usage/service anahtarları 'c' ile kodlanmış olanlar yeniden yazılmaz
const USAGE_IN_CLASS = new Set(['main', 'branch', 'industrial']);
const MINOR_CLASSES = new Set(['siding', 'yard', 'cross', 'spur', 'inds']);
const GONE_CLASSES = new Set(['dis', 'aba', 'raz']);
// e kodları 4-7: [elektrifikasyon türü, volt, Hz] — 4 havai 25 kV 50 Hz, 5 havai 750 V DC, 6 üçüncü ray 750 V DC, 7 havai 1500 V DC
const E_PRESETS = [[1, 25000, 50], [1, 750, 0], [2, 750, 0], [1, 1500, 0]];

function addInfo(prop, t, usage, service) {
  const name = clean(t.name || t['name:tr'], 100);
  if (name) prop.n = name;
  const ref = clean(t.ref, 30);
  if (ref) prop.r = ref;
  // BOYUT BÜTÇESİ: yan hatlarda (siding/yard/cross/spur/inds) işletmeci ve teknik alanlar yazılmaz; kullanılmayan hatlarda
  // (dis/aba/raz) teknik alanlar yazılmaz (bilgi kartında en az işe yarayan alanlar).
  const minor = MINOR_CLASSES.has(prop.c);
  const technical = !minor && !GONE_CLASSES.has(prop.c);
  const op = clean(t.operator, 60);
  if (op && !minor) prop.o = op;
  // elektrifikasyon: e 0 yok, 1 havai hat (contact_line / yes), 2 üçüncü ray (rail / 4th_rail), 3 diğer; v volt, f Hz (yalnız elektrikli hatlarda).
  // Yaygın birleşimler tek kodla yazılır (e 4-7, bkz. E_PRESETS) ve v/f yazılmaz.
  const el = technical && (t.electrified || t['construction:electrified'] || t['proposed:electrified']);
  if (el) {
    const first = String(el).split(';')[0].trim();
    const e = first === 'no' ? 0 : first === 'contact_line' || first === 'yes' ? 1 : first === 'rail' || first === '4th_rail' ? 2 : 3;
    let v, f;
    if (e !== 0) {
      v = firstInt(t.voltage, /^(\d{2,6})/);
      if (!(v && v >= 12 && v <= 100000)) v = undefined;
      f = firstInt(t.frequency, /^(\d{1,3})(?:\.\d+)?$/);
      if (!(f != null && f >= 0 && f <= 400)) f = undefined;
    }
    const preset = E_PRESETS.findIndex(([pe, pv, pf]) => pe === e && pv === v && pf === f);
    if (preset >= 0) prop.e = 4 + preset;
    else {
      prop.e = e;
      if (v !== undefined) prop.v = v;
      if (f !== undefined) prop.f = f;
    }
  }
  const tr = technical ? firstInt(t.tracks, /^(\d{1,2})$/) : null;
  if (tr && tr >= 1 && tr <= 16) prop.x = tr;
  // ray açıklığı: 1435 (normal hat, ~%99) 1 koduyla yazılır; diğer değerler mm
  const g = technical ? firstInt(t.gauge, /^(\d{3,4})$/) : null;
  if (g && g >= 100 && g <= 3000) prop.g = g === 1435 ? 1 : g;
  // ham usage/service: yalnızca sınıf (c, inşaat/önerilen hatlarda k) bunu zaten söylemiyorsa:
  // main/branch/industrial c ile kodlu; askeri, turistik, test, yük vb. yazılır
  const slug = (v) => { const s = clean(v, 20); return s && /^[a-z_]+$/.test(s) ? s : null; };
  const us = slug(usage);
  if (us && !USAGE_IN_CLASS.has(us)) prop.us = us;
  const sv = slug(service);
  if (sv && !['siding', 'yard', 'crossover', 'spur'].includes(sv)) prop.sv = sv;
}

function classifyWay(t) {
  const rw = t.railway;
  const prop = {};
  let usage = t.usage;
  let service = t.service;
  if (rw === 'construction') {
    usage = usage || t['construction:usage'];
    service = service || t['construction:service'];
  } else if (rw === 'proposed') {
    usage = usage || t['proposed:usage'];
    service = service || t['proposed:service'];
  }

  if (rw === 'rail') {
    prop.c = railClass(t, usage, service);
    const k = colorKey(prop.c);
    if (!['hs', 'main', 'branch', 'ind'].includes(prop.c) && usage) prop.u = 1;
    void k;
  } else if (rw === 'narrow_gauge') {
    const rc = railClass(t, usage, service);
    prop.c = service && usage !== 'military' ? 'nars' : 'nar';
    const k = colorKey(rc);
    if (k) prop.k = k;
    if (usage) prop.u = 1;
  } else if (rw === 'light_rail') {
    prop.c = 'lr'; if (usage) prop.u = 1;
  } else if (rw === 'subway') {
    prop.c = 'sub'; if (usage) prop.u = 1;
  } else if (rw === 'tram') {
    prop.c = 'tram'; if (usage) prop.u = 1;
  } else if (rw === 'construction' || rw === 'proposed') {
    prop.c = rw === 'construction' ? 'con' : 'prop';
    const fut = rw === 'construction' ? (t['construction:railway'] || t.construction) : (t['proposed:railway'] || t.proposed);
    if (fut === 'platform') return null; // ORM çizmez
    let k;
    if (MODE_KEY[fut]) k = MODE_KEY[fut];
    else {
      const rc = railClass(t, usage, service);
      k = colorKey(rc);
    }
    if (k) prop.k = k;
    if (usage) prop.u = 1;
  } else if (rw === 'disused') prop.c = 'dis';
  else if (rw === 'abandoned') prop.c = 'aba';
  else if (rw === 'razed') prop.c = 'raz';
  else if (rw === 'preserved') prop.c = 'pre';
  else return null;

  if (t.tunnel === 'yes') prop.t = 1;
  if (BRIDGES.has(t.bridge)) prop.b = 1;
  addInfo(prop, t, usage, service);

  // Hız (hız limitleri katmanı)
  const plain = speedOf(t.maxspeed);
  if (plain != null) prop.s = plain;
  const f = speedOf(t['maxspeed:forward']);
  const b = speedOf(t['maxspeed:backward']);
  const pd = t['railway:preferred_direction'];
  let dir = null;
  if ((pd === 'forward' && f) || (pd === 'backward' && !b && f) || (!pd && f)) dir = f;
  if ((pd === 'backward' && b) || (pd === 'forward' && !f && b) || (!pd && !f && b)) dir = b;
  if (dir != null) prop.d = dir;
  return prop;
}

function classifyNode(t) {
  const rw = t.railway;
  const name = t.name || t['name:tr'];
  if (!name) return null;
  const prop = { n: name };
  if (rw === 'station' || (!rw && t.public_transport === 'station')) {
    prop.c = 'st';
    const st = t.station;
    const isTrain = rw === 'station' ? st !== 'light_rail' && st !== 'subway' : t.train === 'yes';
    if (!isTrain) prop.m = 1; // metro / hafif raylı / tramvay istasyonu: italik, ince
  } else if (rw === 'halt') prop.c = 'ht';
  else if (rw === 'yard') prop.c = 'yd';
  else if (rw === 'tram_stop') prop.c = 'ts';
  else return null;
  const op = clean(t.operator, 60);
  if (op) prop.o = op;
  return prop;
}

// yerler: p yer türü (c şehir, t kasaba, v köy, o diğer), q idari seviye (4 il merkezi, 6 ilçe merkezi)
const PLACE_CODE = { city: 'c', town: 't', village: 'v' };
function classifyPlace(t, level) {
  const name = clean(t['name:tr'] || t.name, 80);
  if (!name) return null;
  const prop = { c: 'pl', n: name, p: PLACE_CODE[t.place] || 'o' };
  if (level) prop.q = level;
  return prop;
}

// ---------- geometri ----------

function r5(v) {
  return Math.round(v * 1e5) / 1e5;
}

function lineCoords(geom) {
  const out = [];
  for (const p of geom) {
    if (!p) continue; // kapsama dışı düğüm
    const x = r5(p.lon);
    const y = r5(p.lat);
    const last = out[out.length - 1];
    if (last && last[0] === x && last[1] === y) continue;
    out.push([x, y]);
  }
  return out;
}

// Douglas-Peucker (derece cinsinden tolerans; 1e-5 ≈ 1.1 m). Uç noktalar korunur; kapalı halkalar da bozulmaz.
const SIMPLIFY_TOLERANCE = 1.2e-5;
function simplify(pts, tol) {
  if (pts.length <= 2) return pts;
  const keep = new Uint8Array(pts.length);
  keep[0] = keep[pts.length - 1] = 1;
  const stack = [[0, pts.length - 1]];
  const t2 = tol * tol;
  while (stack.length) {
    const [a, b] = stack.pop();
    let maxD = 0, idx = -1;
    const [ax, ay] = pts[a], [bx, by] = pts[b];
    const dx = bx - ax, dy = by - ay;
    const len2 = dx * dx + dy * dy;
    for (let i = a + 1; i < b; i++) {
      const [px, py] = pts[i];
      let d2;
      if (len2 === 0) d2 = (px - ax) ** 2 + (py - ay) ** 2;
      else {
        let u = ((px - ax) * dx + (py - ay) * dy) / len2;
        u = Math.max(0, Math.min(1, u));
        d2 = (px - (ax + u * dx)) ** 2 + (py - (ay + u * dy)) ** 2;
      }
      if (d2 > maxD) { maxD = d2; idx = i; }
    }
    if (maxD > t2) { keep[idx] = 1; stack.push([a, idx], [idx, b]); }
  }
  return pts.filter((_, i) => keep[i]);
}

async function main() {
  const t0 = Date.now();
  const rail = await overpass('ways_rail', QUERIES.ways_rail);
  const other = await overpass('ways_other', QUERIES.ways_other);
  const nodes = await overpass('nodes', QUERIES.nodes);
  const placesRaw = await overpass('places', PLACE_QUERIES.places);
  const admin4 = await overpass('admin4', PLACE_QUERIES.admin4);
  const admin6 = await overpass('admin6', PLACE_QUERIES.admin6);

  const osmBase = rail.osm3s?.timestamp_osm_base ?? null;
  const osmBases = [rail, other, nodes].map((r) => r.osm3s?.timestamp_osm_base).filter(Boolean).sort();

  const features = [];
  const seen = new Set();
  const counts = {};
  const skipped = { funicular: 0, monorail: 0, tooShort: 0, duplicate: 0, unrendered: 0 };
  const bump = (k) => (counts[k] = (counts[k] || 0) + 1);

  const byId = (a, b) => a.id - b.id; // belirlenimli çıktı: aynı OSM verisi => aynı sha256
  for (const el of [...rail.elements, ...other.elements].sort(byId)) {
    if (el.type !== 'way' || !el.geometry) continue;
    const t = el.tags || {};
    if (t.railway === 'funicular' || t.railway === 'monorail') {
      skipped[t.railway]++;
      continue;
    }
    const props = classifyWay(t);
    if (!props) { skipped.unrendered++; continue; }
    const coords = simplify(lineCoords(el.geometry), SIMPLIFY_TOLERANCE);
    if (coords.length < 2) { skipped.tooShort++; continue; }
    const key = JSON.stringify(props) + '|' + JSON.stringify(coords);
    const rkey = JSON.stringify(props) + '|' + JSON.stringify([...coords].reverse());
    if (seen.has(key) || seen.has(rkey)) { skipped.duplicate++; continue; }
    seen.add(key);
    features.push({ type: 'Feature', properties: props, geometry: { type: 'LineString', coordinates: coords } });
    bump(props.c);
  }

  const nodeSeen = new Set();
  for (const el of [...nodes.elements].sort(byId)) {
    if (el.type !== 'node' || el.lat == null) continue;
    const props = classifyNode(el.tags || {});
    if (!props) continue;
    const x = r5(el.lon), y = r5(el.lat);
    const key = props.c + '|' + props.n + '|' + x + '|' + y;
    if (nodeSeen.has(key)) continue;
    nodeSeen.add(key);
    features.push({ type: 'Feature', properties: props, geometry: { type: 'Point', coordinates: [x, y] } });
    bump(props.c);
  }

  // yerler: kimlik başına birleştir (bir düğüm hem kasaba hem ilçe merkezi olabilir); en yüksek idari seviye (küçük sayı) kazanır
  const placeById = new Map();
  const addPlaces = (res, level) => {
    for (const el of res.elements) {
      if (el.type !== 'node' || el.lat == null) continue;
      const prev = placeById.get(el.id);
      const pl = prev ? prev.level : 0;
      placeById.set(el.id, { el: prev ? prev.el : el, level: level && pl ? Math.min(level, pl) : level || pl });
    }
  };
  addPlaces(placesRaw, 0);
  addPlaces(admin6, 6);
  addPlaces(admin4, 4);
  const placeSeen = new Set();
  for (const { el, level } of [...placeById.values()].sort((a, b) => a.el.id - b.el.id)) {
    const props = classifyPlace(el.tags || {}, level);
    if (!props) continue;
    const x = r5(el.lon), y = r5(el.lat);
    const key = props.n + '|' + x + '|' + y;
    if (placeSeen.has(key)) continue;
    placeSeen.add(key);
    features.push({ type: 'Feature', properties: props, geometry: { type: 'Point', coordinates: [x, y] } });
    bump('pl');
  }

  const fc = { type: 'FeatureCollection', features };
  const body = JSON.stringify(fc);
  await mkdir(OUT_DIR, { recursive: true });
  await writeFile(path.join(OUT_DIR, 'rail-tr.json'), body);

  const meta = {
    schemaVersion: SCHEMA_VERSION,
    osm_base: osmBase,
    generatedAt: new Date().toISOString(),
    sha256: createHash('sha256').update(body).digest('hex'),
    bytes: Buffer.byteLength(body),
    features: features.length,
    counts,
    attribution: ATTRIBUTION,
    license: 'ODbL 1.0',
  };
  await writeFile(path.join(OUT_DIR, 'meta.json'), JSON.stringify(meta, null, 2) + '\n');
  console.log(JSON.stringify(meta, null, 2));
  console.log(`Bitti: ${((Date.now() - t0) / 1000).toFixed(0)} sn, ${(meta.bytes / 1e6).toFixed(2)} MB`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
