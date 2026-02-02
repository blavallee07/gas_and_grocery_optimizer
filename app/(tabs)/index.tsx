import { supabase } from '@/lib/supabase';
import { useRouter } from 'expo-router';
import React, { useEffect, useState } from 'react';
import { ActivityIndicator, StyleSheet, Text, TouchableOpacity, View } from 'react-native';

export default function HomeScreen() {
  const router = useRouter();
  const [loading, setLoading] = useState(true);
  const [profile, setProfile] = useState<any>(null);
  const [userName, setUserName] = useState<string>('');

  useEffect(() => {
    loadProfile();
  }, []);

  const loadProfile = async () => {
    try {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session?.user) {
        router.replace('/login');
        return;
      }

      setUserName(session.user.email?.split('@')[0] || 'there');

      const { data } = await supabase
        .from('profiles')
        .select('*')
        .eq('id', session.user.id)
        .maybeSingle();
      
      setProfile(data);
    } catch (e) {
      console.error('Load error:', e);
    } finally {
      setLoading(false);
    }
  };

  const handleSignOut = async () => {
    await supabase.auth.signOut();
    router.replace('/login');
  };

  if (loading) {
    return (
      <View style={styles.centered}>
        <ActivityIndicator size="large" color="#4285F4" />
      </View>
    );
  }

  const hasLocation = profile?.home_lat && profile?.home_lng;
  const hasVehicle = profile?.vehicle_year && profile?.vehicle_make;

  return (
    <View style={styles.container}>
      <View style={styles.header}>
        <Text style={styles.greeting}>Hello, {userName}!</Text>
        <Text style={styles.subtitle}>Ready to save on gas?</Text>
      </View>

      {/* Quick Actions */}
      <View style={styles.actionsContainer}>
        <TouchableOpacity 
          style={[styles.mainAction, !hasLocation && styles.actionDisabled]} 
          onPress={() => router.push('/gas')}
          disabled={!hasLocation}
        >
          <Text style={styles.mainActionEmoji}></Text>
          <Text style={styles.mainActionText}>Find Gas</Text>
          <Text style={styles.mainActionSubtext}>
            {hasLocation ? 'See nearby prices' : 'Set location first'}
          </Text>
        </TouchableOpacity>

        <View style={styles.secondaryActions}>
          <TouchableOpacity 
            style={styles.secondaryAction} 
            onPress={() => router.push('/profile')}
          >
            <Text style={styles.secondaryEmoji}></Text>
            <Text style={styles.secondaryText}>Profile</Text>
          </TouchableOpacity>

          <TouchableOpacity 
            style={[styles.secondaryAction, styles.comingSoon]} 
            disabled
          >
            <Text style={styles.secondaryEmoji}></Text>
            <Text style={styles.secondaryText}>Groceries</Text>
            <Text style={styles.comingSoonText}>Soon</Text>
          </TouchableOpacity>
        </View>
      </View>

      {/* Status Cards */}
      <View style={styles.statusSection}>
        <Text style={styles.sectionTitle}>Setup Status</Text>
        
        <View style={[styles.statusCard, hasLocation ? styles.statusComplete : styles.statusIncomplete]}>
          <Text style={styles.statusIcon}></Text>
          <View style={styles.statusInfo}>
            <Text style={styles.statusTitle}>Home Location</Text>
            <Text style={styles.statusSubtitle}>
              {hasLocation 
                ? `${parseFloat(profile.home_lat).toFixed(2)}, ${parseFloat(profile.home_lng).toFixed(2)}` 
                : 'Not set'}
            </Text>
          </View>
          {!hasLocation && (
            <TouchableOpacity onPress={() => router.push('/profile')}>
              <Text style={styles.statusAction}>Set</Text>
            </TouchableOpacity>
          )}
        </View>

        <View style={[styles.statusCard, hasVehicle ? styles.statusComplete : styles.statusIncomplete]}>
          <Text style={styles.statusIcon}></Text>
          <View style={styles.statusInfo}>
            <Text style={styles.statusTitle}>Vehicle</Text>
            <Text style={styles.statusSubtitle}>
              {hasVehicle 
                ? `${profile.vehicle_year} ${profile.vehicle_make} ${profile.vehicle_model || ''}` 
                : 'Not set'}
            </Text>
          </View>
          {!hasVehicle && (
            <TouchableOpacity onPress={() => router.push('/profile')}>
              <Text style={styles.statusAction}>Set</Text>
            </TouchableOpacity>
          )}
        </View>

        {profile?.fuel_efficiency && (
          <View style={styles.infoCard}>
            <Text style={styles.infoLabel}>Fuel Efficiency</Text>
            <Text style={styles.infoValue}>{profile.fuel_efficiency} L/100km</Text>
          </View>
        )}
      </View>

      {/* Sign Out */}
      <TouchableOpacity style={styles.signOutButton} onPress={handleSignOut}>
        <Text style={styles.signOutText}>Sign Out</Text>
      </TouchableOpacity>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#f5f5f5',
    padding: 16,
  },
  centered: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: '#f5f5f5',
  },
  header: {
    marginTop: 50,
    marginBottom: 24,
  },
  greeting: {
    fontSize: 28,
    fontWeight: 'bold',
    color: '#1a1a2e',
  },
  subtitle: {
    fontSize: 16,
    color: '#666',
    marginTop: 4,
  },
  actionsContainer: {
    marginBottom: 24,
  },
  mainAction: {
    backgroundColor: '#4caf50',
    borderRadius: 16,
    padding: 24,
    alignItems: 'center',
    marginBottom: 12,
    shadowColor: '#4caf50',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.3,
    shadowRadius: 8,
    elevation: 4,
  },
  actionDisabled: {
    backgroundColor: '#bdbdbd',
    shadowColor: '#000',
  },
  mainActionText: {
    fontSize: 24,
    fontWeight: 'bold',
    color: '#fff',
  },
  mainActionSubtext: {
    fontSize: 14,
    color: 'rgba(255,255,255,0.8)',
    marginTop: 4,
  },
  secondaryActions: {
    flexDirection: 'row',
    gap: 12,
  },
  secondaryAction: {
    flex: 1,
    backgroundColor: '#fff',
    borderRadius: 12,
    padding: 16,
    alignItems: 'center',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.1,
    shadowRadius: 2,
    elevation: 2,
  },
  comingSoon: {
    opacity: 0.6,
  },
  secondaryText: {
    fontSize: 14,
    fontWeight: '600',
    color: '#333',
  },
  comingSoonText: {
    fontSize: 10,
    color: '#999',
    marginTop: 2,
  },
  statusSection: {
    flex: 1,
  },
  sectionTitle: {
    fontSize: 16,
    fontWeight: '600',
    color: '#666',
    marginBottom: 12,
  },
  statusCard: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#fff',
    borderRadius: 12,
    padding: 14,
    marginBottom: 10,
  },
  statusComplete: {
    borderLeftWidth: 4,
    borderLeftColor: '#4caf50',
  },
  statusIncomplete: {
    borderLeftWidth: 4,
    borderLeftColor: '#ff9800',
  },
  statusIcon: {
    fontSize: 20,
    marginRight: 12,
  },
  statusInfo: {
    flex: 1,
  },
  statusTitle: {
    fontSize: 14,
    fontWeight: '600',
    color: '#333',
  },
  statusSubtitle: {
    fontSize: 12,
    color: '#666',
    marginTop: 2,
  },
  statusAction: {
    fontSize: 14,
    fontWeight: '600',
    color: '#4285F4',
  },
  infoCard: {
    backgroundColor: '#e3f2fd',
    borderRadius: 12,
    padding: 14,
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  infoLabel: {
    fontSize: 14,
    color: '#1976d2',
  },
  infoValue: {
    fontSize: 16,
    fontWeight: '600',
    color: '#1976d2',
  },
  signOutButton: {
    backgroundColor: '#fff',
    borderRadius: 8,
    padding: 14,
    alignItems: 'center',
    borderWidth: 1,
    borderColor: '#ddd',
    marginTop: 'auto',
  },
  signOutText: {
    fontSize: 14,
    color: '#666',
  },
});