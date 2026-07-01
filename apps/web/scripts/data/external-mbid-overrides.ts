/**
 * Hand-verified (artist, album_title) → release-group MBID for prestige albums the auto-matcher
 * can't reach. Mostly Korean "N집" classics whose MusicBrainz title is the album's REAL name, not
 * "<artist> N집" (e.g. 이문세 5집 = 옛사랑, 조용필 7집 = "Blue Deep") — a semantic gap no string
 * match can bridge — plus mis-resolving names (大瀧詠一 → a wrong same-named entity).
 *
 * How to add one: find the album on musicbrainz.org, open the RELEASE GROUP (not a release), copy
 * the MBID from the URL (…/release-group/<MBID>). `artist`/`album_title` must match external_scores
 * EXACTLY. Applied by `backfill:external-mbids` before the resolve→browse pass (overrides win).
 */
export interface ExtOverride { artist: string; album_title: string; mbid: string; note?: string }

export const OVERRIDES: ExtOverride[] = [
  // ── kr_masterpiece_100 / jp_mino_100 — hand-mapped from --suggest (2026-07-01) ──
  // Title translations / clear numbering / well-known song→album. Verify any you're unsure of.
  { artist: 'The Flipper\'s Guitar', album_title: 'ヘッド博士の世界塔', mbid: 'a99f766f-929f-305a-aa19-8007bbfeffa6', note: "Doctor Head's World Tower" },
  { artist: 'THEE MICHELLE GUN ELEPHANT', album_title: 'ギヤ・ブルーズ', mbid: '5d2820d3-b82d-350f-8645-26efee20389f', note: 'Gear Blues' },
  { artist: '鈴木茂', album_title: 'BAND WAGON', mbid: 'a2179341-7e7e-45af-8072-d25dfdc2d7d4', note: 'バンドワゴン' },
  { artist: 'ザ・タイマーズ', album_title: 'ザ・タイマーズ', mbid: 'e914825b-700a-49ed-8dd7-606e2caa9151', note: 'THE TIMERS (1989)' },
  { artist: '가리온', album_title: 'Garion', mbid: '94ee8cd8-b482-4f11-a1d2-723382a13229', note: '가리온 self-titled (2004)' },
  { artist: '김건모', album_title: '김건모 3집', mbid: '54a84a71-833f-4d48-8d62-956e41d7ad80', note: 'Kim Gun Mo 3' },
  { artist: '김광석', album_title: '다시 부르기 II', mbid: '0b2f3a13-b9e7-3462-894f-219f835b526f', note: '다시 부르기 2 (1995)' },
  { artist: '김두수', album_title: '자유혼', mbid: '3ac84050-16fc-3f3f-bc75-179034c28718', note: '自由魂' },
  { artist: '김수철', album_title: '작은 거인 김수철', mbid: '3c2bcdf7-b6b6-41fd-bce3-155a507f78e1', note: '1집 (1983)' },
  { artist: '김수철', album_title: '작은 거인 2집', mbid: '1555f476-7c52-4268-82c0-0e955d6c7f14', note: '2집 (1984)' },
  { artist: '김현식', album_title: '김현식 Ⅲ', mbid: '4b9f5fec-826f-4b3d-8886-c4c465794979', note: '3집 (1986)' },
  { artist: '들국화', album_title: '들국화 1집', mbid: '57292ee6-e402-4696-9d27-bdc87f1405e2', note: '1985 debut' },
  { artist: '롤러코스터', album_title: '일상다반사', mbid: 'e8c24a1a-00f1-3dda-9bb0-7cbbb4e04543', note: '日常茶飯事 (2000)' },
  { artist: '못', album_title: '비선형', mbid: 'dee7c463-fff6-3b53-8b1e-934eedf58ddc', note: 'non-linear (2004)' },
  { artist: '부활', album_title: 'Rock Will Never Die', mbid: '8dad57a7-3d51-4e70-b8dd-a357b51335e1', note: '부활 Vol.1 (1986)' },
  { artist: '브라운 아이즈', album_title: 'Brown Eyes', mbid: 'c48a0b54-d4f9-37b2-8af2-c7dd2fd52daf', note: 'First Album (2001)' },
  { artist: '빛과 소금', album_title: '빛과 소금 Vol.1', mbid: '9441fbbf-90c5-47fa-a5bb-1ee7404b2ab7', note: '1990 debut' },
  { artist: '삐삐밴드', album_title: '문화혁명', mbid: '2781b3ee-aa04-4f18-8c4c-9bce99437e8c', note: '文化革命 (1995)' },
  { artist: '산울림', album_title: '산울림 2집', mbid: 'aae4cfd5-fff7-474e-870c-299ca479d629', note: '내 마음에 주단을 깔고 (1978) — verify' },
  { artist: '서태지와 아이들', album_title: '서태지와 아이들 1집', mbid: '56946299-2041-3758-a3f8-b33636c9300e', note: 'Seo Taiji and Boys (1992)' },
  { artist: '서태지와 아이들', album_title: '하여가', mbid: 'a210b3c5-38af-3a2b-9504-a71a1969ee75', note: 'title track of II (1993)' },
  { artist: '서태지와 아이들', album_title: '발해를 꿈꾸며', mbid: 'b56c68b5-69d4-4e40-81db-b92f4f64c4f8', note: 'from III (1994)' },
  { artist: '서태지와 아이들', album_title: '컴백홈', mbid: '8dc98dde-124b-3553-b618-dfdf17386207', note: 'Come Back Home, from IV (1995)' },
  { artist: '신촌블루스', album_title: '신촌블루스 1집', mbid: 'c737e50e-db8d-4406-93e1-fc00b78d9f76', note: '신촌 Blues (1988)' },
  { artist: '신촌블루스', album_title: '신촌블루스 2집', mbid: '1c53f59d-1421-4f68-b971-f38624b4dc13', note: '신촌 Blues II (1988)' },
  { artist: '양희은', album_title: '고운 노래 모음', mbid: '31428403-82a3-463f-a564-e8dbc4850b69', note: '아침이슬 (1971)' },
  { artist: '어떤날', album_title: '어떤날 I', mbid: '2c4ae605-ff81-4fd1-9845-1e228cff561a', note: '1960·1965 (1986)' },
  { artist: '이문세', album_title: '이문세 5집', mbid: 'a066ae05-3762-4985-b50e-6bbf45feef86', note: '가로수 그늘 아래 서면 (1988)' },
  { artist: '이장혁', album_title: '이장혁 Vol.1', mbid: '7c86bdd0-b3aa-4570-a4de-a039b7828742', note: 'Vol.1 (2004)' },
  { artist: '정태춘', album_title: '시인의 마을', mbid: '1526e63c-8648-4354-9013-85712b7bfecc', note: '詩人의 마을 (1978)' },
  { artist: '조동진', album_title: '조동진', mbid: '1ee9a331-c47a-4f28-ad3a-19ef681dad9b', note: '행복한 사람 (1979)' },
  { artist: '조용필', album_title: '조용필 7집', mbid: 'af9185fd-408c-4adf-bec8-ad0f5b1207ab', note: 'Cho Yong Pil 7th (1985)' },
  { artist: '할로우 잰', album_title: 'Rough Draft in Progress', mbid: '5f4e7f15-d471-35c4-a795-60241c8f0f7f', note: '2006 original' },
];
