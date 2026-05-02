import { useState } from 'react';
import { Link } from 'react-router-dom';
import { motion } from 'framer-motion';
import { Search, UserPlus, UserCheck, Users } from 'lucide-react';

interface FriendUser {
  id: string;
  name: string;
  handle: string;
  initial: string;
  color: string;
  bio: string;
  followers: number;
  following: number;
  isFollowing: boolean;
  mutual?: number;
}

const discoverUsers: FriendUser[] = [
  { id: 'popwatcher', name: 'popwatcher', handle: '@popwatcher', initial: 'P', color: 'bg-amber-100 text-amber-600 border-amber-200', bio: 'Pop music analyst. Charts & culture.', followers: 891, following: 45, isFollowing: false, mutual: 1 },
  { id: 'nara', name: 'nara_k', handle: '@nara_k', initial: 'N', color: 'bg-violet-100 text-violet-600 border-violet-200', bio: 'Discovering new music every day.', followers: 234, following: 198, isFollowing: false },
  { id: 'dave', name: 'davebeats', handle: '@davebeats', initial: 'D', color: 'bg-sky-100 text-sky-600 border-sky-200', bio: 'Hip-hop head. Vinyl collector.', followers: 445, following: 67, isFollowing: false, mutual: 3 },
];

const followingUsers: FriendUser[] = [
  { id: 'jiyeon', name: 'jiyeon_music', handle: '@jiyeon_music', initial: 'J', color: 'bg-rose-100 text-rose-600 border-rose-200', bio: 'K-indie & K-R&B obsessive. Playlist curator.', followers: 342, following: 56, isFollowing: true, mutual: 4 },
  { id: 'minwave', name: 'minwave', handle: '@minwave', initial: 'M', color: 'bg-blue-100 text-blue-600 border-blue-200', bio: 'I rate everything. Mostly 3 stars.', followers: 128, following: 89, isFollowing: true, mutual: 2 },
  { id: 'soundwatcher', name: 'soundwatcher', handle: '@soundwatcher', initial: 'S', color: 'bg-emerald-100 text-emerald-600 border-emerald-200', bio: 'Producer by day, listener by night.', followers: 567, following: 134, isFollowing: true, mutual: 7 },
];

const followersUsers: FriendUser[] = [
  { id: 'jiyeon', name: 'jiyeon_music', handle: '@jiyeon_music', initial: 'J', color: 'bg-rose-100 text-rose-600 border-rose-200', bio: 'K-indie & K-R&B obsessive. Playlist curator.', followers: 342, following: 56, isFollowing: true, mutual: 4 },
  { id: 'minwave', name: 'minwave', handle: '@minwave', initial: 'M', color: 'bg-blue-100 text-blue-600 border-blue-200', bio: 'I rate everything. Mostly 3 stars.', followers: 128, following: 89, isFollowing: true, mutual: 2 },
  { id: 'soundwatcher', name: 'soundwatcher', handle: '@soundwatcher', initial: 'S', color: 'bg-emerald-100 text-emerald-600 border-emerald-200', bio: 'Producer by day, listener by night.', followers: 567, following: 134, isFollowing: true, mutual: 7 },
  { id: 'alex', name: 'alexmusic', handle: '@alexmusic', initial: 'A', color: 'bg-orange-100 text-orange-600 border-orange-200', bio: 'Jazz guitarist and vinyl digger.', followers: 120, following: 56, isFollowing: false, mutual: 1 },
  { id: 'soo', name: 'soo_kim', handle: '@soo_kim', initial: 'S', color: 'bg-pink-100 text-pink-600 border-pink-200', bio: 'Classical pianist who loves K-R&B.', followers: 89, following: 34, isFollowing: false },
  { id: 'matt', name: 'mattvibes', handle: '@mattvibes', initial: 'M', color: 'bg-teal-100 text-teal-600 border-teal-200', bio: 'Indie rock & shoegaze enthusiast.', followers: 156, following: 78, isFollowing: false, mutual: 2 },
  { id: 'yuna', name: 'yunalee', handle: '@yunalee', initial: 'Y', color: 'bg-indigo-100 text-indigo-600 border-indigo-200', bio: 'Music journalist. Interviews & reviews.', followers: 234, following: 112, isFollowing: false, mutual: 3 },
  { id: 'tom', name: 'tombeats', handle: '@tombeats', initial: 'T', color: 'bg-lime-100 text-lime-700 border-lime-200', bio: 'Electronic producer. Synth collector.', followers: 67, following: 45, isFollowing: false },
  { id: 'lisa', name: 'lisamusic', handle: '@lisamusic', initial: 'L', color: 'bg-cyan-100 text-cyan-600 border-cyan-200', bio: 'Soul & funk obsessive. Crate digger.', followers: 198, following: 89, isFollowing: false, mutual: 1 },
  { id: 'chris', name: 'chrisp', handle: '@chrisp', initial: 'C', color: 'bg-yellow-100 text-yellow-700 border-yellow-200', bio: 'Metalhead with a soft side for ballads.', followers: 78, following: 23, isFollowing: false },
  { id: 'hanna', name: 'hannak', handle: '@hannak', initial: 'H', color: 'bg-fuchsia-100 text-fuchsia-600 border-fuchsia-200', bio: 'K-Pop stan since 2009. BTS & IU biased.', followers: 445, following: 156, isFollowing: false, mutual: 5 },
  { id: 'ryan', name: 'ryanflow', handle: '@ryanflow', initial: 'R', color: 'bg-gray-100 text-gray-600 border-gray-200', bio: 'Lo-fi beats to study/relax to.', followers: 312, following: 67, isFollowing: false, mutual: 2 },
  { id: 'ella', name: 'ellaj', handle: '@ellaj', initial: 'E', color: 'bg-rose-100 text-rose-500 border-rose-200', bio: 'Folk singer-songwriter. Quiet tastes.', followers: 156, following: 78, isFollowing: false },
  { id: 'jin', name: 'jinpark', handle: '@jinpark', initial: 'J', color: 'bg-emerald-100 text-emerald-600 border-emerald-200', bio: 'Hip-hop producer & beatmaker.', followers: 89, following: 34, isFollowing: false, mutual: 1 },
  { id: 'nina', name: 'ninaw', handle: '@ninaw', initial: 'N', color: 'bg-violet-100 text-violet-600 border-violet-200', bio: 'Opera singer. Classical & jazz lover.', followers: 67, following: 23, isFollowing: false },
  { id: 'kyle', name: 'kylem', handle: '@kylem', initial: 'K', color: 'bg-sky-100 text-sky-600 border-sky-200', bio: 'R&B & soul collector. Slow jams.', followers: 134, following: 56, isFollowing: false, mutual: 2 },
  { id: 'mia', name: 'miasounds', handle: '@miasounds', initial: 'M', color: 'bg-amber-100 text-amber-600 border-amber-200', bio: 'World music explorer. Always curious.', followers: 178, following: 89, isFollowing: false },
  { id: 'dan', name: 'danchoi', handle: '@danchoi', initial: 'D', color: 'bg-teal-100 text-teal-600 border-teal-200', bio: 'K-Hip-hop & rap connoisseur.', followers: 234, following: 112, isFollowing: false, mutual: 3 },
  { id: 'sarah', name: 'sarahg', handle: '@sarahg', initial: 'S', color: 'bg-pink-100 text-pink-600 border-pink-200', bio: 'Pop-punk & emo survivor. Still here.', followers: 198, following: 67, isFollowing: false, mutual: 1 },
  { id: 'will', name: 'willb', handle: '@willb', initial: 'W', color: 'bg-blue-100 text-blue-600 border-blue-200', bio: 'Ambient & experimental listener.', followers: 112, following: 45, isFollowing: false },
  { id: 'amy', name: 'amych', handle: '@amych', initial: 'A', color: 'bg-lime-100 text-lime-700 border-lime-200', bio: 'Soundtrack & score enthusiast.', followers: 156, following: 78, isFollowing: false, mutual: 2 },
  { id: 'jason', name: 'jasonl', handle: '@jasonl', initial: 'J', color: 'bg-orange-100 text-orange-600 border-orange-200', bio: 'Blues & jazz guitarist. Old soul.', followers: 89, following: 34, isFollowing: false },
  { id: 'ruby', name: 'rubym', handle: '@rubym', initial: 'R', color: 'bg-purple-100 text-purple-600 border-purple-200', bio: 'Dream pop & synthwave lover.', followers: 267, following: 123, isFollowing: false, mutual: 4 },
  { id: 'ben', name: 'benk', handle: '@benk', initial: 'B', color: 'bg-cyan-100 text-cyan-600 border-cyan-200', bio: 'Reggae & dub collector. Chill vibes.', followers: 145, following: 67, isFollowing: false },
  { id: 'zoe', name: 'zoep', handle: '@zoep', initial: 'Z', color: 'bg-fuchsia-100 text-fuchsia-600 border-fuchsia-200', bio: 'Piano ballads & singer-songwriters.', followers: 189, following: 89, isFollowing: false, mutual: 1 },
  { id: 'luke', name: 'lukem', handle: '@lukem', initial: 'L', color: 'bg-stone-100 text-stone-600 border-stone-200', bio: 'Prog rock & psychedelia explorer.', followers: 78, following: 34, isFollowing: false },
  { id: 'ivy', name: 'ivyt', handle: '@ivyt', initial: 'I', color: 'bg-rose-100 text-rose-500 border-rose-200', bio: 'Acoustic covers & indie folk.', followers: 234, following: 112, isFollowing: false, mutual: 3 },
  { id: 'max', name: 'maxh', handle: '@maxh', initial: 'M', color: 'bg-gray-100 text-gray-600 border-gray-200', bio: 'Techno & house DJ. Night owl.', followers: 312, following: 89, isFollowing: false },
  { id: 'cara', name: 'caraw', handle: '@caraw', initial: 'C', color: 'bg-yellow-100 text-yellow-700 border-yellow-200', bio: 'Country & Americana storyteller.', followers: 167, following: 56, isFollowing: false, mutual: 1 },
];

type Tab = 'following' | 'followers' | 'discover';

export default function Friends() {
  const [activeTab, setActiveTab] = useState<Tab>('following');
  const [users, setUsers] = useState<FriendUser[]>(discoverUsers);
  const [searchQuery, setSearchQuery] = useState('');

  const toggleFollow = (id: string) => {
    setUsers(prev => prev.map(u => u.id === id ? { ...u, isFollowing: !u.isFollowing } : u));
  };

  const filteredDiscover = users.filter(u =>
    !searchQuery ||
    u.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
    u.bio.toLowerCase().includes(searchQuery.toLowerCase())
  );

  const filteredFollowers = followersUsers.filter(u =>
    !searchQuery ||
    u.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
    u.bio.toLowerCase().includes(searchQuery.toLowerCase())
  );

  const displayUsers = activeTab === 'following' ? followingUsers :
    activeTab === 'followers' ? filteredFollowers :
    filteredDiscover;

  return (
    <div className="flex-1">
      {/* Header */}
      <div className="border-b border-divider">
        <div className="max-w-[720px] mx-auto px-5 py-10 md:py-12">
          <h1 className="text-[28px] md:text-[34px] font-extrabold text-ink tracking-tight leading-[1.05]">Friends</h1>
          <p className="text-[14px] text-muted mt-2">Discover people who love the same music you do.</p>
        </div>
      </div>

      <div className="max-w-[720px] mx-auto px-5 py-6 pb-16 w-full">
        {/* Search */}
        <div className="bg-surface border border-divider rounded-xl px-4 py-2.5 flex items-center gap-2 mb-6">
          <Search size={15} className="text-muted" />
          <input
            value={searchQuery}
            onChange={e => setSearchQuery(e.target.value)}
            placeholder="Search people…"
            className="flex-1 bg-transparent text-[13px] text-ink outline-none placeholder:text-placeholder"
          />
        </div>

        {/* Tabs: Following, Followers, Discover */}
        <div className="flex gap-1 mb-6 border-b border-divider">
          {[
            { key: 'following' as Tab, label: 'Following', count: followingUsers.length },
            { key: 'followers' as Tab, label: 'Followers', count: followersUsers.length },
            { key: 'discover' as Tab, label: 'Discover', count: discoverUsers.length },
          ].map(tab => (
            <button
              key={tab.key}
              onClick={() => setActiveTab(tab.key)}
              className={`px-4 py-2.5 text-[13px] font-semibold whitespace-nowrap transition-colors ${
                activeTab === tab.key ? 'text-ink border-b-2 border-ink -mb-px' : 'text-muted hover:text-ink'
              }`}
            >
              {tab.label} <span className="text-[11px] text-muted ml-0.5">{tab.count}</span>
            </button>
          ))}
        </div>

        {/* User list */}
        <div className="flex flex-col gap-3">
          {displayUsers.map((user, i) => (
            <motion.div
              key={user.id + activeTab}
              initial={{ opacity: 0, y: 6 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.25, delay: i * 0.04 }}
              className="flex items-start gap-4 border border-divider rounded-xl p-4 bg-white hover:border-mid transition"
            >
              {/* Avatar */}
              <Link to={`/profile/${user.name}`} className="flex-shrink-0">
                <div className={`w-11 h-11 rounded-full border-2 flex items-center justify-center text-[13px] font-bold ${user.color}`}>
                  {user.initial}
                </div>
              </Link>

              {/* Info */}
              <div className="flex-1 min-w-0">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <Link to={`/profile/${user.name}`} className="text-[14px] font-bold text-ink hover:text-mid transition">
                      {user.name}
                    </Link>
                    <p className="text-[12px] text-muted">{user.handle}</p>
                    <p className="text-[13px] text-mid mt-1.5 leading-relaxed">{user.bio}</p>
                    <div className="flex gap-4 mt-2">
                      <span className="text-[12px] text-muted"><strong className="text-ink">{user.followers}</strong> followers</span>
                      <span className="text-[12px] text-muted"><strong className="text-ink">{user.following}</strong> following</span>
                      {user.mutual !== undefined && (
                        <span className="text-[12px] text-muted">{user.mutual} mutual</span>
                      )}
                    </div>
                  </div>

                  {/* Follow button */}
                  <button
                    onClick={() => toggleFollow(user.id)}
                    className={`flex-shrink-0 flex items-center gap-1.5 px-4 py-2 rounded-lg text-[12px] font-bold transition ${
                      user.isFollowing
                        ? 'bg-surface text-ink border border-divider hover:border-red-300 hover:text-red-500'
                        : 'bg-ink text-white hover:opacity-80'
                    }`}
                  >
                    {user.isFollowing ? (
                      <><UserCheck size={14} /> Following</>
                    ) : (
                      <><UserPlus size={14} /> Follow</>
                    )}
                  </button>
                </div>
              </div>
            </motion.div>
          ))}

          {displayUsers.length === 0 && (
            <div className="flex flex-col items-center py-16 text-center">
              <Users size={32} className="text-subtle mb-3" />
              <p className="text-[14px] text-muted">
                {activeTab === 'discover' ? 'No users match your search.' : activeTab === 'following' ? 'You\'re not following anyone yet.' : 'No followers yet.'}
              </p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
