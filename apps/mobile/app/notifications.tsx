import { useEffect, useState } from 'react';
import {
  ActivityIndicator,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { supabase } from '@/lib/supabase';
import { useAuth } from '@/context/AuthContext';

type NotificationItem = {
  id: string;
  user_id: string;
  type: string;
  title: string;
  body: string;
  read: boolean;
  link: string | null;
  created_at: string;
};

function timeAgo(dateString: string): string {
  const now = Date.now();
  const then = new Date(dateString).getTime();
  const diff = Math.floor((now - then) / 1000);
  if (diff < 60) return `${diff}s ago`;
  if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
  if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`;
  if (diff < 604800) return `${Math.floor(diff / 86400)}d ago`;
  return new Date(dateString).toLocaleDateString();
}

function notificationIcon(type: string): React.ComponentProps<typeof Ionicons>['name'] {
  switch (type) {
    case 'follow':
      return 'person-add-outline';
    case 'like':
      return 'heart-outline';
    case 'comment':
      return 'chatbubble-outline';
    case 'rating':
      return 'star-outline';
    default:
      return 'notifications-outline';
  }
}

function notificationIconColor(type: string): string {
  switch (type) {
    case 'follow':
      return '#7C3AED';
    case 'like':
      return '#DC2626';
    case 'comment':
      return '#2563EB';
    default:
      return '#D97706';
  }
}

export default function NotificationsScreen() {
  const { user } = useAuth();
  const router = useRouter();

  const [notifications, setNotifications] = useState<NotificationItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [markingRead, setMarkingRead] = useState(false);

  const hasUnread = notifications.some((n) => !n.read);

  const fetchNotifications = async () => {
    if (!user) return;
    const { data } = await supabase
      .from('notifications')
      .select('*')
      .eq('user_id', user.id)
      .order('created_at', { ascending: false })
      .limit(50);
    if (data) setNotifications(data as NotificationItem[]);
  };

  useEffect(() => {
    if (!user) { setLoading(false); return; }
    fetchNotifications().finally(() => setLoading(false));
  }, [user]);

  const handleMarkAllRead = async () => {
    if (!user || markingRead) return;
    setMarkingRead(true);
    await supabase
      .from('notifications')
      .update({ read: true })
      .eq('user_id', user.id)
      .eq('read', false);
    setNotifications((prev) => prev.map((n) => ({ ...n, read: true })));
    setMarkingRead(false);
  };

  if (!user) {
    return (
      <SafeAreaView style={styles.container} edges={['top']}>
        <View style={styles.navHeader}>
          <Pressable style={styles.backBtn} onPress={() => router.back()}>
            <Ionicons name="chevron-back" size={24} color="#1A1A18" />
          </Pressable>
          <Text style={styles.navTitle}>Notifications</Text>
          <View style={styles.navRight} />
        </View>
        <View style={styles.prompt}>
          <Ionicons name="notifications-outline" size={48} color="#E8E8E6" />
          <Text style={styles.promptTitle}>Sign in to see notifications</Text>
          <Pressable
            style={({ pressed }) => [styles.signInBtn, pressed && { opacity: 0.8 }]}
            onPress={() => router.push('/(auth)/login')}
          >
            <Text style={styles.signInBtnText}>Sign In</Text>
          </Pressable>
        </View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.container} edges={['top']}>
      <View style={styles.navHeader}>
        <Pressable style={styles.backBtn} onPress={() => router.back()}>
          <Ionicons name="chevron-back" size={24} color="#1A1A18" />
        </Pressable>
        <Text style={styles.navTitle}>Notifications</Text>
        <Pressable
          style={[styles.markReadBtn, (!hasUnread || markingRead) && { opacity: 0.35 }]}
          onPress={handleMarkAllRead}
          disabled={!hasUnread || markingRead}
        >
          <Text style={styles.markReadText}>Mark all read</Text>
        </Pressable>
      </View>

      {loading ? (
        <ActivityIndicator size="large" color="#D97706" style={{ marginTop: 60 }} />
      ) : notifications.length === 0 ? (
        <View style={styles.empty}>
          <Ionicons name="notifications-outline" size={48} color="#E8E8E6" />
          <Text style={styles.emptyText}>No notifications yet</Text>
        </View>
      ) : (
        <ScrollView showsVerticalScrollIndicator={false}>
          {notifications.map((item) => (
            <Pressable
              key={item.id}
              style={({ pressed }) => [
                styles.notifRow,
                item.read ? styles.notifRead : styles.notifUnread,
                pressed && { opacity: 0.75 },
              ]}
              onPress={() => {
                if (item.link) router.push(item.link as any);
              }}
            >
              <View style={styles.notifIconWrap}>
                <Ionicons
                  name={notificationIcon(item.type)}
                  size={20}
                  color={notificationIconColor(item.type)}
                />
              </View>
              <View style={styles.notifContent}>
                <Text style={styles.notifTitle}>{item.title}</Text>
                <Text style={styles.notifBody} numberOfLines={2}>{item.body}</Text>
                <Text style={styles.notifTime}>{timeAgo(item.created_at)}</Text>
              </View>
              {!item.read && <View style={styles.unreadDot} />}
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
  markReadBtn: {
    paddingHorizontal: 8,
    paddingVertical: 4,
  },
  markReadText: {
    fontSize: 13,
    fontWeight: '500',
    color: '#D97706',
  },
  prompt: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 16,
    paddingHorizontal: 40,
  },
  promptTitle: {
    fontSize: 18,
    fontWeight: '600',
    color: '#1A1A18',
    textAlign: 'center',
  },
  signInBtn: {
    backgroundColor: '#D97706',
    borderRadius: 12,
    paddingVertical: 13,
    paddingHorizontal: 40,
  },
  signInBtnText: {
    fontSize: 15,
    fontWeight: '700',
    color: '#FFFFFF',
  },
  empty: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 12,
  },
  emptyText: {
    fontSize: 15,
    color: '#8C8C8A',
  },
  notifRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    paddingHorizontal: 20,
    paddingVertical: 14,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: '#E8E8E6',
    borderLeftWidth: 4,
    borderLeftColor: 'transparent',
  },
  notifRead: {
    backgroundColor: '#F8F8F6',
    borderLeftColor: 'transparent',
  },
  notifUnread: {
    backgroundColor: '#FFFFFF',
    borderLeftColor: '#D97706',
  },
  notifIconWrap: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: '#F8F8F6',
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: 12,
    flexShrink: 0,
  },
  notifContent: {
    flex: 1,
  },
  notifTitle: {
    fontSize: 14,
    fontWeight: '700',
    color: '#1A1A18',
    marginBottom: 2,
  },
  notifBody: {
    fontSize: 13,
    color: '#8C8C8A',
    lineHeight: 18,
    marginBottom: 4,
  },
  notifTime: {
    fontSize: 11,
    color: '#8C8C8A',
  },
  unreadDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: '#D97706',
    marginTop: 4,
    marginLeft: 8,
    flexShrink: 0,
  },
});
