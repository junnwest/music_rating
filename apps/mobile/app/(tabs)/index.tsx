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
import { useLanguage } from '@/lib/i18n';

const GENRE_CATEGORIES = [
  {
    key: 'k-pop',
    name: 'K-Pop Picks',
    description: 'Popular K-Pop albums making waves',
    genreFilters: ['k-pop', 'korean pop'],
  },
  {
    key: 'korean-indie',
    name: 'Korean Indie & Ballad',
    description: 'Thoughtful indie and ballad albums from Korea',
    genreFilters: ['k-indie', 'korean indie', 'korean folk', 'korean ballad'],
  },
  {
    key: 'korean-rb',
    name: 'K-R&B Essentials',
    description: 'Smooth and soulful Korean R&B',
    genreFilters: ['k-r&b', 'korean r&b'],
  },
  {
    key: 'indie-global',
    name: 'Indie Essentials',
    description: 'Essential indie albums from around the world',
    genreFilters: ['indie rock', 'indie pop', 'dream pop', 'shoegaze', 'bedroom pop'],
  },
  {
    key: 'hip-hop',
    name: 'Hip-Hop & Rap',
    description: 'Essential hip-hop and rap records',
    genreFilters: ['hip-hop', 'hip hop', 'rap', 'jazz rap', 'k-rap'],
  },
] as const;

type Album = {
  id: string;
  title: string;
  artist: string;
  coverUrl: string | null;
};

type Section = {
  key: string;
  name: string;
  description: string;
  albums: Album[];
};

function shuffle<T>(arr: T[]): T[] {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

async function fetchHomeSections(): Promise<Section[]> {
  const results = await Promise.all(
    GENRE_CATEGORIES.map(async (cat) => {
      const orClause = cat.genreFilters.map((g) => `genres.ilike.%${g}%`).join(',');
      const { data } = await supabase
        .from('releases')
        .select('id, title, artist, cover_url')
        .or(orClause)
        .not('cover_url', 'is', null)
        .order('prestige', { ascending: true, nullsFirst: false })
        .order('release_date', { ascending: false, nullsFirst: false })
        .limit(20);

      const albums = shuffle(data ?? []).map((r: any) => ({
        id: r.id,
        title: r.title,
        artist: r.artist,
        coverUrl: r.cover_url,
      }));

      return albums.length > 0
        ? { key: cat.key, name: cat.name, description: cat.description, albums }
        : null;
    })
  );
  return results.filter(Boolean) as Section[];
}

function AlbumCard({ album, onPress }: { album: Album; onPress: () => void }) {
  return (
    <Pressable style={({ pressed }) => [styles.albumCard, pressed && styles.albumCardPressed]} onPress={onPress}>
      <Image
        source={{ uri: album.coverUrl ?? undefined }}
        style={styles.albumCover}
        contentFit="cover"
        transition={200}
      />
      <Text style={styles.albumTitle} numberOfLines={1}>{album.title}</Text>
      <Text style={styles.albumArtist} numberOfLines={1}>{album.artist}</Text>
    </Pressable>
  );
}

function GenreRow({ section, onSeeAll }: { section: Section; onSeeAll: () => void }) {
  const router = useRouter();
  const { t } = useLanguage();
  return (
    <View style={styles.section}>
      <View style={styles.sectionHeader}>
        <View style={styles.sectionHeaderText}>
          <Text style={styles.sectionTitle}>{section.name}</Text>
          <Text style={styles.sectionDescription}>{section.description}</Text>
        </View>
        <Pressable onPress={onSeeAll}>
          <Text style={styles.seeAll}>{t('home.seeAll')}</Text>
        </Pressable>
      </View>
      <FlatList
        data={section.albums}
        horizontal
        showsHorizontalScrollIndicator={false}
        keyExtractor={(item) => item.id}
        renderItem={({ item }) => <AlbumCard album={item} onPress={() => router.push(`/album/${item.id}`)} />}
        contentContainerStyle={styles.albumRow}
        ItemSeparatorComponent={() => <View style={{ width: 12 }} />}
      />
    </View>
  );
}

export default function HomeScreen() {
  const router = useRouter();
  const [sections, setSections] = useState<Section[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetchHomeSections()
      .then(setSections)
      .finally(() => setLoading(false));
  }, []);

  return (
    <SafeAreaView style={styles.safeArea} edges={['top']}>
      {loading ? (
        <View style={styles.loadingContainer}>
          <ActivityIndicator size="large" color="#D97706" />
        </View>
      ) : (
        <FlatList
          data={sections}
          keyExtractor={(item) => item.key}
          renderItem={({ item }) => (
            <GenreRow
              section={item}
              onSeeAll={() => router.push(`/genre/${item.key}` as any)}
            />
          )}
          showsVerticalScrollIndicator={false}
          contentContainerStyle={styles.scrollContent}
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
  loadingContainer: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  scrollContent: {
    paddingBottom: 32,
  },
  section: {
    marginTop: 28,
  },
  sectionHeader: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
    paddingHorizontal: 20,
    marginBottom: 14,
  },
  sectionHeaderText: {
    flex: 1,
    marginRight: 12,
  },
  sectionTitle: {
    fontSize: 17,
    fontWeight: '700',
    color: '#1A1A18',
    letterSpacing: -0.3,
  },
  sectionDescription: {
    fontSize: 13,
    color: '#8C8C8A',
    marginTop: 2,
  },
  seeAll: {
    fontSize: 13,
    fontWeight: '600',
    color: '#D97706',
    marginTop: 2,
  },
  albumRow: {
    paddingHorizontal: 20,
  },
  albumCard: {
    width: 130,
  },
  albumCardPressed: {
    opacity: 0.75,
  },
  albumCover: {
    width: 130,
    height: 130,
    borderRadius: 6,
    backgroundColor: '#E8E8E6',
    marginBottom: 8,
  },
  albumTitle: {
    fontSize: 13,
    fontWeight: '600',
    color: '#1A1A18',
    letterSpacing: -0.2,
  },
  albumArtist: {
    fontSize: 12,
    color: '#8C8C8A',
    marginTop: 2,
  },
});
