export interface RecentIdSet {
  add(id: string): boolean;
  has(id: string): boolean;
  clear(): void;
}

export function createRecentIdSet(capacity: number): RecentIdSet {
  const ids = new Set<string>();
  return {
    add(id) {
      if (ids.has(id)) return false;
      ids.add(id);
      while (ids.size > capacity) {
        const oldest = ids.values().next();
        if (oldest.done === true) break;
        ids.delete(oldest.value);
      }
      return true;
    },
    has(id) {
      return ids.has(id);
    },
    clear() {
      ids.clear();
    },
  };
}
