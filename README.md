# Cause & State

Kararlarının kelebek etkisiyle geri döndüğü, yapay zeka destekli modern dünya strateji oyunu. Tek oyunculu, tamamen senin bilgisayarında çalışan bir masaüstü uygulaması. Oyunu Claude yönetir, kuralları kod korur.

> Durum: **Faz 2 tamam: gerçek Claude oynuyor.** Harita Faz 3'te.
> - Türkiye'yi yönetiyorsun ve emir kutusuna ne istersen yazıyorsun. Claude emrini etki sözlüğündeki hamlelere çevirir, hakem (kod) onaylar, sayıları kod hesaplar.
> - Soru sormak bedava ("Durum nedir?", "Vergileri indirsem ne olur?"); emirler siyasi sermaye yakar (her ay 3).
> - İmkânsız bir emir verirsen ("Dünyayı fethet") hakem reddeder, Claude girişimin bedelini anlatır.
> - Ay sonunda Claude dünyayı oynar: diğer ülkeler hamle yapar, kararların aylar sonra kelebek olarak geri döner, haberi Claude yazar.
> - Her 12 ayda seçim var; onayın barajın altındaysa kaybedersin, istikrar çökerse ordu darbe yapar.
>
> Yol haritası: vault'taki `Oyun/Yol-Haritasi.md`.

## Gereksinimler (Mac)

- **Node.js 22.16 veya üstü:** `brew install node`
- **Claude Code** kurulu ve giriş yapılmış olmalı. Terminalde `claude` yazınca açılıyorsa hazırsın.

## İlk kurulum

```bash
git clone https://github.com/bogacsmz/Cause-State.git ~/Claude/Projects/Cause-State
cd ~/Claude/Projects/Cause-State
npm install
npm run dev
```

`npm run dev` oyun penceresini açar. Kodda bir şey değişince pencere kendini yeniler.

## Nasıl oynanır

- **Ortada devlet masası:** anket ve seçim sayacı, barlar, yürürlükteki etkiler. Bir bara tıklarsan bu ay neden değiştiğini görürsün.
- **Emir kutusu (asıl oyun):** ne istersen kendi cümlenle yaz: "Suriye sınırına asker yığ ve Rusya ile gizli görüşme ayarla", "Enflasyonla mücadele et ama dar gelirliyi ezme". Kabinenin cevabı sağda akarak gelir; kararlar alttaki çiplere eklenir, istersen geri alırsın. Hakemin reddettiği bir şey olursa üstü çizili olarak ve nedeniyle görünür.
- **Soru sormak bedava:** "Durum nedir?", "Seçimi kazanır mıyız?", "Vergileri indirsem ne olur?". Konuşulan hamlelerin gerçek rakamları cevabın altında görünür.
- **Hazır kararlar:** kartlar kısayoldur; her kart ne yaptığını ve bedelini rakamla gösterir.
- **Turu bitir** (Ctrl+Enter): Claude dünyayı oynar, hakem kontrol eder, kod uygular, haber brifinge akarak yazılır. Sonra tur sonu raporu açılır; geri dönen bir karar varsa en üstte "Kelebek etkisi" olarak görünür.
- **Sağda brifing:** her ayın manşeti, geri dönen kararlar, diğer ülkelerin hamleleri ve kabineyle konuşmaların.

Oyun kendini otomatik kaydeder: uygulama klasöründe `saves/` altında her oyun ayrı bir SQLite dosyası. "Yeni oyun" eskisini silmez. Her kaydın yanında bir `.log.jsonl` dosyası da tutulur: Claude'a giden her istek, cevabı ve hakemin kararı. İleride oyuna özel küçük bir modeli eğitmek için veri seti olur.

## Gerçek uygulama olarak kurmak

```bash
npm run package
```

`release/<sürüm>/` klasöründe bir `.dmg` çıkar. Açıp **Cause & State**'i Uygulamalar klasörüne sürükle, sonra normal bir program gibi aç. Arkadaşa göndermek için Windows sürümü: `npm run package:win`.

## Yapay zeka ayarları

Varsayılan olarak oyun **Claude aboneliğini** kullanır: bilgisayarındaki resmi `claude -p` komutunu çağırır. Ayrıca bir şey yapman gerekmez. Model varsayılanı **Claude Opus 5.5**: Sonnet 5 ile yan yana denendi, ikisi de hep geçerli hamle önerdi, Opus 5.5 daha hızlı cevap verdi ve daha iyi Türkçe haber yazdı, maliyeti aynıydı.

Claude'a ulaşılamazsa (kurulu değil, limit doldu) oyun durmaz: Faz 1'in kurallı yapay zekası devreye girer ve bunu ekranda söyler. `CS_AI_PROVIDER=mock` ile oyun tamamen çevrimdışı bu kurallı yapay zekayla oynanır.

Bir tur (ayın hamleleri + haber) yaklaşık 20-30 saniye sürer; bir emrin okunması 6-10 saniye.

Değiştirmek istersen `.env.example` dosyasını `.env` adıyla kopyala ve düzenle:

| Ayar | Ne işe yarar |
|---|---|
| `CS_AI_PROVIDER` | `cli` (abonelik, varsayılan), `api` (API anahtarı) ya da `mock` (çevrimdışı, kurallı yapay zeka) |
| `CS_AI_MODEL` | İsteğe bağlı model. Varsayılan `claude-opus-5-5`; örn. `claude-sonnet-5` |
| `ANTHROPIC_API_KEY` | Sadece `api` modunda okunur. Abonelik yoluna asla verilmez |
| `CS_CLAUDE_PATH` | `claude` bulunamazsa tam yolu |

Abonelik yolunda oyun şunlara dikkat eder:
- API anahtarını ve oturum değişkenlerini `claude`'a hiç vermez, yani yanlışlıkla API'den para çekilmez.
- `claude`'u boş bir klasörde çalıştırır ve senin hook'larını, MCP sunucularını yüklemez.
- Oyun çağrıları Claude Code geçmişine kaydedilmez.

## Komutlar

| Komut | Ne yapar |
|---|---|
| `npm run dev` | Oyunu geliştirme modunda açar |
| `npm run package` | Bu bilgisayar için kurulabilir uygulama üretir |
| `npm test` | Birim testleri |
| `npm run typecheck` | TypeScript tip kontrolü |
| `npm run build` | Derler (`out/` klasörü) |
| `npm run smoke` | Derlenmiş uygulamayı açıp bir tur oynar, ekran görüntüsü alır (`test-results/`) |
| `npm run playthrough -- strategy=planli` | Derlenmiş uygulamayı oyuncu gibi 20 tur oynar, her turun ekran görüntüsünü ve kaydını alır (`planli`, `populist`, `otoriter`) |
| `npm run playtest` | Denge testi: botlar yüzlerce oyun oynar, kazanma/darbe/kelebek oranlarını tablo yapar |
| `npm run kanit` | Faz 0.5 kanıtı: oyun kaydı, hakem, olay/tohum sorguları ve bağlam boyutu raporu |
| `npm run kanit:faz2` | Faz 2 kanıtı, gerçek Claude ile: yaratıcı ve absürt emir, bedava soru, dış hamle, çeşitlilik, kelebek, tur 5/50/500 bağlam boyutu (`test-results/faz2/`) |
| `npm run record:claude` | Testlerin kullandığı gerçek Claude cevaplarını yeniden kaydeder (`tests/fixtures/claude/`) |
| `npm run db:generate` | Kayıt şeması değişince SQL göçünü üretir |
| `npm run map:build` | Harita karolarını üretir: Natural Earth ülke/il/şehir → `map/dist/world.pmtiles` (~18 MB, git'e girmez). `tippecanoe` gerekir: `brew install tippecanoe` |
| `npm run map:verify` | Harita dosyasının boyutunu ve sha256'sını `map/manifest.json` ile karşılaştırır |

Testler canlı Claude çağırmaz: gerçek Claude cevapları kaydedilmiştir ve testler onları oynatır. Gerçek Claude ile tek bir bağlantı testi (birkaç yüz token harcar):

```bash
CS_LIVE_CLI=1 npx vitest run tests/live-cli.test.ts
```

## Klasörler

```text
src/shared/game/  Oyunun şeması: durum, olay, tohum, etki sözlüğü, kod↔yapay zeka sözleşmesi, ekran görünümü
src/engine/       Saf oyun motoru: tur, barların hareketi, kelebek tohumları, dış hamle sırası, hakem, kurallı yapay zeka, denge botları
src/main/         Uygulamanın ana süreci: pencere, oyun oturumu, yapay zeka çağrıları
  game/           Oyun oturumu (kayıt dosyası, bu ayın kararları, kabine) ve pencere kanalları
  game/claude/    Claude beyni: emir okuma, dünyayı oynama, haber yazma; prompt'lar ve cevap şemaları
  ai/             Yapay zeka katmanı: claude -p (abonelik), API anahtarı, sahte sağlayıcı
  store/          SQLite kayıt: anlık görüntüler, olay kaydı, tohumlar
src/preload/      Arayüz ile ana süreç arasındaki tek, güvenli köprü (window.cs)
src/renderer/     Arayüz (React): devlet masası, karar kartları, brifing, emir satırı, tur raporu
src/shared/       İki tarafın ortak kullandığı tipler ve kanal adları
drizzle/          Kayıt şemasının SQL göçleri (üretilir)
map/              Harita veri hattı: Natural Earth → PMTiles betiği, kaynak/çıktı checksum'ları, kimlik dizini
tests/            Testler
scripts/          Smoke testi, oyun oynatıcılar (kurallı ve gerçek Claude), denge testi, model karşılaştırması, kanıtlar, göç gömücü ve ikon üretici
build/            Uygulama ikonu
```
