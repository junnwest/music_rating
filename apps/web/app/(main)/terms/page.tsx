import Link from 'next/link';
import { FileText, CheckCircle, AlertCircle, Music, AlertTriangle, ArrowLeft, Mail } from 'lucide-react';

const sections = [
  {
    icon: CheckCircle,
    title: '1. Acceptance of Terms',
    body: 'By creating an account or using sillajuku, you agree to these Terms of Service. If you do not agree, please do not use the service. We may update these terms from time to time; continued use after changes constitutes acceptance.',
  },
  {
    icon: FileText,
    title: '2. Your Account',
    body: 'You are responsible for maintaining the confidentiality of your login credentials and for all activity under your account. You must be at least 14 years old, or the minimum age of digital consent in your country if it is higher; users under that age require a legal guardian\'s consent. You agree to provide accurate information when registering and to keep it current.',
  },
  {
    icon: Music,
    title: '3. User Content',
    body: 'You retain ownership of the reviews and content you post. By submitting content, you grant sillajuku a non-exclusive, royalty-free license to display and distribute that content within the platform. You are solely responsible for what you submit. Do not post anything defamatory, illegal, or harmful.',
  },
  {
    icon: AlertCircle,
    title: '4. Prohibited Conduct',
    body: 'You may not impersonate anyone, post false or spam content, attempt unauthorized access, use automated means to scrape data, or violate any applicable laws.',
  },
  {
    icon: Music,
    title: '5. Music Data',
    body: 'Music metadata, cover art, and related information are sourced from a combination of third-party catalogs and databases, including MusicBrainz (released under a CC0 public-domain dedication), the Cover Art Archive, Deezer, Last.fm, and Apple/iTunes. We are not affiliated with, endorsed by, or sponsored by any of these services. Album artwork, artist images, and metadata remain the property of their respective rights holders and are used for informational, non-commercial cataloging purposes.',
  },
  {
    icon: Music,
    title: '6. Connected Services',
    body: 'You may choose to connect third-party services such as Spotify to import listening data and personalize your experience. Your use of those services remains governed by their own terms and privacy policies, and you are responsible for complying with them. You can disconnect a service at any time; doing so stops future imports and, on request, removes the imported data associated with your account.',
  },
  {
    icon: AlertTriangle,
    title: '7. Disclaimers & Liability',
    body: 'sillajuku is provided "as is" without warranties. We do not guarantee uninterrupted service. Ratings and reviews represent individual user opinions, not ours. To the fullest extent permitted by law, we are not liable for indirect, incidental, or consequential damages.',
  },
  {
    icon: FileText,
    title: '8. Termination',
    body: 'We reserve the right to suspend or terminate accounts that violate these terms. You may delete your account at any time from Settings.',
  },
  {
    icon: AlertCircle,
    title: '9. Copyright Complaints (DMCA)',
    body: 'If you believe content on sillajuku infringes your copyright, send a written notice to admin@sillajuku.com including: (1) a description of the copyrighted work you claim is infringed; (2) the specific URL or location of the material on sillajuku; (3) your contact information (name, address, phone, email); (4) a statement that you have a good-faith belief the use is not authorized by the copyright owner, its agent, or the law; (5) a statement, under penalty of perjury, that the notice is accurate and that you are authorized to act on the copyright owner’s behalf; and (6) your physical or electronic signature. We will review valid notices and remove or disable access to the identified material where appropriate. Accounts found to be repeat infringers may be terminated.',
  },
  {
    icon: FileText,
    title: '10. Governing Law',
    body: 'These Terms are governed by the laws of the Republic of Korea, without regard to conflict-of-law principles. Any dispute arising out of or relating to these Terms or your use of sillajuku will be subject to the exclusive jurisdiction of the courts of the Republic of Korea. Nothing in these Terms deprives a consumer of the mandatory protections of the law of their country of residence.',
  },
  {
    icon: Mail,
    title: '11. Contact',
    body: 'For legal questions, contact admin@sillajuku.com.',
  },
];

export default function TermsPage() {
  return (
    <div className="flex-1">
      {/* Hero */}
      <div className="border-b border-divider bg-surface">
        <div className="max-w-[720px] mx-auto px-5 py-12 md:py-16">
          <Link href="/" className="inline-flex items-center gap-1.5 text-[12px] text-muted hover:text-ink transition mb-4">
            <ArrowLeft size={14} /> Back to home
          </Link>
          <div className="flex items-center gap-3 mb-3">
            <FileText size={28} className="text-ink" strokeWidth={1.8} />
            <h1 className="text-[28px] md:text-[34px] font-extrabold text-ink tracking-tight">Terms of Service</h1>
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
          <p className="text-[13px] text-muted">
            By using sillajuku, you agree to these terms and our{' '}
            <Link href="/privacy" className="text-ink underline hover:opacity-70">Privacy Policy</Link>.
          </p>
        </div>
      </div>
    </div>
  );
}
