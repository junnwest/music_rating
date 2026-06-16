import { useState } from 'react';
import { Image } from 'expo-image';
import {
  ActivityIndicator,
  KeyboardAvoidingView,
  Modal,
  Platform,
  Pressable,
  Text,
  TextInput,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import Svg, { Path } from 'react-native-svg';
import * as WebBrowser from 'expo-web-browser';
import { supabase } from '@/lib/supabase';
import { useLanguage } from '@/lib/i18n';

WebBrowser.maybeCompleteAuthSession();

type Mode = 'login' | 'signup';
type OAuthProvider = 'google' | 'spotify';

export default function LoginScreen() {
  const router = useRouter();
  const { t } = useLanguage();
  const [mode, setMode] = useState<Mode>('login');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [oauthLoading, setOauthLoading] = useState<OAuthProvider | null>(null);
  const [message, setMessage] = useState<{ text: string; isError: boolean } | null>(null);
  const [comingSoon, setComingSoon] = useState(false);

  function switchMode(next: Mode) {
    setMode(next);
    setMessage(null);
    setConfirmPassword('');
  }

  async function handleSubmit() {
    setMessage(null);
    if (!email.trim() || !password) {
      setMessage({ text: t('login.enterCredentials'), isError: true });
      return;
    }
    if (mode === 'signup' && password !== confirmPassword) {
      setMessage({ text: t('login.passwordsNoMatch'), isError: true });
      return;
    }

    setLoading(true);
    try {
      if (mode === 'login') {
        const { error } = await supabase.auth.signInWithPassword({ email: email.trim(), password });
        if (error) setMessage({ text: error.message, isError: true });
      } else {
        const { error } = await supabase.auth.signUp({
          email: email.trim(),
          password,
          options: { emailRedirectTo: 'sillajuku://auth/callback' },
        });
        if (error) {
          setMessage({ text: error.message, isError: true });
        } else {
          setMessage({ text: t('login.checkEmail'), isError: false });
        }
      }
    } finally {
      setLoading(false);
    }
  }

  async function handleOAuth(provider: OAuthProvider) {
    setOauthLoading(provider);
    setMessage(null);
    try {
      const redirectTo = 'sillajuku://auth/callback';

      const { data, error } = await supabase.auth.signInWithOAuth({
        provider,
        options: { redirectTo, skipBrowserRedirect: true },
      });

      if (error || !data.url) throw error ?? new Error('No OAuth URL returned');

      const result = await WebBrowser.openAuthSessionAsync(data.url, redirectTo);

      if (result.type === 'success') {
        const { url: resultUrl } = result;

        if (resultUrl.includes('#')) {
          // Implicit flow — tokens are in the URL hash
          const hash = resultUrl.split('#')[1] ?? '';
          const params = new URLSearchParams(hash);
          const accessToken = params.get('access_token');
          const refreshToken = params.get('refresh_token');
          if (accessToken && refreshToken) {
            const { error: sessionErr } = await supabase.auth.setSession({
              access_token: accessToken,
              refresh_token: refreshToken,
            });
            if (sessionErr) throw sessionErr;
          }
        } else {
          // PKCE flow — code is in query params
          const params = new URLSearchParams(resultUrl.split('?')[1] ?? '');
          const code = params.get('code');
          if (code) {
            const { error: exchangeErr } = await supabase.auth.exchangeCodeForSession(code);
            if (exchangeErr) throw exchangeErr;
          }
        }
        // NavigationGuard in _layout.tsx redirects once session updates
      }
    } catch (err) {
      setMessage({ text: err instanceof Error ? err.message : t('login.signInFailed'), isError: true });
    } finally {
      setOauthLoading(null);
    }
  }

  const busy = loading || oauthLoading !== null;

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: '#F8F8F6' }}>
      <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : 'height'}>
        <View style={{ flex: 1, justifyContent: 'center', paddingHorizontal: 24 }}>
          {/* Logo */}
          <Image
            source={require('../../assets/images/logo.png')}
            style={{ width: 96, height: 96, alignSelf: 'center', marginBottom: 12 }}
            contentFit="contain"
          />
          <Text style={{ fontSize: 15, color: '#8C8C8A', textAlign: 'center', marginBottom: 40 }}>
            {t('login.tagline')}
          </Text>

          {/* Mode switcher */}
          <View style={{ flexDirection: 'row', backgroundColor: '#E8E8E6', borderRadius: 12, padding: 4, marginBottom: 28 }}>
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
                <Text style={{ fontSize: 14, fontWeight: '600', color: mode === m ? '#FFFFFF' : '#8C8C8A' }}>
                  {m === 'login' ? t('login.logInTab') : t('login.signUpTab')}
                </Text>
              </Pressable>
            ))}
          </View>

          {/* Email */}
          <TextInput
            style={inputStyle}
            placeholder={t('login.email')}
            placeholderTextColor="#8C8C8A"
            value={email}
            onChangeText={setEmail}
            keyboardType="email-address"
            autoCapitalize="none"
            autoCorrect={false}
          />

          {/* Password */}
          <TextInput
            style={inputStyle}
            placeholder={t('login.password')}
            placeholderTextColor="#8C8C8A"
            value={password}
            onChangeText={setPassword}
            secureTextEntry
            autoCapitalize="none"
            autoCorrect={false}
          />

          {/* Confirm password */}
          {mode === 'signup' && (
            <TextInput
              style={inputStyle}
              placeholder={t('login.confirmPassword')}
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
            <Text style={{ fontSize: 13, color: message.isError ? '#DC2626' : '#16A34A', marginBottom: 12, textAlign: 'center' }}>
              {message.text}
            </Text>
          )}

          {/* Submit */}
          <Pressable
            onPress={handleSubmit}
            disabled={busy}
            style={({ pressed }) => ({
              backgroundColor: '#D97706',
              borderRadius: 12,
              paddingVertical: 15,
              alignItems: 'center',
              opacity: pressed || busy ? 0.75 : 1,
              marginBottom: 16,
            })}
          >
            {loading ? (
              <ActivityIndicator color="#FFFFFF" />
            ) : (
              <Text style={{ fontSize: 15, fontWeight: '700', color: '#FFFFFF' }}>
                {mode === 'login' ? t('login.logIn') : t('login.createAccount')}
              </Text>
            )}
          </Pressable>

          {/* Divider */}
          <View style={{ flexDirection: 'row', alignItems: 'center', marginBottom: 16 }}>
            <View style={{ flex: 1, height: 1, backgroundColor: '#E8E8E6' }} />
            <Text style={{ marginHorizontal: 12, fontSize: 13, color: '#8C8C8A' }}>{t('login.orContinue')}</Text>
            <View style={{ flex: 1, height: 1, backgroundColor: '#E8E8E6' }} />
          </View>

          {/* OAuth buttons */}
          <View style={{ flexDirection: 'row', justifyContent: 'center', gap: 20 }}>
            {/* Google */}
            <Pressable
              onPress={() => handleOAuth('google')}
              disabled={busy}
              style={({ pressed }) => ({
                width: 56,
                height: 56,
                borderRadius: 14,
                backgroundColor: '#FFFFFF',
                borderWidth: 1.5,
                borderColor: '#E8E8E6',
                alignItems: 'center',
                justifyContent: 'center',
                opacity: pressed || busy ? 0.7 : 1,
              })}
            >
              {oauthLoading === 'google' ? (
                <ActivityIndicator size="small" color="#1A1A18" />
              ) : (
                <GoogleIcon />
              )}
            </Pressable>

            {/* Spotify */}
            <Pressable
              onPress={() => handleOAuth('spotify')}
              disabled={busy}
              style={({ pressed }) => ({
                width: 56,
                height: 56,
                borderRadius: 14,
                backgroundColor: '#1DB954',
                alignItems: 'center',
                justifyContent: 'center',
                opacity: pressed || busy ? 0.7 : 1,
              })}
            >
              {oauthLoading === 'spotify' ? (
                <ActivityIndicator size="small" color="#FFFFFF" />
              ) : (
                <SpotifyIcon />
              )}
            </Pressable>

            {/* KakaoTalk */}
            <Pressable
              onPress={() => setComingSoon(true)}
              disabled={busy}
              style={({ pressed }) => ({
                width: 56,
                height: 56,
                borderRadius: 14,
                backgroundColor: '#FEE500',
                alignItems: 'center',
                justifyContent: 'center',
                opacity: pressed ? 0.7 : 1,
              })}
            >
              <KakaoIcon />
            </Pressable>

            {/* Apple */}
            <Pressable
              onPress={() => setComingSoon(true)}
              disabled={busy}
              style={({ pressed }) => ({
                width: 56,
                height: 56,
                borderRadius: 14,
                backgroundColor: '#000000',
                alignItems: 'center',
                justifyContent: 'center',
                opacity: pressed ? 0.7 : 1,
              })}
            >
              <AppleIcon />
            </Pressable>
          </View>
        </View>
      </KeyboardAvoidingView>

      {/* Coming soon modal */}
      <Modal visible={comingSoon} transparent animationType="fade" onRequestClose={() => setComingSoon(false)}>
        <Pressable
          style={{ flex: 1, backgroundColor: 'rgba(0,0,0,0.4)', alignItems: 'center', justifyContent: 'center' }}
          onPress={() => setComingSoon(false)}
        >
          <Pressable
            style={{ backgroundColor: '#FFFFFF', borderRadius: 20, padding: 32, maxWidth: 300, width: '85%', alignItems: 'center' }}
            onPress={() => {}}
          >
            <Text style={{ fontSize: 32, marginBottom: 12 }}>🚧</Text>
            <Text style={{ fontSize: 17, fontWeight: '700', color: '#1A1A18', marginBottom: 8 }}>{t('login.comingSoonTitle')}</Text>
            <Text style={{ fontSize: 13, color: '#8C8C8A', textAlign: 'center', lineHeight: 18, marginBottom: 20 }}>
              {t('login.comingSoonDesc')}
            </Text>
            <Pressable
              onPress={() => setComingSoon(false)}
              style={({ pressed }) => ({
                backgroundColor: '#1A1A18',
                borderRadius: 12,
                paddingHorizontal: 24,
                paddingVertical: 12,
                opacity: pressed ? 0.8 : 1,
              })}
            >
              <Text style={{ fontSize: 14, fontWeight: '700', color: '#FFFFFF' }}>{t('login.gotIt')}</Text>
            </Pressable>
          </Pressable>
        </Pressable>
      </Modal>
    </SafeAreaView>
  );
}

const inputStyle = {
  backgroundColor: '#FFFFFF',
  borderWidth: 1,
  borderColor: '#E8E8E6',
  borderRadius: 12,
  paddingHorizontal: 16,
  paddingVertical: 14,
  fontSize: 15,
  color: '#1A1A18',
  marginBottom: 12,
} as const;

function GoogleIcon() {
  return (
    <Svg width={24} height={24} viewBox="0 0 24 24">
      <Path d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z" fill="#4285F4" />
      <Path d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" fill="#34A853" />
      <Path d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l3.66-2.84z" fill="#FBBC05" />
      <Path d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" fill="#EA4335" />
    </Svg>
  );
}

function SpotifyIcon() {
  return (
    <Svg width={24} height={24} viewBox="0 0 24 24" fill="white">
      <Path d="M12 2C6.477 2 2 6.477 2 12s4.477 10 10 10 10-4.477 10-10S17.523 2 12 2zm4.586 14.424a.622.622 0 0 1-.857.207c-2.348-1.435-5.304-1.76-8.785-.964a.623.623 0 0 1-.277-1.215c3.809-.87 7.077-.496 9.712 1.115a.622.622 0 0 1 .207.857zm1.223-2.722a.78.78 0 0 1-1.072.257c-2.687-1.652-6.785-2.131-9.965-1.166a.78.78 0 0 1-.973-.519.781.781 0 0 1 .52-.973c3.632-1.102 8.147-.568 11.233 1.329a.78.78 0 0 1 .257 1.072zm.105-2.835C14.692 8.95 9.375 8.775 6.297 9.71a.937.937 0 1 1-.543-1.793c3.532-1.072 9.404-.865 13.115 1.338a.937.937 0 0 1-.954 1.612z" />
    </Svg>
  );
}

function KakaoIcon() {
  return (
    <Svg width={24} height={24} viewBox="0 0 24 24">
      <Path d="M12 3C6.477 3 2 6.477 2 10.8c0 2.7 1.607 5.086 4.035 6.534l-.963 3.574a.3.3 0 0 0 .453.328L9.941 18.9A11.66 11.66 0 0 0 12 19.1c5.523 0 10-3.477 10-7.8C22 6.477 17.523 3 12 3z" fill="#3C1E1E" />
    </Svg>
  );
}

function AppleIcon() {
  return (
    <Svg width={24} height={24} viewBox="0 0 24 24" fill="white">
      <Path d="M17.05 20.28c-.98.95-2.05.8-3.08.35-1.09-.46-2.09-.48-3.24 0-1.44.62-2.2.44-3.06-.35C2.79 15.25 3.51 7.7 9.05 7.4c1.35.07 2.29.74 3.08.8 1.18-.24 2.31-.93 3.57-.84 1.51.12 2.65.72 3.4 1.8-3.12 1.87-2.38 5.98.48 7.13-.57 1.39-1.32 2.76-2.54 3.99zM12.03 7.25c-.15-2.23 1.66-4.07 3.74-4.25.29 2.58-2.34 4.5-3.74 4.25z" />
    </Svg>
  );
}
