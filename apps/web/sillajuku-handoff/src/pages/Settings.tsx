import { useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { motion, AnimatePresence } from 'framer-motion';
import {
  User, Sliders, Bell, Shield, AlertTriangle,
  LogOut, Trash2, Camera
} from 'lucide-react';

type TabKey = 'account' | 'preferences' | 'notifications' | 'privacy' | 'danger';

interface Tab {
  key: TabKey;
  label: string;
  icon: React.ComponentType<{ size?: number; strokeWidth?: number }>;
}

const tabs: Tab[] = [
  { key: 'account', label: 'Account', icon: User },
  { key: 'preferences', label: 'Preferences', icon: Sliders },
  { key: 'notifications', label: 'Notifications', icon: Bell },
  { key: 'privacy', label: 'Privacy', icon: Shield },
  { key: 'danger', label: 'Danger Zone', icon: AlertTriangle },
];

const regions = ['Global', 'Korea', 'Japan', 'United States', 'United Kingdom', 'Philippines', 'Indonesia', 'Thailand', 'Vietnam', 'China'];
const allGenres = ['K-Pop', 'K-Indie', 'K-R&B', 'K-Rap', 'J-Pop', 'J-Rock', 'City Pop', 'Hip-Hop', 'R&B', 'Rock', 'Electronic', 'Pop', 'Jazz', 'Folk', 'Soul', 'Indie', 'Alternative', 'Metal', 'Classical'];
const visibilityOptions = ['Public', 'Followers only', 'Private'];

export default function Settings() {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const urlTab = searchParams.get('tab') as TabKey | null;
  const validTabs: TabKey[] = ['account', 'preferences', 'notifications', 'privacy', 'danger'];
  const [activeTab, setActiveTab] = useState<TabKey>(validTabs.includes(urlTab!) ? urlTab! : 'account');
  const [saved, setSaved] = useState(false);

  const handleSave = () => {
    setSaved(true);
    setTimeout(() => setSaved(false), 2000);
  };

  return (
    <div className="flex-1">
      <div className="max-w-[900px] mx-auto px-5 py-10 pb-20 w-full">
        {/* Header */}
        <div className="mb-8">
          <h1 className="text-[28px] md:text-[32px] font-extrabold text-ink tracking-tight">Settings</h1>
          <p className="text-[13px] text-muted mt-1">Manage your account, preferences, and privacy.</p>
        </div>

        {/* Desktop: side-by-side / Mobile: stacked */}
        <div className="flex flex-col md:flex-row gap-6 md:gap-8">
          {/* Tabs sidebar — desktop sticky, mobile horizontal scroll */}
          <nav className="md:w-[180px] flex-shrink-0 flex md:flex-col gap-1 overflow-x-auto md:overflow-visible scrollbar-hide pb-1 md:pb-0">
            {tabs.map(({ key, label, icon: Icon }) => (
              <button
                key={key}
                onClick={() => setActiveTab(key)}
                className={`flex items-center gap-2.5 px-3 py-2.5 rounded-xl text-[13px] font-semibold whitespace-nowrap transition md:w-full ${
                  activeTab === key
                    ? 'bg-mint-bg text-mint-dark'
                    : 'text-muted hover:bg-surface hover:text-ink'
                }`}
              >
                <Icon size={16} strokeWidth={activeTab === key ? 2.2 : 1.8} />
                {label}
              </button>
            ))}
          </nav>

          {/* Content panel */}
          <div className="flex-1 min-w-0">
            <AnimatePresence mode="wait">
              {activeTab === 'account' && (
                <motion.div key="account" initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }} transition={{ duration: 0.2 }}>
                  <Section title="Account">
                    {/* Profile photo */}
                    <div className="flex items-center gap-4 mb-6">
                      <div className="w-16 h-16 rounded-full bg-mint-bg border-2 border-mint flex items-center justify-center font-extrabold text-mint-dark text-[20px]">
                        K
                      </div>
                      <button className="flex items-center gap-2 px-4 py-2 rounded-lg border border-divider text-[12px] font-semibold text-muted hover:bg-surface transition">
                        <Camera size={14} /> Change photo
                      </button>
                    </div>

                    <Field label="Display name" defaultValue="Kenneth" />
                    <Field label="Username" defaultValue="kenneth" hint="@kenneth" />
                    <Field label="Bio" defaultValue="Music explorer. K-indie obsessive. Somehow still listening to 2012 K-Pop." textarea />
                    <Field label="Email" defaultValue="kenneth@example.com" type="email" />

                    <div className="flex gap-3 mt-6">
                      <button onClick={handleSave} className="bg-ink text-white rounded-xl px-6 py-2.5 text-[13px] font-bold hover:opacity-80 transition">
                        {saved ? 'Saved ✓' : 'Save changes'}
                      </button>
                      <button onClick={() => navigate('/login')} className="flex items-center gap-1.5 px-4 py-2.5 rounded-xl border border-divider text-[13px] font-semibold text-muted hover:bg-surface transition">
                        <LogOut size={14} /> Log out
                      </button>
                    </div>
                  </Section>
                </motion.div>
              )}

              {activeTab === 'preferences' && (
                <motion.div key="preferences" initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }} transition={{ duration: 0.2 }}>
                  <Section title="Preferences">
                    <div className="mb-5">
                      <label className="block text-[13px] font-semibold text-ink mb-2">Default region</label>
                      <select className="w-full bg-surface border border-divider rounded-xl px-4 py-2.5 text-[13px] text-ink outline-none cursor-pointer hover:border-mid transition">
                        {regions.map(r => <option key={r} value={r}>{r}</option>)}
                      </select>
                    </div>

                    <div className="mb-5">
                      <label className="block text-[13px] font-semibold text-ink mb-2">Favorite genres</label>
                      <div className="flex flex-wrap gap-2">
                        {allGenres.map(g => {
                          const active = ['K-R&B', 'K-Indie', 'Hip-Hop'].includes(g);
                          return (
                            <button
                              key={g}
                              className={`px-3 py-1.5 rounded-full text-[11px] font-semibold border-2 transition ${
                                active ? 'border-mint bg-mint-bg text-mint-dark' : 'border-divider text-muted hover:border-ink hover:text-ink'
                              }`}
                            >
                              {active ? '✓ ' : '+ '}{g}
                            </button>
                          );
                        })}
                      </div>
                    </div>

                    <div className="mb-5">
                      <label className="block text-[13px] font-semibold text-ink mb-2">Rating display</label>
                      <div className="flex gap-2">
                        {['Stars', 'Decimal'].map(opt => (
                          <button
                            key={opt}
                            className={`px-4 py-2 rounded-lg text-[12px] font-semibold border transition ${
                              opt === 'Stars' ? 'border-ink text-ink' : 'border-divider text-muted hover:border-mid'
                            }`}
                          >
                            {opt}
                          </button>
                        ))}
                      </div>
                    </div>

                    <div className="mb-5">
                      <label className="block text-[13px] font-semibold text-ink mb-2">Default review visibility</label>
                      <select className="w-full bg-surface border border-divider rounded-xl px-4 py-2.5 text-[13px] text-ink outline-none cursor-pointer hover:border-mid transition">
                        {visibilityOptions.map(v => <option key={v} value={v}>{v}</option>)}
                      </select>
                    </div>

                    <button onClick={handleSave} className="bg-ink text-white rounded-xl px-6 py-2.5 text-[13px] font-bold hover:opacity-80 transition mt-2">
                      {saved ? 'Saved ✓' : 'Save changes'}
                    </button>
                  </Section>
                </motion.div>
              )}

              {activeTab === 'notifications' && (
                <motion.div key="notifications" initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }} transition={{ duration: 0.2 }}>
                  <Section title="Notifications">
                    <Toggle label="Likes on my reviews" defaultOn />
                    <Toggle label="Replies to my reviews" defaultOn />
                    <Toggle label="New followers" defaultOn />
                    <Toggle label="Ranking updates" defaultOn />
                    <Toggle label="Monthly capsule" />
                    <button onClick={handleSave} className="bg-ink text-white rounded-xl px-6 py-2.5 text-[13px] font-bold hover:opacity-80 transition mt-4">
                      {saved ? 'Saved ✓' : 'Save changes'}
                    </button>
                  </Section>
                </motion.div>
              )}

              {activeTab === 'privacy' && (
                <motion.div key="privacy" initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }} transition={{ duration: 0.2 }}>
                  <Section title="Privacy">
                    <div className="mb-5">
                      <label className="block text-[13px] font-semibold text-ink mb-2">Profile visibility</label>
                      <select className="w-full bg-surface border border-divider rounded-xl px-4 py-2.5 text-[13px] text-ink outline-none cursor-pointer hover:border-mid transition">
                        {visibilityOptions.map(v => <option key={v} value={v}>{v}</option>)}
                      </select>
                    </div>
                    <div className="mb-5">
                      <label className="block text-[13px] font-semibold text-ink mb-2">Catalog visibility</label>
                      <select className="w-full bg-surface border border-divider rounded-xl px-4 py-2.5 text-[13px] text-ink outline-none cursor-pointer hover:border-mid transition">
                        {visibilityOptions.map(v => <option key={v} value={v}>{v}</option>)}
                      </select>
                    </div>
                    <div className="mb-5">
                      <label className="block text-[13px] font-semibold text-ink mb-2">Listen Later visibility</label>
                      <select className="w-full bg-surface border border-divider rounded-xl px-4 py-2.5 text-[13px] text-ink outline-none cursor-pointer hover:border-mid transition">
                        {['Public', 'Private'].map(v => <option key={v} value={v}>{v}</option>)}
                      </select>
                    </div>
                    <button onClick={handleSave} className="bg-ink text-white rounded-xl px-6 py-2.5 text-[13px] font-bold hover:opacity-80 transition mt-2">
                      {saved ? 'Saved ✓' : 'Save changes'}
                    </button>
                  </Section>
                </motion.div>
              )}

              {activeTab === 'danger' && (
                <motion.div key="danger" initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }} transition={{ duration: 0.2 }}>
                  <div className="border border-red-200 rounded-2xl p-6 bg-red-50/50">
                    <h3 className="text-[15px] font-bold text-red-700 mb-1">Danger Zone</h3>
                    <p className="text-[12px] text-red-600/80 mb-6">These actions are permanent and cannot be undone.</p>

                    <div className="flex flex-col gap-4">
                      <div className="flex items-start justify-between gap-4">
                        <div>
                          <p className="text-[13px] font-semibold text-ink">Deactivate account</p>
                          <p className="text-[12px] text-muted mt-0.5">Temporarily hide your profile. You can reactivate anytime.</p>
                        </div>
                        <button className="flex-shrink-0 px-4 py-2 rounded-lg border border-red-200 text-[12px] font-semibold text-red-600 hover:bg-red-100 transition">
                          Deactivate
                        </button>
                      </div>

                      <div className="border-t border-red-100" />

                      <div className="flex items-start justify-between gap-4">
                        <div>
                          <p className="text-[13px] font-semibold text-ink">Delete account</p>
                          <p className="text-[12px] text-muted mt-0.5">Permanently remove all your data. This cannot be undone.</p>
                        </div>
                        <button className="flex-shrink-0 px-4 py-2 rounded-lg bg-red-600 text-[12px] font-semibold text-white hover:bg-red-700 transition flex items-center gap-1.5">
                          <Trash2 size={13} /> Delete
                        </button>
                      </div>
                    </div>
                  </div>
                </motion.div>
              )}
            </AnimatePresence>
          </div>
        </div>
      </div>
    </div>
  );
}

/* ── subcomponents ── */

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="border border-divider rounded-2xl p-6 bg-white">
      <h2 className="text-[16px] font-bold text-ink mb-5">{title}</h2>
      {children}
    </div>
  );
}

function Field({ label, defaultValue, hint, type = 'text', textarea }: {
  label: string; defaultValue?: string; hint?: string; type?: string; textarea?: boolean;
}) {
  return (
    <div className="mb-4">
      <label className="block text-[13px] font-semibold text-ink mb-1.5">{label}</label>
      {textarea ? (
        <textarea
          rows={3}
          defaultValue={defaultValue}
          className="w-full bg-surface border border-divider rounded-xl px-4 py-2.5 text-[13px] text-ink outline-none resize-none hover:border-mid focus:border-ink transition"
        />
      ) : (
        <input
          type={type}
          defaultValue={defaultValue}
          className="w-full bg-surface border border-divider rounded-xl px-4 py-2.5 text-[13px] text-ink outline-none hover:border-mid focus:border-ink transition"
        />
      )}
      {hint && <p className="text-[11px] text-muted mt-1">{hint}</p>}
    </div>
  );
}

function Toggle({ label, defaultOn = false }: { label: string; defaultOn?: boolean }) {
  const [on, setOn] = useState(defaultOn);
  return (
    <div className="flex items-center justify-between py-3 border-b border-divider last:border-0">
      <span className="text-[13px] text-ink">{label}</span>
      <button
        onClick={() => setOn(!on)}
        className={`w-10 h-6 rounded-full transition relative ${on ? 'bg-mint' : 'bg-subtle'}`}
      >
        <span className={`absolute top-[2px] w-5 h-5 rounded-full bg-white shadow-sm transition-transform ${on ? 'translate-x-[18px]' : 'translate-x-[2px]'}`} />
      </button>
    </div>
  );
}
