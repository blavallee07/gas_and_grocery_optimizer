import Constants from 'expo-constants';
import { Platform } from 'react-native';

const getDevProxyBase = () => {
	if (Platform.OS === 'web') return 'http://localhost:3001/api';

	const hostUri = Constants.expoConfig?.hostUri || (Constants as any).manifest?.debuggerHost;
	if (hostUri) {
		const hostname = hostUri.split(':')[0];
		return `http://${hostname}:3001/api`;
	}

	return 'http://localhost:3001/api';
};

const DEV_PROXY = getDevProxyBase();

// Railway production URL
const PROD_PROXY = 'https://fabulous-amazement-production.up.railway.app/api';

export const API_BASE = __DEV__ ? DEV_PROXY : PROD_PROXY;
