import { Link } from 'react-router-dom';
import { LegalPage, Section, Bullets } from '../components/LegalPage';
import { CONTACT_EMAIL, GOVERNING_LAW_STATE, LEGAL_EFFECTIVE_DATE } from '../lib/legal';

export function Terms() {
  return (
    <LegalPage title="Terms of Service" effectiveDate={LEGAL_EFFECTIVE_DATE}>
      <p>
        These terms govern your use of Bandwagoner, including the website at bandwagoner.com and
        the Bandwagoner iOS app. By creating an account or using the service, you agree to them.
        If you do not agree, please do not use Bandwagoner.
      </p>

      <Section heading="Free to play, with no prizes">
        <p>
          Bandwagoner is entirely free. There are no entry fees, no purchases, no subscriptions,
          and no in-app currency. Leagues on Bandwagoner do not award cash or any other prize of
          value, and the service does not support wagering, betting, or any form of real money
          gaming. It is a game played for fun among friends.
        </p>
      </Section>

      <Section heading="Eligibility and your account">
        <p>
          You must be at least 13 years old to use Bandwagoner. You are responsible for keeping
          your password confidential and for activity that happens under your account. Please
          give us an email address you actually control, since it is how we send password resets
          and league notifications. Tell us promptly if you think someone else is using your
          account.
        </p>
      </Section>

      <Section heading="Acceptable use">
        <p>You agree not to:</p>
        <Bullets
          items={[
            'Create additional accounts in order to gain an unfair advantage in a league, occupy extra roster spots, or manipulate a draft, trade, or waiver outcome.',
            'Harass, threaten, or abuse other members, or use team names, usernames, or uploaded images that are hateful, obscene, or infringe someone else\'s rights.',
            'Attempt to break, overload, probe, or gain unauthorized access to the service or to another member\'s account.',
            'Scrape, resell, or redistribute data from the service, or use automated tools to interact with it.',
            'Use Bandwagoner to run a contest that awards money or prizes, or to facilitate gambling of any kind.',
          ]}
        />
      </Section>

      <Section heading="Your content">
        <p>
          You keep ownership of the team names, league names, and images you upload. You give us
          permission to store and display that content where the service needs to show it, such
          as to other members of your leagues. You confirm you have the right to upload what you
          upload. We may remove content that breaks these terms.
        </p>
      </Section>

      <Section heading="Chart data and third-party names">
        <p>
          Scoring is calculated from publicly available Apple Music chart rankings. Artist names,
          song titles, album titles, and chart positions are referenced to describe real world
          chart performance.
        </p>
        <p>
          Apple and Apple Music are trademarks of Apple Inc. Bandwagoner is an independent
          project and is not affiliated with, endorsed by, sponsored by, or in any way officially
          connected to Apple Inc., to any recording artist, or to any record label.
        </p>
      </Section>

      <Section heading="Availability of the service">
        <p>
          We may change, suspend, or discontinue any part of Bandwagoner at any time. Scoring
          depends on chart data published by a third party. If that data is delayed, incomplete,
          or unavailable for a week, scores may be provisional, corrected later, or calculated
          from the signals that are available. We do not guarantee that scores, standings, or
          results will be free of errors.
        </p>
      </Section>

      <Section heading="Termination">
        <p>
          You may delete your account at any time from Account Settings. We may suspend or
          terminate an account that breaks these terms or that we reasonably believe is harming
          other members or the service. The consequences of deletion for your leagues are
          described in our{' '}
          <Link to="/privacy" className="text-indigo-400 hover:text-indigo-300">
            Privacy Policy
          </Link>
          .
        </p>
      </Section>

      <Section heading="Disclaimer and limitation of liability">
        <p>
          Bandwagoner is provided on an as is and as available basis, without warranties of any
          kind, whether express or implied, including any implied warranties of merchantability,
          fitness for a particular purpose, and non-infringement. We do not warrant that the
          service will be uninterrupted, timely, secure, or error free.
        </p>
        <p>
          To the fullest extent permitted by law, we will not be liable for any indirect,
          incidental, special, consequential, or punitive damages, or for any loss of data,
          arising out of your use of the service. Because Bandwagoner is provided free of charge,
          our total liability to you for any claim relating to the service is limited to one
          hundred US dollars.
        </p>
        <p>
          Some jurisdictions do not allow certain limitations, so parts of this section may not
          apply to you.
        </p>
      </Section>

      <Section heading="Changes to these terms">
        <p>
          We may update these terms from time to time. When we do, we will change the effective
          date at the top of this page. If you keep using Bandwagoner after an update, you accept
          the revised terms.
        </p>
      </Section>

      <Section heading="Governing law">
        <p>
          These terms are governed by the laws of the State of {GOVERNING_LAW_STATE} and the
          United States, without regard to conflict of law principles.
        </p>
      </Section>

      <Section heading="Contact">
        <p>
          Questions about these terms can go to{' '}
          <a href={`mailto:${CONTACT_EMAIL}`} className="text-indigo-400 hover:text-indigo-300">
            {CONTACT_EMAIL}
          </a>
          .
        </p>
      </Section>
    </LegalPage>
  );
}
