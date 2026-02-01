import { Platform } from 'react-native';

const DEV_PROXY = 'http://localhost:3001/api';

// This will be your Railway/Render URL after deployment
const PROD_PROXY = process.env.EXPO_PUBLIC_API_URL || DEV_PROXY;

export const API_BASE = __DEV__ ? DEV_PROXY : PROD_PROXY;
