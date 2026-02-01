import { supabase } from '@/lib/supabase';
import { useRouter } from 'expo-router';
import React, { useEffect, useState } from 'react';
import { ActivityIndicator, ScrollView, StyleSheet, Text, TouchableOpacity, View } from 'react-native';

const PROXY_BASE = 'http://localhost:3001/api';

interface Station {
  id: string;
  name: string;
  price_per_l: number | null;
  lat: number;
  lng: number;
  distance_km: number;
  driving_distance_km?: number;
  driving_duration_min?: number;
}

interface StationResult extends Station {
  gross_savings: number;
  detour_cost: number;
  net_savings: number;
  worth_it: boolean;
}

export default function GasScreen() {
  const router = useRouter();
  const [loading, setLoading] = useState(true);
  const [stations, setStations] = useState<StationResult[]>([]);
  const [profile, setProfile] = useState<any>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    loadData();
  }, []);

  const loadData = async () => {
    setLoading(true);
    setError(null);
    
    try {
      // Get user profile
      const { data: { session } } = await supabase.auth.getSession();
      if (!session?.user) {
        router.replace('/login');
        return;
      }

      const { data: profileData, error: profileError } = await supabase
        .from('profiles')
        .select('*')
        .eq('id', session.user.id)
        .maybeSingle();

      if (profileError) throw profileError;
      if (!profileData?.home_lat || !profileData?.home_lng) {
        setError('Please set your home location in Profile first.');
        setLoading(false);
        return;
      }

      setProfile(profileData);

      // Fetch gas stations
      const url = `${PROXY_BASE}/gasbuddy/smart?lat=${profileData.home_lat}&lng=${profileData.home_lng}&radius=15`;
      
      const response = await fetch(url);
      const data = await response.json();

      if (!data.success) throw new Error(data.error || 'Failed to fetch stations');

      // Run optimizer
      const results = rankStations(data.stations, profileData);
      setStations(results);

    } catch (e: any) {
      console.error('Load error:', e);
      setError(e.message || 'Failed to load data');
    } finally {
      setLoading(false);
    }
  };

  const rankStations = (stations: Station[], profile: any): StationResult[] => {
    // Filter stations with prices
    const withPrices = stations.filter(s => s.price_per_l !== null);
    if (withPrices.length === 0) return [];

    // Find baseline (closest station with price)
    const baseline = withPrices.reduce((min, s) => 
      (s.driving_distance_km || s.distance_km) < (min.driving_distance_km || min.distance_km) ? s : min
    );
    const baselinePrice = baseline.price_per_l!;
    const baselineDistance = baseline.driving_distance_km || baseline.distance_km;

    // Calculate for each station
    const tankSize = profile.tank_size_l || 50;
    const efficiency = profile.fuel_efficiency || 10;
    const minSavings = profile.min_savings || 1;
    const maxDetour = profile.max_detour_km || 20;
    const fillAmount = 0.75; // Assume filling 75% of tank

    const litersToFill = tankSize * fillAmount;

    return withPrices
      .filter(s => (s.driving_distance_km || s.distance_km) <= maxDetour)
      .map(station => {
        const stationDistance = station.driving_distance_km || station.distance_km;
        const detourKm = Math.max(0, (stationDistance - baselineDistance) * 2);

        const priceDiff = baselinePrice - station.price_per_l!;
        const grossSavings = priceDiff * litersToFill;

        const fuelUsed = (detourKm / 100) * efficiency;
        const detourCost = fuelUsed * baselinePrice;

        const netSavings = grossSavings - detourCost;

        return {
          ...station,
          gross_savings: Math.round(grossSavings * 100) / 100,
          detour_cost: Math.round(detourCost * 100) / 100,
          net_savings: Math.round(netSavings * 100) / 100,
          worth_it: netSavings >= minSavings,
        };
      })
      .sort((a, b) => b.net_savings - a.net_savings);
  };

  if (loading) {
    return (
      <View style={styles.centered}>
        <ActivityIndicator size="large" color="#4285F4" />
        <Text style={styles.loadingText}>Finding best gas prices...</Text>
      </View>
    );
  }

  if (error) {
    return (
      <View style={styles.centered}>
        <Text style={styles.errorText}>{error}</Text>
        <TouchableOpacity style={styles.button} onPress={() => router.push('/profile')}>
          <Text style={styles.buttonText}>Go to Profile</Text>
        </TouchableOpacity>
      </View>
    );
  }

  const bestStation = stations[0];

  return (
    <ScrollView style={styles.container}>
      <Text style={styles.title}>Gas Stations Near You</Text>
      
      {bestStation && (
        <View style={styles.recommendationCard}>
          <Text style={styles.recommendationTitle}>💡 Best Option</Text>
          <Text style={styles.stationName}>{bestStation.name}</Text>
          <Text style={styles.price}>${bestStation.price_per_l?.toFixed(3)}/L</Text>
          <Text style={styles.distance}>
            {bestStation.driving_distance_km?.toFixed(1) || bestStation.distance_km.toFixed(1)} km 
            {bestStation.driving_duration_min && ` • ${bestStation.driving_duration_min} min`}
          </Text>
          {bestStation.net_savings > 0 ? (
            <Text style={styles.savings}>Save ${bestStation.net_savings.toFixed(2)} net</Text>
          ) : (
            <Text style={styles.noSavings}>Closest & most convenient</Text>
          )}
        </View>
      )}

      <Text style={styles.sectionTitle}>All Stations</Text>
      
      {stations.map((station, index) => (
        <View key={station.id} style={[styles.stationCard, index === 0 && styles.bestCard]}>
          <View style={styles.stationHeader}>
            <Text style={styles.stationName}>{station.name}</Text>
            <Text style={styles.price}>${station.price_per_l?.toFixed(3)}/L</Text>
          </View>
          
          <Text style={styles.distance}>
            {station.driving_distance_km?.toFixed(1) || station.distance_km.toFixed(1)} km
            {station.driving_duration_min && ` • ${station.driving_duration_min} min drive`}
          </Text>
          
          <View style={styles.savingsRow}>
            {station.net_savings > 0 ? (
              <>
                <Text style={styles.savingsPositive}>+${station.net_savings.toFixed(2)} net</Text>
                <Text style={styles.savingsDetail}>
                  (${station.gross_savings.toFixed(2)} savings - ${station.detour_cost.toFixed(2)} fuel)
                </Text>
              </>
            ) : station.net_savings < 0 ? (
              <Text style={styles.savingsNegative}>
                Not worth it (${Math.abs(station.net_savings).toFixed(2)} loss)
              </Text>
            ) : (
              <Text style={styles.savingsNeutral}>Baseline station</Text>
            )}
          </View>
          
          {station.worth_it && station.net_savings > 0 && (
            <View style={styles.worthItBadge}>
              <Text style={styles.worthItText}>✓ Worth the detour</Text>
            </View>
          )}
        </View>
      ))}

      <TouchableOpacity style={styles.refreshButton} onPress={loadData}>
        <Text style={styles.refreshText}>🔄 Refresh Prices</Text>
      </TouchableOpacity>

      <View style={{ height: 40 }} />
    </ScrollView>
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
    padding: 20,
  },
  loadingText: {
    marginTop: 12,
    fontSize: 16,
    color: '#666',
  },
  errorText: {
    fontSize: 16,
    color: '#e74c3c',
    textAlign: 'center',
    marginBottom: 20,
  },
  title: {
    fontSize: 24,
    fontWeight: 'bold',
    marginBottom: 16,
    marginTop: 40,
  },
  sectionTitle: {
    fontSize: 18,
    fontWeight: '600',
    marginTop: 20,
    marginBottom: 12,
    color: '#333',
  },
  recommendationCard: {
    backgroundColor: '#e8f5e9',
    borderRadius: 12,
    padding: 16,
    borderWidth: 2,
    borderColor: '#4caf50',
  },
  recommendationTitle: {
    fontSize: 14,
    fontWeight: '600',
    color: '#2e7d32',
    marginBottom: 8,
  },
  stationCard: {
    backgroundColor: '#fff',
    borderRadius: 10,
    padding: 14,
    marginBottom: 10,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.1,
    shadowRadius: 2,
    elevation: 2,
  },
  bestCard: {
    borderWidth: 2,
    borderColor: '#4caf50',
  },
  stationHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 6,
  },
  stationName: {
    fontSize: 18,
    fontWeight: '600',
    color: '#333',
  },
  price: {
    fontSize: 20,
    fontWeight: 'bold',
    color: '#2196f3',
  },
  distance: {
    fontSize: 14,
    color: '#666',
    marginBottom: 8,
  },
  savingsRow: {
    marginTop: 4,
  },
  savingsPositive: {
    fontSize: 16,
    fontWeight: '600',
    color: '#4caf50',
  },
  savingsNegative: {
    fontSize: 14,
    color: '#e74c3c',
  },
  savingsNeutral: {
    fontSize: 14,
    color: '#666',
    fontStyle: 'italic',
  },
  savingsDetail: {
    fontSize: 12,
    color: '#888',
    marginTop: 2,
  },
  savings: {
    fontSize: 16,
    fontWeight: '600',
    color: '#4caf50',
    marginTop: 4,
  },
  noSavings: {
    fontSize: 14,
    color: '#666',
    fontStyle: 'italic',
    marginTop: 4,
  },
  worthItBadge: {
    backgroundColor: '#e8f5e9',
    paddingVertical: 4,
    paddingHorizontal: 8,
    borderRadius: 4,
    marginTop: 8,
    alignSelf: 'flex-start',
  },
  worthItText: {
    fontSize: 12,
    color: '#2e7d32',
    fontWeight: '600',
  },
  button: {
    backgroundColor: '#4285F4',
    paddingVertical: 12,
    paddingHorizontal: 24,
    borderRadius: 8,
  },
  buttonText: {
    color: '#fff',
    fontSize: 16,
    fontWeight: '600',
  },
  refreshButton: {
    backgroundColor: '#fff',
    paddingVertical: 14,
    borderRadius: 8,
    alignItems: 'center',
    marginTop: 10,
    borderWidth: 1,
    borderColor: '#ddd',
  },
  refreshText: {
    fontSize: 16,
    color: '#333',
  },
});
