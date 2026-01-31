import { supabase } from '@/lib/supabase';
import { Picker } from '@react-native-picker/picker';
import * as Location from 'expo-location';
import { useRouter } from 'expo-router';
import React, { useEffect, useState } from 'react';
import { Alert, Button, KeyboardAvoidingView, Platform, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';

// Use local proxy for web to avoid CORS issues during development
const PROXY_BASE = 'http://localhost:3001/api';
const NHTSA_BASE = Platform.OS === 'web' ? `${PROXY_BASE}/nhtsa` : 'https://vpic.nhtsa.dot.gov/api/vehicles';
const FUELECONOMY_BASE = Platform.OS === 'web' ? `${PROXY_BASE}/fueleconomy` : 'https://www.fueleconomy.gov/ws/rest';

export default function ProfileScreen() {
  const router = useRouter();
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

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
  });

  const [years] = useState(() => {
    const now = new Date().getFullYear();
    const list: string[] = [];
    for (let y = now; y >= 1980; y--) list.push(String(y));
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

  // simple in-memory caches to reduce API calls
  const makesCache = React.useRef<Record<string, string[]>>({});
  const modelsCache = React.useRef<Record<string, string[]>>({});

  useEffect(() => {
    let mounted = true;

    (async () => {
      setLoading(true);
      try {
        const {
          data: { session },
        } = await supabase.auth.getSession();
        const user = session?.user;
        if (!user) {
          router.replace('/login');
          return;
        }

        const { data, error } = await supabase.from('profiles').select('*').eq('id', user.id).maybeSingle();
        if (error) throw error;
        if (!mounted) return;

        if (data) {
          // Map null/number values to strings for inputs
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
          });
        }
      } catch (e: any) {
        console.error('Load profile error', e);
        Alert.alert('Error', e.message || 'Failed to load profile');
      } finally {
        if (mounted) setLoading(false);
      }
    })();

    return () => {
      mounted = false;
    };
  }, [router]);

  useEffect(() => {
  // When vehicle_year changes, fetch makes from FuelEconomy.gov
  const year = profile.vehicle_year;
  if (!year) return;

  let mounted = true;
  (async () => {
    setMakesLoading(true);
    try {
      if (makesCache.current[year]) {
        setMakes(makesCache.current[year]);
      } else {
        const res = await fetch(`${FUELECONOMY_BASE}/vehicle/menu/make?year=${year}`);
        const text = await res.text();
        if (!mounted) return;
        // Parse XML: extract all <value> tags
        const matches = [...text.matchAll(/<value>([^<]+)<\/value>/g)];
        const list = matches.map(m => m[1]).filter(Boolean);
        const unique = [...new Set(list)].sort();
        makesCache.current[year] = unique;
        setMakes(unique);
      }
      setModels([]);
      setProfile((p: any) => ({ ...p, vehicle_make: '', vehicle_model: '' }));
    } catch (e) {
      console.warn('Failed to load makes', e);
      setMakes([]);
    } finally {
      if (mounted) setMakesLoading(false);
    }
  })();

  return () => { mounted = false; };
}, [profile.vehicle_year]);

useEffect(() => {
  // When make changes, fetch models from FuelEconomy.gov
  const year = profile.vehicle_year;
  const make = profile.vehicle_make;
  if (!year || !make) return;

  let mounted = true;
  (async () => {
    setModelsLoading(true);
    try {
      const cacheKey = `${year}|${make}`;
      if (modelsCache.current[cacheKey]) {
        setModels(modelsCache.current[cacheKey]);
      } else {
        const res = await fetch(`${FUELECONOMY_BASE}/vehicle/menu/model?year=${year}&make=${encodeURIComponent(make)}`);
        const text = await res.text();
        if (!mounted) return;
        // Parse XML: extract all <value> tags
        const matches = [...text.matchAll(/<value>([^<]+)<\/value>/g)];
        const list = matches.map(m => m[1]).filter(Boolean);
        const unique = [...new Set(list)].sort();
        modelsCache.current[cacheKey] = unique;
        setModels(unique);
      }
      setProfile((p: any) => ({ ...p, vehicle_model: '' }));
    } catch (e) {
      console.warn('Failed to load models', e);
      setModels([]);
    } finally {
      if (mounted) setModelsLoading(false);
    }
  })();

  return () => { mounted = false; };
}, [profile.vehicle_make, profile.vehicle_year]);

  useEffect(() => {
    // When model selected, fetch fueleconomy to auto-fill fuel_efficiency and fuel_type
    const year = profile.vehicle_year;
    const make = profile.vehicle_make;
    const model = profile.vehicle_model;
    if (!year || !make || !model) return;

    let mounted = true;
    (async () => {
      try {
        // first try to get trims/options for the model (menu/options)
        const optsRes = await fetch(`${FUELECONOMY_BASE}/vehicle/menu/options?year=${year}&make=${encodeURIComponent(make)}&model=${encodeURIComponent(model)}`);
        const optsText = await optsRes.text();
        if (!mounted) return;
        // parse all <menuItem> entries to extract <text> and <value>
        const itemRegex = /<menuItem>[\s\S]*?<text>([\s\S]*?)<\/text>[\s\S]*?<value>(\d+)<\/value>[\s\S]*?<\/menuItem>/g;
        const found: { value: string; text: string }[] = [];
        let m;
        // eslint-disable-next-line no-cond-assign
        while ((m = itemRegex.exec(optsText)) !== null) {
          found.push({ text: m[1], value: m[2] });
        }
        if (found.length > 0) {
          setTrims(found);
          setSelectedTrimId('');
          // if only one trim, auto-select it and fetch details
          if (found.length === 1) {
            setSelectedTrimId(found[0].value);
          }
          return;
        }

        // fallback: try the model menu which may return a single value
        const menuRes = await fetch(`${FUELECONOMY_BASE}/vehicle/menu/model?year=${year}&make=${encodeURIComponent(make)}&model=${encodeURIComponent(model)}`);
        const menuText = await menuRes.text();
        const idMatch = menuText.match(/<value>(\d+)<\/value>/);
        if (!idMatch) return;
        const vid = idMatch[1];
        // fetch vehicle details directly
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
        console.warn('Failed to lookup fuel economy', e);
        setLookupError(String(e?.message ?? e));
      }
    })();

    return () => {
      mounted = false;
    };
  }, [profile.vehicle_model]);

  useEffect(() => {
    // when a trim id is selected, fetch vehicle details for that trim id
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
        console.warn('Failed to fetch vehicle details', e);
        setLookupError(String(e?.message ?? e));
      }
    })();

    return () => {
      mounted = false;
    };
  }, [selectedTrimId]);

  const save = async () => {
    setSaving(true);
    try {
      const {
        data: { session },
      } = await supabase.auth.getSession();
      const user = session?.user;
      if (!user) {
        router.replace('/login');
        return;
      }

      const payload: any = {
        id: user.id,
        vehicle_year: profile.vehicle_year === '' ? null : parseInt(profile.vehicle_year, 10),
        vehicle_make: profile.vehicle_make || null,
        vehicle_model: profile.vehicle_model || null,
        vehicle_trim: profile.vehicle_trim || null,
        tank_size_l: profile.tank_size_l === '' ? null : parseFloat(profile.tank_size_l),
        fuel_efficiency: profile.fuel_efficiency === '' ? null : parseFloat(profile.fuel_efficiency),
        fuel_type: profile.fuel_type || null,
        home_lat: profile.home_lat === '' ? null : parseFloat(profile.home_lat),
        home_lng: profile.home_lng === '' ? null : parseFloat(profile.home_lng),
        max_detour_km: profile.max_detour_km === '' ? 5.0 : parseFloat(profile.max_detour_km),
        min_savings: profile.min_savings === '' ? 1.0 : parseFloat(profile.min_savings),
        updated_at: new Date().toISOString(),
      };

      const { error } = await supabase.from('profiles').upsert(payload, { returning: 'minimal' });
      if (error) throw error;
      Alert.alert('Saved', 'Profile saved successfully');
      router.back();
    } catch (e: any) {
      console.error('Save profile error', e);
      Alert.alert('Error', e.message || 'Failed to save profile');
    } finally {
      setSaving(false);
    }
  };

  return (
    <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <ScrollView contentContainerStyle={styles.container} keyboardShouldPersistTaps="handled">
        <Text style={styles.title}>Your Profile</Text>

        <Text style={styles.label}>Vehicle Year</Text>
        <View style={{ borderWidth: 1, borderColor: '#ddd', borderRadius: 6, overflow: 'hidden' }}>
          <Picker selectedValue={profile.vehicle_year} onValueChange={(v) => setProfile({ ...profile, vehicle_year: v })}>
            <Picker.Item label="Select year" value="" />
            {years.map((y) => (
              <Picker.Item key={y} label={y} value={y} />
            ))}
          </Picker>
        </View>

        <Text style={styles.label}>Vehicle Make</Text>
        <View style={{ borderWidth: 1, borderColor: '#ddd', borderRadius: 6, overflow: 'hidden' }}>
          <Picker
            selectedValue={profile.vehicle_make}
            onValueChange={(v) => setProfile({ ...profile, vehicle_make: v })}
            enabled={!!profile.vehicle_year && !makesLoading}
          >
            <Picker.Item label={makesLoading ? 'Loading makes...' : 'Select make'} value="" />
            {!makesLoading && makes.length === 0 ? (
              <Picker.Item label="No makes found" value="" />
            ) : (
              makes.map((m) => <Picker.Item key={m} label={m} value={m} />)
            )}
          </Picker>
        </View>

        <Text style={styles.label}>Vehicle Model</Text>
        <View style={{ borderWidth: 1, borderColor: '#ddd', borderRadius: 6, overflow: 'hidden' }}>
          <Picker
            selectedValue={profile.vehicle_model}
            onValueChange={(v) => setProfile({ ...profile, vehicle_model: v })}
            enabled={!!profile.vehicle_make && !modelsLoading}
          >
            <Picker.Item label={modelsLoading ? 'Loading models...' : 'Select model'} value="" />
            {!modelsLoading && models.length === 0 ? (
              <Picker.Item label="No models found" value="" />
            ) : (
              models.map((m) => <Picker.Item key={m} label={m} value={m} />)
            )}
          </Picker>
        </View>

        <Text style={styles.label}>Vehicle Trim</Text>
        {trims.length > 0 ? (
          <View style={{ borderWidth: 1, borderColor: '#ddd', borderRadius: 6, overflow: 'hidden' }}>
            <Picker selectedValue={selectedTrimId} onValueChange={(v) => {
              setSelectedTrimId(v);
              // also set readable trim text in profile
              const found = trims.find(t => t.value === v);
              setProfile((p: any) => ({ ...p, vehicle_trim: found?.text ?? '' }));
            }}>
              <Picker.Item label="Select trim" value="" />
              {trims.map((t) => (
                <Picker.Item key={t.value} label={t.text} value={t.value} />
              ))}
            </Picker>
          </View>
        ) : (
          <TextInput style={styles.input} value={profile.vehicle_trim} onChangeText={(t) => setProfile({ ...profile, vehicle_trim: t })} />
        )}

        {lookupError ? (
          <View style={{ marginTop: 8 }}>
            <Text style={{ color: 'red' }}>Fuel lookup failed: {lookupError}</Text>
            <Button title={manualFuelMode ? 'Use automatic lookup' : 'Enter fuel efficiency manually'} onPress={() => setManualFuelMode(!manualFuelMode)} />
          </View>
        ) : null}

        {manualFuelMode ? (
          <>
            <Text style={styles.label}>Fuel Efficiency (L/100km)</Text>
            <TextInput style={styles.input} keyboardType="numeric" value={profile.fuel_efficiency} onChangeText={(t) => setProfile({ ...profile, fuel_efficiency: t })} />
          </>
        ) : null}

        {/* Fuel efficiency is automatically determined from selected year/make/model and hidden from the user */}

        <Text style={styles.label}>Fuel Type</Text>
        <TextInput style={styles.input} value={profile.fuel_type} onChangeText={(t) => setProfile({ ...profile, fuel_type: t })} />

     <Text style={styles.label}>Home Location</Text>
<Button
  title={profile.home_lat && profile.home_lng ? 'Location set — update' : 'Set my location'}
  onPress={async () => {
    try {
      const { status } = await Location.requestForegroundPermissionsAsync();
      if (status !== 'granted') {
        Alert.alert('Permission denied', 'Location permission is required to set your home location.');
        return;
      }
      const pos = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.High });
      setProfile((p: any) => ({ ...p, home_lat: String(pos.coords.latitude), home_lng: String(pos.coords.longitude) }));
    } catch (e: any) {
      console.error('Location error', e);
      Alert.alert('Error', e.message || 'Failed to get location');
    }
  }}
/>
<Text style={{ marginTop: 10, color: '#666', fontSize: 12 }}>Or enter coordinates manually:</Text>
<View style={{ flexDirection: 'row', marginTop: 4 }}>
  <TextInput
    style={[styles.input, { flex: 1, marginRight: 8 }]}
    placeholder="Latitude (e.g. 43.8971)"
    keyboardType="decimal-pad"
    value={profile.home_lat}
    onChangeText={(t) => setProfile({ ...profile, home_lat: t })}
  />
  <TextInput
    style={[styles.input, { flex: 1 }]}
    placeholder="Longitude (e.g. -78.8658)"
    keyboardType="decimal-pad"
    value={profile.home_lng}
    onChangeText={(t) => setProfile({ ...profile, home_lng: t })}
  />
</View>

        <Text style={styles.label}>Max Detour (km)</Text>
        <TextInput style={styles.input} keyboardType="numeric" value={profile.max_detour_km} onChangeText={(t) => setProfile({ ...profile, max_detour_km: t })} />

        <Text style={styles.label}>Min Savings</Text>
        <TextInput style={styles.input} keyboardType="numeric" value={profile.min_savings} onChangeText={(t) => setProfile({ ...profile, min_savings: t })} />

        <View style={{ height: 16 }} />
        <Button title={saving ? 'Saving...' : 'Save Profile'} onPress={save} disabled={saving || loading} />
        <View style={{ height: 8 }} />
        <Button title="Cancel" onPress={() => router.back()} />
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  container: {
    padding: 20,
    backgroundColor: '#fff',
  },
  title: {
    fontSize: 24,
    fontWeight: '600',
    marginBottom: 12,
  },
  label: {
    marginTop: 8,
    marginBottom: 4,
    color: '#333',
  },
  input: {
    borderWidth: 1,
    borderColor: '#ddd',
    padding: 10,
    borderRadius: 6,
  },
});
