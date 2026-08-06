import { Link } from 'react-router-dom';
import { LegalPage, Section, Bullets } from '../components/LegalPage';
import { CONTACT_EMAIL, LEGAL_EFFECTIVE_DATE } from '../lib/legal';

export function Privacy() {
  return (
    <LegalPage title="Privacy Policy" effectiveDate={LEGAL_EFFECTIVE_DATE}>
      <p>
        Bandwagoner is a fantasy game where you draft real recording artists and score points
        from public music charts. This policy explains what we collect, why, and what control
        you have over it. It covers both the website at bandwagoner.com and the Bandwagoner
        iOS app.
      </p>

      <Section heading="Information you give us">
        <Bullets
          items={[
            <>
              <strong className="text-white">Account details.</strong> Your email address and
              the username you choose. Your password is stored only as a bcrypt hash, never as
              plain text, and cannot be read by us or recovered.
            </>,
            <>
              <strong className="text-white">Profile images.</strong> If you upload a profile
              picture or a team logo, we store that image so it can be shown to other members
              of your leagues. Uploading one is optional.
            </>,
            <>
              <strong className="text-white">Gameplay data.</strong> The leagues you create or
              join, your team name, draft picks, rosters and lineups, trades, waiver claims,
              and weekly scores. Other members of a league can see this, which is the point of
              the game.
            </>,
          ]}
        />
      </Section>

      <Section heading="Information collected automatically">
        <Bullets
          items={[
            <>
              <strong className="text-white">Standard server logs.</strong> Our servers record
              IP addresses, request paths, and timestamps as part of operating and securing the
              service.
            </>,
            <>
              <strong className="text-white">Device and browser information.</strong> Basic
              technical details such as browser or app version, sent with every request.
            </>,
          ]}
        />
      </Section>

      <Section heading="Analytics and error tracking">
        <p>
          What runs here differs between the website and the iOS app, so we describe them
          separately.
        </p>
        <Bullets
          items={[
            <>
              <strong className="text-white">The iOS app contains no analytics or tracking
              software.</strong> There is no advertising identifier, no session recording, and
              no third-party analytics package in the app. We do not track you across other
              companies' apps or websites.
            </>,
            <>
              <strong className="text-white">The website uses PostHog</strong> for product
              analytics and session replay, so we can see which features get used and where
              people get stuck. This only runs if you press Accept on the cookie banner. If you
              decline, or simply never answer, PostHog is never loaded and no analytics data
              leaves your browser. Session replay masks the contents of all input fields.
            </>,
            <>
              <strong className="text-white">We use Sentry</strong> to capture crashes and
              errors so we can fix them. Sentry is configured not to attach personal
              information to error reports.
            </>,
          ]}
        />
      </Section>

      <Section heading="What we do not collect">
        <p>
          We do not collect payment information, because Bandwagoner is free and has no
          purchases of any kind. We do not collect your location, your contacts, your photo
          library beyond an image you deliberately pick, your microphone, or your camera. We do
          not show advertising, we do not use advertising networks, and we do not sell or rent
          your personal information to anyone.
        </p>
      </Section>

      <Section heading="How we use your information">
        <Bullets
          items={[
            'To run the game: creating leagues, drafting, scoring your roster each week, and settling matchups.',
            'To send you transactional email you have asked for, such as a welcome message, trade and waiver notifications, and password reset links.',
            'To keep the service working and secure, including diagnosing errors and preventing abuse.',
            'To understand how the product is used, so we can improve it.',
          ]}
        />
        <p>
          We do not use your information to build advertising profiles, and we do not make
          automated decisions that have legal effects on you.
        </p>
      </Section>

      <Section heading="Services we rely on">
        <p>These providers process data on our behalf so the service can function:</p>
        <Bullets
          items={[
            <>
              <strong className="text-white">Railway</strong> hosts the application and the
              database.
            </>,
            <>
              <strong className="text-white">Resend</strong> delivers our transactional email.
            </>,
            <>
              <strong className="text-white">PostHog</strong> provides website analytics, only
              after you consent.
            </>,
            <>
              <strong className="text-white">Sentry</strong> provides error and crash reporting.
            </>,
          ]}
        />
        <p>
          Chart data comes from publicly available Apple Music charts. We only read those public
          charts. No information about you is ever sent to Apple as part of this.
        </p>
        <p>
          We may also disclose information if we are legally required to, or where necessary to
          protect the rights and safety of our users.
        </p>
      </Section>

      <Section heading="Cookies and local storage">
        <p>
          When you log in, we store a sign-in token so you stay logged in for up to 30 days. On
          the website this lives in your browser's local storage, and in the iOS app it is kept
          in the system keychain. This token is strictly necessary to use the service and is not
          used for tracking.
        </p>
        <p>
          Analytics cookies are set by PostHog on the website only, and only if you press Accept
          on the cookie banner.
        </p>
      </Section>

      <Section heading="Deleting your account">
        <p>
          You can delete your account at any time from Account Settings, in the Danger Zone
          section. It is immediate and does not require contacting us.
        </p>
        <p>Because leagues involve other people, deletion works like this:</p>
        <Bullets
          items={[
            'Leagues you run are handed to the next member who joined. If you are the only member, the league is deleted.',
            'If you have teams in leagues that have already drafted, those teams stay in place so your leaguemates keep their season history and matchup records. Your personal details are erased from them: your email and username are scrubbed, your profile picture is removed, and your password is destroyed. The team shows as unmanaged.',
            'If you have no teams in started leagues, your account record is deleted outright.',
            'Notifications and any outstanding password reset tokens are deleted in both cases.',
          ]}
        />
        <p>
          Otherwise we keep your information for as long as your account exists. You can reach
          us at{' '}
          <a href={`mailto:${CONTACT_EMAIL}`} className="text-indigo-400 hover:text-indigo-300">
            {CONTACT_EMAIL}
          </a>{' '}
          to request a copy of your data, correct it, or ask questions about this policy.
        </p>
      </Section>

      <Section heading="Security">
        <p>
          Traffic is encrypted in transit. Passwords are stored only as bcrypt hashes. No system
          is perfectly secure, and we cannot guarantee absolute security, but we take reasonable
          measures to protect your information.
        </p>
      </Section>

      <Section heading="Children">
        <p>
          Bandwagoner is not directed at children under 13, and we do not knowingly collect
          personal information from them. If you believe a child under 13 has given us personal
          information, contact us and we will delete it.
        </p>
      </Section>

      <Section heading="Changes to this policy">
        <p>
          If we make material changes, we will update the effective date at the top of this page
          and, where appropriate, notify you in the app. Continuing to use Bandwagoner after a
          change means you accept the updated policy.
        </p>
      </Section>

      <Section heading="Contact">
        <p>
          Questions about this policy or your data can go to{' '}
          <a href={`mailto:${CONTACT_EMAIL}`} className="text-indigo-400 hover:text-indigo-300">
            {CONTACT_EMAIL}
          </a>
          . See also our{' '}
          <Link to="/terms" className="text-indigo-400 hover:text-indigo-300">
            Terms of Service
          </Link>
          .
        </p>
      </Section>
    </LegalPage>
  );
}
