import { Link } from 'react-router-dom';
import { LegalPage, Section, Bullets } from '../components/LegalPage';
import { CONTACT_EMAIL } from '../lib/legal';

/**
 * Public support page. This is the URL given to Apple as the App Store
 * "Support URL", which review does fetch while logged out, so it must stay a
 * public route and must carry a contact address that actually reaches a human.
 *
 * Everything answered below is a description of real app behavior, not
 * aspiration. If a rule changes (lineup lock window, waiver timing, when a
 * trade executes), fix it here too, because a support page that contradicts
 * the app is worse than no support page.
 */
export function Support() {
  const mailto = (
    <a href={`mailto:${CONTACT_EMAIL}`} className="text-indigo-400 hover:text-indigo-300">
      {CONTACT_EMAIL}
    </a>
  );

  return (
    <LegalPage title="Support">
      <p>
        Bandwagoner is a fantasy game where you draft real recording artists and score points
        from public music charts. If something is broken, confusing, or someone in a league is
        behaving badly, this page is how you reach us.
      </p>

      <Section heading="Contact us">
        <p>Email {mailto} and we will get back to you, usually within a couple of days.</p>
        <p>
          It helps if you include your username, the name of the league involved, and whether
          you were on the iOS app or the website. If you are reporting an error, the rough time
          it happened lets us find it in our logs.
        </p>
      </Section>

      <Section heading="Reporting or blocking another member">
        <p>
          In the iOS app, open a league, go to the Standings tab, and tap the button at the end
          of any member's row. From there you can report them or block them. Blocking hides
          their name and picture from you everywhere in the app. Reports reach us immediately
          and we review every one.
        </p>
        <p>
          On the website, email {mailto} with the league name and the member involved and we
          will handle it the same way.
        </p>
      </Section>

      <Section heading="Account help">
        <Bullets
          items={[
            <>
              <strong className="text-white">Forgot your password.</strong> Use the "Forgot
              password?" link on the login screen. The emailed link works once and expires
              after an hour. If it does not arrive, check your spam folder first.
            </>,
            <>
              <strong className="text-white">Deleting your account.</strong> Go to Account
              Settings and use the Danger Zone at the bottom. You only need your password, and
              it takes effect immediately. See the{' '}
              <Link to="/privacy" className="text-indigo-400 hover:text-indigo-300">
                Privacy Policy
              </Link>{' '}
              for what happens to leagues you are in.
            </>,
            <>
              <strong className="text-white">Changing your username or picture.</strong> Both
              live in Account Settings.
            </>,
          ]}
        />
      </Section>

      <Section heading="How the game works">
        <Bullets
          items={[
            <>
              <strong className="text-white">Scoring.</strong> Each artist earns points from
              where their songs and albums sit on the charts, how far they moved since last
              week, and how many weeks in a row they have stayed on. Songs and albums are
              scored separately.
            </>,
            <>
              <strong className="text-white">The week.</strong> A scoring week runs Tuesday
              00:00 through Sunday 23:59 Pacific time. Scores update through the week and are
              finalized early Monday morning Pacific.
            </>,
            <>
              <strong className="text-white">Lineup locks.</strong> Your lineup is locked for
              the whole scoring week and reopens on Monday, so Monday is when you set your team
              for the week ahead.
            </>,
            <>
              <strong className="text-white">Missing the draft.</strong> Every pick has a
              clock. If it runs out, the app auto-drafts the best available artist that fits an
              open slot on your roster, so a missed pick never stalls the draft.
            </>,
            <>
              <strong className="text-white">Free agents and waivers.</strong> During the
              scoring week, claims queue up and resolve Sunday night in waiver order. On Monday
              pickups are instant and cost you nothing.
            </>,
            <>
              <strong className="text-white">Trades.</strong> Once both sides accept, a trade
              executes at the end of the week rather than immediately, and the rest of the
              league can veto it before then.
            </>,
          ]}
        />
      </Section>

      <Section heading="League questions">
        <Bullets
          items={[
            <>
              <strong className="text-white">Removing a member.</strong> A commissioner can
              remove someone from the Settings tab, but only before the draft. Once the draft
              runs, that team is part of the season's schedule and cannot be deleted.
            </>,
            <>
              <strong className="text-white">Handing over the league.</strong> A commissioner
              can transfer the role to any other member from the Settings tab at any time.
            </>,
            <>
              <strong className="text-white">Scores look wrong.</strong> Email us the league,
              the week, and the artist. Chart data refreshes once a day, so a very recent chart
              move may not have landed yet.
            </>,
          ]}
        />
      </Section>

      <Section heading="Money">
        <p>
          Bandwagoner is free. There are no purchases, no subscriptions, no entry fees, no
          wagering and no prizes. If anyone asks you to pay to play, it is not us.
        </p>
      </Section>
    </LegalPage>
  );
}
