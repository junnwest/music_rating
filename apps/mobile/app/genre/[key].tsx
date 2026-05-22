import { useEffect, useState, useCallback } from 'react';
import {
  ActivityIndicator,
  FlatList,
  Pressable,
  StyleSheet,
  Text,
  View,
  Dimensions,
} from 'react-native';
import { Image } from 'expo-image';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { supabase } from '@/lib/supabase';

const { width: SCREEN_WIDTH } = Dimensions.get('window');
const CARD_GAP = 12;
const CARD_PADDING = 16;
const CARD_WIDTH = (SCREEN_WIDTH - CARD_PADDING * 2 - CARD_GAP) / 2;
const PAGE_SIZE = 40;

const GENRE_CATEGORIES = {
  'k-pop': {
    name: 'K-Pop Picks',
    description: 'Popular K-Pop albums making waves',
    genreFilters: ['k-pop', 'korean pop'],
  },
  'korean-indie': {
    name: 'Korean Indie & Ballad',
    description: 'Thoughtful indie and ballad albums from Korea',
    genreFilters: ['k-indie', 'korean indie', 'korean folk', 'korean ballad'],
  },
  'korean-rb': {
    name: 'K-R&B Essentials',
    description: 'Smooth and soulful Korean R&B',
    genreFilters: ['k-r&b', 'korean r&b'],
  },
  'indie-global': {
    name: 'Indie Essentials',
    description: 'Essential indie albums from around the world',
    genreFilters: ['indie rock', 'indie pop', 'dream pop', 'shoegaze', 'bedroom pop'],
  },
  'hip-hop': {
    name: 'Hip-Hop & Rap',
    description: 'Essential hip-hop and rap records',
    genreFilters: ['hip-hop', 'hip hop', 'rap', 'jazz rap', 'k-rap'],
  },
} as const;

type GenreKey = keyof typeof GENRE_CATEGORIES;

interface Release {
  id: string;
  title: string;
  artist: string;
  cover_url: string | null;
  release_date: string | null;
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

export default function GenreScreen() {
  const { key } = useLocalSearchParams<{ key: string }>();
  const router = useRouter();
  const [albums, setAlbums] = useState<Release[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [page, setPage] = useState(0);
  const [hasMore, setHasMore] = useState(true);

  const cat = GENRE_CATEGORIES[key as GenreKey];

  const fetchPage = useCallback(async (pageNum: number) => {
    if (!cat) return;
    if (pageNum === 0) setLoading(true);
    else setLoadingMore(true);

    const orClause = cat.genreFilters.map((g) => `genres.ilike.%${g}%`).join(',');
    const { data } = await supabase
      .from('releases')
      .select('id, title, artist, cover_url, release_date')
      .or(orClause)
      .not('cover_url', 'is', null)
      .order('prestige', { ascending: true, nullsFirst: false })
      .order('release_date', { ascending: false })
      .range(pageNum * PAGE_SIZE, (pageNum + 1) * PAGE_SIZE - 1);

    const rows = (data ?? []) as Release[];
    setAlbums((prev) => (pageNum === 0 ? rows : [...prev, ...rows]));
    setHasMore(rows.length === PAGE_SIZE);
    setPage(pageNum);
    if (pageNum === 0) setLoading(false);
    else setLoadingMore(false);
  }, [cat]);

  useEffect(() => {
    fetchPage(0);
  }, [fetchPage]);

  if (!cat) {
    return (
      <SafeAreaView style={styles.container} edges={['top']}>
        <Pressable style={styles.backBtn} onPress={() => router.back()}>
          <Ionicons name="chevron-back" size={24} color="#1A1A18" />
        </Pressable>
        <Text style={styles.errorText}>Genre not found.</Text>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.container} edges={['top']}>
      <View style={styles.header}>
        <Pressable style={styles.backBtnRow} onPress={() => router.back()}>
          <Ionicons name="chevron-back" size={24} color="#1A1A18" />
        </Pressable>
        <View style={styles.headerText}>
          <Text style={styles.headerTitle}>{cat.name}</Text>
          <Text style={styles.headerSub}>{cat.description}</Text>
        </View>
      </View>

      {loading ? (
        <View style={styles.loading}>
          <ActivityIndicator size="large" color="#D97706" />
        </View>
      ) : (
        <FlatList
          data={albums}
          keyExtractor={(item) => item.id}
          numColumns={2}
          columnWrapperStyle={styles.row}
          contentContainerStyle={styles.listContent}
          showsVerticalScrollIndicator={false}
          renderItem={({ item }) => (
            <AlbumCard item={item} onPress={() => router.push(`/album/${item.id}`)} />
          )}
          onEndReached={() => {
            if (hasMore && !loadingMore) fetchPage(page + 1);
          }}
          onEndReachedThreshold={0.3}
          ListFooterComponent={
            loadingMore ? (
              <View style={styles.footerLoading}>
                <ActivityIndicator size="small" color="#D97706" />
              </View>
            ) : null
          }
        />
      )}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#F8F8F6' },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 8,
    paddingVertical: 10,
    borderBottomWidth: 1,
    borderBottomColor: '#E8E8E6',
    backgroundColor: '#F8F8F6',
  },
  backBtnRow: { padding: 6, marginRight: 4 },
  headerText: { flex: 1 },
  headerTitle: { fontSize: 17, fontWeight: '700', color: '#1A1A18', letterSpacing: -0.3 },
  headerSub: { fontSize: 12, color: '#8C8C8A', marginTop: 2 },
  backBtn: { padding: 12 },
  loading: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  errorText: { fontSize: 15, color: '#8C8C8A', textAlign: 'center', marginTop: 40 },
  row: { gap: CARD_GAP, paddingHorizontal: CARD_PADDING },
  listContent: { paddingTop: CARD_GAP, paddingBottom: 48, gap: CARD_GAP },
  card: {
    width: CARD_WIDTH,
    backgroundColor: '#FFFFFF',
    borderRadius: 10,
    overflow: 'hidden',
    borderWidth: 1,
    borderColor: '#E8E8E6',
  },
  cardCover: { width: '100%', aspectRatio: 1, backgroundColor: '#E8E8E6' },
  cardInfo: { padding: 8 },
  cardTitle: { fontSize: 13, fontWeight: '600', color: '#1A1A18', lineHeight: 17, marginBottom: 2 },
  cardArtist: { fontSize: 12, color: '#8C8C8A', marginBottom: 2 },
  cardYear: { fontSize: 11, color: '#8C8C8A' },
  footerLoading: { paddingVertical: 20, alignItems: 'center' },
});
