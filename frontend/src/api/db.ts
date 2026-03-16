import { openDB, DBSchema, IDBPDatabase } from 'idb';
import { PriceData, HistoryData } from './albion';

interface AlbionDB extends DBSchema {
  prices: {
    key: string; // item_id (e.g. "T4_BAG")
    value: {
      item_id: string;
      timestamp: number;
      data: PriceData[];
    };
  };
  history: {
    key: string; // item_id
    value: {
      item_id: string;
      timestamp: number;
      data: HistoryData[];
    };
  };
}

const DB_NAME = 'albion-flipper-db';
const DB_VERSION = 2; // Bump version for new schema

export async function initDB(): Promise<IDBPDatabase<AlbionDB>> {
  return openDB<AlbionDB>(DB_NAME, DB_VERSION, {
    upgrade(db) {
      if (db.objectStoreNames.contains('prices')) db.deleteObjectStore('prices');
      if (db.objectStoreNames.contains('history')) db.deleteObjectStore('history');
      
      db.createObjectStore('prices', { keyPath: 'item_id' });
      db.createObjectStore('history', { keyPath: 'item_id' });
    },
  });
}

export async function getCachedPrice(itemId: string, ttlMs: number): Promise<PriceData[] | null> {
  const db = await initDB();
  const entry = await db.get('prices', itemId);
  
  if (!entry) return null;
  if (Date.now() - entry.timestamp > ttlMs) return null;
  
  return entry.data;
}

export async function setCachedPrice(itemId: string, data: PriceData[]) {
  const db = await initDB();
  await db.put('prices', {
    item_id: itemId,
    timestamp: Date.now(),
    data: data
  });
}

export async function getCachedHistory(itemId: string, ttlMs: number): Promise<HistoryData[] | null> {
  const db = await initDB();
  const entry = await db.get('history', itemId);
  
  if (!entry) return null;
  if (Date.now() - entry.timestamp > ttlMs) return null;
  
  return entry.data;
}

export async function setCachedHistory(itemId: string, data: HistoryData[]) {
  const db = await initDB();
  await db.put('history', {
    item_id: itemId,
    timestamp: Date.now(),
    data: data
  });
}
