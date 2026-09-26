# Cause & State — Claude için proje notları

Tek oyunculu, lokal çalışan, LLM destekli modern dünya strateji oyunu (Pax Historia'dan daha iyisi). Electron masaüstü uygulaması. Sahibi Bogac. Kod uzmanı değil: teknik yükü Claude taşır, açıklamalar sade ve Türkçe olur.

Tasarım belgeleri kod reposunda değil, vault'ta durur (`bogacsmz/obsidian_vault`, `Oyun/` klasörü):
- `Yol-Haritasi.md`: fazlar ve v1 hedefi (v2 plan: harita Faz 3'te)
- `Tasarim-Fikirleri.md`: onaylanmış mekanikler ve elenen fikirler (elenenleri tekrar önerme)
- `Kararlar.md`

Durum: Faz 0 (iskelet) ve Faz 0.5 (sözleşme: şema, SQLite hafıza, öner→doğrula→onar) bitti. Sıradaki: Faz 1, salt metin çekirdek döngü ve eğlence kanıtı (tek ülke Türkiye, sahte yapay zeka).

## Mimari (kod = tek gerçek, LLM = sadece bulanık iş)

- `src/shared/game/`: zod şemaları ve tipler. Tek kaynak bunlar: TypeScript tipi `z.infer` ile, ileride LLM'e giden JSON Schema da buradan üretilecek.
  - `primitives.ts`: barlar, ülke/il kimlikleri, EntityRef, etiketler.
  - `catalog.ts`: etki sözlüğü. LLM'in seçebileceği her şey burada, sayılar sadece burada. LLM ham sayı üretmez, `hint` alanında sayı olmaz.
  - `schema.ts`: GameState (sert durum, küçük), GameEvent (olay kaydı), Seed (kelebek tohumu).
  - `contract.ts`: TurnRequest (kod → LLM, sınırlı boyut, `LIMITS`) ve ChangeList (LLM → kod).
- `src/engine/`: saf, deterministik çekirdek. Electron/Node bağımlılığı yok.
  - `referee.ts`: `reviewChangeList` tek kapı. Önce şema, sonra kurallar. Hata mesajları LLM'in onarabileceği İngilizce metin.
  - `loop.ts`: öner → doğrula → onar (sınırlı deneme).
  - `turn.ts`: `applyTurn(state, action) → { newState, events, seeds, narration }`. Sadece `ApprovedChangeList` alır.
  - `context.ts`: `buildTurnRequest`, her tur aynı üst sınırda bağlam.
  - `rng.ts`: tohumlu zar. Durum `GameState.rng` içinde; aynı tohum aynı oyunu verir.
- `src/main/store/`: SQLite hafıza (Node'un yerleşik `node:sqlite` + Drizzle sqlite-proxy; yerel modül yok).
  - Bir kayıt = bir dosya: `snapshots`, `events`, `seeds` ve entity/etiket bağlantı tabloları.
  - Olay kaydı sadece eklenir, silinmez. Tohumlar durum değiştirir (dormant → fired/defused), silinmez.
  - Şema değişikliği: `tables.ts` düzenle → `npm run db:generate` (drizzle-kit SQL üretir, `migrations.generated.ts` içine gömülür). Göç `PRAGMA user_version` ile ilerler.

## Değişmez kurallar

- **Dil:** Arayüz metinleri, README ve dokümanlar Türkçe. Kod kimlikleri ve kod yorumları İngilizce.
- **Güvenlik sınırı:** Arayüz (renderer) sadece `window.cs` köprüsünü görür. Sözleşme `src/shared/ipc.ts` dosyasında. `nodeIntegration` açılmaz, `sandbox` ve `contextIsolation` kapatılmaz. Node, dosya ve yapay zeka işleri ana süreçte kalır.
- **Yapay zeka:** Oyun sadece `LlmProvider` arayüzüyle konuşur (`src/main/ai/`).
  - `cli`, varsayılan: resmi `claude -p`, oyuncunun aboneliği.
  - `api`: API anahtarı.
  - `mock`: sahte sağlayıcı, test için.
- **Abonelik kuralı (Anthropic koşulları):** Abonelik OAuth token'ı asla okunmaz ve doğrudan API'ye gönderilmez. Tek abonelik yolu değiştirilmemiş `claude -p`. `subscriptionEnv()` `ANTHROPIC_API_KEY` değerini CLI'dan saklar, bunu bozma.
- **Model:** API varsayılanı `claude-opus-5` (`src/main/config.ts`). Kullanıcı istemeden model değiştirme. CLI'da model boşsa Claude Code'un varsayılanı kullanılır.
- **LLM dünyayı doğrudan değiştirmez:** ChangeList önerir, hakem onaylar, `applyTurn` uygular. Bar, etki büyüklüğü, bütçe, zar ve seçim tarihi daima koddan gelir.
- **Hafıza SQLite'ta:** LLM'e her tur sadece özet + son N olay + ilgili tohumlar gider (`LIMITS`). Tarih asla prompt'ta birikmez.

## Doğrulama (her değişiklikten sonra)

```bash
npm run typecheck && npm test && npm run build
npm run kanit                                            # Faz 0.5 sözleşme kanıtı (metin raporu)
xvfb-run -a -s "-screen 0 1600x1000x24" npm run smoke   # Linux; Mac'te sadece: npm run smoke
```

Arayüz değişikliklerinde `test-results/` altındaki ekran görüntülerine bak. "Testler geçti" demek "çalışıyor" demek değil.

## Tasarım

"Harita odası" teması:
- Mürekkep koyusu yüzeyler, sıcak kâğıt rengi metin, pirinç vurgular.
- Fontlar: Newsreader (serif), IBM Plex Sans ve IBM Plex Mono.
- Renkler ve fontlar `src/renderer/src/styles/tokens.css` dosyasında.
- Hazır şablon görüntüsünden kaçın, emoji kullanma. 1px'lik kaymalar bile önemlidir.
