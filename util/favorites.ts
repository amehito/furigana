export const FAVORITES_STORAGE_KEY = 'favorites';
export const FAVORITES_LIMIT = 20;

export interface FavoriteItem {
  id: string;
  text: string;
  furigana?: string;
  sourceUrl: string;
  timestamp: number;
  context?: string;
}

export function normalizeFavoriteItems(value: unknown): FavoriteItem[] {
  if (!Array.isArray(value)) return [];

  return value.flatMap((item, index) => {
    if (typeof item === 'string') {
      return [{
        id: createFavoriteId(item),
        text: item,
        sourceUrl: '',
        timestamp: Date.now() - (index + 1) * 1000,
      }];
    }

    if (!item || typeof item !== 'object') return [];
    const record = item as Partial<FavoriteItem>;
    if (typeof record.text !== 'string' || !record.text.trim()) return [];

    return [{
      id: typeof record.id === 'string' && record.id ? record.id : createFavoriteId(record.text),
      text: record.text,
      furigana: typeof record.furigana === 'string' ? record.furigana : undefined,
      sourceUrl: typeof record.sourceUrl === 'string' ? record.sourceUrl : '',
      timestamp: typeof record.timestamp === 'number' ? record.timestamp : Date.now(),
      context: typeof record.context === 'string' ? record.context : undefined,
    }];
  });
}

export function createFavoriteItem(payload: Omit<FavoriteItem, 'id'>): FavoriteItem {
  return {
    ...payload,
    id: createFavoriteId(payload.text),
  };
}

export function matchFavorite(item: FavoriteItem, target: { text: string; sourceUrl?: string }) {
  return item.text === target.text && item.sourceUrl === (target.sourceUrl ?? '');
}

export function createFavoriteId(text: string) {
  return `fav-${Date.now()}-${text.slice(0, 12)}-${Math.random().toString(36).slice(2, 7)}`;
}
