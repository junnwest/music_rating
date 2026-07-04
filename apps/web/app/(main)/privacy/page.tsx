import Link from 'next/link';
import { Shield, Lock, Globe, Eye, Trash2, Cookie, Mail, FileText, ArrowLeft } from 'lucide-react';

const sections = [
  {
    icon: Shield,
    title: '1. Information We Collect',
    body: 'We collect information you provide directly when creating an account, including your email address, display name, username, and profile photo. We also collect activity data — ratings, written reviews, Pinned Ten selections, and Listen Later saves. We collect usage data such as pages visited, search queries, and interaction data to improve the service.',
  },
  {
    icon: Lock,
    title: '2. How We Use Your Information',
    body: 'We use your information to operate sillajuku, personalize your discovery feed and recommendations, display your public profile and reviews to other users, improve the platform, and communicate important service updates.',
  },
  {
    icon: Globe,
    title: '3. Information Sharing',
    body: 'We do not sell your personal data. Your ratings and reviews are public by default and visible to all users. We may share anonymized, aggregated data for research purposes. We use Supabase for database and authentication. Music metadata, cover art, and related information are sourced from a combination of third-party catalogs, including MusicBrainz, the Cover Art Archive, Deezer, Last.fm, and Apple/iTunes.',
  },
  {
    icon: Trash2,
    title: '4. Data Retention',
    body: 'We retain account data for as long as your account is active. If you delete your account, personal information is removed within 30 days. Anonymized activity data may be retained for statistical purposes.',
  },
  {
    icon: Eye,
    title: '5. Your Rights',
    body: 'You have the right to access, correct, or delete your personal data. Most settings can be managed directly from your profile. For account deletion or data export, contact admin@sillajuku.com.',
  },
  {
    icon: Globe,
    title: '6. GDPR (European Users)',
    body: 'If you are located in the European Economic Area or UK, we process your data under the following lawful bases: performance of a contract (operating your account and the core service), legitimate interests (improving the product, security, abuse prevention), and consent (where you opt in, e.g. push notifications). You have the right to access, rectify, erase, restrict, or port your data, and to object to processing based on legitimate interests. Contact admin@sillajuku.com to exercise any of these rights; we will respond within 30 days. You also have the right to lodge a complaint with your local data protection supervisory authority.',
  },
  {
    icon: Globe,
    title: '7. CCPA (California Residents)',
    body: 'California residents have the right to know what personal information we collect, request deletion of that information, and opt out of its "sale" — we do not sell personal information as defined by the CCPA, so there is nothing to opt out of. To exercise any of these rights, contact admin@sillajuku.com; we will not discriminate against you for making a request.',
  },
  {
    icon: Cookie,
    title: '8. Cookies',
    body: 'We use only strictly-necessary, functional cookies — to maintain your login session and remember your language preference. We do not use cookies for advertising, cross-site tracking, or analytics profiling. Because these cookies are strictly necessary for the service to function, no cookie-consent banner is shown; this will change if we ever introduce non-essential cookies.',
  },
  {
    icon: FileText,
    title: '9. Changes to This Policy',
    body: 'We may update this policy from time to time. Significant changes will be posted on the site or emailed to you. Continued use after changes constitutes acceptance.',
  },
  {
    icon: Mail,
    title: '10. Contact',
    body: 'For privacy questions, contact admin@sillajuku.com. We typically respond within 24–48 hours.',
  },
];

export default function PrivacyPage() {
  return (
    <div className="flex-1">
      {/* Hero */}
      <div className="border-b border-divider bg-surface">
        <div className="max-w-[720px] mx-auto px-5 py-12 md:py-16">
          <Link href="/" className="inline-flex items-center gap-1.5 text-[12px] text-muted hover:text-ink transition mb-4">
            <ArrowLeft size={14} /> Back to home
          </Link>
          <div className="flex items-center gap-3 mb-3">
            <Shield size={28} className="text-ink" strokeWidth={1.8} />
            <h1 className="text-[28px] md:text-[34px] font-extrabold text-ink tracking-tight">Privacy Policy</h1>
          </div>
          <p className="text-[13px] text-muted">Last updated: July 2026</p>
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

        <div className="mt-12 pt-8 border-t border-divider">
          <p className="text-[13px] text-muted">Questions about your data?</p>
          <a
            href="mailto:admin@sillajuku.com"
            className="inline-flex items-center gap-2 mt-2 text-[13px] font-semibold text-ink border border-divider rounded-lg px-4 py-2 hover:bg-surface transition"
          >
            <Mail size={14} /> Contact us
          </a>
        </div>
      </div>
    </div>
  );
}
