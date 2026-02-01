const puppeteer = require('puppeteer');
const { supabase } = require('./supabase');

// Get stations from database
async function getStationsFromDB(stationIds) {
  const { data, error } = await supabase
    .from('stations')
    .select('*')
    .in('id', stationIds);
  
  if (error) {
    console.warn('DB read error:', error.message);
    return {};
  }
  
  const map = {};
  for (const station of data || []) {
    map[station.id] = station;
  }
  return map;
}

// Save stations to database
async function saveStationsToDB(stations) {
  const toSave = stations.filter(s => s.lat && s.lng).map(s => ({
    id: s.id,
    name: s.name,
    address: s.address || '',
    lat: s.lat,
    lng: s.lng,
    brand: s.name,
    updated_at: new Date().toISOString(),
  }));
  
  if (toSave.length === 0) return;
  
  const { error } = await supabase
    .from('stations')
    .upsert(toSave, { onConflict: 'id' });
  
  if (error) {
    console.warn('DB write error:', error.message);
  } else {
    console.log(`Saved ${toSave.length} stations to database`);
  }
}

// Random delay to avoid detection
function delay(ms) {
  return new Promise(resolve => setTimeout(resolve, ms + Math.random() * 500));
}

async function scrapeMultipleAreas(searchTerms, userLat, userLng, maxPerArea = 10, maxDistance = null) {
  const browser = await puppeteer.launch({ 
    headless: 'new',
    args: ['--no-sandbox', '--disable-setuid-sandbox']
  });
  
  const page = await browser.newPage();
  
  // Set realistic browser fingerprint
  await page.setUserAgent('Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36');
  await page.setViewport({ width: 1366, height: 768 });
  await page.setExtraHTTPHeaders({
    'Accept-Language': 'en-US,en;q=0.9',
    'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8',
  });
  
  const allStations = new Map();
  
  // Step 1: Collect all stations from search results
  for (const searchTerm of searchTerms) {
    console.log(`Searching: ${searchTerm}`);
    try {
      const url = `https://www.gasbuddy.com/home?search=${encodeURIComponent(searchTerm)}&fuel=1`;
      await page.goto(url, { waitUntil: 'networkidle2', timeout: 30000 });
      await delay(1000); // Wait a bit to seem human
      
      await page.waitForSelector('a[href*="/station/"]', { timeout: 10000 }).catch(() => null);
      
      const stationList = await page.evaluate(() => {
        const results = [];
        const seen = new Set();
        const items = document.querySelectorAll('[class*="GenericStationListItem"]');
        
        items.forEach((el) => {
          const link = el.querySelector('a[href*="/station/"]');
          const stationUrl = link?.getAttribute('href') || '';
          const stationId = stationUrl.match(/\/station\/(\d+)/)?.[1];
          
          if (!stationId || seen.has(stationId)) return;
          seen.add(stationId);
          
          const name = link?.textContent?.trim();
          const priceEl = el.querySelector('[class*="StationDisplayPrice"], [class*="Price"]');
          const priceText = priceEl?.textContent?.trim()?.replace(/[^0-9.]/g, '');
          const priceInCents = priceText ? parseFloat(priceText) : null;
          const price = priceInCents ? priceInCents / 100 : null;
          
          if (name) {
            results.push({ id: stationId, name, price_per_l: price });
          }
        });
        
        return results;
      });
      
      for (const station of stationList.slice(0, maxPerArea)) {
        if (!allStations.has(station.id)) {
          allStations.set(station.id, station);
        }
      }
      
      await delay(500);
    } catch (e) {
      console.warn(`Failed to search ${searchTerm}:`, e.message);
    }
  }
  
  // Step 2: Get coordinates from database
  const stationIds = Array.from(allStations.keys());
  console.log(`Looking up ${stationIds.length} stations in database...`);
  const dbStations = await getStationsFromDB(stationIds);
  
  // Step 3: Merge DB data with scraped prices
  const stationsNeedingCoords = [];
  for (const [id, station] of allStations) {
    if (dbStations[id]) {
      station.lat = parseFloat(dbStations[id].lat);
      station.lng = parseFloat(dbStations[id].lng);
      station.address = dbStations[id].address || '';
    } else {
      stationsNeedingCoords.push(station);
    }
  }
  
  console.log(`Found ${stationIds.length - stationsNeedingCoords.length} in DB, need to fetch ${stationsNeedingCoords.length} new`);
  
  // Step 4: Fetch coordinates for new stations ONE AT A TIME (to avoid detection)
  if (stationsNeedingCoords.length > 0) {
    console.log(`Fetching coordinates for ${stationsNeedingCoords.length} stations (this may take a minute)...`);
    
    for (let i = 0; i < stationsNeedingCoords.length; i++) {
      const station = stationsNeedingCoords[i];
      console.log(`  Fetching ${i + 1}/${stationsNeedingCoords.length}: ${station.name}`);
      
      try {
        await page.goto(`https://www.gasbuddy.com/station/${station.id}`, { 
          waitUntil: 'networkidle2', 
          timeout: 20000 
        });
        
        await delay(1500); // Important: wait to avoid bot detection
        
        const details = await page.evaluate(() => {
          const html = document.body.innerHTML;
          const latMatch = html.match(/"latitude":\s*([-\d.]+)/);
          const lngMatch = html.match(/"longitude":\s*([-\d.]+)/);
          const addressEl = document.querySelector('address, [class*="Address"]');
          
          return {
            lat: latMatch ? parseFloat(latMatch[1]) : null,
            lng: lngMatch ? parseFloat(lngMatch[1]) : null,
            address: addressEl?.textContent?.trim() || '',
          };
        });
        
        if (details.lat && details.lng) {
          station.lat = details.lat;
          station.lng = details.lng;
          station.address = details.address;
          allStations.set(station.id, station);
        }
      } catch (e) {
        console.warn(`  Failed to get coords for ${station.id}:`, e.message);
      }
    }
    
    // Save new stations to database
    const stationsWithCoords = stationsNeedingCoords.filter(s => s.lat && s.lng);
    if (stationsWithCoords.length > 0) {
      await saveStationsToDB(stationsWithCoords);
    }
  }
  
  await browser.close();
  
  // Calculate distances
  const stations = Array.from(allStations.values()).filter(s => s.lat && s.lng);
  
  if (userLat && userLng) {
    for (const station of stations) {
      station.distance_km = haversineDistance(userLat, userLng, station.lat, station.lng);
    }
  }
  
  // Filter by max distance if specified
  const filtered = maxDistance 
    ? stations.filter(s => !s.distance_km || s.distance_km <= maxDistance)
    : stations;
  
  return filtered;
}

async function scrapeGasBuddy(searchTerm, userLat, userLng, maxStations = 15) {
  // Use scrapeMultipleAreas with single term
  return scrapeMultipleAreas([searchTerm], userLat, userLng, maxStations, null);
}

function haversineDistance(lat1, lng1, lat2, lng2) {
  const R = 6371;
  const dLat = toRad(lat2 - lat1);
  const dLng = toRad(lng2 - lng1);
  const a = Math.sin(dLat/2) * Math.sin(dLat/2) +
            Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) *
            Math.sin(dLng/2) * Math.sin(dLng/2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));
  return Math.round(R * c * 100) / 100;
}

function toRad(deg) {
  return deg * (Math.PI / 180);
}

module.exports = { scrapeGasBuddy, scrapeMultipleAreas };