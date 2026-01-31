import { createClient } from '@supabase/supabase-js';
import 'react-native-url-polyfill/auto';

const supabaseUrl = 'https://pyhzvkupatgwpnaksyrr.supabase.co';
const supabaseAnonKey = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InB5aHp2a3VwYXRnd3BuYWtzeXJyIiwicm9sZSI6ImFub24iLCJpYXQiOjE3Njk4ODYyMjYsImV4cCI6MjA4NTQ2MjIyNn0.gjtBteE1l0Qy1fJajuLIgXaSh_g20byb608ABZ9a-jU';  // replace with your actual key

const isReactNative = typeof navigator !== 'undefined' && (navigator as any).product === 'ReactNative';

let supabaseClient;

if (isReactNative) {
  // Only require AsyncStorage in native runtime to avoid bundlers/server trying to evaluate it
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const AsyncStorage = require('@react-native-async-storage/async-storage').default;

  supabaseClient = createClient(supabaseUrl, supabaseAnonKey, {
    auth: {
      storage: AsyncStorage,
      autoRefreshToken: true,
      persistSession: true,
      detectSessionInUrl: false,
    },
  });
} else {
  // Web / server - use default browser storage (localStorage) when available.
  // Enable detectSessionInUrl so OAuth redirects containing the session are parsed on web.
  supabaseClient = createClient(supabaseUrl, supabaseAnonKey, {
    auth: {
      detectSessionInUrl: true,
    },
  });
}

export const supabase = supabaseClient;