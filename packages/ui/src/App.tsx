import { AdminPanel } from './components/AdminPanel.js';
import { ContractPanel } from './components/ContractPanel.js';
import { LedgerPanel } from './components/LedgerPanel.js';
import { PrivacyProofPanel } from './components/PrivacyProofPanel.js';
import { ReviewPanel } from './components/ReviewPanel.js';
import { WalletPanel } from './components/WalletPanel.js';
import { useAequiraRound } from './hooks/useAequiraRound.js';
import { useWalletConnection } from './hooks/useWalletConnection.js';
import { AEQUIRA_NETWORK_ID } from './wallet.js';

const App = () => {
  const wallet = useWalletConnection();
  const round = useAequiraRound(wallet.connectedWallet?.api ?? null);

  const isConnected = wallet.isConnected;
  const isOpen = round.address !== null;
  const hasCommitted = round.lastOpening !== null;

  return (
    <div className="app-shell">
      <header className="site-header">
        <a className="brand-lockup" href="/" aria-label="AEQUIRA home">
          <span className="brand-mark" aria-hidden="true">
            A
          </span>
          <span>AEQUIRA</span>
        </a>
        <div className="network-chip" aria-label="Network: Midnight Preprod">
          <span className="network-dot" aria-hidden="true" />
          Midnight {AEQUIRA_NETWORK_ID}
        </div>
      </header>

      <main>
        <section className="hero" aria-labelledby="hero-title">
          <div className="hero-copy">
            <p className="eyebrow">Private review · Public proof</p>
            <h1 id="hero-title">A score can be verified before it is seen.</h1>
            <p className="hero-intro">
              Reviewers commit decisions without publishing the score. AEQUIRA keeps the evidence
              verifiable and the sensitive input local until reveal.
            </p>

            <ol className="flow-rail" aria-label="Demo progress">
              <li className={isConnected ? 'flow-step is-complete' : 'flow-step is-current'}>
                <span className="step-index">01</span>
                <span>
                  <strong>Connect Lace</strong>
                  <small>
                    {isConnected ? 'Preprod session ready' : 'Authorize this browser session'}
                  </small>
                </span>
              </li>
              <li
                className={
                  isOpen
                    ? 'flow-step is-complete'
                    : isConnected
                      ? 'flow-step is-current'
                      : 'flow-step'
                }
              >
                <span className="step-index">02</span>
                <span>
                  <strong>Resolve contract</strong>
                  <small>
                    {isOpen
                      ? 'Preprod address confirmed'
                      : isConnected
                        ? 'Deploy or join a round'
                        : 'Connect Lace first'}
                  </small>
                </span>
              </li>
              <li
                className={
                  hasCommitted
                    ? 'flow-step is-complete'
                    : isOpen
                      ? 'flow-step is-current'
                      : 'flow-step'
                }
              >
                <span className="step-index">03</span>
                <span>
                  <strong>Commit private score</strong>
                  <small>
                    {hasCommitted
                      ? 'Commitment public, score local'
                      : 'Only the salted commitment becomes public'}
                  </small>
                </span>
              </li>
            </ol>
          </div>

          <WalletPanel busy={round.busy !== null} wallet={wallet}>
            <ContractPanel round={round} />
          </WalletPanel>
        </section>

        {isOpen && (
          <section className="round-grid" aria-label="Round actions">
            <AdminPanel round={round} />
            <ReviewPanel round={round} />
            <LedgerPanel round={round} />
          </section>
        )}

        {isOpen ? (
          <PrivacyProofPanel round={round} />
        ) : (
          <section className="privacy-boundary" aria-labelledby="boundary-heading">
            <div className="boundary-intro">
              <p className="eyebrow">Privacy boundary</p>
              <h2 id="boundary-heading">The proof travels. The score does not.</h2>
            </div>
            <div className="boundary-list">
              <div>
                <span className="boundary-label">Public</span>
                <p>Contract address, transaction result, score commitment, replay nullifier.</p>
              </div>
              <div>
                <span className="boundary-label">Local</span>
                <p>Reviewer secret, score value, score salt, and unrevealed private state.</p>
              </div>
            </div>
          </section>
        )}
      </main>

      <footer className="site-footer">
        <p>AEQUIRA · Anonymous Eligibility, Qualified Impartial Rubric Attestation</p>
        <p>Preprod prototype</p>
      </footer>
    </div>
  );
};

export default App;
