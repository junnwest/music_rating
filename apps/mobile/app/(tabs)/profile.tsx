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
import { useRouter } from 'expo-router';
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

export default function ProfileScreen() {
  const { user, loading: authLoading } = useAuth();
  const router = useRouter();

  const [profile, setProfile] = useState<Profile | null>(null);
  const [ratings, setRatings] = useState<RatingEntry[]>([]);
  const [totalCount, setTotalCount] = useState(0);
  const [avgScore, setAvgScore] = useState<number | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  const fetchData = useCallback(async () => {
    if (!user) return;
    const [profileRes, ratingsRes, statsRes] = await Promise.all([
      supabase.from('profiles').select('*').eq('id', user.id).single(),
      supabase
        .from('ratings')
        .select('score, release_id, created_at, releases(id, title, artist, cover_url)')
        .eq('user_id', user.id)
        .order('created_at', { ascending: false })
        .limit(20),
      supabase
        .from('ratings')
        .select('score', { count: 'exact' })
        .eq('user_id', user.id),
    ]);

    if (profileRes.data) setProfile(profileRes.data);
    if (ratingsRes.data) setRatings(ratingsRes.data as unknown as RatingEntry[]);
    if (statsRes.count !== null) {
      setTotalCount(statsRes.count);
      if (statsRes.data && statsRes.data.length > 0) {
        const sum = statsRes.data.reduce((acc: number, r: any) => acc + Number(r.score), 0);
        setAvgScore(sum / statsRes.data.length);
      }
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

  if (authLoading) {
    return (
      <SafeAreaView style={styles.container} edges={['top']}>
        <ActivityIndicator size="large" color="#D97706" style={{ marginTop: 60 }} />
      </SafeAreaView>
    );
  }

  if (!user) {
    return (
      <SafeAreaView style={styles.container} edges={['top']}>
        <View style={styles.signInPrompt}>
          <Ionicons name="person-circle-outline" size={72} color="#E8E8E6" />
          <Text style={styles.signInTitle}>Sign in to see your profile</Text>
          <Text style={styles.signInSub}>Rate albums and track your music taste.</Text>
          <Pressable
            style={({ pressed }) => [styles.signInBtn, pressed && { opacity: 0.8 }]}
            onPress={() => router.push('/(auth)/login')}
          >
            <Text style={styles.signInBtnText}>Sign In</Text>
          </Pressable>
        </View>
      </SafeAreaView>
    );
  }

  const displayName = profile?.display_name || profile?.username || 'User';
  const initial = displayName.charAt(0).toUpperCase();

  return (
    <SafeAreaView style={styles.container} edges={['top']}>
      <View style={styles.header}>
        <Text style={styles.headerTitle}>Profile</Text>
        <View style={styles.headerIcons}>
          <Pressable
            style={styles.headerIconBtn}
            onPress={() => router.push('/notifications')}
          >
            <Ionicons name="notifications-outline" size={24} color="#1A1A18" />
          </Pressable>
          <Pressable
            style={styles.headerIconBtn}
            onPress={() => router.push('/settings')}
          >
            <Ionicons name="settings-outline" size={24} color="#1A1A18" />
          </Pressable>
        </View>
      </View>

      {loading ? (
        <ActivityIndicator size="large" color="#D97706" style={{ marginTop: 60 }} />
      ) : (
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
            {profile?.avatar_url ? (
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
            {profile?.username ? (
              <Text style={styles.username}>@{profile.username}</Text>
            ) : null}
            {profile?.bio ? (
              <Text style={styles.bio}>{profile.bio}</Text>
            ) : null}
            <View style={styles.statsRow}>
              <Text style={styles.statsText}>
                {totalCount} {totalCount === 1 ? 'rating' : 'ratings'}
                {avgScore !== null ? `  ·  ${avgScore.toFixed(1)} avg` : ''}
              </Text>
            </View>
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
      )}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#F8F8F6',
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 20,
    paddingVertical: 14,
    borderBottomWidth: 1,
    borderBottomColor: '#E8E8E6',
    backgroundColor: '#F8F8F6',
  },
  headerTitle: {
    fontSize: 20,
    fontWeight: '700',
    color: '#1A1A18',
    letterSpacing: -0.5,
  },
  headerIcons: {
    flexDirection: 'row',
    gap: 4,
  },
  headerIconBtn: {
    padding: 6,
  },
  signInPrompt: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 40,
    gap: 12,
  },
  signInTitle: {
    fontSize: 20,
    fontWeight: '700',
    color: '#1A1A18',
    textAlign: 'center',
    letterSpacing: -0.4,
  },
  signInSub: {
    fontSize: 14,
    color: '#8C8C8A',
    textAlign: 'center',
  },
  signInBtn: {
    marginTop: 8,
    backgroundColor: '#D97706',
    borderRadius: 12,
    paddingVertical: 14,
    paddingHorizontal: 40,
  },
  signInBtnText: {
    fontSize: 15,
    fontWeight: '700',
    color: '#FFFFFF',
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
  },
  statsText: {
    fontSize: 14,
    color: '#1A1A18',
    fontWeight: '500',
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
