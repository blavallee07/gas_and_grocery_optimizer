export interface Station {
  id: string;
  name: string;
  lat: number;
  lng: number;
  price_per_l: number;
  distance_km: number;
}

export interface UserProfile {
  tank_size_l: number;
  fuel_efficiency: number; // L/100km
  max_detour_km: number;
  min_savings: number;
}

export interface StationResult {
  station: Station;
  gross_savings: number;
  detour_cost: number;
  net_savings: number;
  worth_it: boolean;
}

/**
 * Calculate net savings for a station compared to baseline
 */
export function calculateNetSavings(
  baselinePrice: number,      // $/L at nearest station
  stationPrice: number,       // $/L at candidate station
  tankLiters: number,         // how much to fill
  detourKm: number,           // extra round-trip distance
  efficiencyLPer100km: number // vehicle fuel efficiency
): { grossSavings: number; detourCost: number; netSavings: number; worthIt: boolean } {
  
  // Gross savings from price difference
  const priceDiff = baselinePrice - stationPrice;
  const grossSavings = priceDiff * tankLiters;
  
  // Cost to drive the detour
  const fuelUsed = (detourKm / 100) * efficiencyLPer100km;
  const detourCost = fuelUsed * baselinePrice;
  
  // Net benefit
  const netSavings = grossSavings - detourCost;
  
  return {
    grossSavings: Math.round(grossSavings * 100) / 100,
    detourCost: Math.round(detourCost * 100) / 100,
    netSavings: Math.round(netSavings * 100) / 100,
    worthIt: netSavings > 0,
  };
}

/**
 * Rank all stations by net savings
 */
export function rankStations(
  stations: Station[],
  profile: UserProfile,
  currentFuelLevel: number = 0.5 // 0-1, default half tank
): StationResult[] {
  if (stations.length === 0) return [];
  
  // Find nearest station as baseline
  const baseline = stations.reduce((min, s) => 
    s.distance_km < min.distance_km ? s : min
  );
  
  // How much fuel to fill (assume filling to full)
  const litersToFill = profile.tank_size_l * (1 - currentFuelLevel);
  
  const results: StationResult[] = stations.map(station => {
    // Detour = extra distance beyond baseline (round trip)
    const detourKm = Math.max(0, (station.distance_km - baseline.distance_km) * 2);
    
    const calc = calculateNetSavings(
      baseline.price_per_l,
      station.price_per_l,
      litersToFill,
      detourKm,
      profile.fuel_efficiency
    );
    
    return {
      station,
      gross_savings: calc.grossSavings,
      detour_cost: calc.detourCost,
      net_savings: calc.netSavings,
      worth_it: calc.worthIt && calc.netSavings >= profile.min_savings,
    };
  });
  
  // Sort by net savings descending
  return results.sort((a, b) => b.net_savings - a.net_savings);
}

/**
 * For trip planning: find best station along a route
 */
export function planTripFuelStop(
  currentFuelL: number,
  tankSizeL: number,
  efficiencyLPer100km: number,
  tripDistanceKm: number,
  routeStations: (Station & { distance_along_route: number })[]
): { needStop: boolean; station?: Station; message: string } {
  
  // How far can they go?
  const rangeKm = (currentFuelL / efficiencyLPer100km) * 100;
  const bufferKm = 30; // safety margin
  const safeRange = rangeKm - bufferKm;
  
  if (safeRange >= tripDistanceKm) {
    return {
      needStop: false,
      message: `You have ${Math.round(rangeKm)}km range. You'll make it without stopping.`
    };
  }
  
  // Find stations within safe range
  const candidates = routeStations.filter(s => s.distance_along_route < safeRange);
  
  if (candidates.length === 0) {
    return {
      needStop: true,
      message: `Warning: No stations found within your ${Math.round(safeRange)}km safe range!`
    };
  }
  
  // Pick cheapest within range
  const best = candidates.reduce((min, s) => 
    s.price_per_l < min.price_per_l ? s : min
  );
  
  return {
    needStop: true,
    station: best,
    message: `Stop at ${best.name} (${best.distance_along_route}km) - $${best.price_per_l.toFixed(2)}/L`
  };
}