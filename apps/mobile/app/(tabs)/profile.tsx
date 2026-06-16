import { useCallback, useEffect, useState } from 'react';
import {
  ActivityIndicator,
  Dimensions,
  FlatList,
  Modal,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Image } from 'expo-image';
import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { supabase } from '@/lib/supabase';
import { useAuth } from '@/context/AuthContext';
import { useLanguage } from '@/lib/i18n';
import { ScreenHeader } from '@/components/ScreenHeader';

const SCREEN_WIDTH = Dimensions.get('window').width;
const GRID_PADDING = 16;
const GRID_GAP = 2;
const COVER_SIZE = (SCREEN_WIDTH - 40 - GRID_GAP * 2) / 3;

type Profile = {
  id: string;
  username: string;
  display_name: string | null;
  avatar_url: string | null;
  bio: string | null;
  country: string | null;
};

type RatingEntry = {
  score: number;
  release_id: string;
  created_at: string;
  releases: { id: string; title: string; artist: string; cover_url: string | null; genres: string | null } | null;
};

type Collision = {
  releaseId: string;
  title: string;
  artist: string;
  coverUrl: string | null;
  myScore: number;
  friendScore: number;
  friendUsername: string;
  diff: number;
};

type Contradiction = {
  releaseId: string;
  title: string;
  artist: string;
  coverUrl: string | null;
  myScore: number;
  communityAvg: number;
  diff: number;
};

type PinnedAlbum = {
  release_id: string;
  title: string;
  artist: string;
  cover_url: string | null;
};

function getTasteDNA(ratings: RatingEntry[]): string[] {
  if (ratings.length < 5) return [];
  const scores = ratings.map((r) => r.score).filter(Boolean);
  const avg = scores.reduce((a, b) => a + b, 0) / scores.length;
  const variance = scores.reduce((a, b) => a + Math.pow(b - avg, 2), 0) / scores.length;
  const sd = Math.sqrt(variance);
  const fivePct = scores.filter((s) => s === 5).length / scores.length;

  const genreCount = new Map<string, number>();
  for (const r of ratings) {
    const g = r.releases?.genres;
    if (!g) continue;
    for (const genre of g.split(',')) {
      const key = genre.trim().toLowerCase();
      if (key) genreCount.set(key, (genreCount.get(key) ?? 0) + 1);
    }
  }
  const topGenre = [...genreCount.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? '';

  let genreTag = '';
  if (topGenre.includes('k-pop') || topGenre.includes('korean pop')) genreTag = 'K-Pop devotee';
  else if (topGenre.includes('k-r&b') || topGenre.includes('korean r&b')) genreTag = 'K-R&B connoisseur';
  else if (topGenre.includes('k-rap') || topGenre.includes('korean hip')) genreTag = 'K-Rap head';
  else if (topGenre.includes('r&b') || topGenre.includes('soul')) genreTag = 'R&B connoisseur';
  else if (topGenre.includes('indie')) genreTag = 'Indie explorer';
  else if (topGenre.includes('hip hop') || topGenre.includes('hip-hop') || topGenre.includes('rap')) genreTag = 'Hip-hop head';
  else if (topGenre.includes('ballad')) genreTag = 'Ballad purist';
  else if (topGenre.includes('jazz')) genreTag = 'Jazz aficionado';
  else if (topGenre.includes('rock')) genreTag = 'Rock loyalist';
  else if (topGenre.includes('electronic') || topGenre.includes('synth')) genreTag = 'Electronic wanderer';
  else if (topGenre.includes('folk') || topGenre.includes('acoustic')) genreTag = 'Folk purist';
  else if (topGenre.includes('pop')) genreTag = 'Pop enthusiast';

  let behaviorTag = '';
  if (avg < 2.5) behaviorTag = 'Harsh critic';
  else if (avg > 4.3) behaviorTag = 'Eternal optimist';
  else if (fivePct === 0 && scores.length >= 10) behaviorTag = 'Impossible to impress';
  else if (fivePct > 0.35) behaviorTag = 'Generous soul';
  else if (sd > 1.4) behaviorTag = 'All or nothing';
  else if (sd < 0.5 && scores.length >= 10) behaviorTag = 'Measured listener';

  return [genreTag, behaviorTag].filter(Boolean);
}

function getTopGenres(ratings: RatingEntry[]): { name: string; count: number }[] {
  const tally = new Map<string, number>();
  for (const r of ratings) {
    const g = r.releases?.genres;
    if (!g) continue;
    for (const genre of g.split(',')) {
      const key = genre.trim().toLowerCase();
      if (key) tally.set(key, (tally.get(key) ?? 0) + 1);
    }
  }
  return [...tally.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 5)
    .map(([name, count]) => ({ name: name.split(' ').map((w) => w.charAt(0).toUpperCase() + w.slice(1)).join(' '), count }));
}

function ScoreBar({ bars }: { bars: number[] }) {
  const max = Math.max(...bars, 1);
  const maxVal = Math.max(...bars);
  const modeIdx = maxVal > 0 ? bars.indexOf(maxVal) : -1;
  return (
    <View style={{ flexDirection: 'row', gap: 3, height: 72, alignItems: 'flex-end' }}>
      {bars.map((h, i) => (
        <View key={i} style={{ flex: 1, alignItems: 'center', justifyContent: 'flex-end' }}>
          <View
            style={{
              width: '100%',
              height: Math.max(2, (h / max) * 64),
              backgroundColor: i === modeIdx ? '#D97706' : '#FDE8B0',
              borderRadius: 2,
            }}
          />
        </View>
      ))}
    </View>
  );
}

function SectionTitle({ title }: { title: string }) {
  return (
    <Text style={s.sectionTitle}>{title}</Text>
  );
}

export default function ProfileScreen() {
  const { user, loading: authLoading } = useAuth();
  const router = useRouter();
  const { t } = useLanguage();

  const [profile, setProfile] = useState<Profile | null>(null);
  const [allRatings, setAllRatings] = useState<RatingEntry[]>([]);
  const [recentRatings, setRecentRatings] = useState<RatingEntry[]>([]);
  const [totalCount, setTotalCount] = useState(0);
  const [avgScore, setAvgScore] = useState<number | null>(null);
  const [pinned, setPinned] = useState<PinnedAlbum[]>([]);
  const [collisions, setCollisions] = useState<Collision[]>([]);
  const [contradictions, setContradictions] = useState<Contradiction[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  // Essentials picker
  const [pickerVisible, setPickerVisible] = useState(false);
  const [pickerQuery, setPickerQuery] = useState('');
  const [pickerResults, setPickerResults] = useState<RatingEntry[]>([]);

  const fetchData = useCallback(async () => {
    if (!user) return;

    const [profileRes, recentRes, allScoreRes, pinnedIdsRes, followsRes] = await Promise.all([
      supabase.from('profiles').select('*').eq('id', user.id).single(),
      supabase.from('ratings').select('score, release_id, created_at, releases(id, title, artist, cover_url, genres)').eq('user_id', user.id).order('created_at', { ascending: false }).limit(30),
      supabase.from('ratings').select('score, release_id, releases(genres)').eq('user_id', user.id),
      supabase.from('pinned_albums').select('release_id').eq('user_id', user.id).order('created_at'),
      supabase.from('follows').select('following_id').eq('follower_id', user.id),
    ]);

    if (profileRes.data) setProfile(profileRes.data);
    if (recentRes.data) setRecentRatings(recentRes.data as unknown as RatingEntry[]);

    if (allScoreRes.data) {
      const ratings = allScoreRes.data as unknown as RatingEntry[];
      setAllRatings(ratings);
      setTotalCount(ratings.length);
      if (ratings.length > 0) {
        const sum = ratings.reduce((a, r) => a + Number(r.score), 0);
        setAvgScore(Math.round((sum / ratings.length) * 10) / 10);
      }
    }

    if (pinnedIdsRes.data && pinnedIdsRes.data.length > 0) {
      const pinnedIds = pinnedIdsRes.data.map((p: any) => p.release_id);
      const { data: pinnedReleases } = await supabase
        .from('releases')
        .select('id, title, artist, cover_url')
        .in('id', pinnedIds);
      const releaseMap = new Map((pinnedReleases ?? []).map((r: any) => [r.id, r]));
      setPinned(pinnedIds.map((id: string) => {
        const rel = releaseMap.get(id);
        return {
          release_id: id,
          title: rel?.title ?? '—',
          artist: rel?.artist ?? '',
          cover_url: rel?.cover_url ?? null,
        };
      }));
    }

    // Collisions
    const followedIds = (followsRes.data ?? []).map((f: any) => f.following_id);
    if (followedIds.length > 0 && allScoreRes.data) {
      const myScoreMap = new Map((allScoreRes.data as any[]).map((r) => [r.release_id, r.score]));
      const myIds = [...myScoreMap.keys()];
      const { data: friendRatings } = await supabase.from('ratings').select('user_id, release_id, score, releases(title, artist, cover_url)').in('user_id', followedIds).in('release_id', myIds).not('score', 'is', null);
      const { data: friendProfiles } = await supabase.from('profiles').select('id, username').in('id', followedIds);
      const userMap = new Map((friendProfiles ?? []).map((p: any) => [p.id, p.username]));
      const cols: Collision[] = (friendRatings ?? []).flatMap((r: any) => {
        const myScore = myScoreMap.get(r.release_id) as number;
        const diff = Math.abs(myScore - r.score);
        if (diff < 1.5) return [];
        return [{ releaseId: r.release_id, title: r.releases?.title ?? '—', artist: r.releases?.artist ?? '', coverUrl: r.releases?.cover_url ?? null, myScore, friendScore: r.score, friendUsername: userMap.get(r.user_id) ?? '?', diff }];
      }).sort((a: Collision, b: Collision) => b.diff - a.diff).slice(0, 6);
      setCollisions(cols);
    }

    // Contradictions
    if (allScoreRes.data && allScoreRes.data.length > 0) {
      const myIds = (allScoreRes.data as any[]).map((r) => r.release_id);
      const { data: communityRatings } = await supabase.from('ratings').select('release_id, score').in('release_id', myIds).neq('user_id', user.id).not('score', 'is', null);
      const communityMap = new Map<string, { sum: number; count: number }>();
      for (const r of communityRatings ?? []) {
        const e = communityMap.get((r as any).release_id) ?? { sum: 0, count: 0 };
        e.sum += (r as any).score; e.count += 1;
        communityMap.set((r as any).release_id, e);
      }
      const contras: Contradiction[] = (allScoreRes.data as any[]).flatMap((r) => {
        const c = communityMap.get(r.release_id);
        if (!c || c.count < 2) return [];
        const communityAvg = Math.round((c.sum / c.count) * 10) / 10;
        const diff = r.score - communityAvg;
        if (Math.abs(diff) < 1.5) return [];
        return [{ releaseId: r.release_id, title: r.releases?.title ?? '—', artist: r.releases?.artist ?? '', coverUrl: r.releases?.cover_url ?? null, myScore: r.score, communityAvg, diff }];
      }).sort((a: Contradiction, b: Contradiction) => Math.abs(b.diff) - Math.abs(a.diff)).slice(0, 6);
      setContradictions(contras);
    }
  }, [user]);

  useEffect(() => {
    if (!user) { setLoading(false); return; }
    setLoading(true);
    fetchData().finally(() => setLoading(false));
  }, [user, fetchData]);

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    await fetchData();
    setRefreshing(false);
  }, [fetchData]);

  const addEssential = async (r: RatingEntry) => {
    if (pinned.length >= 6 || !user) return;
    await supabase.from('pinned_albums').insert({ user_id: user.id, release_id: r.release_id });
    setPinned((prev) => [...prev, { release_id: r.release_id, title: r.releases?.title ?? '—', artist: r.releases?.artist ?? '', cover_url: r.releases?.cover_url ?? null }]);
    setPickerVisible(false);
    setPickerQuery('');
  };

  const removeEssential = async (releaseId: string) => {
    if (!user) return;
    await supabase.from('pinned_albums').delete().eq('user_id', user.id).eq('release_id', releaseId);
    setPinned((prev) => prev.filter((p) => p.release_id !== releaseId));
  };

  useEffect(() => {
    if (!pickerQuery.trim()) { setPickerResults([]); return; }
    const t = setTimeout(async () => {
      const { data } = await supabase.from('ratings').select('score, release_id, releases(id, title, artist, cover_url, genres)').eq('user_id', user?.id ?? '').or(`releases.title.ilike.%${pickerQuery}%`).limit(20);
      if (data) setPickerResults(data as unknown as RatingEntry[]);
    }, 300);
    return () => clearTimeout(t);
  }, [pickerQuery, user]);

  if (authLoading) {
    return (
      <SafeAreaView style={s.container} edges={['top']}>
        <ActivityIndicator size="large" color="#D97706" style={{ marginTop: 60 }} />
      </SafeAreaView>
    );
  }

  if (!user) {
    return (
      <SafeAreaView style={s.container} edges={['top']}>
        <View style={s.signInPrompt}>
          <Ionicons name="person-circle-outline" size={72} color="#E8E8E6" />
          <Text style={s.signInTitle}>{t('profile.signInTitle')}</Text>
          <Text style={s.signInSub}>{t('profile.signInSub')}</Text>
          <Pressable style={({ pressed }) => [s.signInBtn, pressed && { opacity: 0.8 }]} onPress={() => router.push('/(auth)/login')}>
            <Text style={s.signInBtnText}>{t('profile.signInBtn')}</Text>
          </Pressable>
        </View>
      </SafeAreaView>
    );
  }

  const displayName = profile?.display_name || profile?.username || 'User';
  const initial = displayName.charAt(0).toUpperCase();
  const bars = Array.from({ length: 10 }, (_, i) => {
    const score = (i + 1) * 0.5;
    return allRatings.filter((r) => Number(r.score) === score).length;
  });
  const tasteDNA = getTasteDNA(allRatings);
  const topGenres = getTopGenres(allRatings);

  return (
    <SafeAreaView style={s.container} edges={['top']}>
      {/* Header */}
      <ScreenHeader
        title={t('profile.title')}
        right={
          <View style={s.headerIcons}>
            <Pressable style={s.headerIconBtn} onPress={() => router.push('/friends')}>
              <Ionicons name="people-outline" size={24} color="#1A1A18" />
            </Pressable>
            <Pressable style={s.headerIconBtn} onPress={() => router.push('/notifications')}>
              <Ionicons name="notifications-outline" size={24} color="#1A1A18" />
            </Pressable>
            <Pressable style={s.headerIconBtn} onPress={() => router.push('/settings')}>
              <Ionicons name="settings-outline" size={24} color="#1A1A18" />
            </Pressable>
          </View>
        }
      />

      {loading ? (
        <ActivityIndicator size="large" color="#D97706" style={{ marginTop: 60 }} />
      ) : (
        <ScrollView showsVerticalScrollIndicator={false} refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor="#D97706" />}>

          {/* Avatar + info */}
          <View style={s.profileSection}>
            {profile?.avatar_url ? (
              <Image source={{ uri: profile.avatar_url }} style={s.avatar} contentFit="cover" transition={200} />
            ) : (
              <View style={s.avatarFallback}><Text style={s.avatarInitial}>{initial}</Text></View>
            )}
            <Text style={s.displayName}>{displayName}</Text>
            {profile?.username ? <Text style={s.username}>@{profile.username}</Text> : null}
            {profile?.bio ? <Text style={s.bio}>{profile.bio}</Text> : null}
            <View style={s.statsRow}>
              <Text style={s.statsText}>
                {totalCount} {t(totalCount === 1 ? 'profile.rating' : 'profile.ratings')}
                {avgScore !== null ? `  ·  ★ ${avgScore.toFixed(1)} ${t('profile.avg')}` : ''}
              </Text>
            </View>
            {tasteDNA.length > 0 && (
              <View style={s.dnaRow}>
                {tasteDNA.map((tag) => (
                  <View key={tag} style={s.dnaBadge}>
                    <Text style={s.dnaBadgeText}>{tag}</Text>
                  </View>
                ))}
              </View>
            )}
          </View>

          {/* Score Distribution */}
          {totalCount >= 3 && (
            <View style={s.section}>
              <SectionTitle title={t('profile.scoreDistribution')} />
              <ScoreBar bars={bars} />
              <View style={s.scoreLabels}>
                <Text style={s.scoreLabel}>0.5</Text>
                <Text style={s.scoreLabel}>5.0</Text>
              </View>
            </View>
          )}

          {/* Top Genres */}
          {topGenres.length > 0 && (
            <View style={s.section}>
              <SectionTitle title={t('profile.topGenres')} />
              <View style={s.genreList}>
                {topGenres.map(({ name, count }) => (
                  <View key={name} style={s.genreRow}>
                    <Text style={s.genreName}>{name}</Text>
                    <Text style={s.genreCount}>{count}</Text>
                  </View>
                ))}
              </View>
            </View>
          )}

          {/* Essentials */}
          <View style={s.section}>
            <View style={s.sectionHeaderRow}>
              <SectionTitle title={t('profile.essentials')} />
              {pinned.length < 6 && (
                <Pressable onPress={() => setPickerVisible(true)}>
                  <Ionicons name="add-circle-outline" size={20} color="#D97706" />
                </Pressable>
              )}
            </View>
            {pinned.length === 0 ? (
              <Pressable style={s.essentialsEmpty} onPress={() => setPickerVisible(true)}>
                <Ionicons name="add-outline" size={24} color="#8C8C8A" />
                <Text style={s.essentialsEmptyText}>{t('profile.essentialsEmpty')}</Text>
              </Pressable>
            ) : (
              <View style={s.essentialsGrid}>
                {pinned.map((p) => (
                  <Pressable key={p.release_id} style={s.essentialItem} onLongPress={() => removeEssential(p.release_id)} onPress={() => router.push(`/album/${p.release_id}`)}>
                    <Image source={{ uri: p.cover_url ?? undefined }} style={s.essentialCover} contentFit="cover" />
                    <Text style={s.essentialTitle} numberOfLines={1}>{p.title}</Text>
                    <Text style={s.essentialArtist} numberOfLines={1}>{p.artist}</Text>
                  </Pressable>
                ))}
              </View>
            )}
          </View>

          {/* Ratings Grid */}
          <View style={s.section}>
            <SectionTitle title={t('profile.recentRatings')} />
            {recentRatings.length === 0 ? (
              <View style={s.emptyGrid}>
                <Ionicons name="disc-outline" size={40} color="#E8E8E6" />
                <Text style={s.emptyText}>{t('profile.noRatings')}</Text>
              </View>
            ) : (
              <View style={s.grid}>
                {recentRatings.map((entry) => {
                  const r = entry.releases;
                  if (!r) return null;
                  return (
                    <Pressable key={`${entry.release_id}-${entry.created_at}`} style={({ pressed }) => [s.gridItem, pressed && { opacity: 0.75 }]} onPress={() => router.push(`/album/${entry.release_id}`)}>
                      <Image source={{ uri: r.cover_url ?? undefined }} style={s.gridCover} contentFit="cover" transition={150} />
                      <View style={s.scoreBadge}><Text style={s.scoreBadgeText}>{Number(entry.score).toFixed(1)}</Text></View>
                    </Pressable>
                  );
                })}
              </View>
            )}
          </View>

          {/* Taste Collisions */}
          {collisions.length > 0 && (
            <View style={s.section}>
              <SectionTitle title={t('profile.tasteCollisions')} />
              <Text style={s.sectionSubtitle}>{t('profile.tasteCollisionsSub')}</Text>
              {collisions.map((c) => (
                <Pressable key={`${c.releaseId}-${c.friendUsername}`} style={s.conflictRow} onPress={() => router.push(`/album/${c.releaseId}`)}>
                  <Image source={{ uri: c.coverUrl ?? undefined }} style={s.conflictCover} contentFit="cover" />
                  <View style={s.conflictInfo}>
                    <Text style={s.conflictTitle} numberOfLines={1}>{c.title}</Text>
                    <Text style={s.conflictArtist} numberOfLines={1}>{c.artist}</Text>
                    <Text style={s.conflictScores}>{t('profile.you')} ★{c.myScore}  ·  @{c.friendUsername} ★{c.friendScore}</Text>
                  </View>
                  <View style={[s.diffBadge, { backgroundColor: '#FEF3DC' }]}>
                    <Text style={[s.diffBadgeText, { color: '#92400E' }]}>Δ{c.diff.toFixed(1)}</Text>
                  </View>
                </Pressable>
              ))}
            </View>
          )}

          {/* Taste Contradictions */}
          {contradictions.length > 0 && (
            <View style={s.section}>
              <SectionTitle title={t('profile.tasteContradictions')} />
              <Text style={s.sectionSubtitle}>{t('profile.tasteContradictionsSub')}</Text>
              {contradictions.map((c) => (
                <Pressable key={c.releaseId} style={s.conflictRow} onPress={() => router.push(`/album/${c.releaseId}`)}>
                  <Image source={{ uri: c.coverUrl ?? undefined }} style={s.conflictCover} contentFit="cover" />
                  <View style={s.conflictInfo}>
                    <Text style={s.conflictTitle} numberOfLines={1}>{c.title}</Text>
                    <Text style={s.conflictArtist} numberOfLines={1}>{c.artist}</Text>
                    <Text style={s.conflictScores}>{t('profile.you')} ★{c.myScore}  ·  {t('profile.community')} ★{c.communityAvg}</Text>
                  </View>
                  <View style={[s.diffBadge, { backgroundColor: c.diff > 0 ? '#DCFCE7' : '#FEE2E2' }]}>
                    <Text style={[s.diffBadgeText, { color: c.diff > 0 ? '#166534' : '#991B1B' }]}>{c.diff > 0 ? '+' : ''}{c.diff.toFixed(1)}</Text>
                  </View>
                </Pressable>
              ))}
            </View>
          )}

          <View style={{ height: 40 }} />
        </ScrollView>
      )}

      {/* Essentials Picker Modal */}
      <Modal visible={pickerVisible} animationType="slide" presentationStyle="pageSheet" onRequestClose={() => setPickerVisible(false)}>
        <View style={s.modal}>
          <View style={s.modalHeader}>
            <Text style={s.modalTitle}>{t('profile.addEssential')}</Text>
            <Pressable onPress={() => { setPickerVisible(false); setPickerQuery(''); }}>
              <Ionicons name="close" size={24} color="#1A1A18" />
            </Pressable>
          </View>
          <View style={s.modalSearch}>
            <Ionicons name="search-outline" size={16} color="#8C8C8A" />
            <TextInput style={s.modalSearchInput} placeholder={t('profile.searchRated')} placeholderTextColor="#8C8C8A" value={pickerQuery} onChangeText={setPickerQuery} autoFocus />
          </View>
          <FlatList
            data={pickerQuery.trim() ? pickerResults : recentRatings}
            keyExtractor={(item) => item.release_id}
            renderItem={({ item }) => {
              const r = item.releases;
              if (!r) return null;
              const alreadyPinned = pinned.some((p) => p.release_id === item.release_id);
              return (
                <Pressable style={[s.pickerRow, alreadyPinned && { opacity: 0.4 }]} onPress={() => !alreadyPinned && addEssential(item)} disabled={alreadyPinned}>
                  <Image source={{ uri: r.cover_url ?? undefined }} style={s.pickerCover} contentFit="cover" />
                  <View style={{ flex: 1 }}>
                    <Text style={s.pickerTitle} numberOfLines={1}>{r.title}</Text>
                    <Text style={s.pickerArtist} numberOfLines={1}>{r.artist}</Text>
                  </View>
                  <Text style={s.pickerScore}>★ {Number(item.score).toFixed(1)}</Text>
                </Pressable>
              );
            }}
          />
        </View>
      </Modal>
    </SafeAreaView>
  );
}

const s = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#F8F8F6' },
  headerIcons: { flexDirection: 'row', gap: 4 },
  headerIconBtn: { padding: 6 },
  signInPrompt: { flex: 1, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 40, gap: 12 },
  signInTitle: { fontSize: 20, fontWeight: '700', color: '#1A1A18', textAlign: 'center', letterSpacing: -0.4 },
  signInSub: { fontSize: 14, color: '#8C8C8A', textAlign: 'center' },
  signInBtn: { marginTop: 8, backgroundColor: '#D97706', borderRadius: 12, paddingVertical: 14, paddingHorizontal: 40 },
  signInBtnText: { fontSize: 15, fontWeight: '700', color: '#FFFFFF' },
  profileSection: { alignItems: 'center', paddingTop: 28, paddingBottom: 20, paddingHorizontal: 20 },
  avatar: { width: 84, height: 84, borderRadius: 42, marginBottom: 14, backgroundColor: '#E8E8E6' },
  avatarFallback: { width: 84, height: 84, borderRadius: 42, backgroundColor: '#D97706', alignItems: 'center', justifyContent: 'center', marginBottom: 14 },
  avatarInitial: { fontSize: 36, fontWeight: '700', color: '#FFFFFF' },
  displayName: { fontSize: 20, fontWeight: '700', color: '#1A1A18', letterSpacing: -0.4, marginBottom: 4 },
  username: { fontSize: 14, color: '#8C8C8A', marginBottom: 8 },
  bio: { fontSize: 13, color: '#8C8C8A', textAlign: 'center', lineHeight: 18, marginBottom: 12 },
  statsRow: { marginTop: 4 },
  statsText: { fontSize: 14, color: '#1A1A18', fontWeight: '500' },
  dnaRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginTop: 12, justifyContent: 'center' },
  dnaBadge: { backgroundColor: '#FEF3DC', borderWidth: 1, borderColor: '#FDE8B0', borderRadius: 20, paddingHorizontal: 12, paddingVertical: 5 },
  dnaBadgeText: { fontSize: 12, fontWeight: '600', color: '#92400E' },
  section: { paddingHorizontal: 20, paddingTop: 24, paddingBottom: 8 },
  sectionTitle: { fontSize: 13, fontWeight: '700', color: '#8C8C8A', textTransform: 'uppercase', letterSpacing: 0.7, marginBottom: 14 },
  sectionHeaderRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 14 },
  sectionSubtitle: { fontSize: 13, color: '#8C8C8A', marginBottom: 12, marginTop: -8 },
  scoreLabels: { flexDirection: 'row', justifyContent: 'space-between', marginTop: 4 },
  scoreLabel: { fontSize: 11, color: '#8C8C8A' },
  genreList: { gap: 8 },
  genreRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingVertical: 6, borderBottomWidth: 1, borderBottomColor: '#E8E8E6' },
  genreName: { fontSize: 14, color: '#1A1A18', fontWeight: '500' },
  genreCount: { fontSize: 13, color: '#8C8C8A' },
  essentialsEmpty: { borderWidth: 1, borderColor: '#E8E8E6', borderRadius: 10, borderStyle: 'dashed', padding: 24, alignItems: 'center', gap: 8 },
  essentialsEmptyText: { fontSize: 13, color: '#8C8C8A' },
  essentialsGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 12 },
  essentialItem: { width: (SCREEN_WIDTH - 40 - 24) / 3, alignItems: 'center' },
  essentialCover: { width: (SCREEN_WIDTH - 40 - 24) / 3, height: (SCREEN_WIDTH - 40 - 24) / 3, borderRadius: 6, backgroundColor: '#E8E8E6', marginBottom: 6 },
  essentialTitle: { fontSize: 11, fontWeight: '600', color: '#1A1A18', textAlign: 'center', width: '100%' },
  essentialArtist: { fontSize: 10, color: '#8C8C8A', textAlign: 'center', width: '100%' },
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: GRID_GAP },
  gridItem: { width: COVER_SIZE, height: COVER_SIZE, position: 'relative' },
  gridCover: { width: COVER_SIZE, height: COVER_SIZE, backgroundColor: '#E8E8E6' },
  scoreBadge: { position: 'absolute', bottom: 4, right: 4, backgroundColor: '#D97706', borderRadius: 4, paddingHorizontal: 5, paddingVertical: 2 },
  scoreBadgeText: { fontSize: 11, fontWeight: '700', color: '#FFFFFF' },
  emptyGrid: { alignItems: 'center', paddingTop: 40, gap: 12 },
  emptyText: { fontSize: 14, color: '#8C8C8A' },
  conflictRow: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 10, borderBottomWidth: 1, borderBottomColor: '#E8E8E6' },
  conflictCover: { width: 48, height: 48, borderRadius: 5, backgroundColor: '#E8E8E6' },
  conflictInfo: { flex: 1 },
  conflictTitle: { fontSize: 13, fontWeight: '600', color: '#1A1A18' },
  conflictArtist: { fontSize: 12, color: '#8C8C8A', marginTop: 1 },
  conflictScores: { fontSize: 12, color: '#D97706', marginTop: 3, fontWeight: '500' },
  diffBadge: { borderRadius: 6, paddingHorizontal: 8, paddingVertical: 4 },
  diffBadgeText: { fontSize: 12, fontWeight: '700' },
  modal: { flex: 1, backgroundColor: '#FFFFFF' },
  modalHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 20, paddingVertical: 16, borderBottomWidth: 1, borderBottomColor: '#E8E8E6' },
  modalTitle: { fontSize: 18, fontWeight: '700', color: '#1A1A18' },
  modalSearch: { flexDirection: 'row', alignItems: 'center', margin: 16, backgroundColor: '#F8F8F6', borderRadius: 10, paddingHorizontal: 12, paddingVertical: 10, gap: 8, borderWidth: 1, borderColor: '#E8E8E6' },
  modalSearchInput: { flex: 1, fontSize: 15, color: '#1A1A18' },
  pickerRow: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 16, paddingVertical: 10, gap: 12, borderBottomWidth: 1, borderBottomColor: '#E8E8E6' },
  pickerCover: { width: 44, height: 44, borderRadius: 5, backgroundColor: '#E8E8E6' },
  pickerTitle: { fontSize: 14, fontWeight: '600', color: '#1A1A18' },
  pickerArtist: { fontSize: 12, color: '#8C8C8A', marginTop: 2 },
  pickerScore: { fontSize: 13, fontWeight: '700', color: '#D97706' },
});
