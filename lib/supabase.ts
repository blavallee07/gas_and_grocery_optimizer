import 'react-native-url-polyfill/auto';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { createClient, SupabaseClient } from '@supabase/supabase-js';
import { Platform } from 'react-native';

const supabaseUrl = 'https://pyhzvkupatgwpnaksyrr.supabase.co';
const supabaseAnonKey = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InB5aHp2a3VwYXRnd3BuYWtzeXJyIiwicm9sZSI6ImFub24iLCJpYXQiOjE3Njk4ODYyMjYsImV4cCI6MjA4NTQ2MjIyNn0.gjtBteE1l0Qy1fJajuLIgXaSh_g20byb608ABZ9a-jU';

let supabase: SupabaseClient;

export const getSupabase = () => {
  if (!supabase) {
    supabase = createClient(supabaseUrl, supabaseAnonKey, {
      auth: {
        storage: AsyncStorage,
        autoRefreshToken: true,
        persistSession: true,
        detectSessionInUrl: false,
      },
    });
  }
  return supabase;
};
