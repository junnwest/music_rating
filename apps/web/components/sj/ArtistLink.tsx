'use client';

import type { ReactNode } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { ExternalLink, User } from 'lucide-react';
import { useContextMenu, openInNewTab } from './ContextMenu';
import { useLanguage } from '../../lib/i18n';

/**
 * An artist link that carries the app's right-click menu. Drop-in for
 * `<Link href={`/artist/…`}>` — it stays a real anchor, so middle-click and
 * ⌘-click keep working natively and "Open in new tab" just does the same thing
 * through the menu.
 */
export default function ArtistLink({
  href,
  className = '',
  children,
}: {
  href: string;
  className?: string;
  children: ReactNode;
}) {
  const router = useRouter();
  const { t } = useLanguage();

  const { onContextMenu, menu } = useContextMenu([
    {
      key: 'open-new-tab',
      label: t('sj.context.openNewTab'),
      icon: <ExternalLink size={15} />,
      onSelect: () => openInNewTab(href),
    },
    {
      key: 'go-to-artist',
      label: t('sj.context.goToArtist'),
      icon: <User size={15} />,
      onSelect: () => router.push(href),
    },
  ]);

  return (
    <>
      <Link href={href} className={className} onContextMenu={onContextMenu}>
        {children}
      </Link>
      {menu}
    </>
  );
}
