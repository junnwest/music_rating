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
  } | null;
};

export default function UserProfileScreen() {
  const { username } = useLocalSearchParams<{ username: string }>();
  const { user } = useAuth();
  const router = useRouter();

  const [profile, setProfile] = useState<Profile | null>(null);
  const [ratings, setRatings] = useState<RatingEntry[]>([]);
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

    const [ratingsRes, statsRes, followRes] = await Promise.all([
      supabase
        .from('ratings')
        .select('score, release_id, created_at, releases(id, title, artist, cover_url)')
        .eq('user_id', profileData.id)
        .order('created_at', { ascending: false })
        .limit(20),
      supabase
        .from('ratings')
        .select('score', { count: 'exact' })
        .eq('user_id', profileData.id),
      user
        ? supabase
            .from('follows')
            .select('follower_id')
            .eq('follower_id', user.id)
            .eq('following_id', profileData.id)
        : Promise.resolve({ data: [] }),
    ]);

    if (ratingsRes.data) setRatings(ratingsRes.data as unknown as RatingEntry[]);
    if (statsRes.count !== null) {
      setTotalCount(statsRes.count);
      if (statsRes.data && statsRes.data.length > 0) {
        const sum = statsRes.data.reduce((acc: number, r: any) => acc + Number(r.score), 0);
        setAvgScore(sum / statsRes.data.length);
      }
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
          <RefreshControl
            refreshing={refreshing}
            onRefresh={onRefresh}
            tintColor="#D97706"
          />
        }
      >
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
          {profile.bio ? (
            <Text style={styles.bio}>{profile.bio}</Text>
          ) : null}
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

        {ratings.length === 0 ? (
          <View style={styles.emptyGrid}>
            <Ionicons name="disc-outline" size={40} color="#E8E8E6" />
            <Text style={styles.emptyText}>No ratings yet</Text>
          </View>
        ) : (
          <View style={styles.grid}>
            {ratings.map((entry) => {
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

        <View style={{ height: 32 }} />
      </ScrollView>
    </SafeAreaView>
  );
}

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
  grid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    paddingHorizontal: GRID_PADDING,
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
