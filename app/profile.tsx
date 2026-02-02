import { supabase } from '@/lib/supabase';
import { Picker } from '@react-native-picker/picker';
import * as Location from 'expo-location';
import { useRouter } from 'expo-router';
import { useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Alert, KeyboardAvoidingView, Platform, ScrollView, StyleSheet, Text, TextInput, TouchableOpacity, View } from 'react-native';

const PROXY_BASE = 'http://localhost:3001/api';
// Temporarily use direct API access since proxy is having issues
const FUELECONOMY_BASE = 'https://www.fueleconomy.gov/ws/rest';

// Fallback list of common makes
const FALLBACK_MAKES = [
  'Acura', 'Audi', 'BMW', 'Buick', 'Cadillac', 'Chevrolet', 'Chrysler',
  'Dodge', 'Ford', 'Genesis', 'GMC', 'Honda', 'Hyundai', 'Infiniti',
  'Jeep', 'Kia', 'Lexus', 'Lincoln', 'Mazda', 'Mercedes-Benz', 'Mitsubishi',
  'Nissan', 'Ram', 'Subaru', 'Tesla', 'Toyota', 'Volkswagen', 'Volvo'
];

export default function ProfileScreen() {
  const router = useRouter();
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  
  const initialLoadDone = useRef(false);
  const savedVehicleData = useRef<{make: string, model: string, trim: string}>({make: '', model: '', trim: ''});

  const [profile, setProfile] = useState<any>({
    vehicle_year: '',
    vehicle_make: '',
    vehicle_model: '',
    vehicle_trim: '',
    tank_size_l: '',
    fuel_efficiency: '',
    fuel_type: '',
    home_lat: '',
    home_lng: '',
    max_detour_km: '5.0',
    min_savings: '1.0',
    search_radius_km: '15.0',
  });

  const [years] = useState(() => {
    const now = new Date().getFullYear();
    const list: string[] = [];
    for (let y = now + 1; y >= 1980; y--) list.push(String(y));
    return list;
  });
  
  const [makes, setMakes] = useState<string[]>([]);
  const [models, setModels] = useState<string[]>([]);
  const [trims, setTrims] = useState<{ value: string; text: string }[]>([]);
  const [selectedTrimId, setSelectedTrimId] = useState<string>('');
  const [lookupError, setLookupError] = useState<string | null>(null);
  const [manualFuelMode, setManualFuelMode] = useState(false);
  const [makesLoading, setMakesLoading] = useState(false);
  const [modelsLoading, setModelsLoading] = useState(false);
  const [locationLoading, setLocationLoading] = useState(false);
  const [locationFailed, setLocationFailed] = useState(false);
  const [apiError, setApiError] = useState<string | null>(null);

  const makesCache = useRef<Record<string, string[]>>({});
  const modelsCache = useRef<Record<string, string[]>>({});

  useEffect(() => {
    let mounted = true;

    (async () => {
      setLoading(true);
      try {
        const { data: { session }, error: sessionError } = await supabase.auth.getSession();
        if (sessionError) {
          console.error('Session error:', sessionError);
          throw new Error('Authentication error. Please log in again.');
        }
        
        const user = session?.user;
        if (!user) {
          console.log('No user session, redirecting to login');
          router.replace('/login');
          return;
        }

        console.log('Loading profile for user:', user.id);
        const { data, error } = await supabase.from('profiles').select('*').eq('id', user.id).maybeSingle();
        
        if (error) {
          console.error('Supabase fetch error:', error);
          throw new Error(`Database error: ${error.message}`);
        }
        
        if (!mounted) return;

        if (data) {
          console.log('Profile data loaded successfully');
          savedVehicleData.current = {
            make: data.vehicle_make ?? '',
            model: data.vehicle_model ?? '',
            trim: data.vehicle_trim ?? '',
          };
          
          setProfile({
            vehicle_year: data.vehicle_year?.toString() ?? '',
            vehicle_make: data.vehicle_make ?? '',
            vehicle_model: data.vehicle_model ?? '',
            vehicle_trim: data.vehicle_trim ?? '',
            tank_size_l: data.tank_size_l?.toString() ?? '',
            fuel_efficiency: data.fuel_efficiency?.toString() ?? '',
            fuel_type: data.fuel_type ?? '',
            home_lat: data.home_lat?.toString() ?? '',
            home_lng: data.home_lng?.toString() ?? '',
            max_detour_km: data.max_detour_km?.toString() ?? '5.0',
            min_savings: data.min_savings?.toString() ?? '1.0',
            search_radius_km: data.search_radius_km?.toString() ?? '15.0',
          });
        } else {
          console.log('No existing profile data, starting fresh');
        }
      } catch (e: any) {
        console.error('Load profile error:', e);
        // Don't block the UI - let user create new profile even if load fails
        if (e.message?.includes('Authentication') || e.message?.includes('log in')) {
          Alert.alert('Session Expired', 'Please log in again.', [
            { text: 'OK', onPress: () => router.replace('/login') }
          ]);
        } else {
          Alert.alert(
            'Load Error', 
            'Could not load existing profile. You can still create a new one.\n\n' + (e.message || 'Unknown error'),
            [{ text: 'OK' }]
          );
        }
      } finally {
        if (mounted) setLoading(false);
      }
    })();

    return () => { mounted = false; };
  }, [router]);

  useEffect(() => {
    const year = profile.vehicle_year;
    if (!year) return;

    let mounted = true;
    (async () => {
      setMakesLoading(true);
      setApiError(null);
      try {
        let makesList: string[];
        if (makesCache.current[year]) {
          makesList = makesCache.current[year];
        } else {
          const res = await fetch(`${FUELECONOMY_BASE}/vehicle/menu/make?year=${year}`);
          if (!res.ok) throw new Error(`HTTP ${res.status}: ${res.statusText}`);
          const text = await res.text();
          if (!mounted) return;
          console.log('Makes API response:', text.substring(0, 500));
          const matches = [...text.matchAll(/<text>([^<]+)<\/text>/g)];
          const list = matches.map(m => m[1]).filter(Boolean);
          makesList = list.length > 0 ? [...new Set(list)].sort() : FALLBACK_MAKES;
          console.log('Parsed makes:', makesList.length, makesList.slice(0, 5));
          makesCache.current[year] = makesList;
        }
        setMakes(makesList);
        
        if (!initialLoadDone.current && savedVehicleData.current.make) {
          if (makesList.includes(savedVehicleData.current.make)) {
            setProfile((p: any) => ({ ...p, vehicle_make: savedVehicleData.current.make }));
          }
        } else if (initialLoadDone.current) {
          setModels([]);
          setTrims([]);
          setProfile((p: any) => ({ ...p, vehicle_make: '', vehicle_model: '', vehicle_trim: '' }));
        }
      } catch (e: any) {
        console.error('Failed to load makes', e);
        const errorMsg = e.message || 'Network error';
        setApiError(`Unable to load vehicle makes from API. Using fallback list.`);
        // Use fallback makes if API fails
        setMakes(FALLBACK_MAKES);
      } finally {
        if (mounted) setMakesLoading(false);
      }
    })();

    return () => { mounted = false; };
  }, [profile.vehicle_year]);

  useEffect(() => {
    const year = profile.vehicle_year;
    const make = profile.vehicle_make;
    if (!year || !make) return;

    let mounted = true;
    (async () => {
      setModelsLoading(true);
      try {
        const cacheKey = `${year}|${make}`;
        let modelsList: string[];
        if (modelsCache.current[cacheKey]) {
          modelsList = modelsCache.current[cacheKey];
        } else {
          const res = await fetch(`${FUELECONOMY_BASE}/vehicle/menu/model?year=${year}&make=${encodeURIComponent(make)}`);
          const text = await res.text();
          if (!mounted) return;
          console.log('Models API response:', text.substring(0, 500));
          const matches = [...text.matchAll(/<text>([^<]+)<\/text>/g)];
          const list = matches.map(m => m[1]).filter(Boolean);
          modelsList = [...new Set(list)].sort();
          console.log('Parsed models:', modelsList.length, modelsList.slice(0, 5));
          modelsCache.current[cacheKey] = modelsList;
        }
        setModels(modelsList);
        
        if (!initialLoadDone.current && savedVehicleData.current.model) {
          if (modelsList.includes(savedVehicleData.current.model)) {
            setProfile((p: any) => ({ ...p, vehicle_model: savedVehicleData.current.model }));
          }
          setTimeout(() => { initialLoadDone.current = true; }, 500);
        } else if (initialLoadDone.current) {
          setTrims([]);
          setProfile((p: any) => ({ ...p, vehicle_model: '', vehicle_trim: '' }));
        }
      } catch (e: any) {
        console.error('Failed to load models', e);
        const errorMsg = e.message || 'Network error';
        setApiError(`Unable to load vehicle models: ${errorMsg}`);
        setModels([]);
      } finally {
        if (mounted) setModelsLoading(false);
      }
    })();

    return () => { mounted = false; };
  }, [profile.vehicle_make, profile.vehicle_year]);

  useEffect(() => {
    const year = profile.vehicle_year;
    const make = profile.vehicle_make;
    const model = profile.vehicle_model;
    if (!year || !make || !model) return;

    let mounted = true;
    (async () => {
      try {
        const optsRes = await fetch(`${FUELECONOMY_BASE}/vehicle/menu/options?year=${year}&make=${encodeURIComponent(make)}&model=${encodeURIComponent(model)}`);
        const optsText = await optsRes.text();
        if (!mounted) return;
        
        const itemRegex = /<menuItem>[\s\S]*?<text>([\s\S]*?)<\/text>[\s\S]*?<value>(\d+)<\/value>[\s\S]*?<\/menuItem>/g;
        const found: { value: string; text: string }[] = [];
        let m;
        while ((m = itemRegex.exec(optsText)) !== null) {
          found.push({ text: m[1], value: m[2] });
        }
        
        if (found.length > 0) {
          setTrims(found);
          
          if (!initialLoadDone.current && savedVehicleData.current.trim) {
            const matchingTrim = found.find(t => t.text === savedVehicleData.current.trim);
            if (matchingTrim) {
              setSelectedTrimId(matchingTrim.value);
              setProfile((p: any) => ({ ...p, vehicle_trim: matchingTrim.text }));
            }
          } else if (found.length === 1) {
            setSelectedTrimId(found[0].value);
            setProfile((p: any) => ({ ...p, vehicle_trim: found[0].text }));
          } else {
            setSelectedTrimId('');
          }
          return;
        }

        const menuRes = await fetch(`${FUELECONOMY_BASE}/vehicle/menu/model?year=${year}&make=${encodeURIComponent(make)}&model=${encodeURIComponent(model)}`);
        const menuText = await menuRes.text();
        const idMatch = menuText.match(/<value>(\d+)<\/value>/);
        if (!idMatch) return;
        
        const vid = idMatch[1];
        const vehRes = await fetch(`${FUELECONOMY_BASE}/vehicle/${vid}`);
        const vehText = await vehRes.text();
        const combMatch = vehText.match(/<comb08>([0-9.]+)<\/comb08>/);
        const fuelTypeMatch = vehText.match(/<fuelType>([^<]+)<\/fuelType>/);
        if (!mounted) return;
        
        if (combMatch) {
          const mpg = parseFloat(combMatch[1]);
          const lPer100km = +(235.214583 / mpg).toFixed(2);
          setProfile((p: any) => ({ ...p, fuel_efficiency: String(lPer100km) }));
          setLookupError(null);
        }
        if (fuelTypeMatch) {
          setProfile((p: any) => ({ ...p, fuel_type: fuelTypeMatch[1] }));
        }
      } catch (e: any) {
        console.error('Failed to lookup fuel economy', e);
        const errorMsg = e.message || 'Network error';
        setLookupError(errorMsg);
        setManualFuelMode(true);
      }
    })();

    return () => { mounted = false; };
  }, [profile.vehicle_model]);

  useEffect(() => {
    const vid = selectedTrimId;
    if (!vid) return;
    
    let mounted = true;
    (async () => {
      try {
        const vehRes = await fetch(`${FUELECONOMY_BASE}/vehicle/${vid}`);
        const vehText = await vehRes.text();
        const combMatch = vehText.match(/<comb08>([0-9.]+)<\/comb08>/);
        const fuelTypeMatch = vehText.match(/<fuelType>([^<]+)<\/fuelType>/);
        if (!mounted) return;
        
        if (combMatch) {
          const mpg = parseFloat(combMatch[1]);
          const lPer100km = +(235.214583 / mpg).toFixed(2);
          setProfile((p: any) => ({ ...p, fuel_efficiency: String(lPer100km) }));
          setLookupError(null);
          setManualFuelMode(false);
        }
        if (fuelTypeMatch) {
          setProfile((p: any) => ({ ...p, fuel_type: fuelTypeMatch[1] }));
        }
      } catch (e: any) {
        console.error('Failed to fetch vehicle details', e);
        const errorMsg = e.message || 'Network error';
        setLookupError(errorMsg);
        setManualFuelMode(true);
      }
    })();

    return () => { mounted = false; };
  }, [selectedTrimId]);

  const save = async () => {
    if (saving) return;
    
    setSaving(true);
    
    try {
      const { data: { session } } = await supabase.auth.getSession();
      const user = session?.user;
      
      if (!user) {
        setSaving(false);
        Alert.alert('Session Expired', 'Please log in again.');
        router.replace('/login');
        return;
      }

      const payload = {
        id: user.id,
        vehicle_year: profile.vehicle_year ? parseInt(profile.vehicle_year, 10) : null,
        vehicle_make: profile.vehicle_make || null,
        vehicle_model: profile.vehicle_model || null,
        vehicle_trim: profile.vehicle_trim || null,
        tank_size_l: profile.tank_size_l ? parseFloat(profile.tank_size_l) : null,
        fuel_efficiency: profile.fuel_efficiency ? parseFloat(profile.fuel_efficiency) : null,
        fuel_type: profile.fuel_type || null,
        home_lat: profile.home_lat ? parseFloat(profile.home_lat) : null,
        home_lng: profile.home_lng ? parseFloat(profile.home_lng) : null,
        max_detour_km: profile.max_detour_km ? parseFloat(profile.max_detour_km) : 5.0,
        min_savings: profile.min_savings ? parseFloat(profile.min_savings) : 1.0,
        search_radius_km: profile.search_radius_km ? parseFloat(profile.search_radius_km) : 15.0,
        updated_at: new Date().toISOString(),
      };

      const { error } = await supabase.from('profiles').upsert(payload);
      
      if (error) {
        setSaving(false);
        Alert.alert('Error', error.message || 'Failed to save profile');
        return;
      }
      
      setSaving(false);

      // Return to main page view after save
      router.replace('/(tabs)/');
      
    } catch (error: any) {
      setSaving(false);
      console.error('Save error:', error);
      Alert.alert('Error', error.message || 'Failed to save profile');
    }
  };

  const getLocation = async () => {
    setLocationFailed(false);
    setLocationLoading(true);
    try {
      const { status } = await Location.requestForegroundPermissionsAsync();
      if (status !== 'granted') {
        Alert.alert('Permission denied', 'Location permission is required.');
        setLocationFailed(true);
        return;
      }
      const pos = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.High, timeout: 15000 });
      setProfile((p: any) => ({ 
        ...p, 
        home_lat: String(pos.coords.latitude), 
        home_lng: String(pos.coords.longitude) 
      }));
    } catch (e: any) {
      console.error('Location error', e);
      setLocationFailed(true);
      Alert.alert('Error', e.message || 'Failed to get location');
    } finally {
      setLocationLoading(false);
    }
  };

  if (loading) {
    return (
      <View style={styles.centered}>
        <ActivityIndicator size="large" color="#4285F4" />
        <Text style={styles.loadingText}>Loading profile...</Text>
      </View>
    );
  }

  return (
    <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <ScrollView style={styles.scrollView} contentContainerStyle={styles.container} keyboardShouldPersistTaps="handled">
        <Text style={styles.title}>Your Profile</Text>

        {apiError && (
          <View style={styles.errorBox}>
            <Text style={styles.errorText}>⚠️ {apiError}</Text>
            <Text style={styles.errorSubtext}>You can still enter vehicle information manually below.</Text>
            <TouchableOpacity onPress={() => setApiError(null)} style={styles.dismissButton}>
              <Text style={styles.dismissButtonText}>Dismiss</Text>
            </TouchableOpacity>
          </View>
        )}

        {/* Vehicle Section */}
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>🚗 Vehicle Information</Text>
          
          <Text style={styles.label}>Year</Text>
          <View style={styles.pickerContainer}>
            <Picker 
              selectedValue={profile.vehicle_year} 
              onValueChange={(v) => setProfile({ ...profile, vehicle_year: v })}
              style={styles.picker}
            >
              <Picker.Item label="Select year" value="" />
              {years.map((y) => (
                <Picker.Item key={y} label={y} value={y} />
              ))}
            </Picker>
          </View>

          <Text style={styles.label}>Make</Text>
          <View style={styles.pickerContainer}>
            <Picker
              selectedValue={profile.vehicle_make}
              onValueChange={(v) => setProfile({ ...profile, vehicle_make: v })}
              enabled={!!profile.vehicle_year && !makesLoading}
              style={styles.picker}
            >
              <Picker.Item label={makesLoading ? 'Loading...' : 'Select make'} value="" />
              {makes.map((m) => <Picker.Item key={m} label={m} value={m} />)}
            </Picker>
          </View>

          <Text style={styles.label}>Model</Text>
          <View style={styles.pickerContainer}>
            <Picker
              selectedValue={profile.vehicle_model}
              onValueChange={(v) => setProfile({ ...profile, vehicle_model: v })}
              enabled={!!profile.vehicle_make && !modelsLoading}
              style={styles.picker}
            >
              <Picker.Item label={modelsLoading ? 'Loading...' : 'Select model'} value="" />
              {models.map((m) => <Picker.Item key={m} label={m} value={m} />)}
            </Picker>
          </View>

          <Text style={styles.label}>Trim</Text>
          {trims.length > 0 ? (
            <View style={styles.pickerContainer}>
              <Picker 
                selectedValue={selectedTrimId} 
                onValueChange={(v) => {
                  setSelectedTrimId(v);
                  const found = trims.find(t => t.value === v);
                  setProfile((p: any) => ({ ...p, vehicle_trim: found?.text ?? '' }));
                }}
                style={styles.picker}
              >
                <Picker.Item label="Select trim" value="" />
                {trims.map((t) => (
                  <Picker.Item key={t.value} label={t.text} value={t.value} />
                ))}
              </Picker>
            </View>
          ) : (
            <TextInput 
              style={styles.input} 
              value={profile.vehicle_trim} 
              onChangeText={(t) => setProfile({ ...profile, vehicle_trim: t })} 
              placeholder="Enter trim (optional)"
            />
          )}

          {profile.fuel_efficiency ? (
            <View style={styles.infoBox}>
              <Text style={styles.infoText}>⛽ Fuel efficiency: {profile.fuel_efficiency} L/100km</Text>
              <Text style={styles.infoText}>🔋 Fuel type: {profile.fuel_type || 'Unknown'}</Text>
            </View>
          ) : null}

          {lookupError && (
            <TouchableOpacity style={styles.warningBox} onPress={() => setManualFuelMode(!manualFuelMode)}>
              <Text style={styles.warningText}>⚠️ Auto-lookup failed. Tap to enter manually.</Text>
            </TouchableOpacity>
          )}

          {manualFuelMode && (
            <>
              <Text style={styles.label}>Fuel Efficiency (L/100km)</Text>
              <TextInput 
                style={styles.input} 
                keyboardType="numeric" 
                value={profile.fuel_efficiency} 
                onChangeText={(t) => setProfile({ ...profile, fuel_efficiency: t })} 
                placeholder="e.g., 10.5"
              />
              <Text style={styles.label}>Fuel Type</Text>
              <TextInput 
                style={styles.input} 
                value={profile.fuel_type} 
                onChangeText={(t) => setProfile({ ...profile, fuel_type: t })}
                placeholder="e.g., Regular"
              />
            </>
          )}

          <Text style={styles.label}>Tank Size (L)</Text>
          <TextInput 
            style={styles.input} 
            keyboardType="numeric"
            value={profile.tank_size_l} 
            onChangeText={(t) => setProfile({ ...profile, tank_size_l: t })}
            placeholder="e.g., 60"
          />
        </View>

        {/* Location Section */}
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>📍 Home Location</Text>
          
          <TouchableOpacity style={styles.locationButton} onPress={getLocation} disabled={locationLoading}>
            {locationLoading ? (
              <ActivityIndicator color="#fff" />
            ) : (
              <Text style={styles.locationButtonText}>
                📍 Find my location for me
              </Text>
            )}
          </TouchableOpacity>
          
          {profile.home_lat && profile.home_lng && (
            <Text style={styles.coordsText}>
              Current: {parseFloat(profile.home_lat).toFixed(4)}, {parseFloat(profile.home_lng).toFixed(4)}
            </Text>
          )}
          
          {locationFailed && (
            <>
              <Text style={styles.subLabel}>Or enter coordinates manually:</Text>
              <View style={styles.row}>
                <TextInput
                  style={[styles.input, styles.halfInput]}
                  placeholder="Latitude"
                  keyboardType="decimal-pad"
                  value={profile.home_lat}
                  onChangeText={(t) => setProfile({ ...profile, home_lat: t })}
                />
                <TextInput
                  style={[styles.input, styles.halfInput]}
                  placeholder="Longitude"
                  keyboardType="decimal-pad"
                  value={profile.home_lng}
                  onChangeText={(t) => setProfile({ ...profile, home_lng: t })}
                />
              </View>
            </>
          )}
        </View>

        {/* Search Settings Section */}
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>⚙️ Search Settings</Text>

          <Text style={styles.label}>Search Radius (km)</Text>
          <TextInput 
            style={styles.input} 
            keyboardType="numeric" 
            value={profile.search_radius_km} 
            onChangeText={(t) => setProfile({ ...profile, search_radius_km: t })}
            placeholder="15"
          />
          <Text style={styles.helpText}>How far to search for gas stations</Text>

          <Text style={styles.label}>Max Detour (km)</Text>
          <TextInput 
            style={styles.input} 
            keyboardType="numeric" 
            value={profile.max_detour_km} 
            onChangeText={(t) => setProfile({ ...profile, max_detour_km: t })}
            placeholder="5"
          />
          <Text style={styles.helpText}>Maximum extra distance you're willing to drive</Text>

          <Text style={styles.label}>Minimum Savings ($)</Text>
          <TextInput 
            style={styles.input} 
            keyboardType="numeric" 
            value={profile.min_savings} 
            onChangeText={(t) => setProfile({ ...profile, min_savings: t })}
            placeholder="1.00"
          />
          <Text style={styles.helpText}>Only show "worth it" if savings exceed this amount</Text>
        </View>

        {/* Save Buttons */}
        <TouchableOpacity 
          style={[styles.saveButton, saving && styles.saveButtonDisabled]} 
          onPress={save} 
          disabled={saving}
        >
          <Text style={styles.saveButtonText}>{saving ? 'Saving...' : 'Save Profile'}</Text>
        </TouchableOpacity>
        
        <TouchableOpacity style={styles.cancelButton} onPress={() => router.back()}>
          <Text style={styles.cancelButtonText}>Cancel</Text>
        </TouchableOpacity>

        <View style={{ height: 40 }} />
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  scrollView: {
    flex: 1,
    backgroundColor: '#f5f5f5',
  },
  container: {
    padding: 16,
  },
  centered: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: '#f5f5f5',
  },
  loadingText: {
    marginTop: 12,
    fontSize: 16,
    color: '#666',
  },
  title: {
    fontSize: 28,
    fontWeight: 'bold',
    marginBottom: 20,
    marginTop: 40,
    color: '#1a1a2e',
  },
  section: {
    backgroundColor: '#fff',
    borderRadius: 12,
    padding: 16,
    marginBottom: 16,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.1,
    shadowRadius: 2,
    elevation: 2,
  },
  sectionTitle: {
    fontSize: 18,
    fontWeight: '600',
    marginBottom: 16,
    color: '#333',
  },
  label: {
    marginTop: 12,
    marginBottom: 6,
    color: '#333',
    fontWeight: '500',
    fontSize: 14,
  },
  subLabel: {
    marginTop: 12,
    marginBottom: 6,
    color: '#666',
    fontSize: 13,
  },
  helpText: {
    color: '#888',
    fontSize: 12,
    marginTop: 4,
  },
  input: {
    borderWidth: 1,
    borderColor: '#ddd',
    padding: 12,
    borderRadius: 8,
    fontSize: 16,
    backgroundColor: '#fafafa',
  },
  pickerContainer: {
    borderWidth: 1,
    borderColor: '#ddd',
    borderRadius: 8,
    overflow: 'hidden',
    backgroundColor: '#fafafa',
  },
  picker: {
    height: 50,
  },
  row: {
    flexDirection: 'row',
    gap: 10,
  },
  halfInput: {
    flex: 1,
  },
  infoBox: {
    backgroundColor: '#e3f2fd',
    padding: 12,
    borderRadius: 8,
    marginTop: 12,
  },
  infoText: {
    color: '#1976d2',
    fontSize: 14,
    marginBottom: 4,
  },
  warningBox: {
    backgroundColor: '#fff3e0',
    padding: 12,
    borderRadius: 8,
    marginTop: 12,
  },
  warningText: {
    color: '#f57c00',
    fontSize: 14,
  },
  errorBox: {
    backgroundColor: '#ffebee',
    padding: 16,
    borderRadius: 8,
    marginBottom: 16,
  },
  errorText: {
    color: '#c62828',
    fontSize: 14,
    fontWeight: '600',
    marginBottom: 4,
  },
  errorSubtext: {
    color: '#d32f2f',
    fontSize: 13,
    marginTop: 4,
  },
  dismissButton: {
    marginTop: 10,
    padding: 8,
    backgroundColor: '#fff',
    borderRadius: 6,
    alignSelf: 'flex-start',
  },
  dismissButtonText: {
    color: '#c62828',
    fontSize: 13,
    fontWeight: '600',
  },
  locationButton: {
    backgroundColor: '#4285F4',
    padding: 14,
    borderRadius: 8,
    alignItems: 'center',
  },
  locationButtonText: {
    color: '#fff',
    fontSize: 16,
    fontWeight: '600',
  },
  coordsText: {
    textAlign: 'center',
    color: '#666',
    fontSize: 13,
    marginTop: 8,
  },
  saveButton: {
    backgroundColor: '#4caf50',
    padding: 16,
    borderRadius: 8,
    alignItems: 'center',
    marginTop: 8,
  },
  saveButtonDisabled: {
    backgroundColor: '#a5d6a7',
  },
  saveButtonText: {
    color: '#fff',
    fontSize: 18,
    fontWeight: '600',
  },
  cancelButton: {
    backgroundColor: '#fff',
    padding: 14,
    borderRadius: 8,
    alignItems: 'center',
    marginTop: 10,
    borderWidth: 1,
    borderColor: '#ddd',
  },
  cancelButtonText: {
    color: '#666',
    fontSize: 16,
  },
});