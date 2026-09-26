# Cause & State — Claude için proje notları

Tek oyunculu, lokal çalışan, LLM destekli modern dünya strateji oyunu (Pax Historia'dan daha iyisi). Electron masaüstü uygulaması. Sahibi Bogac. Kod uzmanı değil: teknik yükü Claude taşır, açıklamalar sade ve Türkçe olur.

Tasarım belgeleri kod reposunda değil, vault'ta durur (`bogacsmz/obsidian_vault`, `Oyun/` klasörü):
- `Yol-Haritasi.md`: fazlar ve v1 hedefi (v2 plan: harita Faz 3'te)
- `Tasarim-Fikirleri.md`: onaylanmış mekanikler ve elenen fikirler (elenenleri tekrar önerme)
- `Kararlar.md`

Durum: Faz 0 (iskelet), Faz 0.5 (sözleşme), Faz 1 (salt metin çekirdek) ve Faz 2 (gerçek Claude) bitti. Sıradaki: Faz 3, harita (kullanıcıyla birlikte açılacak).

## Mimari (kod = tek gerçek, LLM = sadece bulanık iş)

- `src/shared/game/`: zod şemaları ve tipler. Tek kaynak bunlar: TypeScript tipi `z.infer` ile, ileride LLM'e giden JSON Schema da buradan üretilecek.
  - `primitives.ts`: barlar, ülke/il kimlikleri, EntityRef, etiketler.
  - `catalog.ts`: etki sözlüğü. LLM'in seçebileceği her şey burada, sayılar sadece burada. LLM ham sayı üretmez, `hint` alanında sayı olmaz.
  - `schema.ts`: GameState (sert durum, küçük), GameEvent (olay kaydı), Seed (kelebek tohumu).
  - `contract.ts`: TurnRequest (kod → LLM, sınırlı boyut, `LIMITS`) ve ChangeList (LLM → kod).
- `src/engine/`: saf, deterministik çekirdek. Electron/Node bağımlılığı yok.
  - `referee.ts`: `reviewChangeList` tek kapı. Önce şema, sonra kurallar. Hata mesajları LLM'in onarabileceği İngilizce metin.
  - `loop.ts`: öner → doğrula → onar (sınırlı deneme).
  - `turn.ts`: `applyTurn(state, action) → { newState, events, seeds, seedUpdates, narration, report }`. Sadece `ApprovedChangeList` alır. Sıra: kararlar ve patlayan tohumlar etkiye dönüşür → barlar hareket eder → süresi biten etkiler düşer → seçim → darbe zarı → sermaye dolar.
  - `dynamics.ts`: barların kendi hareketi (onay/istikrar/refah hedefe oransal, ekonomi uzun vadeli seviyesine, piyasa dalgalanması) ve darbe şansı. Dengeyi değiştirmek = `DYNAMICS` tablosu + `catalog.ts` rakamları.
  - `seeds.ts`: `planSeeds`, tohumun ne zaman patlayacağına AI'dan önce kod karar verir (anahtarlı zar). AI sadece sonucunu önerir (`seedOutcomes`).
  - `scripted-ai.ts`: kurallı yapay zeka (Faz 1). Artık yedek: `CS_AI_PROVIDER=mock`, Claude'a ulaşılamadığında ve denge botlarında. Claude ile aynı ChangeList'i üretir ve hakemden geçer.
  - `resolve.ts`: `resolveTurn`, bir tur uçtan uca: planSeeds → öner→doğrula→onar → applyTurn. Claude `ProposerFactory` ile takılır. `withNarration` haberi kod uyguladıktan sonra yerine koyar (sayılara dokunmaz).
  - `spotlight.ts`: bu ay hangi ülkelerin hamle yapacağına kod karar verir (kararların hedefleri + anahtarlı zarla gündemiyle hareket eden bir ülke); ne yapacaklarına Claude karar verir.
  - `view.ts`: `buildView`, arayüzün çizdiği `GameView` (etiketler dahil; arayüz motoru yüklemez).
  - `playtest.ts`: denge botları (boş, rastgele, popülist, otoriter, dengeli). `tests/game/balance.test.ts` eğlence sözleşmesini sayılarla korur.
  - `context.ts`: `buildTurnRequest`, her tur aynı üst sınırda bağlam.
  - `rng.ts`: tohumlu zar. Durum `GameState.rng` içinde; aynı tohum aynı oyunu verir.
- `src/main/game/`: `GameSession` (tek kayıt dosyası, bu ayın kararları, kabine sohbeti; çağrılar sıraya girer) ve `game:*` IPC kanalları (+ `game:progress` akışı). Arayüzden gelen her argüman burada doğrulanır. Her yapay zeka çağrısı kaydın yanına `.log.jsonl` olarak yazılır (bağlam → öneri → hakem → sonuç; ileride fine-tune veri seti).
- `src/main/game/claude/`: Claude beyni (`GameBrain`: `ClaudeBrain` ve kurallı `ScriptedBrain`).
  - `interpret`: yazılan mesaj → `talk` (bedava) ya da `action` (katalog hamleleri). Hamleler `checkDecision` ile hakemden geçer; ret gerekçesi Claude'a geri gider. İmkânsız emirde ilk öneri daima emrin birebir çevirisidir (fizibiliteye hakem karar verir), sonra Claude girişimin sonucunu (`reckless_gambit`) anlatır.
  - `resolve`: Claude dünyayı oynar (spotlight ülkelerin hamleleri, yeni tohumlar, patlayan tohumların sonucu) → `reviewChangeList` → `applyTurn` → haber (akış). Başarısızlıkta kurallı yedek devreye girer ve söylenir.
  - `prompts.ts`: sistem prompt'ları sabit (katalog kelimelerle, sayısız; dünya çerçevesi) → önbellekten gelir. Değişen her şey kullanıcı mesajında sınırlı TurnRequest olarak gider.
  - `schemas.ts`: Claude'un cevap şemaları (yapılandırılmış çıktı: CLI `--json-schema`, API `output_config.format`). Kasıtlı olarak gevşek; asıl kontrol hakemde.
- `src/shared/game/world-book.ts`: dondurulmuş 2026 dünya kitabı (15 ülke). Her istekte sadece ilgili 4 ülkenin girdisi gider.
- `src/shared/tr.ts`: sayılardan sonra doğru Türkçe ek (`ek(3, 'de')` → "3'te"). Sayıya elle `'de`/`'e` yazma.
- `src/main/store/`: SQLite hafıza (Node'un yerleşik `node:sqlite` + Drizzle sqlite-proxy; yerel modül yok).
  - Bir kayıt = bir dosya: `snapshots`, `events`, `seeds` ve entity/etiket bağlantı tabloları.
  - Olay kaydı sadece eklenir, silinmez. Tohumlar durum değiştirir (dormant → fired/defused), silinmez.
  - Şema değişikliği: `tables.ts` düzenle → `npm run db:generate` (drizzle-kit SQL üretir, `migrations.generated.ts` içine gömülür). Göç `PRAGMA user_version` ile ilerler.
- `map/`: harita veri hattı (Faz 3). Natural Earth 5.1.2 (ülke, il, şehir) → tippecanoe → tek PMTiles (`map/dist/world.pmtiles`, z0–8, ötesi overzoom).
  - Harita GameState'in görünümüdür; motor haritayı bilmez. Kimlikler oyunla aynı: ülke = `ADM0_A3` (TUR), il = ISO 3166-2 (TR-31), yoksa NE `adm1_code`. NE'nin eski kodları `ISO_FIXES` ile düzeltilir.
  - Zoom kademesi (`LOD`, `build.mjs`): özellik kendi zoom'undan önceki karolarda hiç yoktur. z0–2 ülke adları, z3 başkentler, z4 iller + büyük şehirler, z5 il adları, z6–8 scalerank'a göre daha küçük şehirler.
  - Git'e sadece küçük dosyalar girer: `sources.json` (sabit kaynak + sha256), `manifest.json` (boyut, sha256, karo istatistiği), `places.json` (oyunun kullanabileceği kimlikler). PMTiles ve indirmeler git dışında (`map/dist`, `map/.cache`).

## Değişmez kurallar

- **Dil:** Arayüz metinleri, README ve dokümanlar Türkçe. Kod kimlikleri ve kod yorumları İngilizce.
- **Güvenlik sınırı:** Arayüz (renderer) sadece `window.cs` köprüsünü görür. Sözleşme `src/shared/ipc.ts` dosyasında. `nodeIntegration` açılmaz, `sandbox` ve `contextIsolation` kapatılmaz. Node, dosya ve yapay zeka işleri ana süreçte kalır.
- **Yapay zeka:** Oyun sadece `LlmProvider` arayüzüyle konuşur (`src/main/ai/`).
  - `cli`, varsayılan: resmi `claude -p`, oyuncunun aboneliği.
  - `api`: API anahtarı.
  - `mock`: sahte sağlayıcı, test için.
- **Abonelik kuralı (Anthropic koşulları):** Abonelik OAuth token'ı asla okunmaz ve doğrudan API'ye gönderilmez. Tek abonelik yolu değiştirilmemiş `claude -p`. `subscriptionEnv()` `ANTHROPIC_API_KEY` değerini CLI'dan saklar, bunu bozma.
- **Model:** oyunun varsayılanı `claude-opus-5-5` (`DEFAULT_MODEL`, `src/main/config.ts`), hem CLI hem API. Faz 2'de Sonnet 5 ile karşılaştırıldı (`scripts/model-compare.mts`): ikisi de 6/6 geçerli öneri; Opus 5.5 toplamda 84 sn / $0,31, Sonnet 5 139 sn / $0,31; Opus 5.5'in haberleri daha sıkı ve kökenli, Sonnet 5 bir cevapta İngilizce kelime kaçırdı. Effort: emir okuma `low`, dünya `medium`, haber `low`. Kullanıcı istemeden model değiştirme.
- **LLM dünyayı doğrudan değiştirmez:** ChangeList önerir, hakem onaylar, `applyTurn` uygular. Bar, etki büyüklüğü, bütçe, zar ve seçim tarihi daima koddan gelir. Claude'un rolü üç: önerici, anlatıcı, diğer ülkelerin aklı. Ne zaman olacağına (tohum patlaması, hangi ülkenin sahneye çıkacağı) kod karar verir, ne olacağına Claude.
- **Hafıza SQLite'ta:** LLM'e her tur sadece özet + son N olay + ilgili tohumlar gider (`LIMITS`). Tarih asla prompt'ta birikmez.
- **Harita performansı:** sadece il (admin-1), ilçe asla yok. Şehirler scalerank + zoom ile kademeli. Renk/sahiplik değişimi feature-state ile (karo yeniden inmez). Harita verisi küçük kalır (şu an 17,9 MB).

## Doğrulama (her değişiklikten sonra)

```bash
npm run typecheck && npm test && npm run build
npm run kanit                                            # Faz 0.5 sözleşme kanıtı (metin raporu)
npm run kanit:faz2                                       # Faz 2 kanıtı, gerçek Claude (abonelik harcar)
npm run playtest                                         # denge tablosu (bot başına 200 oyun)
npm run map:build && npm run map:verify                  # harita karoları (tippecanoe gerekir), boyut + sha256 kontrolü
xvfb-run -a -s "-screen 0 1600x1000x24" npm run smoke   # Linux; Mac'te sadece: npm run smoke
xvfb-run -a -s "-screen 0 1600x1000x24" npm run playthrough -- strategy=planli   # 20 tur, her tur ekran görüntüsü
```

Arayüz değişikliklerinde `test-results/` altındaki ekran görüntülerine bak. "Testler geçti" demek "çalışıyor" demek değil.

Claude yolu testlerde kayıtlı gerçek cevaplarla (`tests/fixtures/claude/*.jsonl`, `ReplayProvider`) sınanır; canlı çağrı gerekmez. Prompt ya da şema değişince çağrı sırası değişirse `npm run record:claude` ile yeniden kaydet.

## Tasarım

"Harita odası" teması:
- Mürekkep koyusu yüzeyler, sıcak kâğıt rengi metin, pirinç vurgular.
- Fontlar: Newsreader (serif), IBM Plex Sans ve IBM Plex Mono.
- Renkler ve fontlar `src/renderer/src/styles/tokens.css` dosyasında.
- Hazır şablon görüntüsünden kaçın, emoji kullanma. 1px'lik kaymalar bile önemlidir.
