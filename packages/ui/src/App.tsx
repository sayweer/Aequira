import { LedgerPanel } from './components/LedgerPanel.js';
import { PrivacyProofPanel } from './components/PrivacyProofPanel.js';
import { RoundHeader } from './components/RoundHeader.js';
import { RoundWizard } from './components/RoundWizard.js';
import { useAequiraRound } from './hooks/useAequiraRound.js';
import { useWalletConnection } from './hooks/useWalletConnection.js';

const STEPS = [
  {
    title: 'Enroll',
    text: 'The institution verifies each applicant and hands them a private receipt. Only a commitment goes on chain.',
  },
  {
    title: 'Seal',
    text: 'Applicants prove they meet the rules; reviewers commit salted scores. The figures stay in their browsers.',
  },
  {
    title: 'Reveal',
    text: 'Reviewers open their scores into a tally anyone can recompute from the public ledger.',
  },
];

const App = () => {
  const wallet = useWalletConnection();
  const round = useAequiraRound(wallet.connectedWallet?.api ?? null);
  const isOpen = round.address !== null;

  return (
    <div className="app-shell">
      <header className="site-header">
        <a className="brand" href="/" aria-label="AEQUIRA home">
          <span className="brand-mark" aria-hidden="true" />
          AEQUIRA
        </a>
        <span className="chip" data-tone="neutral">
          Midnight Preprod
        </span>
      </header>

      <main>
        {isOpen ? (
          <>
            <RoundHeader round={round} wallet={wallet} />
            <RoundWizard round={round} wallet={wallet} />
            <LedgerPanel round={round} />
            <PrivacyProofPanel round={round} />
          </>
        ) : (
          <>
            <section className="intro" aria-labelledby="intro-heading">
              <div className="intro-copy">
                <h1 id="intro-heading">A score can be verified before it is seen.</h1>
                <p className="intro-lede">
                  AEQUIRA runs private scholarship and grant rounds on Midnight. Eligibility is
                  proven, scores are sealed, and the outcome is public — without publishing anyone’s
                  figures.
                </p>
              </div>
              <ol className="steps">
                {STEPS.map((step, index) => (
                  <li key={step.title}>
                    <span className="step-number" aria-hidden="true">
                      {index + 1}
                    </span>
                    <div>
                      <h2>{step.title}</h2>
                      <p>{step.text}</p>
                    </div>
                  </li>
                ))}
              </ol>
            </section>

            <RoundWizard round={round} wallet={wallet} />

            <section className="boundary is-preview" aria-labelledby="boundary-preview-heading">
              <div className="boundary-intro">
                <h2 id="boundary-preview-heading">The proof travels. The score does not.</h2>
              </div>
              <div className="boundary-grid">
                <div className="boundary-side" data-scope="public">
                  <h3>
                    Public <span>on the ledger</span>
                  </h3>
                  <p>
                    Eligibility rules, reviewer roster, enrollment commitments, application
                    pseudonyms, sealed score commitments and replay nullifiers.
                  </p>
                </div>
                <div className="boundary-side" data-scope="local">
                  <h3>
                    <span className="seal-glyph" aria-hidden="true" />
                    Local <span>in each browser</span>
                  </h3>
                  <p>
                    Applicant figures and secrets, reviewer secrets, scores and their salts — until
                    a reviewer chooses to reveal.
                  </p>
                </div>
              </div>
            </section>
          </>
        )}
      </main>

      <footer className="site-footer">
        <p>AEQUIRA — Anonymous Eligibility, Qualified Impartial Rubric Attestation</p>
        <p>Preprod prototype</p>
      </footer>
    </div>
  );
};

export default App;
