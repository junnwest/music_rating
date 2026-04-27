import type { ReactNode } from 'react';
import Link from 'next/link';

export default function AuthLayout({ children }: { children: ReactNode }) {
  return (
    <>
      <header className="h-[60px] border-b border-[#EBEBEB] flex items-center px-9">
        <Link
          href="/"
          className="text-base font-extrabold text-ink"
          style={{ letterSpacing: '-0.5px' }}
        >
          音色 <span className="text-mint">neiro</span>
        </Link>
      </header>
      {children}
    </>
  );
}
