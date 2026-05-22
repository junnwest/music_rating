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
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Image } from 'expo-image';
import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { supabase } from '@/lib/supabase';

const { width: SCREEN_WIDTH } = Dimensions.get('window');
const CARD_GAP = 12;
const CARD_PADDING = 16;
const CARD_WIDTH = (SCREEN_WIDTH - CARD_PADDING * 2 - CARD_GAP) / 2;

const FILTERS = [
  { label: 'All', value: null },
  { label: 'Albums', value: 'album' },
  { label: 'EPs', value: 'ep' },
  { label: 'Singles', value: 'single' },
] as const;

type FilterValue = 'album' | 'ep' | 'single' | null;

interface Release {
  id: string;
  title: string;
  artist: string;
  cover_url: string | null;
  release_type: string | null;
  release_date: string | null;
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

export default function SearchScreen() {
  const router = useRouter();
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<Release[]>([]);
  const [loading, setLoading] = useState(false);
  const [activeFilter, setActiveFilter] = useState<FilterValue>(null);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const search = useCallback(async (q: string) => {
    if (!q.trim()) {
      setResults([]);
      setLoading(false);
      return;
    }
    setLoading(true);
    const { data, error } = await supabase
      .from('releases')
      .select('id, title, artist, cover_url, release_type, release_date')
      .or(`title.ilike.%${q}%,artist.ilike.%${q}%`)
      .limit(40);
    setLoading(false);
    if (!error && data) {
      setResults(data as Release[]);
    }
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

  const showEmpty = !loading && query.trim().length === 0;
  const showNoResults = !loading && query.trim().length > 0 && filtered.length === 0;

  function renderContent() {
    if (loading) {
      const skeletons = Array.from({ length: 8 }, (_, i) => i);
      return (
        <View style={styles.grid}>
          {skeletons.map((i) => (
            <SkeletonCard key={i} />
          ))}
        </View>
      );
    }

    if (showEmpty) {
      return (
        <View style={styles.emptyState}>
          <Ionicons name="search-outline" size={56} color="#8C8C8A" />
          <Text style={styles.emptyTitle}>Search albums and artists</Text>
        </View>
      );
    }

    if (showNoResults) {
      return (
        <View style={styles.emptyState}>
          <Ionicons name="search-outline" size={56} color="#8C8C8A" />
          <Text style={styles.emptyTitle}>No results for "{query}"</Text>
        </View>
      );
    }

    return (
      <FlatList
        data={filtered}
        keyExtractor={(item) => item.id}
        numColumns={2}
        columnWrapperStyle={styles.row}
        contentContainerStyle={styles.listContent}
        renderItem={({ item }) => (
          <AlbumCard item={item} onPress={() => router.push(`/album/${item.id}`)} />
        )}
        scrollEnabled={false}
      />
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
            style={styles.searchInput}
            placeholder="Albums, artists..."
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

        {renderContent()}
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
  grid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    paddingHorizontal: CARD_PADDING,
    gap: CARD_GAP,
    marginBottom: 32,
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
});
