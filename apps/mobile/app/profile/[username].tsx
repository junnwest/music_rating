import { useCallback, useEffect, useState } from 'react';
import {
  ActivityIndicator,
  Dimensions,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Image } from 'expo-image';
import { Ionicons } from '@expo/vector-icons';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { supabase } from '@/lib/supabase';
import { useAuth } from '@/context/AuthContext';

const SCREEN_WIDTH = Dimensions.get('window').width;
const GRID_PADDING = 16;
const GRID_GAP = 2;
const COVER_SIZE = (SCREEN_WIDTH - GRID_PADDING * 2 - GRID_GAP * 2) / 3;

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
  releases: {
    id: string;
    title: string;
    artist: string;
    cover_url: string | null;
    genres: string | null;
  } | null;
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
  if (scores.length === 0) return [];
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
    .map(([name, count]) => ({
      name: name.split(' ').map((w) => w.charAt(0).toUpperCase() + w.slice(1)).join(' '),
      count,
    }));
}

function getScoreBars(ratings: RatingEntry[]): number[] {
  const buckets = new Array(10).fill(0);
  for (const r of ratings) {
    const idx = Math.min(9, Math.max(0, Math.round(r.score * 2) - 1));
    buckets[idx]++;
  }
  return buckets;
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

export default function UserProfileScreen() {
  const { username } = useLocalSearchParams<{ username: string }>();
  const { user } = useAuth();
  const router = useRouter();

  const [profile, setProfile] = useState<Profile | null>(null);
  const [recentRatings, setRecentRatings] = useState<RatingEntry[]>([]);
  const [allRatings, setAllRatings] = useState<RatingEntry[]>([]);
  const [pinned, setPinned] = useState<PinnedAlbum[]>([]);
  const [totalCount, setTotalCount] = useState(0);
  const [avgScore, setAvgScore] = useState<number | null>(null);
  const [isFollowing, setIsFollowing] = useState(false);
  const [followLoading, setFollowLoading] = useState(false);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [notFound, setNotFound] = useState(false);

  const fetchData = useCallback(async () => {
    if (!username) return;

    const profileRes = await supabase
      .from('profiles')
      .select('*')
      .eq('username', username)
      .single();

    if (!profileRes.data) {
      setNotFound(true);
      return;
    }

    const profileData = profileRes.data as Profile;
    setProfile(profileData);

    const [recentRes, allScoreRes, pinnedIdsRes, followRes] = await Promise.all([
      supabase
        .from('ratings')
        .select('score, release_id, created_at, releases(id, title, artist, cover_url, genres)')
        .eq('user_id', profileData.id)
        .order('created_at', { ascending: false })
        .limit(30),
      supabase
        .from('ratings')
        .select('score, release_id, releases(genres)')
        .eq('user_id', profileData.id),
      supabase
        .from('pinned_albums')
        .select('release_id')
        .eq('user_id', profileData.id)
        .order('created_at'),
      user
        ? supabase
            .from('follows')
            .select('follower_id')
            .eq('follower_id', user.id)
            .eq('following_id', profileData.id)
        : Promise.resolve({ data: [] }),
    ]);

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

    setIsFollowing((followRes.data?.length ?? 0) > 0);
  }, [username, user]);

  useEffect(() => {
    setLoading(true);
    fetchData().finally(() => setLoading(false));
  }, [fetchData]);

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    await fetchData();
    setRefreshing(false);
  }, [fetchData]);

  const handleFollowToggle = async () => {
    if (!user || !profile) return;
    setFollowLoading(true);
    try {
      if (isFollowing) {
        await supabase
          .from('follows')
          .delete()
          .eq('follower_id', user.id)
          .eq('following_id', profile.id);
        setIsFollowing(false);
      } else {
        await supabase
          .from('follows')
          .insert({ follower_id: user.id, following_id: profile.id });
        setIsFollowing(true);
      }
    } finally {
      setFollowLoading(false);
    }
  };

  if (loading) {
    return (
      <SafeAreaView style={styles.container} edges={['top']}>
        <View style={styles.navHeader}>
          <Pressable style={styles.backBtn} onPress={() => router.back()}>
            <Ionicons name="chevron-back" size={24} color="#1A1A18" />
          </Pressable>
        </View>
        <ActivityIndicator size="large" color="#D97706" style={{ marginTop: 60 }} />
      </SafeAreaView>
    );
  }

  if (notFound || !profile) {
    return (
      <SafeAreaView style={styles.container} edges={['top']}>
        <View style={styles.navHeader}>
          <Pressable style={styles.backBtn} onPress={() => router.back()}>
            <Ionicons name="chevron-back" size={24} color="#1A1A18" />
          </Pressable>
        </View>
        <View style={styles.notFound}>
          <Ionicons name="person-outline" size={48} color="#E8E8E6" />
          <Text style={styles.notFoundText}>User not found</Text>
        </View>
      </SafeAreaView>
    );
  }

  const displayName = profile.display_name || profile.username;
  const initial = displayName.charAt(0).toUpperCase();
  const isOwnProfile = user?.id === profile.id;
  const tasteDNA = getTasteDNA(allRatings);
  const topGenres = getTopGenres(allRatings);
  const scoreBars = getScoreBars(allRatings);

  return (
    <SafeAreaView style={styles.container} edges={['top']}>
      <View style={styles.navHeader}>
        <Pressable style={styles.backBtn} onPress={() => router.back()}>
          <Ionicons name="chevron-back" size={24} color="#1A1A18" />
        </Pressable>
        <Text style={styles.navTitle}>@{profile.username}</Text>
        <View style={styles.navRight} />
      </View>

      <ScrollView
        showsVerticalScrollIndicator={false}
        refreshControl={
          <RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor="#D97706" />
        }
      >
        {/* Header */}
        <View style={styles.profileSection}>
          {profile.avatar_url ? (
            <Image
              source={{ uri: profile.avatar_url }}
              style={styles.avatar}
              contentFit="cover"
              transition={200}
            />
          ) : (
            <View style={styles.avatarFallback}>
              <Text style={styles.avatarInitial}>{initial}</Text>
            </View>
          )}
          <Text style={styles.displayName}>{displayName}</Text>
          <Text style={styles.username}>@{profile.username}</Text>
          {profile.bio ? <Text style={styles.bio}>{profile.bio}</Text> : null}

          {/* Taste DNA badges */}
          {tasteDNA.length > 0 && (
            <View style={styles.dnaRow}>
              {tasteDNA.map((tag) => (
                <View key={tag} style={styles.dnaBadge}>
                  <Text style={styles.dnaBadgeText}>{tag}</Text>
                </View>
              ))}
            </View>
          )}

          <View style={styles.statsRow}>
            <Text style={styles.statsText}>
              {totalCount} {totalCount === 1 ? 'rating' : 'ratings'}
              {avgScore !== null ? `  ·  ${avgScore.toFixed(1)} avg` : ''}
            </Text>
          </View>

          {!isOwnProfile && user && (
            <Pressable
              style={({ pressed }) => [
                styles.followBtn,
                isFollowing && styles.followBtnActive,
                pressed && { opacity: 0.75 },
                followLoading && { opacity: 0.6 },
              ]}
              onPress={handleFollowToggle}
              disabled={followLoading}
            >
              {followLoading ? (
                <ActivityIndicator size="small" color={isFollowing ? '#FFFFFF' : '#D97706'} />
              ) : (
                <Text style={[styles.followBtnText, isFollowing && styles.followBtnTextActive]}>
                  {isFollowing ? 'Following' : 'Follow'}
                </Text>
              )}
            </Pressable>
          )}
        </View>

        {/* Score distribution */}
        {totalCount >= 5 && (
          <View style={styles.card}>
            <Text style={styles.cardLabel}>Score Distribution</Text>
            <ScoreBar bars={scoreBars} />
            <View style={styles.barAxisRow}>
              {['0.5','1','1.5','2','2.5','3','3.5','4','4.5','5'].map((l) => (
                <Text key={l} style={styles.barAxisLabel}>{l}</Text>
              ))}
            </View>
          </View>
        )}

        {/* Essentials */}
        {pinned.length > 0 && (
          <View style={styles.card}>
            <Text style={styles.cardLabel}>Essentials</Text>
            <View style={styles.essentialsRow}>
              {pinned.map((p) => (
                <Pressable
                  key={p.release_id}
                  style={({ pressed }) => [styles.essentialItem, pressed && { opacity: 0.75 }]}
                  onPress={() => router.push(`/album/${p.release_id}`)}
                >
                  <Image
                    source={{ uri: p.cover_url ?? undefined }}
                    style={styles.essentialCover}
                    contentFit="cover"
                    transition={150}
                  />
                </Pressable>
              ))}
            </View>
          </View>
        )}

        {/* Top Genres */}
        {topGenres.length > 0 && (
          <View style={styles.card}>
            <Text style={styles.cardLabel}>Top Genres</Text>
            {topGenres.map(({ name, count }) => (
              <View key={name} style={styles.genreRow}>
                <Text style={styles.genreName}>{name}</Text>
                <View style={styles.genreBarTrack}>
                  <View
                    style={[
                      styles.genreBarFill,
                      { width: `${(count / topGenres[0].count) * 100}%` },
                    ]}
                  />
                </View>
                <Text style={styles.genreCount}>{count}</Text>
              </View>
            ))}
          </View>
        )}

        {/* Ratings grid */}
        <View style={styles.gridSection}>
          <Text style={styles.gridSectionLabel}>Ratings</Text>
          {recentRatings.length === 0 ? (
            <View style={styles.emptyGrid}>
              <Ionicons name="disc-outline" size={40} color="#E8E8E6" />
              <Text style={styles.emptyText}>No ratings yet</Text>
            </View>
          ) : (
            <View style={styles.grid}>
              {recentRatings.map((entry) => {
                const release = entry.releases;
                if (!release) return null;
                return (
                  <Pressable
                    key={`${entry.release_id}-${entry.created_at}`}
                    style={({ pressed }) => [styles.gridItem, pressed && { opacity: 0.75 }]}
                    onPress={() => router.push(`/album/${entry.release_id}`)}
                  >
                    <Image
                      source={{ uri: release.cover_url ?? undefined }}
                      style={styles.gridCover}
                      contentFit="cover"
                      transition={150}
                    />
                    <View style={styles.scoreBadge}>
                      <Text style={styles.scoreBadgeText}>{Number(entry.score).toFixed(1)}</Text>
                    </View>
                  </Pressable>
                );
              })}
            </View>
          )}
        </View>

        <View style={{ height: 32 }} />
      </ScrollView>
    </SafeAreaView>
  );
}

const ESSENTIAL_SIZE = (SCREEN_WIDTH - 32 - 5 * 8) / 6;

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#F8F8F6',
  },
  navHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 8,
    paddingVertical: 10,
    borderBottomWidth: 1,
    borderBottomColor: '#E8E8E6',
    backgroundColor: '#F8F8F6',
  },
  backBtn: {
    padding: 6,
    width: 40,
  },
  navTitle: {
    fontSize: 16,
    fontWeight: '600',
    color: '#1A1A18',
    letterSpacing: -0.3,
  },
  navRight: {
    width: 40,
  },
  notFound: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 12,
    paddingTop: 60,
  },
  notFoundText: {
    fontSize: 16,
    color: '#8C8C8A',
  },
  profileSection: {
    alignItems: 'center',
    paddingTop: 28,
    paddingBottom: 20,
    paddingHorizontal: 20,
  },
  avatar: {
    width: 84,
    height: 84,
    borderRadius: 42,
    marginBottom: 14,
    backgroundColor: '#E8E8E6',
  },
  avatarFallback: {
    width: 84,
    height: 84,
    borderRadius: 42,
    backgroundColor: '#D97706',
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 14,
  },
  avatarInitial: {
    fontSize: 36,
    fontWeight: '700',
    color: '#FFFFFF',
  },
  displayName: {
    fontSize: 20,
    fontWeight: '700',
    color: '#1A1A18',
    letterSpacing: -0.4,
    marginBottom: 4,
  },
  username: {
    fontSize: 14,
    color: '#8C8C8A',
    marginBottom: 8,
  },
  bio: {
    fontSize: 13,
    color: '#8C8C8A',
    textAlign: 'center',
    lineHeight: 18,
    marginBottom: 12,
  },
  dnaRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 6,
    justifyContent: 'center',
    marginBottom: 10,
  },
  dnaBadge: {
    backgroundColor: '#FEF3DC',
    borderRadius: 100,
    paddingHorizontal: 10,
    paddingVertical: 4,
  },
  dnaBadgeText: {
    fontSize: 11,
    fontWeight: '600',
    color: '#D97706',
  },
  statsRow: {
    marginTop: 4,
    marginBottom: 16,
  },
  statsText: {
    fontSize: 14,
    color: '#1A1A18',
    fontWeight: '500',
  },
  followBtn: {
    borderWidth: 1.5,
    borderColor: '#D97706',
    borderRadius: 20,
    paddingVertical: 8,
    paddingHorizontal: 32,
    minWidth: 120,
    alignItems: 'center',
  },
  followBtnActive: {
    backgroundColor: '#D97706',
  },
  followBtnText: {
    fontSize: 14,
    fontWeight: '600',
    color: '#D97706',
  },
  followBtnTextActive: {
    color: '#FFFFFF',
  },
  card: {
    marginHorizontal: 16,
    marginBottom: 16,
    backgroundColor: '#FFFFFF',
    borderRadius: 12,
    padding: 16,
    borderWidth: 1,
    borderColor: '#E8E8E6',
  },
  cardLabel: {
    fontSize: 11,
    fontWeight: '600',
    color: '#8C8C8A',
    textTransform: 'uppercase',
    letterSpacing: 0.6,
    marginBottom: 12,
  },
  barAxisRow: {
    flexDirection: 'row',
    marginTop: 4,
  },
  barAxisLabel: {
    flex: 1,
    fontSize: 8,
    color: '#8C8C8A',
    textAlign: 'center',
  },
  essentialsRow: {
    flexDirection: 'row',
    gap: 8,
  },
  essentialItem: {
    borderRadius: 4,
    overflow: 'hidden',
  },
  essentialCover: {
    width: ESSENTIAL_SIZE,
    height: ESSENTIAL_SIZE,
    backgroundColor: '#E8E8E6',
  },
  genreRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 10,
    gap: 8,
  },
  genreName: {
    fontSize: 13,
    fontWeight: '500',
    color: '#1A1A18',
    width: 120,
  },
  genreBarTrack: {
    flex: 1,
    height: 6,
    backgroundColor: '#F0F0EE',
    borderRadius: 3,
    overflow: 'hidden',
  },
  genreBarFill: {
    height: '100%',
    backgroundColor: '#E8A020',
    borderRadius: 3,
  },
  genreCount: {
    fontSize: 12,
    color: '#8C8C8A',
    width: 28,
    textAlign: 'right',
  },
  gridSection: {
    paddingHorizontal: GRID_PADDING,
    marginBottom: 8,
  },
  gridSectionLabel: {
    fontSize: 11,
    fontWeight: '600',
    color: '#8C8C8A',
    textTransform: 'uppercase',
    letterSpacing: 0.6,
    marginBottom: 10,
  },
  grid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: GRID_GAP,
  },
  gridItem: {
    width: COVER_SIZE,
    height: COVER_SIZE,
    position: 'relative',
  },
  gridCover: {
    width: COVER_SIZE,
    height: COVER_SIZE,
    backgroundColor: '#E8E8E6',
  },
  scoreBadge: {
    position: 'absolute',
    bottom: 4,
    right: 4,
    backgroundColor: '#D97706',
    borderRadius: 4,
    paddingHorizontal: 5,
    paddingVertical: 2,
  },
  scoreBadgeText: {
    fontSize: 11,
    fontWeight: '700',
    color: '#FFFFFF',
  },
  emptyGrid: {
    alignItems: 'center',
    paddingTop: 40,
    gap: 12,
  },
  emptyText: {
    fontSize: 14,
    color: '#8C8C8A',
  },
});
