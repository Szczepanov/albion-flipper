import axios from 'axios';

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

export const fetchPrices = async (items: string[], locations: string[] = []): Promise<PriceData[]> => {
  if (!items.length) return [];
  const itemsStr = items.join(',');
  let url = `${API_BASE}/prices/${itemsStr}.json`;
  if (locations.length) {
    url += `?locations=${locations.join(',')}`;
  }
  
  try {
    const response = await axios.get<PriceData[]>(url);
    return response.data;
  } catch (err) {
    console.error('Error fetching prices:', err);
    return [];
  }
};
