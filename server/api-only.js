const express = require('express');
const cors = require('cors');
const { createClient } = require('@supabase/supabase-js');

const app = express();
const PORT = process.env.PORT || 3001;
const GOOGLE_API_KEY = process.env.GOOGLE_API_KEY || 'AIzaSyA5P0tX5Nh0U1JqjTqpzB0puuBmWnHIzzc';

const supabase = createClient(
  'https://pyhzvkupatgwpnaksyrr.supabase.co',
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InB5aHp2a3VwYXRnd3BuYWtzeXJyIiwicm9sZSI6ImFub24iLCJpYXQiOjE3Njk4ODYyMjYsImV4cCI6MjA4NTQ2MjIyNn0.gjtBteE1l0Qy1fJajuLIgXaSh_g20byb608ABZ9a-jU'
);

app.use(cors());
app.use(express.json());

function haversineDistance(lat1, lng1, lat2, lng2) {
  const R = 6371;
  const dLat = (lat2 - lat1) * Math.PI / 180;
  const dLng = (lng2 - lng1) * Math.PI / 180;
  const a = Math.sin(dLat/2) * Math.sin(dLat/2) +
            Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) *
            Math.sin(dLng/2) * Math.sin(dLng/2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));
  return Math.round(R * c * 100) / 100;
}

async function getDrivingDistances(originLat, originLng, stations) {
  if (!stations.length) return stations;
  const batchSize = 25;
  
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
  }
  return stations;
}

app.get('/api/stations/nearby', async (req, res) => {
  try {
    const { lat, lng, radius } = req.query;
    const userLat = parseFloat(lat);
    const userLng = parseFloat(lng);
    const maxRadius = parseFloat(radius) || 30;

    if (!userLat || !userLng) {
      return res.status(400).json({ success: false, error: 'lat and lng required' });
    }

    console.log('Fetching stations near:', userLat, userLng, 'radius:', maxRadius);

    const { data: allStations, error } = await supabase
      .from('stations')
      .select('*');

    if (error) throw error;

    const nearbyStations = allStations
      .map(s => ({
        ...s,
        lat: parseFloat(s.lat),
        lng: parseFloat(s.lng),
        distance_km: haversineDistance(userLat, userLng, parseFloat(s.lat), parseFloat(s.lng))
      }))
      .filter(s => s.distance_km <= maxRadius)
      .sort((a, b) => a.distance_km - b.distance_km);

    console.log(`Found ${nearbyStations.length} stations within ${maxRadius}km`);

    const withDriving = await getDrivingDistances(userLat, userLng, nearbyStations.slice(0, 50));

    res.json({ 
      success: true, 
      count: withDriving.length,
      stations: withDriving 
    });
  } catch (e) {
    console.error('Error:', e);
    res.status(500).json({ success: false, error: e.message });
  }
});

app.get('/health', (req, res) => {
  res.json({ status: 'ok' });
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
  console.log(`API server listening on port ${PORT}`);
});

