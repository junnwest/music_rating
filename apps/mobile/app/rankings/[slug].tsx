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
import { Ionicons } from '@expo/vector-icons';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { supabase } from '@/lib/supabase';
import { useAuth } from '@/context/AuthContext';

type Category = {
  id: string;
  slug: string;
  title: string;
  description: string | null;
  genre: string | null;
  year: number | null;
};

type LeaderboardEntry = {
  release_id: string;
  title: string;
  artist: string;
  cover_url: string | null;
  sillaScore: number;
};

function computeSillaScores(
  seedEntries: { release_id: string; seed_votes: number }[],
  rankingEntries: { ranking_id: string; release_id: string; rank: number }[],
): Map<string, number> {
  const scores = new Map<string, number>();

  for (const se of seedEntries) {
    scores.set(se.release_id, (scores.get(se.release_id) ?? 0) + se.seed_votes);
  }

  const byRanking = new Map<string, { release_id: string; rank: number }[]>();
  for (const entry of rankingEntries) {
    const arr = byRanking.get(entry.ranking_id) ?? [];
    arr.push({ release_id: entry.release_id, rank: entry.rank });
    byRanking.set(entry.ranking_id, arr);
  }

  for (const [, entries] of byRanking) {
    const sorted = [...entries].sort((a, b) => a.rank - b.rank);

    const rankGroups = new Map<number, string[]>();
    for (const e of sorted) {
      const arr = rankGroups.get(e.rank) ?? [];
      arr.push(e.release_id);
      rankGroups.set(e.rank, arr);
    }

    let position = 1;
    for (const [, group] of [...rankGroups.entries()].sort((a, b) => a[0] - b[0])) {
      const positions = Array.from({ length: group.length }, (_, i) => position + i);
      const avgPosition = positions.reduce((s, p) => s + p, 0) / positions.length;
      const pointValue = 1 / avgPosition;
      for (const releaseId of group) {
        scores.set(releaseId, (scores.get(releaseId) ?? 0) + pointValue);
      }
      position += group.length;
    }
  }

  return scores;
}

async function fetchLeaderboard(category: Category): Promise<LeaderboardEntry[]> {
  const [seedResult, rankingsResult] = await Promise.all([
    supabase
      .from('ranking_seed_entries')
      .select('release_id, seed_votes')
      .eq('category_id', category.id),
    supabase
      .from('user_rankings')
      .select('id')
      .eq('category_id', category.id),
  ]);

  const seedEntries: { release_id: string; seed_votes: number }[] = seedResult.data ?? [];
  const rankingIds: string[] = (rankingsResult.data ?? []).map((r: { id: string }) => r.id);

  let rankingEntries: { ranking_id: string; release_id: string; rank: number }[] = [];
  if (rankingIds.length > 0) {
    const { data } = await supabase
      .from('user_ranking_entries')
      .select('ranking_id, release_id, rank')
      .in('ranking_id', rankingIds);
    rankingEntries = data ?? [];
  }

  const scoreMap = computeSillaScores(seedEntries, rankingEntries);

  const top30 = [...scoreMap.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 30);

  if (top30.length === 0) return [];

  const { data: releases } = await supabase
    .from('releases')
    .select('id, title, artist, cover_url')
    .in('id', top30.map(([id]) => id));

  const releaseMap = new Map<string, { title: string; artist: string; cover_url: string | null }>();
  for (const r of releases ?? []) {
    releaseMap.set(r.id, { title: r.title, artist: r.artist, cover_url: r.cover_url });
  }

  return top30
    .map(([release_id, sillaScore]) => {
      const rel = releaseMap.get(release_id);
      if (!rel) return null;
      return { release_id, sillaScore, ...rel };
    })
    .filter(Boolean) as LeaderboardEntry[];
}

function ScoreBadge({ score }: { score: number }) {
  return (
    <View style={styles.scoreBadge}>
      <Text style={styles.scoreBadgeText}>{score.toFixed(2)}</Text>
    </View>
  );
}

function LeaderboardRow({ entry, rank }: { entry: LeaderboardEntry; rank: number }) {
  return (
    <View style={styles.row}>
      <Text style={[styles.rankNum, rank <= 3 && styles.rankNumTop]}>{rank}</Text>
      <Image
        source={entry.cover_url ? { uri: entry.cover_url } : undefined}
        style={styles.rowCover}
        contentFit="cover"
        transition={150}
      />
      <View style={styles.rowInfo}>
        <Text style={styles.rowTitle} numberOfLines={1}>{entry.title}</Text>
        <Text style={styles.rowArtist} numberOfLines={1}>{entry.artist}</Text>
      </View>
      <ScoreBadge score={entry.sillaScore} />
    </View>
  );
}

export default function RankingDetailScreen() {
  const { slug } = useLocalSearchParams<{ slug: string }>();
  const router = useRouter();
  const { user } = useAuth();

  const [category, setCategory] = useState<Category | null>(null);
  const [leaderboard, setLeaderboard] = useState<LeaderboardEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    async function load() {
      setLoading(true);
      setError(null);
      try {
        const { data: cat, error: catErr } = await supabase
          .from('ranking_categories')
          .select('id, slug, title, description, genre, year')
          .eq('slug', slug)
          .single();

        if (catErr || !cat) {
          setError('Category not found.');
          return;
        }
        setCategory(cat);
        const board = await fetchLeaderboard(cat);
        setLeaderboard(board);
      } catch {
        setError('Failed to load ranking.');
      } finally {
        setLoading(false);
      }
    }
    if (slug) load();
  }, [slug]);

  return (
    <SafeAreaView style={styles.safeArea} edges={['top']}>
      <View style={styles.header}>
        <Pressable style={styles.backBtn} onPress={() => router.back()}>
          <Ionicons name="arrow-back" size={22} color="#1A1A18" />
        </Pressable>
        <Text style={styles.headerTitle} numberOfLines={1}>
          {category?.title ?? ''}
        </Text>
        <View style={{ width: 36 }} />
      </View>

      {loading ? (
        <View style={styles.centered}>
          <ActivityIndicator size="large" color="#D97706" />
        </View>
      ) : error ? (
        <View style={styles.centered}>
          <Text style={styles.errorText}>{error}</Text>
        </View>
      ) : (
        <>
          <FlatList
            data={leaderboard}
            keyExtractor={(item) => item.release_id}
            renderItem={({ item, index }) => (
              <LeaderboardRow entry={item} rank={index + 1} />
            )}
            ListHeaderComponent={
              category?.description ? (
                <View style={styles.descriptionContainer}>
                  <Text style={styles.descriptionText}>{category.description}</Text>
                </View>
              ) : null
            }
            ListEmptyComponent={
              <View style={styles.emptyContainer}>
                <Ionicons name="trophy-outline" size={40} color="#8C8C8A" />
                <Text style={styles.emptyText}>No entries yet</Text>
              </View>
            }
            contentContainerStyle={styles.listContent}
            showsVerticalScrollIndicator={false}
            ItemSeparatorComponent={() => <View style={styles.separator} />}
          />

          {user && (
            <View style={styles.bottomBar}>
              <Pressable
                style={({ pressed }) => [styles.addBtn, pressed && styles.addBtnPressed]}
                onPress={() =>
                  router.push(
                    '/rankings-vote?slug=' + slug + '&categoryId=' + (category?.id ?? ''),
                  )
                }
              >
                <Ionicons name="list-outline" size={18} color="#FFFFFF" style={{ marginRight: 6 }} />
                <Text style={styles.addBtnText}>Add Your Ranking</Text>
              </Pressable>
            </View>
          )}
        </>
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
    paddingHorizontal: 12,
    paddingVertical: 12,
    borderBottomWidth: 1,
    borderBottomColor: '#E8E8E6',
    backgroundColor: '#F8F8F6',
  },
  backBtn: {
    width: 36,
    height: 36,
    alignItems: 'center',
    justifyContent: 'center',
  },
  headerTitle: {
    flex: 1,
    textAlign: 'center',
    fontSize: 17,
    fontWeight: '700',
    color: '#1A1A18',
    letterSpacing: -0.3,
  },
  centered: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  errorText: {
    fontSize: 15,
    color: '#8C8C8A',
  },
  descriptionContainer: {
    paddingHorizontal: 20,
    paddingVertical: 14,
    borderBottomWidth: 1,
    borderBottomColor: '#E8E8E6',
    backgroundColor: '#FFFFFF',
  },
  descriptionText: {
    fontSize: 14,
    color: '#8C8C8A',
    lineHeight: 20,
  },
  listContent: {
    paddingBottom: 100,
  },
  separator: {
    height: 1,
    backgroundColor: '#E8E8E6',
    marginLeft: 20,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 20,
    paddingVertical: 12,
    backgroundColor: '#FFFFFF',
  },
  rankNum: {
    width: 28,
    fontSize: 15,
    fontWeight: '700',
    color: '#8C8C8A',
    textAlign: 'center',
  },
  rankNumTop: {
    color: '#D97706',
  },
  rowCover: {
    width: 52,
    height: 52,
    borderRadius: 5,
    backgroundColor: '#E8E8E6',
    marginLeft: 8,
    marginRight: 12,
  },
  rowInfo: {
    flex: 1,
    marginRight: 10,
  },
  rowTitle: {
    fontSize: 14,
    fontWeight: '600',
    color: '#1A1A18',
    letterSpacing: -0.2,
  },
  rowArtist: {
    fontSize: 12,
    color: '#8C8C8A',
    marginTop: 2,
  },
  scoreBadge: {
    backgroundColor: '#FEF3DC',
    borderRadius: 6,
    paddingHorizontal: 8,
    paddingVertical: 4,
  },
  scoreBadgeText: {
    fontSize: 12,
    fontWeight: '700',
    color: '#D97706',
  },
  emptyContainer: {
    alignItems: 'center',
    justifyContent: 'center',
    paddingTop: 80,
  },
  emptyText: {
    fontSize: 15,
    color: '#8C8C8A',
    marginTop: 10,
  },
  bottomBar: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
    paddingHorizontal: 20,
    paddingVertical: 16,
    paddingBottom: 32,
    backgroundColor: '#FFFFFF',
    borderTopWidth: 1,
    borderTopColor: '#E8E8E6',
  },
  addBtn: {
    backgroundColor: '#D97706',
    borderRadius: 10,
    paddingVertical: 14,
    alignItems: 'center',
    justifyContent: 'center',
    flexDirection: 'row',
  },
  addBtnPressed: {
    backgroundColor: '#B45309',
  },
  addBtnText: {
    fontSize: 15,
    fontWeight: '700',
    color: '#FFFFFF',
    letterSpacing: -0.2,
  },
});
