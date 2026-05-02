import type { ReactNode } from 'react';
import Link from 'next/link';

export default function AuthLayout({ children }: { children: ReactNode }) {
  return (
    <>
      <header className="h-[72px] border-b border-divider flex items-center px-9">
        <Link href="/" aria-label="Home">
          <img src="/sillajuku_logo.svg" alt="sillajuku" className="h-[52px] w-auto" />
        </Link>
      </header>
      {children}
    </>
  );
}
