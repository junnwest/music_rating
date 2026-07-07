'use client';

import { useParams } from 'next/navigation';
import ProfileView from '../../../../components/sj/ProfileView';

export default function UserProfilePage() {
  const params = useParams<{ username: string }>();
  return <ProfileView username={decodeURIComponent(params.username)} />;
}
