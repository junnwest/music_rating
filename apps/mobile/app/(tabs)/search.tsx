import React, { useState, useEffect, useRef, useCallback } from 'react';
import {
  View,
  Text,
  TextInput,
  ScrollView,
  FlatList,
  Pressable,
  StyleSheet,
  Dimensions,
  Animated,
  Platform,
  ActivityIndicator,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Image } from 'expo-image';
import { Ionicons } from '@expo/vector-icons';
import { useFocusEffect, useLocalSearchParams, useRouter } from 'expo-router';
import { supabase } from '@/lib/supabase';
import { useAuth } from '@/context/AuthContext';
import { searchSpotify } from '@/lib/api';

const { width: SCREEN_WIDTH } = Dimensions.get('window');
const CARD_GAP = 8;
const CARD_PADDING = 16;
const CARD_WIDTH = (SCREEN_WIDTH - CARD_PADDING * 2 - CARD_GAP * 2) / 3;
const PAGE_SIZE = 20;

const FILTERS = [
  { label: 'All', value: null },
  { label: 'Albums', value: 'album' },
  { label: 'EPs', value: 'ep' },
  { label: 'Singles', value: 'single' },
] as const;

type FilterValue = 'album' | 'ep' | 'single' | null;

interface Profile {
  id: string;
  username: string;
  display_name: string | null;
  avatar_url: string | null;
}

interface Release {
  id: string;
  title: string;
  artist: string;
  cover_url: string | null;
  release_type: string | null;
  release_date: string | null;
}

function shuffle<T>(arr: T[]): T[] {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

function SkeletonCard() {
  const opacity = useRef(new Animated.Value(0.4)).current;

  useEffect(() => {
    const anim = Animated.loop(
      Animated.sequence([
        Animated.timing(opacity, { toValue: 1, duration: 600, useNativeDriver: true }),
        Animated.timing(opacity, { toValue: 0.4, duration: 600, useNativeDriver: true }),
      ])
    );
    anim.start();
    return () => anim.stop();
  }, []);

  return (
    <Animated.View style={[styles.skeletonCard, { opacity }]}>
      <View style={styles.skeletonCover} />
      <View style={styles.skeletonLine1} />
      <View style={styles.skeletonLine2} />
    </Animated.View>
  );
}

function AlbumCard({ item, onPress }: { item: Release; onPress: () => void }) {
  const year = item.release_date ? item.release_date.slice(0, 4) : null;

  return (
    <Pressable style={styles.card} onPress={onPress}>
      <Image
        source={item.cover_url ? { uri: item.cover_url } : undefined}
        style={styles.cardCover}
        contentFit="cover"
        transition={200}
      />
      <View style={styles.cardInfo}>
        <Text style={styles.cardTitle} numberOfLines={2}>{item.title}</Text>
        <Text style={styles.cardArtist} numberOfLines={1}>{item.artist}</Text>
        {year ? <Text style={styles.cardYear}>{year}</Text> : null}
      </View>
    </Pressable>
  );
}

function SectionLabel({ title, subtitle }: { title: string; subtitle?: string }) {
  return (
    <View style={styles.sectionLabel}>
      <Text style={styles.sectionTitle}>{title}</Text>
      {subtitle ? <Text style={styles.sectionSubtitle}>{subtitle}</Text> : null}
    </View>
  );
}

export default function SearchScreen() {
  const router = useRouter();
  const { user } = useAuth();
  const { autoFocus } = useLocalSearchParams<{ autoFocus?: string }>();
  const inputRef = useRef<TextInput>(null);

  const [query, setQuery] = useState('');
  const [results, setResults] = useState<Release[]>([]);
  const [peopleResults, setPeopleResults] = useState<Profile[]>([]);
  const [loading, setLoading] = useState(false);
  const [activeFilter, setActiveFilter] = useState<FilterValue>(null);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useFocusEffect(useCallback(() => {
    if (autoFocus === '1') {
      const t = setTimeout(() => inputRef.current?.focus(), 150);
      return () => clearTimeout(t);
    }
  }, [autoFocus]));

  // Explore state
  const [exploreAlbums, setExploreAlbums] = useState<Release[]>([]);
  const [communityAlbums, setCommunityAlbums] = useState<Release[]>([]);
  const [exploreLoading, setExploreLoading] = useState(true);
  const [exploreHasMore, setExploreHasMore] = useState(true);
  const [exploreLoadingMore, setExploreLoadingMore] = useState(false);
  const explorePageRef = useRef(0);
  const exploreArtistsRef = useRef<string[]>([]);
  const exploreExcludeRef = useRef<string[]>([]);
  const exploreSeenRef = useRef(new Set<string>());
  const exploreFetchingRef = useRef(false);

  const fetchExplorePage = useCallback(async (isFirst: boolean) => {
    if (exploreFetchingRef.current) return;
    exploreFetchingRef.current = true;
    if (isFirst) setExploreLoading(true);
    else setExploreLoadingMore(true);

    const page = explorePageRef.current;
    const artists = exploreArtistsRef.current;
    const excludeIds = exploreExcludeRef.current;
    const newAlbums: Release[] = [];
    let hasMore = false;

    // Artist-based recommendations
    if (artists.length > 0) {
      const orClause = artists.map((n) => `artist.ilike.%${n}%`).join(',');
      let q = supabase
        .from('recommendable_releases')
        .select('id, title, artist, cover_url, release_type, release_date')
        .or(orClause);
      if (excludeIds.length > 0) {
        q = q.not('id', 'in', `(${excludeIds.join(',')})`);
      }
      const { data } = await q
        .order('release_date', { ascending: false })
        .range(page * PAGE_SIZE, (page + 1) * PAGE_SIZE - 1);

      if (data && data.length > 0) {
        hasMore = true;
        for (const r of shuffle(data as Release[])) {
          if (!exploreSeenRef.current.has(r.id)) {
            exploreSeenRef.current.add(r.id);
            newAlbums.push(r);
          }
        }
      }
    }

    // Fallback: prestige-ordered browse
    if (!hasMore) {
      let q = supabase
        .from('recommendable_releases')
        .select('id, title, artist, cover_url, release_type, release_date');
      if (excludeIds.length > 0) {
        q = q.not('id', 'in', `(${excludeIds.join(',')})`);
      }
      const { data } = await q
        .order('prestige', { ascending: true, nullsFirst: false })
        .order('release_date', { ascending: false })
        .range(page * PAGE_SIZE, (page + 1) * PAGE_SIZE - 1);

      if (data && data.length > 0) {
        hasMore = true;
        for (const r of data as Release[]) {
          if (!exploreSeenRef.current.has(r.id)) {
            exploreSeenRef.current.add(r.id);
            newAlbums.push(r);
          }
        }
      }
    }

    setExploreAlbums((prev) => [...prev, ...newAlbums]);
    setExploreHasMore(hasMore);
    explorePageRef.current = page + 1;

    if (isFirst) setExploreLoading(false);
    else setExploreLoadingMore(false);
    exploreFetchingRef.current = false;
  }, []);

  useEffect(() => {
    let cancelled = false;

    async function init() {
      // Reset explore state
      explorePageRef.current = 0;
      exploreSeenRef.current = new Set();
      exploreArtistsRef.current = [];
      exploreExcludeRef.current = [];
      setExploreAlbums([]);
      setCommunityAlbums([]);
      setExploreHasMore(true);

      if (user) {
        const { data: ratings } = await supabase
          .from('ratings')
          .select('release_id, releases(artist)')
          .eq('user_id', user.id)
          .order('created_at', { ascending: false })
          .limit(50);

        if (!cancelled && ratings) {
          // Build top artists
          const artistCount = new Map<string, number>();
          for (const r of ratings) {
            const artist = (r.releases as any)?.artist;
            if (artist) {
              const primary = artist.split(',')[0].trim();
              artistCount.set(primary, (artistCount.get(primary) ?? 0) + 1);
            }
          }
          exploreArtistsRef.current = [...artistCount.entries()]
            .sort((a, b) => b[1] - a[1])
            .map(([name]) => name);
          exploreExcludeRef.current = ratings.map((r) => r.release_id);

          // Community picks: most-rated releases the user hasn't rated
          const { data: allRatings } = await supabase
            .from('ratings')
            .select('release_id');
          if (!cancelled && allRatings) {
            const excludeSet = new Set(exploreExcludeRef.current);
            const counts = new Map<string, number>();
            for (const r of allRatings) {
              if (!excludeSet.has(r.release_id)) {
                counts.set(r.release_id, (counts.get(r.release_id) ?? 0) + 1);
              }
            }
            const topIds = shuffle(
              [...counts.entries()]
                .sort((a, b) => b[1] - a[1])
                .slice(0, 200)
            )
              .slice(0, 40)
              .map(([id]) => id);

            if (topIds.length > 0) {
              const { data: communityReleases } = await supabase
                .from('releases')
                .select('id, title, artist, cover_url, release_type, release_date')
                .in('id', topIds)
                .not('cover_url', 'is', null);
              if (!cancelled && communityReleases) {
                const communityMap = new Map((communityReleases as Release[]).map((r) => [r.id, r]));
                const orderedCommunity: Release[] = [];
                for (const id of topIds) {
                  const r = communityMap.get(id);
                  if (r) {
                    exploreSeenRef.current.add(r.id);
                    orderedCommunity.push(r);
                  }
                }
                setCommunityAlbums(orderedCommunity);
              }
            }
          }
        }
      }

      if (!cancelled) {
        await fetchExplorePage(true);
      }
    }

    init();
    return () => { cancelled = true; };
  }, [user, fetchExplorePage]);

  // Search — merges Supabase DB + Spotify + people
  const search = useCallback(async (q: string) => {
    if (!q.trim()) {
      setResults([]);
      setPeopleResults([]);
      setLoading(false);
      return;
    }
    setLoading(true);

    const [dbRes, spotifyRes, peopleRes] = await Promise.all([
      supabase
        .from('releases')
        .select('id, title, artist, cover_url, release_type, release_date')
        .or(`title.ilike.%${q}%,artist.ilike.%${q}%`)
        .limit(40),
      searchSpotify(q),
      supabase
        .from('profiles')
        .select('id, username, display_name, avatar_url')
        .or(`username.ilike.%${q}%,display_name.ilike.%${q}%`)
        .limit(10),
    ]);

    const dbResults: Release[] = dbRes.error ? [] : (dbRes.data as Release[]);
    const dbIds = new Set(dbResults.map((r) => r.id));

    const spotifyExtra: Release[] = spotifyRes
      .filter((r) => r.id && !dbIds.has(r.id))
      .map((r) => ({
        id: r.id!,
        title: r.title,
        artist: r.artist,
        cover_url: r.coverUrl,
        release_type: r.releaseType,
        release_date: r.date,
      }));

    setLoading(false);
    setResults([...dbResults, ...spotifyExtra]);
    setPeopleResults(peopleRes.error ? [] : (peopleRes.data as Profile[]));
  }, []);

  useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => {
      search(query);
    }, 400);
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, [query, search]);

  const filtered = activeFilter
    ? results.filter((r) => r.release_type?.toLowerCase() === activeFilter)
    : results;

  const isSearching = query.trim().length > 0;

  function renderExplore() {
    if (exploreLoading) {
      const skeletons = Array.from({ length: 8 }, (_, i) => i);
      return (
        <View style={styles.grid}>
          {skeletons.map((i) => <SkeletonCard key={i} />)}
        </View>
      );
    }

    return (
      <>
        {communityAlbums.length > 0 && (
          <>
            <SectionLabel
              title="Community Picks"
              subtitle="Most-rated albums you haven't heard yet"
            />
            <View style={styles.grid}>
              {communityAlbums.map((item) => (
                <AlbumCard
                  key={item.id}
                  item={item}
                  onPress={() => router.push(`/album/${item.id}`)}
                />
              ))}
            </View>
          </>
        )}

        {exploreAlbums.length > 0 && (
          <>
            <SectionLabel
              title={exploreArtistsRef.current.length > 0 ? 'Recommended for You' : 'Browse Music'}
              subtitle={
                exploreArtistsRef.current.length > 0
                  ? 'Based on artists you love'
                  : 'Discover new albums'
              }
            />
            <View style={styles.grid}>
              {exploreAlbums.map((item) => (
                <AlbumCard
                  key={item.id}
                  item={item}
                  onPress={() => router.push(`/album/${item.id}`)}
                />
              ))}
            </View>
          </>
        )}

        {exploreAlbums.length === 0 && communityAlbums.length === 0 && (
          <View style={styles.emptyState}>
            <Ionicons name="musical-notes-outline" size={56} color="#8C8C8A" />
            <Text style={styles.emptyTitle}>No recommendations yet</Text>
            <Text style={styles.emptySubtitle}>Rate some albums to get personalized picks</Text>
          </View>
        )}

        {exploreHasMore && (
          <Pressable
            style={styles.loadMoreBtn}
            onPress={() => fetchExplorePage(false)}
            disabled={exploreLoadingMore}
          >
            {exploreLoadingMore ? (
              <ActivityIndicator size="small" color="#D97706" />
            ) : (
              <Text style={styles.loadMoreText}>Load more</Text>
            )}
          </Pressable>
        )}
      </>
    );
  }

  function renderSearchResults() {
    if (loading) {
      const skeletons = Array.from({ length: 9 }, (_, i) => i);
      return (
        <View style={styles.grid}>
          {skeletons.map((i) => <SkeletonCard key={i} />)}
        </View>
      );
    }

    const noAlbums = filtered.length === 0;
    const noPeople = peopleResults.length === 0;

    if (!loading && noAlbums && noPeople) {
      return (
        <View style={styles.emptyState}>
          <Ionicons name="search-outline" size={56} color="#8C8C8A" />
          <Text style={styles.emptyTitle}>No results for "{query}"</Text>
        </View>
      );
    }

    return (
      <>
        {peopleResults.length > 0 && (
          <>
            <SectionLabel title="People" />
            <View style={styles.peopleList}>
              {peopleResults.map((person) => (
                <Pressable
                  key={person.id}
                  style={({ pressed }) => [styles.personRow, pressed && { opacity: 0.7 }]}
                  onPress={() => router.push(`/profile/${person.username}` as any)}
                >
                  {person.avatar_url ? (
                    <Image source={{ uri: person.avatar_url }} style={styles.personAvatar} contentFit="cover" />
                  ) : (
                    <View style={[styles.personAvatar, styles.personAvatarFallback]}>
                      <Text style={styles.personAvatarLetter}>{(person.display_name ?? person.username).charAt(0).toUpperCase()}</Text>
                    </View>
                  )}
                  <View style={styles.personInfo}>
                    <Text style={styles.personDisplayName} numberOfLines={1}>{person.display_name ?? person.username}</Text>
                    <Text style={styles.personUsername} numberOfLines={1}>@{person.username}</Text>
                  </View>
                  <Ionicons name="chevron-forward" size={16} color="#8C8C8A" />
                </Pressable>
              ))}
            </View>
          </>
        )}

        {filtered.length > 0 && (
          <>
            {peopleResults.length > 0 && <SectionLabel title="Albums & Music" />}
            <FlatList
              data={filtered}
              keyExtractor={(item) => item.id}
              numColumns={3}
              columnWrapperStyle={styles.row}
              contentContainerStyle={styles.listContent}
              renderItem={({ item }) => (
                <AlbumCard item={item} onPress={() => router.push(`/album/${item.id}`)} />
              )}
              scrollEnabled={false}
            />
          </>
        )}
      </>
    );
  }

  return (
    <SafeAreaView style={styles.container} edges={['top']}>
      <ScrollView
        style={styles.scrollView}
        keyboardShouldPersistTaps="handled"
        showsVerticalScrollIndicator={false}
      >
        <View style={styles.header}>
          <Text style={styles.headerTitle}>Search</Text>
        </View>

        <View style={styles.searchContainer}>
          <Ionicons name="search-outline" size={18} color="#8C8C8A" style={styles.searchIcon} />
          <TextInput
            ref={inputRef}
            style={styles.searchInput}
            placeholder="Albums, artists, people..."
            placeholderTextColor="#8C8C8A"
            value={query}
            onChangeText={setQuery}
            autoCorrect={false}
            autoCapitalize="none"
            returnKeyType="search"
          />
          {query.length > 0 && (
            <Pressable onPress={() => setQuery('')} hitSlop={8}>
              <Ionicons name="close-circle" size={18} color="#8C8C8A" />
            </Pressable>
          )}
        </View>

        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          style={styles.filtersScroll}
          contentContainerStyle={styles.filtersContent}
        >
          {FILTERS.map((f) => {
            const active = activeFilter === f.value;
            return (
              <Pressable
                key={f.label}
                style={[styles.pill, active && styles.pillActive]}
                onPress={() => setActiveFilter(f.value)}
              >
                <Text style={[styles.pillText, active && styles.pillTextActive]}>
                  {f.label}
                </Text>
              </Pressable>
            );
          })}
        </ScrollView>

        {isSearching ? renderSearchResults() : renderExplore()}
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#F8F8F6',
  },
  scrollView: {
    flex: 1,
  },
  header: {
    paddingHorizontal: CARD_PADDING,
    paddingTop: 8,
    paddingBottom: 12,
  },
  headerTitle: {
    fontSize: 28,
    fontWeight: '700',
    color: '#1A1A18',
  },
  searchContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    marginHorizontal: CARD_PADDING,
    backgroundColor: '#FFFFFF',
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#E8E8E6',
    paddingHorizontal: 12,
    paddingVertical: Platform.OS === 'ios' ? 10 : 6,
    marginBottom: 12,
  },
  searchIcon: {
    marginRight: 8,
  },
  searchInput: {
    flex: 1,
    fontSize: 15,
    color: '#1A1A18',
    padding: 0,
  },
  filtersScroll: {
    marginBottom: 16,
  },
  filtersContent: {
    paddingHorizontal: CARD_PADDING,
    gap: 8,
    flexDirection: 'row',
  },
  pill: {
    paddingHorizontal: 14,
    paddingVertical: 6,
    borderRadius: 100,
    backgroundColor: '#FFFFFF',
    borderWidth: 1,
    borderColor: '#E8E8E6',
  },
  pillActive: {
    backgroundColor: '#D97706',
    borderColor: '#D97706',
  },
  pillText: {
    fontSize: 13,
    fontWeight: '500',
    color: '#8C8C8A',
  },
  pillTextActive: {
    color: '#FFFFFF',
  },
  sectionLabel: {
    paddingHorizontal: CARD_PADDING,
    marginBottom: 14,
    marginTop: 8,
  },
  sectionTitle: {
    fontSize: 17,
    fontWeight: '700',
    color: '#1A1A18',
    letterSpacing: -0.3,
  },
  sectionSubtitle: {
    fontSize: 13,
    color: '#8C8C8A',
    marginTop: 2,
  },
  grid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    paddingHorizontal: CARD_PADDING,
    gap: CARD_GAP,
    marginBottom: 28,
  },
  row: {
    gap: CARD_GAP,
  },
  listContent: {
    paddingHorizontal: CARD_PADDING,
    paddingBottom: 32,
    gap: CARD_GAP,
  },
  card: {
    width: CARD_WIDTH,
    backgroundColor: '#FFFFFF',
    borderRadius: 10,
    overflow: 'hidden',
    borderWidth: 1,
    borderColor: '#E8E8E6',
  },
  cardCover: {
    width: '100%',
    aspectRatio: 1,
    backgroundColor: '#E8E8E6',
  },
  cardInfo: {
    padding: 8,
  },
  cardTitle: {
    fontSize: 13,
    fontWeight: '600',
    color: '#1A1A18',
    lineHeight: 17,
    marginBottom: 2,
  },
  cardArtist: {
    fontSize: 12,
    color: '#8C8C8A',
    marginBottom: 2,
  },
  cardYear: {
    fontSize: 11,
    color: '#8C8C8A',
  },
  skeletonCard: {
    width: CARD_WIDTH,
    backgroundColor: '#FFFFFF',
    borderRadius: 10,
    overflow: 'hidden',
    borderWidth: 1,
    borderColor: '#E8E8E6',
  },
  skeletonCover: {
    width: '100%',
    aspectRatio: 1,
    backgroundColor: '#E8E8E6',
  },
  skeletonLine1: {
    margin: 8,
    marginBottom: 4,
    height: 13,
    borderRadius: 6,
    backgroundColor: '#E8E8E6',
    width: '80%',
  },
  skeletonLine2: {
    marginHorizontal: 8,
    marginBottom: 8,
    height: 11,
    borderRadius: 5,
    backgroundColor: '#E8E8E6',
    width: '55%',
  },
  emptyState: {
    alignItems: 'center',
    justifyContent: 'center',
    paddingTop: 80,
    paddingBottom: 40,
    gap: 12,
  },
  emptyTitle: {
    fontSize: 15,
    color: '#8C8C8A',
    fontWeight: '500',
    textAlign: 'center',
  },
  emptySubtitle: {
    fontSize: 13,
    color: '#8C8C8A',
    textAlign: 'center',
    paddingHorizontal: 32,
  },
  loadMoreBtn: {
    marginHorizontal: CARD_PADDING,
    marginBottom: 32,
    paddingVertical: 12,
    borderRadius: 10,
    backgroundColor: '#FEF3DC',
    borderWidth: 1,
    borderColor: '#F5CA76',
    alignItems: 'center',
  },
  loadMoreText: {
    fontSize: 14,
    fontWeight: '600',
    color: '#D97706',
  },
  peopleList: {
    marginHorizontal: CARD_PADDING,
    marginBottom: 20,
    backgroundColor: '#FFFFFF',
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#E8E8E6',
    overflow: 'hidden',
  },
  personRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 14,
    paddingVertical: 10,
    borderBottomWidth: 1,
    borderBottomColor: '#E8E8E6',
  },
  personAvatar: {
    width: 40,
    height: 40,
    borderRadius: 20,
    marginRight: 12,
    backgroundColor: '#E8E8E6',
  },
  personAvatarFallback: {
    backgroundColor: '#D97706',
    alignItems: 'center',
    justifyContent: 'center',
  },
  personAvatarLetter: {
    fontSize: 16,
    fontWeight: '700',
    color: '#FFFFFF',
  },
  personInfo: {
    flex: 1,
  },
  personDisplayName: {
    fontSize: 14,
    fontWeight: '600',
    color: '#1A1A18',
    letterSpacing: -0.2,
  },
  personUsername: {
    fontSize: 12,
    color: '#8C8C8A',
    marginTop: 1,
  },
});
