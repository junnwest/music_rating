import { useEffect, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Linking,
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Switch,
  Text,
  TextInput,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { supabase } from '@/lib/supabase';
import { useAuth } from '@/context/AuthContext';

const DARK_MODE_KEY = 'sj:dark-mode';

type WebModalData = { visible: boolean; url: string; title: string };

export default function SettingsScreen() {
  const router = useRouter();
  const { user, signOut } = useAuth();

  const [darkMode, setDarkMode] = useState(false);
  const [signingOut, setSigningOut] = useState(false);
  const [webModal, setWebModal] = useState<WebModalData>({ visible: false, url: '', title: '' });

  // Edit profile state
  const [editVisible, setEditVisible] = useState(false);
  const [username, setUsername] = useState('');
  const [displayName, setDisplayName] = useState('');
  const [bio, setBio] = useState('');
  const [editLoading, setEditLoading] = useState(false);
  const [editMessage, setEditMessage] = useState<string | null>(null);

  // Change password state
  const [pwVisible, setPwVisible] = useState(false);
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [pwLoading, setPwLoading] = useState(false);
  const [pwMessage, setPwMessage] = useState<{ text: string; isError: boolean } | null>(null);

  useEffect(() => {
    AsyncStorage.getItem(DARK_MODE_KEY).then((val) => {
      if (val === 'true') setDarkMode(true);
    }).catch(() => {});
    if (user) {
      supabase
        .from('profiles')
        .select('username, display_name, bio')
        .eq('id', user.id)
        .single()
        .then(({ data }) => {
          if (data) {
            setUsername(data.username ?? '');
            setDisplayName(data.display_name ?? '');
            setBio(data.bio ?? '');
          }
        });
    }
  }, [user]);

  const handleDarkModeToggle = async (value: boolean) => {
    setDarkMode(value);
    await AsyncStorage.setItem(DARK_MODE_KEY, value ? 'true' : 'false');
  };

  const handleSignOut = () => {
    Alert.alert('Sign Out', 'Are you sure you want to sign out?', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Sign Out',
        style: 'destructive',
        onPress: async () => {
          setSigningOut(true);
          await signOut();
          router.replace('/(auth)/login');
        },
      },
    ]);
  };

  const handleSaveProfile = async () => {
    if (!user) return;
    const trimmedUsername = username.trim().toLowerCase();
    if (!trimmedUsername) {
      setEditMessage('Username is required.');
      return;
    }
    if (!/^[a-z0-9_]{3,20}$/.test(trimmedUsername)) {
      setEditMessage('Username: 3–20 chars, letters/numbers/underscores only.');
      return;
    }
    setEditLoading(true);
    setEditMessage(null);

    // Check username uniqueness (skip if unchanged)
    const currentRes = await supabase.from('profiles').select('username').eq('id', user.id).single();
    if (currentRes.data?.username !== trimmedUsername) {
      const { data: existing } = await supabase.from('profiles').select('id').eq('username', trimmedUsername).maybeSingle();
      if (existing) {
        setEditLoading(false);
        setEditMessage('That username is already taken.');
        return;
      }
    }

    const { error } = await supabase
      .from('profiles')
      .update({ username: trimmedUsername, display_name: displayName.trim() || null, bio: bio.trim() || null })
      .eq('id', user.id);
    setEditLoading(false);
    if (error) {
      setEditMessage('Failed to save. Please try again.');
    } else {
      setEditMessage('Profile updated.');
      setTimeout(() => {
        setEditVisible(false);
        setEditMessage(null);
      }, 800);
    }
  };

  const handleChangePassword = async () => {
    if (!newPassword || newPassword !== confirmPassword) {
      setPwMessage({ text: 'Passwords do not match.', isError: true });
      return;
    }
    if (newPassword.length < 6) {
      setPwMessage({ text: 'Password must be at least 6 characters.', isError: true });
      return;
    }
    setPwLoading(true);
    setPwMessage(null);
    const { error } = await supabase.auth.updateUser({ password: newPassword });
    setPwLoading(false);
    if (error) {
      setPwMessage({ text: error.message, isError: true });
    } else {
      setPwMessage({ text: 'Password updated.', isError: false });
      setNewPassword('');
      setConfirmPassword('');
      setTimeout(() => {
        setPwVisible(false);
        setPwMessage(null);
      }, 800);
    }
  };

  const openUrl = (url: string, title: string) => {
    Linking.canOpenURL(url).then((can) => {
      if (can) {
        Linking.openURL(url);
      } else {
        setWebModal({ visible: true, url, title });
      }
    });
  };

  return (
    <SafeAreaView style={styles.container} edges={['top']}>
      <View style={styles.navHeader}>
        <Pressable style={styles.backBtn} onPress={() => router.back()}>
          <Ionicons name="chevron-back" size={24} color="#1A1A18" />
        </Pressable>
        <Text style={styles.navTitle}>Settings</Text>
        <View style={styles.navRight} />
      </View>

      <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={{ paddingBottom: 48 }}>
        <SectionHeader title="Account" />

        <SettingsRow
          icon="person-outline"
          label="Edit Profile"
          onPress={() => setEditVisible(true)}
          showArrow
        />
        <SettingsRow
          icon="lock-closed-outline"
          label="Change Password"
          onPress={() => setPwVisible(true)}
          showArrow
        />

        <SectionHeader title="App" />

        <View style={styles.row}>
          <View style={styles.rowLeft}>
            <Ionicons name="moon-outline" size={20} color="#1A1A18" style={styles.rowIcon} />
            <Text style={styles.rowLabel}>Dark Mode</Text>
          </View>
          <Switch
            value={darkMode}
            onValueChange={handleDarkModeToggle}
            trackColor={{ false: '#E8E8E6', true: '#D97706' }}
            thumbColor="#FFFFFF"
          />
        </View>

        <SectionHeader title="About" />

        <SettingsRow
          icon="shield-checkmark-outline"
          label="Privacy Policy"
          onPress={() => openUrl('https://sillajuku.com/privacy', 'Privacy Policy')}
          showArrow
        />
        <SettingsRow
          icon="document-text-outline"
          label="Terms of Service"
          onPress={() => openUrl('https://sillajuku.com/terms', 'Terms of Service')}
          showArrow
        />

        <SectionHeader title="Danger Zone" />

        <Pressable
          style={({ pressed }) => [styles.row, styles.signOutRow, pressed && { opacity: 0.7 }]}
          onPress={handleSignOut}
          disabled={signingOut}
        >
          {signingOut ? (
            <ActivityIndicator size="small" color="#DC2626" />
          ) : (
            <>
              <Ionicons name="log-out-outline" size={20} color="#DC2626" style={styles.rowIcon} />
              <Text style={styles.signOutLabel}>Sign Out</Text>
            </>
          )}
        </Pressable>
      </ScrollView>

      {/* Edit Profile Modal */}
      <Modal visible={editVisible} animationType="slide" presentationStyle="pageSheet">
        <SafeAreaView style={styles.modalContainer} edges={['top']}>
          <View style={styles.modalHeader}>
            <Pressable onPress={() => { setEditVisible(false); setEditMessage(null); }}>
              <Text style={styles.modalCancel}>Cancel</Text>
            </Pressable>
            <Text style={styles.modalTitle}>Edit Profile</Text>
            <Pressable onPress={handleSaveProfile} disabled={editLoading}>
              {editLoading ? (
                <ActivityIndicator size="small" color="#D97706" />
              ) : (
                <Text style={styles.modalSave}>Save</Text>
              )}
            </Pressable>
          </View>
          <View style={styles.modalBody}>
            <Text style={styles.fieldLabel}>Username</Text>
            <TextInput
              style={styles.textInput}
              value={username}
              onChangeText={setUsername}
              placeholder="username"
              placeholderTextColor="#8C8C8A"
              autoCapitalize="none"
              autoCorrect={false}
            />
            <Text style={styles.fieldHint}>3–20 chars · letters, numbers, underscores</Text>
            <Text style={[styles.fieldLabel, { marginTop: 16 }]}>Display Name</Text>
            <TextInput
              style={styles.textInput}
              value={displayName}
              onChangeText={setDisplayName}
              placeholder="Your name"
              placeholderTextColor="#8C8C8A"
              autoCorrect={false}
            />
            <Text style={[styles.fieldLabel, { marginTop: 16 }]}>Bio</Text>
            <TextInput
              style={[styles.textInput, styles.textArea]}
              value={bio}
              onChangeText={setBio}
              placeholder="A little about you"
              placeholderTextColor="#8C8C8A"
              multiline
              numberOfLines={4}
              autoCorrect={false}
            />
            {editMessage ? (
              <Text style={[styles.message, { color: editMessage === 'Profile updated.' ? '#16A34A' : '#DC2626' }]}>
                {editMessage}
              </Text>
            ) : null}
          </View>
        </SafeAreaView>
      </Modal>

      {/* Change Password Modal */}
      <Modal visible={pwVisible} animationType="slide" presentationStyle="pageSheet">
        <SafeAreaView style={styles.modalContainer} edges={['top']}>
          <View style={styles.modalHeader}>
            <Pressable onPress={() => { setPwVisible(false); setPwMessage(null); setNewPassword(''); setConfirmPassword(''); }}>
              <Text style={styles.modalCancel}>Cancel</Text>
            </Pressable>
            <Text style={styles.modalTitle}>Change Password</Text>
            <Pressable onPress={handleChangePassword} disabled={pwLoading}>
              {pwLoading ? (
                <ActivityIndicator size="small" color="#D97706" />
              ) : (
                <Text style={styles.modalSave}>Save</Text>
              )}
            </Pressable>
          </View>
          <View style={styles.modalBody}>
            <Text style={styles.fieldLabel}>New Password</Text>
            <TextInput
              style={styles.textInput}
              value={newPassword}
              onChangeText={setNewPassword}
              placeholder="New password"
              placeholderTextColor="#8C8C8A"
              secureTextEntry
              autoCapitalize="none"
              autoCorrect={false}
            />
            <Text style={[styles.fieldLabel, { marginTop: 16 }]}>Confirm Password</Text>
            <TextInput
              style={styles.textInput}
              value={confirmPassword}
              onChangeText={setConfirmPassword}
              placeholder="Confirm new password"
              placeholderTextColor="#8C8C8A"
              secureTextEntry
              autoCapitalize="none"
              autoCorrect={false}
            />
            {pwMessage ? (
              <Text style={[styles.message, { color: pwMessage.isError ? '#DC2626' : '#16A34A' }]}>
                {pwMessage.text}
              </Text>
            ) : null}
          </View>
        </SafeAreaView>
      </Modal>

      {/* Web modal fallback */}
      <Modal visible={webModal.visible} animationType="slide" presentationStyle="pageSheet">
        <SafeAreaView style={styles.modalContainer} edges={['top']}>
          <View style={styles.modalHeader}>
            <Pressable onPress={() => setWebModal({ visible: false, url: '', title: '' })}>
              <Text style={styles.modalCancel}>Close</Text>
            </Pressable>
            <Text style={styles.modalTitle}>{webModal.title}</Text>
            <View style={{ width: 48 }} />
          </View>
          <View style={styles.modalBody}>
            <Text style={{ fontSize: 14, color: '#8C8C8A', textAlign: 'center', marginTop: 40 }}>
              {webModal.url}
            </Text>
          </View>
        </SafeAreaView>
      </Modal>
    </SafeAreaView>
  );
}

function SectionHeader({ title }: { title: string }) {
  return (
    <View style={styles.sectionHeader}>
      <Text style={styles.sectionTitle}>{title}</Text>
    </View>
  );
}

function SettingsRow({
  icon,
  label,
  onPress,
  showArrow,
}: {
  icon: React.ComponentProps<typeof Ionicons>['name'];
  label: string;
  onPress: () => void;
  showArrow?: boolean;
}) {
  return (
    <Pressable
      style={({ pressed }) => [styles.row, pressed && { backgroundColor: '#F0F0EE' }]}
      onPress={onPress}
    >
      <View style={styles.rowLeft}>
        <Ionicons name={icon} size={20} color="#1A1A18" style={styles.rowIcon} />
        <Text style={styles.rowLabel}>{label}</Text>
      </View>
      {showArrow && <Ionicons name="chevron-forward" size={18} color="#8C8C8A" />}
    </Pressable>
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
  sectionHeader: {
    paddingHorizontal: 20,
    paddingTop: 24,
    paddingBottom: 6,
  },
  sectionTitle: {
    fontSize: 12,
    fontWeight: '600',
    color: '#8C8C8A',
    textTransform: 'uppercase',
    letterSpacing: 0.8,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    backgroundColor: '#FFFFFF',
    paddingHorizontal: 20,
    paddingVertical: 14,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: '#E8E8E6',
  },
  rowLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    flex: 1,
  },
  rowIcon: {
    marginRight: 14,
  },
  rowLabel: {
    fontSize: 15,
    color: '#1A1A18',
  },
  signOutRow: {
    borderBottomWidth: 0,
  },
  signOutLabel: {
    fontSize: 15,
    color: '#DC2626',
    fontWeight: '500',
  },
  modalContainer: {
    flex: 1,
    backgroundColor: '#F8F8F6',
  },
  modalHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 20,
    paddingVertical: 14,
    borderBottomWidth: 1,
    borderBottomColor: '#E8E8E6',
    backgroundColor: '#F8F8F6',
  },
  modalTitle: {
    fontSize: 16,
    fontWeight: '600',
    color: '#1A1A18',
  },
  modalCancel: {
    fontSize: 15,
    color: '#8C8C8A',
  },
  modalSave: {
    fontSize: 15,
    fontWeight: '600',
    color: '#D97706',
  },
  modalBody: {
    padding: 20,
  },
  fieldLabel: {
    fontSize: 13,
    fontWeight: '500',
    color: '#8C8C8A',
    marginBottom: 8,
  },
  textInput: {
    backgroundColor: '#FFFFFF',
    borderWidth: 1,
    borderColor: '#E8E8E6',
    borderRadius: 10,
    paddingHorizontal: 14,
    paddingVertical: 12,
    fontSize: 15,
    color: '#1A1A18',
  },
  textArea: {
    minHeight: 96,
    textAlignVertical: 'top',
    paddingTop: 12,
  },
  fieldHint: {
    fontSize: 11,
    color: '#8C8C8A',
    marginTop: 4,
  },
  message: {
    marginTop: 12,
    fontSize: 13,
    textAlign: 'center',
  },
});
