import { API_BASE } from '@/lib/config';
import { supabase } from '@/lib/supabase';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { useRouter } from 'expo-router';
import { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, Image, RefreshControl, ScrollView, StyleSheet, Text, TouchableOpacity, View } from 'react-native';

const fetchWithTimeout = async (url: string, options?: RequestInit, timeoutMs = 60000) => {
  if (typeof AbortController === 'undefined') {
    return fetch(url, options);
  }

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

  try {
    return await fetch(url, { ...options, signal: controller.signal });
  } finally {
    clearTimeout(timeoutId);
  }
};

const getFetchErrorMessage = (error: any) => {
  const message = (error?.message || String(error || '')).toLowerCase();
  if (error?.name === 'AbortError') {
    return 'Request timed out. Please try again.';
  }
  if (message.includes('failed to fetch') || message.includes('network request failed')) {
    return 'Unable to reach the gas server. Start the proxy server (npm run start-proxy) and try again.';
  }
  return error?.message || 'Failed to fetch gas stations.';
};

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

type SortOption = 'price' | 'distance' | 'savings' | 'worthIt';

const SORT_OPTIONS: { key: SortOption; label: string }[] = [
  { key: 'savings', label: 'Most Savings' },
  { key: 'price', label: 'Lowest Price' },
  { key: 'distance', label: 'Closest' },
];

export default function GasScreen() {
  const router = useRouter();
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [stations, setStations] = useState<StationResult[]>([]);
  const [profile, setProfile] = useState<any>(null);
  const [error, setError] = useState<string | null>(null);
  const [lastUpdated, setLastUpdated] = useState<Date | null>(null);
  const [sortBy, setSortBy] = useState<SortOption>('savings');

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

      if (!profileData?.vehicle_year || !profileData?.vehicle_make || !profileData?.vehicle_model || !profileData?.vehicle_trim) {
        setError('Please complete your vehicle year, make, model, and trim in Profile first.');
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
      const url = `${API_BASE}/gasbuddy/smart?lat=${profileData.home_lat}&lng=${profileData.home_lng}&radius=${radius}`;
      
      console.log('Fetching Ontario gas stations from:', url);
      
      const response = await fetchWithTimeout(url, undefined, 60000);
      
      if (!response.ok) {
        console.error('HTTP error:', response.status, response.statusText);
        if (response.status === 0 || !response.status) {
          throw new Error('Cannot connect to server. Make sure the proxy server is running: cd server && node proxy.js');
        }
        throw new Error(`Server error: ${response.status} ${response.statusText}`);
      }
      
      const data = await response.json();
      console.log('Received data:', data.success, 'stations:', data.stations?.length || 0);

      if (!data.success) throw new Error(data.error || 'Failed to fetch stations');
      
      if (!data.stations || data.stations.length === 0) {
        throw new Error('No gas stations found in your area. The proxy server may be having issues scraping GasBuddy. Try increasing your search radius or check the server logs.');
      }

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
      setError(getFetchErrorMessage(e));
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

  const getSortedStations = (stations: StationResult[]): StationResult[] => {
    const sorted = [...stations];
    switch (sortBy) {
      case 'price':
        return sorted.sort((a, b) => (a.price_per_l || 999) - (b.price_per_l || 999));
      case 'distance':
        return sorted.sort((a, b) => {
          const distA = a.driving_distance_km || a.distance_km;
          const distB = b.driving_distance_km || b.distance_km;
          return distA - distB;
        });
      case 'savings':
        return sorted.sort((a, b) => b.net_savings - a.net_savings);
      case 'worthIt':
        return sorted.sort((a, b) => {
          // Best value first (worth it + highest savings)
          if (a.worth_it && !b.worth_it) return -1;
          if (!a.worth_it && b.worth_it) return 1;
          if (a.worth_it && b.worth_it) return b.net_savings - a.net_savings;
          // Then by price
          return (a.price_per_l || 999) - (b.price_per_l || 999);
        });
      default:
        return sorted;
    }
  };

  const setSortOption = (option: SortOption) => {
    setSortBy(option);
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

  const sortedStations = getSortedStations(stations);
  const displayStations = sortedStations;
  const cheapestStation = [...stations].sort((a, b) => (a.price_per_l || 999) - (b.price_per_l || 999))[0];
  // Find the most worth it station (highest net savings that's worth it)
  const mostWorthItStation = [...stations]
    .filter(s => s.worth_it && s.net_savings > 0)
    .sort((a, b) => b.net_savings - a.net_savings)[0];
  const bestSavingsStation = [...displayStations]
    .filter(s => s.net_savings > 0)
    .sort((a, b) => b.net_savings - a.net_savings)[0];

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

      {/* Cheapest Price Card */}
      {cheapestStation && (
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

      {/* Most Savings */}
      {bestSavingsStation && (
        <View style={styles.cheapestCard}>
          <View style={styles.cheapestBadge}>
            <Text style={styles.cheapestBadgeText}>💚 BEST SAVINGS</Text>
          </View>
          <View style={styles.stationRow}>
            {getBrandLogo(bestSavingsStation.name) ? (
              <Image source={{ uri: getBrandLogo(bestSavingsStation.name)! }} style={styles.logoSmall} />
            ) : (
              <View style={styles.logoPlaceholder}>
                <Text style={styles.logoPlaceholderText}>{bestSavingsStation.name.charAt(0)}</Text>
              </View>
            )}
            <View style={styles.stationInfo}>
              <Text style={styles.stationName}>{bestSavingsStation.name}</Text>
              <Text style={styles.stationDistance}>
                {bestSavingsStation.driving_distance_km?.toFixed(1) || bestSavingsStation.distance_km.toFixed(1)} km
                {bestSavingsStation.driving_duration_min && ` • ${bestSavingsStation.driving_duration_min} min`}
              </Text>
            </View>
            <View style={styles.priceContainer}>
              <Text style={[styles.stationPrice, styles.lowestPrice]}>
                ${bestSavingsStation.price_per_l?.toFixed(3)}
              </Text>
              <Text style={styles.perLiterSmall}>/L</Text>
            </View>
          </View>
          <View style={styles.savingsRow}>
            <Text style={styles.savingsPositive}>+${bestSavingsStation.net_savings.toFixed(2)} net savings</Text>
          </View>
        </View>
      )}

      {/* Sort Controls */}
      <View style={styles.sortContainer}>
        <Text style={styles.sectionTitle}>
          Best Deals
        </Text>
      </View>

      {displayStations.length > 0 && (
        <View style={styles.sortOptionsRow}>
          {SORT_OPTIONS.map(option => (
            <TouchableOpacity
              key={option.key}
              style={[
                styles.sortOption,
                sortBy === option.key && styles.sortOptionActive,
              ]}
              onPress={() => setSortOption(option.key)}
            >
              <Text
                style={[
                  styles.sortOptionText,
                  sortBy === option.key && styles.sortOptionTextActive,
                ]}
              >
                {option.label}
              </Text>
            </TouchableOpacity>
          ))}
        </View>
      )}
      
      {displayStations.map((station, index) => (
        <View 
          key={station.id} 
          style={[
            styles.stationCard,
            station.is_baseline && styles.baselineCard,
            station.worth_it && station.net_savings > 0 && styles.worthItCard,
            bestSavingsStation && station.id === bestSavingsStation.id && styles.bestSavingsCard,
          ]}
        >
          {/* Header Row */}
          <View style={styles.cardHeader}>
            <View style={styles.cardHeaderLeft}>
              {getBrandLogo(station.name) ? (
                <Image source={{ uri: getBrandLogo(station.name)! }} style={styles.logoCard} />
              ) : (
                <View style={styles.logoPlaceholderCard}>
                  <Text style={styles.logoPlaceholderText}>{station.name.charAt(0)}</Text>
                </View>
              )}
              <View style={styles.cardHeaderInfo}>
                <Text style={styles.cardStationName} numberOfLines={1}>{station.name}</Text>
                {station.is_baseline && (
                  <View style={styles.inlineBadge}>
                    <Text style={styles.inlineBadgeText}>📍 Closest</Text>
                  </View>
                )}
                {bestSavingsStation && station.id === bestSavingsStation.id && (
                  <View style={styles.bestSavingsBadge}>
                    <Text style={styles.bestSavingsBadgeText}>💚 Best Savings</Text>
                  </View>
                )}
              </View>
            </View>
            <View style={styles.cardPriceMain}>
              <Text style={[
                styles.cardPrice,
                bestSavingsStation && station.id === bestSavingsStation.id && styles.cardPriceCheapest,
              ]}>
                ${station.price_per_l?.toFixed(3)}
              </Text>
              <Text style={styles.cardPerLiter}>/L</Text>
            </View>
          </View>

          {/* Details Row */}
          <View style={styles.cardDetails}>
            <View style={styles.detailItem}>
              <Text style={styles.detailLabel}>Distance</Text>
              <Text style={styles.detailValue}>
                {station.driving_distance_km?.toFixed(1) || station.distance_km.toFixed(1)} km
              </Text>
            </View>
            {station.driving_duration_min && (
              <View style={styles.detailItem}>
                <Text style={styles.detailLabel}>Drive Time</Text>
                <Text style={styles.detailValue}>{station.driving_duration_min} min</Text>
              </View>
            )}
            <View style={styles.detailItem}>
              <Text style={styles.detailLabel}>Savings</Text>
              <Text style={[
                styles.detailValue, 
                station.net_savings > 0 ? styles.savingsPositiveText : styles.savingsNeutralText
              ]}>
                {station.net_savings > 0 ? '+' : ''}${station.net_savings.toFixed(2)}
              </Text>
            </View>
          </View>

          {/* Status Badge */}
          {station.worth_it && station.net_savings > 0 && (
            <View style={styles.worthItBanner}>
              <Text style={styles.worthItBannerText}>✓ Worth the trip • Save ${station.net_savings.toFixed(2)}</Text>
            </View>
          )}
          {station.net_savings < 0 && !station.is_baseline && (
            <View style={styles.notWorthItBanner}>
              <Text style={styles.notWorthItBannerText}>⚠️ -${Math.abs(station.net_savings).toFixed(2)} net loss</Text>
            </View>
          )}
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
  sortContainer: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginHorizontal: 16,
    marginTop: 20,
    marginBottom: 12,
  },
  sectionTitle: {
    fontSize: 16,
    fontWeight: '600',
    color: '#666',
    flex: 1,
  },
  sortButton: {
    backgroundColor: '#fff',
    paddingVertical: 8,
    paddingHorizontal: 12,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#ddd',
  },
  sortButtonText: {
    fontSize: 13,
    fontWeight: '600',
    color: '#4285F4',
  },
  sortOptionsRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
    marginHorizontal: 16,
    marginBottom: 12,
  },
  categoryBubble: {
    backgroundColor: '#fff',
    marginHorizontal: 16,
    marginTop: 8,
    marginBottom: 12,
    borderRadius: 12,
    padding: 12,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.08,
    shadowRadius: 4,
    elevation: 3,
  },
  categoryHeaderRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 8,
  },
  stationCardInCategory: {
    marginHorizontal: 0,
    marginBottom: 0,
  },
  sortOption: {
    backgroundColor: '#fff',
    paddingVertical: 8,
    paddingHorizontal: 12,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: '#ddd',
  },
  sortOptionActive: {
    backgroundColor: '#4285F4',
    borderColor: '#4285F4',
  },
  sortOptionText: {
    fontSize: 12,
    fontWeight: '600',
    color: '#4285F4',
  },
  sortOptionTextActive: {
    color: '#fff',
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
    marginBottom: 12,
    borderRadius: 12,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.08,
    shadowRadius: 4,
    elevation: 3,
    overflow: 'hidden',
  },
  baselineCard: {
    borderWidth: 2,
    borderColor: '#64b5f6',
  },
  worthItCard: {
    borderWidth: 2,
    borderColor: '#66bb6a',
  },
  bestSavingsCard: {
    borderWidth: 2,
    borderColor: '#2e7d32',
  },
  cardHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    padding: 14,
    backgroundColor: '#fafafa',
  },
  cardHeaderLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    flex: 1,
    marginRight: 12,
  },
  cardHeaderInfo: {
    flex: 1,
    marginLeft: 10,
  },
  logoCard: {
    width: 44,
    height: 44,
    borderRadius: 8,
  },
  logoPlaceholderCard: {
    width: 44,
    height: 44,
    borderRadius: 8,
    backgroundColor: '#e0e0e0',
    justifyContent: 'center',
    alignItems: 'center',
  },
  cardStationName: {
    fontSize: 17,
    fontWeight: '700',
    color: '#1a1a1a',
    marginBottom: 2,
  },
  inlineBadge: {
    alignSelf: 'flex-start',
    backgroundColor: '#e3f2fd',
    paddingVertical: 2,
    paddingHorizontal: 6,
    borderRadius: 4,
    marginTop: 2,
  },
  inlineBadgeText: {
    fontSize: 11,
    color: '#1976d2',
    fontWeight: '600',
  },
  bestSavingsBadge: {
    alignSelf: 'flex-start',
    backgroundColor: '#e8f5e9',
    paddingVertical: 2,
    paddingHorizontal: 6,
    borderRadius: 4,
    marginTop: 4,
  },
  bestSavingsBadgeText: {
    fontSize: 11,
    color: '#2e7d32',
    fontWeight: '700',
  },
  cardPriceMain: {
    alignItems: 'flex-end',
  },
  cardPrice: {
    fontSize: 26,
    fontWeight: '800',
    color: '#333',
  },
  cardPriceCheapest: {
    color: '#2e7d32',
  },
  cardPerLiter: {
    fontSize: 13,
    color: '#888',
    marginTop: -2,
  },
  cardDetails: {
    flexDirection: 'row',
    justifyContent: 'space-around',
    paddingVertical: 12,
    paddingHorizontal: 14,
    backgroundColor: '#fff',
    borderTopWidth: 1,
    borderTopColor: '#f0f0f0',
  },
  detailItem: {
    alignItems: 'center',
    flex: 1,
  },
  detailLabel: {
    fontSize: 11,
    color: '#999',
    textTransform: 'uppercase',
    fontWeight: '600',
    marginBottom: 4,
  },
  detailValue: {
    fontSize: 15,
    fontWeight: '600',
    color: '#333',
  },
  savingsPositiveText: {
    color: '#2e7d32',
  },
  savingsNeutralText: {
    color: '#666',
  },
  savingsNegativeText: {
    color: '#d32f2f',
  },
  worthItBanner: {
    backgroundColor: '#e8f5e9',
    paddingVertical: 8,
    paddingHorizontal: 14,
    alignItems: 'center',
  },
  worthItBannerText: {
    fontSize: 13,
    color: '#2e7d32',
    fontWeight: '700',
  },
  neutralSavingsBanner: {
    backgroundColor: '#f5f5f5',
    paddingVertical: 8,
    paddingHorizontal: 14,
    alignItems: 'center',
  },
  neutralSavingsText: {
    fontSize: 12,
    color: '#666',
    fontWeight: '600',
  },
  notWorthItBanner: {
    backgroundColor: '#fff3e0',
    paddingVertical: 8,
    paddingHorizontal: 14,
    alignItems: 'center',
  },
  notWorthItBannerText: {
    fontSize: 13,
    color: '#f57c00',
    fontWeight: '600',
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