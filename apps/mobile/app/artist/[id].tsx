import React, { useEffect, useState, useCallback } from 'react';
import {
  View,
  Text,
  FlatList,
  Pressable,
  StyleSheet,
  Dimensions,
  ActivityIndicator,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Image } from 'expo-image';
import { Ionicons } from '@expo/vector-icons';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { supabase } from '@/lib/supabase';

const { width: SCREEN_WIDTH } = Dimensions.get('window');
const CARD_GAP = 12;
const CARD_PADDING = 20;
const CARD_WIDTH = (SCREEN_WIDTH - CARD_PADDING * 2 - CARD_GAP) / 2;

interface Artist {
  id: string;
  name: string;
  cover_url: string | null;
  genres: string[] | null;
}

interface Release {
  id: string;
  title: string;
  cover_url: string | null;
  release_date: string | null;
  release_type: string | null;
  artist: string;
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

function AlbumCard({ item, onPress }: { item: Release; onPress: () => void }) {
  const year = item.release_date ? item.release_date.slice(0, 4) : null;
  const typeLabel = releaseTypeLabel(item.release_type);

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
        <View style={styles.cardMeta}>
          {year ? <Text style={styles.cardYear}>{year}</Text> : null}
          {typeLabel ? (
            <View style={styles.typePill}>
              <Text style={styles.typePillText}>{typeLabel}</Text>
            </View>
          ) : null}
        </View>
      </View>
    </Pressable>
  );
}

export default function ArtistScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();

  const [artist, setArtist] = useState<Artist | null>(null);
  const [releases, setReleases] = useState<Release[]>([]);
  const [loading, setLoading] = useState(true);

  const fetchData = useCallback(async () => {
    if (!id) return;
    setLoading(true);

    const { data: artistData, error: artistError } = await supabase
      .from('artists')
      .select('*')
      .eq('id', id)
      .single();

    if (artistError || !artistData) {
      setLoading(false);
      return;
    }

    const artistRecord = artistData as Artist;
    setArtist(artistRecord);

    const { data: releasesData } = await supabase
      .from('releases')
      .select('id, title, cover_url, release_date, release_type, artist')
      .eq('artist', artistRecord.name)
      .order('release_date', { ascending: false })
      .limit(50);

    if (releasesData) {
      setReleases(releasesData as Release[]);
    }

    setLoading(false);
  }, [id]);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  const initialLetter = artist?.name?.[0]?.toUpperCase() ?? '?';

  function renderHeader() {
    return (
      <View style={styles.artistHeader}>
        {artist?.cover_url ? (
          <Image
            source={{ uri: artist.cover_url }}
            style={styles.artistImage}
            contentFit="cover"
            transition={300}
          />
        ) : (
          <View style={[styles.artistImage, styles.artistImageFallback]}>
            <Text style={styles.artistInitial}>{initialLetter}</Text>
          </View>
        )}
        <Text style={styles.artistName}>{artist?.name ?? ''}</Text>
        {artist?.genres && artist.genres.length > 0 && (
          <Text style={styles.artistGenres}>{artist.genres.join(', ')}</Text>
        )}
        <Text style={styles.discographyTitle}>Discography</Text>
      </View>
    );
  }

  if (loading) {
    return (
      <SafeAreaView style={styles.loadingContainer} edges={['top']}>
        <View style={styles.headerBar}>
          <Pressable style={styles.backBtn} onPress={() => router.back()}>
            <Ionicons name="chevron-back-outline" size={22} color="#1A1A18" />
          </Pressable>
        </View>
        <ActivityIndicator size="large" color="#D97706" />
      </SafeAreaView>
    );
  }

  if (!artist) {
    return (
      <SafeAreaView style={styles.loadingContainer} edges={['top']}>
        <View style={styles.headerBar}>
          <Pressable style={styles.backBtn} onPress={() => router.back()}>
            <Ionicons name="chevron-back-outline" size={22} color="#1A1A18" />
          </Pressable>
        </View>
        <Text style={styles.errorText}>Artist not found.</Text>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.container} edges={['top']}>
      <View style={styles.headerBar}>
        <Pressable style={styles.backBtn} onPress={() => router.back()}>
          <Ionicons name="chevron-back-outline" size={22} color="#1A1A18" />
        </Pressable>
      </View>

      <FlatList
        data={releases}
        keyExtractor={(item) => item.id}
        numColumns={2}
        columnWrapperStyle={styles.row}
        contentContainerStyle={styles.listContent}
        ListHeaderComponent={renderHeader}
        renderItem={({ item }) => (
          <AlbumCard item={item} onPress={() => router.push(`/album/${item.id}`)} />
        )}
        showsVerticalScrollIndicator={false}
        ListEmptyComponent={
          <View style={styles.emptyState}>
            <Text style={styles.emptyText}>No releases found.</Text>
          </View>
        }
      />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
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
  headerBar: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingVertical: 8,
    borderBottomWidth: 1,
    borderBottomColor: '#E8E8E6',
    backgroundColor: '#F8F8F6',
  },
  backBtn: {
    width: 36,
    height: 36,
    borderRadius: 18,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#FFFFFF',
    borderWidth: 1,
    borderColor: '#E8E8E6',
  },
  artistHeader: {
    alignItems: 'center',
    paddingTop: 28,
    paddingBottom: 24,
    paddingHorizontal: CARD_PADDING,
  },
  artistImage: {
    width: 110,
    height: 110,
    borderRadius: 55,
    backgroundColor: '#E8E8E6',
    marginBottom: 16,
  },
  artistImageFallback: {
    backgroundColor: '#FEF3DC',
    alignItems: 'center',
    justifyContent: 'center',
  },
  artistInitial: {
    fontSize: 44,
    fontWeight: '800',
    color: '#D97706',
  },
  artistName: {
    fontSize: 26,
    fontWeight: '800',
    color: '#1A1A18',
    letterSpacing: -0.5,
    textAlign: 'center',
    marginBottom: 6,
  },
  artistGenres: {
    fontSize: 14,
    color: '#8C8C8A',
    textAlign: 'center',
    marginBottom: 28,
  },
  discographyTitle: {
    fontSize: 18,
    fontWeight: '700',
    color: '#1A1A18',
    alignSelf: 'flex-start',
  },
  row: {
    gap: CARD_GAP,
    paddingHorizontal: CARD_PADDING,
  },
  listContent: {
    paddingBottom: 48,
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
    marginBottom: 4,
  },
  cardMeta: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    flexWrap: 'wrap',
  },
  cardYear: {
    fontSize: 11,
    color: '#8C8C8A',
  },
  typePill: {
    backgroundColor: '#FEF3DC',
    borderRadius: 100,
    paddingHorizontal: 7,
    paddingVertical: 2,
  },
  typePillText: {
    fontSize: 10,
    fontWeight: '600',
    color: '#D97706',
  },
  emptyState: {
    alignItems: 'center',
    paddingTop: 40,
  },
  emptyText: {
    fontSize: 15,
    color: '#8C8C8A',
  },
});
