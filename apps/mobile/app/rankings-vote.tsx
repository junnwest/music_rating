import { useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  FlatList,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { Image } from 'expo-image';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { supabase } from '@/lib/supabase';
import { useAuth } from '@/context/AuthContext';

type Release = {
  id: string;
  title: string;
  artist: string;
  cover_url: string | null;
};

type RankingItem = Release & { listKey: string };

async function fetchPoolAlbums(categoryId: string): Promise<Release[]> {
  const { data } = await supabase
    .from('ranking_seed_entries')
    .select('release_id, seed_votes')
    .eq('category_id', categoryId)
    .order('seed_votes', { ascending: false })
    .limit(50);

  if (!data || data.length === 0) return [];

  const releaseIds = data.map((d: { release_id: string }) => d.release_id);
  const { data: releases } = await supabase
    .from('releases')
    .select('id, title, artist, cover_url')
    .in('id', releaseIds);

  const order = new Map(releaseIds.map((id: string, i: number) => [id, i]));
  return ((releases ?? []) as Release[]).sort(
    (a, b) => (order.get(a.id) ?? 99) - (order.get(b.id) ?? 99),
  );
}

async function loadExistingRanking(
  userId: string,
  categoryId: string,
): Promise<Release[]> {
  const { data: rankingRow } = await supabase
    .from('user_rankings')
    .select('id')
    .eq('user_id', userId)
    .eq('category_id', categoryId)
    .maybeSingle();

  if (!rankingRow) return [];

  const { data: entries } = await supabase
    .from('user_ranking_entries')
    .select('release_id, rank')
    .eq('ranking_id', rankingRow.id)
    .order('rank', { ascending: true });

  if (!entries || entries.length === 0) return [];

  const releaseIds = entries.map((e: { release_id: string }) => e.release_id);
  const { data: releases } = await supabase
    .from('releases')
    .select('id, title, artist, cover_url')
    .in('id', releaseIds);

  const releaseMap = new Map<string, Release>();
  for (const r of (releases ?? []) as Release[]) {
    releaseMap.set(r.id, r);
  }

  return entries
    .map((e: { release_id: string; rank: number }) => releaseMap.get(e.release_id))
    .filter(Boolean) as Release[];
}

export default function RankingsVoteScreen() {
  const { slug, categoryId } = useLocalSearchParams<{ slug: string; categoryId: string }>();
  const router = useRouter();
  const { user } = useAuth();

  const [pool, setPool] = useState<Release[]>([]);
  const [ranking, setRanking] = useState<RankingItem[]>([]);
  const [searchQuery, setSearchQuery] = useState('');
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [saveSuccess, setSaveSuccess] = useState(false);
  const counterRef = useRef(0);

  useEffect(() => {
    if (!user || !categoryId) {
      setLoading(false);
      return;
    }
    async function load() {
      setLoading(true);
      const [poolAlbums, existing] = await Promise.all([
        fetchPoolAlbums(categoryId),
        loadExistingRanking(user!.id, categoryId),
      ]);
      setPool(poolAlbums);
      setRanking(
        existing.map((r) => ({ ...r, listKey: r.id + '_' + (++counterRef.current) })),
      );
      setLoading(false);
    }
    load();
  }, [user, categoryId]);

  const filtered = searchQuery.trim()
    ? pool.filter((r) => {
        const q = searchQuery.toLowerCase();
        return (
          r.title.toLowerCase().includes(q) || r.artist.toLowerCase().includes(q)
        );
      })
    : pool;

  const addedIds = new Set(ranking.map((r) => r.id));

  function addAlbum(release: Release) {
    if (addedIds.has(release.id)) return;
    counterRef.current += 1;
    setRanking((prev) => [
      ...prev,
      { ...release, listKey: release.id + '_' + counterRef.current },
    ]);
    setSearchQuery('');
  }

  function removeAlbum(listKey: string) {
    setRanking((prev) => prev.filter((r) => r.listKey !== listKey));
  }

  function moveUp(index: number) {
    if (index === 0) return;
    setRanking((prev) => {
      const next = [...prev];
      [next[index - 1], next[index]] = [next[index], next[index - 1]];
      return next;
    });
  }

  function moveDown(index: number) {
    setRanking((prev) => {
      if (index >= prev.length - 1) return prev;
      const next = [...prev];
      [next[index], next[index + 1]] = [next[index + 1], next[index]];
      return next;
    });
  }

  async function saveRanking() {
    if (!user || !categoryId || ranking.length === 0) return;
    setSaving(true);
    setSaveError(null);
    setSaveSuccess(false);

    try {
      const { data: rankingRow, error: upsertErr } = await supabase
        .from('user_rankings')
        .upsert(
          { user_id: user.id, category_id: categoryId },
          { onConflict: 'user_id,category_id' },
        )
        .select('id')
        .single();

      if (upsertErr || !rankingRow) {
        setSaveError('Failed to save ranking. Please try again.');
        return;
      }

      const rankingId = rankingRow.id;

      await supabase.from('user_ranking_entries').delete().eq('ranking_id', rankingId);

      const entries = ranking.map((item, idx) => ({
        ranking_id: rankingId,
        release_id: item.id,
        rank: idx + 1,
      }));

      const { error: insertErr } = await supabase
        .from('user_ranking_entries')
        .insert(entries);

      if (insertErr) {
        setSaveError('Failed to save entries. Please try again.');
        return;
      }

      setSaveSuccess(true);
      setTimeout(() => router.back(), 800);
    } catch {
      setSaveError('An unexpected error occurred.');
    } finally {
      setSaving(false);
    }
  }

  if (!user) {
    return (
      <SafeAreaView style={styles.safeArea} edges={['top']}>
        <View style={styles.header}>
          <Pressable style={styles.backBtn} onPress={() => router.back()}>
            <Ionicons name="arrow-back" size={22} color="#1A1A18" />
          </Pressable>
          <Text style={styles.headerTitle}>Build Your Ranking</Text>
          <View style={{ width: 36 }} />
        </View>
        <View style={styles.centered}>
          <Ionicons name="person-outline" size={40} color="#8C8C8A" />
          <Text style={styles.signInText}>Sign in to submit a ranking</Text>
        </View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.safeArea} edges={['top']}>
      <KeyboardAvoidingView
        style={{ flex: 1 }}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        keyboardVerticalOffset={0}
      >
        <View style={styles.header}>
          <Pressable style={styles.backBtn} onPress={() => router.back()}>
            <Ionicons name="arrow-back" size={22} color="#1A1A18" />
          </Pressable>
          <Text style={styles.headerTitle} numberOfLines={1}>
            Build Your Ranking
          </Text>
          <View style={{ width: 36 }} />
        </View>

        {loading ? (
          <View style={styles.centered}>
            <ActivityIndicator size="large" color="#D97706" />
          </View>
        ) : (
          <ScrollView
            style={{ flex: 1 }}
            keyboardShouldPersistTaps="handled"
            showsVerticalScrollIndicator={false}
            contentContainerStyle={styles.scrollContent}
          >
            <View style={styles.section}>
              <Text style={styles.sectionLabel}>My Ranking</Text>
              {ranking.length === 0 ? (
                <View style={styles.emptyRanking}>
                  <Text style={styles.emptyRankingText}>
                    Search below and add albums to your ranking
                  </Text>
                </View>
              ) : (
                ranking.map((item, idx) => (
                  <View key={item.listKey} style={styles.rankRow}>
                    <Text style={[styles.rankNum, idx < 3 && styles.rankNumTop]}>
                      {idx + 1}
                    </Text>
                    <Image
                      source={item.cover_url ? { uri: item.cover_url } : undefined}
                      style={styles.rankCover}
                      contentFit="cover"
                      transition={150}
                    />
                    <View style={styles.rankInfo}>
                      <Text style={styles.rankTitle} numberOfLines={1}>
                        {item.title}
                      </Text>
                      <Text style={styles.rankArtist} numberOfLines={1}>
                        {item.artist}
                      </Text>
                    </View>
                    <View style={styles.rankActions}>
                      <Pressable
                        style={({ pressed }) => [styles.arrowBtn, pressed && { opacity: 0.5 }]}
                        onPress={() => moveUp(idx)}
                        disabled={idx === 0}
                      >
                        <Ionicons
                          name="chevron-up"
                          size={18}
                          color={idx === 0 ? '#C8C8C6' : '#1A1A18'}
                        />
                      </Pressable>
                      <Pressable
                        style={({ pressed }) => [styles.arrowBtn, pressed && { opacity: 0.5 }]}
                        onPress={() => moveDown(idx)}
                        disabled={idx === ranking.length - 1}
                      >
                        <Ionicons
                          name="chevron-down"
                          size={18}
                          color={idx === ranking.length - 1 ? '#C8C8C6' : '#1A1A18'}
                        />
                      </Pressable>
                      <Pressable
                        style={({ pressed }) => [styles.removeBtn, pressed && { opacity: 0.5 }]}
                        onPress={() => removeAlbum(item.listKey)}
                      >
                        <Ionicons name="close-circle-outline" size={20} color="#8C8C8A" />
                      </Pressable>
                    </View>
                  </View>
                ))
              )}
            </View>

            <View style={styles.section}>
              <Text style={styles.sectionLabel}>Add Albums</Text>
              <View style={styles.searchBar}>
                <Ionicons name="search-outline" size={16} color="#8C8C8A" style={{ marginRight: 8 }} />
                <TextInput
                  style={styles.searchInput}
                  placeholder="Search by title or artist..."
                  placeholderTextColor="#8C8C8A"
                  value={searchQuery}
                  onChangeText={setSearchQuery}
                  returnKeyType="search"
                  clearButtonMode="while-editing"
                />
              </View>

              {filtered.map((item) => {
                const isAdded = addedIds.has(item.id);
                return (
                  <Pressable
                    key={item.id}
                    style={({ pressed }) => [
                      styles.poolRow,
                      pressed && !isAdded && styles.poolRowPressed,
                    ]}
                    onPress={() => !isAdded && addAlbum(item)}
                    disabled={isAdded}
                  >
                    <Image
                      source={item.cover_url ? { uri: item.cover_url } : undefined}
                      style={styles.poolCover}
                      contentFit="cover"
                      transition={150}
                    />
                    <View style={styles.poolInfo}>
                      <Text style={[styles.poolTitle, isAdded && { color: '#8C8C8A' }]} numberOfLines={1}>
                        {item.title}
                      </Text>
                      <Text style={styles.poolArtist} numberOfLines={1}>
                        {item.artist}
                      </Text>
                    </View>
                    {isAdded ? (
                      <Ionicons name="checkmark-circle" size={20} color="#D97706" />
                    ) : (
                      <Ionicons name="add-circle-outline" size={20} color="#D97706" />
                    )}
                  </Pressable>
                );
              })}
            </View>

            {saveError && (
              <View style={styles.errorContainer}>
                <Text style={styles.errorText}>{saveError}</Text>
              </View>
            )}

            {saveSuccess && (
              <View style={styles.successContainer}>
                <Ionicons name="checkmark-circle" size={18} color="#059669" />
                <Text style={styles.successText}>Ranking saved!</Text>
              </View>
            )}

            <Pressable
              style={({ pressed }) => [
                styles.saveBtn,
                (ranking.length === 0 || saving) && styles.saveBtnDisabled,
                pressed && ranking.length > 0 && !saving && styles.saveBtnPressed,
              ]}
              onPress={saveRanking}
              disabled={ranking.length === 0 || saving}
            >
              {saving ? (
                <ActivityIndicator size="small" color="#FFFFFF" />
              ) : (
                <Text style={styles.saveBtnText}>Save Ranking ({ranking.length} albums)</Text>
              )}
            </Pressable>
          </ScrollView>
        )}
      </KeyboardAvoidingView>
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
  signInText: {
    fontSize: 15,
    color: '#8C8C8A',
    marginTop: 10,
  },
  scrollContent: {
    paddingBottom: 40,
  },
  section: {
    marginTop: 20,
    paddingHorizontal: 20,
  },
  sectionLabel: {
    fontSize: 13,
    fontWeight: '700',
    color: '#8C8C8A',
    letterSpacing: 0.5,
    textTransform: 'uppercase',
    marginBottom: 12,
  },
  emptyRanking: {
    backgroundColor: '#FFFFFF',
    borderRadius: 10,
    borderWidth: 1,
    borderColor: '#E8E8E6',
    borderStyle: 'dashed',
    paddingVertical: 24,
    alignItems: 'center',
  },
  emptyRankingText: {
    fontSize: 13,
    color: '#8C8C8A',
    textAlign: 'center',
  },
  rankRow: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#FFFFFF',
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#E8E8E6',
    paddingHorizontal: 12,
    paddingVertical: 10,
    marginBottom: 8,
  },
  rankNum: {
    width: 22,
    fontSize: 14,
    fontWeight: '700',
    color: '#8C8C8A',
    textAlign: 'center',
  },
  rankNumTop: {
    color: '#D97706',
  },
  rankCover: {
    width: 44,
    height: 44,
    borderRadius: 4,
    backgroundColor: '#E8E8E6',
    marginLeft: 8,
    marginRight: 10,
  },
  rankInfo: {
    flex: 1,
    marginRight: 6,
  },
  rankTitle: {
    fontSize: 13,
    fontWeight: '600',
    color: '#1A1A18',
    letterSpacing: -0.1,
  },
  rankArtist: {
    fontSize: 12,
    color: '#8C8C8A',
    marginTop: 1,
  },
  rankActions: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  arrowBtn: {
    width: 28,
    height: 28,
    alignItems: 'center',
    justifyContent: 'center',
  },
  removeBtn: {
    width: 28,
    height: 28,
    alignItems: 'center',
    justifyContent: 'center',
    marginLeft: 2,
  },
  searchBar: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#FFFFFF',
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#E8E8E6',
    paddingHorizontal: 12,
    paddingVertical: 10,
    marginBottom: 10,
  },
  searchInput: {
    flex: 1,
    fontSize: 14,
    color: '#1A1A18',
    padding: 0,
  },
  poolRow: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#FFFFFF',
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#E8E8E6',
    paddingHorizontal: 12,
    paddingVertical: 10,
    marginBottom: 6,
  },
  poolRowPressed: {
    backgroundColor: '#FEF3DC',
  },
  poolCover: {
    width: 40,
    height: 40,
    borderRadius: 4,
    backgroundColor: '#E8E8E6',
    marginRight: 10,
  },
  poolInfo: {
    flex: 1,
    marginRight: 8,
  },
  poolTitle: {
    fontSize: 13,
    fontWeight: '600',
    color: '#1A1A18',
    letterSpacing: -0.1,
  },
  poolArtist: {
    fontSize: 12,
    color: '#8C8C8A',
    marginTop: 1,
  },
  errorContainer: {
    marginHorizontal: 20,
    marginTop: 12,
    backgroundColor: '#FEE2E2',
    borderRadius: 8,
    padding: 12,
  },
  errorText: {
    fontSize: 13,
    color: '#DC2626',
  },
  successContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    marginHorizontal: 20,
    marginTop: 12,
    backgroundColor: '#D1FAE5',
    borderRadius: 8,
    padding: 12,
  },
  successText: {
    fontSize: 13,
    color: '#059669',
    fontWeight: '600',
    marginLeft: 6,
  },
  saveBtn: {
    marginHorizontal: 20,
    marginTop: 20,
    backgroundColor: '#D97706',
    borderRadius: 10,
    paddingVertical: 14,
    alignItems: 'center',
  },
  saveBtnDisabled: {
    backgroundColor: '#C8C8C6',
  },
  saveBtnPressed: {
    backgroundColor: '#B45309',
  },
  saveBtnText: {
    fontSize: 15,
    fontWeight: '700',
    color: '#FFFFFF',
    letterSpacing: -0.2,
  },
});
