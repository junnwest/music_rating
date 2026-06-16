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
import { useRouter } from 'expo-router';
import { supabase } from '@/lib/supabase';
import { useLanguage } from '@/lib/i18n';
import { ScreenHeader } from '@/components/ScreenHeader';

type ReleaseRow = {
  id: string;
  cover_url: string | null;
};

type Category = {
  id: string;
  slug: string;
  title: string;
  description: string | null;
  genre: string | null;
  year: number | null;
  topCovers: (string | null)[];
  rankerCount: number;
};

async function fetchCategories(): Promise<Category[]> {
  const [catResult, seedResult] = await Promise.all([
    supabase
      .from('ranking_categories')
      .select('id, slug, title, description, genre, year')
      .order('sort_order', { ascending: true, nullsFirst: false })
      .order('created_at', { ascending: true }),
    supabase
      .from('ranking_seed_entries')
      .select('category_id, release_id, seed_votes'),
  ]);

  const categories: { id: string; slug: string; title: string; description: string | null; genre: string | null; year: number | null }[] =
    catResult.data ?? [];
  const seedEntries: { category_id: string; release_id: string; seed_votes: number }[] =
    seedResult.data ?? [];

  const seedByCategory = new Map<string, { release_id: string; seed_votes: number }[]>();
  for (const entry of seedEntries) {
    const arr = seedByCategory.get(entry.category_id) ?? [];
    arr.push({ release_id: entry.release_id, seed_votes: entry.seed_votes });
    seedByCategory.set(entry.category_id, arr);
  }

  const allTop5Ids = new Set<string>();
  const top5ByCategory = new Map<string, string[]>();

  for (const cat of categories) {
    const entries = seedByCategory.get(cat.id) ?? [];
    const sorted = [...entries].sort((a, b) => b.seed_votes - a.seed_votes).slice(0, 5);
    const ids = sorted.map((e) => e.release_id);
    top5ByCategory.set(cat.id, ids);
    ids.forEach((id) => allTop5Ids.add(id));
  }

  let coverMap = new Map<string, string | null>();
  if (allTop5Ids.size > 0) {
    const { data: releases } = await supabase
      .from('releases')
      .select('id, cover_url')
      .in('id', Array.from(allTop5Ids));
    for (const r of (releases as ReleaseRow[]) ?? []) {
      coverMap.set(r.id, r.cover_url);
    }
  }

  const rankerCountByCategory = new Map<string, number>();
  const uniqueCategoryIds = categories.map((c) => c.id);
  if (uniqueCategoryIds.length > 0) {
    const { data: userRankings } = await supabase
      .from('user_rankings')
      .select('category_id')
      .in('category_id', uniqueCategoryIds);
    for (const ur of userRankings ?? []) {
      rankerCountByCategory.set(
        ur.category_id,
        (rankerCountByCategory.get(ur.category_id) ?? 0) + 1,
      );
    }
  }

  return categories.map((cat) => {
    const ids = top5ByCategory.get(cat.id) ?? [];
    const topCovers = ids.map((id) => coverMap.get(id) ?? null);
    return {
      ...cat,
      topCovers,
      rankerCount: rankerCountByCategory.get(cat.id) ?? 0,
    };
  });
}

function CoverStrip({ covers }: { covers: (string | null)[] }) {
  const displayed = covers.slice(0, 4);
  return (
    <View style={styles.coverStrip}>
      {displayed.map((uri, idx) => (
        <View
          key={idx}
          style={[
            styles.coverThumbWrapper,
            { marginLeft: idx === 0 ? 0 : -8, zIndex: displayed.length - idx },
          ]}
        >
          <Image
            source={uri ? { uri } : undefined}
            style={styles.coverThumb}
            contentFit="cover"
            transition={150}
          />
        </View>
      ))}
      {displayed.length === 0 && (
        <View style={[styles.coverThumb, styles.coverThumbPlaceholder]}>
          <Ionicons name="musical-notes-outline" size={18} color="#8C8C8A" />
        </View>
      )}
    </View>
  );
}

function CategoryCard({ category, onPress }: { category: Category; onPress: () => void }) {
  const { t } = useLanguage();
  const subtitle = category.description ?? (category.genre ? category.genre : null);

  return (
    <Pressable
      style={({ pressed }) => [styles.card, pressed && styles.cardPressed]}
      onPress={onPress}
    >
      <CoverStrip covers={category.topCovers} />
      <View style={styles.cardBody}>
        <Text style={styles.cardTitle} numberOfLines={1}>
          {category.title}
        </Text>
        {subtitle ? (
          <Text style={styles.cardSubtitle} numberOfLines={1}>
            {subtitle}
          </Text>
        ) : null}
        {category.rankerCount > 0 && (
          <Text style={styles.cardMeta}>{category.rankerCount} {t(category.rankerCount === 1 ? 'rankings.ranker' : 'rankings.rankers')}</Text>
        )}
      </View>
      <Ionicons name="chevron-forward" size={18} color="#8C8C8A" />
    </Pressable>
  );
}

export default function RankingsScreen() {
  const router = useRouter();
  const { t } = useLanguage();
  const [categories, setCategories] = useState<Category[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetchCategories()
      .then(setCategories)
      .finally(() => setLoading(false));
  }, []);

  return (
    <SafeAreaView style={styles.safeArea} edges={['top']}>
      <ScreenHeader title={t('rankings.title')} />
      {loading ? (
        <View style={styles.centered}>
          <ActivityIndicator size="large" color="#D97706" />
        </View>
      ) : categories.length === 0 ? (
        <View style={styles.centered}>
          <Ionicons name="trophy-outline" size={40} color="#8C8C8A" />
          <Text style={styles.emptyText}>{t('rankings.empty')}</Text>
        </View>
      ) : (
        <FlatList
          data={categories}
          keyExtractor={(item) => item.id}
          renderItem={({ item }) => (
            <CategoryCard
              category={item}
              onPress={() => router.push('/rankings/' + item.slug)}
            />
          )}
          contentContainerStyle={styles.listContent}
          showsVerticalScrollIndicator={false}
          ItemSeparatorComponent={() => <View style={styles.separator} />}
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
  centered: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  emptyText: {
    fontSize: 15,
    color: '#8C8C8A',
    marginTop: 10,
  },
  listContent: {
    paddingVertical: 8,
  },
  separator: {
    height: 1,
    backgroundColor: '#E8E8E6',
    marginLeft: 20,
  },
  card: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 20,
    paddingVertical: 14,
    backgroundColor: '#FFFFFF',
  },
  cardPressed: {
    backgroundColor: '#F8F8F6',
  },
  coverStrip: {
    flexDirection: 'row',
    alignItems: 'center',
    width: 44 + 3 * (44 - 8),
    marginRight: 14,
  },
  coverThumbWrapper: {
    borderRadius: 5,
    borderWidth: 1.5,
    borderColor: '#FFFFFF',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.08,
    shadowRadius: 2,
    elevation: 2,
  },
  coverThumb: {
    width: 44,
    height: 44,
    borderRadius: 4,
    backgroundColor: '#E8E8E6',
  },
  coverThumbPlaceholder: {
    alignItems: 'center',
    justifyContent: 'center',
  },
  cardBody: {
    flex: 1,
    marginRight: 8,
  },
  cardTitle: {
    fontSize: 15,
    fontWeight: '700',
    color: '#1A1A18',
    letterSpacing: -0.2,
  },
  cardSubtitle: {
    fontSize: 12,
    color: '#8C8C8A',
    marginTop: 2,
  },
  cardMeta: {
    fontSize: 11,
    color: '#D97706',
    marginTop: 3,
    fontWeight: '500',
  },
});
