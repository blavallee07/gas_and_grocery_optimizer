import { useRouter } from 'expo-router';
import React, { useEffect, useState } from 'react';
import { StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { supabase } from '../../lib/supabase';

export default function HomeScreen() {
  const [email, setEmail] = useState<string | null>(null);
  const router = useRouter();

  useEffect(() => {
    let mounted = true;
    (async () => {
      const {
        data: { session },
      } = await supabase.auth.getSession();

      if (mounted && session?.user) setEmail(session.user.email ?? null);
    })();

    return () => {
      mounted = false;
    };
  }, []);

  const handleSignOut = async () => {
    await supabase.auth.signOut();
  };

  const goProfile = () => router.push('/profile');
  const goGas = () => router.push('/gas');

  return (
    <View style={styles.container}>
      <Text style={styles.title}>Welcome</Text>
      <Text style={styles.subtitle}>{email ?? 'Your account'}</Text>

      <TouchableOpacity style={styles.gasButton} onPress={goGas}>
        <Text style={styles.gasButtonText}>⛽ Find Gas</Text>
      </TouchableOpacity>

      <TouchableOpacity style={styles.button} onPress={handleSignOut}>
        <Text style={styles.buttonText}>Sign out</Text>
      </TouchableOpacity>

      <TouchableOpacity style={styles.profileButton} onPress={goProfile}>
        <Text style={styles.profileButtonText}>Edit Profile</Text>
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
    color: '#080809',
  },
  subtitle: {
    fontSize: 16,
    color: '#666',
    marginBottom: 40,
  },
  gasButton: {
    backgroundColor: '#4caf50',
    paddingVertical: 14,
    paddingHorizontal: 32,
    borderRadius: 8,
    marginBottom: 16,
  },
  gasButtonText: {
    color: '#fff',
    fontSize: 18,
    fontWeight: '600',
  },
  button: {
    backgroundColor: '#444',
    paddingVertical: 14,
    paddingHorizontal: 32,
    borderRadius: 8,
  },
  buttonText: {
    color: '#fff',
    fontSize: 16,
    fontWeight: '600',
  },
  profileButton: {
    position: 'absolute',
    top: 40,
    right: 20,
    backgroundColor: '#4285F4',
    paddingVertical: 8,
    paddingHorizontal: 12,
    borderRadius: 6,
  },
  profileButtonText: {
    color: '#fff',
    fontSize: 14,
    fontWeight: '600',
  },
});