import { Link } from 'react-router-dom';
import { FileText, CheckCircle, AlertCircle, Music, AlertTriangle, ArrowLeft, Mail } from 'lucide-react';

export default function Terms() {
  const lastUpdated = "January 2026";

  const sections = [
    {
      icon: CheckCircle,
      title: "1. Acceptance of Terms",
      body: "By creating an account or using sillajuku, you agree to these Terms of Service. If you do not agree, please do not use the service. We may update these terms from time to time; continued use after changes constitutes acceptance.",
    },
    {
      icon: FileText,
      title: "2. Your Account",
      body: "You are responsible for maintaining the confidentiality of your login credentials and for all activity under your account. You must be at least 13 years old. You agree to provide accurate information when registering.",
    },
    {
      icon: Music,
      title: "3. User Content",
      body: "You retain ownership of the reviews and content you post. By submitting content, you grant sillajuku a non-exclusive, royalty-free license to display and distribute that content within the platform. You are solely responsible for what you submit. Do not post anything defamatory, illegal, or harmful.",
    },
    {
      icon: AlertCircle,
      title: "4. Prohibited Conduct",
      body: "You may not impersonate anyone, post false or spam content, attempt unauthorized access, use automated means to scrape data, or violate any applicable laws.",
    },
    {
      icon: Music,
      title: "5. Music Data",
      body: "Music metadata is sourced from Spotify. We are not affiliated with or endorsed by Spotify. Album artwork, artist images, and metadata are property of their respective rights holders and are used for informational purposes.",
    },
    {
      icon: AlertTriangle,
      title: "6. Disclaimers & Liability",
      body: "sillajuku is provided \"as is\" without warranties. We do not guarantee uninterrupted service. Ratings and reviews represent individual user opinions, not ours. We are not liable for indirect, incidental, or consequential damages.",
    },
    {
      icon: FileText,
      title: "7. Termination",
      body: "We reserve the right to suspend or terminate accounts that violate these terms. You may delete your account at any time from Settings.",
    },
    {
      icon: Mail,
      title: "8. Contact",
      body: "For legal questions, contact legal@sillajuku.com.",
    },
  ];

  return (
    <div className="flex-1">
      {/* Hero */}
      <div className="border-b border-divider bg-surface">
        <div className="max-w-[720px] mx-auto px-5 py-12 md:py-16">
          <Link to="/" className="inline-flex items-center gap-1.5 text-[12px] text-muted hover:text-ink transition mb-4">
            <ArrowLeft size={14} /> Back to home
          </Link>
          <div className="flex items-center gap-3 mb-3">
            <FileText size={28} className="text-ink" strokeWidth={1.8} />
            <h1 className="text-[28px] md:text-[34px] font-extrabold text-ink tracking-tight">Terms of Service</h1>
          </div>
          <p className="text-[13px] text-muted">Last updated: {lastUpdated}</p>
        </div>
      </div>

      {/* Body */}
      <div className="max-w-[720px] mx-auto px-5 py-10 pb-20">
        <div className="flex flex-col gap-8">
          {sections.map(({ icon: Icon, title, body }) => (
            <div key={title} className="flex gap-4">
              <div className="flex-shrink-0 mt-0.5">
                <div className="w-9 h-9 rounded-xl bg-surface border border-divider flex items-center justify-center">
                  <Icon size={16} strokeWidth={1.8} className="text-muted" />
                </div>
              </div>
              <div>
                <h2 className="text-[15px] font-bold text-ink mb-2">{title}</h2>
                <p className="text-[14px] leading-relaxed text-mid">{body}</p>
              </div>
            </div>
          ))}
        </div>

        {/* Footer */}
        <div className="mt-12 pt-8 border-t border-divider">
          <p className="text-[13px] text-muted">By using sillajuku, you agree to these terms and our <Link to="/privacy" className="text-ink underline hover:opacity-70">Privacy Policy</Link>.</p>
        </div>
      </div>
    </div>
  );
}
