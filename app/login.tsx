import { makeRedirectUri } from 'expo-auth-session';
import * as WebBrowser from 'expo-web-browser';
import { Platform, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { supabase } from '../lib/supabase';

WebBrowser.maybeCompleteAuthSession();

export default function LoginScreen() {
 const handleGoogleSignIn = async () => {
  const redirectTo = makeRedirectUri({
    scheme: 'gasandgroceryoptimizer',
    preferLocalhost: false,
  });
  
  console.log('Redirect URI:', redirectTo);

  // ... rest stays the same

  const { data, error } = await supabase.auth.signInWithOAuth({
    provider: 'google',
    options: {
      redirectTo,
      skipBrowserRedirect: Platform.OS !== 'web',
    },
  });

  // ... rest stays the same
    if (error) {
      console.error('Error signing in:', error.message);
      return;
    }

    if (Platform.OS === 'web') {
      if (data?.url) {
        window.location.href = data.url;
      }
    } else {
      if (data?.url) {
        await WebBrowser.openAuthSessionAsync(data.url, redirectTo);
      }
    }
  };

  return (
    <View style={styles.container}>
      <Text style={styles.title}>Gas & Grocery Optimizer</Text>
      <Text style={styles.subtitle}>Save money, save time</Text>

      <TouchableOpacity style={styles.button} onPress={handleGoogleSignIn}>
        <Text style={styles.buttonText}>Sign in with Google</Text>
      </TouchableOpacity>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    padding: 20,
    backgroundColor: '#fff',
  },
  title: {
    fontSize: 28,
    fontWeight: 'bold',
    marginBottom: 8,
    color: '#1a1a2e',
  },
  subtitle: {
    fontSize: 16,
    color: '#666',
    marginBottom: 40,
  },
  button: {
    backgroundColor: '#4285F4',
    paddingVertical: 14,
    paddingHorizontal: 32,
    borderRadius: 8,
  },
  buttonText: {
    color: '#fff',
    fontSize: 16,
    fontWeight: '600',
  },
});
