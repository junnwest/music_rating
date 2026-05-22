import { useState } from 'react';
import { Link } from 'react-router-dom';
import { motion, AnimatePresence } from 'framer-motion';

const genres = [
  'K-Pop', 'K-Indie', 'K-R&B', 'K-Rap', 'Korean Ballad', 'Korean Folk',
  'J-Pop', 'J-Rock', 'City Pop', 'Indie Rock', 'Alternative', 'Shoegaze',
  'Hip-Hop', 'R&B & Soul', 'Folk', 'Electronic', 'Pop', 'Classical',
];

const pickAlbums = [
  { id: 'palette', title: 'Palette', artist: 'IU', selected: true },
  { id: 'lilac', title: 'LILAC', artist: 'IU', selected: false },
  { id: 'chat-shire', title: 'Chat-Shire', artist: 'IU', selected: false },
  { id: 'broken-mirror', title: 'Broken Mirror', artist: 'offonoff', selected: true },
  { id: 'her', title: 'Her', artist: 'Hyukoh', selected: false },
  { id: 'night-swimming', title: 'Night Swimming', artist: 'Silica Gel', selected: false },
  { id: 'omg', title: 'OMG', artist: 'NewJeans', selected: false },
  { id: 'bleu', title: 'bleu', artist: '강태구', selected: false },
];

export default function Onboarding() {
  const [step, setStep] = useState(1);
  const [selectedGenres, setSelectedGenres] = useState<string[]>(['K-Pop', 'K-Indie', 'J-Pop']);
  const [selectedAlbums, setSelectedAlbums] = useState<string[]>(['palette', 'broken-mirror']);

  const toggleGenre = (g: string) => {
    setSelectedGenres(prev => prev.includes(g) ? prev.filter(x => x !== g) : [...prev, g]);
  };

  const toggleAlbum = (id: string) => {
    setSelectedAlbums(prev => prev.includes(id) ? prev.filter(x => x !== id) : [...prev, id]);
  };

  return (
    <div className="bg-white text-ink flex flex-col min-h-screen">
      <header className="border-b border-divider flex items-center px-5 md:px-9 h-[72px]">
        <Link to="/" className="flex items-center">
          <img src="/logo.png" alt="sillajuku" className="h-[44px] w-auto object-contain" />
        </Link>
      </header>

      <main className="flex-1 flex items-start justify-center px-4 py-14">
        <div className="w-full max-w-[560px]">
          {/* Step dots */}
          <div className="flex items-center gap-[7px] mb-8">
            {[1,2,3].map(s => (
              <div
                key={s}
                className={`rounded-full transition-all ${step === s ? 'w-[20px] h-[7px] bg-mint' : 'w-[7px] h-[7px] bg-divider'}`}
              />
            ))}
          </div>

          <AnimatePresence mode="wait">
            {step === 1 && (
              <motion.div
                key="step1"
                initial={{ opacity: 0, x: 20 }}
                animate={{ opacity: 1, x: 0 }}
                exit={{ opacity: 0, x: -20 }}
              >
                <h1 className="text-[28px] font-extrabold text-ink mb-1 tracking-tight">Welcome to sillajuku.</h1>
                <p className="text-[14px] text-muted mb-7 leading-relaxed">Let's set up your profile before you start rating.</p>

                <div className="space-y-4">
                  <div>
                    <label className="block text-[13px] font-semibold text-ink mb-[7px]">Display name</label>
                    <input type="text" defaultValue="Kenneth" className="w-full bg-surface border border-ink rounded-lg px-4 py-[10px] text-[14px] text-ink outline-none" />
                  </div>
                  <div>
                    <label className="block text-[13px] font-semibold text-ink mb-[7px]">Username</label>
                    <input type="text" defaultValue="kenneth" className="w-full bg-surface border border-divider rounded-lg px-4 py-[10px] text-[14px] text-ink outline-none" />
                    <p className="text-[11px] text-mint mt-1 font-semibold">✓ Available</p>
                  </div>
                  <div>
                    <label className="block text-[13px] font-semibold text-ink mb-[7px]">Bio <span className="font-normal text-muted">(optional)</span></label>
                    <textarea rows={2} placeholder="Tell us what you listen to…" className="w-full bg-surface border border-divider rounded-lg px-4 py-[10px] text-[14px] text-ink placeholder:text-placeholder outline-none resize-none" />
                  </div>
                  <button onClick={() => setStep(2)} className="w-full bg-ink text-white rounded-lg py-[13px] text-[14px] font-bold hover:opacity-80 transition">Continue →</button>
                </div>
              </motion.div>
            )}

            {step === 2 && (
              <motion.div
                key="step2"
                initial={{ opacity: 0, x: 20 }}
                animate={{ opacity: 1, x: 0 }}
                exit={{ opacity: 0, x: -20 }}
              >
                <h1 className="text-[28px] font-extrabold text-ink mb-1 tracking-tight">What do you listen to?</h1>
                <p className="text-[14px] text-muted mb-7 leading-relaxed">Pick the genres that fit. We'll use this to personalise your feed.</p>

                <div className="flex flex-wrap gap-2 mb-8">
                  {genres.map(g => {
                    const active = selectedGenres.includes(g);
                    return (
                      <button
                        key={g}
                        onClick={() => toggleGenre(g)}
                        className={`px-4 py-2 rounded-full text-[13px] font-semibold border-2 transition ${active ? 'border-mint bg-mint-bg text-mint-dark' : 'border-divider text-muted hover:border-ink hover:text-ink'}`}
                      >
                        {g}
                      </button>
                    );
                  })}
                </div>

                <button onClick={() => setStep(3)} className="w-full bg-ink text-white rounded-lg py-[13px] text-[14px] font-bold hover:opacity-80 transition">Continue →</button>
                <button className="w-full mt-3 text-[13px] text-muted hover:text-ink py-2 transition">Skip for now</button>
              </motion.div>
            )}

            {step === 3 && (
              <motion.div
                key="step3"
                initial={{ opacity: 0, x: 20 }}
                animate={{ opacity: 1, x: 0 }}
                exit={{ opacity: 0, x: -20 }}
              >
                <h1 className="text-[28px] font-extrabold text-ink mb-1 tracking-tight">Pick a few favourites.</h1>
                <p className="text-[14px] text-muted mb-7 leading-relaxed">Choose up to 10 albums for your Pinned Ten. You can change these anytime.</p>

                <div className="grid gap-3 mb-7" style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(130px, 1fr))' }}>
                  {pickAlbums.map(album => {
                    const selected = selectedAlbums.includes(album.id);
                    return (
                      <button
                        key={album.id}
                        onClick={() => toggleAlbum(album.id)}
                        className="text-left group"
                      >
                        <div className={`w-full aspect-square rounded-lg mb-1.5 relative transition ${selected ? 'ring-2 ring-mint' : 'hover:ring-2 hover:ring-mint/50'}`}>
                          <div className={`w-full h-full rounded-lg ${selected ? 'bg-mint-bg' : 'bg-surface border border-divider'}`} />
                          {selected && (
                            <div className="absolute top-1.5 right-1.5 w-5 h-5 rounded-full flex items-center justify-center bg-mint">
                              <span className="text-[10px] text-mint-dark font-extrabold">✓</span>
                            </div>
                          )}
                        </div>
                        <p className="text-[12px] font-semibold text-ink truncate">{album.title}</p>
                        <p className="text-[11px] text-muted truncate">{album.artist}</p>
                      </button>
                    );
                  })}
                </div>

                <p className="text-[12px] text-muted mb-5">{selectedAlbums.length} of 10 selected</p>
                <Link to="/">
                  <button className="w-full bg-ink text-white rounded-lg py-[13px] text-[14px] font-bold hover:opacity-80 transition">Finish →</button>
                </Link>
                <button className="w-full mt-3 text-[13px] text-muted hover:text-ink py-2 transition">Skip for now</button>
              </motion.div>
            )}
          </AnimatePresence>
        </div>
      </main>
    </div>
  );
}
