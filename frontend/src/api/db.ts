import { openDB, type DBSchema, type IDBPDatabase } from 'idb';
import { type PriceData, type HistoryData } from './albion';

interface AlbionDB extends DBSchema {
  prices: {
    key: string; // cache key (e.g. "T4_BAG::Caerleon|Black Market")
    value: {
      cache_key: string;
      timestamp: number;
      data: PriceData[];
    };
  };
  history: {
    key: string; // cache key (e.g. "T4_BAG::Black Market")
    value: {
      cache_key: string;
      timestamp: number;
      data: HistoryData[];
    };
  };
}

const DB_NAME = 'albion-flipper-db';
const DB_VERSION = 3;

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

export async function getCachedPrice(cacheKey: string, ttlMs: number): Promise<PriceData[] | null> {
  const db = await initDB();
  const entry = await db.get('prices', cacheKey);
  
  if (!entry) return null;
  if (Date.now() - entry.timestamp > ttlMs) return null;
  
  return entry.data;
}

export async function setCachedPrice(cacheKey: string, data: PriceData[]) {
  const db = await initDB();
  await db.put('prices', {
    cache_key: cacheKey,
    timestamp: Date.now(),
    data: data
  });
}

export async function getCachedHistory(cacheKey: string, ttlMs: number): Promise<HistoryData[] | null> {
  const db = await initDB();
  const entry = await db.get('history', cacheKey);
  
  if (!entry) return null;
  if (Date.now() - entry.timestamp > ttlMs) return null;
  
  return entry.data;
}

export async function setCachedHistory(cacheKey: string, data: HistoryData[]) {
  const db = await initDB();
  await db.put('history', {
    cache_key: cacheKey,
    timestamp: Date.now(),
    data: data
  });
}

export async function clearAllCache() {
  const db = await initDB();
  await db.clear('prices');
  await db.clear('history');
}

export async function clearItemCache(itemId: string) {
  const db = await initDB();
  const stores: Array<'prices' | 'history'> = ['prices', 'history'];

  for (const storeName of stores) {
    const tx = db.transaction(storeName, 'readwrite');
    let cursor = await tx.store.openCursor();
    while (cursor) {
      const key = String(cursor.key);
      if (key === itemId || key.startsWith(`${itemId}::`)) {
        await cursor.delete();
      }
      cursor = await cursor.continue();
    }
    await tx.done;
  }
}
