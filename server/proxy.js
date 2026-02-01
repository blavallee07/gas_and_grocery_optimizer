const express = require('express');
const cors = require('cors');
const { scrapeGasBuddy, scrapeMultipleAreas } = require('./gasbuddy-scraper');

const app = express();
const PORT = process.env.PORT || 3001;
const GOOGLE_API_KEY = 'AIzaSyA5P0tX5Nh0U1JqjTqpzB0puuBmWnHIzzc';

app.use(cors());
app.use(express.json());

async function getDrivingDistances(originLat, originLng, stations) {
  if (!stations.length) return stations;
  const batchSize = 25;
  const results = [];
  for (let i = 0; i < stations.length; i += batchSize) {
    const batch = stations.slice(i, i + batchSize);
    const destinations = batch.map(s => `${s.lat},${s.lng}`).join('|');
    const url = `https://maps.googleapis.com/maps/api/distancematrix/json?origins=${originLat},${originLng}&destinations=${destinations}&key=${GOOGLE_API_KEY}&units=metric`;
    try {
      const response = await fetch(url);
      const data = await response.json();
      if (data.status === 'OK') {
        batch.forEach((station, idx) => {
          const element = data.rows[0]?.elements[idx];
          if (element?.status === 'OK') {
            station.driving_distance_km = Math.round(element.distance.value / 10) / 100;
            station.driving_duration_min = Math.round(element.duration.value / 60);
          }
        });
      }
    } catch (e) {
      console.warn('Google API error:', e.message);
    }
    results.push(...batch);
  }
  return results;
}

// Get nearby towns using Google Places
async function getNearbyTowns(lat, lng, radiusKm = 15) {
  const radiusMeters = radiusKm * 1000;
  const url = `https://maps.googleapis.com/maps/api/place/nearbysearch/json?location=${lat},${lng}&radius=${radiusMeters}&type=locality&key=${GOOGLE_API_KEY}`;
  
  try {
    const response = await fetch(url);
    const data = await response.json();
    
    if (data.status === 'OK') {
      const towns = data.results.map(place => place.name);
      return [...new Set(towns)]; // Remove duplicates
    }
    return [];
  } catch (e) {
    console.warn('Failed to get nearby towns:', e.message);
    return [];
  }
}

// Get user's town from coordinates
async function reverseGeocode(lat, lng) {
  const url = `https://maps.googleapis.com/maps/api/geocode/json?latlng=${lat},${lng}&key=${GOOGLE_API_KEY}`;
  
  try {
    const response = await fetch(url);
    const data = await response.json();
    
    if (data.status === 'OK' && data.results.length > 0) {
      // Find locality (city/town) from address components
      for (const result of data.results) {
        for (const component of result.address_components) {
          if (component.types.includes('locality')) {
            return component.long_name;
          }
        }
      }
      // Fallback to sublocality or administrative area
      for (const result of data.results) {
        for (const component of result.address_components) {
          if (component.types.includes('sublocality') || 
              component.types.includes('administrative_area_level_3')) {
            return component.long_name;
          }
        }
      }
    }
    return null;
  } catch (e) {
    console.warn('Reverse geocode failed:', e.message);
    return null;
  }
}

// Smart search endpoint - automatically finds nearby towns and searches all
app.get('/api/gasbuddy/smart', async (req, res) => {
  try {
    const { lat, lng, radius, maxPerArea, maxDistance } = req.query;
    
    const userLat = parseFloat(lat);
    const userLng = parseFloat(lng);
    const searchRadius = parseInt(radius) || 15;
    const perArea = parseInt(maxPerArea) || 10;
    const maxDist = parseFloat(maxDistance) || 30;
    
    if (!userLat || !userLng) {
      return res.status(400).json({ success: false, error: 'lat and lng required' });
    }
    
    console.log('Smart search for:', userLat, userLng, 'radius:', searchRadius);
    
    // Get user's town
    const userTown = await reverseGeocode(userLat, userLng);
    console.log('User town:', userTown);
    
    // Get nearby towns
    let nearbyTowns = await getNearbyTowns(userLat, userLng, searchRadius);
    console.log('Nearby towns:', nearbyTowns);
    
    // Build search terms (user's town + nearby towns + province)
    const searchTerms = [];
    
    // Add common nearby area names for better coverage
    const additionalAreas = [
      `${userLat.toFixed(2)},${userLng.toFixed(2)}`, // Coordinates search
    ];

    // If user's town is known, add variations
    if (userTown) {
    searchTerms.push(`${userTown} ON`);
   } 

    // Add nearby towns
    nearbyTowns.forEach(town => {
      if (town !== userTown) {
        searchTerms.push(`${town} ON`);
      }
    });

    // Add coordinate-based search as fallback
    searchTerms.push(...additionalAreas);

    // Remove duplicates and limit
    const uniqueTerms = [...new Set(searchTerms)];
    const limitedSearchTerms = uniqueTerms.slice(0, 8);
    console.log('Searching:', limitedSearchTerms);
    
    // Search all towns
    let stations = await scrapeMultipleAreas(limitedSearchTerms, userLat, userLng, perArea, maxDist);
    
    // Get driving distances
    if (stations.length > 0) {
      stations = await getDrivingDistances(userLat, userLng, stations);
      stations.sort((a, b) => (a.price_per_l || 999) - (b.price_per_l || 999));
    }
    
    res.json({ 
      success: true, 
      searchTerms: limitedSearchTerms,
      stations 
    });
  } catch (e) {
    console.error('Smart search error:', e);
    res.status(500).json({ success: false, error: e.message });
  }
});

app.get('/api/gasbuddy/:postalCode', async (req, res) => {
  try {
    const { postalCode } = req.params;
    const { lat, lng, max, driving } = req.query;
    const userLat = lat ? parseFloat(lat) : null;
    const userLng = lng ? parseFloat(lng) : null;
    const maxStations = max ? parseInt(max) : 15;
    const includeDriving = driving === 'true';
    console.log('Scraping GasBuddy for:', postalCode, 'user location:', userLat, userLng);
    let stations = await scrapeGasBuddy(postalCode, userLat, userLng, maxStations);
    if (includeDriving && userLat && userLng) {
      stations = await getDrivingDistances(userLat, userLng, stations);
      stations.sort((a, b) => (a.driving_distance_km || 999) - (b.driving_distance_km || 999));
    }
    res.json({ success: true, stations });
  } catch (e) {
    console.error('Scraper error:', e);
    res.status(500).json({ success: false, error: e.message });
  }
});

app.post('/api/gasbuddy/multi', async (req, res) => {
  try {
    const { searchTerms, lat, lng, maxPerArea, maxDistance, driving } = req.body;
    const userLat = lat ? parseFloat(lat) : null;
    const userLng = lng ? parseFloat(lng) : null;
    const perArea = maxPerArea || 10;
    const maxDist = maxDistance || null;
    const includeDriving = driving === true;
    console.log('Multi-area search:', searchTerms, 'user location:', userLat, userLng);
    let stations = await scrapeMultipleAreas(searchTerms, userLat, userLng, perArea, maxDist);
    if (includeDriving && userLat && userLng) {
      stations = await getDrivingDistances(userLat, userLng, stations);
      stations.sort((a, b) => (a.driving_distance_km || 999) - (b.driving_distance_km || 999));
    }
    res.json({ success: true, stations });
  } catch (e) {
    console.error('Scraper error:', e);
    res.status(500).json({ success: false, error: e.message });
  }
});

app.use('/api/nhtsa', async (req, res) => {
  try {
    const path = req.url;
    const url = `https://vpic.nhtsa.dot.gov/api/vehicles${path}`;
    const response = await fetch(url);
    const body = await response.text();
    res.set('Content-Type', 'application/json');
    res.status(response.status).send(body);
  } catch (e) {
    res.status(500).json({ error: String(e) });
  }
});

app.use('/api/fueleconomy', async (req, res) => {
  try {
    const path = req.url;
    const url = `https://www.fueleconomy.gov/ws/rest${path}`;
    const response = await fetch(url);
    const body = await response.text();
    res.set('Content-Type', 'application/xml');
    res.status(response.status).send(body);
  } catch (e) {
    res.status(500).json({ error: String(e) });
  }
});

app.listen(PORT, () => {
  console.log('Proxy server listening on http://localhost:' + PORT);
});