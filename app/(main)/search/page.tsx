import { Suspense } from 'react';
import AlbumSearchForm from '../../../components/AlbumSearchForm';

export default function SearchPage() {
  return (
    <main className="min-h-screen bg-page">
      <Suspense>
        <AlbumSearchForm />
      </Suspense>
    </main>
  );
}
