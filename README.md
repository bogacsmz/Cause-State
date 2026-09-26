# Cause & State

Kararlarının kelebek etkisiyle geri döndüğü, yapay zeka destekli modern dünya strateji oyunu. Tek oyunculu, tamamen senin bilgisayarında çalışan bir masaüstü uygulaması. Oyunu Claude yönetir, kuralları kod korur.

> Durum: **Faz 1 tamam: oyun oynanıyor (salt metin, senaryo yapay zekası).**
> - Türkiye'yi yönetiyorsun. Her ay 3 siyasi sermaye, her karar 1 puan; danışmanla konuşmak bedava.
> - Barlar her ay kendi kendine de oynar; her değişimin nedeni tur sonu raporunda yazar.
> - Kararların aylar sonra geri döner (kelebek etkisi). Dünya da boş durmaz.
> - Her 12 ayda seçim var. Onayın barajın altındaysa kaybedersin; istikrar çökerse ordu darbe yapar.
> - Sıradaki: Faz 2, senaryo yapay zekasının yerine gerçek Claude. Harita Faz 3'te.
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
- **Karar kartları:** her kart ne yaptığını ve bedelini rakamla gösterir. "Karar ver" dersen bu ayın kararlarına eklenir, alttaki çipten geri alabilirsin.
- **Emir kutusu:** "vergileri indir", "Almanya ile ticaret anlaşması imzala", "İzmir'e yatırım yap" gibi yazabilirsin. Soru sorarsan ("durum nedir?") danışman bedava cevap verir.
- **Turu bitir** (Ctrl+Enter): bir ay geçer, tur sonu raporu açılır. Geri dönen bir karar varsa en üstte "Kelebek etkisi" olarak görünür.
- **Sağda brifing:** her ayın manşeti, geri dönen kararlar, dünya gündemi ve danışmanla konuşmaların.

Oyun kendini otomatik kaydeder: uygulama klasöründe `saves/` altında her oyun ayrı bir SQLite dosyası. "Yeni oyun" eskisini silmez.

## Gerçek uygulama olarak kurmak

```bash
npm run package
```

`release/<sürüm>/` klasöründe bir `.dmg` çıkar. Açıp **Cause & State**'i Uygulamalar klasörüne sürükle, sonra normal bir program gibi aç. Arkadaşa göndermek için Windows sürümü: `npm run package:win`.

## Yapay zeka ayarları

> Faz 1'de oyun henüz Claude'u çağırmaz: emirleri kurallı bir senaryo yapay zekası yorumlar. Aşağıdaki ayarlar Faz 2'de devreye girer. Üst çubuktaki "Senaryo YZ" etiketinin üstüne gelirsen Claude bağlantısının hazır olup olmadığını görürsün.

Varsayılan olarak oyun **Claude aboneliğini** kullanır: bilgisayarındaki resmi `claude -p` komutunu çağırır. Ayrıca bir şey yapman gerekmez.

Değiştirmek istersen `.env.example` dosyasını `.env` adıyla kopyala ve düzenle:

| Ayar | Ne işe yarar |
|---|---|
| `CS_AI_PROVIDER` | `cli` (abonelik, varsayılan), `api` (API anahtarı) ya da `mock` (sahte, test için) |
| `CS_AI_MODEL` | İsteğe bağlı model. Örn. `opus`, `sonnet` ya da API için tam model kimliği |
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
| `npm run db:generate` | Kayıt şeması değişince SQL göçünü üretir |

Gerçek Claude ile tek bir bağlantı testi (birkaç yüz token harcar):

```bash
CS_LIVE_CLI=1 npx vitest run tests/live-cli.test.ts
```

## Klasörler

```text
src/shared/game/  Oyunun şeması: durum, olay, tohum, etki sözlüğü, kod↔yapay zeka sözleşmesi, ekran görünümü
src/engine/       Saf oyun motoru: tur, barların hareketi, kelebek tohumları, hakem, senaryo yapay zekası, denge botları
src/main/         Uygulamanın ana süreci: pencere, oyun oturumu, yapay zeka çağrıları
  game/           Oyun oturumu (kayıt dosyası, bu ayın kararları, danışman) ve pencere kanalları
  ai/             Yapay zeka katmanı: claude -p (abonelik), API anahtarı, sahte sağlayıcı
  store/          SQLite kayıt: anlık görüntüler, olay kaydı, tohumlar
src/preload/      Arayüz ile ana süreç arasındaki tek, güvenli köprü (window.cs)
src/renderer/     Arayüz (React): devlet masası, karar kartları, brifing, emir satırı, tur raporu
src/shared/       İki tarafın ortak kullandığı tipler ve kanal adları
drizzle/          Kayıt şemasının SQL göçleri (üretilir)
prompts/          Yapay zeka prompt'ları
tests/            Testler
scripts/          Smoke testi, oyun oynatıcı, denge testi, Faz 0.5 kanıtı, göç gömücü ve ikon üretici
build/            Uygulama ikonu
```
