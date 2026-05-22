'use client';

import { useHomeReady } from './HomeReadyContext';

export default function RevealWhenReady({ children }: { children: React.ReactNode }) {
  const { ready } = useHomeReady();
  return (
    <div
      className="transition-opacity duration-500"
      style={{ opacity: ready ? 1 : 0, pointerEvents: ready ? 'auto' : 'none' }}
    >
      {children}
    </div>
  );
}
