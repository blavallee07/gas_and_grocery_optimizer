const puppeteer = require('puppeteer');

async function scrapeGasBuddy(searchTerm, userLat, userLng, maxStations = 15) {
  const browser = await puppeteer.launch({ headless: 'new' });
  const page = await browser.newPage();
  
  await page.setUserAgent('Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36');
  
  const url = `https://www.gasbuddy.com/home?search=${encodeURIComponent(searchTerm)}&fuel=1`;
  await page.goto(url, { waitUntil: 'networkidle2', timeout: 30000 });
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
  
  const stations = [];
  for (const station of stationList.slice(0, maxStations)) {
    try {
      await page.goto(`https://www.gasbuddy.com/station/${station.id}`, { 
        waitUntil: 'networkidle2', 
        timeout: 15000 
      });
      
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
        let distance_km = null;
        if (userLat && userLng) {
          distance_km = haversineDistance(userLat, userLng, details.lat, details.lng);
        }
        
        stations.push({
          ...station,
          ...details,
          distance_km,
        });
      }
    } catch (e) {
      console.warn(`Failed to get details for station ${station.id}:`, e.message);
    }
  }
  
  await browser.close();
  
  stations.sort((a, b) => (a.distance_km || 999) - (b.distance_km || 999));
  
  return stations;
}

async function scrapeMultipleAreas(searchTerms, userLat, userLng, maxPerArea = 10, maxDistance = null) {
  const browser = await puppeteer.launch({ headless: 'new' });
  const page = await browser.newPage();
  await page.setUserAgent('Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36');
  
  const allStations = new Map();
  
  for (const searchTerm of searchTerms) {
    console.log(`Searching: ${searchTerm}`);
    try {
      const url = `https://www.gasbuddy.com/home?search=${encodeURIComponent(searchTerm)}&fuel=1`;
      await page.goto(url, { waitUntil: 'networkidle2', timeout: 30000 });
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
        if (allStations.has(station.id)) continue;
        
        try {
          await page.goto(`https://www.gasbuddy.com/station/${station.id}`, { 
            waitUntil: 'networkidle2', 
            timeout: 15000 
          });
          
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
            let distance_km = null;
            if (userLat && userLng) {
              distance_km = haversineDistance(userLat, userLng, details.lat, details.lng);
            }
            
            if (!maxDistance || !distance_km || distance_km <= maxDistance) {
              allStations.set(station.id, {
                ...station,
                ...details,
                distance_km,
              });
            }
          }
        } catch (e) {
          console.warn(`Failed to get details for station ${station.id}:`, e.message);
        }
      }
    } catch (e) {
      console.warn(`Failed to search ${searchTerm}:`, e.message);
    }
  }
  
  await browser.close();
  
  const stations = Array.from(allStations.values());
  stations.sort((a, b) => (a.distance_km || 999) - (b.distance_km || 999));
  
  return stations;
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