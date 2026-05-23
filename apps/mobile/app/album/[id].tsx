import React, { useEffect, useState, useCallback } from 'react';
import {
  View,
  Text,
  ScrollView,
  Pressable,
  StyleSheet,
  Dimensions,
  ActivityIndicator,
  Alert,
  Modal,
  TextInput,
  KeyboardAvoidingView,
  Platform,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Image } from 'expo-image';
import { Ionicons } from '@expo/vector-icons';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { supabase } from '@/lib/supabase';
import { useAuth } from '@/context/AuthContext';
import StarRating from '@/components/StarRating';

const { width: SCREEN_WIDTH } = Dimensions.get('window');

interface Release {
  id: string;
  title: string;
  artist: string;
  cover_url: string | null;
  release_date: string | null;
  release_type: string | null;
  genres: string[] | null;
  tracks: Array<{ name: string; duration_ms?: number }> | null;
  prestige: number | null;
}

type RankingMembership = { slug: string; title: string; rank: number };

function computeSillaScores(
  entries: { ranking_id: string; release_id: string; rank: number }[]
): Map<string, number> {
  const byRanking = new Map<string, { release_id: string; rank: number }[]>();
  for (const e of entries) {
    if (!byRanking.has(e.ranking_id)) byRanking.set(e.ranking_id, []);
    byRanking.get(e.ranking_id)!.push(e);
  }
  const scores = new Map<string, number>();
  for (const userEntries of byRanking.values()) {
    const byRank = new Map<number, string[]>();
    for (const e of userEntries) {
      if (!byRank.has(e.rank)) byRank.set(e.rank, []);
      byRank.get(e.rank)!.push(e.release_id);
    }
    let pos = 1;
    for (const [, albums] of [...byRank.entries()].sort(([a], [b]) => a - b)) {
      const t = albums.length;
      const effectivePos = pos + (t - 1) / 2;
      const score = 1 / effectivePos;
      for (const releaseId of albums) {
        scores.set(releaseId, (scores.get(releaseId) ?? 0) + score);
      }
      pos += t;
    }
  }
  return scores;
}

interface ReviewWithProfile {
  id: string;
  user_id: string;
  release_id: string;
  body: string;
  visibility: string;
  created_at: string;
  profiles: {
    username: string;
    display_name: string | null;
    avatar_url: string | null;
  } | null;
  score: number | null;
}

function formatDuration(ms: number): string {
  const totalSeconds = Math.floor(ms / 1000);
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${minutes}:${seconds.toString().padStart(2, '0')}`;
}

function timeAgo(dateStr: string): string {
  const diff = Date.now() - new Date(dateStr).getTime();
  const days = Math.floor(diff / 86400000);
  if (days === 0) return 'Today';
  if (days === 1) return '1 day ago';
  if (days < 30) return `${days} days ago`;
  const months = Math.floor(days / 30);
  if (months === 1) return '1 month ago';
  if (months < 12) return `${months} months ago`;
  const years = Math.floor(months / 12);
  return years === 1 ? '1 year ago' : `${years} years ago`;
}

function releaseTypeLabel(type: string | null): string | null {
  if (!type) return null;
  switch (type.toLowerCase()) {
    case 'album': return 'Album';
    case 'ep': return 'EP';
    case 'single': return 'Single';
    default: return type;
  }
}

export default function AlbumScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const { user } = useAuth();

  const [release, setRelease] = useState<Release | null>(null);
  const [avgScore, setAvgScore] = useState<number | null>(null);
  const [ratingCount, setRatingCount] = useState(0);
  const [reviews, setReviews] = useState<ReviewWithProfile[]>([]);
  const [myRating, setMyRating] = useState<number | null>(null);
  const [rankingMemberships, setRankingMemberships] = useState<RankingMembership[]>([]);
  const [loading, setLoading] = useState(true);
  const [ratingLoading, setRatingLoading] = useState(false);
  const [reviewModalVisible, setReviewModalVisible] = useState(false);
  const [reviewBody, setReviewBody] = useState('');
  const [reviewLoading, setReviewLoading] = useState(false);

  const fetchData = useCallback(async () => {
    if (!id) return;
    setLoading(true);

    const [releaseRes, ratingsRes, reviewsRes, myRatingRes] = await Promise.all([
      supabase.from('releases').select('*').eq('id', id).single(),
      supabase.from('ratings').select('score').eq('release_id', id),
      supabase
        .from('reviews')
        .select('id, user_id, release_id, body, visibility, created_at')
        .eq('release_id', id)
        .in('visibility', ['public'])
        .order('created_at', { ascending: false })
        .limit(20),
      user
        ? supabase.from('ratings').select('score').eq('release_id', id).eq('user_id', user.id).maybeSingle()
        : Promise.resolve({ data: null, error: null }),
    ]);

    if (releaseRes.data) setRelease(releaseRes.data as Release);

    if (ratingsRes.data && ratingsRes.data.length > 0) {
      const scores = ratingsRes.data.map((r: { score: number }) => r.score);
      const avg = scores.reduce((a: number, b: number) => a + b, 0) / scores.length;
      setAvgScore(Math.round(avg * 10) / 10);
      setRatingCount(scores.length);
    }

    if (reviewsRes.data) {
      const rawReviews = reviewsRes.data as any[];
      const reviewUserIds = [...new Set(rawReviews.map((r) => r.user_id as string))];

      let reviewProfileMap = new Map<string, { username: string; display_name: string | null; avatar_url: string | null }>();
      const ratingMap = new Map<string, number>();

      await Promise.all([
        reviewUserIds.length > 0
          ? supabase.from('profiles').select('id, username, display_name, avatar_url').in('id', reviewUserIds).then(({ data }) => {
              reviewProfileMap = new Map((data ?? []).map((p: any) => [p.id, { username: p.username, display_name: p.display_name, avatar_url: p.avatar_url ?? null }]));
            })
          : Promise.resolve(),
        reviewUserIds.length > 0
          ? supabase.from('ratings').select('user_id, score').eq('release_id', id).in('user_id', reviewUserIds).then(({ data }) => {
              (data ?? []).forEach((r: { user_id: string; score: number }) => ratingMap.set(r.user_id, r.score));
            })
          : Promise.resolve(),
      ]);

      const reviewData: ReviewWithProfile[] = rawReviews.map((r) => ({
        id: r.id,
        user_id: r.user_id,
        release_id: r.release_id,
        body: r.body,
        visibility: r.visibility,
        created_at: r.created_at,
        profiles: reviewProfileMap.get(r.user_id) ?? null,
        score: ratingMap.get(r.user_id) ?? null,
      }));

      setReviews(reviewData);
    }

    if (myRatingRes.data) setMyRating(myRatingRes.data.score);

    // Fetch ranking memberships
    const [{ data: seedEntries }, { data: userEntries }] = await Promise.all([
      supabase.from('ranking_seed_entries').select('category_id').eq('release_id', id),
      supabase.from('user_ranking_entries').select('ranking_id').eq('release_id', id),
    ]);

    const seedCatIds = (seedEntries ?? []).map((r: { category_id: string }) => r.category_id);
    let userCatIds: string[] = [];
    const userRankingIds = (userEntries ?? []).map((r: { ranking_id: string }) => r.ranking_id);
    if (userRankingIds.length > 0) {
      const { data: userRankings } = await supabase
        .from('user_rankings')
        .select('category_id')
        .in('id', userRankingIds);
      userCatIds = (userRankings ?? []).map((r: { category_id: string }) => r.category_id);
    }
    const allCatIds = [...new Set([...seedCatIds, ...userCatIds])];

    if (allCatIds.length > 0) {
      const { data: cats } = await supabase
        .from('ranking_categories')
        .select('id, slug, title')
        .in('id', allCatIds)
        .order('sort_order');

      if (cats && cats.length > 0) {
        const memberships = await Promise.all(
          cats.map(async (cat: { id: string; slug: string; title: string }) => {
            const [{ data: allSeeds }, { data: catRankings }] = await Promise.all([
              supabase.from('ranking_seed_entries').select('release_id, seed_votes').eq('category_id', cat.id),
              supabase.from('user_rankings').select('id').eq('category_id', cat.id),
            ]);

            const scoreMap = new Map<string, number>();
            for (const s of allSeeds ?? []) {
              scoreMap.set(s.release_id, (scoreMap.get(s.release_id) ?? 0) + s.seed_votes);
            }

            const catRankingIds = (catRankings ?? []).map((r: { id: string }) => r.id);
            if (catRankingIds.length > 0) {
              const { data: entries } = await supabase
                .from('user_ranking_entries')
                .select('ranking_id, release_id, rank')
                .in('ranking_id', catRankingIds);
              const sillaScores = computeSillaScores(entries ?? []);
              for (const [releaseId, score] of sillaScores) {
                scoreMap.set(releaseId, (scoreMap.get(releaseId) ?? 0) + score);
              }
            }

            const sorted = [...scoreMap.entries()].sort((a, b) => b[1] - a[1]);
            const rank = sorted.findIndex(([rid]) => rid === id) + 1;
            return { slug: cat.slug, title: cat.title, rank };
          })
        );
        setRankingMemberships(memberships.filter((m) => m.rank > 0));
      }
    }

    setLoading(false);
  }, [id, user]);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  async function navigateToArtist() {
    if (!release) return;
    const { data } = await supabase
      .from('artists')
      .select('id')
      .ilike('name', release.artist.split(',')[0].trim())
      .maybeSingle();
    if (data?.id) {
      router.push(`/artist/${data.id}`);
    }
  }

  async function handleSubmitReview() {
    if (!user || !reviewBody.trim()) return;
    setReviewLoading(true);
    const { error } = await supabase.from('reviews').upsert(
      { user_id: user.id, release_id: id, body: reviewBody.trim(), visibility: 'public' },
      { onConflict: 'user_id,release_id' }
    );
    setReviewLoading(false);
    if (error) {
      Alert.alert('Error', 'Could not save review. Please try again.');
    } else {
      setReviewModalVisible(false);
      setReviewBody('');
      fetchData();
    }
  }

  async function handleRate(score: number) {
    if (!user) {
      Alert.alert('Sign in required', 'Please sign in to rate albums.');
      return;
    }
    setRatingLoading(true);
    setMyRating(score);
    const { error } = await supabase.from('ratings').upsert(
      { user_id: user.id, release_id: id, score },
      { onConflict: 'user_id,release_id' }
    );
    setRatingLoading(false);
    if (error) {
      Alert.alert('Error', 'Could not save rating. Please try again.');
      setMyRating(null);
    } else {
      fetchData();
    }
  }

  if (loading) {
    return (
      <SafeAreaView style={styles.loadingContainer} edges={['top']}>
        <Pressable style={styles.backBtn} onPress={() => router.back()}>
          <Ionicons name="chevron-back-outline" size={22} color="#FFFFFF" />
        </Pressable>
        <ActivityIndicator size="large" color="#D97706" />
      </SafeAreaView>
    );
  }

  if (!release) {
    return (
      <SafeAreaView style={styles.loadingContainer} edges={['top']}>
        <Pressable style={styles.backBtn} onPress={() => router.back()}>
          <Ionicons name="chevron-back-outline" size={22} color="#1A1A18" />
        </Pressable>
        <Text style={styles.errorText}>Album not found.</Text>
      </SafeAreaView>
    );
  }

  const year = release.release_date ? release.release_date.slice(0, 4) : null;
  const typeLabel = releaseTypeLabel(release.release_type);

  return (
    <View style={styles.root}>
      <ScrollView
        style={styles.scrollView}
        showsVerticalScrollIndicator={false}
        contentContainerStyle={styles.scrollContent}
      >
        <View style={styles.coverContainer}>
          <Image
            source={release.cover_url ? { uri: release.cover_url } : undefined}
            style={styles.cover}
            contentFit="cover"
            transition={300}
          />
          <SafeAreaView style={styles.coverOverlay} edges={['top']}>
            <Pressable style={styles.backBtn} onPress={() => router.back()}>
              <Ionicons name="chevron-back-outline" size={22} color="#FFFFFF" />
            </Pressable>
          </SafeAreaView>
        </View>

        <View style={styles.body}>
          <View style={styles.titleRow}>
            <View style={styles.titleBlock}>
              <Text style={styles.title}>{release.title}</Text>
              <Pressable onPress={navigateToArtist} hitSlop={8}>
                <Text style={[styles.artist, styles.artistLink]}>{release.artist}</Text>
              </Pressable>
              <View style={styles.metaRow}>
                {year ? <Text style={styles.year}>{year}</Text> : null}
                {typeLabel ? (
                  <View style={styles.typePill}>
                    <Text style={styles.typePillText}>{typeLabel}</Text>
                  </View>
                ) : null}
              </View>
            </View>
          </View>

          {(ratingCount > 0 || avgScore !== null) && (
            <View style={styles.statsRow}>
              <Ionicons name="star" size={14} color="#D97706" />
              <Text style={styles.statsText}>
                {avgScore !== null ? `${avgScore.toFixed(1)} avg` : '—'}
                {ratingCount > 0 ? ` · ${ratingCount} rating${ratingCount !== 1 ? 's' : ''}` : ''}
              </Text>
            </View>
          )}

          <View style={styles.ratingSection}>
            <Text style={styles.ratingLabel}>
              {myRating !== null ? `Your rating: ${myRating}` : 'Rate this'}
            </Text>
            <View style={styles.ratingRow}>
              <StarRating
                value={myRating}
                onChange={handleRate}
                size={32}
                readonly={ratingLoading}
              />
              {myRating !== null && (
                <Text style={styles.ratingValue}>{myRating}</Text>
              )}
            </View>
          </View>

          <Pressable
            style={styles.reviewButton}
            onPress={() => {
              if (!user) {
                Alert.alert('Sign in required', 'Please sign in to write a review.');
                return;
              }
              setReviewModalVisible(true);
            }}
          >
            <Ionicons name="create-outline" size={16} color="#D97706" />
            <Text style={styles.reviewButtonText}>Write a review</Text>
          </Pressable>

          {release.tracks && release.tracks.length > 0 && (
            <View style={styles.section}>
              <Text style={styles.sectionTitle}>Tracks</Text>
              {release.tracks.map((track, idx) => (
                <View key={idx} style={styles.trackRow}>
                  <Text style={styles.trackNumber}>{idx + 1}</Text>
                  <Text style={styles.trackName} numberOfLines={1}>{track.name}</Text>
                  {track.duration_ms ? (
                    <Text style={styles.trackDuration}>{formatDuration(track.duration_ms)}</Text>
                  ) : null}
                </View>
              ))}
            </View>
          )}

          {rankingMemberships.length > 0 && (
            <View style={styles.section}>
              <Text style={styles.sectionLabel}>In Rankings</Text>
              <View style={styles.rankingChips}>
                {rankingMemberships.map((m) => (
                  <Pressable
                    key={m.slug}
                    style={({ pressed }) => [styles.rankingChip, pressed && { opacity: 0.7 }]}
                    onPress={() => router.push(`/rankings/${m.slug}` as any)}
                  >
                    <Text style={styles.rankingChipText}>{m.title}</Text>
                    <Text style={styles.rankingChipRank}>#{m.rank}</Text>
                  </Pressable>
                ))}
              </View>
            </View>
          )}

          {reviews.length > 0 && (
            <View style={styles.section}>
              <Text style={styles.sectionTitle}>Reviews</Text>
              {reviews.map((review) => (
                <View key={review.id} style={styles.reviewCard}>
                  <View style={styles.reviewHeader}>
                    <View style={styles.reviewAvatar}>
                      {review.profiles?.avatar_url ? (
                        <Image
                          source={{ uri: review.profiles.avatar_url }}
                          style={styles.avatarImage}
                          contentFit="cover"
                        />
                      ) : (
                        <Text style={styles.avatarInitial}>
                          {(review.profiles?.display_name || review.profiles?.username || '?')[0].toUpperCase()}
                        </Text>
                      )}
                    </View>
                    <View style={styles.reviewMeta}>
                      <Text style={styles.reviewUsername}>
                        {review.profiles?.display_name || review.profiles?.username || 'Unknown'}
                      </Text>
                      <Text style={styles.reviewTime}>{timeAgo(review.created_at)}</Text>
                    </View>
                    {review.score !== null && (
                      <View style={styles.scoreBadge}>
                        <Ionicons name="star" size={10} color="#D97706" />
                        <Text style={styles.scoreBadgeText}>{review.score}</Text>
                      </View>
                    )}
                  </View>
                  <Text style={styles.reviewBody}>{review.body}</Text>
                </View>
              ))}
            </View>
          )}
        </View>
      </ScrollView>

      <Modal visible={reviewModalVisible} animationType="slide" presentationStyle="pageSheet">
        <SafeAreaView style={styles.modalContainer} edges={['top']}>
          <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
            <View style={styles.modalHeader}>
              <Pressable onPress={() => { setReviewModalVisible(false); setReviewBody(''); }}>
                <Text style={styles.modalCancel}>Cancel</Text>
              </Pressable>
              <Text style={styles.modalTitle}>Write a Review</Text>
              <Pressable onPress={handleSubmitReview} disabled={reviewLoading || !reviewBody.trim()}>
                {reviewLoading ? (
                  <ActivityIndicator size="small" color="#D97706" />
                ) : (
                  <Text style={[styles.modalSave, !reviewBody.trim() && { opacity: 0.4 }]}>Post</Text>
                )}
              </Pressable>
            </View>
            <View style={styles.modalBody}>
              <Text style={styles.modalAlbumName} numberOfLines={1}>{release?.title}</Text>
              <TextInput
                style={styles.reviewInput}
                value={reviewBody}
                onChangeText={setReviewBody}
                placeholder="Share your thoughts..."
                placeholderTextColor="#8C8C8A"
                multiline
                autoFocus
                autoCorrect
                textAlignVertical="top"
              />
            </View>
          </KeyboardAvoidingView>
        </SafeAreaView>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: '#F8F8F6',
  },
  loadingContainer: {
    flex: 1,
    backgroundColor: '#F8F8F6',
    alignItems: 'center',
    justifyContent: 'center',
  },
  errorText: {
    fontSize: 15,
    color: '#8C8C8A',
    marginTop: 16,
  },
  scrollView: {
    flex: 1,
  },
  scrollContent: {
    paddingBottom: 48,
  },
  coverContainer: {
    width: SCREEN_WIDTH,
    aspectRatio: 1,
    backgroundColor: '#E8E8E6',
  },
  cover: {
    width: '100%',
    height: '100%',
  },
  coverOverlay: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
  },
  backBtn: {
    marginLeft: 16,
    marginTop: 8,
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: 'rgba(0,0,0,0.45)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  body: {
    paddingHorizontal: 20,
    paddingTop: 20,
  },
  titleRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    marginBottom: 12,
  },
  titleBlock: {
    flex: 1,
  },
  title: {
    fontSize: 24,
    fontWeight: '800',
    color: '#1A1A18',
    letterSpacing: -0.5,
    marginBottom: 4,
  },
  artist: {
    fontSize: 16,
    color: '#8C8C8A',
    fontWeight: '500',
    marginBottom: 8,
  },
  artistLink: {
    color: '#D97706',
  },
  metaRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  year: {
    fontSize: 13,
    color: '#8C8C8A',
  },
  typePill: {
    backgroundColor: '#FEF3DC',
    borderRadius: 100,
    paddingHorizontal: 10,
    paddingVertical: 3,
  },
  typePillText: {
    fontSize: 11,
    fontWeight: '600',
    color: '#D97706',
  },
  statsRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    marginBottom: 20,
  },
  statsText: {
    fontSize: 14,
    color: '#8C8C8A',
    fontWeight: '500',
  },
  ratingSection: {
    marginBottom: 16,
  },
  ratingLabel: {
    fontSize: 13,
    fontWeight: '600',
    color: '#8C8C8A',
    marginBottom: 8,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
  ratingRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  ratingValue: {
    fontSize: 22,
    fontWeight: '700',
    color: '#D97706',
  },
  reviewButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    borderWidth: 1.5,
    borderColor: '#D97706',
    borderRadius: 10,
    paddingVertical: 12,
    marginBottom: 28,
  },
  reviewButtonText: {
    fontSize: 15,
    fontWeight: '600',
    color: '#D97706',
  },
  section: {
    marginBottom: 28,
  },
  sectionTitle: {
    fontSize: 17,
    fontWeight: '700',
    color: '#1A1A18',
    marginBottom: 12,
  },
  trackRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 9,
    borderBottomWidth: 1,
    borderBottomColor: '#E8E8E6',
  },
  trackNumber: {
    fontSize: 13,
    color: '#8C8C8A',
    width: 24,
    textAlign: 'right',
    marginRight: 12,
  },
  trackName: {
    flex: 1,
    fontSize: 14,
    color: '#1A1A18',
    fontWeight: '500',
  },
  trackDuration: {
    fontSize: 13,
    color: '#8C8C8A',
    marginLeft: 8,
  },
  reviewCard: {
    backgroundColor: '#FFFFFF',
    borderRadius: 10,
    padding: 14,
    marginBottom: 10,
    borderWidth: 1,
    borderColor: '#E8E8E6',
  },
  reviewHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 10,
  },
  reviewAvatar: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: '#FEF3DC',
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: 10,
    overflow: 'hidden',
  },
  avatarImage: {
    width: 36,
    height: 36,
  },
  avatarInitial: {
    fontSize: 15,
    fontWeight: '700',
    color: '#D97706',
  },
  reviewMeta: {
    flex: 1,
  },
  reviewUsername: {
    fontSize: 14,
    fontWeight: '600',
    color: '#1A1A18',
  },
  reviewTime: {
    fontSize: 12,
    color: '#8C8C8A',
    marginTop: 1,
  },
  scoreBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 3,
    backgroundColor: '#FEF3DC',
    borderRadius: 100,
    paddingHorizontal: 8,
    paddingVertical: 4,
  },
  scoreBadgeText: {
    fontSize: 12,
    fontWeight: '700',
    color: '#D97706',
  },
  reviewBody: {
    fontSize: 14,
    color: '#1A1A18',
    lineHeight: 21,
  },
  modalContainer: { flex: 1, backgroundColor: '#F8F8F6' },
  modalHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 20,
    paddingVertical: 14,
    borderBottomWidth: 1,
    borderBottomColor: '#E8E8E6',
  },
  modalTitle: { fontSize: 16, fontWeight: '600', color: '#1A1A18' },
  modalCancel: { fontSize: 15, color: '#8C8C8A' },
  modalSave: { fontSize: 15, fontWeight: '600', color: '#D97706' },
  modalBody: { padding: 20, flex: 1 },
  modalAlbumName: { fontSize: 13, color: '#8C8C8A', marginBottom: 14, fontWeight: '500' },
  reviewInput: {
    flex: 1,
    fontSize: 15,
    color: '#1A1A18',
    lineHeight: 22,
    minHeight: 160,
    textAlignVertical: 'top',
  },
  sectionLabel: {
    fontSize: 11,
    fontWeight: '600',
    color: '#8C8C8A',
    textTransform: 'uppercase',
    letterSpacing: 0.6,
    marginBottom: 10,
  },
  rankingChips: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
  },
  rankingChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    borderWidth: 1,
    borderColor: '#E8E8E6',
    borderRadius: 100,
    paddingHorizontal: 12,
    paddingVertical: 6,
    backgroundColor: '#FFFFFF',
  },
  rankingChipText: {
    fontSize: 12,
    fontWeight: '500',
    color: '#1A1A18',
  },
  rankingChipRank: {
    fontSize: 12,
    fontWeight: '700',
    color: '#E8A020',
  },
});
