import Link from 'next/link';
import { Shield, Lock, Globe, Eye, Trash2, Cookie, Mail, FileText, ArrowLeft, BarChart3 } from 'lucide-react';

const sections = [
  {
    icon: Shield,
    title: '1. Information We Collect',
    body: 'We collect information you provide directly when creating an account, including your email address, display name, username, and (optionally) a profile photo and bio. We collect activity data you generate on the service — ratings, written reviews, Mixes, saved albums, follows, likes, and comments. If you choose to connect a third-party service such as Spotify, we import the data you authorize (for example your top and recently-played artists) to personalize recommendations, and store it against your account until you disconnect. We also collect limited technical and usage data — pages visited, search queries, feature interactions, device and browser type, and IP address — to operate, secure, and improve the service.',
  },
  {
    icon: Lock,
    title: '2. How We Use Your Information',
    body: 'We use your information to operate sillajuku, personalize your discovery feed and recommendations, display your public profile and reviews to other users, measure and improve the platform, diagnose errors, prevent abuse, and communicate important service updates. We do not use your data to build advertising profiles, and we do not run third-party advertising.',
  },
  {
    icon: BarChart3,
    title: '3. Analytics & Diagnostics',
    body: 'To understand how the product is used and to fix problems, we use PostHog for privacy-conscious product analytics (which pages and features are used, aggregated engagement) and Sentry for error and performance diagnostics (crash reports and the technical context around them, which may include your IP address). These providers process data on our behalf under contract and are not permitted to use it for their own purposes. We do not sell this data or use it for advertising. See the Cookies section below for how this works in your browser and how to limit it.',
  },
  {
    icon: Globe,
    title: '4. Information Sharing',
    body: 'We do not sell your personal data. Your ratings, reviews, public Mixes, and profile are public by default and visible to other users. We share data with service providers who help us run the platform — Supabase (database and authentication), Vercel (hosting), Upstash (caching), PostHog (product analytics), and Sentry (error diagnostics) — each acting as our processor under contract. Music metadata, cover art, and related information are sourced from third-party catalogs, including MusicBrainz, the Cover Art Archive, Deezer, Last.fm, and Apple/iTunes. We may disclose information if required by law or to protect the rights, safety, and security of our users and the service. We may share anonymized, aggregated statistics that cannot identify you.',
  },
  {
    icon: Trash2,
    title: '5. Data Retention',
    body: 'We retain account data for as long as your account is active. If you delete your account, your personal information is removed within 30 days, except where we must retain limited records to comply with legal obligations or resolve disputes. Anonymized or aggregated data that can no longer identify you may be retained for statistical purposes.',
  },
  {
    icon: Eye,
    title: '6. Your Rights',
    body: 'You have the right to access, correct, or delete your personal data. Most settings can be managed directly from your profile and settings, and you can delete your account at any time from Settings. For data export or any request you cannot complete in-app, contact admin@sillajuku.com.',
  },
  {
    icon: Globe,
    title: '7. Korean Users (PIPA)',
    body: 'sillajuku is operated from the Republic of Korea and complies with the Personal Information Protection Act (PIPA). We collect and use personal information based on your consent given at sign-up and as necessary to perform the service. You may withdraw consent, request access, correction, deletion, or suspension of processing of your personal information at any time by contacting admin@sillajuku.com. Children under 14 require the consent of a legal guardian to create an account. You may also file a complaint with the Personal Information Protection Commission (privacy.go.kr) or the Korea Internet & Security Agency (privacy KISA, 118).',
  },
  {
    icon: Globe,
    title: '8. GDPR (European Users)',
    body: 'If you are located in the European Economic Area, the UK, or Switzerland, we process your data under these lawful bases: performance of a contract (operating your account and the core service), legitimate interests (improving the product, security, and abuse prevention, balanced against your rights), and consent (where you opt in, for example non-essential analytics cookies or push notifications). You have the right to access, rectify, erase, restrict, or port your data, and to object to processing based on legitimate interests. To exercise any of these, contact admin@sillajuku.com; we respond within 30 days. You may also lodge a complaint with your local data protection supervisory authority.',
  },
  {
    icon: Globe,
    title: '9. CCPA (California Residents)',
    body: 'California residents have the right to know what personal information we collect, to request its deletion, and to opt out of its "sale" or "sharing." We do not sell or share personal information as those terms are defined by the CCPA/CPRA, so there is nothing to opt out of. To exercise any of these rights, contact admin@sillajuku.com; we will not discriminate against you for making a request.',
  },
  {
    icon: Cookie,
    title: '10. Cookies & Local Storage',
    body: 'We use only strictly-necessary cookies and storage — to keep you signed in and remember your language preference. We do not use cookies for advertising, cross-site tracking, or analytics profiling. Our product analytics (PostHog) and error diagnostics (Sentry) run cookieless: they set no cookies or persistent identifiers in your browser, and our analytics honors the "Do Not Track" browser signal. Because we use no non-essential cookies, no cookie-consent banner is shown; this would change if we ever introduced non-essential cookies.',
  },
  {
    icon: FileText,
    title: '11. Changes to This Policy',
    body: 'We may update this policy from time to time. Significant changes will be posted on the site or emailed to you. Continued use after changes take effect constitutes acceptance.',
  },
  {
    icon: Mail,
    title: '12. Contact',
    body: 'For privacy questions or to exercise any of your rights, contact admin@sillajuku.com. We typically respond within 24–48 hours and within any period required by applicable law.',
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
          <p className="text-[13px] text-muted">Last updated: August 2026</p>
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
