import { useState } from 'react';
import {
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  Text,
  TextInput,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { supabase } from '@/lib/supabase';
import { useAuth } from '@/context/AuthContext';

export default function OnboardingScreen() {
  const router = useRouter();
  const { user } = useAuth();
  const [displayName, setDisplayName] = useState('');
  const [username, setUsername] = useState('');
  const [bio, setBio] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleGetStarted() {
    setError(null);
    if (!displayName.trim()) {
      setError('Please enter a display name.');
      return;
    }
    if (!username.trim()) {
      setError('Please choose a username.');
      return;
    }
    if (!user?.id) {
      setError('No authenticated user found. Please log in again.');
      return;
    }

    setLoading(true);
    try {
      const { error: upsertError } = await supabase.from('profiles').upsert({
        id: user.id,
        display_name: displayName.trim(),
        username: username.trim().replace(/^@/, ''),
        bio: bio.trim() || null,
        onboarding_complete: true,
      });

      if (upsertError) {
        setError(upsertError.message);
        return;
      }

      router.replace('/(tabs)');
    } finally {
      setLoading(false);
    }
  }

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: '#F8F8F6' }}>
      <KeyboardAvoidingView
        style={{ flex: 1 }}
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
      >
        <ScrollView
          contentContainerStyle={{ flexGrow: 1, justifyContent: 'center', paddingHorizontal: 24, paddingVertical: 48 }}
          keyboardShouldPersistTaps="handled"
          showsVerticalScrollIndicator={false}
        >
          {/* Header */}
          <Text
            style={{
              fontSize: 32,
              fontWeight: '800',
              color: '#1A1A18',
              letterSpacing: -1,
              textAlign: 'center',
              marginBottom: 8,
            }}
          >
            Welcome to{' '}
            <Text style={{ color: '#D97706' }}>sillajuku</Text>
          </Text>
          <Text
            style={{
              fontSize: 15,
              color: '#8C8C8A',
              textAlign: 'center',
              marginBottom: 40,
              lineHeight: 22,
            }}
          >
            Set up your profile to get started.
          </Text>

          {/* Display name */}
          <View style={{ marginBottom: 8 }}>
            <Text
              style={{
                fontSize: 12,
                fontWeight: '600',
                color: '#8C8C8A',
                textTransform: 'uppercase',
                letterSpacing: 0.6,
                marginBottom: 6,
              }}
            >
              Display Name
            </Text>
            <TextInput
              style={{
                backgroundColor: '#FFFFFF',
                borderWidth: 1,
                borderColor: '#E8E8E6',
                borderRadius: 12,
                paddingHorizontal: 16,
                paddingVertical: 14,
                fontSize: 15,
                color: '#1A1A18',
              }}
              placeholder="Your name"
              placeholderTextColor="#8C8C8A"
              value={displayName}
              onChangeText={setDisplayName}
              autoCapitalize="words"
              autoCorrect={false}
            />
          </View>

          {/* Username */}
          <View style={{ marginBottom: 8, marginTop: 12 }}>
            <Text
              style={{
                fontSize: 12,
                fontWeight: '600',
                color: '#8C8C8A',
                textTransform: 'uppercase',
                letterSpacing: 0.6,
                marginBottom: 6,
              }}
            >
              Username
            </Text>
            <View style={{ position: 'relative' }}>
              <Text
                style={{
                  position: 'absolute',
                  left: 16,
                  top: 14,
                  fontSize: 15,
                  color: '#8C8C8A',
                  zIndex: 1,
                }}
              >
                @
              </Text>
              <TextInput
                style={{
                  backgroundColor: '#FFFFFF',
                  borderWidth: 1,
                  borderColor: '#E8E8E6',
                  borderRadius: 12,
                  paddingHorizontal: 16,
                  paddingLeft: 28,
                  paddingVertical: 14,
                  fontSize: 15,
                  color: '#1A1A18',
                }}
                placeholder="yourhandle"
                placeholderTextColor="#8C8C8A"
                value={username}
                onChangeText={(text) => setUsername(text.replace(/^@/, ''))}
                autoCapitalize="none"
                autoCorrect={false}
              />
            </View>
          </View>

          {/* Bio */}
          <View style={{ marginBottom: 28, marginTop: 12 }}>
            <Text
              style={{
                fontSize: 12,
                fontWeight: '600',
                color: '#8C8C8A',
                textTransform: 'uppercase',
                letterSpacing: 0.6,
                marginBottom: 6,
              }}
            >
              Bio{' '}
              <Text style={{ fontWeight: '400', textTransform: 'none', letterSpacing: 0 }}>
                (optional)
              </Text>
            </Text>
            <TextInput
              style={{
                backgroundColor: '#FFFFFF',
                borderWidth: 1,
                borderColor: '#E8E8E6',
                borderRadius: 12,
                paddingHorizontal: 16,
                paddingVertical: 14,
                fontSize: 15,
                color: '#1A1A18',
                minHeight: 90,
                textAlignVertical: 'top',
              }}
              placeholder="Tell people a bit about yourself…"
              placeholderTextColor="#8C8C8A"
              value={bio}
              onChangeText={setBio}
              multiline
              autoCorrect={false}
            />
          </View>

          {/* Error */}
          {error && (
            <Text
              style={{
                fontSize: 13,
                color: '#DC2626',
                textAlign: 'center',
                marginBottom: 12,
              }}
            >
              {error}
            </Text>
          )}

          {/* Submit */}
          <Pressable
            onPress={handleGetStarted}
            disabled={loading}
            style={({ pressed }) => ({
              backgroundColor: '#D97706',
              borderRadius: 12,
              paddingVertical: 15,
              alignItems: 'center',
              opacity: pressed || loading ? 0.75 : 1,
            })}
          >
            {loading ? (
              <ActivityIndicator color="#FFFFFF" />
            ) : (
              <Text style={{ fontSize: 15, fontWeight: '700', color: '#FFFFFF' }}>
                Get Started
              </Text>
            )}
          </Pressable>
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}
