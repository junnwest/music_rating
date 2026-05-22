import { useCallback, useEffect, useState } from 'react';
import {
  ActivityIndicator,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Image } from 'expo-image';
import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { supabase } from '@/lib/supabase';

const STORAGE_KEY = 'sj:listen-later';

type Release = {
  id: string;
  title: string;
  artist: string;
  cover_url: string | null;
  release_date: string | null;
  release_type: string | null;
};

async function loadSavedIds(): Promise<string[]> {
  try {
    const raw = await AsyncStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    return JSON.parse(raw) as string[];
  } catch {
    return [];
  }
}

async function saveIds(ids: string[]): Promise<void> {
  await AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(ids));
}

export default function ListenLaterScreen() {
  const router = useRouter();
  const [releases, setReleases] = useState<Release[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  const loadData = useCallback(async () => {
    const ids = await loadSavedIds();
    if (ids.length === 0) {
      setReleases([]);
      return;
    }
    const { data } = await supabase
      .from('releases')
      .select('id, title, artist, cover_url, release_date, release_type')
      .in('id', ids);

    if (data) {
      // Preserve the order from AsyncStorage
      const ordered = ids
        .map((id) => (data as Release[]).find((r) => r.id === id))
        .filter(Boolean) as Release[];
      setReleases(ordered);
    }
  }, []);

  useEffect(() => {
    setLoading(true);
    loadData().finally(() => setLoading(false));
  }, [loadData]);

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    await loadData();
    setRefreshing(false);
  }, [loadData]);

  const handleRemove = async (id: string) => {
    const ids = await loadSavedIds();
    const updated = ids.filter((i) => i !== id);
    await saveIds(updated);
    setReleases((prev) => prev.filter((r) => r.id !== id));
  };

  return (
    <SafeAreaView style={styles.container} edges={['top']}>
      <View style={styles.navHeader}>
        <Pressable style={styles.backBtn} onPress={() => router.back()}>
          <Ionicons name="chevron-back" size={24} color="#1A1A18" />
        </Pressable>
        <Text style={styles.navTitle}>Listen Later</Text>
        <View style={styles.navRight} />
      </View>

      {loading ? (
        <ActivityIndicator size="large" color="#D97706" style={{ marginTop: 60 }} />
      ) : releases.length === 0 ? (
        <View style={styles.empty}>
          <Ionicons name="bookmark-outline" size={48} color="#E8E8E6" />
          <Text style={styles.emptyTitle}>No albums saved yet</Text>
          <Text style={styles.emptySub}>Bookmark albums to revisit them later.</Text>
        </View>
      ) : (
        <ScrollView
          showsVerticalScrollIndicator={false}
          refreshControl={
            <RefreshControl
              refreshing={refreshing}
              onRefresh={onRefresh}
              tintColor="#D97706"
            />
          }
        >
          {releases.map((release) => (
            <Pressable
              key={release.id}
              style={({ pressed }) => [styles.row, pressed && { backgroundColor: '#F0F0EE' }]}
              onPress={() => router.push(`/album/${release.id}`)}
            >
              <Image
                source={{ uri: release.cover_url ?? undefined }}
                style={styles.cover}
                contentFit="cover"
                transition={150}
              />
              <View style={styles.info}>
                <Text style={styles.title} numberOfLines={1}>{release.title}</Text>
                <Text style={styles.artist} numberOfLines={1}>{release.artist}</Text>
                {release.release_type ? (
                  <Text style={styles.type}>{release.release_type}</Text>
                ) : null}
              </View>
              <Pressable
                style={({ pressed }) => [styles.removeBtn, pressed && { opacity: 0.6 }]}
                onPress={() => handleRemove(release.id)}
                hitSlop={8}
              >
                <Ionicons name="trash-outline" size={20} color="#8C8C8A" />
              </Pressable>
            </Pressable>
          ))}
          <View style={{ height: 32 }} />
        </ScrollView>
      )}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#F8F8F6',
  },
  navHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 8,
    paddingVertical: 10,
    borderBottomWidth: 1,
    borderBottomColor: '#E8E8E6',
    backgroundColor: '#F8F8F6',
  },
  backBtn: {
    padding: 6,
    width: 40,
  },
  navTitle: {
    fontSize: 16,
    fontWeight: '600',
    color: '#1A1A18',
    letterSpacing: -0.3,
  },
  navRight: {
    width: 40,
  },
  empty: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 10,
    paddingHorizontal: 40,
  },
  emptyTitle: {
    fontSize: 17,
    fontWeight: '600',
    color: '#1A1A18',
    textAlign: 'center',
  },
  emptySub: {
    fontSize: 14,
    color: '#8C8C8A',
    textAlign: 'center',
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#FFFFFF',
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: '#E8E8E6',
  },
  cover: {
    width: 56,
    height: 56,
    borderRadius: 4,
    backgroundColor: '#E8E8E6',
    flexShrink: 0,
  },
  info: {
    flex: 1,
    marginHorizontal: 12,
  },
  title: {
    fontSize: 15,
    fontWeight: '600',
    color: '#1A1A18',
    letterSpacing: -0.2,
    marginBottom: 2,
  },
  artist: {
    fontSize: 13,
    color: '#8C8C8A',
    marginBottom: 2,
  },
  type: {
    fontSize: 11,
    color: '#8C8C8A',
    textTransform: 'capitalize',
  },
  removeBtn: {
    padding: 6,
    flexShrink: 0,
  },
});
