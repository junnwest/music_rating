/**
 * THE canonical genre taxonomy — the single source of truth for the genre
 * rebuild (see GENRE_TAXONOMY.md). Everything else (primary genre, homepage
 * categories, synonyms, scene, embeddings) becomes a projection of this graph.
 *
 * Shape (locked design, §2/§3.1):
 *   - Multi-parent DAG, not a tree. A node has TWO kinds of parent edge:
 *       soundParents — musical lineage (shoegaze → rock; deep-house → house)
 *       sceneParents — origin/scene root (k-pop → korean; city-pop → japanese)
 *     so scene is derived from the graph, never baked into names/regex.
 *   - 3 sound levels: family → genre → subgenre. Scene roots are a parallel set
 *     of top nodes (level:'family', isScene:true) reachable only via sceneParents.
 *   - Single-subgenre collapse: no genre may have exactly ONE subgenre child
 *     (enforced by scripts/validate-taxonomy.ts). Most nodes are therefore leaf
 *     genres directly under a family; the subgenre level is used only where a
 *     genre has ≥2 real subgenre children in catalog vocab (e.g. house).
 *
 * Authoring basis (Phase 0, 2026-09-21): the ~150 top catalog tags by support
 * (scripts/dump-genre-vocab.ts → GENRE_VOCAB_DUMP.tsv). 1007/1009 of our tags
 * are canonical MusicBrainz genres (scripts/dump-mb-genre-tree.ts), so ids use
 * the MB spelling and `aliases` fold in the observed spelling variants; the
 * long tail below the head resolves via the resolver's structural fold (Phase 1).
 *
 * NOTE: display.ko is a FIRST PASS — accurate for the major families/genres,
 * transliterated or English-fallback for niche nodes; review before shipping UI.
 *
 * DO NOT hand-maintain any derived list against this file — derive it.
 */

export type GenreLevel = 'family' | 'genre' | 'subgenre';

export interface GenreNode {
  /** Stable canonical slug — the ONLY key used app-wide. */
  id: string;
  level: GenreLevel;
  display: { en: string; ko: string };
  /** Musical-lineage parents (ids). [] for a family. */
  soundParents: string[];
  /** Scene-root parents (ids), e.g. ['korean']. Usually []. */
  sceneParents: string[];
  /** Every source/spelling variant that maps here (folded at resolve time). */
  aliases: string[];
  /** Tie-break within same-level siblings present on one album; higher wins.
   *  Scene-qualified > niche > specific > broad, mirroring the retired PRECEDENCE. */
  rank: number;
  /** Eligible as a homepage category row (row members = node + all descendants). */
  surface: boolean;
  /** Scene root: reachable only via sceneParents, never a sound row. */
  isScene?: boolean;
}

/** Terse node builder. ko defaults to en (flagged first-pass); arrays default []. */
function n(p: {
  id: string;
  level: GenreLevel;
  en: string;
  ko?: string;
  sound?: string[];
  scene?: string[];
  aliases?: string[];
  rank?: number;
  surface?: boolean;
  isScene?: boolean;
}): GenreNode {
  return {
    id: p.id,
    level: p.level,
    display: { en: p.en, ko: p.ko ?? p.en },
    soundParents: p.sound ?? [],
    sceneParents: p.scene ?? [],
    aliases: p.aliases ?? [],
    rank: p.rank ?? 0,
    surface: p.surface ?? false,
    ...(p.isScene ? { isScene: true } : {}),
  };
}

export const TAXONOMY: GenreNode[] = [
  // ══ Scene roots (isScene families; reached only via sceneParents) ══════════
  n({ id: 'western', level: 'family', en: 'Western', ko: '서양', isScene: true }),
  n({ id: 'korean', level: 'family', en: 'Korean', ko: '한국', isScene: true }),
  n({ id: 'japanese', level: 'family', en: 'Japanese', ko: '일본', isScene: true }),
  n({ id: 'chinese', level: 'family', en: 'Chinese', ko: '중화권', isScene: true }),
  n({ id: 'indian', level: 'family', en: 'Indian', ko: '인도', isScene: true }),
  n({ id: 'brazilian', level: 'family', en: 'Brazilian', ko: '브라질', isScene: true }),

  // ══ Sound families ═════════════════════════════════════════════════════════
  n({ id: 'pop', level: 'family', en: 'Pop', ko: '팝', aliases: ['pop'], surface: true }),
  n({ id: 'rock', level: 'family', en: 'Rock', ko: '록', aliases: ['rock'], surface: true }),
  n({ id: 'hip-hop', level: 'family', en: 'Hip-Hop', ko: '힙합', aliases: ['hip hop', 'hip-hop', 'hiphop', 'rap', 'rap/hip hop'], surface: true }),
  n({ id: 'rnb-soul', level: 'family', en: 'R&B & Soul', ko: '알앤비/소울', surface: true }),
  n({ id: 'electronic', level: 'family', en: 'Electronic', ko: '일렉트로닉', aliases: ['electronic', 'electronica'], surface: true }),
  n({ id: 'jazz', level: 'family', en: 'Jazz', ko: '재즈', aliases: ['jazz'], surface: true }),
  n({ id: 'folk', level: 'family', en: 'Folk', ko: '포크', aliases: ['folk'], surface: true }),
  n({ id: 'country', level: 'family', en: 'Country', ko: '컨트리', aliases: ['country'], surface: true }),
  n({ id: 'classical', level: 'family', en: 'Classical', ko: '클래식', aliases: ['classical', 'classical music'], surface: true }),
  n({ id: 'metal', level: 'family', en: 'Metal', ko: '메탈', aliases: ['metal'], surface: true }),
  n({ id: 'punk', level: 'family', en: 'Punk', ko: '펑크', aliases: ['punk'], surface: true }),
  n({ id: 'blues', level: 'family', en: 'Blues', ko: '블루스', aliases: ['blues'], surface: true }),
  n({ id: 'reggae', level: 'family', en: 'Reggae', ko: '레게', aliases: ['reggae'], surface: true }),
  n({ id: 'latin', level: 'family', en: 'Latin', ko: '라틴', aliases: ['latin'], surface: true }),
  n({ id: 'experimental', level: 'family', en: 'Experimental', ko: '실험음악', aliases: ['experimental', 'avant-garde', 'avant garde', 'avantgarde'], surface: false }),
  n({ id: 'non-music', level: 'family', en: 'Non-Music', ko: '논뮤직', aliases: ['non-music', 'spoken word', 'field recording', 'comedy'], surface: false }),

  // ══ POP ════════════════════════════════════════════════════════════════════
  n({ id: 'pop-rock', level: 'genre', en: 'Pop Rock', ko: '팝 록', sound: ['pop', 'rock'], aliases: ['pop rock'], rank: 2, surface: true }),
  n({ id: 'synth-pop', level: 'genre', en: 'Synth-Pop', ko: '신스팝', sound: ['pop', 'electronic'], aliases: ['synth-pop', 'synthpop', 'synth pop'], rank: 3 }),
  n({ id: 'electropop', level: 'genre', en: 'Electropop', ko: '일렉트로팝', sound: ['pop', 'electronic'], aliases: ['electropop', 'electro pop'], rank: 3 }),
  n({ id: 'dance-pop', level: 'genre', en: 'Dance-Pop', ko: '댄스팝', sound: ['pop', 'electronic'], aliases: ['dance-pop', 'dance pop'], rank: 3 }),
  n({ id: 'indie-pop', level: 'genre', en: 'Indie Pop', ko: '인디 팝', sound: ['pop'], aliases: ['indie pop'], rank: 3, surface: true }),
  n({ id: 'dream-pop', level: 'genre', en: 'Dream Pop', ko: '드림 팝', sound: ['pop', 'rock'], aliases: ['dream pop'], rank: 4 }),
  n({ id: 'art-pop', level: 'genre', en: 'Art Pop', ko: '아트 팝', sound: ['pop', 'experimental'], aliases: ['art pop'], rank: 3 }),
  n({ id: 'power-pop', level: 'genre', en: 'Power Pop', ko: '파워 팝', sound: ['pop', 'rock'], aliases: ['power pop'], rank: 3 }),
  n({ id: 'europop', level: 'genre', en: 'Europop', ko: '유로팝', sound: ['pop'], aliases: ['europop'], rank: 2 }),
  n({ id: 'schlager', level: 'genre', en: 'Schlager', ko: '슐라거', sound: ['pop'], aliases: ['schlager'], rank: 2 }),
  n({ id: 'ballad', level: 'genre', en: 'Ballad', ko: '발라드', sound: ['pop'], aliases: ['ballad'], rank: 2 }),
  n({ id: 'easy-listening', level: 'genre', en: 'Easy Listening', ko: '이지 리스닝', sound: ['pop'], aliases: ['easy listening', 'lounge'], rank: 2 }),
  n({ id: 'musical', level: 'genre', en: 'Musical', ko: '뮤지컬', sound: ['pop'], aliases: ['musical', 'show tunes', 'showtunes'], rank: 2 }),
  n({ id: 'christmas-music', level: 'genre', en: 'Christmas Music', ko: '크리스마스 음악', sound: ['pop'], aliases: ['christmas music', 'christmas'], rank: 2 }),
  n({ id: 'alternative-pop', level: 'genre', en: 'Alternative Pop', ko: '얼터너티브 팝', sound: ['pop'], aliases: ['alternative pop', 'alt-pop'], rank: 3 }),
  n({ id: 'pop-soul', level: 'genre', en: 'Pop Soul', ko: '팝 소울', sound: ['pop', 'rnb-soul'], aliases: ['pop soul'], rank: 3 }),
  n({ id: 'pop-punk', level: 'genre', en: 'Pop Punk', ko: '팝 펑크', sound: ['pop', 'punk'], aliases: ['pop punk'], rank: 4 }),
  n({ id: 'pop-rap', level: 'genre', en: 'Pop Rap', ko: '팝 랩', sound: ['pop', 'hip-hop'], aliases: ['pop rap'], rank: 4 }),
  n({ id: 'country-pop', level: 'genre', en: 'Country Pop', ko: '컨트리 팝', sound: ['pop', 'country'], aliases: ['country pop'], rank: 3 }),
  n({ id: 'folk-pop', level: 'genre', en: 'Folk Pop', ko: '포크 팝', sound: ['pop', 'folk'], aliases: ['folk pop'], rank: 3 }),
  n({ id: 'latin-pop', level: 'genre', en: 'Latin Pop', ko: '라틴 팝', sound: ['pop', 'latin'], aliases: ['latin pop'], rank: 4 }),
  n({ id: 'chillwave', level: 'genre', en: 'Chillwave', ko: '칠웨이브', sound: ['pop', 'electronic'], aliases: ['chillwave'], rank: 4 }),
  // Pop — scene-qualified
  n({ id: 'k-pop', level: 'genre', en: 'K-Pop', ko: '케이팝', sound: ['pop'], scene: ['korean'], aliases: ['k-pop', 'kpop', 'korean pop'], rank: 5, surface: true }),
  n({ id: 'korean-ballad', level: 'genre', en: 'Korean Ballad', ko: '한국 발라드', sound: ['pop'], scene: ['korean'], aliases: ['korean ballad', 'k-ballad'], rank: 5 }),
  n({ id: 'j-pop', level: 'genre', en: 'J-Pop', ko: '제이팝', sound: ['pop'], scene: ['japanese'], aliases: ['j-pop', 'jpop', 'japanese pop'], rank: 5, surface: true }),
  n({ id: 'kayokyoku', level: 'genre', en: 'Kayōkyoku', ko: '가요쿄쿠', sound: ['pop'], scene: ['japanese'], aliases: ['kayōkyoku', 'kayokyoku'], rank: 5 }),
  n({ id: 'city-pop', level: 'genre', en: 'City Pop', ko: '시티 팝', sound: ['pop', 'rnb-soul'], scene: ['japanese'], aliases: ['city pop', 'citypop'], rank: 5, surface: true }),
  n({ id: 'mandopop', level: 'genre', en: 'Mandopop', ko: '만다린 팝', sound: ['pop'], scene: ['chinese'], aliases: ['mandopop', 'mandarin pop'], rank: 5 }),
  n({ id: 'indian-pop', level: 'genre', en: 'Indian Pop', ko: '인도 팝', sound: ['pop'], scene: ['indian'], aliases: ['indian pop'], rank: 5 }),
  n({ id: 'filmi', level: 'genre', en: 'Filmi', ko: '필미', sound: ['pop'], scene: ['indian'], aliases: ['filmi', 'bollywood'], rank: 5 }),

  // ══ ROCK ═══════════════════════════════════════════════════════════════════
  n({ id: 'alternative-rock', level: 'genre', en: 'Alternative Rock', ko: '얼터너티브 록', sound: ['rock'], aliases: ['alternative rock', 'alt-rock', 'alt rock', 'alternative'], rank: 3, surface: true }),
  n({ id: 'indie-rock', level: 'genre', en: 'Indie Rock', ko: '인디 록', sound: ['rock'], aliases: ['indie rock'], rank: 3, surface: true }),
  n({ id: 'classic-rock', level: 'genre', en: 'Classic Rock', ko: '클래식 록', sound: ['rock'], aliases: ['classic rock'], rank: 2, surface: true }),
  n({ id: 'hard-rock', level: 'genre', en: 'Hard Rock', ko: '하드 록', sound: ['rock'], aliases: ['hard rock'], rank: 2 }),
  n({ id: 'soft-rock', level: 'genre', en: 'Soft Rock', ko: '소프트 록', sound: ['rock'], aliases: ['soft rock'], rank: 2 }),
  n({ id: 'psychedelic-rock', level: 'genre', en: 'Psychedelic Rock', ko: '사이키델릭 록', sound: ['rock'], aliases: ['psychedelic rock', 'psych rock', 'psychedelic'], rank: 3 }),
  n({ id: 'progressive-rock', level: 'genre', en: 'Progressive Rock', ko: '프로그레시브 록', sound: ['rock'], aliases: ['progressive rock', 'prog rock', 'progressive'], rank: 3 }),
  n({ id: 'art-rock', level: 'genre', en: 'Art Rock', ko: '아트 록', sound: ['rock', 'experimental'], aliases: ['art rock'], rank: 3 }),
  n({ id: 'garage-rock', level: 'genre', en: 'Garage Rock', ko: '개러지 록', sound: ['rock'], aliases: ['garage rock'], rank: 3 }),
  n({ id: 'folk-rock', level: 'genre', en: 'Folk Rock', ko: '포크 록', sound: ['rock', 'folk'], aliases: ['folk rock'], rank: 3 }),
  n({ id: 'blues-rock', level: 'genre', en: 'Blues Rock', ko: '블루스 록', sound: ['rock', 'blues'], aliases: ['blues rock'], rank: 3 }),
  n({ id: 'country-rock', level: 'genre', en: 'Country Rock', ko: '컨트리 록', sound: ['rock', 'country'], aliases: ['country rock'], rank: 3 }),
  n({ id: 'rock-and-roll', level: 'genre', en: 'Rock and Roll', ko: '로큰롤', sound: ['rock'], aliases: ['rock and roll', "rock 'n' roll", 'rock n roll'], rank: 2 }),
  n({ id: 'rockabilly', level: 'genre', en: 'Rockabilly', ko: '로커빌리', sound: ['rock'], aliases: ['rockabilly'], rank: 3 }),
  n({ id: 'new-wave', level: 'genre', en: 'New Wave', ko: '뉴 웨이브', sound: ['rock', 'pop'], aliases: ['new wave'], rank: 3 }),
  n({ id: 'post-rock', level: 'genre', en: 'Post-Rock', ko: '포스트 록', sound: ['rock', 'experimental'], aliases: ['post-rock', 'post rock'], rank: 4, surface: true }),
  n({ id: 'math-rock', level: 'genre', en: 'Math Rock', ko: '매스 록', sound: ['rock'], aliases: ['math rock'], rank: 4 }),
  n({ id: 'shoegaze', level: 'genre', en: 'Shoegaze', ko: '슈게이즈', sound: ['rock'], aliases: ['shoegaze', 'shoegazing'], rank: 4, surface: true }),
  n({ id: 'britpop', level: 'genre', en: 'Britpop', ko: '브릿팝', sound: ['rock'], aliases: ['britpop'], rank: 3 }),
  n({ id: 'j-rock', level: 'genre', en: 'J-Rock', ko: '제이록', sound: ['rock'], scene: ['japanese'], aliases: ['j-rock', 'jrock', 'japanese rock', 'visual kei'], rank: 5, surface: true }),
  n({ id: 'korean-indie', level: 'genre', en: 'Korean Indie', ko: '한국 인디', sound: ['rock'], scene: ['korean'], aliases: ['korean indie', 'k-indie'], rank: 5, surface: true }),

  // ══ PUNK ═══════════════════════════════════════════════════════════════════
  n({ id: 'punk-rock', level: 'genre', en: 'Punk Rock', ko: '펑크 록', sound: ['punk'], aliases: ['punk rock'], rank: 3 }),
  n({ id: 'post-punk', level: 'genre', en: 'Post-Punk', ko: '포스트 펑크', sound: ['punk'], aliases: ['post-punk', 'post punk'], rank: 4 }),
  n({ id: 'hardcore-punk', level: 'genre', en: 'Hardcore Punk', ko: '하드코어 펑크', sound: ['punk'], aliases: ['hardcore punk', 'hardcore'], rank: 4 }),
  n({ id: 'emo', level: 'genre', en: 'Emo', ko: '이모', sound: ['punk'], aliases: ['emo'], rank: 4 }),
  n({ id: 'post-hardcore', level: 'genre', en: 'Post-Hardcore', ko: '포스트 하드코어', sound: ['punk', 'metal'], aliases: ['post-hardcore', 'post hardcore'], rank: 4 }),

  // ══ METAL ══════════════════════════════════════════════════════════════════
  n({ id: 'heavy-metal', level: 'genre', en: 'Heavy Metal', ko: '헤비 메탈', sound: ['metal'], aliases: ['heavy metal'], rank: 2, surface: true }),
  n({ id: 'nu-metal', level: 'genre', en: 'Nu Metal', ko: '뉴 메탈', sound: ['metal'], aliases: ['nu metal', 'nu-metal'], rank: 4 }),
  n({ id: 'alternative-metal', level: 'genre', en: 'Alternative Metal', ko: '얼터너티브 메탈', sound: ['metal', 'rock'], aliases: ['alternative metal', 'alt-metal'], rank: 3 }),

  // ══ HIP-HOP ════════════════════════════════════════════════════════════════
  n({ id: 'trap', level: 'genre', en: 'Trap', ko: '트랩', sound: ['hip-hop'], aliases: ['trap'], rank: 4 }),
  n({ id: 'gangsta-rap', level: 'genre', en: 'Gangsta Rap', ko: '갱스터 랩', sound: ['hip-hop'], aliases: ['gangsta rap', 'gangster rap'], rank: 4 }),
  n({ id: 'boom-bap', level: 'genre', en: 'Boom Bap', ko: '붐뱁', sound: ['hip-hop'], aliases: ['boom bap'], rank: 4 }),
  n({ id: 'cloud-rap', level: 'genre', en: 'Cloud Rap', ko: '클라우드 랩', sound: ['hip-hop'], aliases: ['cloud rap'], rank: 4 }),
  n({ id: 'conscious-hip-hop', level: 'genre', en: 'Conscious Hip-Hop', ko: '컨셔스 힙합', sound: ['hip-hop'], aliases: ['conscious hip hop'], rank: 4 }),
  n({ id: 'hardcore-hip-hop', level: 'genre', en: 'Hardcore Hip-Hop', ko: '하드코어 힙합', sound: ['hip-hop'], aliases: ['hardcore hip hop'], rank: 4 }),
  n({ id: 'instrumental-hip-hop', level: 'genre', en: 'Instrumental Hip-Hop', ko: '인스트루멘탈 힙합', sound: ['hip-hop'], aliases: ['instrumental hip hop'], rank: 4 }),
  n({ id: 'lo-fi-hip-hop', level: 'genre', en: 'Lo-fi Hip-Hop', ko: '로파이 힙합', sound: ['hip-hop', 'electronic'], aliases: ['lo-fi hip hop', 'lofi hip hop'], rank: 4 }),
  n({ id: 'west-coast-hip-hop', level: 'genre', en: 'West Coast Hip-Hop', ko: '웨스트 코스트 힙합', sound: ['hip-hop'], aliases: ['west coast hip hop'], rank: 4 }),
  n({ id: 'east-coast-hip-hop', level: 'genre', en: 'East Coast Hip-Hop', ko: '이스트 코스트 힙합', sound: ['hip-hop'], aliases: ['east coast hip hop'], rank: 4 }),
  n({ id: 'grime', level: 'genre', en: 'Grime', ko: '그라임', sound: ['hip-hop', 'electronic'], aliases: ['grime'], rank: 4 }),
  n({ id: 'jazz-rap', level: 'genre', en: 'Jazz Rap', ko: '재즈 랩', sound: ['hip-hop', 'jazz'], aliases: ['jazz rap'], rank: 4 }),
  n({ id: 'k-rap', level: 'genre', en: 'Korean Hip-Hop', ko: '한국 힙합', sound: ['hip-hop'], scene: ['korean'], aliases: ['k-rap', 'korean rap', 'korean hip hop'], rank: 5, surface: true }),

  // ══ R&B & SOUL ═════════════════════════════════════════════════════════════
  n({ id: 'soul', level: 'genre', en: 'Soul', ko: '소울', sound: ['rnb-soul'], aliases: ['soul'], rank: 2, surface: true }),
  n({ id: 'r-and-b', level: 'genre', en: 'R&B', ko: '알앤비', sound: ['rnb-soul'], aliases: ['r&b', 'rnb', 'rhythm and blues', 'r and b'], rank: 2, surface: true }),
  n({ id: 'contemporary-r-and-b', level: 'genre', en: 'Contemporary R&B', ko: '컨템퍼러리 알앤비', sound: ['rnb-soul'], aliases: ['contemporary r&b', 'contemporary rnb'], rank: 3 }),
  n({ id: 'alternative-r-and-b', level: 'genre', en: 'Alternative R&B', ko: '얼터너티브 알앤비', sound: ['rnb-soul'], aliases: ['alternative r&b', 'alt r&b', 'alternative rnb'], rank: 4 }),
  n({ id: 'neo-soul', level: 'genre', en: 'Neo Soul', ko: '네오 소울', sound: ['rnb-soul'], aliases: ['neo soul', 'neo-soul'], rank: 4 }),
  n({ id: 'funk', level: 'genre', en: 'Funk', ko: '펑크(훵크)', sound: ['rnb-soul'], aliases: ['funk'], rank: 2, surface: true }),
  n({ id: 'disco', level: 'genre', en: 'Disco', ko: '디스코', sound: ['rnb-soul', 'electronic'], aliases: ['disco'], rank: 3 }),
  n({ id: 'gospel', level: 'genre', en: 'Gospel', ko: '가스펠', sound: ['rnb-soul'], aliases: ['gospel'], rank: 3 }),
  n({ id: 'soul-jazz', level: 'genre', en: 'Soul Jazz', ko: '소울 재즈', sound: ['rnb-soul', 'jazz'], aliases: ['soul jazz'], rank: 4 }),
  n({ id: 'jazz-funk', level: 'genre', en: 'Jazz-Funk', ko: '재즈 훵크', sound: ['rnb-soul', 'jazz'], aliases: ['jazz-funk', 'jazz funk'], rank: 4 }),
  n({ id: 'k-r-and-b', level: 'genre', en: 'Korean R&B', ko: '한국 알앤비', sound: ['rnb-soul'], scene: ['korean'], aliases: ['k-r&b', 'korean r&b', 'korean rnb'], rank: 5, surface: true }),

  // ══ ELECTRONIC ═════════════════════════════════════════════════════════════
  n({ id: 'house', level: 'genre', en: 'House', ko: '하우스', sound: ['electronic'], aliases: ['house'], rank: 3, surface: true }),
  n({ id: 'deep-house', level: 'subgenre', en: 'Deep House', ko: '딥 하우스', sound: ['house'], aliases: ['deep house'], rank: 4 }),
  n({ id: 'tech-house', level: 'subgenre', en: 'Tech House', ko: '테크 하우스', sound: ['house'], aliases: ['tech house'], rank: 4 }),
  n({ id: 'electro-house', level: 'subgenre', en: 'Electro House', ko: '일렉트로 하우스', sound: ['house'], aliases: ['electro house'], rank: 4 }),
  n({ id: 'progressive-house', level: 'subgenre', en: 'Progressive House', ko: '프로그레시브 하우스', sound: ['house'], aliases: ['progressive house'], rank: 4 }),
  n({ id: 'euro-house', level: 'subgenre', en: 'Euro House', ko: '유로 하우스', sound: ['house'], aliases: ['euro house'], rank: 4 }),
  n({ id: 'techno', level: 'genre', en: 'Techno', ko: '테크노', sound: ['electronic'], aliases: ['techno'], rank: 3 }),
  n({ id: 'trance', level: 'genre', en: 'Trance', ko: '트랜스', sound: ['electronic'], aliases: ['trance'], rank: 3 }),
  n({ id: 'progressive-trance', level: 'genre', en: 'Progressive Trance', ko: '프로그레시브 트랜스', sound: ['electronic'], aliases: ['progressive trance'], rank: 4 }),
  n({ id: 'drum-and-bass', level: 'genre', en: 'Drum and Bass', ko: '드럼 앤 베이스', sound: ['electronic'], aliases: ['drum and bass', 'dnb', 'd&b'], rank: 4 }),
  n({ id: 'dubstep', level: 'genre', en: 'Dubstep', ko: '덥스텝', sound: ['electronic'], aliases: ['dubstep'], rank: 4 }),
  n({ id: 'ambient', level: 'genre', en: 'Ambient', ko: '앰비언트', sound: ['electronic', 'experimental'], aliases: ['ambient'], rank: 3, surface: true }),
  n({ id: 'downtempo', level: 'genre', en: 'Downtempo', ko: '다운템포', sound: ['electronic'], aliases: ['downtempo', 'chillout', 'chill out', 'chill'], rank: 3 }),
  n({ id: 'trip-hop', level: 'genre', en: 'Trip-Hop', ko: '트립 합', sound: ['electronic', 'hip-hop'], aliases: ['trip hop', 'trip-hop'], rank: 4 }),
  n({ id: 'idm', level: 'genre', en: 'IDM', ko: '아이디엠', sound: ['electronic', 'experimental'], aliases: ['idm', 'intelligent dance music'], rank: 4 }),
  n({ id: 'industrial', level: 'genre', en: 'Industrial', ko: '인더스트리얼', sound: ['electronic', 'experimental'], aliases: ['industrial'], rank: 3 }),
  n({ id: 'electro', level: 'genre', en: 'Electro', ko: '일렉트로', sound: ['electronic'], aliases: ['electro'], rank: 3 }),
  n({ id: 'breakbeat', level: 'genre', en: 'Breakbeat', ko: '브레이크비트', sound: ['electronic'], aliases: ['breakbeat', 'breaks'], rank: 4 }),
  n({ id: 'uk-garage', level: 'genre', en: 'UK Garage', ko: '유케이 개러지', sound: ['electronic'], aliases: ['uk garage', '2-step'], rank: 4 }),
  n({ id: 'leftfield', level: 'genre', en: 'Leftfield', ko: '레프트필드', sound: ['electronic', 'experimental'], aliases: ['leftfield'], rank: 4 }),
  n({ id: 'new-age', level: 'genre', en: 'New Age', ko: '뉴 에이지', sound: ['electronic'], aliases: ['new age'], rank: 3 }),
  n({ id: 'dance', level: 'genre', en: 'Dance', ko: '댄스', sound: ['electronic'], aliases: ['dance', 'edm', 'electronic dance music'], rank: 2 }),
  n({ id: 'lo-fi', level: 'genre', en: 'Lo-fi', ko: '로파이', sound: ['electronic'], aliases: ['lo-fi', 'lofi'], rank: 3 }),
  n({ id: 'reggaeton', level: 'genre', en: 'Reggaeton', ko: '레게톤', sound: ['electronic', 'latin'], aliases: ['reggaeton'], rank: 4 }),

  // ══ JAZZ ═══════════════════════════════════════════════════════════════════
  n({ id: 'swing', level: 'genre', en: 'Swing', ko: '스윙', sound: ['jazz'], aliases: ['swing'], rank: 3 }),
  n({ id: 'big-band', level: 'genre', en: 'Big Band', ko: '빅 밴드', sound: ['jazz'], aliases: ['big band'], rank: 3 }),
  n({ id: 'hard-bop', level: 'genre', en: 'Hard Bop', ko: '하드 밥', sound: ['jazz'], aliases: ['hard bop'], rank: 4 }),
  n({ id: 'post-bop', level: 'genre', en: 'Post-Bop', ko: '포스트 밥', sound: ['jazz'], aliases: ['post-bop', 'post bop'], rank: 4 }),
  n({ id: 'cool-jazz', level: 'genre', en: 'Cool Jazz', ko: '쿨 재즈', sound: ['jazz'], aliases: ['cool jazz'], rank: 4 }),
  n({ id: 'free-jazz', level: 'genre', en: 'Free Jazz', ko: '프리 재즈', sound: ['jazz', 'experimental'], aliases: ['free jazz'], rank: 4 }),
  n({ id: 'vocal-jazz', level: 'genre', en: 'Vocal Jazz', ko: '보컬 재즈', sound: ['jazz'], aliases: ['vocal jazz'], rank: 3 }),
  n({ id: 'smooth-jazz', level: 'genre', en: 'Smooth Jazz', ko: '스무스 재즈', sound: ['jazz'], aliases: ['smooth jazz'], rank: 3 }),
  n({ id: 'contemporary-jazz', level: 'genre', en: 'Contemporary Jazz', ko: '컨템퍼러리 재즈', sound: ['jazz'], aliases: ['contemporary jazz'], rank: 3 }),
  n({ id: 'latin-jazz', level: 'genre', en: 'Latin Jazz', ko: '라틴 재즈', sound: ['jazz', 'latin'], aliases: ['latin jazz'], rank: 4 }),
  n({ id: 'dixieland', level: 'genre', en: 'Dixieland', ko: '딕시랜드', sound: ['jazz'], aliases: ['dixieland'], rank: 3 }),

  // ══ FOLK ═══════════════════════════════════════════════════════════════════
  n({ id: 'singer-songwriter', level: 'genre', en: 'Singer-Songwriter', ko: '싱어송라이터', sound: ['folk'], aliases: ['singer-songwriter', 'singer songwriter'], rank: 2, surface: true }),
  n({ id: 'indie-folk', level: 'genre', en: 'Indie Folk', ko: '인디 포크', sound: ['folk'], aliases: ['indie folk'], rank: 3 }),
  n({ id: 'bluegrass', level: 'genre', en: 'Bluegrass', ko: '블루그래스', sound: ['folk', 'country'], aliases: ['bluegrass'], rank: 3 }),
  n({ id: 'americana', level: 'genre', en: 'Americana', ko: '아메리카나', sound: ['folk', 'country'], aliases: ['americana'], rank: 3 }),
  n({ id: 'korean-folk', level: 'genre', en: 'Korean Folk', ko: '한국 포크', sound: ['folk'], scene: ['korean'], aliases: ['korean folk', 'k-folk'], rank: 5 }),
  n({ id: 'bhangra', level: 'genre', en: 'Bhangra', ko: '방그라', sound: ['folk', 'electronic'], scene: ['indian'], aliases: ['bhangra'], rank: 5 }),

  // ══ COUNTRY ════════════════════════════════════════════════════════════════
  n({ id: 'contemporary-country', level: 'genre', en: 'Contemporary Country', ko: '컨템퍼러리 컨트리', sound: ['country'], aliases: ['contemporary country'], rank: 3 }),
  n({ id: 'traditional-country', level: 'genre', en: 'Traditional Country', ko: '트래디셔널 컨트리', sound: ['country'], aliases: ['traditional country'], rank: 3 }),
  n({ id: 'honky-tonk', level: 'genre', en: 'Honky Tonk', ko: '홍키 통크', sound: ['country'], aliases: ['honky tonk', 'honky-tonk'], rank: 4 }),

  // ══ CLASSICAL ══════════════════════════════════════════════════════════════
  n({ id: 'orchestral', level: 'genre', en: 'Orchestral', ko: '오케스트라', sound: ['classical'], aliases: ['orchestral'], rank: 2 }),
  n({ id: 'opera', level: 'genre', en: 'Opera', ko: '오페라', sound: ['classical'], aliases: ['opera'], rank: 3 }),
  n({ id: 'concerto', level: 'genre', en: 'Concerto', ko: '협주곡', sound: ['classical'], aliases: ['concerto'], rank: 3 }),
  n({ id: 'baroque', level: 'genre', en: 'Baroque', ko: '바로크', sound: ['classical'], aliases: ['baroque'], rank: 3 }),
  n({ id: 'modern-classical', level: 'genre', en: 'Modern Classical', ko: '모던 클래식', sound: ['classical'], aliases: ['modern classical', 'contemporary classical'], rank: 3 }),
  n({ id: 'instrumental', level: 'genre', en: 'Instrumental', ko: '인스트루멘탈', sound: ['classical'], aliases: ['instrumental'], rank: 1 }),

  // ══ BLUES ══════════════════════════════════════════════════════════════════
  n({ id: 'electric-blues', level: 'genre', en: 'Electric Blues', ko: '일렉트릭 블루스', sound: ['blues'], aliases: ['electric blues'], rank: 3 }),
  n({ id: 'chicago-blues', level: 'genre', en: 'Chicago Blues', ko: '시카고 블루스', sound: ['blues'], aliases: ['chicago blues'], rank: 4 }),

  // ══ REGGAE ═════════════════════════════════════════════════════════════════
  n({ id: 'dub', level: 'genre', en: 'Dub', ko: '덥', sound: ['reggae', 'electronic'], aliases: ['dub'], rank: 3 }),
  n({ id: 'dancehall', level: 'genre', en: 'Dancehall', ko: '댄스홀', sound: ['reggae'], aliases: ['dancehall'], rank: 3 }),
  n({ id: 'roots-reggae', level: 'genre', en: 'Roots Reggae', ko: '루츠 레게', sound: ['reggae'], aliases: ['roots reggae'], rank: 3 }),
  n({ id: 'ska', level: 'genre', en: 'Ska', ko: '스카', sound: ['reggae'], aliases: ['ska'], rank: 3 }),

  // ══ LATIN ══════════════════════════════════════════════════════════════════
  n({ id: 'salsa', level: 'genre', en: 'Salsa', ko: '살사', sound: ['latin'], aliases: ['salsa'], rank: 3 }),
  n({ id: 'bossa-nova', level: 'genre', en: 'Bossa Nova', ko: '보사노바', sound: ['latin', 'jazz'], scene: ['brazilian'], aliases: ['bossa nova'], rank: 5, surface: true }),
  n({ id: 'mpb', level: 'genre', en: 'MPB', ko: '엠피비', sound: ['latin'], scene: ['brazilian'], aliases: ['mpb', 'musica popular brasileira', 'música popular brasileira'], rank: 5 }),

  // ══ Phase-1.5 coverage expansion (2026-09-21) ══════════════════════════════
  // Nodes for the highest-frequency tags the Phase-1 backfill routed to
  // genre_unmapped (all ≥~196 occurrences in the live catalog). Same shape/rules
  // as above; appended as a block since node order is irrelevant (NODE_BY_ID is a
  // map and the resolver folds over the whole set). display.ko is FIRST PASS.

  // — Metal —
  n({ id: 'death-metal', level: 'genre', en: 'Death Metal', ko: '데스 메탈', sound: ['metal'], aliases: ['death metal'], rank: 4 }),
  n({ id: 'melodic-death-metal', level: 'genre', en: 'Melodic Death Metal', ko: '멜로딕 데스 메탈', sound: ['metal'], aliases: ['melodic death metal', 'melodeath'], rank: 4 }),
  n({ id: 'black-metal', level: 'genre', en: 'Black Metal', ko: '블랙 메탈', sound: ['metal'], aliases: ['black metal'], rank: 4 }),
  n({ id: 'thrash-metal', level: 'genre', en: 'Thrash Metal', ko: '스래시 메탈', sound: ['metal'], aliases: ['thrash metal', 'thrash'], rank: 4 }),
  n({ id: 'doom-metal', level: 'genre', en: 'Doom Metal', ko: '둠 메탈', sound: ['metal'], aliases: ['doom metal'], rank: 4 }),
  n({ id: 'power-metal', level: 'genre', en: 'Power Metal', ko: '파워 메탈', sound: ['metal'], aliases: ['power metal'], rank: 4 }),
  n({ id: 'progressive-metal', level: 'genre', en: 'Progressive Metal', ko: '프로그레시브 메탈', sound: ['metal'], aliases: ['progressive metal', 'prog metal'], rank: 4 }),
  n({ id: 'symphonic-metal', level: 'genre', en: 'Symphonic Metal', ko: '심포닉 메탈', sound: ['metal', 'classical'], aliases: ['symphonic metal'], rank: 4 }),
  n({ id: 'industrial-metal', level: 'genre', en: 'Industrial Metal', ko: '인더스트리얼 메탈', sound: ['metal', 'electronic'], aliases: ['industrial metal'], rank: 4 }),
  n({ id: 'funk-metal', level: 'genre', en: 'Funk Metal', ko: '훵크 메탈', sound: ['metal', 'rnb-soul'], aliases: ['funk metal'], rank: 4 }),
  n({ id: 'metalcore', level: 'genre', en: 'Metalcore', ko: '메탈코어', sound: ['metal', 'punk'], aliases: ['metalcore'], rank: 4 }),
  n({ id: 'grindcore', level: 'genre', en: 'Grindcore', ko: '그라인드코어', sound: ['metal', 'punk'], aliases: ['grindcore'], rank: 4 }),

  // — Punk —
  n({ id: 'melodic-hardcore', level: 'genre', en: 'Melodic Hardcore', ko: '멜로딕 하드코어', sound: ['punk'], aliases: ['melodic hardcore'], rank: 4 }),
  n({ id: 'emo-pop', level: 'genre', en: 'Emo Pop', ko: '이모 팝', sound: ['punk', 'pop'], aliases: ['emo pop', 'emo-pop'], rank: 4 }),

  // — Rock —
  n({ id: 'grunge', level: 'genre', en: 'Grunge', ko: '그런지', sound: ['rock'], aliases: ['grunge'], rank: 3 }),
  n({ id: 'post-grunge', level: 'genre', en: 'Post-Grunge', ko: '포스트 그런지', sound: ['rock'], aliases: ['post-grunge', 'post grunge'], rank: 3 }),
  n({ id: 'arena-rock', level: 'genre', en: 'Arena Rock', ko: '아레나 록', sound: ['rock'], aliases: ['arena rock', 'aor', 'album-oriented rock'], rank: 2 }),
  n({ id: 'southern-rock', level: 'genre', en: 'Southern Rock', ko: '서던 록', sound: ['rock'], aliases: ['southern rock'], rank: 3 }),
  n({ id: 'glam-rock', level: 'genre', en: 'Glam Rock', ko: '글램 록', sound: ['rock'], aliases: ['glam rock', 'glam'], rank: 3 }),
  n({ id: 'surf-rock', level: 'genre', en: 'Surf Rock', ko: '서프 록', sound: ['rock'], aliases: ['surf rock', 'surf'], rank: 3 }),
  n({ id: 'space-rock', level: 'genre', en: 'Space Rock', ko: '스페이스 록', sound: ['rock'], aliases: ['space rock'], rank: 3 }),
  n({ id: 'stoner-rock', level: 'genre', en: 'Stoner Rock', ko: '스토너 록', sound: ['rock'], aliases: ['stoner rock', 'stoner metal'], rank: 3 }),
  n({ id: 'gothic-rock', level: 'genre', en: 'Gothic Rock', ko: '고딕 록', sound: ['rock'], aliases: ['gothic rock', 'goth rock'], rank: 3 }),
  n({ id: 'krautrock', level: 'genre', en: 'Krautrock', ko: '크라우트록', sound: ['rock', 'experimental'], aliases: ['krautrock'], rank: 3 }),
  n({ id: 'noise-rock', level: 'genre', en: 'Noise Rock', ko: '노이즈 록', sound: ['rock', 'experimental'], aliases: ['noise rock'], rank: 3 }),
  n({ id: 'experimental-rock', level: 'genre', en: 'Experimental Rock', ko: '실험 록', sound: ['rock', 'experimental'], aliases: ['experimental rock'], rank: 3 }),
  n({ id: 'symphonic-rock', level: 'genre', en: 'Symphonic Rock', ko: '심포닉 록', sound: ['rock', 'classical'], aliases: ['symphonic rock'], rank: 3 }),
  n({ id: 'jazz-rock', level: 'genre', en: 'Jazz Rock', ko: '재즈 록', sound: ['rock', 'jazz'], aliases: ['jazz rock'], rank: 3 }),
  n({ id: 'rap-rock', level: 'genre', en: 'Rap Rock', ko: '랩 록', sound: ['rock', 'hip-hop'], aliases: ['rap rock'], rank: 4 }),
  n({ id: 'funk-rock', level: 'genre', en: 'Funk Rock', ko: '훵크 록', sound: ['rock', 'rnb-soul'], aliases: ['funk rock'], rank: 3 }),
  n({ id: 'electronic-rock', level: 'genre', en: 'Electronic Rock', ko: '일렉트로닉 록', sound: ['rock', 'electronic'], aliases: ['electronic rock'], rank: 3 }),
  n({ id: 'industrial-rock', level: 'genre', en: 'Industrial Rock', ko: '인더스트리얼 록', sound: ['rock', 'electronic'], aliases: ['industrial rock'], rank: 3 }),
  n({ id: 'latin-rock', level: 'genre', en: 'Latin Rock', ko: '라틴 록', sound: ['rock', 'latin'], aliases: ['latin rock'], rank: 4 }),
  n({ id: 'neo-psychedelia', level: 'genre', en: 'Neo-Psychedelia', ko: '네오 사이키델리아', sound: ['rock'], aliases: ['neo-psychedelia', 'neo psychedelia', 'neopsychedelia'], rank: 3 }),
  n({ id: 'post-punk-revival', level: 'genre', en: 'Post-Punk Revival', ko: '포스트 펑크 리바이벌', sound: ['rock', 'punk'], aliases: ['post-punk revival'], rank: 3 }),

  // — Hip-Hop —
  n({ id: 'southern-hip-hop', level: 'genre', en: 'Southern Hip-Hop', ko: '서던 힙합', sound: ['hip-hop'], aliases: ['southern hip hop', 'dirty south'], rank: 4 }),
  n({ id: 'alternative-hip-hop', level: 'genre', en: 'Alternative Hip-Hop', ko: '얼터너티브 힙합', sound: ['hip-hop'], aliases: ['alternative hip hop', 'alternative rap'], rank: 4 }),
  n({ id: 'experimental-hip-hop', level: 'genre', en: 'Experimental Hip-Hop', ko: '실험 힙합', sound: ['hip-hop', 'experimental'], aliases: ['experimental hip hop', 'abstract hip hop'], rank: 4 }),
  n({ id: 'underground-hip-hop', level: 'genre', en: 'Underground Hip-Hop', ko: '언더그라운드 힙합', sound: ['hip-hop'], aliases: ['underground hip hop'], rank: 4 }),
  n({ id: 'emo-rap', level: 'genre', en: 'Emo Rap', ko: '이모 랩', sound: ['hip-hop'], aliases: ['emo rap'], rank: 4 }),
  n({ id: 'crunk', level: 'genre', en: 'Crunk', ko: '크렁크', sound: ['hip-hop'], aliases: ['crunk'], rank: 4 }),
  n({ id: 'drill', level: 'genre', en: 'Drill', ko: '드릴', sound: ['hip-hop'], aliases: ['drill', 'uk drill'], rank: 4 }),
  n({ id: 'horrorcore', level: 'genre', en: 'Horrorcore', ko: '호러코어', sound: ['hip-hop'], aliases: ['horrorcore'], rank: 4 }),
  n({ id: 'g-funk', level: 'genre', en: 'G-Funk', ko: '지 훵크', sound: ['hip-hop', 'rnb-soul'], aliases: ['g-funk', 'gangsta funk'], rank: 4 }),

  // — Pop —
  n({ id: 'baroque-pop', level: 'genre', en: 'Baroque Pop', ko: '바로크 팝', sound: ['pop', 'classical'], aliases: ['baroque pop'], rank: 3 }),
  n({ id: 'chamber-pop', level: 'genre', en: 'Chamber Pop', ko: '체임버 팝', sound: ['pop', 'classical'], aliases: ['chamber pop'], rank: 3 }),
  n({ id: 'psychedelic-pop', level: 'genre', en: 'Psychedelic Pop', ko: '사이키델릭 팝', sound: ['pop', 'rock'], aliases: ['psychedelic pop', 'psych pop'], rank: 3 }),
  n({ id: 'noise-pop', level: 'genre', en: 'Noise Pop', ko: '노이즈 팝', sound: ['pop', 'rock'], aliases: ['noise pop'], rank: 3 }),
  n({ id: 'ambient-pop', level: 'genre', en: 'Ambient Pop', ko: '앰비언트 팝', sound: ['pop', 'electronic'], aliases: ['ambient pop'], rank: 3 }),
  n({ id: 'jazz-pop', level: 'genre', en: 'Jazz Pop', ko: '재즈 팝', sound: ['pop', 'jazz'], aliases: ['jazz pop'], rank: 3 }),
  n({ id: 'bedroom-pop', level: 'genre', en: 'Bedroom Pop', ko: '베드룸 팝', sound: ['pop'], aliases: ['bedroom pop'], rank: 3 }),
  n({ id: 'hyperpop', level: 'genre', en: 'Hyperpop', ko: '하이퍼팝', sound: ['pop', 'electronic'], aliases: ['hyperpop', 'hyper pop'], rank: 4 }),
  n({ id: 'teen-pop', level: 'genre', en: 'Teen Pop', ko: '틴 팝', sound: ['pop'], aliases: ['teen pop'], rank: 2 }),
  n({ id: 'traditional-pop', level: 'genre', en: 'Traditional Pop', ko: '트래디셔널 팝', sound: ['pop'], aliases: ['traditional pop', 'vocal pop'], rank: 2 }),
  n({ id: 'doo-wop', level: 'genre', en: 'Doo-Wop', ko: '두왑', sound: ['pop', 'rnb-soul'], aliases: ['doo-wop', 'doo wop'], rank: 3 }),
  n({ id: 'progressive-pop', level: 'genre', en: 'Progressive Pop', ko: '프로그레시브 팝', sound: ['pop'], aliases: ['progressive pop'], rank: 3 }),
  n({ id: 'contemporary-christian', level: 'genre', en: 'Contemporary Christian', ko: '컨템퍼러리 크리스천', sound: ['pop'], aliases: ['contemporary christian', 'ccm', 'christian pop'], rank: 2 }),
  n({ id: 'chanson', level: 'genre', en: 'Chanson', ko: '샹송', sound: ['pop', 'folk'], aliases: ['chanson', 'chanson française', 'chanson francaise', 'french chanson'], rank: 2 }),
  n({ id: 'afrobeats', level: 'genre', en: 'Afrobeats', ko: '아프로비츠', sound: ['pop', 'electronic'], aliases: ['afrobeats'], rank: 3 }),
  // Pop — scene-qualified
  n({ id: 'enka', level: 'genre', en: 'Enka', ko: '엔카', sound: ['pop'], scene: ['japanese'], aliases: ['enka'], rank: 5 }),
  n({ id: 'cantopop', level: 'genre', en: 'Cantopop', ko: '칸토팝', sound: ['pop'], scene: ['chinese'], aliases: ['cantopop', 'canto-pop', 'cantonese pop'], rank: 5 }),

  // — Electronic —
  n({ id: 'noise', level: 'genre', en: 'Noise', ko: '노이즈', sound: ['experimental'], aliases: ['noise', 'noise music'], rank: 3 }),
  n({ id: 'synthwave', level: 'genre', en: 'Synthwave', ko: '신스웨이브', sound: ['electronic'], aliases: ['synthwave', 'retrowave', 'outrun'], rank: 4 }),
  n({ id: 'vaporwave', level: 'genre', en: 'Vaporwave', ko: '베이퍼웨이브', sound: ['electronic'], aliases: ['vaporwave'], rank: 4 }),
  n({ id: 'chiptune', level: 'genre', en: 'Chiptune', ko: '칩튠', sound: ['electronic'], aliases: ['chiptune', '8-bit', 'bitpop'], rank: 4 }),
  n({ id: 'breakcore', level: 'genre', en: 'Breakcore', ko: '브레이크코어', sound: ['electronic'], aliases: ['breakcore'], rank: 4 }),
  n({ id: 'jungle', level: 'genre', en: 'Jungle', ko: '정글', sound: ['electronic'], aliases: ['jungle'], rank: 4 }),
  n({ id: 'happy-hardcore', level: 'genre', en: 'Happy Hardcore', ko: '해피 하드코어', sound: ['electronic'], aliases: ['happy hardcore'], rank: 4 }),
  n({ id: 'uk-hardcore', level: 'genre', en: 'UK Hardcore', ko: '유케이 하드코어', sound: ['electronic'], aliases: ['uk hardcore'], rank: 4 }),
  n({ id: 'gabber', level: 'genre', en: 'Gabber', ko: '가버', sound: ['electronic'], aliases: ['gabber'], rank: 4 }),
  n({ id: 'hardstyle', level: 'genre', en: 'Hardstyle', ko: '하드스타일', sound: ['electronic'], aliases: ['hardstyle'], rank: 4 }),
  n({ id: 'psytrance', level: 'genre', en: 'Psytrance', ko: '사이트랜스', sound: ['electronic'], aliases: ['psytrance', 'psychedelic trance', 'goa trance'], rank: 4 }),
  n({ id: 'hard-trance', level: 'genre', en: 'Hard Trance', ko: '하드 트랜스', sound: ['electronic'], aliases: ['hard trance'], rank: 4 }),
  n({ id: 'big-beat', level: 'genre', en: 'Big Beat', ko: '빅 비트', sound: ['electronic'], aliases: ['big beat'], rank: 4 }),
  n({ id: 'future-bass', level: 'genre', en: 'Future Bass', ko: '퓨처 베이스', sound: ['electronic'], aliases: ['future bass'], rank: 4 }),
  n({ id: 'glitch', level: 'genre', en: 'Glitch', ko: '글리치', sound: ['electronic', 'experimental'], aliases: ['glitch'], rank: 4 }),
  n({ id: 'drone', level: 'genre', en: 'Drone', ko: '드론', sound: ['electronic', 'experimental'], aliases: ['drone', 'drone music'], rank: 4 }),
  n({ id: 'dark-ambient', level: 'genre', en: 'Dark Ambient', ko: '다크 앰비언트', sound: ['electronic', 'experimental'], aliases: ['dark ambient'], rank: 4 }),
  n({ id: 'ebm', level: 'genre', en: 'EBM', ko: '이비엠', sound: ['electronic'], aliases: ['ebm', 'electronic body music'], rank: 4 }),
  n({ id: 'darkwave', level: 'genre', en: 'Darkwave', ko: '다크웨이브', sound: ['electronic'], aliases: ['darkwave', 'dark wave'], rank: 3 }),
  n({ id: 'electroclash', level: 'genre', en: 'Electroclash', ko: '일렉트로클래시', sound: ['electronic'], aliases: ['electroclash'], rank: 4 }),
  n({ id: 'indietronica', level: 'genre', en: 'Indietronica', ko: '인디트로니카', sound: ['electronic', 'pop'], aliases: ['indietronica', 'indie electronic'], rank: 3 }),
  n({ id: 'alternative-dance', level: 'genre', en: 'Alternative Dance', ko: '얼터너티브 댄스', sound: ['electronic', 'rock'], aliases: ['alternative dance'], rank: 3 }),
  n({ id: 'eurodance', level: 'genre', en: 'Eurodance', ko: '유로댄스', sound: ['electronic', 'pop'], aliases: ['eurodance'], rank: 3 }),
  n({ id: 'nu-disco', level: 'genre', en: 'Nu-Disco', ko: '누 디스코', sound: ['electronic', 'rnb-soul'], aliases: ['nu disco', 'nu-disco'], rank: 4 }),
  n({ id: 'hip-house', level: 'genre', en: 'Hip House', ko: '힙 하우스', sound: ['electronic', 'hip-hop'], aliases: ['hip house'], rank: 4 }),
  n({ id: 'dub-techno', level: 'genre', en: 'Dub Techno', ko: '덥 테크노', sound: ['electronic'], aliases: ['dub techno'], rank: 4 }),
  n({ id: 'future-funk', level: 'genre', en: 'Future Funk', ko: '퓨처 훵크', sound: ['electronic', 'rnb-soul'], aliases: ['future funk'], rank: 4 }),
  n({ id: 'acid-house', level: 'subgenre', en: 'Acid House', ko: '애시드 하우스', sound: ['house'], aliases: ['acid house'], rank: 4 }),
  n({ id: 'garage-house', level: 'subgenre', en: 'Garage House', ko: '개러지 하우스', sound: ['house'], aliases: ['garage house'], rank: 4 }),
  n({ id: 'hard-house', level: 'subgenre', en: 'Hard House', ko: '하드 하우스', sound: ['house'], aliases: ['hard house'], rank: 4 }),

  // — Jazz —
  n({ id: 'bebop', level: 'genre', en: 'Bebop', ko: '비밥', sound: ['jazz'], aliases: ['bebop', 'bop'], rank: 4 }),
  n({ id: 'ragtime', level: 'genre', en: 'Ragtime', ko: '래그타임', sound: ['jazz'], aliases: ['ragtime'], rank: 3 }),
  n({ id: 'jazz-fusion', level: 'genre', en: 'Jazz Fusion', ko: '재즈 퓨전', sound: ['jazz', 'rock'], aliases: ['jazz fusion', 'fusion'], rank: 4 }),
  n({ id: 'acid-jazz', level: 'genre', en: 'Acid Jazz', ko: '애시드 재즈', sound: ['jazz', 'electronic'], aliases: ['acid jazz'], rank: 4 }),
  n({ id: 'avant-garde-jazz', level: 'genre', en: 'Avant-Garde Jazz', ko: '아방가르드 재즈', sound: ['jazz', 'experimental'], aliases: ['avant-garde jazz', 'avant garde jazz'], rank: 4 }),
  n({ id: 'afro-cuban-jazz', level: 'genre', en: 'Afro-Cuban Jazz', ko: '아프로 쿠반 재즈', sound: ['jazz', 'latin'], aliases: ['afro-cuban jazz', 'afro cuban jazz'], rank: 4 }),
  n({ id: 'free-improvisation', level: 'genre', en: 'Free Improvisation', ko: '프리 임프로비제이션', sound: ['jazz', 'experimental'], aliases: ['free improvisation', 'free improv'], rank: 4 }),

  // — R&B & Soul —
  n({ id: 'new-jack-swing', level: 'genre', en: 'New Jack Swing', ko: '뉴 잭 스윙', sound: ['rnb-soul', 'hip-hop'], aliases: ['new jack swing'], rank: 4 }),
  n({ id: 'deep-soul', level: 'genre', en: 'Deep Soul', ko: '딥 소울', sound: ['rnb-soul'], aliases: ['deep soul'], rank: 3 }),
  n({ id: 'smooth-soul', level: 'genre', en: 'Smooth Soul', ko: '스무스 소울', sound: ['rnb-soul'], aliases: ['smooth soul'], rank: 3 }),
  n({ id: 'southern-soul', level: 'genre', en: 'Southern Soul', ko: '서던 소울', sound: ['rnb-soul'], aliases: ['southern soul'], rank: 3 }),
  n({ id: 'blue-eyed-soul', level: 'genre', en: 'Blue-Eyed Soul', ko: '블루 아이드 소울', sound: ['rnb-soul'], aliases: ['blue-eyed soul', 'blue eyed soul'], rank: 3 }),
  n({ id: 'afrobeat', level: 'genre', en: 'Afrobeat', ko: '아프로비트', sound: ['rnb-soul', 'jazz'], aliases: ['afrobeat'], rank: 3 }),

  // — Folk —
  n({ id: 'contemporary-folk', level: 'genre', en: 'Contemporary Folk', ko: '컨템퍼러리 포크', sound: ['folk'], aliases: ['contemporary folk'], rank: 3 }),
  n({ id: 'neofolk', level: 'genre', en: 'Neofolk', ko: '네오포크', sound: ['folk'], aliases: ['neofolk', 'neo-folk'], rank: 3 }),
  n({ id: 'celtic', level: 'genre', en: 'Celtic', ko: '켈틱', sound: ['folk'], aliases: ['celtic', 'celtic folk', 'celtic music'], rank: 3 }),
  n({ id: 'flamenco', level: 'genre', en: 'Flamenco', ko: '플라멩코', sound: ['folk'], aliases: ['flamenco'], rank: 3 }),
  n({ id: 'qawwali', level: 'genre', en: 'Qawwali', ko: '카왈리', sound: ['folk'], scene: ['indian'], aliases: ['qawwali'], rank: 5 }),

  // — Country —
  n({ id: 'classic-country', level: 'genre', en: 'Classic Country', ko: '클래식 컨트리', sound: ['country'], aliases: ['classic country'], rank: 2 }),
  n({ id: 'alternative-country', level: 'genre', en: 'Alternative Country', ko: '얼터너티브 컨트리', sound: ['country'], aliases: ['alternative country', 'alt-country', 'alt country'], rank: 3 }),
  n({ id: 'bakersfield-sound', level: 'genre', en: 'Bakersfield Sound', ko: '베이커스필드 사운드', sound: ['country'], aliases: ['bakersfield sound'], rank: 3 }),

  // — Classical —
  n({ id: 'symphony', level: 'genre', en: 'Symphony', ko: '교향곡', sound: ['classical'], aliases: ['symphony', 'symphonies'], rank: 2 }),
  n({ id: 'renaissance-music', level: 'genre', en: 'Renaissance', ko: '르네상스 음악', sound: ['classical'], aliases: ['renaissance'], rank: 3 }),
  n({ id: 'requiem', level: 'genre', en: 'Requiem', ko: '레퀴엠', sound: ['classical'], aliases: ['requiem'], rank: 3 }),
  n({ id: 'prelude', level: 'genre', en: 'Prelude', ko: '전주곡', sound: ['classical'], aliases: ['prelude'], rank: 2 }),
  n({ id: 'classical-crossover', level: 'genre', en: 'Classical Crossover', ko: '클래시컬 크로스오버', sound: ['classical', 'pop'], aliases: ['classical crossover'], rank: 2 }),
  n({ id: 'cinematic-classical', level: 'genre', en: 'Cinematic Classical', ko: '시네마틱 클래식', sound: ['classical'], aliases: ['cinematic classical', 'film score', 'film music'], rank: 2 }),
  n({ id: 'indian-classical', level: 'genre', en: 'Indian Classical', ko: '인도 고전음악', sound: ['classical'], scene: ['indian'], aliases: ['indian classical'], rank: 5 }),
  n({ id: 'hindustani-classical', level: 'genre', en: 'Hindustani Classical', ko: '힌두스타니 음악', sound: ['classical'], scene: ['indian'], aliases: ['hindustani classical', 'hindustani'], rank: 5 }),

  // — Blues —
  n({ id: 'country-blues', level: 'genre', en: 'Country Blues', ko: '컨트리 블루스', sound: ['blues', 'country'], aliases: ['country blues'], rank: 3 }),
  n({ id: 'delta-blues', level: 'genre', en: 'Delta Blues', ko: '델타 블루스', sound: ['blues'], aliases: ['delta blues'], rank: 3 }),
  n({ id: 'piano-blues', level: 'genre', en: 'Piano Blues', ko: '피아노 블루스', sound: ['blues'], aliases: ['piano blues'], rank: 3 }),
  n({ id: 'texas-blues', level: 'genre', en: 'Texas Blues', ko: '텍사스 블루스', sound: ['blues'], aliases: ['texas blues'], rank: 3 }),

  // — Reggae —
  n({ id: 'rocksteady', level: 'genre', en: 'Rocksteady', ko: '록스테디', sound: ['reggae'], aliases: ['rocksteady', 'rock steady'], rank: 3 }),
  n({ id: 'reggae-pop', level: 'genre', en: 'Reggae Pop', ko: '레게 팝', sound: ['reggae', 'pop'], aliases: ['reggae-pop', 'reggae pop'], rank: 3 }),
  n({ id: 'calypso', level: 'genre', en: 'Calypso', ko: '칼립소', sound: ['reggae'], aliases: ['calypso'], rank: 3 }),

  // — Latin —
  n({ id: 'samba', level: 'genre', en: 'Samba', ko: '삼바', sound: ['latin'], scene: ['brazilian'], aliases: ['samba'], rank: 5 }),
  n({ id: 'forro', level: 'genre', en: 'Forró', ko: '포호', sound: ['latin'], scene: ['brazilian'], aliases: ['forró', 'forro'], rank: 5 }),
  n({ id: 'bolero', level: 'genre', en: 'Bolero', ko: '볼레로', sound: ['latin'], aliases: ['bolero'], rank: 3 }),
  n({ id: 'bachata', level: 'genre', en: 'Bachata', ko: '바차타', sound: ['latin'], aliases: ['bachata'], rank: 3 }),
  n({ id: 'ranchera', level: 'genre', en: 'Ranchera', ko: '란체라', sound: ['latin'], aliases: ['ranchera'], rank: 3 }),
  n({ id: 'regional-mexicano', level: 'genre', en: 'Regional Mexicano', ko: '레히오날 멕시카노', sound: ['latin'], aliases: ['regional mexicano', 'musica mexicana', 'música mexicana'], rank: 3 }),
  n({ id: 'mariachi', level: 'genre', en: 'Mariachi', ko: '마리아치', sound: ['latin'], aliases: ['mariachi'], rank: 3 }),
  n({ id: 'norteno', level: 'genre', en: 'Norteño', ko: '노르테뇨', sound: ['latin'], aliases: ['norteño', 'norteno'], rank: 3 }),
  n({ id: 'merengue', level: 'genre', en: 'Merengue', ko: '메렝게', sound: ['latin'], aliases: ['merengue'], rank: 3 }),
  n({ id: 'cumbia', level: 'genre', en: 'Cumbia', ko: '쿰비아', sound: ['latin'], aliases: ['cumbia'], rank: 3 }),
  n({ id: 'mambo', level: 'genre', en: 'Mambo', ko: '맘보', sound: ['latin'], aliases: ['mambo'], rank: 3 }),
  n({ id: 'guaracha', level: 'genre', en: 'Guaracha', ko: '과라차', sound: ['latin'], aliases: ['guaracha'], rank: 3 }),
  n({ id: 'trap-latino', level: 'genre', en: 'Latin Trap', ko: '라틴 트랩', sound: ['latin', 'hip-hop'], aliases: ['trap latino', 'latin trap'], rank: 4 }),
];

/** id → node, for O(1) lookup. */
export const NODE_BY_ID: ReadonlyMap<string, GenreNode> = new Map(
  TAXONOMY.map((node) => [node.id, node]),
);
