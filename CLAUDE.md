# Cause & State — Claude için proje notları

Tek oyunculu, lokal çalışan, LLM destekli modern dünya strateji oyunu (Pax Historia'dan daha iyisi). Electron masaüstü uygulaması. Sahibi Bogac. Kod uzmanı değil: teknik yükü Claude taşır, açıklamalar sade ve Türkçe olur.

Tasarım belgeleri kod reposunda değil, vault'ta durur (`bogacsmz/obsidian_vault`, `Oyun/` klasörü):
- `Yol-Haritasi.md`: fazlar ve v1 hedefi
- `Tasarim-Fikirleri.md`: onaylanmış mekanikler ve elenen fikirler (elenenleri tekrar önerme)
- `Kararlar.md`

Durum: Faz 0 (iskelet) bitti. Sıradaki: Faz 1 (harita).

## Değişmez kurallar

- **Dil:** Arayüz metinleri, README ve dokümanlar Türkçe. Kod kimlikleri ve kod yorumları İngilizce.
- **Güvenlik sınırı:** Arayüz (renderer) sadece `window.cs` köprüsünü görür. Sözleşme `src/shared/ipc.ts` dosyasında. `nodeIntegration` açılmaz, `sandbox` ve `contextIsolation` kapatılmaz. Node, dosya ve yapay zeka işleri ana süreçte kalır.
- **Yapay zeka:** Oyun sadece `LlmProvider` arayüzüyle konuşur (`src/main/ai/`).
  - `cli`, varsayılan: resmi `claude -p`, oyuncunun aboneliği.
  - `api`: API anahtarı.
  - `mock`: sahte sağlayıcı, test için.
- **Abonelik kuralı (Anthropic koşulları):** Abonelik OAuth token'ı asla okunmaz ve doğrudan API'ye gönderilmez. Tek abonelik yolu değiştirilmemiş `claude -p`. `subscriptionEnv()` `ANTHROPIC_API_KEY` değerini CLI'dan saklar, bunu bozma.
- **Model:** API varsayılanı `claude-opus-5` (`src/main/config.ts`). Kullanıcı istemeden model değiştirme. CLI'da model boşsa Claude Code'un varsayılanı kullanılır.
- **İleride:** LLM dünyayı doğrudan değiştirmeyecek. Şemaya bağlı bir değişiklik listesi önerecek, kod doğrulayıp uygulayacak. Rakamları ve zarı kod belirleyecek.

## Doğrulama (her değişiklikten sonra)

```bash
npm run typecheck && npm test && npm run build
xvfb-run -a -s "-screen 0 1600x1000x24" npm run smoke   # Linux; Mac'te sadece: npm run smoke
```

Arayüz değişikliklerinde `test-results/` altındaki ekran görüntülerine bak. "Testler geçti" demek "çalışıyor" demek değil.

## Tasarım

"Harita odası" teması:
- Mürekkep koyusu yüzeyler, sıcak kâğıt rengi metin, pirinç vurgular.
- Fontlar: Newsreader (serif), IBM Plex Sans ve IBM Plex Mono.
- Renkler ve fontlar `src/renderer/src/styles/tokens.css` dosyasında.
- Hazır şablon görüntüsünden kaçın, emoji kullanma. 1px'lik kaymalar bile önemlidir.
