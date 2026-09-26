# Cause & State

Kararlarının kelebek etkisiyle geri döndüğü, yapay zeka destekli modern dünya strateji oyunu. Tek oyunculu, tamamen senin bilgisayarında çalışan bir masaüstü uygulaması. Oyunu Claude yönetir, kuralları kod korur.

> Durum: **Faz 0 (iskelet) ve Faz 0.5 (sözleşme) tamam.**
> - Uygulama açılıyor, emir satırına yazdığın şey Claude'a gidiyor ve cevap harf harf akıyor.
> - Oyunun kemikleri hazır: şema, SQLite hafızası (olay kaydı ve kelebek tohumları), kod↔yapay zeka sözleşmesi ve hakem.
> - Sıradaki: Faz 1, salt metin çekirdek döngü. Harita Faz 3'te.
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

## Gerçek uygulama olarak kurmak

```bash
npm run package
```

`release/<sürüm>/` klasöründe bir `.dmg` çıkar. Açıp **Cause & State**'i Uygulamalar klasörüne sürükle, sonra normal bir program gibi aç. Arkadaşa göndermek için Windows sürümü: `npm run package:win`.

## Yapay zeka ayarları

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

Her cevabın altında "abonelik (API'de ~0,008 $)" gibi bir not görürsün. Bu, aynı çağrının API'de ne tutacağını gösterir, abonelikte ayrıca ödeme yapılmaz.

## Komutlar

| Komut | Ne yapar |
|---|---|
| `npm run dev` | Oyunu geliştirme modunda açar |
| `npm run package` | Bu bilgisayar için kurulabilir uygulama üretir |
| `npm test` | Birim testleri |
| `npm run typecheck` | TypeScript tip kontrolü |
| `npm run build` | Derler (`out/` klasörü) |
| `npm run smoke` | Derlenmiş uygulamayı açıp emir gönderir, ekran görüntüsü alır (`test-results/`) |
| `npm run kanit` | Faz 0.5 kanıtı: oyun kaydı, hakem, olay/tohum sorguları ve bağlam boyutu raporu |
| `npm run db:generate` | Kayıt şeması değişince SQL göçünü üretir |

Gerçek Claude ile tek bir bağlantı testi (birkaç yüz token harcar):

```bash
CS_LIVE_CLI=1 npx vitest run tests/live-cli.test.ts
```

## Klasörler

```text
src/shared/game/  Oyunun şeması: durum, olay, tohum, etki sözlüğü, kod↔yapay zeka sözleşmesi
src/engine/       Saf oyun motoru: hakem, öner→doğrula→onar, tur, bağlam kurucu, zar
src/main/         Uygulamanın ana süreci: pencere, yapay zeka çağrıları
  ai/             Yapay zeka katmanı: claude -p (abonelik), API anahtarı, sahte sağlayıcı
  store/          SQLite kayıt: anlık görüntüler, olay kaydı, tohumlar
src/preload/      Arayüz ile ana süreç arasındaki tek, güvenli köprü (window.cs)
src/renderer/     Arayüz (React): üst çubuk, harita alanı, brifing paneli, emir satırı
src/shared/       İki tarafın ortak kullandığı tipler ve kanal adları
drizzle/          Kayıt şemasının SQL göçleri (üretilir)
prompts/          Yapay zeka prompt'ları
tests/            Testler
scripts/          Smoke testi, Faz 0.5 kanıtı, göç gömücü ve ikon üretici
build/            Uygulama ikonu
```
