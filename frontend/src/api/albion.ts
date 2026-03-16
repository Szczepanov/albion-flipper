import axios from 'axios';

const API_BASE = 'https://europe.albion-online-data.com/api/v2/stats';
const CACHE_PREFIX = 'albion_flipper_cache_';

interface CacheItem<T> {
  timestamp: number;
  data: T;
}

const getCachedData = <T>(key: string, ttl: number): T | null => {
  try {
    const cached = localStorage.getItem(CACHE_PREFIX + key);
    if (!cached) return null;
    
    const parsed: CacheItem<T> = JSON.parse(cached);
    if (Date.now() - parsed.timestamp > ttl) {
      localStorage.removeItem(CACHE_PREFIX + key);
      return null;
    }
    return parsed.data;
  } catch (err) {
    return null;
  }
};

const setCachedData = <T>(key: string, data: T) => {
  try {
    const cacheItem: CacheItem<T> = {
      timestamp: Date.now(),
      data
    };
    localStorage.setItem(CACHE_PREFIX + key, JSON.stringify(cacheItem));
  } catch (err) {
    // Silently fail (e.g., if quota is exceeded)
  }
};

export interface PriceData {
  item_id: string;
  city: string;
  quality: number;
  sell_price_min: number;
  sell_price_min_date: string;
  sell_price_max: number;
  sell_price_max_date: string;
  buy_price_min: number;
  buy_price_min_date: string;
  buy_price_max: number;
  buy_price_max_date: string;
}

export interface HistoryDataPoint {
  item_count: number;
  avg_price: number;
  timestamp: string;
}

export interface HistoryData {
  location: string;
  item_id: string;
  quality: number;
  data: HistoryDataPoint[];
}

export const fetchPrices = async (items: string[], locations: string[] = []): Promise<PriceData[]> => {
  if (!items.length) return [];
  const itemsStr = items.join(',');
  let url = `${API_BASE}/prices/${itemsStr}.json`;
  if (locations.length) {
    url += `?locations=${locations.join(',')}`;
  }
  
  const cacheKey = `prices_${itemsStr}_${locations.join(',')}`;
  const CACHE_TTL = 5 * 60 * 1000; // 5 minutes in milliseconds
  
  const cached = getCachedData<PriceData[]>(cacheKey, CACHE_TTL);
  if (cached) return cached;
  
  try {
    const response = await axios.get<PriceData[]>(url);
    setCachedData(cacheKey, response.data);
    return response.data;
  } catch (err) {
    console.error('Error fetching prices:', err);
    return [];
  }
};

export const fetchHistory = async (items: string[], locations: string[] = []): Promise<HistoryData[]> => {
  if (!items.length) return [];
  const itemsStr = items.join(',');
  
  // Get date range (28 days ago to today)
  const today = new Date();
  const past = new Date();
  past.setDate(today.getDate() - 28);
  
  // Format: MM-DD-YYYY
  const formatDate = (d: Date) => `${d.getMonth() + 1}-${d.getDate()}-${d.getFullYear()}`;
  
  let url = `${API_BASE}/history/${itemsStr}.json?time-scale=24&date=${formatDate(past)}&end_date=${formatDate(today)}`;
  
  if (locations.length) {
    url += `&locations=${locations.join(',')}`;
  }
  
  const cacheKey = `history_${itemsStr}_${locations.join(',')}`;
  const CACHE_TTL = 60 * 60 * 1000; // 1 hour in milliseconds (history doesn't change as frequently)
  
  const cached = getCachedData<HistoryData[]>(cacheKey, CACHE_TTL);
  if (cached) return cached;
  
  try {
    const response = await axios.get<HistoryData[]>(url);
    const data = response.data || [];
    setCachedData(cacheKey, data);
    return data;
  } catch (err) {
    console.error('Error fetching history:', err);
    return [];
  }
};
