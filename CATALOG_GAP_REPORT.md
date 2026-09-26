# Catalog gap report — missing artists and albums

Scan date: **2026-09-25** (Windows). Read-only: nothing was written to the database or the queue.
Method and taxonomy follow [`CATALOG_GAP_SCAN.md`](CATALOG_GAP_SCAN.md). Every row in this report is
also in [`apps/web/scripts/data/catalog-gaps-2026-09-25.csv`](apps/web/scripts/data/catalog-gaps-2026-09-25.csv)
(5,354 rows: every item not cleanly linked, including held-but-unlinked and out-of-scope rows, each with its class and fix route).

---

## 1. Summary

The catalog is close to complete for the Western canon and weakest in four places: a handful of
**pipeline defects that silently drop whole artists**, **prolific artists that are frozen or empty**,
**Korean/Japanese name coverage**, and **recency** (the queue is backed up).

| Reference universe | Size | Present | Real gaps | Notes |
|---|---|---|---|---|
| Curated lists (`external_scores`, 25 lists) | 2,624 albums | 2,313 (88.1%) incl. 72 needing only a link | 164 + 92 to review | 43 more are live albums skipped by policy; 12 Various Artists |
| Apple Music most-played (12 storefronts) + Deezer chart | 877 albums | 526 (60.0%) | 277 | plus 33 out of scope and 13 live (policy); 65 of the 277 are unverified title matches |
| Last.fm top artists (global 1,000 + 26 countries) | 1,828 artists | 1,711 (93.6%) | 117 | 27 are empty stubs, 90 have no row |
| Deezer global top 100 artists | 100 | 99 | 1 | ADÉLA |
| KR scene roster (`data/kr-scene.ts`) | 111 | 104 | 7 | 3 are spelling mismatches, not gaps |
| KR feat-only collaborators (≥3 credits) | 120 | 71 | 49 | 30 have a row but 0 releases |
| Coverage test set (`data/coverage-testset.ts`) | 45 | 42 | 3 | |
| Priority discographies vs MusicBrainz (official albums/EPs) | 414 artists | 385 complete | 29 artists / 84 albums+EPs | Springsteen, Dylan, Stones, Metallica, Pearl Jam, Taylor Swift… |
| Queue rows marked done but never written | 233 rows | 71 exist under another ID | **162** | Xamã, J Alvarez, Timal, Lukas Graham, Kaleo, Ken Carson… |
| Skipped Wikipedia/other seeds still absent | 2,418 names | — | 797 exist on Deezer with albums | the other 1,621 are not on Deezer or have no albums there |
| User search misses (`search_misses`) | 149 queries | most resolve now | ~15 real | mostly Hangul spellings of artists we hold |

### Root causes, ranked by what fixing them recovers

1. **Ghost queue rows — 162 artists silently lost.** Between 2026-07-01 and 07-05, 233 `mbid` queue
   rows were marked `done` with `releases_added = 0` and no artist row was ever created (all on 07-01…07-05,
   194 on 07-02 alone). 118 have no row at all and 44 are empty stubs. They will never be retried
   because `done` is terminal. **Fix:** reset those rows to `pending` (list in §5.1). Cheapest, highest-value fix here.
2. **Prolific artists are empty or frozen — 37 artists.** Ingest refuses any artist with more than
   800 MusicBrainz release groups (`MAX_INGEST_RGS`). 29 of them are empty stubs (Frank Sinatra, Johnny Cash,
   Grateful Dead, Ennio Morricone, most classical composers and orchestras). Six more, including Bob Dylan,
   Bruce Springsteen, the Rolling Stones and U2, had a partial ingest in June and every re-poll since has been
   skipped, so their discographies are frozen. Springsteen is missing 11 studio albums (e.g. *Magic*, *Wrecking Ball*, *Letter to You*)
   and Dylan is missing *Tempest* and *Rough and Rowdy Ways*. U2's `next_check_at` is 2036.
   **Fix:** an album/EP-only ingest mode for these artists (official status, no singles/bootlegs).
3. **Recent albums missing even after a fresh re-poll — root cause not yet known.** Taylor Swift
   (re-ingested 2026-09-20) lacks *The Tortured Poets Department* and *The Life of a Showgirl*. Prince
   (09-21) lacks *Art Official Age* and both *HITnRUN*s. Depeche Mode (09-21) lacks *Memento Mori*. Metallica
   and Pearl Jam (last ingested 06-29 via the prestige lane, overdue since 07-29) lack *72 Seasons* and
   *Dark Matter*. Confirmed absent from `release_groups` by title search. The pipeline device runs older
   code, which is the first thing to check. **Fix:** re-ingest one of these with the current code and
   watch which filter drops the release group.
4. **Native-script names are missing.** 4,266 of 6,567 Latin-named ingested Korean artists have no Hangul
   name or alias anywhere (Japanese: 609 of 946). This is why chart and search queries for 양홍원, 씨잼, 수란,
   재지팩트, 로제, 타이거JK, 팻두, 빌스택스, 시스템서울 and 아마자라시 find nothing, although we hold every one of
   those artists. Some of these artists genuinely use only a Latin name, so treat this count as an upper bound.
   **Fix:** a native-name alias backfill (MB aliases, then Deezer/Melon), which the search RPC already reads.
5. **Stub artists that chart.** 38,602 artist rows (45%) are `resolved` stubs: an MBID but no discography.
   Most are fine, being credit-graph collaborators. But 27 Last.fm-charting artists (Ken Carson, Cuco,
   Dean Blunt, Jão, PLK, Lazza…) and 19 chart-album artists (Steve Lacy, EST Gee, Jungle, Grand Corps
   Malade…) are stubs. **Fix:** promote stubs that appear in any popularity reference into the queue.
6. **MusicBrainz simply doesn't have it (mostly Korean).** 45 list albums look absent from MB but are on Deezer
   (Jerd *Bomm* and *A.M.P.*, Red Velvet *The Perfect Red Velvet*, B-Free, A.Train, EK, Legit Goons…).
   Another 26 list albums belong to artists MB doesn't have at all. A few of the 45 are symbol-title false
   positives: Stray Kids *5-Star* is held as ★★★★★. **Fix:** the existing Deezer/iTunes backfill lanes,
   pointed at this list.
7. **Recency lag.** 34 chart albums from owned artists are already on MB but not ingested (almost all
   released 2026-08/09: Jhené Aiko, Yeat, wave to earth, The Volunteers, Diljit Dosanjh…). All 23,361
   pending queue rows were created in September 2026, so the queue is the bottleneck, not discovery.
8. **Policy, not bugs.** 43 canonical live albums are skipped by `shouldIngestRG` (*At Folsom Prison*,
   *Live at Leeds*, *MTV Unplugged in New York*, *Alive!*, *At Fillmore East*, *Frampton Comes Alive!*…).
   Several are Rolling Stone 500 entries. This is a product decision: ingest `live` when it is on a curated list.

### Previously reported gaps — where they stand now

- **Fixed since reported:** Masta Wu, Skyminhyuk (21 releases), P-Type (27, incl. *Soulfire* and
  *Hardboiled Café*), Simon Dominic *ONYX*, ZICO, Paloalto, Don Toliver, ksmartboi, OKASHII, JMIN, BewhY,
  YANGHONGWON, BLASÉ, Jasmine Sokko, 민수, 음율, miiro, 검정치마 (incl. *201*), *4 the Youth* on both artists, NewJeans *Get Up*.
- **Still missing:** lov3rboi (MB has "Lov3rboi" [KR] but it is not queued), Hate the Sun, 大瀧詠一
  (MB spells it 大滝詠一, not queued), JaeDal (on MB, not queued), Yoon Young-bae, Gonggonggu, Kim Ho-joong
  (none found upstream by those romanizations), Jerd *Bomm*, 동물원 1집/2집 (artist row has 0 releases),
  Grateful Dead *American Beauty* (stub), Metallica *72 Seasons*, P-Type *THIS IS NOT AN ALBUM* (only pt.1 EP held).
- **Not gaps, spelling only:** 그레이 → Gray, 딘 → DEAN, Woo Won Jae → 우원재, Black Skirt → 검정치마,
  Blase → BLASÉ, Owen → Owen Ovadoz. These are alias gaps (cause 4).
- **Policy:** Nirvana *MTV Unplugged in New York* is a live album (cause 8). Sean2Slow still has no solo
  discography anywhere, as found on 07-17.

Full then-vs-now tables are in §6.

### Recommended order of work

| # | Action | Recovers | Effort |
|---|---|---|---|
| 1 | Reset the 162 ghost queue rows to `pending` (§5.1) | 162 artists, several with 1M+ Last.fm listeners | minutes |
| 2 | Find why re-polled artists drop recent albums (cause 3) | Taylor Swift, Prince, Depeche Mode, Metallica, Pearl Jam… likely many more | investigation |
| 3 | Album/EP-only ingest for the 37 prolific artists (§5.2) | Sinatra, Cash, Grateful Dead, Springsteen, Dylan, Stones, U2, classical | small code change |
| 4 | Native-script alias backfill | search + import matching for thousands of KR/JP artists | medium |
| 5 | Queue MB-known artists that aren't queued (charts, Last.fm, lists) | ~200 artists (§3, §4) | minutes, by MBID |
| 6 | Promote charting stubs into the queue | 46 artists | minutes |
| 7 | Deezer/iTunes backfill for MB-absent list albums and 0-release KR artists | 45 list albums + 30 feat collaborators | uses existing lanes |
| 8 | Link the 72 held-but-unlinked list rows (§2) | prestige scores for 72 albums | minutes |
| 9 | Decide the live-album policy for curated lists | 43 canon albums | decision |
| 10 | Review the 92 unmatched list rows by hand; fix list data errors | accuracy of `external_scores` | manual |

---

## 2. Curated lists (`external_scores`)

3,319 list rows collapse to **2,624 unique albums**. Class counts:

| Class | Albums | Meaning |
|---|---|---|
| linked | 2,241 | found by MBID |
| present-title-drift / -mbid-mismatch / -unlinked | 17 / 23 / 32 | held, but the list row isn't linked to it |
| filtered | 43 | on MB, skipped by ingest policy (live, remix, "other") |
| out-of-scope | 12 | Various Artists / cast recordings |
| artist-missing | 6 | artist absent; MB knows the artist |
| artist-missing-mb-album-absent | 26 | artist absent and not on MB |
| artist-stub | 13 | artist row is an empty stub (Sinatra ×9, Grateful Dead ×2…) |
| artist-incomplete | 7 | owned artist; album on MB but not ingested |
| mb-absent-deezer | 45 | not on MB; on Deezer |
| upstream-absent | 66 | no artist row; nothing found on MB or Deezer |
| unmatched-owned-artist | 92 | artist held, but no title matched on MB/Deezer; needs a human |

Compared with this morning's baseline (270 missing), the strict artist gate and upstream verification
moved many rows: 72 are already held, 43 are policy, and several "artist found" hits were false.

**List data errors spotted.** Some `grammy_dance_electronic` rows look mis-paired. *Quest for Fire* is a
Skrillex album, not Kaytranada. Little Simz *Power*, Yaeji *Crush* and Kaytranada *Trip* weren't found as
albums on MusicBrainz or Deezer and should be checked against the source list. Ed Sheeran *Divide*/*Equals* are held as ÷ and =, and Stray Kids *5-Star* as ★★★★★. Symbol titles defeat text matching.
Korean lists often use a Hangul title where MB and Deezer use English (SG Wannabe 죄와 벌, H.O.T. 행복),
so most of the 92 unmatched rows are probably held. They need a manual pass or a tracklist comparison.

#### artist-missing — 6

_Fix route: artist absent; MB MBID known — queue by MBID (seed:missing-from-external)_

| Artist | Album | Lists | Year | Evidence |
|---|---|---|---|---|
| Bob Newhart | The Button-Down Mind of Bob Newhart | grammy_aoty | 1961 | MB artist Bob Newhart 14abda46-7ed4-4cf6-b4c6-f694166cd5f0; queue: done |
| Jungle | Jungle | mercury_prize | 2014 | MB artist Jungle 59074e0f-ede4-4ff1-bee2-cbfd3a273095; queue: none |
| Si Zentner & Johnny Mann Singers | Great Band with Great Voices | grammy_aoty | 1962 | MB artist Si Zentner 4ec41f8c-b399-4684-a361-a233e8e81a83; queue: none |
| 정태춘 | 시인의 마을 | kr_masterpiece_100 | 1987 | MB artist 정태춘 0a6f0222-9377-4f72-a9cf-382c276a1e1d; queue: none |
| ペトロールズ | Renaissance | jp_mino_100 | 2016 | MB artist ペトロールズ a0347939-0334-44b0-b684-8606ab0f9655; queue: none |
| 大瀧詠一 | A LONG VACATION | jp_mino_100 | 1981 | MB artist 大滝詠一 e4aa4f0c-3d21-4ad2-ad2a-7d34da50373e; queue: none |

#### artist-missing-mb-album-absent — 26

_Fix route: artist absent and not on MB — Deezer seed (seed-deezer-artist) or manual_

| Artist | Album | Lists | Year | Evidence |
|---|---|---|---|---|
| Jclef | Flaw, Flaw | kha_rnb, rhythmer_hiphop | 2018/2019 | Deezer: flaw, flaw; MB artist: Jclef/KR |
| AP Alchemy | AP Alchemy: Side A | kha_hiphop | 2024 | Deezer: AP Alchemy : Side A; MB artist: none |
| Ape Oblong | Ape Has Escaped | rhythmer_hiphop | 2025 | Deezer: APE HAS ESCAPED; MB artist: none |
| Boni | 신보경 | rhythmer_rnb | 2018 | Deezer: —; MB artist: Boni/? |
| Brocolli, You Too | 졸업 | kma_aoty | 2011 | Deezer: —; MB artist: You Too/? |
| Brocolli, You Too | 보편적인 노래 | kma_aoty | 2010 | Deezer: —; MB artist: You Too/? |
| Damye | Life's A Loop | rhythmer_hiphop | 2019 | Deezer: LIFE'S A LOOP; MB artist: none |
| Damye | The Sandwich Artist | rhythmer_rnb | 2020 | Deezer: The Sandwich Artist; MB artist: none |
| DeVita | Creme | kha_rnb | 2021 | Deezer: —; MB artist: DeVita/KR |
| Electric Planet Five | Waltz, Seoul | weiv_aoty | 2018 | Deezer: Waltz, Seoul; MB artist: none |
| Jaedal | Bomb Head | rhythmer_hiphop | 2021 | Deezer: —; MB artist: JaeDal/? |
| Jaedal | Period | rhythmer_hiphop | 2018 | Deezer: Period; MB artist: JaeDal/? |
| Jaedal | Adventure | rhythmer_hiphop | 2017 | Deezer: Adventure; MB artist: JaeDal/? |
| Jinbo The Superfricc & Hersh & PoPoMo | PoPoMo | kha_rnb | 2025 | Deezer: —; MB artist: Hersh/?, Hersh/? |
| John Green | West Side Story | grammy_aoty | 1962 | Deezer: —; MB artist: John Green/US, John Green/?, John Green/?, John Green/GB, John Green/?, John Green/?, John Green/?, John Green/? |
| Kim Ho-joong | Panorama | golden_disc_bonsang | 2022 | Deezer: PANORAMA; MB artist: none |
| Kwai | Flowering4 | rhythmer_hiphop | 2020 | Deezer: Flowering4; MB artist: none |
| L-like | Olive | rhythmer_rnb | 2021 | Deezer: Olive; MB artist: none |
| Lil Fish | 분열 | rhythmer_rnb | 2021 | Deezer: —; MB artist: Lil Fish/? |
| Mustangs | The Mustangs | kma_aoty | 2007 | Deezer: —; MB artist: Mustangs/?, Mustangs/? |
| Robert Russell Bennett | Victory at Sea, Vol. I | grammy_aoty | 1960 | Deezer: —; MB artist: Robert Russell Bennett/US |
| Shinjihang | NONG | kha_rnb | 2026 | Deezer: NONG; MB artist: shinjihang/KR |
| Wavisabiroom | Vibe | rhythmer_hiphop | 2017 | Deezer: VIBE; MB artist: Wavisabiroom/? |
| 노브레인 | 怒 | kr_masterpiece_100 | 1999 | Deezer: —; MB artist: No Brain/KR |
| 윤영배 | 위험한 세계 | kr_masterpiece_100 | 2003 | Deezer: 위험한 세계; MB artist: none |
| ミノタウロス | 肖像 | jp_mino_100 | 1974 | Deezer: —; MB artist: ミノタウロス/JP |

#### artist-stub — 13

_Fix route: artist row is a stub (discography never ingested) — see heavily-featured / ghost sections_

| Artist | Album | Lists | Year | Evidence |
|---|---|---|---|---|
| Grateful Dead | American Beauty | pitchfork_perfect, rs500 | 1970 | stub artist Grateful Dead; queue: skipped (heavily_featured) |
| Frank Sinatra | Come Fly with Me | grammy_aoty | 1959 | stub artist Frank Sinatra; queue: skipped (heavily_featured) |
| Frank Sinatra | Trilogy: Past Present Future | grammy_aoty | 1981 | stub artist Frank Sinatra; queue: skipped (heavily_featured) |
| Frank Sinatra | September of My Years | grammy_aoty | 1966 | stub artist Frank Sinatra; queue: skipped (heavily_featured) |
| Frank Sinatra | In the Wee Small Hours | rs500 | 1955 | stub artist Frank Sinatra; queue: skipped (heavily_featured) |
| Frank Sinatra | Come Dance with Me! | grammy_aoty | 1960 | stub artist Frank Sinatra; queue: skipped (heavily_featured) |
| Frank Sinatra | A Man and His Music | grammy_aoty | 1967 | stub artist Frank Sinatra; queue: skipped (heavily_featured) |
| Frank Sinatra | Frank Sinatra Sings for Only the Lonely | grammy_aoty | 1959 | stub artist Frank Sinatra; queue: skipped (heavily_featured) |
| Frank Sinatra | Nice 'n' Easy | grammy_aoty | 1961 | stub artist Frank Sinatra; queue: skipped (heavily_featured) |
| Frank Sinatra & Antônio Carlos Jobim | Francis Albert Sinatra & Antônio Carlos Jobim | grammy_aoty | 1968 | stub artist Frank Sinatra; queue: skipped (heavily_featured) |
| Grateful Dead | Workingman’s Dead | rs500 | 1970 | stub artist Grateful Dead; queue: skipped (heavily_featured) |
| Van Cliburn | Rachmaninoff Piano Concerto No. 3 | grammy_aoty | 1960 | stub artist Сергей Васильевич Рахманинов; queue: skipped (heavily_featured) |
| Van Cliburn | Tchaikovsky: Concerto No. 1 in B-Flat Minor | grammy_aoty | 1959 | stub artist Пётр Ильич Чайковский; queue: skipped (heavily_featured) |

#### artist-incomplete — 7

_Fix route: owned artist, album on MB but not in DB — re-ingest artist (freshness)_

| Artist | Album | Lists | Year | Evidence |
|---|---|---|---|---|
| David Bowie | Blackstar | mercury_prize, grammy_alternative, brit_album | 2016/2017 | MB single: Blackstar Radio Edits; ours David Bowie (259 RGs) |
| Bruce Springsteen | Wrecking Ball | grammy_rock | 2013 | MB album: Wrecking Ball; ours Bruce Springsteen (115 RGs) |
| Depeche Mode | Memento Mori | grammy_dance_electronic | 2024 | MB album: Memento Mori; ours Depeche Mode (137 RGs) |
| Glenn Gould | Bach: The Goldberg Variations | pitchfork_perfect | 1956/1982 | MB album: The Goldberg Variations; ours Glenn Gould (72 RGs) |
| Metallica | 72 Seasons | grammy_rock | 2024 | MB single: 72 Seasons; ours Metallica (137 RGs) |
| Pearl Jam | Dark Matter | grammy_rock | 2025 | MB single: Dark Matter; ours Pearl Jam (123 RGs) |
| The Rolling Stones | A Bigger Bang | grammy_rock | 2006 | MB album: A Bigger Bang; ours The Rolling Stones (677 RGs) |

#### mb-absent-deezer — 45

_Fix route: not on MusicBrainz; available on Deezer — Deezer/iTunes gap-fill (discover:backfill)_

| Artist | Album | Lists | Year | Evidence |
|---|---|---|---|---|
| Jerd | Bomm | kha_rnb, rhythmer_rnb, izm_aoty | 2023/2024 | Deezer: BOMM; ours Jerd |
| A.Train | Private Pink | kha_rnb, rhythmer_rnb | 2022/2023 | Deezer: PRIVATE PINK; ours A.TRAIN |
| B-Free | Free The Mane 3 "Free The Mane VS B-Free" | rhythmer_hiphop, kha_hiphop | 2025/2026 | Deezer: FREE THE MANE 3 “FREE THE MANE VS B-FREE”; ours B‐Free |
| B-Free & Hukky Shibaseki | Free Hukky Shibaseki & the God Sun Symphony Group: Odyssey.1 | rhythmer_hiphop, kha_hiphop | 2024/2025 | Deezer: Free Hukky Shibaseki & the God Sun Symphony Group : Odyssey.1; ours B‐Free |
| Babylon | Ego 90's | kha_rnb, rhythmer_rnb | 2022/2023 | Deezer: EGO 90'S; ours Babylon |
| Chaboom | Sour | rhythmer_hiphop, kha_hiphop | 2017/2018 | Deezer: SOUR; ours 차붐 |
| EK | ESCAPE | rhythmer_hiphop, kha_hiphop | 2024/2025 | Deezer: ESCAPE; ours EK |
| Fleeky Bang | AKUMA | rhythmer_hiphop, kha_hiphop | 2024/2025 | Deezer: AKUMA; ours Fleeky Bang |
| Horim | Metrocity | kha_rnb, rhythmer_rnb | 2018/2019 | Deezer: METROCITY; ours Horim |
| Jerd | A.M.P. | rhythmer_rnb, kha_rnb | 2021/2022 | Deezer: A.M.P.; ours Jerd |
| Legit Goons | Junk Drunk Love | kha_hiphop, rhythmer_hiphop | 2017/2018 | Deezer: Junk Drunk Love; ours Legit Goons |
| Los | Skandalouz | rhythmer_hiphop, kha_hiphop | 2021/2022 | Deezer: SKANDALOUZ 2; ours Los |
| Rico | White Light Panorama | kha_rnb, rhythmer_rnb | 2017/2018 | Deezer: White Light Panorama — artist has 0 RGs; ours Rico |
| Stray Kids | 5-Star | mama_aoty, golden_disc_bonsang | 2023 | Deezer: 5-STAR; ours Stray Kids |
| A.Train | Povidone Orange | rhythmer_rnb | 2025 | Deezer: POVIDONE ORANGE; ours A.TRAIN |
| A.Train | PAINGREEN | rhythmer_rnb | 2020 | Deezer: PAINGREEN; ours A.TRAIN |
| B-Free | FREE THE MANE 'END OF AMEN' | rhythmer_hiphop | 2023 | Deezer: FREE THE MANE "END OF AMEN"; ours B‐Free |
| Barbra Streisand | Funny Girl | grammy_aoty | 1965 | Deezer: Funny Girl - Original Soundtrack Recording; ours Barbra Streisand |
| BRWN | Monsoon | rhythmer_rnb | 2024 | Deezer: Monsoon; ours BRWN |
| BRWN | 추 (Yours Truly) | rhythmer_rnb | 2023 | Deezer: Yours Truly; ours BRWN |
| BTS | The Most Beautiful Moment in Life: Young Forever | mma_aoty | 2016 | Deezer: The Most Beautiful Moment in Life: Young Forever; ours BTS |
| D.O. | Empathy | golden_disc_bonsang | 2021 | Deezer: 공감 Empathy - The 1st Mini Album; ours D.O. |
| Dada | Love is a Bandage | rhythmer_rnb | 2025 | Deezer: Love is a Bandage; ours Dada |
| Deadmau5 | 4x4=12 | grammy_dance_electronic | 2012 | Deezer: 4x4=12; ours deadmau5 |
| EK | YAHO | kha_hiphop | 2026 | Deezer: YAHO; ours EK |
| George Michael | Listen Without Prejudice Vol. 1 | brit_album | 1991 | Deezer: Listen Without Prejudice Vol. 1 (Remastered); ours George Michael |
| Hannah Jang | Hannah's Studio | rhythmer_rnb | 2025 | Deezer: Hannah's Studio; ours Hannah Jang |
| Illinit | Cosmos | kha_hiphop | 2019 | Deezer: Cosmos; ours 일리닛 |
| India.Arie | Testimony: Vol. 1, Life & Relationship | grammy_rnb | 2007 | Deezer: Testimony: Vol. 1 Life & Relationship; ours India.Arie |
| Jeff Mills | Live at the Liquid Room, Tokyo | pitchfork_perfect | 1996 | Deezer: Live At The Liquid Room - Tokyo; ours Jeff Mills |
| Jerry. K | OVRWRT | rhythmer_hiphop | 2017 | Deezer: OVRWRT; ours Jerry.K |
| JJANGYOU | KOKI7 | rhythmer_hiphop | 2018 | Deezer: KOKI7; ours 짱유 |
| Leebido & HD BL4CK | A Prescription For | rhythmer_hiphop | 2023 | Deezer: A prescription for; ours HD BL4CK |
| MADDY | Come Over | rhythmer_rnb | 2017 | Deezer: Come Over; ours Maddy |
| Mild Beats | Fragment | rhythmer_hiphop | 2021 | Deezer: Fragment; ours Mild Beats |
| Nahzam Sue | Till The Sun Goes Up | kha_rnb | 2017 | Deezer: Till the Sun Goes Up — artist has 0 RGs; ours 나잠 수 |
| SHINDRUM | Who I Am | rhythmer_rnb | 2021 | Deezer: Who I Am — artist has 0 RGs; ours SHINDRUM |
| Soul Delivery | Peninsula Park | rhythmer_rnb | 2023 | Deezer: Peninsula Park; ours Soul delivery |
| Soul Delivery | Foodcourt | rhythmer_rnb | 2022 | Deezer: FOODCOURT; ours Soul delivery |
| Stray Kids | Rock-Star | mama_aoty | 2024 | Deezer: ROCK-STAR; ours Stray Kids |
| Stray Kids | In Life | golden_disc_bonsang | 2020 | Deezer: IN LIFE; ours Stray Kids |
| SYUNMAN | Digital Advance | weiv_aoty | 2019 | Deezer: DIGITAL ADVANCE — artist has 0 RGs; ours Syunman |
| Unofficialboyy | True | rhythmer_hiphop | 2023 | Deezer: TRUE; ours unofficialboyy |
| Young Tak | Mmm | golden_disc_bonsang | 2022 | Deezer: MMM; ours 영탁 |
| 조동익 | 동경 | kr_masterpiece_100 | 1994 | Deezer: 동경; ours 조동익 |

#### upstream-absent — 66

_Fix route: no artist row, and nothing found on MB or Deezer — manual lookup / accept_

| Artist | Album | Lists | Year | Evidence |
|---|---|---|---|---|
| Gonggonggu | ㅠㅠ | kha_hiphop, rhythmer_hiphop | 2022/2023 | no artist row |
| Kim Sim-ya & Son Dae-hyun | Moonshine | kha_hiphop, rhythmer_hiphop | 2017/2018 | no artist row |
| Lee Hyeon-jun | 번역 중 손실 | rhythmer_hiphop, kha_hiphop | 2022/2023 | no artist row |
| Rabbitoneabeat | Trapstar Lifestyle | kha_hiphop, rhythmer_hiphop | 2023/2024 | no artist row |
| Bahngbek | 너의 손 | kma_aoty | 2017 | no artist row |
| Black Skirt | 201 | kma_aoty | 2010 | no artist row |
| Black Skirt | THIRSTY | kma_aoty | 2020 | no artist row |
| Black Skirt | TEEN TROUBLES | kma_aoty | 2023 | no artist row |
| Black Skirt | Don't You Worry Baby (I'm only swimming) | kma_aoty | 2012 | no artist row |
| Cheon Yong-seong | 수몰 | kma_aoty | 2022 | no artist row |
| Cokeoer | Super Stars | kma_aoty | 2004 | no artist row |
| Cokeoer | Fire, Dance with Me | kma_aoty | 2007 | no artist row |
| Gwon Na-mu | 삶의 향기 | kma_aoty | 2026 | no artist row |
| Heatcore | Heartcore | rhythmer_hiphop | 2021 | no artist row |
| Hwana | Fanaconda | kha_hiphop | 2018 | no artist row |
| Hwana | Fanatiic | kha_hiphop | 2022 | no artist row |
| Jinho The Superfricc | Jbfm | kha_rnb | 2026 | no artist row |
| Jo Dong-ik | 푸른 베개 | kma_aoty | 2021 | no artist row |
| Jo Dong-jin | 나무가 되어 | kma_aoty | 2017 | no artist row |
| Jo Gyu-chan | Guitology | kma_aoty | 2006 | no artist row |
| Kang Tae-gu | bleu | kma_aoty | 2018 | no artist row |
| Kim Dong-ryool | Monologue | mama_aoty | 2008 | no artist row |
| Kim Ho-joong | The Classic Album I – My Favorite Arias | golden_disc_bonsang | 2021 | no artist row |
| Kim Ho-joong | We Are Family | golden_disc_bonsang | 2020 | no artist row |
| Kim Hyun-cheol | City Breeze & Love Song | kma_aoty | 2022 | no artist row |
| Kwai | DISTORTED | rhythmer_hiphop | 2024 | no artist row |
| Lee Ji-hyeong | Radio Dayz | kma_aoty | 2007 | no artist row |
| Lee Sang-ui Nalgae | 의식의흐름 | kma_aoty | 2017 | no artist row |
| Lee Seung-yeol | V | kma_aoty | 2014 | no artist row |
| Lee Seung-yeol | 이날, 이때, 이즈음에... | kma_aoty | 2004 | no artist row |
| Lee Seung-yeol | Why We Fail | kma_aoty | 2012 | no artist row |
| Lee Seung-yeol | In Exchange | kma_aoty | 2008 | no artist row |
| Moscow Surfing Club | 짙은햇살 | izm_aoty | 2024 | no artist row |
| Nah Youn-sun | Voyage | kma_aoty | 2009 | no artist row |
| Nah Youn-sun | Lento | kma_aoty | 2014 | no artist row |
| Nah Youn-sun | Same Girl | kma_aoty | 2011 | no artist row |
| Okoyé | 날씨가 바뀌든 안 바뀌든 | izm_aoty | 2024 | no artist row |
| Painted | Lucky Daye | grammy_rnb | 2020 | no artist row |
| Park Seon-ju | A4rism | kma_aoty | 2007 | no artist row |
| Rabbitoneabeat | lobonatune2! | rhythmer_hiphop | 2022 | no artist row |
| Shin Seha | 7F, the Void | kha_rnb | 2018 | no artist row |
| Song Young-ju | Atmosphere | kma_aoty | 2023 | no artist row |
| U-Know Yunho | Noir | golden_disc_bonsang | 2021 | no artist row |
| Woo Hee-jun | 심장의 펌핑은 고문질 | kma_aoty | 2026 | no artist row |
| Yoon Da Hye | 개미의 왕 | kha_rnb | 2026 | no artist row |
| Yoon Young-bae | 위험한 세계 | kma_aoty | 2014 | no artist row |
| Yura | 꽤 많은 수의 촉수돌기 | kha_rnb | 2024 | no artist row |
| 끝없는잔향속에서우리는 | 우연의 연속에 의한 필연 | weiv_aoty | 2017 | no artist row |
| 노이즈가든 | Noizegarden | kr_masterpiece_100 | 1996 | no artist row |
| 루시갱 | Home Sweet Home | rhythmer_hiphop | 2025 | no artist row |
| 마그마 | 마그마 | kr_masterpiece_100 | 1989 | no artist row |
| 모도 & Ambiguous Jack | RUSHHOUR | rhythmer_hiphop | 2025 | no artist row |
| 바이스 벌사 | ANIMAL FKRY | rhythmer_hiphop | 2025 | no artist row |
| 선진 & 격 & 덥덥이 | Arkestra | rhythmer_hiphop | 2023 | no artist row |
| 신중현과 엽전들 | 신중현과 엽전들 | kr_masterpiece_100 | 1974 | no artist row |
| 에피 | E | izm_aoty | 2025 | no artist row |
| 영기획 | 3 Little Wacks | weiv_aoty | 2015 | no artist row |
| 우리 노래 전시회 | 우리 노래 전시회 | kr_masterpiece_100 | 1979 | no artist row |
| 윤다혜 | 개미의 왕 | rhythmer_rnb | 2025 | no artist row |
| 재림 & 선진 | GMBT | rhythmer_hiphop | 2025 | no artist row |
| 전산시스템오류 | Hue | rhythmer_hiphop | 2022 | no artist row |
| 정지아 | 입수 | rhythmer_rnb | 2021 | no artist row |
| 줄리아 드림 | 불안의 세계 | weiv_aoty | 2016 | no artist row |
| 체 | Kpop | rhythmer_rnb | 2022 | no artist row |
| 플랫샵 | toast recipe | rhythmer_hiphop | 2025 | no artist row |
| 히피쿤다 | Tundra | rhythmer_hiphop | 2025 | no artist row |

#### unmatched-owned-artist — 92

_Fix route: artist is held and has a discography, but no title matched on MB or Deezer — usually the list uses another language/romanization, or the list row is wrong; manual review_

| Artist | Album | Lists | Year | Evidence |
|---|---|---|---|---|
| C JAMM | 킁 | kma_aoty, kha_hiphop, rhythmer_hiphop | 2019/2020 | ours C Jamm (22 RGs); MB disc 11, Deezer disc 16 |
| Bassagong | 탕아 | rhythmer_hiphop, kha_hiphop | 2018/2019 | ours Bassagong (4 RGs); MB disc 4, Deezer disc 19 |
| C JAMM | 걘 | kha_hiphop, rhythmer_hiphop | 2022/2023 | ours C Jamm (22 RGs); MB disc 11, Deezer disc 16 |
| Ed Sheeran | Divide | mercury_prize, brit_album | 2017/2018 | ours Ed Sheeran (112 RGs); MB disc 215, Deezer disc 150 |
| Khundi Panda | 가로사옥 | rhythmer_hiphop, kha_hiphop | 2020/2021 | ours Khundi Panda (12 RGs); MB disc 2, Deezer disc 20 |
| QM | 개미 | kha_hiphop, rhythmer_hiphop | 2024/2025 | ours QM (27 RGs); MB disc 3, Deezer disc 98 |
| Sky Min-hyuk | 해방 | rhythmer_hiphop, kha_hiphop | 2023/2024 | ours Skyminhyuk (21 RGs); MB disc 0, Deezer disc 19 |
| Sumin | 시치미 | rhythmer_rnb, kha_rnb | 2023/2024 | ours SUMIN (29 RGs); MB disc 32, Deezer disc 27 |
| Unofficialboyy & Haifhaif | 그물,덫,발사대기,포획 | kha_hiphop, rhythmer_hiphop | 2021/2022 | ours unofficialboyy (2 RGs); MB disc 2, Deezer disc 25 |
| 2AM | Can't Let You Go Even If I Die | mama_aoty | 2010 | ours 2AM (36 RGs); MB disc 24, Deezer disc 6 |
| A.Train | Hello, My Name Is Insecure. | rhythmer_rnb | 2018 | ours A.TRAIN (1 RGs); MB disc 1, Deezer disc 13 |
| Arca | Jacobin | grammy_dance_electronic | 2024 | ours Arca (54 RGs); MB disc 70, Deezer disc 2 |
| Bonobo | Finding Your Feet | grammy_dance_electronic | 2022 | ours Bonobo (56 RGs); MB disc 87, Deezer disc 1 |
| BTS | The Most Beautiful Moment in Life, Part 1 | mama_aoty | 2015 | ours BTS (61 RGs); MB disc 101, Deezer disc 1 |
| Busker Busker | Busker Busker 1st Album | mama_aoty | 2012 | ours 버스커 버스커 (7 RGs); MB disc 7, Deezer disc 0 |
| Chaboom & Leebido | Hot Stuff 3 | rhythmer_hiphop | 2022 | ours 차붐 (1 RGs); MB disc 1, Deezer disc 0 |
| Chaboom & Leebido | Hot Stuff | rhythmer_hiphop | 2020 | ours 차붐 (1 RGs); MB disc 1, Deezer disc 0 |
| Chaboom & Leebido | Hot Stuff 2 | rhythmer_hiphop | 2021 | ours 차붐 (1 RGs); MB disc 1, Deezer disc 0 |
| Daft Punk | Chicken Grease | grammy_dance_electronic | 2005 | ours Daft Punk (67 RGs); MB disc 213, Deezer disc 38 |
| Danpyunsun and the Moments Ensemble | 동물 | kma_aoty | 2015 | ours 단편선 순간들 (1 RGs); MB disc 1, Deezer disc 6 |
| Don Malik | 선인장화 | kha_hiphop | 2021 | ours Don Malik (9 RGs); MB disc 9, Deezer disc 26 |
| Ed Sheeran | Equals | brit_album | 2022 | ours Ed Sheeran (112 RGs); MB disc 215, Deezer disc 150 |
| god | 길 | golden_disc_daesang | 2001 | ours G.O.D (9 RGs); MB disc 9, Deezer disc 79 |
| H.O.T. | 행복 | golden_disc_daesang | 1997 | ours H.O.T. (7 RGs); MB disc 10, Deezer disc 12 |
| H2O | 오늘 나는 | kr_masterpiece_100 | 1992 | ours H2O (1 RGs); MB disc 1, Deezer disc 161 |
| Hippy Was Gipsy | 불 | kha_rnb | 2020 | ours 히피는 집시였다 (5 RGs); MB disc 5, Deezer disc 7 |
| Jang Pill Soon | soony eight : 소길花 | kma_aoty | 2019 | ours 장필순 (12 RGs); MB disc 12, Deezer disc 1 |
| Jeong Cha-sik | 황망한 사내 | kma_aoty | 2012 | ours 정차식 (7 RGs); MB disc 3, Deezer disc 0 |
| Jeongmilla | 청파소나타 | kma_aoty | 2021 | ours 정밀아 (4 RGs); MB disc 4, Deezer disc 9 |
| Kaytranada | Quest for Fire | grammy_dance_electronic | 2023/2024 | ours KAYTRANADA (79 RGs); MB disc 128, Deezer disc 43 |
| Kaytranada | Trip | grammy_dance_electronic | 2021 | ours KAYTRANADA (79 RGs); MB disc 128, Deezer disc 43 |
| Killer Mike | A Great Chaos | grammy_aoty | 2024 | ours Killer Mike (39 RGs); MB disc 49, Deezer disc 64 |
| Kim Sa-wol X Kim Hae-won | {비밀} | kma_aoty | 2015 | ours 김사월 (5 RGs); MB disc 5, Deezer disc 2 |
| Kwai & Irene | 엔트로피 | rhythmer_hiphop | 2021 | ours IRENE (1 RGs); MB disc 3, Deezer disc 124 |
| Lee Sang-eun | The Third Place | kma_aoty | 2008 | ours 이상은 (6 RGs); MB disc 7, Deezer disc 6 |
| Lee So-ra | 7집 | kma_aoty | 2010 | ours 이소라 (11 RGs); MB disc 12, Deezer disc 4 |
| Little Simz | Power | grammy_dance_electronic | 2022 | ours Little Simz (45 RGs); MB disc 62, Deezer disc 41 |
| OLNL | 전체이용가 | rhythmer_hiphop | 2018 | ours OLNL (26 RGs); MB disc 9, Deezer disc 12 |
| Original Broadway Cast | Jesus Christ Superstar | grammy_aoty | 1973 | ours [theatre] (26 RGs); MB disc 33, Deezer disc 10 |
| QM | 돈숨 | rhythmer_hiphop | 2021 | ours QM (27 RGs); MB disc 3, Deezer disc 98 |
| Rina Sawayama | Versions of Me | grammy_dance_electronic | 2023 | ours Rina Sawayama (31 RGs); MB disc 48, Deezer disc 39 |
| Room306 | 겹 | weiv_aoty | 2019 | ours Room306 (1 RGs); MB disc 2, Deezer disc 16 |
| Sam Lee & 이근형 & 이선정 & 이성열 & Charlie Jung & Tami Kim | The Musician | izm_aoty | 2025 | ours Charlie Jung (2 RGs); MB disc 2, Deezer disc 0 |
| Seon and Young | 밤과낮 | kma_aoty | 2023 | ours 정재필 (0 RGs); MB disc 0, Deezer disc 0 |
| SG Wannabe | 죄와 벌 | golden_disc_daesang | 2005 | ours SG Wannabe (46 RGs); MB disc 22, Deezer disc 22 |
| SG Wannabe | 아리랑 | golden_disc_daesang | 2007 | ours SG Wannabe (46 RGs); MB disc 22, Deezer disc 22 |
| Simon Dominic | 화기엄금 | rhythmer_hiphop | 2019 | ours Simon Dominic (21 RGs); MB disc 12, Deezer disc 24 |
| Takeone | 녹색이념 | kha_hiphop | 2017 | ours Takeone (3 RGs); MB disc 3, Deezer disc 17 |
| TVXQ | "O"-Jung.Ban.Hap. | mama_aoty | 2006 | ours 東方神起 (117 RGs); MB disc 141, Deezer disc 11 |
| Viann & Khundi Panda | 재건축 | rhythmer_hiphop | 2017 | ours Khundi Panda (12 RGs); MB disc 2, Deezer disc 20 |
| Yaeji | Crush | grammy_dance_electronic | 2021 | ours Yaeji (29 RGs); MB disc 38, Deezer disc 24 |
| youra | 꽤 많은 수의 촉수 돌기 | rhythmer_rnb | 2023 | ours youra (26 RGs); MB disc 19, Deezer disc 31 |
| Yumdda | 살아숨셔 4 | kha_hiphop | 2026 | ours YUMDDA (47 RGs); MB disc 26, Deezer disc 41 |
| Zion.T | 00 | rhythmer_rnb | 2017 | ours Zion.T (45 RGs); MB disc 31, Deezer disc 28 |
| 강허달림 | Love | izm_aoty | 2023 | ours 강허달림 (0 RGs); MB disc 0, Deezer disc 1 |
| 김건모 | 핑계 | golden_disc_daesang | 1994 | ours 김건모 (16 RGs); MB disc 16, Deezer disc 0 |
| 김건모 | 잘못된 만남 | golden_disc_daesang | 1995 | ours 김건모 (16 RGs); MB disc 16, Deezer disc 0 |
| 김건모 | 스피드 | golden_disc_daesang | 1996 | ours 김건모 (16 RGs); MB disc 16, Deezer disc 0 |
| 김범수 | 여행 | izm_aoty | 2024 | ours 김범수 (22 RGs); MB disc 24, Deezer disc 1 |
| 김수철 | 45주년 기념 앨범 너는 어디에 | izm_aoty | 2024 | ours 김수철 (6 RGs); MB disc 6, Deezer disc 0 |
| 김현식 | 내 사랑 내 곁에 | golden_disc_daesang | 1991 | ours 김현식 (23 RGs); MB disc 8, Deezer disc 0 |
| 동물원 | 동물원 2집 | kr_masterpiece_100 | 1989 | ours 동물원 (0 RGs); MB disc 0, Deezer disc 3 |
| 동물원 | 동물원 1집 | kr_masterpiece_100 | 1987 | ours 동물원 (0 RGs); MB disc 0, Deezer disc 3 |
| 배현이 | 자유주제 | rhythmer_hiphop | 2022 | ours 배현이 (12 RGs); MB disc 0, Deezer disc 0 |
| 버스커 버스커 | 두 번째 편지 | mma_aoty | 2013 | ours 버스커 버스커 (7 RGs); MB disc 7, Deezer disc 0 |
| 변진섭 | 너무 늦었잖아요 | golden_disc_daesang | 1989 | ours 변진섭 (4 RGs); MB disc 4, Deezer disc 6 |
| 변진섭 | 너에게로 또 다시 | golden_disc_daesang | 1990 | ours 변진섭 (4 RGs); MB disc 4, Deezer disc 6 |
| 봄여름가을겨울 | 봄여름가을겨울 1집 | kr_masterpiece_100 | 1988 | ours 봄여름가을겨울 (2 RGs); MB disc 3, Deezer disc 0 |
| 봄여름가을겨울 | 봄여름가을겨울 2집 | kr_masterpiece_100 | 1989 | ours 봄여름가을겨울 (2 RGs); MB disc 3, Deezer disc 0 |
| 송창식 | 사랑이야 | kr_masterpiece_100 | 1979 | ours 송창식 (0 RGs); MB disc 0, Deezer disc 4 |
| 신승훈 | 널 사랑하니까 | golden_disc_daesang | 1993 | ours 신승훈 (47 RGs); MB disc 18, Deezer disc 3 |
| 신승훈 | 보이지 않는 사랑 | golden_disc_daesang | 1992 | ours 신승훈 (47 RGs); MB disc 18, Deezer disc 3 |
| 실리카겔 | 실리카겔 | weiv_aoty | 2016 | ours Silica Gel (22 RGs); MB disc 22, Deezer disc 22 |
| 안치환 | 안치환 4집 | kr_masterpiece_100 | 1999 | ours 안치환 (4 RGs); MB disc 4, Deezer disc 1 |
| 유라 | 꽤 많은 수의 촉수 돌기 | izm_aoty | 2023 | ours youra (26 RGs); MB disc 19, Deezer disc 31 |
| 윤상 | CLICHÉ | kr_masterpiece_100 | 1991 | ours 윤상 (11 RGs); MB disc 12, Deezer disc 0 |
| 이문세 | 사랑이 지나가면 | golden_disc_daesang | 1987 | ours 이문세 (19 RGs); MB disc 20, Deezer disc 1 |
| 이설아 | 작은 마을 | izm_aoty | 2023 | ours 이설아 (0 RGs); MB disc 0, Deezer disc 0 |
| 이수영 | 휠릴리 | golden_disc_daesang | 2004 | ours 이수영 (22 RGs); MB disc 19, Deezer disc 0 |
| 이장희 | 그건 너 | kr_masterpiece_100 | 1974 | ours 이장희 (1 RGs); MB disc 1, Deezer disc 2 |
| 임현정 | Extraordinary | izm_aoty | 2025 | ours 임현정 (4 RGs); MB disc 4, Deezer disc 0 |
| 잠비나이 | 은서 | weiv_aoty | 2016 | ours 잠비나이 (6 RGs); MB disc 6, Deezer disc 1 |
| 장명선 | 이르고 무의미한 고백 | weiv_aoty | 2018 | ours 장명선 (2 RGs); MB disc 2, Deezer disc 0 |
| 조성모 | 피아노 | golden_disc_daesang | 2003 | ours 조성모 (7 RGs); MB disc 8, Deezer disc 0 |
| 조성모 | 아시나요 | golden_disc_daesang | 2000 | ours 조성모 (7 RGs); MB disc 8, Deezer disc 0 |
| 조성모 | 슬픈 영혼식 | golden_disc_daesang | 1999 | ours 조성모 (7 RGs); MB disc 8, Deezer disc 0 |
| 조용필 | 허공 | golden_disc_daesang | 1986 | ours 조용필 (61 RGs); MB disc 23, Deezer disc 0 |
| 주현미 | 신사동 그 사람 | golden_disc_daesang | 1988 | ours 주현미 (6 RGs); MB disc 7, Deezer disc 0 |
| 진보 | Jbfm | rhythmer_rnb | 2025 | ours Jinbo (6 RGs); MB disc 6, Deezer disc 55 |
| 쿨 | 진실 | golden_disc_daesang | 2002 | ours Cool (30 RGs); MB disc 19, Deezer disc 80 |
| 파라솔 | 언젠가 그 날이 오면 | weiv_aoty | 2015 | ours 파라솔 (2 RGs); MB disc 2, Deezer disc 0 |
| 한승석 & 정재일 | 끝내 바다에 | weiv_aoty | 2017 | ours 정재일 (9 RGs); MB disc 9, Deezer disc 1 |

#### filtered — 43

_Fix route: policy: live/remix/other types are skipped by shouldIngestRG_

| Artist | Album | Lists | Year | Evidence |
|---|---|---|---|---|
| Judy Garland | Judy at Carnegie Hall | grammy_aoty, pitchfork_perfect | 1961/1962 | MB: Judy at Carnegie Hall [live] |
| KISS | Alive! | rs500, pitchfork_perfect | 1975 | MB: Alive! [live] |
| Nirvana | MTV Unplugged in New York | grammy_alternative, rs500 | 1994/1996 | MB: MTV Unplugged in New York [live] |
| Prince | Sign o' the Times | grammy_aoty, pitchfork_perfect | 1987/1988 | MB: Sign o’ the Times Live! [live] |
| Sam Cooke | Live at the Harlem Square Club, 1963 | rs500, pitchfork_perfect | 1985 | MB: Live at the Harlem Square Club, 1963 [live] |
| Alicia Keys | Unplugged | grammy_rnb | 2006 | MB: Unplugged [live] |
| Allan Sherman | My Son, the Folk Singer | grammy_aoty | 1963 | MB: Allan Sherman's Mother Presents: My Son, the Folk Singer: Singing Very Funny Folk Songs [live] |
| Aretha Franklin | Amazing Grace | rs500 | 1972 | MB: Amazing Grace [live] |
| B.B. King | Live at the Regal | rs500 | 1965 | MB: Live at the Regal [live] |
| Bonnie Raitt | Road Tested | grammy_rock | 1997 | MB: Road Tested [live] |
| Bruce Springsteen | Magic | grammy_rock | 2008 | MB: Magic [type:other] |
| Daft Punk | Alive 2007 | grammy_dance_electronic | 2009 | MB: Alive 2007 [live] |
| Eagles | Hell Freezes Over | grammy_pop_vocal | 1996 | MB: Hell Freezes Over [live] |
| Eels | Electro-Shock Blues Show | grammy_dance_electronic | 2006 | MB: Electro‐Shock Blues Show [live] |
| Eric Clapton | Unplugged | grammy_aoty | 1993 | MB: Unplugged [live] |
| Erykah Badu | Live | grammy_rnb | 1999 | MB: Live [live] |
| Fleetwood Mac | The Dance | grammy_pop_vocal | 1998 | MB: The Dance [live] |
| Fred Again | Actual Life 3 | mercury_prize | 2023 | MB: Actual Life 3 Piano Live (22 December 2022) [live] |
| Harry Belafonte | Belafonte Returns to Carnegie Hall | grammy_aoty | 1961 | MB: Belafonte Returns to Carnegie Hall [live] |
| Harry Belafonte | Belafonte at Carnegie Hall | grammy_aoty | 1960 | MB: Belafonte at Carnegie Hall [live] |
| Jackson Browne | Running on Empty | grammy_aoty | 1979 | MB: Running on Empty [live] |
| James Brown | Live at the Apollo, 1962 | rs500 | 1963 | MB: The James Brown Show: Live At The Apollo [live] |
| James Brown | Live at the Apollo | pitchfork_perfect | 1963 | MB: Live at the Apollo 1995 [live] |
| Jeebanoff | Good Thing. [remix] | kha_rnb | 2021 | MB: GOOD THING. [Remix] [remix] |
| John Coltrane | The Olatunji Concert: The Last Live Recording | pitchfork_perfect | 2001 | MB: The Olatunji Concert: The Last Live Recording [live] |
| Johnny Cash | Johnny Cash at San Quentin | grammy_aoty | 1970 | MB: Johnny Cash at San Quentin [live] |
| Johnny Cash | At Folsom Prison | rs500 | 1968 | MB: At Folsom Prison [live] |
| Justice | Woman Worldwide | grammy_dance_electronic | 2019 | MB: Woman Worldwide [live] |
| Kraftwerk | 3-D The Catalogue | grammy_dance_electronic | 2018 | MB: 3‐D The Catalogue [live] |
| Lalah Hathaway | Lalah Hathaway Live | grammy_rnb | 2017 | MB: Lalah Hathaway Live [live] |
| Led Zeppelin | Celebration Day | grammy_rock | 2014 | MB: Celebration Day [live] |
| Nina Simone | Nina Simone in Concert | pitchfork_perfect | 1964 | MB: Nina Simone in Concert [live] |
| NUMBER GIRL | サッポロOMOIDE IN MY HEAD状態 | jp_mino_100 | 2002 | MB: サッポロOMOIDE IN MY HEAD状態 [live] |
| Odesza | Bloom | grammy_dance_electronic | 2019 | MB: Bloom (Lane 8 remix) [remix] |
| Peter Frampton | Frampton Comes Alive! | grammy_aoty | 1977 | MB: Frampton Comes Alive! [live] |
| PJ Morton | Gumbo Unplugged (Live) | grammy_rnb | 2019 | MB: Gumbo Unplugged [live] |
| RCサクセション | ラプソディー | jp_mino_100 | 1980 | MB: ラプソディー ネイキッド [live] |
| Taylor Swift | The Tortured Poets Department | grammy_pop_vocal | 2025 | MB: The Tortured Poets Department [type:other] |
| The Allman Brothers Band | At Fillmore East | rs500 | 1971 | MB: At Fillmore East [live] |
| The Chemical Brothers | Don't Think | grammy_dance_electronic | 2013 | MB: Don’t Think [live] |
| The Who | Live at Leeds | rs500 | 1970 | MB: Live at Leeds [live] |
| Tony Bennett | MTV Unplugged | grammy_aoty | 1995 | MB: MTV Unplugged [live] |
| 村八分 | ライブ | jp_mino_100 | 1975 | MB: ライブ [live] |

#### present-title-drift — 17

_Fix route: already held under a different title — link only_

| Artist | Album | Lists | Year | Evidence |
|---|---|---|---|---|
| BTS | Love Yourself: Tear | mama_aoty, mma_aoty, sma_album | 2018 | ours: LOVE YOURSELF 轉 ‘Tear’ () |
| BTS | Love Yourself: Answer | golden_disc_bonsang, golden_disc_daesang | 2018 | ours: LOVE YOURSELF 結 ‘Answer’ () |
| BTS | Love Yourself: Her | golden_disc_daesang, mama_aoty | 2017 | ours: LOVE YOURSELF 承 ‘Her’ () |
| Bob Dylan | The Bootleg Series Vol. 4: Bob Dylan Live 1966, The "Royal Albert Hall" Concert | pitchfork_perfect | 1998 | ours: Bob Dylan () |
| Brown Eyes | Two Things Needed for the Same Purpose and 5 Objects | mama_aoty | 2008 | ours: Two Things Needed for the Same Purpose and 5 Objets () |
| Jill Scott | The Real Thing: Words and Sounds Vol. 3 | grammy_rnb | 2008 | ours: The Real Thing: Words and Sounds, Volume 3 () |
| Jonghyun | Poet \| Artist | golden_disc_bonsang | 2018 | ours: Poet ᛁ Artist () |
| Kim Mok-in | 콜라보 씨의 일일 | kma_aoty | 2018 | ours: 콜라보 씨의 일일 () |
| LOONA | [&] | golden_disc_bonsang | 2021 | ours: [&] () |
| Pink | Missundaztood | grammy_pop_vocal | 2003 | ours: Can’t Take Me Home / Missundaztood () |
| Red Velvet | The Perfect Red Velvet | mama_aoty | 2018 | ours: The Red () |
| Taemin | Never Gonna Dance Again: Act 1 & Act 2 | rhythmer_rnb | 2020 | ours: Never Gonna Dance Again : Act 1 () |
| Wanna One | 1×1=1 (To Be One) | mama_aoty | 2017 | ours: 1x1=1 (TO BE ONE) () |
| 구텐버즈 | Things What May Happen In Your Planet | weiv_aoty | 2016 | ours: Things What May Happen on Your Planet () |
| 노래를 찾는 사람들 | 노래를 찾는 사람들 2집 | kr_masterpiece_100 | 1989 | ours: 노래를 찾는 사람들 1 () |
| 양희은 | 1991 | kr_masterpiece_100 | 1991 | ours: 양희은 1991 () |
| 銀杏BOYZ | BOYZ DOOR | jp_mino_100 | 2018 | ours: Door () |

#### present-mbid-mismatch — 23

_Fix route: list MBID differs from ours — relink external_scores to our MBID_

| Artist | Album | Lists | Year | Evidence |
|---|---|---|---|---|
| aespa | Savage | mama_aoty, golden_disc_bonsang | 2021 | ours: Savage (ep) |
| Lana Del Rey | Did You Know That There's a Tunnel Under Ocean Blvd | grammy_aoty, grammy_alternative | 2024 | ours: Did you know that there’s a tunnel under Ocean Blvd (album) |
| Michael Kiwanuka | Love & Hate | mercury_prize, brit_album | 2016/2017 | ours: Love & Hate (single) |
| U2 | All That You Can't Leave Behind | grammy_rock, grammy_aoty | 2002 | ours: All That You Can’t Leave Behind (album) |
| Big Bang | Made | mama_aoty | 2015 | ours: MADE (album) |
| David Guetta | One Love | grammy_dance_electronic | 2010 | ours: One Love (single) |
| Ezra Collective | Where I'm Meant to Be | mercury_prize | 2023 | ours: Where I’m Meant to Be (album) |
| f(x) | 4 Walls | weiv_aoty | 2015 | ours: 4 Walls (album) |
| George Ezra | Staying at Tamara's | brit_album | 2019 | ours: Staying at Tamara’s (album) |
| James Brown | Sex Machine | rs500 | 1970 | ours: Sex Machine (compilation) |
| Kylie Minogue | X | grammy_dance_electronic | 2009 | ours: X (album) |
| Lily Allen | It's Not Me, It's You | brit_album | 2010 | ours: It’s Not Me, It’s You (album) |
| Linkin Park | Hybrid Theory | grammy_rock | 2002 | ours: Hybrid Theory (20th anniversary edition) (compilation) |
| Madonna | Music | grammy_pop_vocal | 2001 | ours: Music (album) |
| MC5 | Kick Out the Jams | rs500 | 1969 | ours: Kick Out the Jams (single) |
| Mike Oldfield | Tubular Bells | brit_album | 1977 | ours: Tubular Bells (single) |
| Nas | King's Disease | grammy_rap | 2021 | ours: King’s Disease (album) |
| Nas | King's Disease II | grammy_rap | 2022 | ours: King’s Disease II (album) |
| Nick Cave and the Bad Seeds | Wild God | grammy_alternative | 2025 | ours: Wild God (single) |
| Paul Simon | You're the One | grammy_aoty | 2001 | ours: You’re the One (album) |
| Snow Patrol | Eyes Open | brit_album | 2007 | ours: Eyes Open (album) |
| Stan Getz & João Gilberto | Getz/Gilberto | grammy_aoty | 1965 | ours: Getz / Gilberto (album) |
| TVXQ | Catch Me | mama_aoty | 2012 | ours: Catch Me (album) |

#### present-unlinked — 32

_Fix route: link list row to our release group (backfill:external-mbids / title alias)_

| Artist | Album | Lists | Year | Evidence |
|---|---|---|---|---|
| Baek Yerin | Every Letter I Sent You. | kha_rnb, kma_aoty | 2020/2021 | ours: Every letter I sent you. (album) |
| Mary J. Blige | Good Morning Gorgeous (Deluxe) | grammy_rnb, grammy_aoty | 2023 | ours: Good Morning Gorgeous (single) |
| Palo Alto | Dirt | kha_hiphop, rhythmer_hiphop | 2022/2023 | ours: Dirt (album) |
| Baek Yerin | Our love is great | kma_aoty | 2020 | ours: Our love is great (ep) |
| Baek Yerin | Tellusboutyourself | kha_rnb | 2021 | ours: tellusboutyourself (album) |
| Big Bang | Alive | mama_aoty | 2012 | ours: ALIVE (album) |
| Chris Brown | 11:11 (Deluxe) | grammy_rnb | 2025 | ours: 11:11 (album) |
| DAUL, Noair, plan8 & CHANNEL 201 | Next | rhythmer_rnb | 2022 | ours: NEXT (compilation) |
| George Harrison & Friends | The Concert for Bangladesh | grammy_aoty | 1973 | ours: The Concert for Bangladesh (single) |
| Hwaji | EAT | kma_aoty | 2015 | ours: Eat (album) |
| Jeong Cha-sik | 격동하는 현재사 | kma_aoty | 2013 | ours: 격동하는 현재사 (album) |
| Khundi Panda | MODM: Original Saga | rhythmer_hiphop | 2021 | ours: Modm : Original Saga (album) |
| Lee Chan-hyeok | EROS | kma_aoty | 2026 | ours: EROS (album) |
| Lizzo | Cuz I Love You (Deluxe) | grammy_aoty | 2020 | ours: Cuz I Love You (album) |
| Lowdown30 | 1 | kma_aoty | 2013 | ours: 1 (album) |
| Pink | Funhouse | grammy_pop_vocal | 2010 | ours: Funhouse (album) |
| Pink | The Truth About Love | grammy_pop_vocal | 2013 | ours: The Truth About Love (album) |
| Pink | Beautiful Trauma | grammy_pop_vocal | 2019 | ours: Beautiful Trauma (album) |
| Ray Charles and Various Artists | Genius Loves Company | grammy_pop_vocal | 2005 | ours: Genius Loves Company (album) |
| Sheryl Crow | C'mon, C'mon | grammy_rock | 2003 | ours: C’mon, C’mon (album) |
| SHINee | Don't Call Me | golden_disc_bonsang | 2021 | ours: Don't Call Me - The 7th Album (album) |
| Stan Getz & Charlie Byrd | Jazz Samba | grammy_aoty | 1963 | ours: Jazz Samba (compilation) |
| Sunwoo JungA | Serenade | rhythmer_rnb | 2020 | ours: Serenade (album) |
| Swallow | Aresco | kma_aoty | 2007 | ours: Aresco (album) |
| TREASURE | The Second Step: Chapter One | golden_disc_bonsang | 2022 | ours: THE SECOND STEP : CHAPTER ONE (ep) |
| Yangpa | The Windows of My Soul | mama_aoty | 2007 | ours: The Windows of My Soul (album) |
| 김목인 | 콜라보 씨의 일일 | weiv_aoty | 2017 | ours: 콜라보 씨의 일일 (album) |
| 김정미 | Now | kr_masterpiece_100 | 1971 | ours: Now (album) |
| 마이앤트메리 | JUST POP | kr_masterpiece_100 | 2006 | ours: JUST POP (album) |
| 언니네이발관 | 비둘기는 하늘의 쥐 | kr_masterpiece_100 | 2011 | ours: 비둘기는 하늘의 쥐 (album) |
| 언니네이발관 | 후일담 | kr_masterpiece_100 | 2015 | ours: 후일담 (album) |
| 전인권 & 허성욱 | 1979-1987 추억 들국화 | kr_masterpiece_100 | 1988 | ours: 1979~1987 추억 들국화 (album) |

#### alias-gap — 1

_Fix route: artist present under another name — add alias_

| Artist | Album | Lists | Year | Evidence |
|---|---|---|---|---|
| Sviatoslav Richter | Brahms: Concerto | grammy_aoty | 1961 |  |


#### out-of-scope — 12

_Fix route: Various Artists / cast recordings — out of scope by design_

| Artist | Album | Lists | Year | Evidence |
|---|---|---|---|---|
| Various Artists | Waiting to Exhale | grammy_aoty | 1997 | Various Artists |
| Various Artists | Flashdance | grammy_aoty | 1984 | Various Artists |
| Various Artists | The Sound of Music | grammy_aoty | 1966 | Various Artists |
| Various Artists | The Indestructible Beat of Soweto | rs500 | 1985 | Various Artists |
| Various Artists | Jesus Christ Superstar | grammy_aoty | 1972 | Various Artists |
| Various Artists | O Brother, Where Art Thou? | grammy_aoty | 2002 | Various Artists |
| Various Artists | Help | mercury_prize | 1996 | Various Artists |
| Various Artists | Saturday Night Fever | grammy_aoty | 1979 | Various Artists |
| Various Artists | The Harder They Come | rs500 | 1972 | Various Artists |
| Various Artists | Grease | grammy_aoty | 1979 | Various Artists |
| Various Artists | Nuggets: Original Artyfacts From the First Psychedelic Era, 1965–1968 | rs500 | 1972 | Various Artists |
| Various Artists | Saturday Night Fever: The Original Movie Sound Track | rs500 | 1977 | Various Artists |


---

## 3. Charts — Apple Music most-played albums and Deezer

Apple Music most-played top 100 for US, GB, KR, JP, BR, MX, DE, FR, CA, AU, ES and IN, plus Deezer's
global album chart: **877 distinct albums**. Titles were verified against MusicBrainz; for owned artists,
the whole MB and Deezer discography was compared with loose, artist-scoped title matching.

#### artist-stub — 19

_Fix route: stub artist — ingest its discography_

| Artist | Album | Charts | Released | Evidence |
|---|---|---|---|---|
| EST Gee | BIGGER THAN THE DEVIL | apple-us#12 | 2026-09-11 | MB album: BIGGER THAN THE DEVIL |
| Steve Lacy | Oh yeah? | apple-us#31 apple-gb#99 apple-kr#88 | 2026-07-17 | MB album: Oh yeah? |
| Benj Pasek & Justin Paul, Hugh Jackman | The Greatest Showman (Original Motion Picture Soundtrack) [Sing-A-Long Edition] | apple-gb#30 apple-de#53 apple-au#35 | 2017-12-08 | MB single/soundtrack: The Greatest Show |
| Jungle | Sunshine | apple-gb#51 | 2026-08-14 | MB album: Sunshine |
| HANA | HANA | apple-jp#11 | 2026-02-23 | MB ep: HANA |
| Jão | Memórias Póstumas | apple-br#4 | 2026-07-26 | MB album: Memórias Póstumas |
| Urias | CARRANCA | apple-br#91 | 2025-10-07 | MB album: CARRANCA |
| Jão | PIRATA | apple-br#100 | 2021-10-20 | MB album: PIRATA |
| Aymen | GOLDJUNGE | apple-de#45 | 2026-09-18 | MB album: GOLDJUNGE |
| Europe | Come This Madness | apple-de#54 apple-es#61 | 2026-09-25 | MB single: Come This Madness |
| PLK | Grand Garçon | apple-fr#18 | 2026-03-13 | MB album: Grand Garçon |
| Grand Corps Malade | Voir la mer | apple-fr#19 | 2026-09-18 | MB album: Voir la mer |
| SDM | A LA VIE A LA MORT | apple-fr#22 | 2024-09-27 | MB album: A LA VIE A LA MORT |
| SDM | Liens du 100 | apple-fr#71 | 2022-12-09 | MB album: Liens du 100 |
| PLK | Enna Boost | apple-fr#79 | 2021-11-12 | MB album: Enna |
| Arjan Dhillon & MXRCI | Enigma | apple-in#26 | 2026-05-22 | MB album: Enigma |
| Arjan Dhillon | A for Arjan 2 | apple-in#69 | 2025-08-25 | MB album: A for Arjan 2 |
| Guigoo | Narkotek Soundsystem : 2004-2005 | deezer-global#35 |  | MB album/compilation: Narkotek Soundsystem: 2004-2005 Best-Of |
| Power Glove | Devil May Cry (Soundtrack from the Netflix Series) | deezer-global#52 |  | MB album/soundtrack: Devil May Cry (Soundtrack From the Netflix Series) |

#### album-on-mb-not-ingested — 34

_Fix route: owned artist; album is on MB — freshness re-poll / re-ingest artist_

| Artist | Album | Charts | Released | Evidence |
|---|---|---|---|---|
| Jhené Aiko | Westside Whimsy | apple-us#2 apple-gb#16 apple-fr#76 | 2026-09-11 | MB album: Westside Whimsy |
| Pooh Shiesty | All Eyes on Shiest | apple-us#13 | 2026-08-21 | MB album: All Eyes on Shiest |
| Yeat | COCOON | apple-us#23 apple-de#68 apple-ca#27 | 2026-09-18 | MB album: COCOON |
| Rio Da Yung Og | The World Is Yours | apple-us#70 | 2026-09-11 | MB album: The World Is Yours |
| Nipsey Hussle & Bino Rideaux | PROLIFIC | apple-us#99 | 2026-08-14 | MB album: PROLIFIC |
| Karan Aujla | AUJLA SZN 1 - EP | apple-gb#20 apple-ca#2 apple-au#3 | 2026-09-25 | MB ep: AUJLA SZN 1 |
| Sugababes | Sugababes | apple-gb#97 | 2027-02-12 | MB album: Sugababes |
| The Volunteers | i love u | apple-kr#7 | 2026-09-14 | MB album: i love u |
| wave to earth | bad pieces | apple-kr#16 | 2026-08-07 | MB album: bad pieces |
| KC, 식케이, 김하온 & JMIN | KC3 | apple-kr#64 | 2025-11-27 | MB album: KC3 |
| 권오선 | OFOSUN - EP | apple-kr#94 | 2022-09-01 | MB ep: OFOSUN |
| Number_i | REBON / BUGS LIFE / DIGITAL GIRL - EP | apple-jp#3 | 2026-09-23 | MB ep: REBON / BUGS LIFE / DIGITAL GIRL |
| My Hair is Bad | cats | apple-jp#5 | 2026-09-09 | MB album: cats |
| 藤井 風 | You (feat. UMI) - EP | apple-jp#14 | 2026-09-25 | MB ep: You (feat. UMI) – EP |
| coldrain | OPTIMIZE = OPTDEMISE | apple-jp#16 | 2026-09-25 | MB album: OPTIMIZE = OPTDEMISE |
| King & Prince | So Honey EP | apple-jp#19 | 2026-09-01 | MB ep: So Honey EP |
| あいみょん | AIMYON BEST ALBUM - 唇を追え! - | apple-jp#20 | 2026-09-09 | MB album/compilation: AIMYON BEST ALBUM - 唇を追え！ - |
| ポルノグラフィティ | 果実 | apple-jp#44 | 2026-09-09 | MB album: 果実 |
| &TEAM | Mark on Me - EP | apple-jp#52 | 2026-09-08 | MB ep: Mark on Me |
| milet | Made of Glass | apple-jp#95 | 2026-08-19 | MB album: Made of Glass |
| Adriana Calcanhotto & Arnaldo Antunes | Vice-Versa | apple-br#34 | 2026-09-22 | MB album: Vice-versa |
| U2 | Carnaval De Luz | apple-br#77 apple-es#41 | 2026-11-13 | MB album: Carnaval De Luz |
| Camilo | Para Cuando Sean Mayores | apple-mx#61 apple-es#13 deezer-global#4 | 2026-09-09 | MB album: Para cuando sean mayores |
| Yuyu19 | H***** | apple-de#6 | 2026-09-25 | MB album: H***** |
| Jazeek & Luciano | STARBOYZ | apple-de#13 | 2026-09-10 | MB album: STARBOYZ |
| Agnes Obel | The Meaning of Flowers | apple-de#69 | 2026-09-18 | MB album: The Meaning of Flowers |
| Djadja & Dinaz | Matière Noire | apple-fr#3 | 2026-09-16 | MB album: Matière Noire |
| Ziak | MONSIEUR LOYAL | apple-fr#5 | 2026-09-25 | MB album: MONSIEUR LOYAL |
| Soso Maness | Rescapé (L'épilogue) | apple-fr#12 | 2026-09-25 | MB album: Rescapé (L'épilogue) |
| Scylla & Furax Barbarossa | Jungle Noire | apple-fr#35 | 2026-09-25 | MB album: Jungle Noire |
| Amrinder Gill | Hazir | apple-ca#13 apple-au#68 apple-in#12 | 2026-09-21 | MB album: Hazir |
| Diljit Dosanjh | I'm an Artist Bro | apple-ca#79 apple-in#22 | 2026-09-04 | MB album: I'm an Artist Bro |
| Gonzy | FROM MIAMI, WITH LUV | apple-es#95 | 2026-07-16 | MB album: FROM MIAMI, WITH LUV |
| Garvit - Priyansh, Raghav Kaushik, Neel Adhikari & Aniket Shukla | Musafir Cafe (Songs from the Netflix Series) - EP | apple-in#15 | 2026-07-21 | MB album/soundtrack: Musafir Cafe: Songs From the Netflix Series |

#### artist-incomplete — 6

_Fix route: owned artist; album on MB not in DB — re-ingest_

| Artist | Album | Charts | Released | Evidence |
|---|---|---|---|---|
| 도경수 | DOPAMINE - The 4th Mini Album - EP | apple-kr#24 | 2026-09-08 | MB ep: DOPAMINE |
| Peter Plate, Bibi und Tina & Ulf Leo Sommer | Bibi und Tina (Der Original-Soundtrack zum Kinofilm) | apple-de#84 | 2014-02-28 | MB single: Original |
| Mauvais Djo | L'undertaker, Pt.2 (Deluxe) | apple-fr#6 | 2026-09-04 | MB album: L'undertaker |
| Vishnu Vijay, Vinayak Sasikumar & Suhail Koya | Bethlehem Kudumba Unit (Original Motion Picture Soundtrack) | apple-in#28 | 2026-08-27 | MB album/soundtrack: Bethlehem Kudumba Unit |
| Sai Abhyankkar | Karuppu - Side B (God Mode Begins) [Original Score] | apple-in#32 | 2026-08-06 | MB /compilation: Karuppu |
| G.V. Prakash Kumar & Shiva Nirvana | Irumudi (Original Motion Picture Soundtrack) - Telugu | apple-in#34 | 2026-08-20 | MB /soundtrack: Irumudi |

#### artist-missing-on-mb — 111

_Fix route: artist on MB but not queued — queue by MBID_

| Artist | Album | Charts | Released | Evidence |
|---|---|---|---|---|
| DDG | HIT-A-THON | apple-us#4 apple-ca#65 | 2026-09-25 | MB album: HIT-A-THON |
| ADÉLA | PRIMA | apple-us#15 apple-gb#8 apple-kr#35 | 2026-09-04 | MB album: PRIMA |
| Hunxho | I Quit Rap | apple-us#18 | 2026-09-18 | MB album: I Quit Rap |
| AZ Chike | No Rest for The Wicked | apple-us#24 | 2026-09-18 | MB album: No Rest for The Wicked |
| KPop Demon Hunters Cast, HUNTR/X & Saja Boys | KPop Demon Hunters (Soundtrack from the Netflix Film) | apple-us#25 apple-gb#13 apple-kr#77 | 2025-06-20 |  |
| Ms. Rachel | I'm So Happy | apple-us#35 apple-gb#65 apple-ca#41 | 2026-09-25 | MB album: I'm So Happy |
| Fatt Smaxk | Smaxk Season 3: Banks House | apple-us#36 | 2026-08-20 |  |
| Dylan Gossett | Ramblin' | apple-us#63 apple-gb#57 apple-ca#44 | 2026-09-25 | MB : Ramblin’ |
| Fetty P Franklin & Bandplay | THE FRANK PLAY | apple-us#79 | 2026-09-18 | MB album: THE FRANK PLAY |
| Gavin Adcock | The Day I Hang It Up | apple-us#96 apple-ca#93 | 2026-10-02 | MB album: The Day I Hang It Up |
| Keo | Put A Smile On For Me | apple-gb#4 | 2026-09-25 | MB album: Put a Smile on for Me |
| Marnz Malone | I Wish I Could Sing | apple-gb#10 | 2026-09-25 | MB album: I Wish I Could Sing |
| SIX, Toby Marlow & Lucy Moss | Six: The Musical (Studio Cast Recording) | apple-gb#75 | 2018-08-31 |  |
| PRESIDENT | Blood Of Your Empire | apple-gb#92 | 2026-09-04 | MB album: Blood of Your Empire |
| DIMO REX | METAMORPHOSIS | apple-kr#66 | 2026-09-04 |  |
| 3House | GAME - EP | apple-jp#67 | 2026-09-16 |  |
| Masato Hayashi | Iconic | apple-jp#71 | 2026-09-02 |  |
| GADORO | mile | apple-jp#72 | 2026-06-17 |  |
| EVISBEATS, Nagipan | Beauty | apple-jp#97 | 2026-09-25 |  |
| Akira Senju/Tatsuhiko Saiki/Shu Kanematsu | TBS系 日曜劇場「VIVANT」ORIGINAL SOUNDTRACK | apple-jp#98 | 2023-09-06 |  |
| Rick & Renner & Continental | Acústico - 10 Anos de Sucesso (Deluxe) | apple-br#17 | 2004-11-08 |  |
| Natanzinho Lima | Na Favela - Ao Vivo no Complexo do Alemão/RJ (Ao Vivo) | apple-br#35 | 2026-09-10 |  |
| PRISCILLA | ECO | apple-br#40 | 2026-08-13 |  |
| Sandy e Junior | Nossa História (Ao Vivo) | apple-br#53 | 2020-07-17 | MB album/live: Nossa história (ao vivo) |
| Frei Gilson | Frei Gilson 360° (Ao Vivo) [feat. Som do Monte] | apple-br#59 | 2024-12-12 |  |
| Jae Stephens | AUDACITY | apple-br#62 | 2026-09-25 | MB album: AUDACITY |
| Rick & Renner | Rick e Renner e Você - Ao Vivo | apple-br#63 | 2005-09-13 |  |
| Joyce Alane | Me Dá Uma Luz - EP | apple-br#75 | 2026-09-24 |  |
| Omar Camacho | Nunca Voy a Morir | apple-mx#13 | 2026-05-28 |  |
| José Madero | Querido… | apple-mx#15 | 2026-09-04 | MB album: Querido… |
| Jorsshh | Ay Weyy | apple-mx#54 | 2026-07-25 |  |
| Hermanos Espinoza | LINAJE | apple-mx#63 | 2026-03-20 |  |
| DANNA | WET DREAMS | apple-mx#80 | 2026-08-28 | MB album: WET DREAMS |
| Herencia De Grandes | Noches Sin Fin | apple-mx#95 | 2025-11-07 | MB album: Noches Sin Fin |
| Ramzey | Die ewigen Jagdgründe | apple-de#11 | 2026-09-25 |  |
| Reinhard Mey | Schatzhauser | apple-de#12 | 2026-09-25 |  |
| Kärbholz | Sturm zieh auf | apple-de#39 | 2026-09-25 |  |
| Betontod | Wir fangen jetzt erst an | apple-de#41 | 2026-09-25 | MB album: Wir fangen jetzt erst an |
| Lichterkinder | Schlaflieder | apple-de#44 | 2021-01-29 | MB album: Schlaflieder |
| Kinder Lieder | Die 30 schönsten Kinderlieder - Teil 1 | apple-de#65 | 2013-03-22 |  |
| Simone Sommerland, Karsten Glück & Die Kita-Frösche | Die 30 besten Spiel- und Bewegungslieder | apple-de#82 | 2010-08-25 | MB album: Die 30 besten Spiel- und Bewegungslieder |
| Farin Urlaub | Ein Lächeln im Gesicht | apple-de#83 | 2026-09-04 | MB album: Ein Lächeln im Gesicht |
| Lichterkinder | Laternen - und Herbstlieder | apple-de#87 | 2016-09-16 |  |
| Torsten Sträter | Mach mal das große Licht an (Bonus: Butter und Balkone) | apple-de#88 | 2026-09-25 |  |
| Lagui | En Croix | apple-fr#8 | 2026-07-23 | MB album: En Croix |
| Nouvelle École | Nouvelle École \| Saison 5 \| L'album Intégral (Série Netflix) | apple-fr#14 | 2026-09-18 |  |
| Luther | shelf | apple-fr#17 | 2026-09-18 | MB album: Shelf |
| ANS | MOSSEBA | apple-fr#24 | 2026-09-20 | MB album: MOSSEBA |
| Tiitof | Yung Drug Dealers 3 | apple-fr#29 | 2026-09-25 |  |
| La superstar des comptines rondes et berceuses | Comptines et chansons pour enfants | apple-fr#38 | 2014-11-07 |  |
| Pierre de Maere | Ave de Maere | apple-fr#45 | 2026-09-25 | MB album: Ave de Maere |
| Lagui | En attendant En Croix | apple-fr#61 | 2026-02-05 | MB ep: En attendant En Croix |
| David Okit | Sorry, j'étais perdu | apple-fr#62 | 2026-09-25 | MB album: Sorry, j'étais perdu |
| Brulux | Le Nine | apple-fr#65 | 2026-08-03 |  |
| Mous-K | Insolent | apple-fr#67 | 2026-05-15 | MB album: Insolent |
| Timar | REQUIEM : MIEUX QU'HIER | apple-fr#74 | 2026-04-03 | MB album: REQUIEM : MIEUX QU'HIER |
| TeddyBear | Le Plus Beau | apple-fr#86 | 2026-10-30 | MB album: Le Plus Beau |
| Bruit Blanc & Bruit Blanc Calme | Bruit Blanc | apple-fr#94 | 2022-04-05 |  |
| Himmat Sandhu | Show Stopper | apple-ca#20 apple-au#90 apple-in#18 | 2026-09-23 |  |
| Jxggi | Inferno | apple-ca#40 apple-in#17 | 2026-08-20 | MB album: Inferno |
| Cody Johnson | Banks Of The Trinity | apple-ca#49 | 2026-06-26 | MB album: Banks of the Trinity |
| Blake Whiten | Something To Say | apple-ca#75 | 2026-07-03 | MB album: Something to Say |
| Warren Zeiders | No Brakes | apple-ca#88 | 2026-09-25 |  |
| Wendy's | Songs to Listen to in a Wendy’s Parking Lot - EP | apple-ca#89 | 2026-09-23 | MB ep: Songs to Listen to in a Wendy’s Parking Lot |
| Hebe Tien | The Land of Maybe | apple-au#61 | 2026-09-24 |  |
| Thiago Navarro Music | Bonito, Bonito - EP | apple-es#44 | 2026-08-03 | MB single: Bonito, Bonito |
| Robe | Se nos lleva el aire | apple-es#81 | 2023-12-15 | MB album: Se nos lleva el aire |
| mvrk | PÓRTATE BIEN! | apple-es#97 | 2025-05-30 | MB album: PÓRTATE BIEN! |
| CantaJuego | CantaJuego, Vol. 1 | apple-es#100 | 2014-03-17 |  |
| Shreyas Dharmadhikari, Sadhu Tiwari, Dhirendra Mulkalwar, Rishi Pathak, Suneel Lodhi, Shantanu Sudame, Guru Goraksh Nath, Sant Kavi Samarth Ramdas & Vishal Chaturvedi | Hanuman Ansh (Original Motion Picture Soundtrack) | apple-in#3 | 2026-07-11 |  |
| Jordan Sandhu | God’s Favorite | apple-in#25 | 2026-07-12 | MB album: God’s Favorite |
| Parmish Verma | Victory Lap | apple-in#27 | 2026-07-15 | MB album: Victory Lap |
| Dulla | Apollo | apple-in#40 | 2026-08-29 |  |
| Shree Brar | Khalnayak - EP | apple-in#59 | 2026-09-10 |  |
| Hustinder | Untamed | apple-in#68 | 2026-08-05 | MB album: Untamed |
| Saabi Bhinder | Built Different - EP | apple-in#76 | 2026-08-07 |  |
| Wendy's | Songs to Listen to in a Wendy’s Parking Lot | deezer-global#1 |  | MB ep: Songs to Listen to in a Wendy’s Parking Lot |
| Kiki Rockwell | Plagued By Visions | deezer-global#3 |  | MB album: Plagued By Visions |
| Cartel | Learning How to Cope | deezer-global#5 |  | MB album: Learning How to Cope |
| Аукцыон | Птица | deezer-global#8 |  | MB album: Птица |
| Yüth Forever | 10 Code | deezer-global#17 |  | MB album: 10 Code |
| Like Moths To Flames | Does Heaven Ever Mourn For Me | deezer-global#18 |  | MB ep: Does Heaven Ever Mourn for Me |
| One Step Closer | All You Embrace | deezer-global#30 |  | MB album: All You Embrace |
| A Lot Like Birds | Plan B | deezer-global#31 |  | MB album: Plan B |
| Cowgirl Clue | Total Freedom | deezer-global#34 |  | MB album: Total Freedom |
| Skeletal Throne | Barbaric Torment | deezer-global#40 |  |  |
| Theophobia | Theophobia | deezer-global#41 |  |  |
| Carlyto Lassa | Bileyi ya Bana | deezer-global#44 |  |  |
| Borislav Slavov | Baldur's Gate 3 (Original Game Soundtrack) | deezer-global#46 |  | MB album/soundtrack: Baldur’s Gate 3: Original Game Soundtrack |
| Venator | Psychodrome | deezer-global#49 |  | MB album: Psychodrome |
| Moonlit Sailor | A Footprint Of Feelings | deezer-global#50 |  | MB album: A Footprint of Feelings |
| DOWN | Over The Under (2026 Remaster) | deezer-global#53 |  |  |
| ĠENN | unum | deezer-global#54 |  | MB album: Unum |
| Fetty P Franklin | THE FRANK PLAY | deezer-global#56 |  | MB album: THE FRANK PLAY |
| Into the Moat | The Design | deezer-global#62 |  | MB album: The Design |
| Ani DiFranco | Living In Clip | deezer-global#64 |  | MB album/live: Living in Clip |
| Victims of Contagion | Lamentations of the Flesh Bound | deezer-global#66 |  |  |
| Mercyful Fate | Don't Break the Oath | deezer-global#67 |  | MB album: Don’t Break the Oath |
| SOFY | How To Perform Magic | deezer-global#68 |  | MB album: How to Perform Magic |
| Crying | Beyond the Fleeting Gales | deezer-global#69 |  | MB album: Beyond the Fleeting Gales |
| Witty Tarbox | Origins of Schmitty | deezer-global#70 |  |  |
| VILLANELLE | Measly Means | deezer-global#71 |  | MB single: Measly Means |
| Pelada | Ep1 | deezer-global#74 |  |  |
| The Claypool Lennon Delirium | South of Reality | deezer-global#80 |  | MB album: South of Reality |
| Citizen | As You Please | deezer-global#81 |  | MB album: As You Please |
| thrown | UNWANTED | deezer-global#82 |  | MB album: unwanted |
| Rapman | Supacell (Soundtrack from the Netflix Series) | deezer-global#84 |  |  |
| Moonlit Sailor | So Close To Life | deezer-global#85 |  | MB album: So Close to Life |
| Lifeformed | Tunic (Original Game Soundtrack) | deezer-global#90 |  |  |
| Autumn Orange | Sad Wizard Vibes II | deezer-global#93 |  |  |
| Capcom Sound Team | PRAGMATA - The Bounded Soundtrack | deezer-global#95 |  | MB ep: PRAGMATA - The Bounded Soundtrack |

#### artist-missing-queued — 1

_Fix route: queued already — throughput_

| Artist | Album | Charts | Released | Evidence |
|---|---|---|---|---|
| Chuyin | Los Locos Nunca Mueren | apple-mx#19 | 2026-05-07 | MB : Los locos nunca mueren |

#### alias-gap — 9

_Fix route: present under another name — add native-script alias_

| Artist | Album | Charts | Released | Evidence |
|---|---|---|---|---|
| 양홍원 | 오보에 | apple-kr#2 | 2021-06-19 | ours: YANGHONGWON |
| 씨잼 | 킁 | apple-kr#10 | 2019-05-16 | ours: C Jamm |
| 로제 | rosie | apple-kr#17 | 2024-12-06 | ours: ROSÉ |
| 양홍원 | SLOWMO | apple-kr#36 | 2024-05-24 | ours: YANGHONGWON |
| 양홍원 | Stranger | apple-kr#43 | 2019-02-16 | ours: YANGHONGWON |
| 양홍원 & HW MUSIC | HW MUSIC | apple-kr#55 | 2026-06-21 | ours: YANGHONGWON |
| KUKO | CATHARSIS | apple-de#10 | 2026-09-25 | ours: Tokio Hotel |
| Cruzzi | Me Muevo Con Dios | apple-es#62 | 2023-05-25 | ours: Cruz Cafuné |
| S.S. Thaman | They Call Him OG (Original Motion Picture Soundtrack) | apple-in#66 | 2025-09-24 | ours: Thaman S |

#### album-not-on-mb — 65

_Fix route: album not matched on MB (mostly editions, soundtracks, very recent) — iTunes recency lane_

| Artist | Album | Charts | Released | Evidence |
|---|---|---|---|---|
| Los Gemelos De Sinaloa | The Gemeliza | apple-us#20 apple-mx#33 | 2026-09-24 | ours Los Gemelos de Sinaloa [tracks_done] |
| Seyi Vibez | SWAGUU | apple-us#39 apple-gb#14 apple-ca#35 | 2026-09-17 | ours Seyi Vibez [tracks_done] |
| Tank | EXPERIENCE | apple-us#62 | 2026-09-25 | ours Tank [tracks_done] |
| Ed Sheeran | ÷ (Deluxe) | apple-gb#44 apple-de#78 apple-au#24 | 2017-03-03 | ours Ed Sheeran [tracks_done] |
| Kristen Anderson-Lopez & Robert Lopez, Idina Menzel, Kristen Bell & Christophe Beck | Frozen (Original Motion Picture Soundtrack) | apple-gb#55 apple-au#43 | 2013-11-25 | ours Idina Menzel [tracks_done] |
| Young Jonn | Dear London | apple-gb#61 | 2026-09-25 | ours Young Jonn [resolved] |
| Benny Andersson, Björn Ulvaeus, Meryl Streep & Amanda Seyfried | Mamma Mia! (The Movie Soundtrack feat. the Songs of ABBA) [Bonus Track Version] | apple-gb#91 | 2008-07-07 | ours Meryl Streep [tracks_done] |
| 반타01 & MPT | 아름8 | apple-kr#8 | 2026-06-18 | ours MPT [tracks_done] |
| 소연 | 끝내주는 인생 | apple-kr#19 | 2026-09-07 | ours 소연 [tracks_done] |
| Unofficialboyy | 새천년 | apple-kr#27 | 2026-09-19 | ours unofficialboyy [tracks_done] |
| Fleeky Bang | ANTI | apple-kr#48 | 2026-09-22 | ours Fleeky Bang [tracks_done] |
| SYSTEM SEOUL | SS-POP | apple-kr#54 | 2025-05-16 | ours SYSTEM SEOUL [tracks_done] |
| NO:EL | TRIPONOEL | apple-kr#67 | 2023-07-26 | ours 노을 [tracks_done] |
| 김민석 & 웬디 | 이 사랑 통역 되나요? (Soundtrack from the Netflix Series) | apple-kr#91 | 2026-01-16 | ours 김민석 [tracks_done] |
| RADWIMPS | Your Name. | apple-kr#92 | 2016-08-24 | ours RADWIMPS [tracks_done] |
| 백예린 | 선물 - EP | apple-kr#96 | 2021-09-10 | ours 백예린 [tracks_done] |
| M!LK | LOVE ENG!NE | apple-jp#1 | 2026-09-16 | ours M!LK [tracks_done] |
| Snow Man | AMENITY | apple-jp#2 | 2026-08-24 | ours Snow Man [tracks_done] |
| BE:FIRST | WATCH ME - EP | apple-jp#4 | 2026-09-18 | ours BE:FIRST [tracks_done] |
| MIKADO | FAME FLAME | apple-jp#21 | 2026-08-26 | ours MIKADO [resolved] |
| マカロニえんぴつ | 運命さがし EP | apple-jp#26 | 2026-09-16 | ours マカロニえんぴつ [tracks_done] |
| INI | ANTHEM - EP | apple-jp#35 | 2026-09-14 | ours INI [tracks_done] |
| 福山 雅治 | 超新星 | apple-jp#36 | 2026-09-09 | ours 福山雅治 [tracks_done] |
| Mrs. GREEN APPLE | POPS | apple-jp#45 | 2026-09-30 | ours Mrs. GREEN APPLE [tracks_done] |
| timelesz | MOMENTUM | apple-jp#57 | 2026-04-29 | ours timelesz [tracks_done] |
| SixTONES | スト夏の思い出2026 - EP | apple-jp#99 | 2026-08-19 | ours SixTONES [tracks_done] |
| Flora Matos | FLOWRA FM - DISCO VOADOR 4 | apple-br#9 | 2026-09-25 | ours Flora Matos [tracks_done] |
| Gustavo Mioto | PENSAMENTOS INTRUSIVOS | apple-br#27 | 2026-09-03 | ours Gustavo Mioto [tracks_done] |
| Péricles | Camuflagem | apple-br#58 | 2026-09-24 | ours Péricles [tracks_done] |
| Pablo | Pablo 20 ANOS, Pt. 1 (Ao Vivo) | apple-br#76 | 2023-11-17 | ours PABLO [resolved] |
| Tito Double P | ACOMODO | apple-mx#25 | 2026-05-28 | ours Tito Double P [tracks_done] |
| Calle 24 | ETERNO | apple-mx#28 | 2026-04-09 | ours Calle 24 [tracks_done] |
| EMJAY | Pop Pesado | apple-mx#32 | 2026-09-24 | ours EMJAY [tracks_done] |
| Neton Vega | DELIRIUM | apple-mx#47 | 2025-11-13 | ours Neton Vega [tracks_done] |
| Mentiras: La Serie, Luis Gerardo Méndez, Belinda & Mariana Treviño | Mentiras: La Serie | apple-mx#48 | 2025-06-04 | ours Belinda [tracks_done] |
| FANTA ROSARIO | LA AMENAZA | apple-mx#49 apple-es#6 | 2026-09-24 | ours FANTA ROSARIO [resolved] |
| Rels B | fill de la mar (2026) | apple-mx#52 apple-es#19 | 2026-09-15 | ours Rels B [tracks_done] |
| La Santa Grifa | Mundo Retorcido | apple-mx#53 | 2026-09-19 | ours La Santa Grifa [tracks_done] |
| Oscar Maydon | DISTORSIÓN | apple-mx#83 | 2023-12-22 | ours Óscar Maydon [tracks_done] |
| CIVO | Ich muss dir noch was sagen | apple-de#25 | 2026-09-25 | ours CIVO [resolved] |
| Wolfgang Petry | Ein Leben lang | apple-de#31 | 2026-09-25 | ours Wolfgang Petry [tracks_done] |
| Summer Cem | DUMAN | apple-de#34 | 2026-09-25 | ours Summer Cem [tracks_done] |
| Till Lindemann | Live In Krakow | apple-de#35 | 2026-09-25 | ours Till Lindemann [tracks_done] |
| Tiakola | WpointM | apple-de#47 apple-fr#1 apple-ca#6 | 2026-09-24 | ours Tiakola [tracks_done] |
| Matthias Reim | Flashback | apple-de#66 | 2026-09-18 | ours Matthias Reim [tracks_done] |
| Teuterekordz & Sechser | Eins Sechser Eins | apple-de#95 | 2026-09-25 | ours Teuterekordz [tracks_done] |
| LOKIMITDERMASKE & Doktormethoden & Doktormithoden | DOKTOR MIT DER MASKE | apple-de#98 | 2026-09-18 | ours LOKIMITDERMASKE [resolved] |
| Tiakola | WpointM - 93120 - EP | apple-fr#2 apple-ca#23 | 2026-09-24 | ours Tiakola [tracks_done] |
| TRIANGLE DES BERMUDES | 404 (feat. Kokosvoice, MC YOSHI & Mauvais Djo) | apple-fr#10 | 2026-04-03 | ours TRIANGLE DES BERMUDES [tracks_done] |
| Fally Ipupa | XX : Délirium | apple-fr#41 | 2026-09-18 | ours Fally Ipupa [resolved] |
| SDM | OCHO (Deluxe) | apple-fr#55 | 2021-12-10 | ours Stare Dobre Małżeństwo [tracks_done] |
| Nijjar | Autobiography | apple-ca#15 apple-in#9 | 2026-09-18 | ours Nijjar [resolved] |
| Max McNown | Leave On A Light | apple-ca#85 | 2026-09-25 | ours Max McNown [resolved] |
| Pablo López | El Cuatro | apple-es#14 | 2026-09-17 | ours Pablo López [tracks_done] |
| Shakira | Fijación Oral Volumen 1 (Expanded Edition) | apple-es#55 | 2005-06-03 | ours Shakira [tracks_done] |
| Anand Bhaskar, Parry G, Junaid Kumar, Ray, Dhanda Nyoliwala, Ginny Diwan, Kumaar, Nusrat Fateh Ali Khan & Tejpal | Mirzapur The Movie (Original Motion Picture Soundtrack) | apple-in#7 | 2026-08-31 | ours Nusrat Fateh Ali Khan [tracks_done] |
| Pardeep Sran | BrotherHood | apple-in#16 | 2026-09-17 | ours Pardeep Sran [tracks_done] |
| Arjan Dhillon | Patander | apple-in#58 | 2024-11-10 | ours Arjan Dhillon [resolved] |
| Jakes Bejoy, Rafeeq Ahamed, Jabir Sulaim, Joker390P, Muri & Muthu | Khalifa (Original Motion Picture Soundtrack) | apple-in#70 | 2026-08-12 | ours Jakes Bejoy [tracks_done] |
| Raga | NO FORMULA | apple-in#87 | 2026-09-11 | ours Raga [resolved] |
| Chani Nattan, Inderpal Moga & Byg Byrd | REAL PROBLEMS - EP | apple-in#90 | 2026-09-25 | ours Chani Nattan [tracks_done] |
| Mouse On The Keys | Portrait of Impulse | deezer-global#19 |  | ours Mouse on the Keys [resolved] |
| Barbra Streisand | Funny Girl - Original Soundtrack Recording | deezer-global#37 |  | ours Barbra Streisand [tracks_done] |
| Motörhead | March Or Die | deezer-global#57 |  | ours Motörhead [tracks_done] |
| Paul Williams | Bugsy Malone (From "Bugsy Malone" Original Motion Picture Soundtrack) | deezer-global#96 |  | ours Paul Williams [resolved] |

#### artist-missing-not-on-mb — 32

_Fix route: not on MB — Deezer/iTunes seed or out of scope_

| Artist | Album | Charts | Released | Evidence |
|---|---|---|---|---|
| 리도어 | Memory - EP | apple-kr#13 | 2026-09-16 |  |
| 재지팩트 | Lifes Like | apple-kr#60 | 2010-10-26 |  |
| 플로우뮤직 | 지브리 OST 피아노 | apple-kr#68 | 2025-06-18 |  |
| 고스트클럽 | Boogie Nights | apple-kr#89 | 2025-12-23 |  |
| 超かぐや姫! | 超かぐや姫! | apple-jp#10 | 2026-01-23 |  |
| COFFEE MUSIC MODE | 昼カフェ音楽・BGM・ピアノとギターの癒し&リラックスカフェミュージック | apple-jp#77 | 2020-07-25 |  |
| エド・シーラン | ÷ (Deluxe) | apple-jp#87 | 2017-03-03 |  |
| Eximo Blue | レストランで流れるおしゃれなジャズBGM | apple-jp#89 | 2019-12-23 |  |
| Som De Chuva e Trovoadas | Chuva e Trovoadas | apple-br#10 | 2019-11-19 |  |
| Barulho De Chuva | Dormir: Barulho de Chuva | apple-br#15 | 2019-03-24 |  |
| Chuva Para Dormir | Sons de Chuva Para Dormir | apple-br#19 | 2019-11-19 |  |
| Ivy Skye | Euphoria | apple-br#29 | 2026-08-13 |  |
| Música Infantil TV | Música para Dormir Bebés - Sonidos de la Naturaleza | apple-mx#51 apple-es#24 | 2020-09-21 |  |
| Varios Artistas | LA OBSESIÓN, VOL. 1 | apple-mx#57 | 2025-10-16 |  |
| Jimmy Guzman | Intuición | apple-mx#59 | 2026-06-25 |  |
| Linda Beldad | Música para Dormir Profundamente: Duermes Bien con Sonidos Relajantes de la Naturaleza | apple-mx#64 apple-es#29 | 2015-05-18 |  |
| Tombochio | STAR | apple-mx#67 | 2026-04-30 |  |
| Verschiedene Interpreten | Die 30 besten Schlaflieder für Kinder | apple-de#15 | 2012-11-05 |  |
| Torsten Abrolat & Regen Macher | Regen - Regengeräusche | apple-de#18 | 2017-03-03 |  |
| Verschiedene Interpret:innen | Die 30 besten Herbstlieder für Kinder | apple-de#22 | 2015-08-28 |  |
| Schlaflieder für Kinder | Sanfte Schlafmusik für Kinder: Beruhigende Melodien für eine gute Nacht | apple-de#43 | 2024-07-15 |  |
| Lorbeer Regenwald | Entspannungsmusik für Kinder | apple-de#71 | 2016-05-25 |  |
| Verschiedene Interpret:innen | Italo Hits: Best of Italia | apple-de#72 | 2023-05-05 |  |
| Verschiedene Interpret:innen | Die Eiskönigin völlig unverfroren (Deluxe Edition) | apple-de#92 | 2013-01-01 |  |
| Verschiedene Interpret:innen | Vaiana (Deutscher Original Film-Soundtrack) [Deluxe Edition] | apple-de#94 | 2016-12-16 | MB album/soundtrack: Vaiana (Deutscher Original Film‐Soundtrack) [Deluxe Edition] |
| Ananda Calma | Relajante - Calmar Estres Ansiedad y Dolor de Cabeza | apple-es#46 | 2017-02-22 |  |
| Puño Dragon | A PALOS | apple-es#76 | 2026-09-25 |  |
| Técnicas de Meditación Academia & Academia de Música de la Música Ambiente | 50 Canciones de curación para la meditación y la relajación: Música serenidad para el yoga, Spa, Masajes y dormir, Música relajante zen | apple-es#82 | 2016-03-25 |  |
| Varios Artistas | Grand Theft Auto VI: The Album | apple-es#94 | 2026-11-19 | MB album/soundtrack: Grand Theft Auto VI: The Album |
| Rad Pinckard | Best Day Ever | deezer-global#48 |  |  |
| Mary Dudley Berry | Anthropocene, Vol. 1 | deezer-global#76 |  |  |
| Helli Kale | Riverse | deezer-global#87 |  |  |

#### filtered — 13

_Fix route: policy (live / other type)_

| Artist | Album | Charts | Released | Evidence |
|---|---|---|---|---|
| Taylor Swift | The Life of a Showgirl | apple-us#1 apple-gb#1 apple-kr#3 | 2025-10-03 | MB other: The Life of a Showgirl |
| LINKIN PARK | Unshatter Film Soundtrack (Live in São Paulo) | apple-gb#23 apple-jp#84 apple-br#13 | 2026-09-25 | MB album/live+soundtrack: Unshatter Film Soundtrack (Live in São Paulo) |
| 뉴진스 | How Sweet - EP | apple-kr#78 | 2024-05-24 | MB other: How Sweet |
| Vaundy | Vaundy DOME TOUR 2026 "SILENCE" LIVE SELECTION from TOKYO DOME | apple-kr#81 apple-jp#7 | 2026-09-04 | MB album/live: Vaundy DOME TOUR 2026 "SILENCE" LIVE SELECTION from TOKYO DOME |
| テイラー・スウィフト | The Life of a Showgirl | apple-jp#12 | 2025-10-03 | MB other: The Life of a Showgirl |
| Zé Neto & Cristiano | Vocês & Deus (Ao Vivo no Rio de Janeiro) | apple-br#18 | 2026-09-03 | MB album/live: Vocês & Deus, Vol. 1 (Ao Vivo no Rio de Janeiro) |
| Henrique & Juliano | Manifesto Musical 2 (Ao Vivo) | apple-br#26 | 2025-06-27 | MB album/live: Manifesto Musical 2 (Ao Vivo) |
| Grupo Menos É Mais | Churrasquinho 4 (Ao Vivo) | apple-br#45 | 2025-12-11 | MB album/live: Churrasquinho 4 (Ao Vivo) |
| Marília Mendonça | Marília Mendonça (Ao Vivo) | apple-br#46 | 2016-03-04 | MB album/live: Ao vivo |
| Grupo Menos É Mais | MOLHO (Ao Vivo) | apple-br#65 | 2026-06-18 | MB album/live: MOLHO (Ao Vivo) |
| Lady Gaga | Apple Music Live: MAYHEM Requiem | apple-br#82 | 2026-05-14 | MB album/live: Apple Music Live: MAYHEM Requiem |
| Zoé | MTV Unplugged: Música de Fondo | apple-mx#75 | 2011-03-22 | MB album/live: MTV Unplugged: Música de fondo |
| Hannah Montana | Hannah Montana/Miley Cyrus: Best of Both Worlds Concert | deezer-global#94 |  | MB album/live: Best of Both Worlds Concert |

#### present-title-drift — 63

_Fix route: held under another title_

| Artist | Album | Charts | Released | Evidence |
|---|---|---|---|---|
| Noah Kahan | The Great Divide: The Last Of The Bugs | apple-us#9 apple-gb#5 apple-de#46 | 2026-04-25 | ours Noah Kahan [tracks_done] |
| Taylor Swift | THE TORTURED POETS DEPARTMENT: THE ANTHOLOGY | apple-us#37 apple-gb#33 apple-br#23 | 2024-04-19 | ours Taylor Swift [tracks_done] |
| Lin-Manuel Miranda, Leslie Odom, Jr., Phillipa Soo, Daveed Diggs & Christopher Jackson | Hamilton: An American Musical (Original Broadway Cast Recording) | apple-us#44 apple-gb#32 apple-ca#98 | 2015-09-25 | ours Lin‐Manuel Miranda [tracks_done] |
| SZA | SOS Deluxe: LANA | apple-us#64 | 2024-12-20 | ours SZA [tracks_done] |
| Ella Langley | still hungover | apple-us#69 apple-ca#50 apple-au#74 | 2024-11-01 | ours Ella Langley [tracks_done] |
| Brent Faiyaz | Icon (Director's Cut) | apple-us#81 | 2026-08-07 | ours Brent Faiyaz [tracks_done] |
| Olivia Rodrigo | GUTS (spilled) | apple-gb#66 apple-br#73 apple-ca#86 | 2023-09-08 | ours Olivia Rodrigo [tracks_done] |
| ABBA | ABBA Gold: Greatest Hits (40th Anniversary Edition) | apple-gb#70 apple-de#55 apple-au#79 | 1992-09-21 | ours ABBA [tracks_done] |
| 김심야 | Dogma | apple-kr#14 | 2026-09-09 | ours Kim Ximya [tracks_done] |
| 뉴진스 | NewJeans 1st EP 'New Jeans' | apple-kr#32 | 2022-08-01 | ours NewJeans [tracks_done] |
| 뉴진스 | NewJeans 2nd EP 'Get Up' | apple-kr#72 | 2023-07-21 | ours NewJeans [tracks_done] |
| BIG Naughty | 호프리스 로맨틱 | apple-kr#95 | 2023-02-28 | ours BIG Naughty [tracks_done] |
| 볼빨간사춘기 | Full Album RED PLANET | apple-kr#100 | 2016-08-29 | ours 볼빨간사춘기 [tracks_done] |
| TUIDE | TUIDE The 1st EP [TUNE & PLAY] - EP | apple-jp#85 | 2026-08-24 | ours TUIDE [tracks_done] |
| Dominguinho, João Gomes, Mestrinho & Jota.pê | Dominguinho Vol. 2 (Ao Vivo) | apple-br#56 | 2026-05-07 | ours João Gomes [tracks_done] |
| Ariana Grande | Dangerous Woman (Video Album) | apple-br#70 | 2016-05-20 | ours Ariana Grande [tracks_done] |
| Racionais MC's | Nada Como um Dia Após o Outro Dia, Vol. 1 & 2 | apple-br#84 | 2003-03-04 | ours Racionais MC’s [tracks_done] |
| Natanael Cano | Natanael Cano, Vol.1 | apple-mx#2 | 2026-08-28 | ours Natanael Cano [tracks_done] |
| Luis Miguel | México en la Piel (Edición Diamante) | apple-mx#100 | 2004-11-09 | ours Luis Miguel [tracks_done] |
| Backstreet Boys | Millennium 2.0 | apple-de#5 | 2025-07-11 | ours Backstreet Boys [tracks_done] |
| Die Toten Hosen | "Trink aus, wir müssen gehen!“ + Bonusalbum "Alles muss raus!“ | apple-de#26 | 2026-05-29 | ours Die Toten Hosen [tracks_done] |
| Rihanna | Good Girl Gone Bad: Reloaded | apple-de#74 apple-au#100 | 2007-05-31 | ours Rihanna [tracks_done] |
| Bouss | Depuis le temps (Pour la miff) | apple-fr#48 | 2024-05-01 | ours Bouss [tracks_done] |
| Guy2Bezbar | JEUNESSE DORÉE MUSIC | apple-fr#58 | 2026-06-12 | ours Guy2Bezbar [tracks_done] |
| Dadju | Gentleman 2.0 (Réédition) | apple-fr#87 | 2018-02-20 | ours Dadju [tracks_done] |
| John Farnham | John Farnham: Greatest Hits | apple-au#31 | 1997 | ours John Farnham [tracks_done] |
| ROSALÍA | LUX (Complete Works) | apple-es#30 | 2026-04-16 | ours ROSALÍA [tracks_done] |
| C. Tangana | El Madrileño (La Sobremesa) | apple-es#78 | 2022-02-17 | ours C. Tangana [tracks_done] |
| Shashwat Sachdev & Irshad Kamil | Dhurandhar The Revenge (Original Motion Picture Soundtrack) | apple-in#6 | 2026-03-17 | ours Irshad Kamil [tracks_done] |
| Mithoon, Ankit Tiwari & Jeet Gannguli | Aashiqui 2 (Original Motion Picture Soundtrack) | apple-in#20 | 2013-04-03 | ours Mithoon [tracks_done] |
| A.R. Rahman | Rockstar (Original Motion Picture Soundtrack) | apple-in#21 | 2011-09-30 | ours A. R. Rahman [tracks_done] |
| Sachet-Parampara, Vishal Mishra, Mithoon, Akhil Sachdeva & Amaal Mallik | Kabir Singh (Original Motion Picture Soundtrack) | apple-in#24 | 2019-06-14 | ours Vishal Mishra [tracks_done] |
| Sai Abhyankkar | Dude (Original Motion Picture Soundtrack) | apple-in#33 | 2025-10-26 | ours Sai Abhyankkar [tracks_done] |
| Pritam & Amitabh Bhattacharya | Cocktail 2 (Original Motion Picture Soundtrack) | apple-in#36 | 2026-06-19 | ours Pritam [tracks_done] |
| Pritam | Ae Dil Hai Mushkil (Deluxe Edition) [Original Motion Picture Soundtrack] | apple-in#41 | 2016-11-12 | ours Pritam [tracks_done] |
| Pritam | Yeh Jawaani Hai Deewani (Original Motion Picture Soundtrack) | apple-in#44 | 2013-03-30 | ours Pritam [tracks_done] |
| Vishal Mishra, Ravi Basrur, Tanishk Bagchi & Arslan Nizami | Toxic - Kannada (Original Motion Picture Soundtrack) | apple-in#51 | 2026-08-13 | ours Tanishk Bagchi [tracks_done] |
| Pritam, Mustafa Zahid, Annie & Rafaqat Ali Khan | Awarapan (Original Motion Picture Soundtrack) | apple-in#53 | 2007-06-29 | ours Pritam [tracks_done] |
| The Weeknd | Hurry Up Tomorrow (Video Album) | apple-in#54 | 2025-02-11 | ours The Weeknd [tracks_done] |
| A.R. Rahman & Irshad Kamil | Main Vaapas Aaunga (Original Motion Picture Soundtrack) | apple-in#55 | 2026-06-10 | ours A. R. Rahman [tracks_done] |
| Sai Abhyankkar | Dude (Telugu) [Original Motion Picture Soundtrack] | apple-in#56 | 2025-10-29 | ours Sai Abhyankkar [tracks_done] |
| Hariharan | Shree Hanuman Chalisa (Hanuman Ashtak) | apple-in#61 | 2002-01-31 | ours Hariharan [tracks_done] |
| Shankar Ehsaan Loy | Bhaag Milkha Bhaag (Original Motion Picture Soundtrack) | apple-in#63 | 2013-06-14 | ours Shankar–Ehsaan–Loy [tracks_done] |
| Pritam | Desi Boyz (Original Motion Picture Soundtrack) | apple-in#65 | 2011-10-18 | ours Pritam [tracks_done] |
| Pritam | Love Aaj Kal (Original Motion Picture Soundtrack) | apple-in#71 | 2009-04-01 | ours Pritam [tracks_done] |
| Anirudh Ravichander, Vivek, Amogh Balaji & Karthik Netha | Jana Nayagan (Original Motion Picture Soundtrack) | apple-in#75 | 2026-07-22 | ours Anirudh Ravichander [tracks_done] |
| Pritam & Sandesh Sandilya | Jab We Met (Original Motion Picture Soundtrack) | apple-in#77 | 2007-09-21 | ours Pritam [tracks_done] |
| Pritam | Jannat (Original Motion Picture Soundtrack) | apple-in#78 | 2008-02-29 | ours Pritam [tracks_done] |
| Pritam | Ajab Prem Ki Ghazab Kahani (Original Motion Picture Soundtrack) | apple-in#80 | 2009-11-06 | ours Pritam [tracks_done] |
| Pritam | Race 2 (Original Motion Picture Soundtrack) | apple-in#82 | 2012-01-25 | ours Pritam [tracks_done] |
| Shankar Ehsaan Loy | Zindagi Na Milegi Dobara (Original Motion Picture Soundtrack) | apple-in#83 | 2011-06-03 | ours Shankar–Ehsaan–Loy [tracks_done] |
| Yo Yo Honey Singh, Anand Raj Anand, Amaal Mallik, Zack Knight, Guru Randhawa, Rajat Nagpal, Rochak Kohli & Saurabh Vaibhav | Sonu Ke Titu Ki Sweety (Original Motion Picture Soundtrack) | apple-in#86 | 2018-02-14 | ours Guru Randhawa [tracks_done] |
| Vishal & Shekhar | Anjaana Anjaani (Original Motion Picture Soundtrack) | apple-in#89 | 2010-08-19 | ours Vishal-Shekhar [tracks_done] |
| Sachin Gupta | Prince (Original Motion Picture Soundtrack) | apple-in#92 | 2010-04-09 | ours Sachin Gupta [tracks_done] |
| Vishal & Shekhar | Bachna Ae Haseeno (Original Soundtrack) | apple-in#94 | 2008-07-05 | ours Vishal-Shekhar [tracks_done] |
| Vishal & Shekhar | Ra-One (Original Motion Picture Soundtrack) | apple-in#98 | 2011-09-12 | ours Vishal-Shekhar [tracks_done] |
| Pritam, Irshad Kamil & Amitabh Bhattacharya | Cocktail (Original Motion Picture Soundtrack) | apple-in#100 | 2012-04-01 | ours Pritam [tracks_done] |
| ATLUS Sound Team | Shin Megami Tensei V: Vengeance Original Soundtrack | deezer-global#16 |  | ours アトラスサウンドチーム [tracks_done] |
| Hans Zimmer | Blade Runner 2049 (Original Motion Picture Soundtrack) | deezer-global#22 |  | ours Hans Zimmer [tracks_done] |
| Michael Jackson | Michael Jackson's This Is It | deezer-global#61 |  | ours Michael Jackson [tracks_done] |
| Arthur Russell | Love Is Overtaking Me (Redux) | deezer-global#73 |  | ours Arthur Russell [tracks_done] |
| Les Arts Florissants | Rameau: Castor & Pollux | deezer-global#92 |  | ours Les Arts Florissants [resolved] |
| Bernard Herrmann | North By Northwest (Original Motion Picture Soundtrack) | deezer-global#98 |  | ours Bernard Herrmann [tracks_done] |

#### edition-of-present — 7

_deluxe/anniversary edition of an album we hold — not a gap_ (listed in the CSV only)

#### out-of-scope — 33

_Various Artists / sleep & kids audio_ (listed in the CSV only)


---

## 4. Artists

### 4.1 Last.fm top artists

Global top 1,000 plus the top 200 in 26 countries: **1,828 artists**. An artist counts as present if we
hold it by MBID or by exact name with a real discography (Last.fm's MBID is sometimes a different entity).
Class counts: present 1711, artist-missing 90, artist-stub 27.

| Artist | Listeners | Charts | Class | Queue |
|---|---|---|---|---|
| Frank Sinatra | 5,048,965 | global#230 | artist-stub | skipped (heavily_featured) |
| Johnny Cash | 4,172,433 | global#661 | artist-stub | skipped (heavily_featured) |
| Djo | 2,487,732 | global#231 indonesia#141 india#76 | artist-missing | done |
| Roar | 1,619,360 | global#422 | artist-missing | done |
| League of Legends | 1,292,804 | global#836 | artist-stub | done |
| Cuco | 1,286,414 | global#795 | artist-stub | done |
| Ken Carson | 1,241,501 | global#170 united states#90 united kingdom#184 | artist-stub | done |
| Sports | 1,165,720 | global#859 | artist-missing | done |
| Dean Blunt | 1,027,281 | global#343 | artist-stub | done |
| Jack Stauber's Micropop | 979,704 | global#610 | artist-missing | done |
| Shelly | 928,504 | global#672 | artist-missing | done |
| ADÉLA | 666,090 | global#14 united states#41 united kingdom#21 | artist-missing | done |
| A-wall | 611,337 | global#974 | artist-missing | not queued |
| Hot Freaks | 517,556 | global#786 | artist-missing | done |
| Jão | 457,829 | global#800 brazil#78 | artist-stub | done |
| Feng | 409,842 | global#670 | artist-missing | done |
| After | 369,584 | global#647 | artist-missing | done |
| GIRLSET | 222,793 | global#834 | artist-missing | not queued |
| Mollie Elizabeth | 108,682 | global#914 | artist-missing | not queued |
| Urias | 11,329 | brazil#133 | artist-stub | done |
| RAPROJECT SIX | 4,993 | philippines#43 | artist-missing | not queued |
| Gat Putch | 4,651 | philippines#49 | artist-missing | done |
| Uncle Dags | 4,062 | philippines#66 | artist-missing | done |
| shirebound | 4,012 | philippines#68 | artist-missing | done |
| Alex Crichton | 3,861 | indonesia#105 philippines#78 | artist-missing | not queued |
| Jin DC | 3,684 | philippines#83 | artist-missing | not queued |
| Mariah Deborah | 3,253 | philippines#105 | artist-missing | not queued |
| Esremborak | 3,119 | philippines#111 | artist-missing | not queued |
| Orange & Lemons | 3,007 | philippines#121 | artist-missing | done, done |
| groundZERO Records | 2,799 | philippines#139 | artist-missing | not queued |
| The Itchyworms | 2,785 | philippines#140 | artist-missing | not queued |
| Willie Revillame | 2,732 | philippines#143 | artist-missing | not queued |
| Demi | 2,629 | philippines#150 | artist-missing | done |
| Lo Ki | 2,415 | philippines#173 | artist-missing | not queued |
| OLG Zak | 2,381 | philippines#174 | artist-missing | not queued |
| Mata | 2,243 | poland#33 | artist-stub | done |
| Bedoes 2115 | 1,786 | poland#61 | artist-missing | done |
| Tony Boy | 1,752 | italy#8 | artist-stub | done |
| PLK | 1,695 | france#31 | artist-stub | done |
| Omar Camacho | 1,632 | mexico#143 | artist-missing | not queued |
| Hamza | 1,486 | france#49 | artist-stub | done |
| La Arrolladora Banda El Limón de Rene Camacho | 1,479 | mexico#171 | artist-missing | done |
| ARJN | 1,420 | india#117 | artist-missing | not queued |
| Lazza | 1,279 | italy#36 | artist-stub | done |
| Dhanda Nyoliwala | 1,229 | india#151 | artist-stub | pending |
| Wane | 1,170 | poland#161 | artist-missing | done |
| Tan Bionica | 1,154 | argentina#84 | artist-missing | done |
| Jind Universe | 1,093 | india#179 | artist-missing | done |
| Młody West | 1,090 | poland#183 | artist-missing | done |
| Papa V | 1,073 | italy#67 | artist-stub | done |
| Chivas | 1,037 | poland#200 | artist-missing | done |
| Fro! | 967 | argentina#121 | artist-missing | not queued |
| Raim Laode | 881 | indonesia#81 | artist-missing | not queued |
| Eladio Carrion | 801 | spain#129 colombia#88 | artist-missing | not queued |
| La Noche | 782 | chile#99 | artist-missing | not queued |
| Maria Becerra | 754 | argentina#183 | artist-missing | not queued |
| Zeki Arkun | 730 | turkey#75 | artist-missing | not queued |
| Paky | 710 | italy#138 | artist-missing | done |
| aira | 705 | italy#140 | artist-missing | not queued |
| Estoy Bien | 701 | chile#127 | artist-missing | not queued |
| Santaferia | 697 | chile#128 | artist-missing | not queued |
| Amar Azul | 684 | chile#130 | artist-missing | not queued |
| Nitro | 682 | italy#151 | artist-stub | done |
| noche de brujas | 671 | chile#136 | artist-missing | not queued |
| eńau | 635 | indonesia#145 | artist-missing | done |
| Marcell | 609 | indonesia#153 | artist-missing | done |
| Machete | 589 | italy#197 | artist-missing | done |
| Bryartz | 545 | chile#182 | artist-missing | done |
| Cámara Chilena de la Destrucción | 527 | chile#188 | artist-missing | not queued |
| Akbar Chalay | 519 | indonesia#192 | artist-missing | not queued |
| Era7capone | 510 | turkey#149 | artist-missing | done |
| Kayra | 504 | turkey#154 | artist-missing | done |
| J Alvarez | 501 | colombia#145 | artist-missing | done |
| JVG | 472 | finland#91 | artist-stub | done |
| KAVAK | 463 | turkey#179 | artist-missing | not queued |
| Radikal | 458 | turkey#181 | artist-missing | done |
| Karpe | 455 | norway#37 | artist-missing | not queued |
| Mirella | 368 | finland#164 | artist-stub | done |
| Mavo | 317 | nigeria#12 | artist-missing | not queued |
| Young Jonn | 280 | nigeria#19 | artist-stub | pending |
| Fola | 252 | nigeria#27 | artist-stub | not queued |
| ULD | 248 | norway#134 | artist-missing | not queued |
| Kaizers Orchestra | 236 | norway#145 | artist-missing | not queued |
| KAESTYLE | 222 | nigeria#34 | artist-missing | not queued |
| Ruger | 202 | nigeria#44 | artist-stub | not queued |
| Zaylevelten | 201 | nigeria#45 | artist-missing | not queued |
| Famous pluto | 196 | nigeria#50 | artist-missing | not queued |
| Adekunle GOLD | 179 | nigeria#55 | artist-stub | pending, skipped (already-owned) |
| Kwate | 168 | nigeria#60 | artist-missing | done |
| KEMUEL | 162 | nigeria#67 | artist-missing | not queued |
| Kidd Carder | 152 | nigeria#73 | artist-missing | not queued |
| Joeboy | 144 | nigeria#78 | artist-stub | not queued |
| Shoday | 138 | nigeria#85 | artist-missing | not queued |
| ABEFE | 129 | nigeria#94 | artist-missing | not queued |
| Sarz | 118 | nigeria#105 | artist-stub | pending |
| RUNTOWN | 117 | nigeria#107 | artist-missing | not queued |
| Zlatan | 116 | nigeria#109 | artist-stub | pending |
| scottyolorin | 116 | nigeria#110 | artist-missing | not queued |
| Shaiboy | 111 | nigeria#116 | artist-missing | not queued |
| Txmmyily | 111 | nigeria#118 | artist-missing | not queued |
| DARKoO | 108 | nigeria#125 | artist-missing | not queued |
| Kunmie | 104 | nigeria#133 | artist-missing | not queued |
| Tml Vibez | 103 | nigeria#135 | artist-missing | not queued |
| Specikinging | 102 | nigeria#139 | artist-missing | not queued |
| Ayo Maff | 102 | nigeria#141 | artist-missing | not queued |
| DJ Tunez | 102 | nigeria#142 | artist-stub | not queued |
| Ajebo Hustlers | 101 | nigeria#144 | artist-missing | not queued |
| Bella Shmurda | 100 | nigeria#146 | artist-missing | not queued |
| Shaiboy & Chella | 97 | nigeria#152 | artist-missing | not queued |
| Specikinging & Davinchiii | 97 | nigeria#153 | artist-missing | not queued |
| Spinall | 96 | nigeria#158 | artist-missing | not queued |
| Muyeez | 95 | nigeria#160 | artist-missing | not queued |
| Alyssa Grace | 92 | nigeria#170 | artist-missing | not queued |
| Kemuel & DJ Tunez | 88 | nigeria#179 | artist-stub | not queued |
| Kashcoming | 88 | nigeria#180 | artist-missing | not queued |
| Magixx | 88 | nigeria#184 | artist-missing | not queued |
| P-Square | 84 | nigeria#199 | artist-missing | not queued |

Deezer global top-100 artists not held: ADÉLA (#92, artist-missing).

### 4.2 KR scene roster (`data/kr-scene.ts`)

| Name | Class | Our row |  | Queue |
|---|---|---|---|---|
| Woo Won Jae | artist-missing | — |  | not queued |
| Owen | artist-stub | Owen |  | done |
| Blase | artist-missing | — |  | not queued |
| Toigo | artist-missing | — |  | done |
| DeVita | artist-missing | — |  | done |
| Jclef | artist-missing | — |  | done |
| Hate the Sun | artist-missing | — |  | not queued |

Woo Won Jae, Blase and Owen are held as 우원재, BLASÉ and Owen Ovadoz. That is an alias gap, not a missing artist.

### 4.3 KR feat-only collaborators (`_feat-gaps-kr.json`, ≥3 credits)

The 2026-07-14 audit's top collaborators, re-checked. Class counts: artist-empty 30, present 71, artist-missing 19. "artist-empty" means the
row exists (queued by the credit lane) but MusicBrainz has no release groups for them, the same class as Skyminhyuk.

| Name | Class | Our row | Credits | Queue |
|---|---|---|---|---|
| Sean2Slow | artist-empty | Sean2Slow | 14 | done |
| 고영열 | artist-empty | 고영열 | 8 | done |
| Cokejazz | artist-empty | Cokejazz | 8 | done |
| 수란 | artist-missing | — | 7 | done |
| Roscoe Umali | artist-missing | — | 6 | not queued |
| グリリ | artist-missing | — | 6 | not queued |
| 김효은 | artist-missing | — | 6 | not queued |
| Juvie Train | artist-empty | Juvie Train | 6 | done |
| 하윤주 | artist-empty | 하윤주 | 5 | done |
| Styliztik Jones | artist-empty | Styliztikjones | 5 | done |
| 전제덕 | artist-empty | 전제덕 | 5 | done |
| DeVita | artist-missing | — | 5 | done |
| Kwon Ki Baek | artist-empty | Kwon Ki Baek | 4 | done |
| 한국사람 | artist-empty | 한국사람 | 4 | done |
| 이주한 | artist-empty | 이주한 | 4 | done |
| Sugar Flow | artist-empty | Sugar Flow | 4 | done |
| Maboos | artist-missing | — | 4 | not queued |
| Red Roc | artist-empty | Red Roc | 4 | done |
| Ann One | artist-missing | — | 4 | not queued |
| Simo | artist-empty | Simo | 4 | done |
| Brown Bunny | artist-empty | Brown Bunny | 4 | done |
| DUT2 | artist-empty | Dut2 | 4 | done |
| 화사 of 마마무 | artist-missing | — | 4 | not queued |
| Warmman | artist-empty | Warmman | 4 | done |
| 조규현 | artist-empty | 조규현 | 3 | done |
| Ray | artist-empty | Ray | 3 | done, skipped |
| CHANMINA | artist-missing | — | 3 | not queued |
| j‐hope of BTS | artist-missing | — | 3 | not queued |
| YeSLow | artist-empty | YeSLow | 3 | done |
| 박정은 | artist-empty | 박정은 | 3 | done |
| Dave Lopez | artist-missing | — | 3 | not queued |
| Mellow | artist-empty | Mellow | 3 | done |
| Enzo.B | artist-empty | Enzo.B | 3 | done |
| KIRIN | artist-missing | — | 3 | not queued |
| Woo Won Jae | artist-missing | — | 3 | not queued |
| 허인창 | artist-empty | 허인창 | 3 | done |
| DJ Wreckx | artist-missing | — | 3 | not queued |
| Kor Kash | artist-empty | Kor Kash | 3 | done |
| Youngcook | artist-empty | Youngcook | 3 | done |
| JENNIE KIM OF YG NEW ARTIST | artist-missing | — | 3 | not queued |
| TEDDY | artist-empty | TEDDY | 3 | pending, done, done |
| Dayday | artist-missing | — | 3 | not queued |
| 로꼬 Loco | artist-missing | — | 3 | not queued |
| GongGongGoo009 | artist-empty | GongGongGoo009 | 3 | done |
| Blase | artist-missing | — | 3 | not queued |
| oygli | artist-empty | oygli | 3 | done |
| Gist | artist-missing | — | 3 | not queued |
| b-soap | artist-empty | B-Soap | 3 | done |
| 조현아 | artist-empty | 조현아 | 3 | done |

### 4.4 Coverage test set (`data/coverage-testset.ts`)

| Name | Class | Our row |  | Queue |
|---|---|---|---|---|
| Owen | artist-stub | Owen |  | done |
| Blase | artist-missing | — |  | not queued |
| toe | artist-stub | toe |  | pending |

### 4.5 Name checks: search misses and earlier reports

`search_misses` holds 149 distinct queries from 207 logged misses. Most are partial typing ("like tha", "ed shee"); the real names are
checked here against our rows and MusicBrainz.

| Query / name | Local exact match | MusicBrainz says |
|---|---|---|
| 그레이 | — | Graye/? → not ours; GRAY/KR → OURS: Gray |
| 딘 | — | no exact MB artist |
| Woo Won Jae | — | no exact MB artist |
| Hate the Sun | — | no exact MB artist |
| Black Skirt | — | no exact MB artist |
| 大瀧詠一 | — | 大滝詠一/JP → not ours |
| 大滝詠一 | — | 大滝詠一/JP → not ours |
| Jaedal | — | JaeDal/? → not ours |
| Yoon Young-bae | — | no exact MB artist |
| Gonggonggu | — | no exact MB artist |
| Kim Ho-joong | — | no exact MB artist |
| lov3rboi | — | Lov3rboi/KR → not ours |
| Toaka | — | 十明/JP → OURS: 十明 |
| 타이거JK | — | no exact MB artist |
| Tiger JK | Tiger JK[tracks_done] | Tiger JK/KR → OURS: Tiger JK |
| 시스템서울 | — | no exact MB artist |
| 아마자라시 | — | no exact MB artist |
| amazarashi | amazarashi[tracks_done] | amazarashi/JP → OURS: amazarashi |
| 팻두 | — | no exact MB artist |
| Fatdoo | FatDoo[tracks_done] | FatDoo/KR → OURS: FatDoo |
| 가터벨트 | — | no exact MB artist |
| 빌스택스 | BILL STAX[tracks_done] | BILL STAX/KR → OURS: BILL STAX |
| BILLSTAX | BILL STAX[tracks_done] | no exact MB artist |
| 장윤중 | — | no exact MB artist |
| 지투 | — | no exact MB artist |
| G2 | G2[tracks_done] | G2/KR → OURS: G2; G2/JP → not ours; G2/US → not ours |
| Mekakucity Actors | — | no exact MB artist |
| Hoshimachi Suisei | — | 星街すいせい/JP → OURS: 星街すいせい |
| 코르티스 | CORTIS[tracks_done] | CORTIS/KR → OURS: CORTIS |
| 아카네 리제 | 아카네 리제[tracks_done] | 아카네 리제/KR → OURS: 아카네 리제 |
| 불한당가 | — | no exact MB artist |
| 희대의 도모 | — | no exact MB artist |
| 양홍원 | — | YANGHONGWON/KR → OURS: YANGHONGWON |
| 씨잼 | — | C Jamm/KR → OURS: C Jamm |
| 로제 | — | ROZE/JP → not ours; ROSÉ/KR → OURS: ROSÉ |
| ROSÉ | ROSÉ[tracks_done] | no exact MB artist |
| 재지팩트 | — | no exact MB artist |
| Jazzyfact | Jazzyfact[tracks_done] | Jazzyfact/KR → OURS: Jazzyfact |
| 수란 | — | SURAN/KR → OURS: SURAN |
| SURAN | SURAN[tracks_done] | SURAN/KR → OURS: SURAN |
| DeVita | — | DeVita/KR → OURS: Chloe DeVita |
| Toigo | — | toigo/KR → not ours |
| Jclef | — | Jclef/KR → not ours |
| Djo | — | Djo/US → not ours; Dallas Jazz Orchestra/? → not ours; Olen Blackbird/CH → not ours |
| ADÉLA | — | ADÉLA/SK → not ours; ADÉLA/CZ → not ours |
| Blase | — | Blase/US → not ours |
| Frank Ocean | Frank Ocean[tracks_done] | Frank Ocean/US → OURS: Frank Ocean; Christopher Breaux/? → not ours |

---

## 5. Queue defects

### 5.1 Ghost rows: `done`, zero releases, no artist row

Class counts across the 233 rows (by name): no row 118, stub 44, present 71. "present" means an artist with the same name
exists under a different MBID. Those 71 need no action. The 162 below are real gaps, sorted by Deezer fans.

| Artist | Queue MBID | Our row | Deezer fans | Deezer albums |
|---|---|---|---|---|
| Xamã | b6d5f68f-0c1d-4888-b842-16151661db50 | stub:Xamã | 1,259,569 | 110 |
| J Alvarez | 7453f9b8-1fff-4a32-819f-32943c5476d0 | none | 1,043,192 | 270 |
| Timal | 459f3f2f-b7b5-4639-b5b4-a177935848fb | none | 990,685 | 102 |
| Lukas Graham | 69cfe463-3075-44d8-b118-02381e4a9ed9 | stub:Lukas Graham | 567,144 | 45 |
| Veigh | 8b660aba-0b50-4925-a5e4-ad9dec7b5d54 | none | 565,871 | 88 |
| League of Legends | c68d3821-4222-4de4-acc3-a838f477433b | stub:League of Legends | 416,218 | 169 |
| Dalmata | 3821cfaf-cb66-455c-a629-e9ab830b3765 | none | 367,443 | 27 |
| Kaleo | 107512ee-b101-4de5-b433-0eba72a623b2 | none | 272,484 | 24 |
| Capo | df52b5a5-ce38-4982-baae-217f8b9b1ae2 | stub:Capo | 260,577 | 66 |
| Hidra | 7e7dfd99-7b34-4d24-be47-e633e6db2442 | stub:Hidra | 225,108 | 53 |
| R2 | 2d73aa1e-d8b1-4b8e-ab0d-96aed173336c | stub:R2 | 218,779 | 56 |
| Cuco | 6f261103-71d0-42e3-8ea6-9763a8f1ef83 | stub:Cuco | 217,559 | 48 |
| Boef | 1f1a47d4-0167-4ed1-983e-acc40cee4881 | stub:Boef | 215,899 | 51 |
| Luiz Lins | f4352bd5-38fe-41b5-a641-36f6f44dd86c | none | 200,308 | 38 |
| Léo Foguete | 8bbd5ffc-6507-4bfa-bcf0-4d502855a7f9 | none | 151,092 | 34 |
| Ken Carson | 84d4283e-903a-42c4-a0d2-d3949bfa1f3f | stub:Ken Carson | 110,711 | 25 |
| Urias | 4e883e4e-03a6-4573-aa9e-b911a610a095 | stub:Urias | 100,666 | 37 |
| Lazza | dc999240-731a-416d-bb87-816bf47b7984 | stub:Lazza | 94,551 | 57 |
| Roar | 152e8c18-d65a-4ac5-af97-43a2191d2f64 | none | 83,679 | 6 |
| Saja Boys | 62e4d845-5a9f-462f-a909-8e480dd3c1b8 | none | 79,601 | 7 |
| Jack Stauber's Micropop | 611be335-706d-4f51-9171-18d0c9bcd2fe | none | 78,436 | 8 |
| Ruel | a768eede-70f6-43d6-9c64-a968a8598035 | stub:Ruel | 73,072 | 58 |
| Kalim | 4eebe038-8ac9-4b4f-ba0b-30f0b2645d2c | stub:Kalim | 59,508 | 75 |
| Nitro | 52afa561-7384-433e-a8fb-037784a15466 | stub:Nitro | 56,122 | 34 |
| JVG | 842c0c07-3126-4a42-9e38-07876c0a9a65 | stub:JVG | 45,605 | 62 |
| Kulturr | 0b61a3a4-6431-4284-9ea4-e5a0d79ad968 | none | 40,239 | 50 |
| Shades | ce987947-6e57-42a3-bd54-b386550da5d8 | stub:Shades | 39,026 | 116 |
| Alee | 5512f7aa-cf0e-4119-8784-04b02e3d01d1 | stub:Alee | 31,619 | 49 |
| DJ Tao | 33e7a5e4-7907-49ac-9d1e-179975b055ff | none | 30,364 | 97 |
| Mostro | 98904f57-12c0-4b61-9370-ca72396d194a | none | 28,444 | 31 |
| Machete | 09a7cf5c-3042-4ee9-b1e4-44e9525f1a66 | none | 24,182 | 49 |
| Febre90s | 37c65b9c-6204-4e60-924d-1dcf7e18730f | none | 23,833 | 7 |
| ADÉLA | 7a683b8b-0c84-4bbe-a9d9-89bb5b4cfb4a | none | 18,520 | 20 |
| chuyin | 1ff0f19c-1d87-4ab2-8a65-ab2ff0290c07 | none | 16,449 | 22 |
| Diyar Pala | c3f3cdd6-22f0-4927-97a7-1493726fc38b | none | 16,033 | 17 |
| Syko | 72311269-8625-4783-ad35-94b4d65719d8 | stub:Syko | 15,420 | 4 |
| Cream Soda | 2e0edcc4-2c7d-4d86-869e-f8f8edfe56d6 | stub:Cream Soda | 14,888 | 50 |
| Dean Blunt | a279f977-9f70-4e06-b86c-0a438810eefb | stub:Dean Blunt | 13,307 | 36 |
| Era7capone | 4aafcd0d-881f-4567-ab90-26d9c4f4e162 | none | 12,401 | 30 |
| Mata | e1f16096-475c-4d65-9628-f8a4bc9d463c | stub:Mata | 11,664 | 69 |
| New West | 6e8c745f-fa34-4e60-a47d-c75aec15341e | none | 11,282 | 22 |
| Phillipa Soo | e98fc8a6-f523-462a-b221-b55d935f19d8 | none | 10,096 | 2 |
| Mukesh | 0e060e04-dadf-4fa9-81b8-bd3f18134417 | stub:Mukesh | 9,214 | 348 |
| Avenoir | 51ffb9b9-02ec-4124-933c-471ba7ef54d5 | none | 9,143 | 59 |
| Tony Boy | 2c227b43-5d68-458e-83c3-4b4a8793a754 | stub:Tony Boy | 8,763 | 55 |
| FRSH | bb7b6338-c241-4333-8f9c-a020bc55db3e | stub:Frsh | 8,031 | 77 |
| Between Friends | c75b90f7-7a70-471c-85f1-5aa861badda3 | none | 7,107 | 27 |
| izna | 3a771a1d-1a2f-4446-b695-4c9d21a1fd6f | none | 6,966 | 9 |
| Erin | 2c51bfa8-377f-4046-adf8-de0d95c188b5 | stub:Erin | 6,913 | 27 |
| ITHAN NY | 87b4a66e-b597-40a2-a1b5-07d2ef33e517 | none | 6,572 | 88 |
| Sports | b03bbf4e-4c7a-4acc-8d30-71c360d95b4b | none | 6,049 | 26 |
| Papa V | 3b0b67f8-54b1-4cd7-9451-0eeb6e0bce67 | stub:Papa V | 5,453 | 24 |
| Galee Galee | 18774f1a-130d-4480-96c0-6e2ce279cdc1 | none | 5,449 | 59 |
| Take Care | 3beae394-1b0e-4fce-9c1d-e2827754e4e3 | none | 5,279 | 83 |
| Chivas | a6c288db-9015-43fe-b5cf-7200cf4464b6 | none | 4,598 | 70 |
| Hot Freaks | 7137722f-14e1-4084-9baa-37e20251ca47 | none | 4,181 | 16 |
| El Arkeologo | 075b8cbe-5061-468c-9dde-3bdfcfde0639 | none | 4,082 | 26 |
| Bedoes 2115 | 92506130-a483-403f-a89e-7d24f2d2ae03 | none | 3,988 | 54 |
| Demi | 0a8602ca-2066-4cfd-aa1a-13fa5588f442 | none | 3,640 | 129 |
| Puterrier | 5e521662-a31a-45a2-bf42-26427246e888 | none | 3,623 | 39 |
| 2115 | ce55b8f5-e5eb-4ac3-80b0-f6138a7983a8 | none | 3,571 | 11 |
| Tana | d433ac55-8571-4677-bb5c-01abc46a5fc5 | none | 3,436 | 154 |
| Olly | b16f8b0c-b00a-4bbc-b0dc-318fc61ab179 | none | 3,180 | 39 |
| Feng | 78ed2202-c6d2-4d66-a637-df378d1c4d10 | none | 3,132 | 42 |
| Lil Naay | fed41fa8-edcf-4f40-bcba-fcfda72101f8 | none | 2,769 | 83 |
| SLF | 304e1d3b-05fa-4450-90d5-4000554c35c0 | none | 2,667 | 59 |
| ayase | 3f49ae70-dd0d-4674-a10f-6b562ff52fdd | stub:Ayase | 2,634 | 12 |
| KÖK$VL | 955e5f20-b362-4d9f-9562-13ce121ba16c | none | 2,550 | 61 |
| Ahiyan | e91d7ab8-31bd-4fca-8b0e-dadb0ebfee74 | none | 2,448 | 19 |
| Mirella | b27fdee4-0970-4245-ba7b-9e4df7cdc701 | stub:Mirella | 2,354 | 12 |
| Piero 47 | a325deec-36e6-494d-8f75-3b298b473333 | none | 2,349 | 51 |
| Glare | 6825e929-5564-4981-bb0a-85dc272e2de3 | none | 2,213 | 28 |
| Martinwhite | 279b23ca-0a7a-42b9-adfd-40e0bb2ff0a1 | none | 2,163 | 38 |
| Skapova | 3c1aa29e-e363-4919-b9a2-7cd8229b9e4d | none | 1,951 | 21 |
| Radikal | dde4f643-866b-418e-be59-4c7c32e1d528 | none | 1,923 | 96 |
| Bixi Blake | 07620656-b2a4-48dc-bea1-1f3f39719d33 | none | 1,813 | 18 |
| Tury | 4c0bb4ea-3636-46c7-a00c-f8675e49d4b4 | none | 1,804 | 177 |
| Peipper | cfbe9e22-58e9-4687-bcdb-db0460aea389 | none | 1,690 | 55 |
| Djo | 83cedfd0-a118-48eb-ad71-72f4c2f95fd2 | none | 1,635 | 7 |
| Untitled | f755f3d4-3e67-4c60-a906-ff3174504069 | none | 1,587 | 202 |
| Shako | 8c4b7718-0e6f-450e-a555-fa3a5077e827 | none | 1,554 | 86 |
| Shelly | 03d561c0-b4e1-49df-bd72-24dfeaf245e7 | none | 1,428 | 2 |
| After | 21d75f88-7567-4c31-8171-7d8d2490f9b2 | none | 1,369 | 19 |
| Rebe | 064e5848-8385-4e85-b2ee-170ad1c8e393 | none | 1,346 | 50 |
| Tobal Mj | dab2a327-1128-4f67-b488-7eb67f0d1eae | none | 1,172 | 45 |
| Kler | c1e5909b-1a50-40c3-83e6-d600588f67e0 | none | 1,006 | 24 |
| pz' | 32887890-2f94-492c-9487-9ed23c24e19b | none | 995 | 28 |
| Watson | 02f37bcb-b827-4645-b3e7-0607b06b516d | stub:Watson | 962 | 18 |
| MDA | 0af16abf-aff4-421d-8b1d-868d0fd6ca43 | none | 910 | 159 |
| CaSh Flow | 1787ed0d-c83c-4adc-8f1e-6bd856d0f829 | none | 901 | 34 |
| Ankara Echoes | 97a69904-4a13-4d24-a38a-f489ff80f58a | none | 779 | 102 |
| Baby cute | bc3100f1-3edb-4e1a-9922-6774f5a6f84c | none | 741 | 28 |
| vkie | 271f213a-b709-488d-ab5e-7a61b19a17b4 | none | 741 | 73 |
| Saimaa | 1bcb7aab-0606-489e-b9e1-4b1c37057c00 | stub:Saimaa | 728 | 17 |
| Bryartz | 45e6980b-809f-4d63-96af-0eacc63d9029 | none | 675 | 59 |
| KUM | 72f71262-efec-4602-be99-c16fcc1b3b0b | none | 617 | 83 |
| Shamrock | 13fce073-a9df-4e07-933e-abda3b4630ed | none | 551 | 3 |
| Sugarcane | 43c0899a-6fb9-4f9a-8572-be0964aa3c1d | none | 548 | 30 |
| benjitalkapone | 071140bc-7ed4-4dff-9793-5313cbd26b91 | none | 544 | 59 |
| Majki | 00753303-a9b5-43a2-82c6-09e1bd877b54 | none | 509 | 240 |
| Aqua VS | 25dd5d4f-2ad2-4abf-97ca-0d955a8b50ff | none | 482 | 65 |
| Mamta Sharma | 981a7f8b-170c-4e78-abda-d32bae9e0734 | none | 478 | 303 |
| юпи | 02346d78-94eb-4c99-a246-32074f5b1c19 | none | 455 | 4 |
| Tuana | 83f266f1-4a95-4bdb-8d5a-9577214d2cf0 | none | 418 | 11 |
| Bob Newhart | 14abda46-7ed4-4cf6-b4c6-f694166cd5f0 | none | 391 | 10 |
| ALESHEN | fc91b52e-f937-42c2-bd23-6a72730e64b1 | none | 314 | 61 |
| roomtrash6 | fa85d059-e9b4-4e23-8124-dd1ba89434a1 | none | 309 | 49 |
| Jão | 27717b72-90bc-4f4f-9d0e-13a69bdfe00e | stub:Jão | 235 | 13 |
| Naomi Scott | 3d5c1383-dc4a-4ee9-8fca-a23b78d36f33 | none | 231 | 2 |
| Bouncy Boys Band | 045d3f30-8ee1-4838-b5b1-59e92516fdc9 | none | 209 | 8 |
| Doly Flackko | 78b1895b-dd60-4f63-a877-bd2b4aed7dc1 | none | 198 | 68 |
| SVM!R | 77c026ae-e265-45a9-a840-cb64546a518f | none | 186 | 11 |
| Dipinto | 693d7e4d-437c-4c8f-bb3f-4af7c43b7582 | none | 182 | 23 |
| Okekel | 8c764186-539b-4c12-948c-f09b0ded3fe9 | none | 179 | 45 |
| Cean Jr. | 41413d95-f917-4090-ad88-52709dc82512 | none | 174 | 14 |
| enzocerobulto | 14376242-c564-46f4-a711-28c47e4a979e | none | 173 | 63 |
| Shisosaloud | 87220a1c-fc22-4af3-93fd-94d2ea455337 | none | 167 | 44 |
| axel kala | 7770265f-ccd4-44de-b49a-33cf97068d57 | none | 142 | 22 |
| Sara Bee | 46e84284-9769-4946-bc86-a8a804a54f46 | stub:Sara Bee | 135 | 25 |
| guxo | 55326367-18fc-416c-bb61-46132026150e | none | 132 | 104 |
| Ida-Lova | 5352cd5c-4ab1-47d2-bba2-36259aaeadb1 | none | 128 | 18 |
| Robe | 4f67d427-9b11-4d8f-80ac-ba32bea6ebab | none | 127 | 8 |
| Pyrythekid | 28559765-e142-4bc3-816b-fd09223dfc29 | none | 121 | 31 |
| PLK | 120df9bb-6660-4e11-80b2-7ec9adaafa80 | stub:PLK | 120 | 7 |
| Uncle Dags | ce27b2d5-84a2-442d-ad62-a584d8a0421c | none | 118 | 30 |
| Minttu | 3764d859-446e-45d3-af0e-3be7f00cbad7 | none | 108 | 8 |
| Wane | e2956d0d-5ed9-43a1-9a5e-8d0a99354dca | none | 108 | 35 |
| Młody West | 34caa98f-e8c3-41ff-8b07-dca97f3c8b99 | none | 100 | 20 |
| Eryk Moczko | 7e19b130-34e7-4c8a-9725-3a07b3216d72 | none | 99 | 44 |
| Dhanji | 62e44e25-b7b4-4a30-bd0d-88cecea8105b | stub:Dhanji | 94 | 36 |
| Jclef | 57d3c03e-bb76-425f-816e-c7ea11f6f964 | none | 91 | 4 |
| DOG HUSTLERS | c9d2d4c4-896b-460c-b577-93a0faf0b169 | none | 82 | 16 |
| Toigo | 5d68d4c8-5ed7-4657-b572-ef914d5da280 | none | 81 | 29 |
| Gat Putch | e10846f2-b5da-46a1-865e-6a530a6d3535 | none | 72 | 86 |
| Aymen | a6083a6d-5b02-4ab5-9d40-49657bc96510 | stub:Aymen | 63 | 21 |
| Jungle Jack | 1b6b215d-9d35-4f3f-99fb-4f2b98f168a9 | none | 49 | 2 |
| YD Frost | 66bccade-e7c4-4168-acd0-1aacdf991f4c | none | 48 | 24 |
| Samia | b7d3f8a0-b7b1-4036-bd02-ed6b56e8e31f | stub:Samia | 38 | 2 |
| Roxie | aa609443-1d78-4582-ae3b-a08efba4f5ed | stub:Roxie | 36 | 16 |
| Ryannah J | dece922d-4db1-4ab6-bbf0-cca6a187c3f0 | none | 36 | 8 |
| Nimo | e3aa66c6-ae29-4f83-b1fd-2dc475786d1a | stub:Nimo | 34 | 1 |
| Marino | 20254075-793f-4c97-9658-a2b3575be7dc | none | 33 | 2 |
| El Manu | 912d531e-8fc7-40f2-9fe5-4f76373d0af5 | none | 31 | 4 |
| Bini | f32c18bd-34b4-4c52-8d40-4ccdd937086e | none | 23 | 4 |
| Jefe | 72e5ad37-4572-43ec-b12b-973c71b83ea0 | none | 22 | 11 |
| LoveT | bb76adb1-01ec-4877-852e-292b74a1153b | none | 22 | 34 |
| Alok | 2179a878-6762-4797-a18e-b4276a4c6d60 | stub:Alok | 21 | 1 |
| CBW | 7c65de08-ab60-434a-a723-8944c0b6d352 | none | 16 | 6 |
| Bambi | 9dff905a-2d46-4c36-8361-e6e9e322298c | none | 15 | 15 |
| Hamza | 051816e7-d4e8-4aa5-88e4-f404d3994096 | stub:Hamza | 13 | 22 |
| David Kushner | 39b67b8b-d237-4df9-b1a6-7cf4cf749b36 | stub:David Kushner | 11 | 2 |
| Marcell | da8d7f3c-9152-4743-9b90-ca14ef6e88bf | none | 11 | 8 |
| Miki | 619deb6e-2bee-439a-8de2-348c8178ec42 | stub:Miki | 9 | 47 |
| Sila | 32e01e1a-3871-45ee-96a3-b115187f441d | none | 4 | 8 |
| Paky | 18d087eb-bef5-4025-8575-ebcf7ab99dfa | none | 2 | 9 |
| Lida | cb39d35c-dcb4-4105-a9fb-e86b1150b91e | stub:Lida | 2 | 2 |
| Kayra | 70e58b59-b040-4ffb-9164-3acaa4754566 | none | 1 | 2 |
| Pouya | 6604167b-3d45-4a38-9371-712703175cb1 | stub:Pouya | 1 | 9 |
| Harmless | 0a972cdd-507c-4152-9422-460ad2949939 | none | — | — |
| Clúster | 6726f707-71c8-4e1d-9668-34d831a932bb | none | — | — |
| Vierra | 51652b1c-ece0-4107-b81a-91be33587f98 | none | — | — |
| John Pollõn | ca241708-c6a5-4bdd-9912-af8de5ac640d | none | — | — |

### 5.2 Skipped as heavily featured (>800 MB release groups)

37 artists; 29 are empty stubs, 6 are frozen partial ingests.

| Artist | Our row |
|---|---|
| Anton Bruckner | stub (no discography) |
| Bartók | stub (no discography) |
| Berliner Philharmoniker | stub (no discography) |
| Duke Ellington And His Orchestra | stub (no discography) |
| Dvořák | stub (no discography) |
| Ennio Morricone | stub (no discography) |
| Frank Sinatra | stub (no discography) |
| Grateful Dead | stub (no discography) |
| Handel | stub (no discography) |
| Herbert von Karajan | stub (no discography) |
| Igor Stravinsky | stub (no discography) |
| Johnny Cash | stub (no discography) |
| Joseph Haydn | stub (no discography) |
| London Philharmonic Orchestra | stub (no discography) |
| Mahler | stub (no discography) |
| Mendelssohn | stub (no discography) |
| Philharmonia Orchestra | stub (no discography) |
| Prokofiev | stub (no discography) |
| Ravel | stub (no discography) |
| Robert Schumann | stub (no discography) |
| Royal Philharmonic Orchestra | stub (no discography) |
| Schubert | stub (no discography) |
| Shostakovich | stub (no discography) |
| Sibelius | stub (no discography) |
| Tchaïkovsky | stub (no discography) |
| The E Street Band | stub (no discography) |
| The London Symphony Orchestra | stub (no discography) |
| Verdi | stub (no discography) |
| Wiener Philharmoniker | stub (no discography) |
| Bob Dylan | frozen partial ingest |
| Bruce Springsteen | frozen partial ingest |
| Elvis Presley | frozen partial ingest |
| Robert | no row |
| Sergei Rachmaninov | no row |
| The Beatles | frozen partial ingest |
| The Rolling Stones | frozen partial ingest |
| U2 | frozen partial ingest |

### 5.3 Failed / stuck rows

| Artist | Status | Source | Error |
|---|---|---|---|
| Hindemith | failed | mbid | recording upsert 78d114cd-544e-487f-a01b-719af938233b: canceling statement due t |
| Bill Evans | processing | mbid |  |
| [unknown] | failed | listenbrainz | refusing special-purpose MBID 125ec42a-7229-4250-afc5-e057484327fe (Various Arti |
| Clémentine | processing | mbid |  |
| Grieg | failed | mbid | recording upsert c6a8788f-be3a-40fa-9e35-9604bb0226ff: canceling statement due t |
| [anonymous] | failed | listenbrainz | refusing special-purpose MBID f731ccc4-e22a-43af-a747-64213329e088 (Various Arti |
| Status Quo | failed | mbid | recording upsert eb1124ea-75fc-45f1-97c1-69cf124a5b35: canceling statement due t |
| Dmitry Kabalevsky | processing | mbid |  |
| Saint‐Saëns | failed | mbid | recording upsert 4397398f-84b9-4d25-9211-3e1ef050a34f: canceling statement due t |
| [traditional] | failed | listenbrainz | refusing special-purpose MBID 9be7f096-97ec-4615-8957-8d40b5dcbc41 (Various Arti |
| John Williams | failed | mbid | recording upsert a6671c4a-6e1e-488c-95be-f9b14468a158: canceling statement due t |

The `failed` rows are statement timeouts on big classical discographies plus three correctly-refused
placeholder MBIDs.

### 5.4 Skipped seeds that are still absent

Wikipedia-seeded names that failed name resolution (`no_match` / `needs_review`), re-checked against today's
catalog and Deezer:

| Source | Still missing | On Deezer with albums | On Deezer, no albums | Not on Deezer |
|---|---|---|---|---|
| wikipedia_korea | 1158 | 271 | 92 | 795 |
| wikipedia_japan | 371 | 113 | 27 | 231 |
| wikipedia_greater_china | 275 | 128 | 12 | 135 |
| wikipedia_south_asia | 220 | 157 | 15 | 48 |
| wikipedia_africa | 118 | 60 | 9 | 49 |
| wikipedia_sea | 116 | 22 | 7 | 87 |
| wikipedia_latin | 76 | 31 | 3 | 42 |
| wikipedia_europe_world | 50 | 11 | 4 | 35 |
| wikipedia_western_canon | 29 | 2 | 8 | 19 |
| listenbrainz | 3 | 1 | 0 | 2 |
| prestige | 1 | 1 | 0 | 0 |
| seed | 1 | 0 | 0 | 1 |

Top 120 by Deezer fans (the rest are in the CSV). A same-name Deezer hit is a candidate, not proof: check identity before seeding.

| Name | Source | Deezer fans | Deezer albums |
|---|---|---|---|
| Kimberly Loaiza | wp:latin | 42,959 | 2 |
| Amanat Ali | wp:south_asia | 39,873 | 87 |
| Hadiqa Kiani | wp:south_asia | 33,448 | 40 |
| Jonathan C. Gambela | wp:europe_world | 30,360 | 17 |
| Fariha Pervez | wp:south_asia | 29,544 | 36 |
| Ali Azmat | wp:south_asia | 28,244 | 20 |
| Shafqat Amanat Ali | wp:south_asia | 25,871 | 63 |
| Junaid Jamshed | wp:south_asia | 21,717 | 96 |
| Annie Khalid | wp:south_asia | 14,597 | 10 |
| Faraón Love Shady | wp:latin | 12,155 | 27 |
| Haroon | wp:south_asia | 12,061 | 38 |
| Farhad Darya | wp:south_asia | 10,203 | 94 |
| Nazia Hassan | wp:south_asia | 9,805 | 11 |
| Sajjad Ali | wp:south_asia | 9,126 | 96 |
| Rahim Shah | wp:south_asia | 8,963 | 157 |
| Jacky Cheung | wp:greater_china | 8,486 | 76 |
| Kris Wu | wp:greater_china | 8,366 | 14 |
| Jai Uttal | wp:south_asia | 8,292 | 33 |
| Andy Lau | wp:greater_china | 7,206 | 54 |
| Sébastien El Chato | wp:europe_world | 7,120 | 26 |
| Jason Chen | wp:greater_china | 6,928 | 246 |
| Zoe Viccaji | wp:south_asia | 6,702 | 10 |
| Anita Lerche | wp:south_asia | 6,141 | 11 |
| Noor Jehan | wp:south_asia | 5,763 | 493 |
| Jazzy B | wp:south_asia | 5,761 | 108 |
| Denny Caknan | wp:sea | 4,910 | 107 |
| DopeNation | wp:africa | 4,706 | 52 |
| Umair Jaswal | wp:south_asia | 4,545 | 6 |
| Tzuyu | wp:greater_china | 4,451 | 2 |
| Jasmin Walia | wp:south_asia | 3,563 | 19 |
| Naseebo Lal | wp:south_asia | 3,255 | 471 |
| Ming Bridges | wp:sea | 3,183 | 4 |
| Sanam Marvi | wp:south_asia | 2,989 | 84 |
| Arif Lohar | wp:south_asia | 2,625 | 119 |
| Keche | wp:africa | 2,505 | 34 |
| Alban Bartoli | wp:europe_world | 2,435 | 9 |
| Benny Mayengani | wp:africa | 2,338 | 26 |
| Alan Tam | wp:greater_china | 2,179 | 7 |
| Jackie Chan | wp:greater_china | 2,161 | 8 |
| Coco Lee | wp:greater_china | 2,116 | 40 |
| Anita Mui | wp:greater_china | 1,924 | 31 |
| Wang Yibo | wp:greater_china | 1,865 | 3 |
| Baroque | wp:japan | 1,749 | 102 |
| Sam Hui | wp:greater_china | 1,704 | 6 |
| Kweku Darlington | wp:africa | 1,654 | 46 |
| Shehzad Roy | wp:south_asia | 1,637 | 29 |
| Runa Laila | wp:south_asia | 1,563 | 496 |
| Dr Tumi | wp:africa | 1,485 | 1 |
| Luis Pescetti | wp:latin | 1,399 | 19 |
| Joey Yung | wp:greater_china | 1,394 | 6 |
| Kelly Chen | wp:greater_china | 1,314 | 14 |
| Priscilla Chan | wp:greater_china | 1,265 | 5 |
| Hins Cheung | wp:greater_china | 1,156 | 10 |
| Leon Lai | wp:greater_china | 1,120 | 12 |
| Nanda Loren | wp:latin | 1,086 | 9 |
| Malkit Singh | wp:south_asia | 1,059 | 92 |
| Shazia Manzoor | wp:south_asia | 947 | 88 |
| Alamgir | wp:south_asia | 933 | 35 |
| Sara Haider | wp:south_asia | 924 | 3 |
| Poco Lee | wp:africa | 901 | 16 |
| DRB LasGidi | wp:africa | 899 | 7 |
| Ella Koon | wp:greater_china | 892 | 8 |
| Aamir Zaki | wp:south_asia | 891 | 3 |
| Knii Lante | wp:africa | 887 | 19 |
| Leo Ku | wp:greater_china | 832 | 26 |
| Gaise Baba | wp:africa | 807 | 36 |
| Chinese American Bear | wp:greater_china | 776 | 27 |
| Worrawech Danuwong | wp:sea | 722 | 6 |
| Aaron Kwok | wp:greater_china | 721 | 44 |
| Dead Peepol | wp:africa | 717 | 7 |
| Nikita Willy | wp:sea | 698 | 3 |
| Alam Lohar | wp:south_asia | 675 | 159 |
| Fiona Sit | wp:greater_china | 675 | 43 |
| Rahma Ali | wp:south_asia | 592 | 5 |
| Irfan Khan | wp:south_asia | 574 | 61 |
| Fredokiss | wp:africa | 568 | 13 |
| Buffalo Souljah | wp:africa | 558 | 24 |
| Kamiyado | wp:japan | 554 | 20 |
| Testimony Jaga | wp:africa | 500 | 63 |
| Ahmed Jahanzeb | wp:south_asia | 484 | 41 |
| Zoheb Hassan | wp:south_asia | 484 | 9 |
| Kisida Kyodan & The Akebosi Rockets | wp:japan | 471 | 11 |
| Shirley Kwan | wp:greater_china | 468 | 5 |
| Ekin Cheng | wp:greater_china | 450 | 35 |
| Satinder Satti | wp:south_asia | 448 | 4 |
| Ebisu Muscats | wp:japan | 444 | 20 |
| Elder Mireku | wp:africa | 442 | 30 |
| Salman Ahmad | wp:south_asia | 435 | 3 |
| Kary Ng | wp:greater_china | 414 | 12 |
| DJ Vyrusky | wp:africa | 397 | 16 |
| Kingzkid | wp:africa | 381 | 15 |
| Jack – J97 | wp:sea | 363 | 33 |
| Deon Boakye | wp:africa | 357 | 40 |
| Wang Feng | wp:greater_china | 355 | 4 |
| Chris Delvan Gwamna | wp:africa | 337 | 7 |
| Stephy Tang | wp:greater_china | 336 | 15 |
| Kiri T | wp:greater_china | 322 | 35 |
| Fiona Fung | wp:greater_china | 319 | 14 |
| Shiga Lin | wp:greater_china | 316 | 18 |
| Hardeep Grewal | wp:south_asia | 312 | 100 |
| Xu Wei | wp:greater_china | 301 | 78 |
| Andy Hui | wp:greater_china | 298 | 32 |
| Jordan Chan | wp:greater_china | 292 | 20 |
| Urashimasakatasen | wp:japan | 278 | 83 |
| Gin Lee | wp:greater_china | 269 | 42 |
| Nguyễn Trần Trung Quân | wp:sea | 253 | 46 |
| Piesie Esther | wp:africa | 251 | 16 |
| Nura M Inuwa | wp:africa | 248 | 47 |
| Raymond Lam | wp:greater_china | 247 | 21 |
| Malkoo | wp:south_asia | 247 | 168 |
| Shapla Salique | wp:south_asia | 238 | 1 |
| Paula Tsui | wp:greater_china | 237 | 22 |
| [anonymous] | listenbrainz | 231 | 91 |
| Ronald Cheng | wp:greater_china | 221 | 17 |
| Alon De Loco | wp:latin | 217 | 33 |
| Bisma Karisma | wp:sea | 212 | 11 |
| Humaira Arshad | wp:south_asia | 212 | 26 |
| Lu de la Tower | wp:latin | 212 | 22 |
| Faisal Kapadia | wp:south_asia | 205 | 19 |
| William So | wp:greater_china | 201 | 16 |

---

## 6. Previously reported entries — then vs now

### Artists

| Name | Originally reported | Now | Our row (RGs) |
|---|---|---|---|
| Masta Wu | 2026-07-14: zero artist row (feat-only collaborator) | present | Masta Wu (5) |
| Skyminhyuk | 2026-07-28: artist showed 0 releases (MB has none; iTunes 25) | present | Skyminhyuk (21) |
| P-Type | 2026-07-17: MB has 8 RGs vs ~35 on iTunes | present | P-Type (27) |
| Sean2Slow | 2026-07-17: 0 releases (genuinely no solo discography) | artist-empty | Sean2Slow (0) |
| lov3rboi | 2026-06-30: not on MusicBrainz (Deezer-only) | artist-missing | — |
| Gray | 2026-06-30 kr-scene no-match | present | Gray (11) |
| 그레이 | 2026-06-30 kr-scene no-match (Hangul) | artist-missing | — |
| Dean | 2026-06-30 kr-scene no-match | present | DEAN (19) |
| 딘 | Hangul form of Dean | artist-missing | — |
| BIBI | 2026-06-30 kr-scene no-match | present | BIBI (52) |
| 비비 | Hangul form of BIBI | present | ViVi (1) |
| Woo Won Jae | 2026-06-30 kr-scene no-match; 2026-07-14 refused by credit lane | artist-missing | — |
| 우원재 | Hangul form | present | 우원재 (24) |
| Sole | 2026-06-30 kr-scene no-match | present | Sole (53) |
| 쏠 | Hangul form of Sole | present | SOLE (30) |
| George | 2026-06-30 kr-scene no-match | present | 죠지 (10) |
| 죠지 | Hangul form of George | present | 죠지 (10) |
| BLASÉ | 2026-06-30 pinned in missing-artists | present | BLASÉ (28) |
| Jasmine Sokko | 2026-06-30 pinned in missing-artists | present | Jasmine Sokko (20) |
| Hate the Sun | 2026-06-30 kr-scene no-match | artist-missing | — |
| Loco | 2026-07-14 refused by credit lane | present | Loco (50) |
| 로꼬 | Hangul form of Loco | present | Loco (50) |
| 민수 | 2026-07-17: country-null KR artist missed by area lane | present | Minsu (4) |
| 음율 | 2026-07-17 area-lane gap | present | 음율 (20) |
| miiro | 2026-07-17 area-lane gap | present | Miiro (8) |
| Tiffany Day | 2026-08-18: covers missing on CONSTANTLY / Start Over | present | Tiffany Day (37) |
| Nawhij | 2026-07-28: hard-link recovery example | present | Nawhij (7) |
| Briakitten | 2026-07-28: first Spotify gap-fill test | present | Briakitten (2) |
| Lino | 2026-07-28: gap-filled artist | present | Lino (63) |
| fred again.. | 2026-06-30 search miss | present | Fred again.. (71) |
| 검정치마 | 2026-06-30 search miss (the black skirts) | present | 검정치마 (20) |
| SYSTEM SEOUL | Deezer-only artist | present | SYSTEM SEOUL (3) |
| Yoon Young-bae | 2026-09-25 baseline false positive (→ Neil Young) | artist-missing | — |
| Gonggonggu | 2026-09-25 baseline false positive (→ Gong) | artist-missing | — |
| Kim Ho-joong | 2026-09-25 baseline false positive | artist-missing | — |
| Jaedal | 2026-09-25 baseline: artist missing (3 list albums) | artist-missing | — |
| 大瀧詠一 | 2026-09-25 baseline: A Long Vacation | artist-missing | — |
| Black Skirt | 2026-09-25 baseline: 201 | artist-missing | — |
| ZICO | data/missing-artists.ts (hand-pinned MBID) | present | ZICO (30) |
| Paloalto | data/missing-artists.ts (hand-pinned MBID) | present | Paloalto (50) |
| Don Toliver | data/missing-artists.ts (hand-pinned MBID) | present | Don Toliver (32) |
| ksmartboi | data/missing-artists.ts (hand-pinned MBID) | present | ksmartboi (4) |
| OKASHII | data/missing-artists.ts (hand-pinned MBID) | present | OKASHII (5) |
| JMIN | data/missing-artists.ts (hand-pinned MBID) | present | JMIN (12) |
| BewhY | data/missing-artists.ts (hand-pinned MBID) | present | BewhY (31) |
| YANGHONGWON | data/missing-artists.ts (hand-pinned MBID) | present | YANGHONGWON (8) |
| BLASÉ | data/missing-artists.ts (hand-pinned MBID) | present | BLASÉ (28) |
| Jasmine Sokko | data/missing-artists.ts (hand-pinned MBID) | present | Jasmine Sokko (20) |
| Masta Wu | data/missing-artists.ts (hand-pinned MBID) | present | Masta Wu (5) |

### Albums

| Artist | Album | Originally reported | Now | Detail |
|---|---|---|---|---|
| Simon Dominic | ONYX | 2026-07-14: release gap under an owned artist | present | ONYX (album, itunes) |
| P-Type | Soulfire | 2026-07-17: MB lacks, iTunes has | present | Soulfire (album, itunes) |
| P-Type | Hardboiled Café | 2026-07-17: MB lacks, iTunes has | present | Hardboiled Café (album, itunes) |
| P-Type | THIS IS NOT AN ALBUM | 2026-07-17: MB lacks, iTunes has | album-missing | near: THIS IS NOT AN ALBUM (pt.1) - EP (ep) |
| Masta Wu | Father | 2026-07-10: search fallback false positive | present | Father (ep, musicbrainz) |
| JUSTHIS | 4 the Youth | 2026-06-30: collab credited to one artist only | present | 4 the Youth (album, musicbrainz) |
| Paloalto | 4 the Youth | 2026-06-30: collab — should show on both artists | present | 4 the Youth (album, musicbrainz) |
| NewJeans | Get Up | 2026-06-30: cover gap | present | Get Up (ep, musicbrainz) |
| Jerd | Bomm | 2026-09-25 baseline (on 3 lists) | album-missing |  |
| 실리카겔 | 실리카겔 | 2026-09-25 baseline | album-missing |  |
| Grateful Dead | American Beauty | 2026-09-25 baseline | album-missing |  |
| Nirvana | MTV Unplugged in New York | 2026-09-25 baseline | album-missing |  |
| Metallica | 72 Seasons | 2026-09-25 baseline | album-missing |  |
| 大瀧詠一 | A LONG VACATION | 2026-09-25 baseline | artist-missing |  |
| 검정치마 | 201 | 2026-09-25 baseline (Black Skirt) | present | 201 (album, musicbrainz) |
| 동물원 | 동물원 1집 | 2026-09-25 baseline | album-missing |  |
| 동물원 | 동물원 2집 | 2026-09-25 baseline | album-missing |  |
| Beenzino | Blurry | 2026-07-22: present, cover missing | present | Blurry (single, musicbrainz) |
| Tiffany Day | CONSTANTLY | 2026-08-18: cover missing | present | CONSTANTLY (single, musicbrainz) |

---

## 7. Discography completeness for priority artists

414 priority artists (list misses, earlier reports, Last.fm top 150, KR roster, top KR collaborators)
were compared with MusicBrainz's **official** album and EP release groups (`release-group-status=website-default`,
bootleg-only groups excluded), under the same policy as ingest (primary artist only, no live or remix).
29 of 414 priority artists have MB studio albums/EPs missing: 84 releases (after dropping 4 demo/bootleg-looking titles). "Ours" counts every type we hold, including singles.

| Artist | Country | Why checked | Ours / MB eligible | Missing studio albums & EPs (MB) |
|---|---|---|---|---|
| Bruce Springsteen | US | list miss: Magic | 115 / 62 | Human Touch (1992); The Ghost of Tom Joad (1995); Letter to You (2020); Magic (2007); Working on a Dream (2008); Western Stars (2019); Lucky Town (1992); Devils & Dust (2005); Only the Strong Survive: Covers, Vol. 1 (2022); Wrecking Ball (2012); High Hopes (2014); Lonesome Day (2002) [EP]; The Ghost of Tom Joad (1995) [EP]; American Beauty (2014) [EP]; Blood Brothers (1996) [EP] |
| The Rolling Stones | GB | list miss: A Bigger Bang | 677 / 491 | A Bigger Bang (2005); Blue & Lonesome (2016); Foreign Tongues (2026); Everybody Needs Somebody to Love (2022) [EP]; A Little Bang (Bigger Bang Tour EP) (2021) [EP]; Extra Bonus (2014) [EP]; The Rolling Stones on TV Show in '60s (1999) [EP]; Confessin’ the Blues (Influences – Vol. 1) (2022) [EP]; Tumbling Dice (2010) [EP]; Top of the Pops '67 (2022) [EP]; Can I Get a Witness (Influences – Vol. 3) (2023) [EP]; The Singles 1963 (2014) [EP]; That’s How Strong My Love Is (2022) [EP]; Torn Up (2022) [EP] |
| Bob Dylan | US | Last.fm top (4382961 listeners) | 211 / 175 | Christmas in the Heart (2009); Together Through Life (2009); Fallen Angels (2016); Tempest (2012); Rough and Rowdy Ways (2020); Shadows in the Night (2015); Triplicate (2017); Melancholy Mood (2016) [EP] |
| David Bowie | GB | list miss: Blackstar | 259 / 111 | Is It Any Wonder? (2020) [EP]; Brilliant Adventure EP (2022) [EP]; Fun Mix (2022) [EP]; Toy E.P. (2022) [EP]; The Width of a Circle (2021) [EP]; No Plan (2017) [EP] |
| Prince | US | list miss: Sign o' the Times | 248 / 59 | Art Official Age (2014); HITnRUN Phase Two (2015); Welcome 2 America (2021); HITnRUN Phase One (2015); PLECTRUMELECTRUM (2014) |
| Pearl Jam | US | list miss: Dark Matter | 123 / 21 | Gigaton (2020); Dark Matter (2024); The Last of Us (2025) [EP] |
| Metallica | US | list miss: 72 Seasons | 137 / 29 | 72 Seasons (2023); Leftovers From the Black Album Box Set (2023) [EP]; Language of the Mad [EP] |
| Jeff Mills | ? | list miss: Live at the Liquid Room, Tokyo | 137 / 127 | Str Mrkd (2019) [EP]; The Kill Zone EP (2016) [EP]; Morning Glory (2023) [EP] |
| Taylor Swift | US | list miss: The Tortured Poets Department | 174 / 41 | THE TORTURED POETS DEPARTMENT (2024); The Life of a Showgirl (2025) |
| deadmau5 | CA | list miss: 4x4=12 | 207 / 38 | 7 (2013) [EP]; Get Scraped (2005) |
| Paloalto | ? | previously reported | 57 / 15 | 발자국 (2004) [EP]; 정신건강 (2026) |
| The Beatles | GB | Last.fm top (6674591 listeners) | 285 / 211 | Get Back (take 8) (2021) [EP]; Strawberry Fields Forever (1967) [EP] |
| Pink Floyd | GB | Last.fm top (5683566 listeners) | 145 / 53 | The Endless River (2014); 1965: Their First Recordings (2015) [EP] |
| BIG Naughty | KR | KR scene roster | 51 / 9 | ++ (2024) [EP]; Hopeful Romantic (2026) [EP] |
| SG Wannabe | KR | list miss: 죄와 벌 | 46 / 13 | SG Wannabe 7 Part.II [EP] |
| Tony Bennett | US | list miss: MTV Unplugged | 251 / 193 | The Singles Collection (2006) |
| Depeche Mode | GB | list miss: Memento Mori | 137 / 50 | Memento Mori (2023) |
| KISS | ? | list miss: Alive! | 167 / 64 | Solos |
| Arca | ES | list miss: Jacobin | 54 / 18 | XXXXX (2026) |
| D.O. | KR | list miss: Empathy | 12 / 6 | DOPAMINE (2026) [EP] |
| 영탁 | KR | list miss: Mmm | 1 / 2 | GOGO (2026) |
| Lana Del Rey | US | Last.fm top (5447143 listeners) | 73 / 13 | Kill Kill (2008) [EP] |
| U2 | IE | Last.fm top (5120674 listeners) | 217 / 41 | Carnaval De Luz (2026) |
| Elvis Presley | US | Last.fm top (4604883 listeners) | 634 / 832 | Christmas With Elvis Presley (2008) |
| Snoop Dogg | ? | Last.fm top (4517026 listeners) | 301 / 83 | Dubb Union (2008) |
| Swings | KR | KR scene roster | 66 / 7 | Detergent Hymns (2015) |
| Colde | KR | KR scene roster | 19 / 5 | ICY BABY (2026) |
| wave to earth | ? | KR scene roster | 14 / 5 | bad pieces (2026) |
| The Volunteers | KR | KR scene roster | 5 / 4 | i love u (2026) |

### 7.1 Deezer-only candidates

269 priority artists have Deezer albums/EPs with no title match in our catalog (1701 releases; includes editions and title-language drift, so treat as candidates). Top 80 by count:

| Artist | Country | Ours | Deezer album+EP | Unmatched Deezer titles (first 12) |
|---|---|---|---|---|
| Glenn Gould | CA | 72 | 131 | Recording Glenn Gould's Goldberg Variations - Track-by-Track by Producer Richard Einhorn (2022); GLENN GOULD - THE RYUICHI SAKAMOTO SELECTION [Complete Version] (2022); Gould & Bach: Perfect Match (2022); Glenn Gould: Concert Dropout (Gould Remastered) (2015); Glenn Gould über Johann Sebastian Bach (2015); Glenn Gould Discusses His Goldberg Variations With Tim Page (Gould Remastered) (2015); Bach: Toccatas Vol. 1, BWV 910, 912 & 913 (Gould Remastered) (2015); Bach: The Well-Tempered Clavier, Book I, Preludes & Fugues Nos. 17-24, BWV 862-869 (Gould Remastered) (2015); Bach: Toccatas Vol. 2, BWV 911 & 914-916 (Gould Remastered) (2015); Haydn: The Six Last Piano Sonatas (Gould Remastered) (2007); Beethoven: Piano Concerto No. 3 in C Minor, Op. 37 (2015); Hindemith: Complete Sonatas for Brass and Piano (Gould Remastered) (2015) |
| Allan Sherman | US | 20 | 300 | Crazy Christmas Music (2026); My Complete Extended & Expanded Special Deluxe Greatest Hits Album (2026); #1s (2026); The Cat In The Hat and Other Dr. Seuss Stories – Bonus Edition (2025); Cat in the Hat and Other Dr. Seuss Stories – Bonus Edition (2025); Allan Sherman Is the Cat in the Hat and Other Dr Seuss Stories – Bonus Edition (2025); Peter and the Commissar (funny Peter and the Wolf) (2024); Nutty but Nice (Not Naughty but Nice) - Vol 1 (2024); Nutty but Nice (Not Naughty but Nice) - Vol 2 (2024); Nutty But Niice (2024); Ones (2024); My Complete Extended & Expanded Remastered & Reissued Special Deluxe Limited Edition Greatest Hits (2024) |
| David Bowie | GB | 259 | 116 | The Shel Talmy Recordings (2026); The Heart’s Filthy Lesson Mix E.P. (2025); I Can't Give Everything Away (2002 - 2016) (2025); Rock 'n' Roll Star! (2024); Divine Symmetry (2022); Moonage Daydream – A Brett Morgen Film (2022); Little Wonder Mix E.P. (Junior Vasquez Mixes) (2022); Dead Man Walking Mix E.P. (2022 Remaster) (2022); Toy (Toy:Box) (2022); Brilliant Adventure (1992 – 2001) (2021); The Width Of A Circle (2020); ChangesNowBowie (2020) |
| H2O | KR | 1 | 44 | Lost in Naples Original Soundtrack (2026); H2O (30th Anniversary) (2026); PROTOTYPE. (2026); Splash (2026); 竹林七贤·电子觉醒 The Seven Sages: Electronic Awakening (2026); Divine Intervention (2026); H2O 45th Anniversary Best Selection (2025); Highest Perspective (2024); adultswim. (2024); Just Add Water (2021); New Horizons (2021); Trance Illusion (2021) |
| Bruce Springsteen | US | 115 | 71 | Nebraska '82: Expanded Edition (2025); Tracks II: The Lost Albums (2025); Land Of Hope & Dreams (2025); Bruce Springsteen & The E Street Band - Road Diary (2024); Bruce Springsteen & The E Street Band - The Reunion Tour '99 (2024); Bruce Springsteen & The E Street Band - The Born in the U.S.A. Tour '84 - '85 (2024); Best of Bruce Springsteen (Expanded Edition) (2024); Bruce Springsteen & The E Street Band - The Darkness Tour '78 (2023); Only the Strong Survive (2022); Bruce Springsteen & The E Street Band - The Legendary 1979 No Nukes Concerts (2021); Letter To You (2020); Western Stars - Songs From The Film (2019) |
| Bob Dylan | US | 211 | 82 | Through The Open Window: The Bootleg Series Vol. 18 (Highlights) (2025); Mixing Up The Medicine / A Retrospective (2023); Shadow Kingdom (2023); Fragments - Time Out of Mind Sessions (1996-1997): The Bootleg Series, Vol. 17 (2023); Springtime in New York: The Bootleg Series, Vol. 16 / 1980-1985 (2021); The Best of The Bootleg Series (2020); Rough and Rowdy Ways (2020); Travelin' Thru, 1967 - 1969: The Bootleg Series, Vol. 15 (Sampler) (2019); More Blood, More Tracks: The Bootleg Series, Vol. 14 (Sampler) (2018); Triplicate (Sampler) (2017); Triplicate (2017); Fallen Angels (2016) |
| SOLE | KR | 32 | 31 | MBFX (2021); Best of Mansbestfriend (2021); worlds not yet gone (2020); No God Nor Country (2019); Destituent (2019); Let Them Eat Sand (2018); Nihilismo (2016); mansbestfriend 7 (2015); Crimes Against Totality (2013); No Wising up No Settling Down (2013); A Ruthless Criticism Of Everything Existing (2012); Hello Cruel World (2011) |
| James Brown | US | 348 | 105 | Black & Loud: James Brown Reimagined By Stro Elliot (2022); Get On Up - The James Brown Story (Original Motion Picture Soundtrack) (2026); The Singles Vol. 10 1975-1979 (2011); The Singles: Vol. 9 1973-1975 (2010); The Singles Vol. 8: 1972-1973 (2009); The Singles Vol. 7: 1970-1972 (2009); The Singles Vol. 6: 1969-1970 (2009); The Singles Vol. 5: 1967-1969 (2018); The Singles Vol. 4: 1966-1967 (2018); The Singles Vol. 3: 1964-1965 (2018); The Singles Vol. 2 1960-1963 (2007); The Singles Vol. 1: 1956-1960 The Federal Years (2015) |
| The Rolling Stones | GB | 677 | 79 | Foreign Tongues (2026); Honk (Deluxe) (2020); On Air (Deluxe) (2017); Blue & Lonesome (2016); A Bigger Bang (2009 Re-Mastered) (2009); Forty Licks (2023); The Rolling Stones Rock And Roll Circus (Expanded) (2019); Stripped (2009 Re-Mastered Digital Version) (2009); Flashpoint (2009 Re-Mastered Digital Version) (2009); Undercover (2009 Re-Mastered) (2008); Still Life (2009 Re-Mastered Digital Version) (2009); Tattoo You (2009 Re-Mastered) (2008) |
| Lacuna | KR | 12 | 30 | Stardrift Mix (2024); DEAF (2024); Ruptura (Lacuna 7 Year Anniversary) (2023); Saligia (2023); TEST (2022); MUTE (2022); Lacuna (2021); Strains (2017); Celebrate the Summer 2016 (2016); Talk on the Step (2013); Celebrate the Summer (Club-Edition) (2012); Oceangoing (2010) |
| Tony Bennett | US | 251 | 83 | My Favorite Things: Christmas Songs (2021); Tony Bennett Celebrates 90 (2016); Sings The American Songbook, Vols. 1 - 4 (2013); Rarities, Outtakes & Other Delights, Vol. 1 (2012); The Best of the Improv Recordings (2011); A Swingin' Christmas (feat. Count Basie Big Band) (2008); Tony Bennett Sings For Lovers (2020); Bennett Sings Ellington / Hot And Cool (1999); Sings The Rodgers & Hart Songbook (2006); Tony Bennett On Holiday: A Tribute To Billie Holiday (1997); MTV Unplugged (2006); Sunrise, Sunset (1973) |
| John Coltrane | US | 367 | 104 | A Love Supreme: The Platinum Collection (2021); On Impulse: John Coltrane (2021); Chasing Trane: The John Coltrane Documentary (Original Soundtrack) (2017); The Atlantic Years in Mono (2016); The Art of the Saxophone (2013); Sun Ship: The Complete Session (2013); The Definitive John Coltrane On Prestige And Riverside (2010); My Favorite Things: Coltrane At Newport (2007); Prestige Profiles: John Coltrane (2006); John Coltrane: Ken Burns's Jazz (2017); The Complete 1961 Village Vanguard Recordings (2018); Heavyweight Champion: The Complete Atlantic Recordings (1995) |
| Barbra Streisand | ? | 122 | 73 | The Music...The Mem'ries...The Magic! (2017); Back to Brooklyn (2013); What Matters Most Barbra Streisand Sings The Lyrics Of Alan & Marilyn Bergman (2011); One Night Only: Barbra Streisand and Quartet at the Village Vanguard - September 26, 2009 (2010); The Essential Barbra Streisand (2002); The Mirror Has Two Faces - Music From The Motion Picture (1996); The Concert (1994); On A Clear Day You Can See Forever: Original Soundtrack Recording (1993); The Prince Of Tides: Original Motion Picture Soundtrack (1991); Nuts - Original Score from the Motion Picture (1987); One Voice (1987); Yentl (1986) |
| Cool | KR | 30 | 37 | Daytona Sunsets (2026); God Still Good (2026); NewAttempt (2025); Happy Birthday Cool (Aquarius Season) (2025); Despite of Everything (2024); Alone not Lonely (2023); Allwell (2023); Lit Lord (2022); Lavish Loner (2021); SEVEN DAYS (2021); Self Preservation (2020); Cooler Than Ever (2019) |
| Prince | US | 248 | 68 | Timeless (2026); Welcome 2 America (2021); Originals (2019); Piano & A Microphone 1983 (2018); Anthology: 1995-2010 (2018); 4Ever (2016); HITNRUN Phase Two (2018); HITNRUN Phase One (2015); Art Official Age (2014); Plectrumelectrum (2014); Rock and Roll Love Affair (2012); MPLSoUND (2009) |
| B‐Free | KR | 26 | 29 | B-Free (Strap Music Clip One) (2025); FREE THE MANE 3 “FREE THE MANE VS B-FREE” (2025); Millennial Symphony (2025); FREE THE MANE 2 "FREE THE MANE VS 최승로" (2024); Free Hukky Shibaseki & the God Sun Symphony Group : Odyssey.1 (2024); FREE THE MANE "END OF AMEN" (2023); FREE THE BEAST 3 B-FREE vs KOREA (2022); FREE THE BEAST 2 (2022); Ode 2 a Luv Affair (2016); Nightmare Project (2013); Open Mic, Open Heart (2012); How to Make a Mixtape (2011) |
| Depeche Mode | GB | 137 | 76 | Memento Mori: Mexico City (2025); Spirit \| The 12" Singles (2024); Delta Machine \| The 12" Singles (2023); Sounds of The Universe \| The 12" Singles (2023); Memento Mori (2023); Playing The Angel - The 12" Singles (2022); Exciter \| The 12" Singles (2022); Ultra \| The 12" Singles (2022); Songs of Faith and Devotion \| The 12" Singles (2022); Violator \| The 12" Singles (2022); The Best of Depeche Mode, Vol. 1 (2006); DMBX6 (2018) |
| HD BL4CK | KR | 6 | 22 | Confessio (2026); Heat Haze (2026); DREAMS TRILOGY (2026); Dustyrose Dreams (2025); 2.0 D (2025); 2025 (2025); HD Late Night Radio (2024); Vantablack Dreams (2024); A prescription for 2 (2024); Skyblue Dreams (2023); Dark Adaptation (2023); Idiot Soul (2023) |
| QM | KR | 27 | 29 | Drank Sinatra (2026); Sausalito (2025); Vault Music (2008-2013) (2025); Unreleased Japan EP 2005/2006 (2023); Year (2023); LOVE. (2023); SVN (2023); 12/21/12 (2023); Take Me To Your Liter (10 yr Anniversary Edition) (2023); Reign Clouds (2023); Different World (2024); Snake Mountain Crew (The QM Version) (2021) |
| ViVi | KR | 1 | 17 | Flaws and Biggest Fears (2026); Inflection Point (2025); All Nighters (2025); 太空群落 电影原声带 (2025); CULT (2025); Get Rich or Die (2024); Lyrical Skylines (2023); Helly (2016); Perennial (2025); Double Helix (2024); 2WICKS (2024); Not a Love Letter (2024) |
| deadmau5 | CA | 207 | 50 | Jaded (2024); Kx5 (2023); here's the drop! (2019); deadmau5 At Play, Vol. 5 (2015); At Play Vol. 4 DJ Mix (2013); Hey Baby 2012 (2012); At Play Vol. 3 DJ Mix (2010); At Play DJ Mix (2010); At Play Vol. 2 DJ Mix (2010); 4x4=12 (2010); Sex Slave Melleefresh vs 13 DJs (2010); For Lack of A Better Name (The Extended Mixes) (2009) |
| BRWN | KR | 3 | 18 | LIGHT SKIN (2026); Monsoon (2024); LVRBOY (2024); Yours Truly (2023); You Got My Time (2021); Muse (2020); Burn Down This House (2020); The Black Dessert 2 (2019); RENDEZVOUS (2019); IN TRANSIT (2026); ECHOES (2026); Lean on me (2020) |
| G.O.D | KR | 9 | 16 | SOWHEREDOESITEND (2026); Gangsters On Drugs (2026); G.O.D (MIXTAPE) (2025); Highs And Lows Part 1 (2023); Highs And Lows Pt 1 (2023); 420 ANTHEM (2024); 20th Anniversary G.O.D (2020); AMR Miami 2018 (2018); CHROME HEARTS (2025); NO TRIMM (2025); Gangster OverDose (2024); Demo (2024) |
| Paloalto | ? | 57 | 17 | Les Furtifs, émeute musicale (2026); The Persistence Of Memory (Early Tapes 1990-1993) (2025); Difference and Repetition, a Musical Evocation of Gilles Deleuze (2020); Le Clos (2020); Le souffle du vide (2020); Music Inspired by Mondocane (2018); Time Capsule / 1990 - 2010 (2018); Crash Test (2018); Pogs Box (2001); Transe Plan (2010); Grands succédanés (1992); In Broken Breath (2025) |
| The Beatles | GB | 285 | 40 | Anthology 4 (2025); Anthology Collection (2025); Free As A Bird (2025 Mix) (2025); Get Back (Rooftop Performance) (2022); Love (2016); Let It Be... Naked (Remastered) (2018); 1 (Remastered) (2015); Yellow Submarine Songtrack (2018); Anthology 3 (2016); Anthology 2 (2016); Anthology 1 (2016); Past Masters (Vols. 1 & 2 / Remastered) (2015) |
| Judy Garland | US | 162 | 39 | The Very Best Of Judy Garland (2007); The Essential Capitol Collection (2011); The Definitive Collection (2006); 20th Century Masters: The Best Of Judy Garland Millennium Collection (2018); Great Ladies Of Song: Spotlight On Judy Garland (1996); Best Of Judy Garland (2003); The Complete Decca Masters (Plus) (2013); The London Sessions: The Best Of The Capitol Masters (1992); I Could Go On Singing (2021); Judy At Carnegie Hall (2010); Garland At The Grove (2010); Greatest Performances Original Recordings (2019) |
| Eric Clapton | GB | 218 | 56 | A Night Of Blues (2016); Give Me Strength: The ‘74/’75 Studio Recordings (2013); Chronicles (2005); The Best Of Eric Clapton 20th Century Masters The Millennium Collection (2005); Eric Clapton Blues (1999); Pavarotti & Friends for War Child (1996); Rush (Music from the Motion Picture Soundtrack) (1992); Journeyman: Deluxe Edition (1989); Just One Night (1996); Slowhand 35th Anniversary (Super Deluxe) (2012); E.C. Was Here (1996); 461 Ocean Blvd. (Deluxe Edition) (2004) |
| Pink Floyd | GB | 145 | 43 | 8-Tracks (2026); Wish You Were Here 50 (2025); The Later Years 1987-2019 (2019); The Later Years (2019); 1972 Obfusc/ation (2017); 1968 Germin/ation (2017); 1970 Devi/ation (2017); 1965-67 Cambridge St/ation (2017); 1969 Dramatis/ation (2017); 1971 Reverber/ation (2017); The Early Years, 1967-1972, Cre/ation (2016); The Endless River (2014) |
| John Lennon | GB | 107 | 37 | Plastic Ono Band (The Ultimate Collection) (2021); Mind Games (The Elements Mixes) (2024); Mind Games (The Ultimate Mixes) (2024); Mind Games (The Ultimate Collection) (2024); Mind Games (The Elemental Mixes) (2024); Mind Games (The Evolution Documentary) (2024); Mind Games (The Raw Studio Mixes) (2024); Mind Games (The Out-takes) (2024); Imagine (The Ultimate Collection) (2018); Imagine (The Ultimate Mixes) (2018); Imagine (The Elements Mixes) (2023); Imagine (The Evolution Documentary) (2023) |
| EK | KR | 5 | 14 | Mandeep singh (2026); Desolate (2025); Civilized Savage (2023); Rab (2018); Ek (2014); Näktergalen (2014); Keep It Casual (2004); CLIMAXX (2026); PSF by Majintotti (2025); The Path (2024); VITAL (2024); Te Canto (2024) |
| Justice | FR | 42 | 13 | The Just-Ice Chronicles (2017); Back to the Old School (2016); The Desolate One (2016); Masterpiece (2016); Sir Vicious: The Best of Just-Ice (2013); 32 Degrees (2010); VII (2008); Gangster Boogie (2008); Kool & Deadly (Justicisms) (2016); The Just-Ice and Krs-One EP, Vol. 1 (2010); Somoshitbyjust-Ice (1989); The Music / Slow, Low, and Dope (1989) |
| Nina Simone | ? | 324 | 39 | The Very Best Of Nina Simone 1967-1972 - Sugar In My Bowl (1998); A Single Woman: The Complete Elektra Recordings (1993); It Is Finished (Expanded Edition) (2012); Emergency Ward (Expanded Edition) (2012); Black Gold (Expanded Edition) (2012); 'Nuff Said (Expanded Edition) (2012); Nina with Strings (2005); Folksy Nina (2005); At Carnegie Hall (2005); Nina at the Village Gate (2012); At Newport (2005); Nina Simone and Her Friends (Remastered 2013) (2024) |
| Jimi Hendrix | US | 203 | 36 | Songs For Groovy Children: The Fillmore East Concerts (2019); Electric Ladyland - 50th Anniversary Deluxe Edition (2018); Miami Pop Festival (2013); People, Hell & Angels (2013); Winterland (2011); Axis: Bold As Love (2010); Smash Hits (2010); Blue Wild Angel: Jimi Hendrix At The Isle Of Wight (2010); The Jimi Hendrix Experience (Deluxe Reissue) (2013); BBC Sessions (2010); Hendrix In The West (2011); Are You Experienced (2002) |
| The Beach Boys | US | 388 | 82 | We Gotta Groove - The Brother Studio Years (Super Deluxe Edition) (2026); The Very Best Of The Beach Boys: Sounds Of Summer (Expanded Edition Super Deluxe) (2022); The Beach Boys’ Party! Uncovered And Unplugged (2015); 50 Big Ones: Greatest Hits (2012); Hawthorne, CA (2018); Best Of The Brother Years 1970-1986 (2003); Endless Harmony Soundtrack (2000); The Beach Boys In Concert (2000); Carl & The Passions - So Tough (Remastered) (2012); Shut Down, Vol. 2 (Remastered) (2012); The Beach Boys Love Songs (2006); Good Vibrations 40th Anniversary (2006) |
| Verbal Jint | KR | 31 | 27 | HAPPY END acapellas (2025); HAPPY END (2025); K-XY : INFP (2023); Inflection Point (acapellas) (2021); Inflection Point (2021); 20 Acapellas (2020); 17 Acapellas (2017); 10 Years of Misinterpretation Part I (2012); 2 The Hard Way (2010); Year End Report (2019); Is It Music Or Is It A Report (2019); No Excuses (2017) |
| NELL | KR | 56 | 12 | Rowing Forwards (2023); The Screw Tape (2020); A Million Faces (2019); Since We Never Talk... (2018); Raider Klan Resurrection (2018); 90's Mentality (2017); Lazy Dreamer (2016); 2nd Nell: The Life in Rhyme of Tony Tendernelli AKA Nelson Breadfruit (2013); The Pessimist (2012); The Book of: Nell (2011); AU PLUS VITE (2025); Boyz n the Hood (2020) |
| KISS | ? | 167 | 55 | KISS Off The Soundboard: Tokyo 2001 (2021); KISSWORLD - The Best Of KISS (2019); KISS 40 (2014); The Complete Collection (2008); The Best Of Kiss Vol. 3 20th Century Masters The Millennium Collection (2010); Gold (2004); The Best Of KISS - Volume 2 20th Century Masters The Millennium Collection (2004); The Best of Kiss 20th Century Masters The Millennium Collection (2007); KISS Box Set (2002); MTV Unplugged (1993); Destroyer (Resurrected) (2012) |
| Mild Beats | KR | 2 | 13 | Dark Blue Almost Black (2024); Fragment (2021); Never Sold Out (Remastered) (2018); Beautiful Struggle (2013); 煙雨 (2011); Still Ill (2010); Back Again (2008); Message From Underground 2006 (2006); 탯줄 (2015); Daily Works (2014); Touch of Memories (2013) |
| Michael Jackson | US | 162 | 34 | Immortal (2011); Michael Jackson's This Is It (2009); The Stripped Mixes (2009); Pure Michael: Motown A Cappella (2009); 20th Century Masters: The Millennium Collection: Best of Michael Jackson (2001); BLOOD ON THE DANCE FLOOR/ HIStory In The Mix (1997); Bad 25th Anniversary (2012); Anthology: The Best Of Michael Jackson (1995); Thriller 25 Super Deluxe Edition (2008); Thriller 40 (2022); Love Never Felt So Good (David Morales and Eric Kupper Def Mix) (2014) |
| David Guetta | ? | 211 | 55 | 7: Anniversary Edition (2018); Listen Again (2015); Titanium (feat. Sia) (2012); Nothing but the Beat - The Electronic Album (2011); Nothing but the Beat 2.0 (2011); One More Love (2010); Rock The Disco (2010); Memories (feat. Kid Cudi) (2010); I’m Good (Blue) (The Complete Collection) (2023); Episode 2 (Extended Mix) (2022); New Rave (Extended) (2020) |
| BIG Naughty | KR | 51 | 15 | Reach For The Moon 2 (2026); Emotional Knocks (2024); Reach for the Moon (2023); ICN > YVR (2023); Doona! (Music from The Netflix Series) (2023); King Me (2023); Hopeless Romantic (2023); Bunny (2022); NANGMAN (2022); Hopeful Romantic (2026); ＋ (2024) |
| Taylor Swift | US | 174 | 45 | The Life of a Showgirl: The Encore (2026); The Life of a Showgirl (2025); The Life of a Showgirl + Acoustic Collection (2025); THE TORTURED POETS DEPARTMENT (2024); THE TORTURED POETS DEPARTMENT: THE ANTHOLOGY (2024); folklore: the long pond studio sessions (from the Disney+ special) (deluxe edition) (2020); Fearless Platinum Edition (2009); THE TORTURED POETS DEPARTMENT \| TS The Eras Tour Setlist (2024); The Cruelest Summer (2023); The Taylor Swift Holiday Collection (2018) |
| Sole | US | 53 | 31 | Best of Mansbestfriend (2021); Hello Cruel World (2011); Plastique (2009); Sole & The Skyrider Band (2007); Mansbestfriend 4: Poly.Sci.187 (2007); Mansbestfriend Pt. 3 (2004); Mansbestfriend Pt. 1 (2002); mansbestfriend 2 (2003); The Taste of Rain... Why Kneel (1999); The Challenger EP (2011) |
| The Weeknd | CA | 126 | 30 | Dawn FM (Alternate World) (2022); Echoes Of Silence (Original) (2021); Thursday (Original) (2021); House Of Balloons (Original) (2021); K-POP (Chopped & Screwed) (2023); The Idol Episode 5 Part 1 (Music from the HBO Original Series) (2023); The Idol Episode 4 (Music from the HBO Original Series) (2023); The Idol Episode 3 (Music from the HBO Original Series) (2023); The Idol Episode 2 (Music from the HBO Original Series) (2023); The Idol Episode 1 (Music from the HBO Original Series) (2023) |
| Marvin Gaye | US | 211 | 67 | I Want You: The John Morales M+M Mixes (2022); Funk Me (2019); Gold (2009); Classic - The Universal Masters Collection (2007); 20th Century Masters: The Millennium Collection-Best Of Marvin Gaye-Volume 1-The 60's (1999); Lost & Found: Love Starved Heart - Expanded Edition (1999); Anthology: The Best Of Marvin Gaye (2018); In Our Lifetime? Expanded Love Man Edition (2007); Trouble Man: 40th Anniversary Expanded Edition (2012); What’s Going On: The Detroit Mix (2021) |
| unofficialboyy | ? | 2 | 10 | Saecheonnyeon (2026); AT THE HIGH CASTLE (2025); TRUE (2023); MYEdrugonline (2023); unofficailboyyackermann (2021); Net,Trap,Launcher,Capture (2021); drugonline (2020); unofficialboyy (2019); i (2022) |
| Sam Cooke | US | 154 | 25 | Sam Cooke: Portrait Of A Legend 1951-1964 (2024); The Last Mile Of The Way (2006); SAR Records Story (2005); Jesus Gave Me Water (2006); The 2 Sides Of Sam Cooke (2009); Sam Cooke And The Soul Stirrers (2006); Soul Revue (2023); Reflection (2021); Soulful Inspiration (2021) |
| Jerry.K | KR | 2 | 10 | Home (2020); OVRWRT (2017); Emotional Labor (2016); DOPE DYED (2013); TRUE SELF (2012); 마왕 (2008); RED QUEEN THEORY (2019); 연애담 (2012); 연애담 : 생각해 볼만한 사랑 이야기 (2012) |
| Lino | KR | 63 | 11 | Baby Jester 2 (Deluxe) (2025); DERTY (2025); Alter Ego (2023); Baby Jester (2023); Pilot (2022); NOIRE (2026); She Loves Me Not (2026); Tables Turn, Bridges Burn (2025); Still Jester (2024) |
| Weezer | US | 123 | 32 | Superman (Garage Practice) / The BBC Tracks / Undone – The Sweater Song (Third Practice) (2024); Weezer (Black Album) (2019); Weezer (Teal Album) (2019); Weezer (White Album) (2016); Weezer (Red Album) (2008); Weezer (Green Album) (2001); Weezer 30 (Anniversary Super Deluxe) (2024); Weezer (Blue Album) (1994); BBC Recordings / Undone - The Sweater Song (Third Practice) (2024) |
| Elton John | ? | 284 | 69 | Step Into Christmas (2023); The Captain and The Kid (2006); One Night Only (2000); The Road To El Dorado (Original Motion Picture Soundtrack) (2016); Pavarotti & Friends for War Child (1996); Here And There (2007); Honky Chateau (1995); 17-11-70 (1971); We All Fall In Love Sometimes (Session Demo) (2025) |
| Kraftwerk | DE | 85 | 13 | 3-D The Catalogue (2017); 3-D Der Katalog (German Version) (2017); Minimum - Maximum (2005); The Mix (2009 Remaster) (2005); Techno Pop (2009 Remaster) (1986); Computer World (2009 Remaster) (2014); The Man-Machine (2009 Remaster) (2009); Radio-Activity (2009 Remaster) (2009) |
| Aretha Franklin | US | 300 | 32 | A Natural Woman... in Sweden (2022); Respect - The Very Best Of (2017); Precious Lord - feat. Rev. C.L. Franklin (2009); Dance Vault Mixes - (Pride) A Deeper Love (2021); Aretha Franklin : Do Right Woman (2003); One Lord, One Faith, One Baptism (2014); Aretha In Person with The Ray Bryant Combo (Expanded Edition) (2022); Love and Respect (2025) |
| Calvin Harris | ? | 92 | 49 | Thinking About You (feat. Ayah Marar) (2013); We'll Be Coming Back (feat. Example) (2013); Bounce (feat. Kelis) (2013); Moving (2020); I'm Not Alone 2019 (2019); Sweet Nothing (feat. Florence Welch) (2012); Let's Go (feat. Ne-Yo) (2012); Dance Wiv Me [feat. Calvin Harris and Chrome] (2009) |
| Mariah Carey | US | 145 | 70 | Rainbow: 25th Anniversary Expanded Edition (2024); Music Box: 30th Anniversary Edition (2023); Butterfly: 25th Anniversary Expanded Edition (2022); Merry Christmas: 30th Anniversary Edition (2024); I'm That Chick - EP (2021); Your Girl - EP (2021); I Only Wanted - EP (2021); MTV Unplugged EP (1992) |
| Billy Joel | US | 110 | 37 | 2000 Years - The Millennium Concert (2000); Greatest Hits Vol. III (2001); Songs In the Attic (1981); Billy Joel - Rebels (2022); Billy Joel - Moods (2022); Billy Joel - Memories (2022); Billy Joel - Narratives (2022); Billy Joel - Places (2022) |
| The Neighbourhood | GB | 2 | 13 | (((((ultraSOUND)))))+ (2026); Chip Chrome & The Mono-Tones (2020); Hard To Imagine The Neighbourhood Ever Changing (2018); Wiped Out! (2015); #000000 & #FFFFFF (No DJ Version) (2014); I Love You. (2013); The Love Collection (2013); I'm Sorry... (2013) |
| Stevie Wonder | US | 142 | 45 | Number 1's (2007); Natural Wonder (1995); Music From The Movie "Jungle Fever" (1992); Selections From The Original Soundtrack The Woman In Red (1984); Original Musiquarium (2000); Journey Through The Secret Life Of Plants (2019); Stevie Wonder's Greatest Hits, Vol.2 (1998); Up-Tight (2004) |
| Led Zeppelin | GB | 119 | 28 | An Introduction to Led Zeppelin (2018); Led Zeppelin x Led Zeppelin (2018); Celebration Day (2012); Mothership (Remastered) (2013); How the West Was Won (Remaster) (2003); The Complete BBC Sessions (Remastered) (2016); The Song Remains the Same (Remaster) (2018) |
| Pearl Jam | US | 123 | 23 | Dark Matter (2024); Give Way (2023); Gigaton (2020); MTV Unplugged (2020); Pearl Jam Twenty Original Motion Picture Soundtrack (2011); Pearl Jam (2017 Mix) (2017); Ten Redux (2013) |
| PJ Morton | US | 24 | 25 | Sunday Morning (2026); Saturday Night (2026); Dr. Seuss's Red Fish, Blue Fish (Songs from the World of the Netflix Series) (2025); HEART OF MINE (2025); Pardon Me, I'm Different (2025); Gospel According To PJ (2020); Emotions: Special Edition (2005) |
| Alicia Keys | US | 95 | 33 | The Diary Of Alicia Keys 20 (2023); Queen Charlotte: A Bridgerton Story (Covers from the Netflix Series) (2023); KEYS II (2022); Alicia Keys - VH1 Storytellers (2013); Unplugged (2005); Vault Volume 1 (2017); Diary (Dance Vault Mixes) - EP (2006) |
| The Allman Brothers Band | US | 68 | 39 | One Way Out (2004); Peakin' at the Beacon (2000); 20th Century Masters: The Millennium Collection: The Best Of The Allman Brothers (2009); An Evening with The Allman Brothers Band: 2nd Set (1995); An Evening with The Allman Brothers Band: First Set (1992); The 1971 Fillmore East Recordings (2014); At Fillmore East (2016) |
| George Michael | ? | 77 | 19 | George Michael & Wham! Last Christmas: The Original Motion Picture Soundtrack (2019); Symphonica (Deluxe Version) (2014); Flawless (Go to the City) (2004); Ladies & Gentlemen (2001); Older + Upper (2022); Listen Without Prejudice Vol. 1 (Remastered) (1990); I Want Your Sex (Freemasons Club Mix) (2010) |
| Shakira | ? | 104 | 24 | Shakira In Concert: El Dorado World Tour (2019); Fijación Oral Volumen 1 (2005); Grandes Exitos (2002); Laundry Service: Washed and Dried (Expanded Edition) (2021); Shakira MTV Unplugged (2005); Donde Estan Los Ladrones (1998); She Wolf / Loba (2009) |
| Ariana Grande | US | 108 | 29 | Wicked: For Good – The Soundtrack (Commentary) (2026); Wicked: For Good – The Soundtrack (2025); Wicked: The Soundtrack (Commentary) (2025); Wicked: The Soundtrack (2024); eternal sunshine deluxe: brighter days ahead (2025); Dangerous Woman (Edited) (2021); For Good (from Wicked: For Good - The Soundtrack) (2025) |
| Ellie Goulding | ? | 82 | 21 | We Know Too Much (2026); You Know Too Much (2026); Halcyon Days (2013); Halcyon Nights (2022); Lights 10 (2020); Bright Lights (Lights Re-pack / Bonus Version) (2011); Brightest Blue - Music For Calm (2021) |
| ODEE | KR | 21 | 13 | Here I Come (2026); THE HOUR OF JOY (2025); CANDLE LIGHT (Deluxe Edition) (2024); The Moon (2024); تسونامي (2024); VS2 (2023); Flip The Script EP (2023) |
| TOUCHED | KR | 10 | 10 | Whatever Flavour (2024); Back Alley Vices (2023); Death Row (2023); In Touch (2022); Nothin' Extra (2025); GREAT SEOUL INVASION Section 7 (2022); Whatever (2020) |
| Chancellor | KR | 8 | 10 | Fractured (2025); scroll the water (2025); The Pivot (2024); Thug Luv (2022); P.A.S.A: 2005-2018 (2019); Have Your Cake EP (2025); Happy Birthday EP (2025) |
| Killer Mike | US | 39 | 23 | RTJ4 (2026); Run The Jewels 3 (2016); Run The Jewels 2 (2014); Run The Jewels (2015); Can't Fit In (2026); My Chrome (feat. Big Boi) (2005) |
| Don Malik | KR | 9 | 9 | Love is a Song (2025); THURSDAYCLUB MIXTAPE (2024); 49 (2023); FOMMY HILTIGER (2017); Tribeast (2016); 탯줄 (2015) |
| Legit Goons | KR | 2 | 6 | PUNK (2026); Family Sitcom (2022); ROCKSTAR GAMES (2019); Junk Drunk Love (2017); Camp (2016); Change the Mood (2014) |
| Fleeky Bang | ? | 1 | 7 | ANTI (2026); 3024 (2025); AKUMA (2024); The Predator 2: FLEEKY SYNDROME (2024); The Predator (2023); HAN 2023 (2023) |
| Bassagong | ? | 4 | 9 | real mc (2026); LIFE LOVER (2025); PALANG (2024); mrfuck (2024); 출항사 (2015); Love Letter (2025) |
| Babylon | KR | 13 | 10 | SMOKE & MIRRORS (2025); EGO 90'S PART 3 (2024); MOOD (2023); Colors (2023); EGO 90'S PART 2 (2022); EGO 90'S (2022) |
| The Who | GB | 163 | 48 | Who’s On Repeat, Who Knew? (2026); 20th Century Masters: The Millennium Collection: Best Of The Who (1999); BBC Sessions (2000); Quadrophenia (Original Motion Picture Soundtrack) (2015); Who’s Next : Life House (2023); The Who Sings My Generation (U.S. Version) (1988) |
| Kelly Clarkson | US | 85 | 32 | When Christmas Comes Around… Again (2024); Dance Vault Mixes - Because Of You (2005); Rolling Stone Original (2008); Dance Vault Mixes - Walk Away (4) (2006); Dance Vault Mixes - Walk Away (2) (2006); Dance Vault Mixes - Behind These Hazel Eyes (2005) |
| Snoop Dogg | ? | 301 | 48 | Gangsta Grillz: I Still Got It (2022); Cuzznz (2016); Mac and Devin Go to High School (Music from and Inspired by the Movie) (2011); Death Row: The Lost Sessions, Vol. 1 (2009); Sessions @ AOL (2007); The Underdoggs (Original Motion Picture Soundtrack) (2024) |
| Massive Attack | GB | 62 | 30 | False Flags (2025); Unleashed OST (2005); Danny The Dog - OST (2004); Singles Collection (2003); No Protection (2004); Blue Lines (2012 Mix/Master) (2012) |

---

## 8. Method, limits and what was not covered

- **Matching.** An MBID link comes first. Next is a strict artist gate: exact normalized name, native
  name or alias per credited component, with no bare substrings and a country gate on country-scoped
  lists. Then an exact normalized title inside that artist's discography. Anything unresolved is
  verified upstream on MusicBrainz and Deezer, and finally by loose title comparison scoped to the one artist.
- **A scan bug was found and fixed mid-run.** Chunked `.in()` reads without an `ORDER BY` silently dropped
  rows for large discographies, which briefly made Frank Ocean *Blonde*, Zach Bryan and Shakira albums
  look missing. All stages were re-run with stable ordering. A cross-check of 999 suspect rows found all 999 correctly attributed.
- **Title language.** Hangul-vs-English and symbol titles (÷, ×, [&]) can't be matched textually. Those rows
  are in "unmatched-owned-artist" and "album-not-on-mb", not counted as confirmed gaps.
- **Deezer name hits** for skipped seeds and Deezer-only discography candidates aren't identity-verified.
- **Not covered yet** (from `CATALOG_GAP_SCAN.md` §2): the random-sample recall estimate, Wikipedia
  year pages, label rosters, MB-count comparison for *all* artists (only the 414 priority artists), and
  import-failure logs. `artists.mb_rg_count` is populated for 10.8k artists but no code on this branch
  writes it and it doesn't match MB's album+EP count, so it wasn't used.
- **Scripts** lived in a scratch directory, as with the morning baseline. Re-running needs the planned
  `catalog:gaps` tool (`CATALOG_GAP_SCAN.md` §4). The stages here are a working prototype of it.
