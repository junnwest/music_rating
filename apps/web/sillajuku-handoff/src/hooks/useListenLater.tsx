import { createContext, useContext, useState, useCallback, type ReactNode } from 'react';

interface ListenLaterContextType {
  ids: string[];
  add: (id: string) => void;
  remove: (id: string) => void;
  has: (id: string) => boolean;
  toggle: (id: string) => void;
}

const ListenLaterContext = createContext<ListenLaterContextType | null>(null);

export function ListenLaterProvider({ children }: { children: ReactNode }) {
  const [ids, setIds] = useState<string[]>(['broken-mirror', 'palette', 'night-swimming']);

  const add = useCallback((id: string) => {
    setIds(prev => prev.includes(id) ? prev : [...prev, id]);
  }, []);

  const remove = useCallback((id: string) => {
    setIds(prev => prev.filter(x => x !== id));
  }, []);

  const has = useCallback((id: string) => {
    return ids.includes(id);
  }, [ids]);

  const toggle = useCallback((id: string) => {
    setIds(prev => prev.includes(id) ? prev.filter(x => x !== id) : [...prev, id]);
  }, []);

  return (
    <ListenLaterContext.Provider value={{ ids, add, remove, has, toggle }}>
      {children}
    </ListenLaterContext.Provider>
  );
}

export function useListenLater() {
  const ctx = useContext(ListenLaterContext);
  if (!ctx) throw new Error('useListenLater must be used within ListenLaterProvider');
  return ctx;
}
