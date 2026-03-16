import axios from 'axios';
import { getCachedPrice, setCachedPrice, getCachedHistory, setCachedHistory } from './db';

const API_BASE = 'https://europe.albion-online-data.com/api/v2/stats';

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
  
  const CACHE_TTL = 30 * 60 * 1000; // 30 minutes
  const CHUNK_SIZE = 50;
  
  const missingItems: string[] = [];
  let results: PriceData[] = [];

  // 1. Check IDB for cached data
  for (const itemId of items) {
    const cached = await getCachedPrice(itemId, CACHE_TTL);
    if (cached) {
      results.push(...cached);
    } else {
      missingItems.push(itemId);
    }
  }

  // 2. Fetch missing items in chunks (no location param to cache universal data)
  for (let i = 0; i < missingItems.length; i += CHUNK_SIZE) {
    const chunk = missingItems.slice(i, i + CHUNK_SIZE);
    const itemsStr = chunk.join(',');
    const url = `${API_BASE}/prices/${itemsStr}.json`;
    
    try {
      const response = await axios.get<PriceData[]>(url);
      const data = response.data || [];
      results.push(...data);
      
      // Group by item_id
      const groupedData: Record<string, PriceData[]> = {};
      for (const p of data) {
        if (!groupedData[p.item_id]) groupedData[p.item_id] = [];
        groupedData[p.item_id].push(p);
      }
      
      // Cache the results (including empty ones to map dead items)
      for (const id of chunk) {
        await setCachedPrice(id, groupedData[id] || []);
      }
    } catch (err) {
      console.error('Error fetching prices batch:', err);
    }
  }

  // 3. Filter by requested locations if specified
  if (locations.length > 0) {
    return results.filter(p => locations.includes(p.city));
  }
  return results;
};


export const fetchHistory = async (items: string[], locations: string[] = []): Promise<HistoryData[]> => {
  if (!items.length) return [];
  
  const CACHE_TTL = 60 * 60 * 1000; // 1 hour
  const CHUNK_SIZE = 50;
  
  const missingItems: string[] = [];
  let results: HistoryData[] = [];

  // 1. Check IDB
  for (const itemId of items) {
    const cached = await getCachedHistory(itemId, CACHE_TTL);
    if (cached) {
      results.push(...cached);
    } else {
      missingItems.push(itemId);
    }
  }

  // Format date range (28 days ago to today)
  const today = new Date();
  const past = new Date();
  past.setDate(today.getDate() - 28);
  const formatDate = (d: Date) => `${d.getMonth() + 1}-${d.getDate()}-${d.getFullYear()}`;
  const dateStr = `time-scale=24&date=${formatDate(past)}&end_date=${formatDate(today)}`;

  // 2. Fetch missing items in chunks (universal locations)
  for (let i = 0; i < missingItems.length; i += CHUNK_SIZE) {
    const chunk = missingItems.slice(i, i + CHUNK_SIZE);
    const itemsStr = chunk.join(',');
    const url = `${API_BASE}/history/${itemsStr}.json?${dateStr}`;
    
    try {
      const response = await axios.get<HistoryData[]>(url);
      const data = response.data || [];
      results.push(...data);
      
      // Group by item_id
      const groupedData: Record<string, HistoryData[]> = {};
      for (const h of data) {
        if (!groupedData[h.item_id]) groupedData[h.item_id] = [];
        groupedData[h.item_id].push(h);
      }
      
      for (const id of chunk) {
        await setCachedHistory(id, groupedData[id] || []);
      }
    } catch (err) {
      console.error('Error fetching history batch:', err);
    }
  }

  // 3. Filter by requested locations if specified
  if (locations.length > 0) {
    return results.filter(h => locations.includes(h.location));
  }
  return results;
};

