import { useEffect, useState } from 'react';
import {
  ActivityIndicator,
  FlatList,
  Pressable,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { Image } from 'expo-image';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { supabase } from '@/lib/supabase';
import { useAuth } from '@/context/AuthContext';

type Profile = {
  username: string;
  display_name: string | null;
};

type RatingItem = {
  kind: 'rating';
  id: string;
  user_id: string;
  release_id: string;
  score: number;
  created_at: string;
  release: { id: string; title: string; artist: string; cover_url: string | null } | null;
  profile: Profile | null;
};

type ReviewItem = {
  kind: 'review';
  id: string;
  user_id: string;
  release_id: string;
  body: string;
  created_at: string;
  release: { id: string; title: string; artist: string; cover_url: string | null } | null;
  profile: Profile | null;
};

type FeedItem = RatingItem | ReviewItem;

function timeAgo(dateString: string): string {
  const now = Date.now();
  const then = new Date(dateString).getTime();
  const diff = now - then;
  const seconds = Math.floor(diff / 1000);
  const minutes = Math.floor(seconds / 60);
  const hours = Math.floor(minutes / 60);
  const days = Math.floor(hours / 24);

  if (seconds < 60) return 'just now';
  if (minutes < 60) return `${minutes}m ago`;
  if (hours < 24) return `${hours}h ago`;
  if (days < 30) return `${days}d ago`;
  return new Date(dateString).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

function AvatarCircle({ username }: { username: string }) {
  return (
    <View style={styles.avatarCircle}>
      <Text style={styles.avatarLetter}>{username.charAt(0).toUpperCase()}</Text>
    </View>
  );
}

function FeedCard({ item }: { item: FeedItem }) {
  const router = useRouter();
  const username = item.profile?.username ?? 'unknown';
  const displayName = item.profile?.display_name ?? username;
  const releaseTitle = item.release?.title ?? 'Unknown Album';
  const releaseId = item.release_id;
  const coverUrl = item.release?.cover_url ?? null;

  return (
    <View style={styles.card}>
      <View style={styles.cardLeft}>
        <Pressable onPress={() => router.push('/profile/' + username)}>
          <AvatarCircle username={username} />
        </Pressable>
      </View>
      <View style={styles.cardMiddle}>
        <View style={styles.cardTopRow}>
          <Pressable onPress={() => router.push('/profile/' + username)}>
            <Text style={styles.cardUsername}>{displayName}</Text>
          </Pressable>
          <Text style={styles.cardAction}>
            {' '}{item.kind === 'rating' ? 'rated' : 'reviewed'}
          </Text>
        </View>
        <Pressable onPress={() => router.push('/album/' + releaseId)}>
          <Text style={styles.cardRelease} numberOfLines={1}>{releaseTitle}</Text>
        </Pressable>
        {item.kind === 'review' && (
          <Text style={styles.cardReviewBody} numberOfLines={2}>{item.body}</Text>
        )}
        <Text style={styles.cardTime}>{timeAgo(item.created_at)}</Text>
      </View>
      <View style={styles.cardRight}>
        <Pressable onPress={() => router.push('/album/' + releaseId)}>
          <Image
            source={coverUrl ? { uri: coverUrl } : undefined}
            style={styles.cardCover}
            contentFit="cover"
            transition={150}
          />
        </Pressable>
        {item.kind === 'rating' && (
          <View style={styles.scoreBadge}>
            <Text style={styles.scoreBadgeText}>{item.score}</Text>
          </View>
        )}
      </View>
    </View>
  );
}

type FilterMode = 'following' | 'everyone';

export default function ActivityScreen() {
  const { user } = useAuth();
  const [feed, setFeed] = useState<FeedItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState<FilterMode>('following');

  useEffect(() => {
    async function loadFeed() {
      setLoading(true);

      let followingIds: string[] = [];
      if (user && filter === 'following') {
        const { data: follows } = await supabase
          .from('follows')
          .select('following_id')
          .eq('follower_id', user.id);
        followingIds = (follows ?? []).map((f: { following_id: string }) => f.following_id);
      }

      const useFilter = user && filter === 'following' && followingIds.length > 0;

      const [ratingsResult, reviewsResult] = await Promise.all([
        useFilter
          ? supabase
              .from('ratings')
              .select(
                'id, user_id, release_id, score, created_at, releases(id, title, artist, cover_url), profiles!ratings_user_id_fkey(username, display_name)',
              )
              .in('user_id', followingIds)
              .order('created_at', { ascending: false })
              .limit(30)
          : supabase
              .from('ratings')
              .select(
                'id, user_id, release_id, score, created_at, releases(id, title, artist, cover_url), profiles!ratings_user_id_fkey(username, display_name)',
              )
              .order('created_at', { ascending: false })
              .limit(30),
        useFilter
          ? supabase
              .from('reviews')
              .select(
                'id, user_id, release_id, body, created_at, releases(id, title, artist, cover_url), profiles!reviews_user_id_fkey(username, display_name)',
              )
              .in('user_id', followingIds)
              .order('created_at', { ascending: false })
              .limit(20)
          : supabase
              .from('reviews')
              .select(
                'id, user_id, release_id, body, created_at, releases(id, title, artist, cover_url), profiles!reviews_user_id_fkey(username, display_name)',
              )
              .order('created_at', { ascending: false })
              .limit(20),
      ]);

      const ratings: FeedItem[] = (ratingsResult.data ?? []).map((r: any) => ({
        kind: 'rating' as const,
        id: r.id,
        user_id: r.user_id,
        release_id: r.release_id,
        score: r.score,
        created_at: r.created_at,
        release: r.releases ?? null,
        profile: r.profiles ?? null,
      }));

      const reviews: FeedItem[] = (reviewsResult.data ?? []).map((r: any) => ({
        kind: 'review' as const,
        id: r.id,
        user_id: r.user_id,
        release_id: r.release_id,
        body: r.body,
        created_at: r.created_at,
        release: r.releases ?? null,
        profile: r.profiles ?? null,
      }));

      const merged = [...ratings, ...reviews].sort(
        (a, b) =>
          new Date(b.created_at).getTime() - new Date(a.created_at).getTime(),
      );

      setFeed(merged);
      setLoading(false);
    }

    loadFeed();
  }, [user, filter]);

  return (
    <SafeAreaView style={styles.safeArea} edges={['top']}>
      <View style={styles.header}>
        <Text style={styles.headerTitle}>Activity</Text>
        {user && (
          <View style={styles.filterPill}>
            <Pressable
              style={[styles.filterOption, filter === 'following' && styles.filterOptionActive]}
              onPress={() => setFilter('following')}
            >
              <Text
                style={[styles.filterOptionText, filter === 'following' && styles.filterOptionTextActive]}
              >
                Following
              </Text>
            </Pressable>
            <Pressable
              style={[styles.filterOption, filter === 'everyone' && styles.filterOptionActive]}
              onPress={() => setFilter('everyone')}
            >
              <Text
                style={[styles.filterOptionText, filter === 'everyone' && styles.filterOptionTextActive]}
              >
                Everyone
              </Text>
            </Pressable>
          </View>
        )}
      </View>

      {loading ? (
        <View style={styles.centered}>
          <ActivityIndicator size="large" color="#D97706" />
        </View>
      ) : feed.length === 0 ? (
        <View style={styles.centered}>
          <Text style={styles.emptyText}>
            {user && filter === 'following'
              ? 'Follow people to see their activity here'
              : 'No activity yet'}
          </Text>
        </View>
      ) : (
        <FlatList
          data={feed}
          keyExtractor={(item) => item.kind + '_' + item.id}
          renderItem={({ item }) => <FeedCard item={item} />}
          contentContainerStyle={styles.listContent}
          showsVerticalScrollIndicator={false}
          ItemSeparatorComponent={() => <View style={styles.separator} />}
        />
      )}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: {
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
    fontSize: 24,
    fontWeight: '800',
    color: '#1A1A18',
    letterSpacing: -1,
  },
  filterPill: {
    flexDirection: 'row',
    backgroundColor: '#E8E8E6',
    borderRadius: 20,
    padding: 2,
  },
  filterOption: {
    paddingHorizontal: 12,
    paddingVertical: 5,
    borderRadius: 18,
  },
  filterOptionActive: {
    backgroundColor: '#FFFFFF',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.06,
    shadowRadius: 2,
    elevation: 1,
  },
  filterOptionText: {
    fontSize: 12,
    fontWeight: '500',
    color: '#8C8C8A',
  },
  filterOptionTextActive: {
    color: '#1A1A18',
    fontWeight: '600',
  },
  centered: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  emptyText: {
    fontSize: 15,
    color: '#8C8C8A',
    textAlign: 'center',
    paddingHorizontal: 40,
  },
  listContent: {
    paddingBottom: 32,
  },
  separator: {
    height: 1,
    backgroundColor: '#E8E8E6',
    marginLeft: 72,
  },
  card: {
    flexDirection: 'row',
    paddingHorizontal: 16,
    paddingVertical: 14,
    backgroundColor: '#FFFFFF',
  },
  cardLeft: {
    width: 42,
    marginRight: 10,
    alignItems: 'center',
    paddingTop: 2,
  },
  avatarCircle: {
    width: 38,
    height: 38,
    borderRadius: 19,
    backgroundColor: '#D97706',
    alignItems: 'center',
    justifyContent: 'center',
  },
  avatarLetter: {
    fontSize: 16,
    fontWeight: '700',
    color: '#FFFFFF',
  },
  cardMiddle: {
    flex: 1,
    marginRight: 10,
  },
  cardTopRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    alignItems: 'center',
    marginBottom: 2,
  },
  cardUsername: {
    fontSize: 14,
    fontWeight: '700',
    color: '#1A1A18',
    letterSpacing: -0.2,
  },
  cardAction: {
    fontSize: 14,
    color: '#8C8C8A',
  },
  cardRelease: {
    fontSize: 14,
    fontWeight: '600',
    color: '#D97706',
    marginBottom: 4,
    letterSpacing: -0.2,
  },
  cardReviewBody: {
    fontSize: 13,
    color: '#8C8C8A',
    fontStyle: 'italic',
    lineHeight: 18,
    marginBottom: 4,
  },
  cardTime: {
    fontSize: 11,
    color: '#8C8C8A',
    marginTop: 2,
  },
  cardRight: {
    alignItems: 'center',
  },
  cardCover: {
    width: 52,
    height: 52,
    borderRadius: 6,
    backgroundColor: '#E8E8E6',
  },
  scoreBadge: {
    marginTop: 5,
    backgroundColor: '#FEF3DC',
    borderRadius: 5,
    paddingHorizontal: 7,
    paddingVertical: 3,
  },
  scoreBadgeText: {
    fontSize: 12,
    fontWeight: '700',
    color: '#D97706',
  },
});
