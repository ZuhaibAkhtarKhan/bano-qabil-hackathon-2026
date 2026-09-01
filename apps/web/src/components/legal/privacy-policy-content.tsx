type PrivacyPolicyContentProps = {
  appUrl: string;
};

export function PrivacyPolicyContent({ appUrl }: PrivacyPolicyContentProps) {
  return (
    <article className="privacy-policy space-y-8 text-sm leading-7 text-ink-muted">
      <p>
        This Privacy Policy describes how <strong className="text-ink">1-Apply</strong> (“we,” “us,” or “our”)
        collects, uses, stores, and protects information when you use our website, web application, and Chrome
        browser extension (together, the “Service”).
      </p>
      <p>
        By using the Service, you agree to this Privacy Policy. If you do not agree, do not use the Service.
      </p>

      <section className="space-y-3">
        <h2 className="text-lg font-semibold text-ink">1. Who we are</h2>
        <p>
          1-Apply is an application automation platform that helps users store application information once and reuse
          it across job, internship, scholarship, hackathon, and fellowship applications.
        </p>
        <p>
          For privacy questions, contact us using the contact method on our website or Chrome Web Store listing.
        </p>
      </section>

      <section className="space-y-3">
        <h2 className="text-lg font-semibold text-ink">2. Information we collect</h2>

        <h3 className="font-medium text-ink">2.1 Account information</h3>
        <p>When you create an account, we collect:</p>
        <ul className="list-disc space-y-1 pl-5">
          <li>Email address and password (or credentials from our authentication provider)</li>
          <li>Profile information you enter (name, phone, location, education, links, and similar fields)</li>
          <li>Onboarding and consent records (e.g., terms and AI processing consent)</li>
        </ul>

        <h3 className="font-medium text-ink">2.2 Application Memory (“Your kit”)</h3>
        <p>You may provide or we may extract from documents you upload:</p>
        <ul className="list-disc space-y-1 pl-5">
          <li>Resume and CV content</li>
          <li>Education, employment, projects, skills, certifications, and other evidence</li>
          <li>Answers to application questions you save or approve</li>
          <li>Links (e.g., LinkedIn, GitHub, portfolio)</li>
        </ul>

        <h3 className="font-medium text-ink">2.3 Documents</h3>
        <p>When you upload files, we store the file, metadata (name, type, version, upload time), and extracted text.</p>

        <h3 className="font-medium text-ink">2.4 Application and opportunity data</h3>
        <p>When you add opportunities or use our Chrome extension, we may collect:</p>
        <ul className="list-disc space-y-1 pl-5">
          <li>URLs of application forms and opportunity pages</li>
          <li>Form field labels, types, and options detected on third-party sites</li>
          <li>Deadlines, eligibility requirements, and questions parsed from postings</li>
          <li>Application status, attachments, and submission-related metadata you record in the Service</li>
        </ul>
        <p>
          We do <strong className="text-ink">not</strong> automatically submit applications on third-party sites on
          your behalf without your action on the host site.
        </p>

        <h3 className="font-medium text-ink">2.5 Chrome extension</h3>
        <ul className="list-disc space-y-1 pl-5">
          <li>Uses your signed-in session on the 1-Apply website to authenticate API requests</li>
          <li>Reads form structure and field content on pages you interact with when you use extension features</li>
          <li>
            May write values into form fields only when you enable filling; it does not bypass CAPTCHA, payment, or
            submit controls by design
          </li>
        </ul>
        <p>
          The extension requests permissions to access tabs you use with the extension, storage, cookies for your
          1-Apply site, and (when you grant) host access to application websites.
        </p>

        <h3 className="font-medium text-ink">2.6 Integrations (optional)</h3>
        <p>
          If you connect Google Calendar or Gmail, we receive OAuth tokens (stored encrypted) and process calendar or
          email data only as needed for features you enable. You can disconnect integrations in Settings.
        </p>

        <h3 className="font-medium text-ink">2.7 Technical and usage data</h3>
        <p>We may collect IP address, browser type, device information, request logs, error logs, and security events.</p>
      </section>

      <section className="space-y-3">
        <h2 className="text-lg font-semibold text-ink">3. How we use information</h2>
        <ul className="list-disc space-y-1 pl-5">
          <li>Provide, operate, and improve the Service</li>
          <li>Extract structured facts from documents you upload (with consent where required)</li>
          <li>Analyze opportunities, score eligibility, recommend resume versions, and prepare fill plans</li>
          <li>Generate draft answers only from information you have stored, when you request AI assistance</li>
          <li>Send in-app notifications (e.g., missing deadlines, document processing results)</li>
          <li>Sync calendar reminders when you connect Google Calendar</li>
          <li>Maintain security, prevent abuse, and comply with law</li>
        </ul>
        <p>We do <strong className="text-ink">not</strong> sell your personal information to third parties.</p>
      </section>

      <section className="space-y-3">
        <h2 className="text-lg font-semibold text-ink">4. Artificial intelligence</h2>
        <p>When AI features are enabled and you have given required consent:</p>
        <ul className="list-disc space-y-1 pl-5">
          <li>
            Document text and opportunity content may be sent to third-party AI providers (e.g., Google Gemini, Groq)
          </li>
          <li>AI outputs are grounded in your stored data; we avoid inventing credentials you did not provide</li>
          <li>You should review AI-generated or extracted content before relying on it for applications</li>
        </ul>
        <p>
          You may use parts of the Service without AI if no provider is configured or you choose not to consent to AI
          processing.
        </p>
      </section>

      <section className="space-y-3">
        <h2 className="text-lg font-semibold text-ink">5. How we share information</h2>
        <ul className="list-disc space-y-1 pl-5">
          <li>
            <strong className="text-ink">Infrastructure providers</strong> (e.g., Supabase, cloud hosting) — host and
            secure the Service
          </li>
          <li>
            <strong className="text-ink">AI providers</strong> (e.g., Google, Groq) — process text for extraction or
            drafting under their terms
          </li>
          <li>
            <strong className="text-ink">Google</strong> (if you connect Calendar/Gmail) — OAuth and sync features
          </li>
          <li>
            <strong className="text-ink">Legal requirements</strong> — when required by law or valid legal process
          </li>
        </ul>
        <p>We do not share your data with advertisers for targeted advertising.</p>
      </section>

      <section className="space-y-3">
        <h2 className="text-lg font-semibold text-ink">6. Data storage and security</h2>
        <ul className="list-disc space-y-1 pl-5">
          <li>Data is stored on secure cloud infrastructure with access controls</li>
          <li>Files are stored in private storage scoped to your account</li>
          <li>Database access uses row-level security so users can access only their own data</li>
          <li>Integration tokens are encrypted at rest</li>
          <li>Secrets are kept server-side and not exposed in the browser extension</li>
        </ul>
        <p>No method of transmission or storage is 100% secure. We cannot guarantee absolute security.</p>
      </section>

      <section className="space-y-3">
        <h2 className="text-lg font-semibold text-ink">7. Data retention</h2>
        <p>
          We retain your information while your account is active and as needed to provide the Service, resolve
          disputes, enforce agreements, and comply with law. If you delete your account or documents, we delete or
          anonymize associated data according to our deletion flows, except where retention is required by law.
        </p>
      </section>

      <section className="space-y-3">
        <h2 className="text-lg font-semibold text-ink">8. Your choices and rights</h2>
        <p>Depending on your location, you may have rights to:</p>
        <ul className="list-disc space-y-1 pl-5">
          <li>Access, correct, or delete personal information</li>
          <li>Export your data (Settings → export, where available)</li>
          <li>Withdraw consent for AI processing (may limit AI features)</li>
          <li>Disconnect third-party integrations</li>
          <li>Delete your account</li>
        </ul>
        <p>Contact us using the contact method on our website or store listing to exercise these rights.</p>
      </section>

      <section className="space-y-3">
        <h2 className="text-lg font-semibold text-ink">9. Children</h2>
        <p>
          The Service is not intended for children under 16. We do not knowingly collect personal information from
          children under 16.
        </p>
      </section>

      <section className="space-y-3">
        <h2 className="text-lg font-semibold text-ink">10. International users</h2>
        <p>
          Your information may be processed in countries where our providers operate. By using the Service, you consent
          to transfer and processing in those locations, subject to applicable law.
        </p>
      </section>

      <section className="space-y-3">
        <h2 className="text-lg font-semibold text-ink">11. Third-party websites and forms</h2>
        <p>
          The Service interacts with third-party application forms and websites not controlled by us. Their privacy
          practices apply when you use those sites.
        </p>
      </section>

      <section className="space-y-3">
        <h2 className="text-lg font-semibold text-ink">12. Changes to this policy</h2>
        <p>
          We may update this Privacy Policy from time to time. We will post the updated policy with a new “Last
          updated” date. Continued use after changes means you accept the updated policy.
        </p>
      </section>

      <section className="space-y-3">
        <h2 className="text-lg font-semibold text-ink">13. Contact</h2>
        <p>
          Website:{" "}
          <a href={appUrl} className="font-medium text-ink underline decoration-line underline-offset-2 hover:opacity-80">
            {appUrl}
          </a>
        </p>
        <p>For privacy-related questions, use the contact email on our Chrome Web Store listing or reach us through the app.</p>
      </section>

      <p className="text-xs text-ink-muted">1-Apply — Create once. Apply everywhere.</p>
    </article>
  );
}
