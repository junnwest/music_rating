import type { ReactNode } from 'react';
import Link from 'next/link';

export default function AuthLayout({ children }: { children: ReactNode }) {
  return (
    <div className="min-h-screen flex flex-col items-center pt-10 px-6">
      <Link href="/" aria-label="Home" className="mb-6">
        <img src="/logo.svg" alt="sillajuku" className="h-[66px] w-auto" />
      </Link>
      {children}
    </div>
  );
}
