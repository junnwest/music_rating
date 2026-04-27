export default function TermsPage() {
  return (
    <div className="bg-white min-h-screen">
      <div className="bg-surface border-b border-[#EBEBEB]">
        <div className="max-w-[720px] mx-auto px-5 py-8">
          <h1 className="text-[24px] font-extrabold text-ink" style={{ letterSpacing: '-0.6px' }}>
            Terms of Service
          </h1>
          <p className="text-[13px] text-muted mt-1">Last updated: April 2025</p>
        </div>
      </div>

      <div className="max-w-[720px] mx-auto px-5 py-10 pb-16">
        <Section title="1. Acceptance of Terms">
          <p>
            By creating an account or using neiro (the "Service"), you agree to be bound by these
            Terms of Service. If you do not agree, do not use the Service.
          </p>
        </Section>

        <Section title="2. Description of Service">
          <p>
            neiro is a music rating and discovery platform that allows users to rate albums, write
            reviews, and receive personalized music recommendations. Music metadata and artwork are
            provided via the Spotify API.
          </p>
        </Section>

        <Section title="3. Accounts">
          <ul>
            <li>You must provide a valid email address to create an account.</li>
            <li>You are responsible for maintaining the security of your account and password.</li>
            <li>You may not share your account with others or create accounts on behalf of others.</li>
            <li>
              We reserve the right to suspend or terminate accounts that violate these Terms.
            </li>
          </ul>
        </Section>

        <Section title="4. User Content">
          <p>
            "User Content" means any ratings, reviews, or other content you submit to neiro.
          </p>
          <ul>
            <li>
              <strong>You retain ownership</strong> of your User Content.
            </li>
            <li>
              By submitting User Content, you grant neiro a non-exclusive, worldwide, royalty-free
              license to display and distribute it as part of the Service.
            </li>
            <li>
              Your ratings and reviews are visible to other users by default. This is core to the
              Service.
            </li>
            <li>
              You are solely responsible for the content you submit. Do not post content that is
              unlawful, defamatory, harassing, or infringes on third-party rights.
            </li>
          </ul>
        </Section>

        <Section title="5. Prohibited Conduct">
          <p>You agree not to:</p>
          <ul>
            <li>Use the Service for any unlawful purpose.</li>
            <li>Attempt to gain unauthorized access to any part of the Service or its infrastructure.</li>
            <li>Scrape, crawl, or otherwise extract data from the Service in bulk without written permission.</li>
            <li>Submit false, misleading, or spam reviews.</li>
            <li>Harass, threaten, or abuse other users.</li>
            <li>Impersonate another person or entity.</li>
          </ul>
        </Section>

        <Section title="6. Music Data and Spotify">
          <p>
            Music metadata, album artwork, and related content displayed on neiro are sourced from the
            Spotify API and are subject to Spotify's terms. neiro is not affiliated with or endorsed
            by Spotify AB.
          </p>
        </Section>

        <Section title="7. Intellectual Property">
          <p>
            The neiro name, logo, and all original site content (excluding User Content and Spotify
            data) are the property of neiro. You may not reproduce or use them without written
            permission.
          </p>
        </Section>

        <Section title="8. Disclaimer of Warranties">
          <p>
            The Service is provided "as is" and "as available" without warranties of any kind, either
            express or implied. We do not warrant that the Service will be uninterrupted, error-free,
            or free of harmful components. We do not guarantee the accuracy of any music metadata
            sourced from third parties.
          </p>
        </Section>

        <Section title="9. Limitation of Liability">
          <p>
            To the fullest extent permitted by applicable law, neiro shall not be liable for any
            indirect, incidental, special, consequential, or punitive damages arising out of your use
            of — or inability to use — the Service, even if we have been advised of the possibility of
            such damages.
          </p>
        </Section>

        <Section title="10. Termination">
          <p>
            You may delete your account at any time. We may suspend or terminate your access to the
            Service at our discretion, including for violation of these Terms, with or without notice.
          </p>
        </Section>

        <Section title="11. Changes to These Terms">
          <p>
            We may update these Terms from time to time. We will notify registered users of material
            changes by email or by posting a notice on the site. Continued use of the Service after
            changes take effect constitutes your acceptance of the new Terms.
          </p>
        </Section>

        <Section title="12. Governing Law">
          <p>
            These Terms are governed by and construed in accordance with applicable law. Any disputes
            shall be resolved in the courts of competent jurisdiction.
          </p>
        </Section>

        <Section title="13. Contact">
          <p>
            For questions about these Terms, contact us at:{' '}
            <a href="mailto:legal@neiro.app">legal@neiro.app</a>
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
