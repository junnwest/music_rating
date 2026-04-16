import { Suspense } from 'react';
import AlbumSearchForm from '../../components/AlbumSearchForm';

export default function SearchPage() {
  return (
    <main className="min-h-screen bg-white px-6 py-10">
      <div className="mx-auto max-w-3xl">
        <Suspense>
          <AlbumSearchForm />
        </Suspense>
      </div>
    </main>
  );
}
