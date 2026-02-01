import { supabase } from '@/lib/supabase';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { useRouter } from 'expo-router';
import React, { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, Image, RefreshControl, ScrollView, StyleSheet, Text, TouchableOpacity, View } from 'react-native';

const PROXY_BASE = 'http://localhost:3001/api';

// Brand logos
const BRAND_LOGOS: Record<string, string> = {
  'shell': 'https://logo.clearbit.com/shell.com',
  'esso': 'https://logo.clearbit.com/esso.com',
  'petro-canada': 'https://logo.clearbit.com/petro-canada.ca',
  'ultramar': 'https://logo.clearbit.com/ultramar.ca',
  'canadian tire': 'https://logo.clearbit.com/canadiantire.ca',
  'costco': 'https://logo.clearbit.com/costco.com',
  'mobil': 'https://logo.clearbit.com/mobil.com',
  'pioneer': 'https://logo.clearbit.com/pioneerpetroleum.ca',
};

const getBrandLogo = (name: string): string | null => {
  const lower = name.toLowerCase();
  for (const [brand, url] of Object.entries(BRAND_LOGOS)) {
    if (lower.includes(brand)) return url;
  }
  return null;
};

interface Station {
  id: string;
  name: string;
  address?: string;
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
  is_baseline: boolean;
}

export default function GasScreen() {
  const router = useRouter();
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [stations, setStations] = useState<StationResult[]>([]);
  const [profile, setProfile] = useState<any>(null);
  const [error, setError] = useState<string | null>(null);
  const [lastUpdated, setLastUpdated] = useState<Date | null>(null);

  useEffect(() => {
    loadData();
  }, []);

  const loadData = async (forceRefresh = false) => {
    if (!forceRefresh) setLoading(true);
    setError(null);
    
    try {
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
        setRefreshing(false);
        return;
      }

      setProfile(profileData);

      const cacheKey = `gas_stations_${profileData.home_lat}_${profileData.home_lng}`;
      
      if (!forceRefresh) {
        try {
          const cached = await AsyncStorage.getItem(cacheKey);
          if (cached) {
            const { stations: cachedStations, timestamp } = JSON.parse(cached);
            const age = Date.now() - timestamp;
            if (age < 30 * 60 * 1000) {
              const results = rankStations(cachedStations, profileData);
              setStations(results);
              setLastUpdated(new Date(timestamp));
              setLoading(false);
              setRefreshing(false);
              return;
            }
          }
        } catch (e) {
          console.warn('Cache read error:', e);
        }
      }

      const radius = profileData.search_radius_km || 15;
      const url = `${PROXY_BASE}/gasbuddy/smart?lat=${profileData.home_lat}&lng=${profileData.home_lng}&radius=${radius}`;
      
      const response = await fetch(url);
      const data = await response.json();

      if (!data.success) throw new Error(data.error || 'Failed to fetch stations');

      const now = Date.now();
      try {
        await AsyncStorage.setItem(cacheKey, JSON.stringify({
          stations: data.stations,
          timestamp: now,
        }));
      } catch (e) {
        console.warn('Cache write error:', e);
      }

      const results = rankStations(data.stations, profileData);
      setStations(results);
      setLastUpdated(new Date(now));

    } catch (e: any) {
      console.error('Load error:', e);
      setError(e.message || 'Failed to load data');
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  };

  const onRefresh = useCallback(() => {
    setRefreshing(true);
    loadData(true);
  }, []);

  const rankStations = (stations: Station[], profile: any): StationResult[] => {
    const withPrices = stations.filter(s => s.price_per_l !== null);
    if (withPrices.length === 0) return [];

    const baseline = withPrices.reduce((min, s) => 
      (s.driving_distance_km || s.distance_km) < (min.driving_distance_km || min.distance_km) ? s : min
    );
    const baselinePrice = baseline.price_per_l!;
    const baselineDistance = baseline.driving_distance_km || baseline.distance_km;

    const tankSize = profile.tank_size_l || 50;
    const efficiency = profile.fuel_efficiency || 10;
    const minSavings = profile.min_savings || 1;
    const maxDetour = profile.max_detour_km || 20;
    const fillAmount = 0.75;

    const litersToFill = tankSize * fillAmount;

    const results = withPrices
      .map(station => {
        const stationDistance = station.driving_distance_km || station.distance_km;
        const detourKm = Math.max(0, (stationDistance - baselineDistance) * 2);

        const priceDiff = baselinePrice - station.price_per_l!;
        const grossSavings = priceDiff * litersToFill;

        const fuelUsed = (detourKm / 100) * efficiency;
        const detourCost = fuelUsed * baselinePrice;

        const netSavings = grossSavings - detourCost;
        const isBaseline = station.id === baseline.id;

        return {
          ...station,
          gross_savings: Math.round(grossSavings * 100) / 100,
          detour_cost: Math.round(detourCost * 100) / 100,
          net_savings: Math.round(netSavings * 100) / 100,
          worth_it: netSavings >= minSavings,
          is_baseline: isBaseline,
        };
      })
      .sort((a, b) => (a.price_per_l || 999) - (b.price_per_l || 999));

    return results;
  };

  const formatTime = (date: Date): string => {
    return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  };

  if (loading) {
    return (
      <View style={styles.centered}>
        <ActivityIndicator size="large" color="#4285F4" />
        <Text style={styles.loadingText}>Finding best gas prices...</Text>
        <Text style={styles.loadingSubtext}>This may take a moment</Text>
      </View>
    );
  }

  if (error) {
    return (
      <View style={styles.centered}>
        <Text style={styles.errorEmoji}>⚠️</Text>
        <Text style={styles.errorText}>{error}</Text>
        <TouchableOpacity style={styles.primaryButton} onPress={() => router.push('/profile')}>
          <Text style={styles.primaryButtonText}>Go to Profile</Text>
        </TouchableOpacity>
      </View>
    );
  }

  const bestStation = stations.find(s => s.worth_it && s.net_savings > 0) || stations[0];
  const cheapestStation = stations[0];

  return (
    <ScrollView 
      style={styles.container}
      refreshControl={
        <RefreshControl refreshing={refreshing} onRefresh={onRefresh} />
      }
    >
      <View style={styles.header}>
        <Text style={styles.title}>Gas Stations</Text>
        {lastUpdated && (
          <Text style={styles.lastUpdated}>Updated {formatTime(lastUpdated)}</Text>
        )}
      </View>

      {/* Best Value Card */}
      {bestStation && bestStation.net_savings > 0 && (
        <View style={styles.bestCard}>
          <View style={styles.bestBadge}>
            <Text style={styles.bestBadgeText}>💰 BEST VALUE</Text>
          </View>
          <View style={styles.bestContent}>
            <View style={styles.stationRow}>
              {getBrandLogo(bestStation.name) && (
                <Image source={{ uri: getBrandLogo(bestStation.name)! }} style={styles.logo} />
              )}
              <View style={styles.stationInfo}>
                <Text style={styles.bestName}>{bestStation.name}</Text>
                <Text style={styles.bestDistance}>
                  {bestStation.driving_distance_km?.toFixed(1) || bestStation.distance_km.toFixed(1)} km
                  {bestStation.driving_duration_min && ` • ${bestStation.driving_duration_min} min`}
                </Text>
                {bestStation.address && (
                  <Text style={styles.address}>{bestStation.address}</Text>
                )}
              </View>
              <View style={styles.priceContainer}>
                <Text style={styles.bestPrice}>${bestStation.price_per_l?.toFixed(3)}</Text>
                <Text style={styles.perLiter}>/L</Text>
              </View>
            </View>
            <View style={styles.savingsContainer}>
              <Text style={styles.savingsAmount}>Save ${bestStation.net_savings.toFixed(2)}</Text>
              <Text style={styles.savingsDetail}>
                ${bestStation.gross_savings.toFixed(2)} savings - ${bestStation.detour_cost.toFixed(2)} fuel cost
              </Text>
            </View>
          </View>
        </View>
      )}

      {/* Cheapest Price Card */}
      {cheapestStation && cheapestStation.id !== bestStation?.id && (
        <View style={styles.cheapestCard}>
          <View style={styles.cheapestBadge}>
            <Text style={styles.cheapestBadgeText}>⛽ CHEAPEST</Text>
          </View>
          <View style={styles.stationRow}>
            {getBrandLogo(cheapestStation.name) && (
              <Image source={{ uri: getBrandLogo(cheapestStation.name)! }} style={styles.logoSmall} />
            )}
            <View style={styles.stationInfo}>
              <Text style={styles.stationName}>{cheapestStation.name}</Text>
              <Text style={styles.stationDistance}>
                {cheapestStation.driving_distance_km?.toFixed(1) || cheapestStation.distance_km.toFixed(1)} km
                {cheapestStation.driving_duration_min && ` • ${cheapestStation.driving_duration_min} min`}
              </Text>
            </View>
            <View style={styles.priceContainer}>
              <Text style={styles.cheapestPrice}>${cheapestStation.price_per_l?.toFixed(3)}</Text>
              <Text style={styles.perLiterSmall}>/L</Text>
            </View>
          </View>
          {cheapestStation.net_savings < 0 && (
            <Text style={styles.notWorthIt}>
              ⚠️ Not worth the detour (${Math.abs(cheapestStation.net_savings).toFixed(2)} loss)
            </Text>
          )}
        </View>
      )}

      {/* All Stations */}
      <Text style={styles.sectionTitle}>All Stations (by price)</Text>
      
      {stations.map((station, index) => (
        <View 
          key={station.id} 
          style={[
            styles.stationCard,
            station.is_baseline && styles.baselineCard,
            station.worth_it && station.net_savings > 0 && styles.worthItCard,
          ]}
        >
          <View style={styles.stationRow}>
            {getBrandLogo(station.name) ? (
              <Image source={{ uri: getBrandLogo(station.name)! }} style={styles.logoSmall} />
            ) : (
              <View style={styles.logoPlaceholder}>
                <Text style={styles.logoPlaceholderText}>{station.name.charAt(0)}</Text>
              </View>
            )}
            <View style={styles.stationInfo}>
              <Text style={styles.stationName}>{station.name}</Text>
              <Text style={styles.stationDistance}>
                {station.driving_distance_km?.toFixed(1) || station.distance_km.toFixed(1)} km
                {station.driving_duration_min && ` • ${station.driving_duration_min} min`}
              </Text>
            </View>
            <View style={styles.priceContainer}>
              <Text style={[
                styles.stationPrice,
                index === 0 && styles.lowestPrice,
              ]}>
                ${station.price_per_l?.toFixed(3)}
              </Text>
              <Text style={styles.perLiterSmall}>/L</Text>
            </View>
          </View>
          
          {/* Savings info */}
          <View style={styles.savingsRow}>
            {station.is_baseline ? (
              <View style={styles.baselineBadge}>
                <Text style={styles.baselineBadgeText}>📍 Closest station</Text>
              </View>
            ) : station.net_savings > 0 ? (
              <View style={styles.savingsInfo}>
                <Text style={styles.savingsPositive}>+${station.net_savings.toFixed(2)} net savings</Text>
                {station.worth_it && (
                  <View style={styles.worthItBadge}>
                    <Text style={styles.worthItText}>✓ Worth it</Text>
                  </View>
                )}
              </View>
            ) : station.net_savings < 0 ? (
              <Text style={styles.savingsNegative}>
                ${Math.abs(station.net_savings).toFixed(2)} extra cost vs closest
              </Text>
            ) : null}
          </View>
        </View>
      ))}

      <TouchableOpacity style={styles.refreshButton} onPress={onRefresh} disabled={refreshing}>
        <Text style={styles.refreshText}>
          {refreshing ? '🔄 Refreshing...' : '🔄 Refresh Prices'}
        </Text>
      </TouchableOpacity>

      <View style={{ height: 40 }} />
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#f5f5f5',
  },
  centered: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    padding: 20,
    backgroundColor: '#f5f5f5',
  },
  loadingText: {
    marginTop: 16,
    fontSize: 18,
    fontWeight: '600',
    color: '#333',
  },
  loadingSubtext: {
    marginTop: 4,
    fontSize: 14,
    color: '#666',
  },
  errorEmoji: {
    fontSize: 48,
    marginBottom: 16,
  },
  errorText: {
    fontSize: 16,
    color: '#e74c3c',
    textAlign: 'center',
    marginBottom: 20,
  },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingTop: 50,
    paddingBottom: 16,
  },
  title: {
    fontSize: 28,
    fontWeight: 'bold',
    color: '#1a1a2e',
  },
  lastUpdated: {
    fontSize: 12,
    color: '#888',
  },
  sectionTitle: {
    fontSize: 16,
    fontWeight: '600',
    color: '#666',
    marginHorizontal: 16,
    marginTop: 20,
    marginBottom: 12,
  },
  // Best Value Card
  bestCard: {
    backgroundColor: '#e8f5e9',
    marginHorizontal: 16,
    borderRadius: 16,
    overflow: 'hidden',
    borderWidth: 2,
    borderColor: '#4caf50',
  },
  bestBadge: {
    backgroundColor: '#4caf50',
    paddingVertical: 6,
    paddingHorizontal: 12,
  },
  bestBadgeText: {
    color: '#fff',
    fontWeight: 'bold',
    fontSize: 12,
  },
  bestContent: {
    padding: 16,
  },
  bestName: {
    fontSize: 20,
    fontWeight: 'bold',
    color: '#2e7d32',
  },
  bestDistance: {
    fontSize: 14,
    color: '#558b2f',
    marginTop: 2,
  },
  bestPrice: {
    fontSize: 28,
    fontWeight: 'bold',
    color: '#2e7d32',
  },
  savingsContainer: {
    marginTop: 12,
    paddingTop: 12,
    borderTopWidth: 1,
    borderTopColor: '#c8e6c9',
  },
  savingsAmount: {
    fontSize: 18,
    fontWeight: 'bold',
    color: '#2e7d32',
  },
  savingsDetail: {
    fontSize: 12,
    color: '#558b2f',
    marginTop: 2,
  },
  // Cheapest Card
  cheapestCard: {
    backgroundColor: '#fff',
    marginHorizontal: 16,
    marginTop: 12,
    borderRadius: 12,
    overflow: 'hidden',
    borderWidth: 1,
    borderColor: '#2196f3',
  },
  cheapestBadge: {
    backgroundColor: '#2196f3',
    paddingVertical: 4,
    paddingHorizontal: 10,
  },
  cheapestBadgeText: {
    color: '#fff',
    fontWeight: '600',
    fontSize: 11,
  },
  cheapestPrice: {
    fontSize: 22,
    fontWeight: 'bold',
    color: '#1976d2',
  },
  notWorthIt: {
    fontSize: 12,
    color: '#f57c00',
    paddingHorizontal: 16,
    paddingBottom: 12,
  },
  // Station Row
  stationRow: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: 12,
  },
  logo: {
    width: 48,
    height: 48,
    borderRadius: 8,
    marginRight: 12,
  },
  logoSmall: {
    width: 40,
    height: 40,
    borderRadius: 6,
    marginRight: 10,
  },
  logoPlaceholder: {
    width: 40,
    height: 40,
    borderRadius: 6,
    backgroundColor: '#e0e0e0',
    justifyContent: 'center',
    alignItems: 'center',
    marginRight: 10,
  },
  logoPlaceholderText: {
    fontSize: 18,
    fontWeight: 'bold',
    color: '#9e9e9e',
  },
  stationInfo: {
    flex: 1,
  },
  stationName: {
    fontSize: 16,
    fontWeight: '600',
    color: '#333',
  },
  stationDistance: {
    fontSize: 13,
    color: '#666',
    marginTop: 2,
  },
  address: {
    fontSize: 12,
    color: '#888',
    marginTop: 2,
  },
  priceContainer: {
    alignItems: 'flex-end',
  },
  stationPrice: {
    fontSize: 20,
    fontWeight: 'bold',
    color: '#333',
  },
  lowestPrice: {
    color: '#4caf50',
  },
  perLiter: {
    fontSize: 14,
    color: '#666',
  },
  perLiterSmall: {
    fontSize: 12,
    color: '#888',
  },
  // Station Card
  stationCard: {
    backgroundColor: '#fff',
    marginHorizontal: 16,
    marginBottom: 10,
    borderRadius: 12,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.1,
    shadowRadius: 2,
    elevation: 2,
  },
  baselineCard: {
    borderWidth: 1,
    borderColor: '#90caf9',
    backgroundColor: '#f8fbff',
  },
  worthItCard: {
    borderWidth: 1,
    borderColor: '#a5d6a7',
    backgroundColor: '#f9fdf9',
  },
  // Savings Row
  savingsRow: {
    paddingHorizontal: 12,
    paddingBottom: 12,
  },
  savingsInfo: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  savingsPositive: {
    fontSize: 14,
    fontWeight: '600',
    color: '#4caf50',
  },
  savingsNegative: {
    fontSize: 13,
    color: '#f57c00',
  },
  baselineBadge: {
    backgroundColor: '#e3f2fd',
    paddingVertical: 4,
    paddingHorizontal: 8,
    borderRadius: 4,
    alignSelf: 'flex-start',
  },
  baselineBadgeText: {
    fontSize: 12,
    color: '#1976d2',
  },
  worthItBadge: {
    backgroundColor: '#e8f5e9',
    paddingVertical: 4,
    paddingHorizontal: 8,
    borderRadius: 4,
  },
  worthItText: {
    fontSize: 12,
    color: '#2e7d32',
    fontWeight: '600',
  },
  // Buttons
  primaryButton: {
    backgroundColor: '#4285F4',
    paddingVertical: 14,
    paddingHorizontal: 28,
    borderRadius: 8,
  },
  primaryButtonText: {
    color: '#fff',
    fontSize: 16,
    fontWeight: '600',
  },
  refreshButton: {
    backgroundColor: '#fff',
    marginHorizontal: 16,
    paddingVertical: 14,
    borderRadius: 8,
    alignItems: 'center',
    marginTop: 16,
    borderWidth: 1,
    borderColor: '#ddd',
  },
  refreshText: {
    fontSize: 16,
    color: '#333',
  },
});