export default function PrivacyPage() {
  return (
    <div className="bg-white min-h-screen">
      <div className="bg-surface border-b border-[#EBEBEB]">
        <div className="max-w-[720px] mx-auto px-5 py-8">
          <h1 className="text-[24px] font-extrabold text-ink" style={{ letterSpacing: '-0.6px' }}>
            Privacy Policy
          </h1>
          <p className="text-[13px] text-muted mt-1">Last updated: April 2025</p>
        </div>
      </div>

      <div className="max-w-[720px] mx-auto px-5 py-10 pb-16 prose-section">
        <Section title="1. Who We Are">
          <p>
            neiro ("we", "us", "our") is a music rating and discovery platform. We are committed to
            protecting your personal information and being transparent about what we collect and why.
          </p>
        </Section>

        <Section title="2. Information We Collect">
          <p>We collect the following information when you use neiro:</p>
          <ul>
            <li>
              <strong>Account information</strong> — your email address when you register or log in.
            </li>
            <li>
              <strong>User-generated content</strong> — album ratings, written reviews, and any other
              content you submit to the platform.
            </li>
            <li>
              <strong>Usage data</strong> — pages visited and interactions within the app, used solely
              to improve the service.
            </li>
          </ul>
          <p>We do not collect payment information, phone numbers, or physical addresses.</p>
        </Section>

        <Section title="3. How We Use Your Information">
          <ul>
            <li>To create and maintain your account.</li>
            <li>To display your ratings and reviews to other users (this is core to the service).</li>
            <li>To generate personalized music recommendations based on your rating history.</li>
            <li>To improve the platform and fix issues.</li>
          </ul>
          <p>We do not sell your personal data to third parties. We do not use your data for advertising.</p>
        </Section>

        <Section title="4. Third-Party Services">
          <p>neiro relies on the following third-party services:</p>
          <ul>
            <li>
              <strong>Spotify</strong> — we use the Spotify API to display album artwork, metadata, and
              music discovery features. Your use of neiro is subject to{' '}
              <a href="https://www.spotify.com/us/legal/privacy-policy/" target="_blank" rel="noopener noreferrer">
                Spotify's Privacy Policy
              </a>
              .
            </li>
            <li>
              <strong>Supabase</strong> — we use Supabase for authentication and database storage. Your
              data is stored on Supabase-managed infrastructure. See{' '}
              <a href="https://supabase.com/privacy" target="_blank" rel="noopener noreferrer">
                Supabase's Privacy Policy
              </a>
              .
            </li>
          </ul>
        </Section>

        <Section title="5. Data Retention">
          <p>
            We retain your account data and content for as long as your account is active. If you
            delete your account, your personal information and content will be removed from our systems
            within 30 days, except where we are required by law to retain it.
          </p>
        </Section>

        <Section title="6. Your Rights">
          <p>You have the right to:</p>
          <ul>
            <li>Access the personal data we hold about you.</li>
            <li>Request correction of inaccurate data.</li>
            <li>Request deletion of your account and associated data.</li>
            <li>Export your ratings and reviews.</li>
          </ul>
          <p>
            To exercise any of these rights, contact us at the email address below.
          </p>
        </Section>

        <Section title="7. Cookies">
          <p>
            neiro uses essential cookies only — specifically, a session cookie to keep you logged in.
            We do not use tracking cookies or third-party advertising cookies.
          </p>
        </Section>

        <Section title="8. Children's Privacy">
          <p>
            neiro is not directed at children under the age of 13. We do not knowingly collect personal
            information from children. If you believe a child has provided us with personal data, please
            contact us and we will delete it promptly.
          </p>
        </Section>

        <Section title="9. Changes to This Policy">
          <p>
            We may update this Privacy Policy from time to time. We will notify registered users of
            significant changes by email or by posting a notice on the site. Continued use of neiro
            after changes constitutes acceptance of the updated policy.
          </p>
        </Section>

        <Section title="10. Contact">
          <p>
            If you have questions about this Privacy Policy or how your data is handled, please contact
            us at: <a href="mailto:privacy@neiro.app">privacy@neiro.app</a>
          </p>
        </Section>
      </div>
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="mb-8">
      <h2 className="text-[16px] font-bold text-ink mb-3">{title}</h2>
      <div className="text-[14px] text-mid leading-relaxed space-y-2 [&_ul]:list-disc [&_ul]:pl-5 [&_ul]:space-y-1.5 [&_a]:text-mint-dark [&_a]:underline [&_a]:hover:opacity-80 [&_strong]:text-ink">
        {children}
      </div>
    </div>
  );
}
