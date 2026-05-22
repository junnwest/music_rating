import { useCallback, useEffect, useState } from 'react';
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
import { useAuth } from '@/context/AuthContext';

type ProfileRow = {
  id: string;
  username: string;
  display_name: string | null;
  avatar_url: string | null;
};

type FollowingEntry = {
  following_id: string;
  profile: ProfileRow | null;
};

type FollowerEntry = {
  follower_id: string;
  profile: ProfileRow | null;
  isFollowingBack: boolean;
};

type Tab = 'following' | 'followers';

function AvatarCircle({
  username,
  avatarUrl,
}: {
  username: string;
  avatarUrl: string | null;
}) {
  if (avatarUrl) {
    return (
      <Image
        source={{ uri: avatarUrl }}
        style={styles.avatar}
        contentFit="cover"
        transition={150}
      />
    );
  }
  return (
    <View style={[styles.avatar, styles.avatarFallback]}>
      <Text style={styles.avatarLetter}>{username.charAt(0).toUpperCase()}</Text>
    </View>
  );
}

function FollowingRow({
  entry,
  onUnfollow,
}: {
  entry: FollowingEntry;
  onUnfollow: (id: string) => void;
}) {
  const router = useRouter();
  const profile = entry.profile;
  if (!profile) return null;
  const username = profile.username;
  const displayName = profile.display_name ?? username;

  return (
    <Pressable
      style={({ pressed }) => [styles.row, pressed && styles.rowPressed]}
      onPress={() => router.push('/profile/' + username)}
    >
      <AvatarCircle username={username} avatarUrl={profile.avatar_url} />
      <View style={styles.rowInfo}>
        <Text style={styles.rowDisplayName} numberOfLines={1}>{displayName}</Text>
        <Text style={styles.rowUsername} numberOfLines={1}>@{username}</Text>
      </View>
      <Pressable
        style={({ pressed }) => [styles.unfollowBtn, pressed && styles.unfollowBtnPressed]}
        onPress={(e) => {
          e.stopPropagation();
          onUnfollow(entry.following_id);
        }}
      >
        <Text style={styles.unfollowBtnText}>Unfollow</Text>
      </Pressable>
    </Pressable>
  );
}

function FollowerRow({
  entry,
  onToggleFollow,
}: {
  entry: FollowerEntry;
  onToggleFollow: (id: string, currentlyFollowing: boolean) => void;
}) {
  const router = useRouter();
  const profile = entry.profile;
  if (!profile) return null;
  const username = profile.username;
  const displayName = profile.display_name ?? username;

  return (
    <Pressable
      style={({ pressed }) => [styles.row, pressed && styles.rowPressed]}
      onPress={() => router.push('/profile/' + username)}
    >
      <AvatarCircle username={username} avatarUrl={profile.avatar_url} />
      <View style={styles.rowInfo}>
        <Text style={styles.rowDisplayName} numberOfLines={1}>{displayName}</Text>
        <Text style={styles.rowUsername} numberOfLines={1}>@{username}</Text>
      </View>
      <Pressable
        style={({ pressed }) => [
          entry.isFollowingBack ? styles.followingBtn : styles.followBackBtn,
          pressed && styles.followBtnPressed,
        ]}
        onPress={(e) => {
          e.stopPropagation();
          onToggleFollow(entry.follower_id, entry.isFollowingBack);
        }}
      >
        <Text
          style={entry.isFollowingBack ? styles.followingBtnText : styles.followBackBtnText}
        >
          {entry.isFollowingBack ? 'Following' : 'Follow back'}
        </Text>
      </Pressable>
    </Pressable>
  );
}

export default function FriendsScreen() {
  const router = useRouter();
  const { user } = useAuth();

  const [activeTab, setActiveTab] = useState<Tab>('following');
  const [following, setFollowing] = useState<FollowingEntry[]>([]);
  const [followers, setFollowers] = useState<FollowerEntry[]>([]);
  const [loading, setLoading] = useState(true);

  const loadData = useCallback(async () => {
    if (!user) return;
    setLoading(true);

    const [followingResult, followersResult] = await Promise.all([
      supabase
        .from('follows')
        .select('following_id, profiles!follows_following_id_fkey(id, username, display_name, avatar_url)')
        .eq('follower_id', user.id),
      supabase
        .from('follows')
        .select('follower_id, profiles!follows_follower_id_fkey(id, username, display_name, avatar_url)')
        .eq('following_id', user.id),
    ]);

    const followingData: FollowingEntry[] = (followingResult.data ?? []).map((row: any) => ({
      following_id: row.following_id,
      profile: row.profiles ?? null,
    }));

    const followingSet = new Set(followingData.map((f) => f.following_id));

    const followersData: FollowerEntry[] = (followersResult.data ?? []).map((row: any) => ({
      follower_id: row.follower_id,
      profile: row.profiles ?? null,
      isFollowingBack: followingSet.has(row.follower_id),
    }));

    setFollowing(followingData);
    setFollowers(followersData);
    setLoading(false);
  }, [user]);

  useEffect(() => {
    loadData();
  }, [loadData]);

  async function handleUnfollow(targetId: string) {
    if (!user) return;
    await supabase
      .from('follows')
      .delete()
      .eq('follower_id', user.id)
      .eq('following_id', targetId);
    setFollowing((prev) => prev.filter((f) => f.following_id !== targetId));
    setFollowers((prev) =>
      prev.map((f) =>
        f.follower_id === targetId ? { ...f, isFollowingBack: false } : f,
      ),
    );
  }

  async function handleToggleFollow(targetId: string, currentlyFollowing: boolean) {
    if (!user) return;
    if (currentlyFollowing) {
      await supabase
        .from('follows')
        .delete()
        .eq('follower_id', user.id)
        .eq('following_id', targetId);
      setFollowers((prev) =>
        prev.map((f) =>
          f.follower_id === targetId ? { ...f, isFollowingBack: false } : f,
        ),
      );
      setFollowing((prev) => prev.filter((f) => f.following_id !== targetId));
    } else {
      const { data: profileData } = await supabase
        .from('profiles')
        .select('id, username, display_name, avatar_url')
        .eq('id', targetId)
        .single();
      await supabase
        .from('follows')
        .insert({ follower_id: user.id, following_id: targetId });
      setFollowers((prev) =>
        prev.map((f) =>
          f.follower_id === targetId ? { ...f, isFollowingBack: true } : f,
        ),
      );
      if (profileData) {
        setFollowing((prev) => [
          ...prev,
          { following_id: targetId, profile: profileData },
        ]);
      }
    }
  }

  if (!user) {
    return (
      <SafeAreaView style={styles.safeArea} edges={['top']}>
        <View style={styles.header}>
          <Pressable style={styles.backBtn} onPress={() => router.back()}>
            <Ionicons name="arrow-back" size={22} color="#1A1A18" />
          </Pressable>
          <Text style={styles.headerTitle}>Friends</Text>
          <View style={{ width: 36 }} />
        </View>
        <View style={styles.centered}>
          <Ionicons name="person-outline" size={40} color="#8C8C8A" />
          <Text style={styles.signInText}>Sign in to see your friends</Text>
        </View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.safeArea} edges={['top']}>
      <View style={styles.header}>
        <Pressable style={styles.backBtn} onPress={() => router.back()}>
          <Ionicons name="arrow-back" size={22} color="#1A1A18" />
        </Pressable>
        <Text style={styles.headerTitle}>Friends</Text>
        <View style={{ width: 36 }} />
      </View>

      <View style={styles.tabBar}>
        <Pressable
          style={[styles.tab, activeTab === 'following' && styles.tabActive]}
          onPress={() => setActiveTab('following')}
        >
          <Text style={[styles.tabText, activeTab === 'following' && styles.tabTextActive]}>
            Following
          </Text>
          {following.length > 0 && (
            <View style={[styles.tabBadge, activeTab === 'following' && styles.tabBadgeActive]}>
              <Text style={[styles.tabBadgeText, activeTab === 'following' && styles.tabBadgeTextActive]}>
                {following.length}
              </Text>
            </View>
          )}
        </Pressable>
        <Pressable
          style={[styles.tab, activeTab === 'followers' && styles.tabActive]}
          onPress={() => setActiveTab('followers')}
        >
          <Text style={[styles.tabText, activeTab === 'followers' && styles.tabTextActive]}>
            Followers
          </Text>
          {followers.length > 0 && (
            <View style={[styles.tabBadge, activeTab === 'followers' && styles.tabBadgeActive]}>
              <Text style={[styles.tabBadgeText, activeTab === 'followers' && styles.tabBadgeTextActive]}>
                {followers.length}
              </Text>
            </View>
          )}
        </Pressable>
      </View>

      {loading ? (
        <View style={styles.centered}>
          <ActivityIndicator size="large" color="#D97706" />
        </View>
      ) : activeTab === 'following' ? (
        <FlatList
          data={following}
          keyExtractor={(item) => item.following_id}
          renderItem={({ item }) => (
            <FollowingRow entry={item} onUnfollow={handleUnfollow} />
          )}
          contentContainerStyle={styles.listContent}
          showsVerticalScrollIndicator={false}
          ItemSeparatorComponent={() => <View style={styles.separator} />}
          ListEmptyComponent={
            <View style={styles.emptyContainer}>
              <Ionicons name="people-outline" size={40} color="#8C8C8A" />
              <Text style={styles.emptyText}>You're not following anyone yet</Text>
            </View>
          }
        />
      ) : (
        <FlatList
          data={followers}
          keyExtractor={(item) => item.follower_id}
          renderItem={({ item }) => (
            <FollowerRow entry={item} onToggleFollow={handleToggleFollow} />
          )}
          contentContainerStyle={styles.listContent}
          showsVerticalScrollIndicator={false}
          ItemSeparatorComponent={() => <View style={styles.separator} />}
          ListEmptyComponent={
            <View style={styles.emptyContainer}>
              <Ionicons name="people-outline" size={40} color="#8C8C8A" />
              <Text style={styles.emptyText}>No followers yet</Text>
            </View>
          }
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
  tabBar: {
    flexDirection: 'row',
    backgroundColor: '#FFFFFF',
    borderBottomWidth: 1,
    borderBottomColor: '#E8E8E6',
  },
  tab: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 12,
    borderBottomWidth: 2,
    borderBottomColor: 'transparent',
    gap: 6,
  },
  tabActive: {
    borderBottomColor: '#D97706',
  },
  tabText: {
    fontSize: 14,
    fontWeight: '500',
    color: '#8C8C8A',
  },
  tabTextActive: {
    fontWeight: '700',
    color: '#1A1A18',
  },
  tabBadge: {
    backgroundColor: '#E8E8E6',
    borderRadius: 10,
    paddingHorizontal: 6,
    paddingVertical: 1,
  },
  tabBadgeActive: {
    backgroundColor: '#FEF3DC',
  },
  tabBadgeText: {
    fontSize: 11,
    fontWeight: '600',
    color: '#8C8C8A',
  },
  tabBadgeTextActive: {
    color: '#D97706',
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
  listContent: {
    paddingBottom: 32,
  },
  separator: {
    height: 1,
    backgroundColor: '#E8E8E6',
    marginLeft: 76,
  },
  emptyContainer: {
    alignItems: 'center',
    justifyContent: 'center',
    paddingTop: 80,
  },
  emptyText: {
    fontSize: 15,
    color: '#8C8C8A',
    marginTop: 10,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingVertical: 12,
    backgroundColor: '#FFFFFF',
  },
  rowPressed: {
    backgroundColor: '#F8F8F6',
  },
  avatar: {
    width: 46,
    height: 46,
    borderRadius: 23,
    marginRight: 12,
  },
  avatarFallback: {
    backgroundColor: '#D97706',
    alignItems: 'center',
    justifyContent: 'center',
  },
  avatarLetter: {
    fontSize: 18,
    fontWeight: '700',
    color: '#FFFFFF',
  },
  rowInfo: {
    flex: 1,
    marginRight: 10,
  },
  rowDisplayName: {
    fontSize: 15,
    fontWeight: '600',
    color: '#1A1A18',
    letterSpacing: -0.2,
  },
  rowUsername: {
    fontSize: 12,
    color: '#8C8C8A',
    marginTop: 2,
  },
  unfollowBtn: {
    borderWidth: 1,
    borderColor: '#E8E8E6',
    borderRadius: 18,
    paddingHorizontal: 14,
    paddingVertical: 6,
    backgroundColor: '#FFFFFF',
  },
  unfollowBtnPressed: {
    backgroundColor: '#F8F8F6',
  },
  unfollowBtnText: {
    fontSize: 13,
    fontWeight: '600',
    color: '#1A1A18',
  },
  followBackBtn: {
    backgroundColor: '#D97706',
    borderRadius: 18,
    paddingHorizontal: 14,
    paddingVertical: 6,
  },
  followingBtn: {
    borderWidth: 1,
    borderColor: '#D97706',
    borderRadius: 18,
    paddingHorizontal: 14,
    paddingVertical: 6,
    backgroundColor: '#FFFFFF',
  },
  followBtnPressed: {
    opacity: 0.7,
  },
  followBackBtnText: {
    fontSize: 13,
    fontWeight: '600',
    color: '#FFFFFF',
  },
  followingBtnText: {
    fontSize: 13,
    fontWeight: '600',
    color: '#D97706',
  },
});
