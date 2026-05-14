'use client';

import { createContext, useContext, useState } from 'react';

const Ctx = createContext<{ ready: boolean; setReady: () => void }>({
  ready: false,
  setReady: () => {},
});

export function HomeReadyProvider({ children }: { children: React.ReactNode }) {
  const [ready, setReadyState] = useState(false);
  return (
    <Ctx.Provider value={{ ready, setReady: () => setReadyState(true) }}>
      {children}
    </Ctx.Provider>
  );
}

export function useHomeReady() {
  return useContext(Ctx);
}
