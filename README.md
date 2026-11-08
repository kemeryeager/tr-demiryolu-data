# tr-demiryolu-data

**TR** — [Türkiye Demiryolu Haritası](https://github.com/kemeryeager/tr-demiryolu) uygulamasının demiryolu verisi. Her hafta OpenStreetMap'ten (Overpass API) **yalnızca Türkiye** için üretilir ve GitHub Pages ile yayınlanır. Uygulama yeni sürüm gerektirmeden bu veriyi kendiliğinden yeniler.

**EN** — Railway data for the "Türkiye Demiryolu Haritası" app. Generated weekly from OpenStreetMap via the Overpass API for **Turkey only** (`area["ISO3166-1"="TR"][admin_level=2]`) and published through GitHub Pages.

## Dosyalar / Files

| URL | İçerik |
|---|---|
| https://kemeryeager.github.io/tr-demiryolu-data/meta.json | `schemaVersion`, `osm_base`, `generatedAt`, `sha256`, `bytes`, sayılar, atıf |
| https://kemeryeager.github.io/tr-demiryolu-data/rail-tr.json | GeoJSON FeatureCollection (hatlar + istasyonlar) |

`last-check.json` (ana dalda) her çalışmanın zamanını/sonucunu tutar.

## İş akışı / Workflow

`.github/workflows/update.yml`: her Pazartesi 03:00 UTC (ve elle `gh workflow run update.yml`). Adımlar: üret (`scripts/build.mjs`) → doğrula (`scripts/validate.mjs`) → **yalnızca `sha256` değiştiyse** `gh-pages` dalına yayınla. Doğrulama ya da Overpass başarısız olursa yayın yapılmaz, önceki veri canlı kalır.

Doğrulama: geçerli GeoJSON; her özellik bilinen özellik adları ve `c` sınıfı değerleriyle; tüm koordinatlar Türkiye kutusunda (35.6–42.3 N, 25.5–45.0 E); toplam ve ana kategoriler önceki yayının en az %80'i; boyut 2–15 MB.

## schemaVersion kuralı / rule

`schemaVersion` (şu an **1**), uygulamanın stillerinin dayandığı özellik adları ya da kategori değerleri (`c`, `k`, `s`, `d`, `t`, `b`, `u`, `n`, `m`) **değişirse** artırılır; yalnızca OSM verisi değişirse artırılmaz. Uygulama yalnızca kendi desteklediği sürümü indirir.
Bump `schemaVersion` only when the property names/categories the app's styles depend on change.

## Lisans / Licence

Veri © [OpenStreetMap katkıda bulunanlar](https://www.openstreetmap.org/copyright), [ODbL 1.0](https://opendatacommons.org/licenses/odbl/1-0/) altında. Data © OpenStreetMap contributors, ODbL 1.0. Bu depodaki betikler MIT.
