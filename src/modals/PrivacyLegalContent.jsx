/** EU/EEA-oriented privacy notice (GDPR Arts. 13–14 style — have a lawyer review for your entity). */
export default function PrivacyLegalContent() {
  return (
    <>
      <section className="terms-modal-section" aria-labelledby="privacy-s1">
        <h2 id="privacy-s1" className="terms-modal-section-title">
          1. Who is responsible for your personal data?
        </h2>
        <p>
          The <strong>data controller</strong> for personal data processed in connection with the <strong>Plannix</strong>{' '}
          website and service is the legal entity operating Plannix, identified in signup, billing, or site contact
          materials (the <strong>“we”</strong>, <strong>“us”</strong>, or <strong>“controller”</strong>). If you are unsure
          who the controller is, use the contact details in the site footer or your account communications.
        </p>
        <p>
          You may contact us about data protection using the same contact channel. For EU/EEA and UK data-protection
          law, you also have the right to lodge a complaint with a supervisory authority (see section 9).
        </p>
      </section>

      <section className="terms-modal-section" aria-labelledby="privacy-s2">
        <h2 id="privacy-s2" className="terms-modal-section-title">
          2. Scope of this notice
        </h2>
        <p>
          This privacy notice describes how we process <strong>personal data</strong> when you visit our website, create
          an account, use Plannix, or interact with us (for example support or payment). It is intended to meet the
          transparency requirements of the <strong>General Data Protection Regulation</strong> (EU) 2016/679 (
          <strong>GDPR</strong>) and, where applicable, the UK GDPR and the Data Protection Act 2018.
        </p>
        <p>
          It does not cover third-party sites or services linked from Plannix; their privacy policies apply instead.
        </p>
      </section>

      <section className="terms-modal-section" aria-labelledby="privacy-s3">
        <h2 id="privacy-s3" className="terms-modal-section-title">
          3. What personal data we collect
        </h2>
        <p>Depending on how you use Plannix, we may process categories of data such as:</p>
        <p>
          <strong>Account and identity:</strong> for example name, email address, password (stored in hashed form where
          we operate authentication), and account identifiers.
        </p>
        <p>
          <strong>Service and content data:</strong> timetable layout preferences, class lists, academic-year and holiday
          information, and similar content you enter into the product. Some of this may relate to you as an individual
          or, where you enter data about pupils or colleagues, may indirectly concern others (you should only enter such
          data where you have a lawful basis to do so).
        </p>
        <p>
          <strong>Transaction and billing:</strong> subscription or payment-related data processed by our payment
          provider (for example Stripe), such as transaction IDs, plan type, and billing status. We do not store full
          payment card numbers on our servers when payments are handled by the provider.
        </p>
        <p>
          <strong>Technical and usage data:</strong> IP address, browser type, device identifiers, approximate location
          derived from IP, timestamps, and information collected via cookies or similar technologies where applicable
          (see section 8).
        </p>
        <p>
          <strong>Communications:</strong> messages you send us (for example support requests) and related metadata.
        </p>
      </section>

      <section className="terms-modal-section" aria-labelledby="privacy-s4">
        <h2 id="privacy-s4" className="terms-modal-section-title">
          4. Why we use your data and our legal bases (GDPR Art. 6)
        </h2>
        <p>We process personal data only where a lawful basis applies. Typically:</p>
        <p>
          <strong>Performance of a contract</strong> (Art. 6(1)(b) GDPR): to provide Plannix, create and manage your
          account, process payments for paid plans, and deliver features you subscribe to.
        </p>
        <p>
          <strong>Legitimate interests</strong> (Art. 6(1)(f) GDPR): to secure the service, prevent abuse and fraud,
          improve reliability and performance, analyse aggregated usage, and communicate operational messages, where
          those interests are not overridden by your rights.
        </p>
        <p>
          <strong>Consent</strong> (Art. 6(1)(a) GDPR): where we rely on consent—for example for non-essential cookies or
          certain marketing—you may withdraw consent at any time without affecting the lawfulness of processing based
          on consent before its withdrawal.
        </p>
        <p>
          <strong>Legal obligation</strong> (Art. 6(1)(c) GDPR): where we must retain or disclose information to comply
          with law, tax, or regulatory requirements.
        </p>
      </section>

      <section className="terms-modal-section" aria-labelledby="privacy-s5">
        <h2 id="privacy-s5" className="terms-modal-section-title">
          5. Recipients and processors
        </h2>
        <p>
          We use trusted service providers (<strong>processors</strong>) who process personal data on our instructions
          and under contracts that require appropriate security and confidentiality. Categories may include:
        </p>
        <p>
          <strong>Hosting and infrastructure</strong> (servers, storage), <strong>payment processing</strong> (e.g.
          Stripe or comparable providers), <strong>email or transactional messaging</strong>, and{' '}
          <strong>analytics or security</strong> tools where used.
        </p>
        <p>
          We may disclose personal data to <strong>professional advisers</strong>, in connection with a business
          transfer, or to <strong>public authorities</strong> where required by law or a valid legal request.
        </p>
      </section>

      <section className="terms-modal-section" aria-labelledby="privacy-s6">
        <h2 id="privacy-s6" className="terms-modal-section-title">
          6. International transfers
        </h2>
        <p>
          If personal data is transferred outside the <strong>European Economic Area (EEA)</strong> or the{' '}
          <strong>UK</strong>, we implement appropriate safeguards required by GDPR Chapter V—such as{' '}
          <strong>Standard Contractual Clauses</strong> approved by the European Commission or UK ICO, or transfers to
          countries subject to an adequacy decision—unless a derogation applies.
        </p>
        <p>You may request further information about transfers by contacting us.</p>
      </section>

      <section className="terms-modal-section" aria-labelledby="privacy-s7">
        <h2 id="privacy-s7" className="terms-modal-section-title">
          7. How long we keep data (retention)
        </h2>
        <p>
          We retain personal data only as long as necessary for the purposes in section 4, unless a longer period is
          required by law.
        </p>
        <p>
          <strong>Account data</strong> is generally kept for the life of your account and a reasonable period afterwards
          to resolve disputes, enforce terms, or comply with legal duties.
        </p>
        <p>
          <strong>Technical logs</strong> may be kept for shorter security and debugging periods.
        </p>
        <p>
          When data is no longer needed, we delete or anonymise it in line with our internal retention practices.
        </p>
      </section>

      <section className="terms-modal-section" aria-labelledby="privacy-s8">
        <h2 id="privacy-s8" className="terms-modal-section-title">
          8. Cookies and similar technologies
        </h2>
        <p>
          We use cookies and similar technologies where necessary for the operation of the site (for example session or
          security cookies), typically on the basis of <strong>legitimate interests</strong> or{' '}
          <strong>strictly necessary</strong> exemptions under the ePrivacy rules, as implemented in national law.
        </p>
        <p>
          Where we use <strong>non-essential</strong> cookies (for example analytics or marketing), we will request your
          <strong>consent</strong> where required and you can adjust choices via our cookie controls (for example the
          cookie banner or settings link in the footer).
        </p>
      </section>

      <section className="terms-modal-section" aria-labelledby="privacy-s9">
        <h2 id="privacy-s9" className="terms-modal-section-title">
          9. Your rights under the GDPR
        </h2>
        <p>Subject to conditions and exemptions in applicable law, you may have the right to:</p>
        <p>
          <strong>Access</strong> your personal data (Art. 15), <strong>rectification</strong> (Art. 16),{' '}
          <strong>erasure</strong> (“right to be forgotten”) (Art. 17), <strong>restriction</strong> of processing (Art.
          18), <strong>data portability</strong> (Art. 20), and <strong>object</strong> to processing based on legitimate
          interests (Art. 21), including profiling in certain cases.
        </p>
        <p>
          Where processing is based on <strong>consent</strong>, you may <strong>withdraw consent</strong> at any time
          (Art. 7(3)).
        </p>
        <p>
          You may <strong>lodge a complaint</strong> with a supervisory authority in your country of residence, place of
          work, or where an alleged infringement occurred. A list of EU supervisory authorities is published by the
          European Data Protection Board. In the UK, the supervisory authority is the Information Commissioner’s Office (
          <a href="https://ico.org.uk/" target="_blank" rel="noreferrer">
            ICO
          </a>
          ).
        </p>
        <p>
          To exercise your rights, contact us using the details published on this site. We may need to verify your
          identity before responding.
        </p>
      </section>

      <section className="terms-modal-section" aria-labelledby="privacy-s10">
        <h2 id="privacy-s10" className="terms-modal-section-title">
          10. Security
        </h2>
        <p>
          We implement appropriate <strong>technical and organisational measures</strong> to protect personal data
          against unauthorised access, loss, or alteration, in line with GDPR Art. 32. No method of transmission over the
          internet is completely secure; we encourage you to use strong passwords and protect your credentials.
        </p>
      </section>

      <section className="terms-modal-section" aria-labelledby="privacy-s11">
        <h2 id="privacy-s11" className="terms-modal-section-title">
          11. Automated decision-making
        </h2>
        <p>
          We do not use personal data for <strong>solely automated decision-making</strong>, including profiling, that
          produces legal or similarly significant effects concerning you. If that changes, we will update this notice
          and explain the logic and your rights.
        </p>
      </section>

      <section className="terms-modal-section" aria-labelledby="privacy-s12">
        <h2 id="privacy-s12" className="terms-modal-section-title">
          12. Children
        </h2>
        <p>
          Plannix is aimed at <strong>professional and school users</strong>. It is not directed at children for
          commercial profiling. If you believe we have collected personal data from a child without appropriate
          authority, please contact us and we will take steps to delete it where required.
        </p>
      </section>

      <section className="terms-modal-section" aria-labelledby="privacy-s13">
        <h2 id="privacy-s13" className="terms-modal-section-title">
          13. Changes to this notice
        </h2>
        <p>
          We may update this privacy notice to reflect legal, technical, or business changes. We will publish the updated
          version on this page and adjust the “last updated” date. Where changes materially affect you, we will provide
          additional notice where required by law.
        </p>
      </section>

      <section className="terms-modal-section" aria-labelledby="privacy-s14">
        <h2 id="privacy-s14" className="terms-modal-section-title">
          14. Legal disclaimer
        </h2>
        <p>
          This notice is provided for general information and transparency. It is <strong>not legal advice</strong>.
          You should obtain advice tailored to your organisation, especially if you use Plannix to process personal data
          about pupils, staff, or others on behalf of a school.
        </p>
      </section>
    </>
  );
}
