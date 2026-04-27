import { Suspense } from 'react';
import AlbumSearchForm from '../../../components/AlbumSearchForm';

export default function SearchPage() {
  return (
    <main className="min-h-screen bg-white">
      <Suspense>
        <AlbumSearchForm />
      </Suspense>
    </main>
  );
}
