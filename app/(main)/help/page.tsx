'use client';

import Link from 'next/link';
import { useState } from 'react';
import { Search, ChevronDown, Send, Check, Clock, HelpCircle, ArrowLeft } from 'lucide-react';

const faqs = [
  {
    q: 'How do I rate an album?',
    a: 'Navigate to any album page and click the stars under "Your Rating." You can update your rating at any time. Ratings range from 0.5 to 5.0 stars.',
  },
  {
    q: 'How do rankings work?',
    a: 'Rankings are curated by sillajuku and organized by country and genre. Each user can submit one personal Top 10 ranking per category. The community ranking aggregates all user submissions into a live leaderboard.',
  },
  {
    q: 'Can I edit my ranking?',
    a: 'Yes. Go to the ranking page you submitted to, and your personal Top 10 will be editable. Click "Save Ranking" after making changes. You can update as often as you like.',
  },
  {
    q: 'Why is my album not appearing?',
    a: 'sillajuku pulls data from Spotify. If an album is missing, it may not yet be in the database. Try searching with a different spelling, or contact us to request an addition.',
  },
  {
    q: 'What is the Pinned Ten?',
    a: 'Your Pinned Ten is a public showcase of your 10 all-time favorite albums. It appears on your profile. You can edit it anytime from your profile page.',
  },
  {
    q: 'Who can see my reviews?',
    a: 'By default, reviews are public. You can change this in Settings > Preferences under "Default review visibility." Options include Public, Followers only, and Private.',
  },
  {
    q: 'How do I follow someone?',
    a: "Go to any user's profile and click the Follow button. You can also discover people through the Friends page.",
  },
  {
    q: 'What is Wrapped?',
    a: 'Wrapped is your year-in-review summary. It shows how many albums you rated, your average score, top genres, most active month, and your highest/lowest rated albums.',
  },
];

const categories = [
  'Report a bug',
  'Suggest a feature',
  'Ask a question',
  'Report content/user',
];

export default function HelpPage() {
  const [search, setSearch] = useState('');
  const [openFaq, setOpenFaq] = useState<number | null>(null);
  const [category, setCategory] = useState('');
  const [message, setMessage] = useState('');
  const [email, setEmail] = useState('');
  const [submitted, setSubmitted] = useState(false);

  const filteredFaqs = faqs.filter(f =>
    f.q.toLowerCase().includes(search.toLowerCase()) ||
    f.a.toLowerCase().includes(search.toLowerCase())
  );

  const handleSubmit = () => {
    if (!message.trim() || !category) return;
    setSubmitted(true);
    setMessage('');
    setCategory('');
  };

  return (
    <div className="flex-1">
      {/* Header */}
      <div className="border-b border-divider bg-surface">
        <div className="max-w-[720px] mx-auto px-5 py-10 md:py-14">
          <Link href="/" className="inline-flex items-center gap-1.5 text-[12px] text-muted hover:text-ink transition mb-4">
            <ArrowLeft size={14} /> Back to home
          </Link>
          <div className="flex items-center gap-3 mb-2">
            <HelpCircle size={28} className="text-ink" strokeWidth={1.8} />
            <h1 className="text-[28px] md:text-[34px] font-extrabold text-ink tracking-tight">Help & Feedback</h1>
          </div>
          <p className="text-[14px] text-muted">Find answers or reach out to us directly.</p>
        </div>
      </div>

      <div className="max-w-[720px] mx-auto px-5 py-10 pb-20 w-full">
        {/* FAQ section */}
        <section className="mb-14">
          <h2
            className="text-[13px] font-bold text-muted uppercase mb-5"
            style={{ letterSpacing: '0.7px' }}
          >
            Quick Help
          </h2>

          <div className="bg-surface border border-divider rounded-xl px-4 py-2.5 flex items-center gap-2 mb-6">
            <Search size={15} className="text-muted flex-shrink-0" />
            <input
              value={search}
              onChange={e => setSearch(e.target.value)}
              placeholder="Search questions…"
              className="flex-1 bg-transparent text-[13px] text-ink outline-none placeholder:text-placeholder"
            />
          </div>

          <div className="flex flex-col gap-2">
            {filteredFaqs.map((faq, i) => (
              <div key={i} className="border border-divider rounded-xl bg-white overflow-hidden">
                <button
                  onClick={() => setOpenFaq(openFaq === i ? null : i)}
                  className="w-full flex items-center justify-between px-4 py-3.5 text-left hover:bg-surface/50 transition"
                >
                  <span className="text-[14px] font-semibold text-ink pr-4">{faq.q}</span>
                  <ChevronDown
                    size={16}
                    className={`text-muted flex-shrink-0 transition-transform duration-200 ${openFaq === i ? 'rotate-180' : ''}`}
                  />
                </button>
                {openFaq === i && (
                  <div className="px-4 pb-4">
                    <p className="text-[13px] text-mid leading-relaxed">{faq.a}</p>
                  </div>
                )}
              </div>
            ))}
          </div>

          {filteredFaqs.length === 0 && (
            <p className="text-[13px] text-muted text-center py-8">
              No matching questions. Try another search or send us a message below.
            </p>
          )}
        </section>

        {/* Contact form */}
        <section className="mb-10">
          <h2
            className="text-[13px] font-bold text-muted uppercase mb-5"
            style={{ letterSpacing: '0.7px' }}
          >
            Contact Us
          </h2>

          {submitted ? (
            <div className="border border-mint rounded-2xl p-6 bg-mint-bg">
              <div className="flex items-center gap-3 mb-2">
                <div className="w-8 h-8 rounded-full bg-mint flex items-center justify-center">
                  <Check size={16} className="text-mint-dark" />
                </div>
                <p className="text-[15px] font-bold text-mint-dark">We received your message</p>
              </div>
              <p className="text-[13px] text-mid ml-11">Typical response time: 24–48 hours.</p>
              <button
                onClick={() => setSubmitted(false)}
                className="ml-11 mt-3 text-[12px] font-semibold text-muted hover:text-ink transition underline"
              >
                Send another
              </button>
            </div>
          ) : (
            <div className="border border-divider rounded-2xl p-6 bg-white">
              <div className="mb-4">
                <label className="block text-[13px] font-semibold text-ink mb-2">What do you need?</label>
                <div className="flex flex-wrap gap-2">
                  {categories.map(c => (
                    <button
                      key={c}
                      onClick={() => setCategory(c)}
                      className={`px-3 py-1.5 rounded-full text-[11px] font-semibold border-2 transition ${
                        category === c
                          ? 'border-mint bg-mint-bg text-mint-dark'
                          : 'border-divider text-muted hover:border-ink hover:text-ink'
                      }`}
                    >
                      {c}
                    </button>
                  ))}
                </div>
              </div>

              <div className="mb-4">
                <label className="block text-[13px] font-semibold text-ink mb-2">
                  Message <span className="text-red-500">*</span>
                </label>
                <textarea
                  rows={5}
                  value={message}
                  onChange={e => setMessage(e.target.value)}
                  placeholder="Describe your issue or question…"
                  className="w-full bg-surface border border-divider rounded-xl px-4 py-3 text-[13px] text-ink outline-none resize-none hover:border-mid focus:border-ink transition"
                />
              </div>

              <div className="mb-5">
                <label className="block text-[13px] font-semibold text-ink mb-2">
                  Email <span className="text-muted font-normal">(optional)</span>
                </label>
                <input
                  type="email"
                  value={email}
                  onChange={e => setEmail(e.target.value)}
                  placeholder="your@email.com"
                  className="w-full bg-surface border border-divider rounded-xl px-4 py-2.5 text-[13px] text-ink outline-none hover:border-mid focus:border-ink transition"
                />
              </div>

              <button
                onClick={handleSubmit}
                disabled={!message.trim() || !category}
                className={`flex items-center gap-2 px-6 py-2.5 rounded-xl text-[13px] font-bold transition ${
                  message.trim() && category
                    ? 'bg-ink text-white hover:opacity-80'
                    : 'bg-surface text-subtle border border-divider cursor-not-allowed'
                }`}
              >
                <Send size={14} /> Send
              </button>
            </div>
          )}
        </section>

        <div className="flex items-center gap-2 text-[12px] text-muted">
          <Clock size={14} />
          <span>We usually respond within 24–48 hours.</span>
        </div>
      </div>
    </div>
  );
}
