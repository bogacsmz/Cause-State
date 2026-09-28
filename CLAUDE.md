# Cause & State — Claude için proje notları

Tek oyunculu, lokal çalışan, LLM destekli modern dünya strateji oyunu (Pax Historia'dan daha iyisi). Electron masaüstü uygulaması. Sahibi Bogac. Kod uzmanı değil: teknik yükü Claude taşır, açıklamalar sade ve Türkçe olur.

Tasarım belgeleri kod reposunda değil, vault'ta durur (`bogacsmz/obsidian_vault`, `Oyun/` klasörü):
- `Yol-Haritasi.md`: fazlar ve v1 hedefi (v2 plan: harita Faz 3'te)
- `Tasarim-Fikirleri.md`: onaylanmış mekanikler ve elenen fikirler (elenenleri tekrar önerme)
- `Kararlar.md`

Durum: Faz 0 (iskelet), Faz 0.5 (sözleşme), Faz 1 (salt metin çekirdek) ve Faz 2 (gerçek Claude) bitti. Faz 3 (harita) dört adımı bitti: veri hattı, tam ekran harita, politik renkler (GameState → feature-state) ve tıklama, komşuluk grafiği. Şimdi **çekirdek cila** (fetihten önce, amaç eğlence): A (yapay zekaya yaratıcı alan, yeni prompt'lar), C (olay temposu: az, karışık tonda), D (kelebek kutusu yok, haberlere örülür) bitti; sırada B (hakemi gevşetmek) ve E (4 yıllık seçim, esnek tur atlama, hız). Fetih aksiyonu ondan sonra, kullanıcıyla birlikte açılacak.

## Mimari (kod = tek gerçek, LLM = sadece bulanık iş)

- `src/shared/game/`: zod şemaları ve tipler. Tek kaynak bunlar: TypeScript tipi `z.infer` ile, ileride LLM'e giden JSON Schema da buradan üretilecek.
  - `primitives.ts`: barlar, ülke/il kimlikleri, EntityRef, etiketler.
  - `catalog.ts`: etki sözlüğü. LLM'in seçebileceği her şey burada, sayılar sadece burada. LLM ham sayı üretmez, `hint` alanında sayı olmaz. `improvised`: sözlükte olmayan, adını yapay zekanın koyduğu gelişme (sayıları `impacts.ts` tablosundan).
  - `impacts.ts`: doğaçlama etki (çubuk + yön + "small/clear/large" + aylık mı + ne kadar sürer; kod sayıya çevirir: bir kerede 2/4/7, aylık 1/2/3) ve ayın temposu tipleri (ton: fırsat/iyi/nötr/kriz, ölçek: küçük/büyük, sahne: yurt içi/bir ülke/dünya). Ölçek sınırı `SCALE_LIMITS`: küçük olay oyuncuya toplam en çok 10 puan, büyük 20.
  - `schema.ts`: GameState (sert durum, küçük), GameEvent (olay kaydı), Seed (kelebek tohumu).
  - `contract.ts`: TurnRequest (kod → LLM, sınırlı boyut, `LIMITS`) ve ChangeList (LLM → kod). ChangeList'te `developments` (dünyanın kendi gelişmesi: başlık, hikâye, yapan, hedef, sözlük hamleleri ve/veya doğaçlama etkiler) ve `seedOutcomes` (geri dönen karar; kendi başlığı ve istenirse doğaçlama etkisiyle). `ChangeList` tipi önerinin yazıldığı hâl (varsayılanlı alanlar boş bırakılabilir), `ParsedChangeList` okunmuş hâli.
- `src/engine/`: saf, deterministik çekirdek. Electron/Node bağımlılığı yok.
  - `referee.ts`: `reviewChangeList` tek kapı. Önce şema, sonra kurallar. Hata mesajları LLM'in onarabileceği İngilizce metin. Gelişmeler için: yönetmen planlamadıysa gelişme yok, ton tutmalı (iyi haber oyuncuya yarar, kriz bir şey götürür), ölçeği aşmamalı. Tepkiler orantılı olmalı (oyuncu o ülkeye askerî/ağır bir hamle yapmadıysa küçük ölçek). `fitToPlan`: sadece "fazla büyük" olanı geri çevirmek yerine kısar (büyük kelimeyi küçültür, ağır tepkiyi düşürür, ağır sonucu doğaçlama etkiyle küçük anlatır); yanlış olanı (bilinmeyen kimlik, kural, ton) hakeme bırakır.
  - `loop.ts`: öner → doğrula → onar (sınırlı deneme).
  - `turn.ts`: `applyTurn(state, action) → { newState, events, seeds, seedUpdates, narration, report }`. Sadece `ApprovedChangeList` alır. Sıra: kararlar ve patlayan tohumlar etkiye dönüşür → barlar hareket eder → süresi biten etkiler düşer → seçim → darbe zarı → sermaye dolar.
  - `dynamics.ts`: barların kendi hareketi (onay/istikrar/refah hedefe oransal, ekonomi uzun vadeli seviyesine, piyasa dalgalanması) ve darbe şansı. Dengeyi değiştirmek = `DYNAMICS` tablosu + `catalog.ts` rakamları.
  - `director.ts`: **ayın temposu (yönetmen)**. AI'a sormadan önce kod karar verir: bu ay bir karar geri dönecek mi (en çok bir), dünya kendi gelişmesini getirecek mi, hangi tonda, ne büyüklükte, nerede başlayacak. Sakin aylar normaldir (gelişme ayların ~üçte birinde), tonlar karışık (fırsat+iyi ~%50, kriz ~%30), kriz arka arkaya nadiren gelir, büyük olay en az 8 ay arayla. Zor durumdaki hükümete daha çok fırsat, rahat olana daha çok dert. Geçmişini olay kaydındaki `gelisme` etiketinden okur (`happeningsFrom`). Oyuncunun kendi kararlarının sonucu tam ağırlıkla dönebilir; kendiliğinden gelen küçük kalır. Ayar tablosu `PACING`.
  - `seeds.ts`: `planSeeds`, tohumun ne zaman patlayacağına AI'dan önce kod karar verir (anahtarlı zar; yönetmen yoğun bir aydan sonra şansı yarıya indirir). AI sadece sonucunu önerir (`seedOutcomes`).
  - `weight.ts`: bir değişikliğin bir ülkeye toplam ağırlığı (bir kerelik + aylık × süre). Ton ve ölçek kontrolleri bununla yapılır.
  - `scripted-ai.ts`: kurallı yapay zeka (Faz 1). Artık yedek: `CS_AI_PROVIDER=mock`, Claude'a ulaşılamadığında ve denge botlarında. Claude ile aynı ChangeList'i üretir ve hakemden geçer.
  - `resolve.ts`: `resolveTurn`, bir tur uçtan uca: planMonth (yönetmen) → öner → fitToPlan → doğrula → onar → applyTurn. Claude `ProposerFactory` ile takılır. `withNarration` haberi kod uyguladıktan sonra yerine koyar (sayılara dokunmaz).
  - `spotlight.ts`: bu ay kimin tepki verebileceğine kod karar verir: sadece oyuncunun kararlarının dokunduğu ülkeler (kararsız ayda kimse tepki vermez). Dünyanın kendi hamlesi yönetmenin gelişmesidir; `monthFocus` gelişmenin başladığı ülkeyi de bağlama ekler.
  - `view.ts`: `buildView`, arayüzün çizdiği `GameView` (etiketler dahil; arayüz motoru yüklemez).
  - `playtest.ts`: denge botları (boş, rastgele, popülist, otoriter, dengeli). `tests/game/balance.test.ts` eğlence sözleşmesini sayılarla korur.
  - `context.ts`: `buildTurnRequest`, her tur aynı üst sınırda bağlam.
  - `rng.ts`: tohumlu zar. Durum `GameState.rng` içinde; aynı tohum aynı oyunu verir.
- `src/main/game/`: `GameSession` (tek kayıt dosyası, bu ayın kararları, kabine sohbeti; çağrılar sıraya girer) ve `game:*` IPC kanalları (+ `game:progress` akışı). Arayüzden gelen her argüman burada doğrulanır. Her yapay zeka çağrısı kaydın yanına `.log.jsonl` olarak yazılır (bağlam → öneri → hakem → sonuç; ileride fine-tune veri seti).
- `src/main/game/claude/`: Claude beyni (`GameBrain`: `ClaudeBrain` ve kurallı `ScriptedBrain`).
  - `interpret`: yazılan mesaj → `talk` (bedava) ya da `action` (katalog hamleleri). Hamleler `checkDecision` ile hakemden geçer; ret gerekçesi Claude'a geri gider. İmkânsız emirde ilk öneri daima emrin birebir çevirisidir (fizibiliteye hakem karar verir), sonra Claude girişimin sonucunu (`reckless_gambit`) anlatır.
  - `resolve`: Claude dünyayı oynar. İstekte yönetmenin planı gider: `reactors` (tepki verebilecekler), `development` (bu ayın gelişme yuvası: ton, ölçek, sahne; yoksa null = sakin ay), `consequenceScale`. Cevap: `reactions`, `development`, `consequences` (geri dönen kararlar), `newSeeds`. Uzun metin geri çevrilmez, kodda kısaltılır (`fitText`); hakemin itirazı Claude'un alan adlarıyla geri gider. → `reviewChangeList` → `applyTurn` → haber (akış). Başarısızlıkta kurallı yedek devreye girer ve söylenir.
  - `prompts.ts`: sistem prompt'ları sabit (katalog kelimelerle, sayısız; doğaçlama etki dili; dünya çerçevesi) → önbellekten gelir. Ayrım: skoru kod tutar (sayılar, zar, ne zaman ve hangi tonda), dünyayı Claude canlandırır (kim, ne, nerede, nasıl anlatılır). Somutluk ister: gerçek iller, kurumlar, rolüyle kişiler (yaşayan politikacı adı yok), bağlamı süren hikâye. Haber masası: bağımsız gazete, 90–160 kelime, klişesiz; geri dönen kararın kaynağı haberin içinde doğal geçer, asla "kelebek etkisi" denmez; sakin ayda küçük insan hikâyesi.
  - `schemas.ts`: Claude'un cevap şemaları (yapılandırılmış çıktı: CLI `--json-schema`, API `output_config.format`). Kasıtlı olarak gevşek; asıl kontrol hakemde.
- `src/shared/game/world-book.ts`: dondurulmuş 2026 dünya kitabı (15 ülke). Her istekte sadece ilgili 4 ülkenin girdisi gider.
- `src/shared/tr.ts`: sayılardan sonra doğru Türkçe ek (`ek(3, 'de')` → "3'te"). Sayıya elle `'de`/`'e` yazma.
- `src/main/store/`: SQLite hafıza (Node'un yerleşik `node:sqlite` + Drizzle sqlite-proxy; yerel modül yok).
  - Bir kayıt = bir dosya: `snapshots`, `events`, `seeds` ve entity/etiket bağlantı tabloları.
  - Olay kaydı sadece eklenir, silinmez. Tohumlar durum değiştirir (dormant → fired/defused), silinmez.
  - Şema değişikliği: `tables.ts` düzenle → `npm run db:generate` (drizzle-kit SQL üretir, `migrations.generated.ts` içine gömülür). Göç `PRAGMA user_version` ile ilerler.
- Harita (Faz 3): oyunun ana arayüzü, GameState'in görünümü. Motor haritayı bilmez.
  - **Tam paket:** harita dosyaları repoda ve uygulamanın içinde (`resources/map/`: `world.pmtiles` 17,9 MB, `physical.pmtiles` 3,5 MB, `relief.pmtiles` 1,7 MB, `fonts/` 15 glif dosyası; toplam 24,6 MB). electron-builder `extraResources` ile `.app`'in `Resources/map` klasörüne kopyalar. Temiz klonda `npm install && npm run dev` haritayı açar; dışarıya bağımlı tek şey yapay zeka.
  - `src/main/map/protocol.ts`: ana süreç dosyaları `cs-map://` üzerinden sunar (`tiles/<world|physical|relief>/{z}/{x}/{y}`, `fonts/<yığın>/<aralık>.pbf`). pmtiles kütüphanesi dosyayı diskte açık tutar, karoyu açıp verir. Başka hiçbir şey sunulmaz.
  - `src/renderer/src/map/`: MapLibre GL 6. `style.ts` katmanlar ve renkler, projeksiyon tek yerde (`MAP_PROJECTION`, şimdi `mercator`). `MapView.tsx` tam ekran tuval; eğim ve döndürme kapalı, önbellek sınırı 160 karo/kaynak, uzakta (z<3) piksel oranı 1. WebGL2 yoksa oyun haritasız sürer. `PerfOverlay.tsx`: F2 ile FPS, en uzun kare, karo ve bellek.
  - **Politik harita, GameState'ten renk:** her ülke Natural Earth MAPCOLOR9 sırasına göre dokuz tondan birinde (komşular aynı rengi almaz, `colors.ts`); oyuncunun ülkesi altın. Oturum her görünüme `map` ekler (`src/main/game/map-view.ts`, motorun dışında: harita GameState'in görünümü). `sync.ts` bunu feature-state'e çevirir ve sadece değişene dokunur: `player` (ülke), `fill` + `occupied` (başkasının elindeki il, işgalde taralı), `selected` (tıklanan). Karo hiç yeniden inmez. Kabartma soluk arka plan.
  - Tıklama: z<5 ülke, z≥5 il seçer; `MapInfo.tsx` oyun durumundan bilgi gösterir (barlar, tutum, aranızdaki etkiler; il için sahibi ve elinde tutan). Oyunda olmayan ülke "oyunun dışında" der.
  - HUD: yan paneller ince, yarı saydam ve katlanır (tercih `localStorage`'da); kamera oyuncunun ülkesini panellerin kapatmadığı alana sığdırır (`countries.json` sınır kutusu + kamera boşluğu). Tur işlerken brifing kendiliğinden açılır.
  - Test kancası: `CS_TEST_HOOKS=1` iken ana süreçte `globalThis.__csDebug.setProvince(id, sahip, tutan)` (sadece bellekte), arayüzde `window.__csRefresh()`. Normal oyunda yok.
  - **Komşuluk grafiği:** `map/adjacency.mjs` Natural Earth poligonlarından kara sınırlarını çıkarır (sınırlar ~330 m içinde en az 1 km birlikte gidiyorsa komşu; köşe teması ve boğaz sayılmaz). Çıktı `map/adjacency.json` (git, 300 KB): il ve ülke başına komşu → sınır km (yaklaşık, gerçeğin ~%80'i). İki il ülke sınırı aşarak değiyorsa ülkeler de komşu sayılır (tampon bölgeli Kıbrıs gibi). Sorgu: `src/shared/map/borders.ts` (`areProvincesAdjacent`, `areCountriesAdjacent`, `provinceNeighbors`, `countryNeighbors`, `borderKm`). Kural yok, sadece coğrafya; savaş/hareket mekaniği henüz yazılmadı.
  - **Bölgesel faza bırakılanlar:** (a) il z4'ten önce karolarda olmadığı için dünya zoom'unda el değiştiren il görünmüyor; (b) altın ulusal sınır haritadaki ülke çizgisini izliyor, il el değiştirince gerçek sahipliğe göre yeniden çizilmiyor. İkisi de fetih aksiyonu bağlanırken çözülecek.
  - Kimlikler oyunla aynı: ülke = `ADM0_A3` (TUR), il = ISO 3166-2 (TR-31), yoksa NE `adm1_code`. `promoteId` ile feature id'si bunlar (feature-state için). NE'nin eski kodları `ISO_FIXES` ile düzeltilir.
  - Zoom kademesi (`LOD`, `map/build.mjs`): özellik kendi zoom'undan önceki karolarda hiç yoktur. z0–2 ülke adları, z3 başkentler, z4 iller + büyük şehirler, z5 il adları, z6–8 scalerank'a göre küçük şehirler.
  - Yeniden üretmek (sadece geliştirici): `npm run map:build` (karolar, kabartma, fontlar, komşuluk; tippecanoe gerekir; geotiff/sharp/polylabel dev bağımlılığı). Kaynaklar `map/sources.json`'da sabit ve sha256'lı, çıktılar `map/manifest.json`'da. Aynı girdi aynı dosyayı verir. `map/places.json` oyunun kullanabileceği kimlikler (testlerde ve oturumda), `map/countries.json` ülke başına renk sırası ve sınır kutusu (arayüzde); ikisi `node map/build.mjs --data-only` ile tippecanoe'suz yazılır.

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
- **Ağ:** oyun yapay zeka dışında hiçbir yere bağlanmaz. Harita `cs-map://` ile uygulamanın içinden gelir; Chromium'un yazım denetimi sözlüğü indirmesi kapalı (`setSpellCheckerLanguages([])`). Yeni bir dış kaynak ekleme.
- **Kurulum:** `npm install` Electron programını da indirir (`postinstall: install-electron`; Electron 44 bunu artık kendisi yapmıyor ve electron-vite onu hemen arıyor). GPU'suz makinede (sanal makine, CI) `CS_SOFTWARE_GL=1` haritayı yazılımla çizer.
- **Harita performansı:** sadece il (admin-1), ilçe asla yok. Şehirler scalerank + zoom ile kademeli. Renk/sahiplik değişimi feature-state ile (karo yeniden inmez). Harita verisi küçük kalır (şu an 24,6 MB). HUD panellerinde `backdrop-filter` yok (hareket eden haritanın üstünde kare yer).

## Doğrulama (her değişiklikten sonra)

```bash
npm run typecheck && npm test && npm run build
npm run kanit                                            # Faz 0.5 sözleşme kanıtı (metin raporu)
npm run kanit:faz2                                       # Faz 2 kanıtı, gerçek Claude (abonelik harcar)
npm run playtest                                         # denge tablosu (bot başına 200 oyun)
npm run map:verify                                       # paketteki harita dosyaları manifest ile aynı mı (Node yeter)
xvfb-run -a -s "-screen 0 1600x1000x24" npm run kanit:harita   # zoom kademeleri, FPS, bellek (test-results/harita/)
xvfb-run -a -s "-screen 0 1600x1000x24" npm run kanit:harita-renk   # politik renk, GameState → recolor, tıklama, paneller
xvfb-run -a -s "-screen 0 1600x1000x24" npm run kanit:harita-komsu   # komşuluk grafiği: örnek sorgular + haritada komşular
xvfb-run -a -s "-screen 0 1600x1000x24" npm run smoke   # Linux; Mac'te sadece: npm run smoke
xvfb-run -a -s "-screen 0 1600x1000x24" npm run playthrough -- strategy=planli   # 20 tur, her tur ekran görüntüsü
```

Arayüz değişikliklerinde `test-results/` altındaki ekran görüntülerine bak. "Testler geçti" demek "çalışıyor" demek değil.

`npm run kanit:cila` (gerçek Claude, 20 ay, abonelik harcar): olay sayısı ve tonu, hakem, tur süresi, bütün haberler → `test-results/cila/kanit.md`. `scripts/olay-sayim.mts <kayıt.sqlite>` herhangi bir kayıttaki olayları ay ay sayar.

Claude yolu testlerde kayıtlı gerçek cevaplarla (`tests/fixtures/claude/*.jsonl`, `ReplayProvider`) sınanır; canlı çağrı gerekmez. Prompt ya da şema değişince çağrı sırası değişirse `npm run record:claude` ile yeniden kaydet.

## Tasarım

"Harita odası" teması:
- Mürekkep koyusu yüzeyler, sıcak kâğıt rengi metin, pirinç vurgular.
- Fontlar: Newsreader (serif), IBM Plex Sans ve IBM Plex Mono.
- Renkler ve fontlar `src/renderer/src/styles/tokens.css` dosyasında.
- Hazır şablon görüntüsünden kaçın, emoji kullanma. 1px'lik kaymalar bile önemlidir.
