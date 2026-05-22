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
import { Ionicons } from '@expo/vector-icons';
import { supabase } from '@/lib/supabase';

type Mode = 'login' | 'signup';

export default function LoginScreen() {
  const router = useRouter();
  const [mode, setMode] = useState<Mode>('login');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState<{ text: string; isError: boolean } | null>(null);

  function switchMode(next: Mode) {
    setMode(next);
    setMessage(null);
    setConfirmPassword('');
  }

  async function handleSubmit() {
    setMessage(null);
    if (!email.trim() || !password) {
      setMessage({ text: 'Please enter your email and password.', isError: true });
      return;
    }
    if (mode === 'signup' && password !== confirmPassword) {
      setMessage({ text: 'Passwords do not match.', isError: true });
      return;
    }

    setLoading(true);
    try {
      if (mode === 'login') {
        const { error } = await supabase.auth.signInWithPassword({ email: email.trim(), password });
        if (error) {
          setMessage({ text: error.message, isError: true });
        } else {
          router.replace('/(tabs)');
        }
      } else {
        const { error } = await supabase.auth.signUp({
          email: email.trim(),
          password,
          options: { emailRedirectTo: 'sillajuku://auth/callback' },
        });
        if (error) {
          setMessage({ text: error.message, isError: true });
        } else {
          setMessage({
            text: 'Check your email for a confirmation link.',
            isError: false,
          });
        }
      }
    } finally {
      setLoading(false);
    }
  }

  async function handleGoogleOAuth() {
    setMessage(null);
    setLoading(true);
    try {
      const { error } = await supabase.auth.signInWithOAuth({
        provider: 'google',
        options: { redirectTo: 'sillajuku://auth/callback' },
      });
      if (error) {
        setMessage({ text: error.message, isError: true });
      }
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
          {/* Logo */}
          <Text
            style={{
              fontSize: 40,
              fontWeight: '800',
              color: '#D97706',
              letterSpacing: -1.5,
              textAlign: 'center',
              marginBottom: 8,
            }}
          >
            sillajuku
          </Text>
          <Text
            style={{
              fontSize: 15,
              color: '#8C8C8A',
              textAlign: 'center',
              marginBottom: 40,
            }}
          >
            Rate music. Share taste.
          </Text>

          {/* Mode switcher */}
          <View
            style={{
              flexDirection: 'row',
              backgroundColor: '#E8E8E6',
              borderRadius: 12,
              padding: 4,
              marginBottom: 28,
            }}
          >
            {(['login', 'signup'] as Mode[]).map((m) => (
              <Pressable
                key={m}
                onPress={() => switchMode(m)}
                style={{
                  flex: 1,
                  paddingVertical: 10,
                  borderRadius: 9,
                  backgroundColor: mode === m ? '#D97706' : 'transparent',
                  alignItems: 'center',
                }}
              >
                <Text
                  style={{
                    fontSize: 14,
                    fontWeight: '600',
                    color: mode === m ? '#FFFFFF' : '#8C8C8A',
                  }}
                >
                  {m === 'login' ? 'Log In' : 'Sign Up'}
                </Text>
              </Pressable>
            ))}
          </View>

          {/* Email */}
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
              marginBottom: 12,
            }}
            placeholder="Email"
            placeholderTextColor="#8C8C8A"
            value={email}
            onChangeText={setEmail}
            keyboardType="email-address"
            autoCapitalize="none"
            autoCorrect={false}
          />

          {/* Password */}
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
              marginBottom: 12,
            }}
            placeholder="Password"
            placeholderTextColor="#8C8C8A"
            value={password}
            onChangeText={setPassword}
            secureTextEntry
            autoCapitalize="none"
            autoCorrect={false}
          />

          {/* Confirm password (signup only) */}
          {mode === 'signup' && (
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
                marginBottom: 12,
              }}
              placeholder="Confirm Password"
              placeholderTextColor="#8C8C8A"
              value={confirmPassword}
              onChangeText={setConfirmPassword}
              secureTextEntry
              autoCapitalize="none"
              autoCorrect={false}
            />
          )}

          {/* Message */}
          {message && (
            <Text
              style={{
                fontSize: 13,
                color: message.isError ? '#DC2626' : '#16A34A',
                marginBottom: 12,
                textAlign: 'center',
              }}
            >
              {message.text}
            </Text>
          )}

          {/* Submit button */}
          <Pressable
            onPress={handleSubmit}
            disabled={loading}
            style={({ pressed }) => ({
              backgroundColor: '#D97706',
              borderRadius: 12,
              paddingVertical: 15,
              alignItems: 'center',
              opacity: pressed || loading ? 0.75 : 1,
              marginBottom: 16,
            })}
          >
            {loading ? (
              <ActivityIndicator color="#FFFFFF" />
            ) : (
              <Text style={{ fontSize: 15, fontWeight: '700', color: '#FFFFFF' }}>
                {mode === 'login' ? 'Log In' : 'Create Account'}
              </Text>
            )}
          </Pressable>

          {/* Divider */}
          <View style={{ flexDirection: 'row', alignItems: 'center', marginBottom: 16 }}>
            <View style={{ flex: 1, height: 1, backgroundColor: '#E8E8E6' }} />
            <Text style={{ marginHorizontal: 12, fontSize: 13, color: '#8C8C8A' }}>or</Text>
            <View style={{ flex: 1, height: 1, backgroundColor: '#E8E8E6' }} />
          </View>

          {/* Google OAuth */}
          <Pressable
            onPress={handleGoogleOAuth}
            disabled={loading}
            style={({ pressed }) => ({
              flexDirection: 'row',
              alignItems: 'center',
              justifyContent: 'center',
              backgroundColor: '#FFFFFF',
              borderWidth: 1,
              borderColor: '#E8E8E6',
              borderRadius: 12,
              paddingVertical: 14,
              opacity: pressed || loading ? 0.75 : 1,
              gap: 10,
            })}
          >
            <Ionicons name="logo-google" size={18} color="#1A1A18" />
            <Text style={{ fontSize: 15, fontWeight: '600', color: '#1A1A18' }}>
              Continue with Google
            </Text>
          </Pressable>
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}
