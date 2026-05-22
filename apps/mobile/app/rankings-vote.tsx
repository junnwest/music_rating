import { useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
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

type RankingItem = Release & { listKey: string; tiedWithPrev: boolean };

function computeRanks(items: RankingItem[]): number[] {
  const ranks: number[] = [];
  let current = 1;
  for (let i = 0; i < items.length; i++) {
    if (i > 0 && items[i].tiedWithPrev) {
      ranks.push(ranks[i - 1]);
    } else {
      ranks.push(current);
    }
    if (!items[i + 1]?.tiedWithPrev) {
      current = i + 2;
    }
  }
  return ranks;
}

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

async function loadExistingRanking(userId: string, categoryId: string): Promise<RankingItem[]> {
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
  for (const r of (releases ?? []) as Release[]) releaseMap.set(r.id, r);

  let counter = 0;
  return entries
    .map((e: { release_id: string; rank: number }, i: number) => {
      const rel = releaseMap.get(e.release_id);
      if (!rel) return null;
      const prev = entries[i - 1];
      const tiedWithPrev = i > 0 && prev?.rank === e.rank;
      return { ...rel, listKey: rel.id + '_' + ++counter, tiedWithPrev };
    })
    .filter(Boolean) as RankingItem[];
}

export default function RankingsVoteScreen() {
  const { categoryId } = useLocalSearchParams<{ slug: string; categoryId: string }>();
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
    if (!user || !categoryId) { setLoading(false); return; }
    async function load() {
      setLoading(true);
      const [poolAlbums, existing] = await Promise.all([
        fetchPoolAlbums(categoryId),
        loadExistingRanking(user!.id, categoryId),
      ]);
      setPool(poolAlbums);
      setRanking(existing.map((r) => ({ ...r, listKey: r.id + '_' + ++counterRef.current })));
      setLoading(false);
    }
    load();
  }, [user, categoryId]);

  const filtered = searchQuery.trim()
    ? pool.filter((r) => {
        const q = searchQuery.toLowerCase();
        return r.title.toLowerCase().includes(q) || r.artist.toLowerCase().includes(q);
      })
    : pool;

  const addedIds = new Set(ranking.map((r) => r.id));

  function addAlbum(release: Release) {
    if (addedIds.has(release.id)) return;
    counterRef.current += 1;
    setRanking((prev) => [
      ...prev,
      { ...release, listKey: release.id + '_' + counterRef.current, tiedWithPrev: false },
    ]);
    setSearchQuery('');
  }

  function removeAlbum(listKey: string) {
    setRanking((prev) => {
      const idx = prev.findIndex((r) => r.listKey === listKey);
      if (idx === -1) return prev;
      const next = [...prev];
      next.splice(idx, 1);
      // untie the item that followed the removed one if it was tied to it
      if (next[idx]?.tiedWithPrev && idx === 0) {
        next[idx] = { ...next[idx], tiedWithPrev: false };
      }
      return next;
    });
  }

  function moveUp(idx: number) {
    if (idx === 0) return;
    setRanking((prev) => {
      const next = [...prev];
      [next[idx - 1], next[idx]] = [next[idx], next[idx - 1]];
      // if the moved item was tied, carry the tie status to keep logical order
      if (next[idx].tiedWithPrev && idx - 1 === 0) {
        next[idx] = { ...next[idx], tiedWithPrev: false };
      }
      return next;
    });
  }

  function moveDown(idx: number) {
    setRanking((prev) => {
      if (idx >= prev.length - 1) return prev;
      const next = [...prev];
      [next[idx], next[idx + 1]] = [next[idx + 1], next[idx]];
      return next;
    });
  }

  function toggleTie(listKey: string) {
    setRanking((prev) => {
      const idx = prev.findIndex((r) => r.listKey === listKey);
      if (idx <= 0) return prev;
      const next = [...prev];
      next[idx] = { ...next[idx], tiedWithPrev: !next[idx].tiedWithPrev };
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

      await supabase.from('user_ranking_entries').delete().eq('ranking_id', rankingRow.id);

      const ranks = computeRanks(ranking);
      const entries = ranking.map((item, idx) => ({
        ranking_id: rankingRow.id,
        release_id: item.id,
        rank: ranks[idx],
      }));

      const { error: insertErr } = await supabase.from('user_ranking_entries').insert(entries);

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

  const ranks = computeRanks(ranking);

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
      >
        <View style={styles.header}>
          <Pressable style={styles.backBtn} onPress={() => router.back()}>
            <Ionicons name="arrow-back" size={22} color="#1A1A18" />
          </Pressable>
          <Text style={styles.headerTitle} numberOfLines={1}>Build Your Ranking</Text>
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
              <View style={styles.sectionLabelRow}>
                <Text style={styles.sectionLabel}>My Ranking</Text>
                {ranking.length > 0 && (
                  <Text style={styles.sectionHint}>↑↓ to reorder · = to tie</Text>
                )}
              </View>

              {ranking.length === 0 ? (
                <View style={styles.emptyRanking}>
                  <Ionicons name="list-outline" size={28} color="#8C8C8A" />
                  <Text style={styles.emptyRankingText}>
                    Search below and add albums to your ranking
                  </Text>
                </View>
              ) : (
                ranking.map((item, idx) => {
                  const rank = ranks[idx];
                  const isTop3 = rank <= 3;
                  const canTie = idx > 0;

                  return (
                    <View
                      key={item.listKey}
                      style={[styles.rankRow, item.tiedWithPrev && styles.rankRowTied]}
                    >
                      {item.tiedWithPrev && <View style={styles.tiedConnector} />}

                      <Text style={[styles.rankNum, isTop3 && styles.rankNumTop]}>
                        {item.tiedWithPrev ? '=' : rank}
                      </Text>

                      <Image
                        source={item.cover_url ? { uri: item.cover_url } : undefined}
                        style={styles.rankCover}
                        contentFit="cover"
                        transition={150}
                      />

                      <View style={styles.rankInfo}>
                        <Text style={styles.rankTitle} numberOfLines={1}>{item.title}</Text>
                        <Text style={styles.rankArtist} numberOfLines={1}>{item.artist}</Text>
                      </View>

                      <View style={styles.rankActions}>
                        {canTie && (
                          <Pressable
                            style={[styles.tieBtn, item.tiedWithPrev && styles.tieBtnActive]}
                            onPress={() => toggleTie(item.listKey)}
                            hitSlop={4}
                          >
                            <Text style={[styles.tieBtnText, item.tiedWithPrev && styles.tieBtnTextActive]}>=</Text>
                          </Pressable>
                        )}
                        <View style={styles.arrowGroup}>
                          <Pressable
                            style={({ pressed }) => [styles.arrowBtn, pressed && { opacity: 0.5 }]}
                            onPress={() => moveUp(idx)}
                            disabled={idx === 0}
                            hitSlop={4}
                          >
                            <Ionicons name="chevron-up" size={18} color={idx === 0 ? '#C8C8C6' : '#1A1A18'} />
                          </Pressable>
                          <Pressable
                            style={({ pressed }) => [styles.arrowBtn, pressed && { opacity: 0.5 }]}
                            onPress={() => moveDown(idx)}
                            disabled={idx === ranking.length - 1}
                            hitSlop={4}
                          >
                            <Ionicons name="chevron-down" size={18} color={idx === ranking.length - 1 ? '#C8C8C6' : '#1A1A18'} />
                          </Pressable>
                        </View>
                        <Pressable
                          style={({ pressed }) => [styles.removeBtn, pressed && { opacity: 0.5 }]}
                          onPress={() => removeAlbum(item.listKey)}
                          hitSlop={4}
                        >
                          <Ionicons name="close-circle-outline" size={20} color="#8C8C8A" />
                        </Pressable>
                      </View>
                    </View>
                  );
                })
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
                      <Text style={styles.poolArtist} numberOfLines={1}>{item.artist}</Text>
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
  safeArea: { flex: 1, backgroundColor: '#F8F8F6' },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 12,
    paddingVertical: 12,
    borderBottomWidth: 1,
    borderBottomColor: '#E8E8E6',
    backgroundColor: '#F8F8F6',
  },
  backBtn: { width: 36, height: 36, alignItems: 'center', justifyContent: 'center' },
  headerTitle: {
    flex: 1,
    textAlign: 'center',
    fontSize: 17,
    fontWeight: '700',
    color: '#1A1A18',
    letterSpacing: -0.3,
  },
  centered: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  signInText: { fontSize: 15, color: '#8C8C8A', marginTop: 10 },
  scrollContent: { paddingBottom: 40 },
  section: { marginTop: 20, paddingHorizontal: 20 },
  sectionLabelRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 12,
  },
  sectionLabel: {
    fontSize: 13,
    fontWeight: '700',
    color: '#8C8C8A',
    letterSpacing: 0.5,
    textTransform: 'uppercase',
  },
  sectionHint: { fontSize: 11, color: '#8C8C8A' },
  emptyRanking: {
    backgroundColor: '#FFFFFF',
    borderRadius: 10,
    borderWidth: 1,
    borderColor: '#E8E8E6',
    borderStyle: 'dashed',
    paddingVertical: 24,
    alignItems: 'center',
    gap: 8,
  },
  emptyRankingText: { fontSize: 13, color: '#8C8C8A', textAlign: 'center' },
  rankRow: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#FFFFFF',
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#E8E8E6',
    paddingHorizontal: 10,
    paddingVertical: 10,
    marginBottom: 6,
  },
  rankRowTied: {
    borderTopWidth: 0,
    borderTopLeftRadius: 0,
    borderTopRightRadius: 0,
    marginTop: -6,
  },
  tiedConnector: {
    position: 'absolute',
    left: 28,
    top: -6,
    width: 2,
    height: 6,
    backgroundColor: '#D97706',
  },
  rankNum: {
    width: 22,
    fontSize: 14,
    fontWeight: '700',
    color: '#8C8C8A',
    textAlign: 'center',
  },
  rankNumTop: { color: '#D97706' },
  rankCover: {
    width: 44,
    height: 44,
    borderRadius: 4,
    backgroundColor: '#E8E8E6',
    marginLeft: 8,
    marginRight: 10,
  },
  rankInfo: { flex: 1, marginRight: 4 },
  rankTitle: { fontSize: 13, fontWeight: '600', color: '#1A1A18', letterSpacing: -0.1 },
  rankArtist: { fontSize: 12, color: '#8C8C8A', marginTop: 1 },
  rankActions: { flexDirection: 'row', alignItems: 'center', gap: 2 },
  tieBtn: {
    width: 26,
    height: 26,
    borderRadius: 13,
    borderWidth: 1.5,
    borderColor: '#E8E8E6',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#FFFFFF',
  },
  tieBtnActive: { borderColor: '#D97706', backgroundColor: '#FEF3DC' },
  tieBtnText: { fontSize: 13, fontWeight: '700', color: '#8C8C8A' },
  tieBtnTextActive: { color: '#D97706' },
  arrowGroup: { flexDirection: 'column' },
  arrowBtn: { width: 24, height: 22, alignItems: 'center', justifyContent: 'center' },
  removeBtn: { width: 28, height: 28, alignItems: 'center', justifyContent: 'center' },
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
  searchInput: { flex: 1, fontSize: 14, color: '#1A1A18', padding: 0 },
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
  poolRowPressed: { backgroundColor: '#FEF3DC' },
  poolCover: { width: 40, height: 40, borderRadius: 4, backgroundColor: '#E8E8E6', marginRight: 10 },
  poolInfo: { flex: 1, marginRight: 8 },
  poolTitle: { fontSize: 13, fontWeight: '600', color: '#1A1A18', letterSpacing: -0.1 },
  poolArtist: { fontSize: 12, color: '#8C8C8A', marginTop: 1 },
  errorContainer: {
    marginHorizontal: 20,
    marginTop: 12,
    backgroundColor: '#FEE2E2',
    borderRadius: 8,
    padding: 12,
  },
  errorText: { fontSize: 13, color: '#DC2626' },
  successContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    marginHorizontal: 20,
    marginTop: 12,
    backgroundColor: '#D1FAE5',
    borderRadius: 8,
    padding: 12,
    gap: 6,
  },
  successText: { fontSize: 13, color: '#059669', fontWeight: '600' },
  saveBtn: {
    marginHorizontal: 20,
    marginTop: 20,
    backgroundColor: '#D97706',
    borderRadius: 10,
    paddingVertical: 14,
    alignItems: 'center',
  },
  saveBtnDisabled: { backgroundColor: '#C8C8C6' },
  saveBtnPressed: { backgroundColor: '#B45309' },
  saveBtnText: { fontSize: 15, fontWeight: '700', color: '#FFFFFF', letterSpacing: -0.2 },
});
