# tr-demiryolu-data

**TR** — [Türkiye Demiryolu Haritası](https://github.com/kemeryeager/tr-demiryolu) uygulamasının demiryolu verisi. Her hafta OpenStreetMap'ten (Overpass API) **yalnızca Türkiye** için üretilir ve GitHub Pages ile yayınlanır. Uygulama yeni sürüm gerektirmeden bu veriyi kendiliğinden yeniler.

**EN** — Railway data for the "Türkiye Demiryolu Haritası" app. Generated weekly from OpenStreetMap via the Overpass API for **Turkey only** (`area["ISO3166-1"="TR"][admin_level=2]`) and published through GitHub Pages.

## Dosyalar / Files

| URL | İçerik |
|---|---|
| https://kemeryeager.github.io/tr-demiryolu-data/meta.json | `schemaVersion`, `osm_base`, `generatedAt`, `sha256`, `bytes`, sayılar, atıf |
| https://kemeryeager.github.io/tr-demiryolu-data/rail-tr.json | GeoJSON FeatureCollection (hatlar + istasyonlar + arama için yer noktaları) |

`last-check.json` (ana dalda) her çalışmanın zamanını/sonucunu tutar.

## İş akışı / Workflow

`.github/workflows/update.yml`: her Pazartesi 03:00 UTC (ve elle `gh workflow run update.yml`). Adımlar: üret (`scripts/build.mjs`) → doğrula (`scripts/validate.mjs`) → **yalnızca `sha256` değiştiyse** `gh-pages` dalına yayınla. Doğrulama ya da Overpass başarısız olursa yayın yapılmaz, önceki veri canlı kalır.

Doğrulama: geçerli GeoJSON; her özellik bilinen özellik adları, `c` sınıfı değerleri ve tür/aralık denetimli değerlerle; tüm koordinatlar Türkiye kutusunda (35.6–42.3 N, 25.5–45.0 E); toplam ve ana kategoriler önceki yayının en az %80'i; boyut 2–15 MB.

## Veri alanları / Feature properties (schemaVersion 2)

Özellik adları kasıtlı olarak kısadır (dosya boyutu). Her özellik yalnızca değeri varsa yazılır. **Boyut bütçesi:** yan hatlarda (`siding`, `yard`, `cross`, `spur`, `inds`) `o e v f g x` yazılmaz; kullanılmayan hatlarda (`dis`, `aba`, `raz`) `e v f g x` yazılmaz.
Property names are short on purpose (file size); a key is present only when OSM has a value.

**Hat özellikleri** (`LineString`):

| Anahtar | Tür | Anlam | OSM kaynağı |
|---|---|---|---|
| `c` | dizge | Sınıf: `hs` yüksek hızlı, `main` ana, `branch` tali, `ind` sanayi, `inds` sanayi yan hat, `oth` diğer, `siding` yan hat, `yard` manevra, `cross` makas bağlantısı, `spur` branşman, `nar`/`nars` dar hat (/yan), `tram`, `sub` metro, `lr` hafif raylı, `con` inşaat, `prop` önerilen, `dis` kullanım dışı, `aba` terk edilmiş, `raz` sökülmüş, `pre` korunmuş | `railway`, `usage`, `service`, `highspeed` |
| `k` | dizge | Renk anahtarı (inşaat/önerilen/dar hatta hattın olacağı tür): `h` `m` `b` `i` `l` `u` `t` | `usage`, `construction`, `proposed` |
| `s` | tamsayı | Azami hız (km/sa) | `maxspeed` (mph çevrilir) |
| `d` | tamsayı | Yönlü azami hız (km/sa) | `maxspeed:forward/backward` |
| `t` | 1 | Tünel | `tunnel=yes` |
| `b` | 1 | Köprü | `bridge` |
| `u` | 1 | Usage değeri var (stil için) | `usage` |
| `n` | dizge | Ad (≤100) | `name` / `name:tr` |
| `r` | dizge | Hat numarası (≤30) | `ref` |
| `o` | dizge | İşletmeci (≤60) | `operator` |
| `e` | 0–7 | Elektrifikasyon: 0 yok, 1 havai hat (`contact_line`/`yes`), 2 üçüncü ray (`rail`/`4th_rail`), 3 diğer. **Yaygın birleşimler tek kodla** (v/f yazılmaz): 4 = havai 25 kV 50 Hz, 5 = havai 750 V DC, 6 = üçüncü ray 750 V DC, 7 = havai 1500 V DC | `electrified`, `voltage`, `frequency` |
| `v` | tamsayı | Gerilim (volt); yalnızca `e` 1–3 ve birleşim 4–7 kodlarından biri değilse | `voltage` (ilk değer) |
| `f` | tamsayı | Frekans (Hz; 0 = doğru akım); `v` ile aynı koşul | `frequency` (ilk değer) |
| `x` | tamsayı | Hat sayısı (1–16) | `tracks` |
| `g` | tamsayı | Ray açıklığı (mm). **1 = 1435 mm normal hat** (boyut için kodlu) | `gauge` (ilk değer) |
| `us` | dizge | Ham `usage` (yalnızca `c` bunu zaten söylemiyorsa: `military`, `tourism`, `test` …) | `usage` |
| `sv` | dizge | Ham `service` (`siding`/`yard`/`crossover`/`spur` dışındakiler, ör. `driveway`) | `service` |

**İstasyon özellikleri** (`Point`, `c` = `st` istasyon, `ht` durak, `yd` manevra/yük istasyonu, `ts` tramvay durağı): `n` ad (zorunlu), `m` = 1 metro/hafif raylı istasyonu (`st` için), `o` işletmeci.

**Yer noktaları** (`Point`, `c` = `pl`; arama içindir, uygulamada **çizilmez**): `n` ad (`name:tr` öncelikli), `p` yer türü (`c` şehir, `t` kasaba, `v` köy, `o` diğer), `q` = 4 (il merkezi) ya da 6 (ilçe merkezi) (`admin_centre` rolündeki düğüm). Kaynak: `place=city|town` düğümleri + `boundary=administrative` (`admin_level` 4 ve 6) ilişkilerinin `admin_centre` düğümleri.

Stil anahtarları (`c k s d t b u n m`) v1 ile aynı anlamdadır; v2 yalnızca alan ekler ve `pl` sınıfını getirir.

## schemaVersion kuralı / rule

`schemaVersion` (şu an **2**; v1 → v2: bilgi kartı alanları ve `pl` sınıfı eklendi), uygulamanın stillerinin dayandığı özellik adları ya da kategori değerleri (`c`, `k`, `s`, `d`, `t`, `b`, `u`, `n`, `m` ve yukarıdaki bilgi kartı alanları) **değişirse** artırılır; yalnızca OSM verisi değişirse artırılmaz. Uygulama yalnızca kendi desteklediği sürümü indirir.
Bump `schemaVersion` only when the property names/categories the app's styles depend on change.

## Lisans / Licence

Veri © [OpenStreetMap katkıda bulunanlar](https://www.openstreetmap.org/copyright), [ODbL 1.0](https://opendatacommons.org/licenses/odbl/1-0/) altında. Data © OpenStreetMap contributors, ODbL 1.0. Bu depodaki betikler MIT.
