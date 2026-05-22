import { useState } from 'react';
import { useParams, Link } from 'react-router-dom';
import { motion } from 'framer-motion';
import { albums, getUserProfile } from '@/data';
import { AlbumCard } from '@/components/AlbumCard';
import { Cover } from '@/components/Cover';
import { UserPlus, UserCheck } from 'lucide-react';

const tabs = ['All', 'Albums', 'EPs', 'Singles', 'Compilations', 'Lists'];

export default function Profile() {
  const { id } = useParams<{ id: string }>();
  const [activeTab, setActiveTab] = useState('All');
  const [isFollowing, setIsFollowing] = useState(false);

  const profile = getUserProfile(id || 'kenneth');
  if (!profile) {
    return (
      <div className="max-w-[1440px] mx-auto px-5 py-20 text-center">
        <h1 className="text-2xl font-bold text-ink">User not found</h1>
        <Link to="/" className="text-muted hover:text-ink mt-4 inline-block">← Back to home</Link>
      </div>
    );
  }

  const isMe = profile.id === 'kenneth';

  const filteredAlbums = activeTab === 'All'
    ? albums.slice(0, 12)
    : activeTab === 'Lists'
      ? []
      : albums.filter(a => a.type === activeTab).slice(0, 12);

  return (
    <div className="flex flex-col">
      {/* Profile header */}
      <div className="bg-white border-b border-divider">
        <div className="max-w-[1440px] mx-auto px-5 py-8">
          <div className="flex items-start gap-5 md:gap-6">
            <div className={`w-[64px] h-[64px] md:w-[72px] md:h-[72px] rounded-full ${profile.avatarColor} flex items-center justify-center font-extrabold text-[24px] md:text-[28px] flex-shrink-0`}>
              {profile.initial}
            </div>
            <div className="flex-1 min-w-0">
              <div className="flex items-start justify-between gap-4">
                <div className="min-w-0">
                  <h1 className="text-[20px] md:text-[22px] font-extrabold text-ink tracking-tight">{profile.name}</h1>
                  <p className="text-[13px] text-muted">{profile.handle}</p>
                  <p className="text-[13px] text-mid mt-2 max-w-[480px]">{profile.bio}</p>
                </div>
                {isMe ? (
                  <button className="border border-divider text-ink text-[12px] font-semibold px-4 py-1.5 rounded-lg hover:bg-surface transition flex-shrink-0">
                    Edit profile
                  </button>
                ) : (
                  <button
                    onClick={() => setIsFollowing(!isFollowing)}
                    className={`flex-shrink-0 flex items-center gap-1.5 px-4 py-2 rounded-lg text-[12px] font-bold transition ${
                      isFollowing
                        ? 'bg-surface text-ink border border-divider hover:border-red-300 hover:text-red-500'
                        : 'bg-ink text-white hover:opacity-80'
                    }`}
                  >
                    {isFollowing ? (
                      <><UserCheck size={14} /> Following</>
                    ) : (
                      <><UserPlus size={14} /> Follow</>
                    )}
                  </button>
                )}
              </div>
              <div className="flex gap-5 md:gap-7 mt-4 flex-wrap">
                <div><span className="text-[15px] font-bold text-ink">{profile.ratings}</span> <span className="text-[12px] text-muted">ratings</span></div>
                <div><span className="text-[15px] font-bold text-ink">{profile.reviews}</span> <span className="text-[12px] text-muted">reviews</span></div>
                <div><span className="text-[15px] font-bold text-ink">{profile.following}</span> <span className="text-[12px] text-muted">following</span></div>
                <div><span className="text-[15px] font-bold text-ink">{profile.followers}</span> <span className="text-[12px] text-muted">followers</span></div>
              </div>
              <div className="flex gap-2 mt-3 flex-wrap">
                {profile.badges.map((badge, i) => (
                  <span key={i} className={`inline-flex items-center px-[10px] py-[3px] rounded-full text-[11px] font-semibold border ${
                    i === 0 ? 'border-mint text-mint-dark bg-mint-bg' : 'border-divider text-muted bg-surface'
                  }`}>
                    {badge}
                  </span>
                ))}
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Pinned Ten */}
      <div className="border-b border-divider bg-white">
        <div className="max-w-[1440px] mx-auto px-5 py-6">
          <div className="flex items-center gap-[10px] flex-wrap">
            {profile.pinnedAlbumIds.map((albumId, i) => {
              if (!albumId) {
                return (
                  <div key={i} className="w-[72px] h-[72px] md:w-[84px] md:h-[84px] rounded-md border border-dashed border-subtle" />
                );
              }
              const album = albums.find(a => a.id === albumId);
              if (!album) return null;
              return (
                <Link key={albumId} to={`/album/${albumId}`} className="block group">
                  <div className="w-[72px] h-[72px] md:w-[84px] md:h-[84px] rounded-md overflow-hidden group-hover:scale-105 transition-transform">
                    <Cover gradient={album.coverGradient} className="w-full h-full" />
                  </div>
                </Link>
              );
            })}
            {isMe && (
              <button className="w-[72px] h-[72px] md:w-[84px] md:h-[84px] rounded-md border border-dashed border-subtle flex items-center justify-center text-[11px] font-medium text-muted hover:text-ink hover:border-mid transition">
                Edit
              </button>
            )}
          </div>
        </div>
      </div>

      {/* Profile body */}
      <div className="max-w-[1440px] mx-auto px-5 py-6 pb-14 w-full">
        <div className="flex flex-col md:flex-row gap-8">
          {/* Left: stats sidebar */}
          <div className="w-full md:w-[220px] flex-shrink-0 flex flex-row md:flex-col gap-4 overflow-x-auto md:overflow-visible scrollbar-hide pb-2 md:pb-0">
            {/* Avg score */}
            <div className="bg-white rounded-xl border border-divider p-4 min-w-[140px] md:min-w-0">
              <p className="text-[11px] font-semibold text-muted uppercase mb-2" style={{ letterSpacing: '0.6px' }}>Avg Score</p>
              <p className="text-[32px] font-extrabold text-ink tracking-tight">{profile.avgScore}</p>
              <p className="text-[12px] text-muted">out of 5</p>
            </div>

            {/* Score distribution */}
            <div className="bg-white rounded-xl border border-divider p-4 min-w-[180px] md:min-w-0">
              <p className="text-[11px] font-semibold text-muted uppercase mb-3" style={{ letterSpacing: '0.6px' }}>Distribution</p>
              <div className="flex gap-[3px] items-end" style={{ height: 72 }}>
                {profile.distribution.map((h, i) => (
                  <div key={i} className="flex-1 flex flex-col justify-end">
                    <div className="rounded-t-[2px]" style={{ height: `${h}px`, background: i >= 7 ? '#3DFFD1' : '#EBEBEB' }} />
                  </div>
                ))}
              </div>
              <div className="flex justify-between mt-1">
                <span className="text-[10px] text-muted">½★</span>
                <span className="text-[10px] text-muted">5★</span>
              </div>
            </div>

            {/* Top genres */}
            <div className="bg-white rounded-xl border border-divider p-4 min-w-[160px] md:min-w-0">
              <p className="text-[11px] font-semibold text-muted uppercase mb-3" style={{ letterSpacing: '0.6px' }}>Top Genres</p>
              <div className="flex flex-col gap-2">
                {profile.topGenres.map(g => (
                  <div key={g.name} className="flex justify-between items-center">
                    <span className="text-[13px] text-ink">{g.name}</span>
                    <span className="text-[12px] text-muted">{g.count}</span>
                  </div>
                ))}
              </div>
            </div>

            {/* Insights */}
            <div className="bg-white rounded-xl border border-divider p-4 min-w-[200px] md:min-w-0">
              <p className="text-[11px] font-semibold text-muted uppercase mb-3" style={{ letterSpacing: '0.6px' }}>
                {isMe ? 'Insights' : 'vs. You'}
              </p>
              <div className="flex flex-col gap-2.5">
                {(isMe ? profile.insights : profile.relationshipInsights || profile.insights).map((insight, i) => (
                  <p key={i} className="text-[12px] text-mid leading-snug">{insight}</p>
                ))}
              </div>
            </div>
          </div>

          {/* Right: catalog */}
          <div className="flex-1 min-w-0">
            {/* Tabs */}
            <div className="flex gap-1 mb-6 border-b border-divider overflow-x-auto scrollbar-hide">
              {tabs.map(tab => (
                <button
                  key={tab}
                  onClick={() => setActiveTab(tab)}
                  className={`px-4 py-2.5 text-[13px] font-semibold whitespace-nowrap transition-colors ${activeTab === tab ? 'text-ink border-b-2 border-ink -mb-px' : 'text-muted hover:text-ink'}`}
                >
                  {tab}
                </button>
              ))}
            </div>

            {/* Album grid */}
            {filteredAlbums.length > 0 ? (
              <div className="grid gap-4" style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(130px, 1fr))' }}>
                {filteredAlbums.map(album => (
                  <motion.div key={album.id} initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.3 }}>
                    <AlbumCard album={album} size="md" showRating />
                  </motion.div>
                ))}
              </div>
            ) : (
              <p className="text-[14px] text-muted text-center py-12">No items found in this category.</p>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
