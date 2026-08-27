import assert from 'node:assert/strict';
import { webcrypto } from 'node:crypto';
import { describe, test } from 'node:test';

import {
  CostModel,
  QueryContext,
  createConstructorContext,
  sampleContractAddress,
} from '@midnight-ntwrk/compact-runtime';
import { setNetworkId } from '@midnight-ntwrk/midnight-js-network-id';

import { Contract, Phase, ledger, pureCircuits } from '../dist/managed/aequira/contract/index.js';
import { compiledAequiraContract } from '../dist/index.js';
import { witnesses } from '../dist/witnesses.js';

setNetworkId('undeployed');

const bytes = (value) => new Uint8Array(32).fill(value);

class AequiraSimulator {
  // `witnessOverrides` stands in for a tampered client: the circuit must hold
  // even when the witness returns something the honest implementation never
  // would.
  constructor({ roundId, adminSecret, reviewerSecret, score, scoreSalt, witnessOverrides = {} }) {
    this.contract = new Contract({ ...witnesses, ...witnessOverrides });
    const privateState = {
      adminSecret,
      reviewerSecret,
      score,
      scoreSalt,
    };
    const { currentPrivateState, currentContractState, currentZswapLocalState } =
      this.contract.initialState(
        createConstructorContext(privateState, '0'.repeat(64)),
        roundId,
        adminSecret,
      );

    this.context = {
      currentPrivateState,
      currentZswapLocalState,
      costModel: CostModel.initialCostModel(),
      currentQueryContext: new QueryContext(currentContractState.data, sampleContractAddress()),
    };
  }

  getLedger() {
    return ledger(this.context.currentQueryContext.state);
  }

  getPrivateState() {
    return this.context.currentPrivateState;
  }

  setPrivateState(changes) {
    this.context.currentPrivateState = {
      ...this.context.currentPrivateState,
      ...changes,
    };
  }

  call(circuit, ...args) {
    const result = this.contract.impureCircuits[circuit](this.context, ...args);
    this.context = result.context;
    return result;
  }
}

const setupReview = ({ score = 87n, witnessOverrides, alsoRegister = [] } = {}) => {
  const roundId = bytes(11);
  const adminSecret = bytes(22);
  const reviewerSecret = bytes(33);
  const scoreSalt = bytes(44);
  const applicationId = bytes(55);
  const simulator = new AequiraSimulator({
    roundId,
    adminSecret,
    reviewerSecret,
    score,
    scoreSalt,
    ...(witnessOverrides === undefined ? {} : { witnessOverrides }),
  });

  simulator.call('registerReviewer', pureCircuits.reviewerId(reviewerSecret));

  for (const otherSecret of alsoRegister) {
    simulator.call('registerReviewer', pureCircuits.reviewerId(otherSecret));
  }

  simulator.call('openApplications');
  simulator.call('openReview');

  return {
    simulator,
    roundId,
    adminSecret,
    reviewerSecret,
    score,
    scoreSalt,
    applicationId,
  };
};

describe('AEQUIRA L1 contract', () => {
  test('exports a deployable compiled contract with packaged ZK assets', () => {
    assert.ok(compiledAequiraContract);
  });

  test('enforces administrator-only, one-way phase transitions', () => {
    const adminSecret = bytes(1);
    const simulator = new AequiraSimulator({
      roundId: bytes(2),
      adminSecret,
      reviewerSecret: bytes(3),
      score: 50n,
      scoreSalt: bytes(4),
    });

    assert.equal(simulator.getLedger().phase, Phase.SETUP);
    simulator.setPrivateState({ adminSecret: bytes(99) });
    assert.throws(() => simulator.call('openApplications'), /Only the round administrator/);

    simulator.setPrivateState({ adminSecret });
    simulator.call('openApplications');
    assert.equal(simulator.getLedger().phase, Phase.APPLY);
    assert.throws(
      () => simulator.call('openApplications'),
      /Applications can only open after setup/,
    );
    simulator.call('openReview');
    simulator.call('openReveal');
    assert.equal(simulator.getLedger().phase, Phase.REVEAL);
  });

  test('commits a valid score without publishing it', () => {
    const context = setupReview({ score: 87n });
    const { simulator, roundId, reviewerSecret, score, scoreSalt, applicationId } = context;
    const nullifier = pureCircuits.scoreNullifier(roundId, applicationId, reviewerSecret);
    const commitment = pureCircuits.scoreCommitment(
      roundId,
      applicationId,
      score,
      reviewerSecret,
      scoreSalt,
    );

    simulator.call('commitScore', applicationId);
    const publicState = simulator.getLedger();

    assert.equal(publicState.scoreNullifiers.member(nullifier), true);
    assert.equal(publicState.scoreCommitments.member(commitment), true);
    assert.equal(publicState.scoreSums.member(applicationId), false);
    assert.equal(publicState.revealedCounts.member(applicationId), false);
    assert.equal(simulator.getPrivateState().score, 87n);
    assert.deepEqual(Object.keys(publicState).sort(), [
      'adminAuthority',
      'phase',
      'revealedCounts',
      'reviewerTree',
      'reviewers',
      'roundId',
      'scoreCommitments',
      'scoreNullifiers',
      'scoreSums',
    ]);
  });

  test('rejects score commits outside REVIEW', () => {
    const simulator = new AequiraSimulator({
      roundId: bytes(1),
      adminSecret: bytes(2),
      reviewerSecret: bytes(3),
      score: 50n,
      scoreSalt: bytes(4),
    });

    assert.throws(
      () => simulator.call('commitScore', bytes(5)),
      /Scores can only be committed during review/,
    );
  });

  test('rejects an unregistered reviewer, who cannot even build a membership path', () => {
    const context = setupReview();
    context.simulator.setPrivateState({ reviewerSecret: bytes(99) });

    // An honest client stops here: the round's tree holds no leaf for this
    // secret, so there is no path to prove membership with.
    assert.throws(
      () => context.simulator.call('commitScore', context.applicationId),
      /not registered in the round/,
    );
  });

  test('refuses a forged membership path that does not reconstruct the tree root', () => {
    // A tampered client can skip the honest witness and hand the circuit any
    // path it likes. This one carries the caller's own leaf, so it clears the
    // binding assertion, but its siblings are wrong — `checkRoot` is what
    // actually stops it.
    const registeredSecret = bytes(33);
    const unregisteredSecret = bytes(99);
    const context = setupReview({
      witnessOverrides: {
        reviewerMerklePath: ({ ledger, privateState }) => [
          privateState,
          {
            leaf: pureCircuits.reviewerId(unregisteredSecret),
            path: ledger.reviewerTree.findPathForLeaf(pureCircuits.reviewerId(registeredSecret))
              .path,
          },
        ],
      },
    });
    context.simulator.setPrivateState({ reviewerSecret: unregisteredSecret });

    assert.throws(
      () => context.simulator.call('commitScore', context.applicationId),
      /Reviewer is not registered/,
    );
  });

  test('refuses a membership proof borrowed from another registered reviewer', () => {
    // The attack the leaf binding exists to stop. Without it, anyone could
    // present a real reviewer's leaf and path while deriving the nullifier from
    // their own secret, and score the same application once per secret they
    // invent.
    const registeredSecret = bytes(33);
    const attackerSecret = bytes(77);
    const context = setupReview({
      alsoRegister: [attackerSecret],
      witnessOverrides: {
        reviewerMerklePath: ({ ledger, privateState }) => [
          privateState,
          ledger.reviewerTree.findPathForLeaf(pureCircuits.reviewerId(registeredSecret)),
        ],
      },
    });
    context.simulator.setPrivateState({ reviewerSecret: attackerSecret });

    assert.throws(
      () => context.simulator.call('commitScore', context.applicationId),
      /Membership proof is not for this reviewer/,
    );
  });

  test('does not publish which reviewer scored the application', () => {
    // The property this level is claiming. The roster is public, but the commit
    // must not say which member of it acted.
    const context = setupReview({ score: 73n });
    const reviewerIdHex = Buffer.from(pureCircuits.reviewerId(context.reviewerSecret)).toString(
      'hex',
    );

    context.simulator.call('commitScore', context.applicationId);
    const publicState = context.simulator.getLedger();

    const published = [
      ...[...publicState.scoreCommitments],
      ...[...publicState.scoreNullifiers],
    ].map((value) => Buffer.from(value).toString('hex'));

    assert.equal(published.length, 2);
    assert.equal(published.includes(reviewerIdHex), false);
  });

  test('rejects scores above the rubric maximum', () => {
    const context = setupReview({ score: 101n });

    assert.throws(
      () => context.simulator.call('commitScore', context.applicationId),
      /Score exceeds the rubric maximum/,
    );
  });

  test('rejects duplicate scoring of the same application', () => {
    const context = setupReview();
    context.simulator.call('commitScore', context.applicationId);

    assert.throws(
      () => context.simulator.call('commitScore', context.applicationId),
      /Reviewer already scored this application/,
    );
  });

  test('rejects an opening with the wrong salt, then accepts the right one', () => {
    const context = setupReview({ score: 73n });
    context.simulator.call('commitScore', context.applicationId);
    context.simulator.call('openReveal');
    context.simulator.setPrivateState({ scoreSalt: bytes(98) });

    assert.throws(
      () => context.simulator.call('revealScore', context.applicationId),
      /Matching score commitment was not found/,
    );

    context.simulator.setPrivateState({ scoreSalt: context.scoreSalt });
    context.simulator.call('revealScore', context.applicationId);
    const publicState = context.simulator.getLedger();
    assert.equal(publicState.scoreSums.lookup(context.applicationId).read(), 73n);
    assert.equal(publicState.revealedCounts.lookup(context.applicationId).read(), 1n);
  });

  test('removes an opened commitment to reject duplicate reveals', () => {
    const context = setupReview();
    const commitment = pureCircuits.scoreCommitment(
      context.roundId,
      context.applicationId,
      context.score,
      context.reviewerSecret,
      context.scoreSalt,
    );
    context.simulator.call('commitScore', context.applicationId);
    context.simulator.call('openReveal');
    context.simulator.call('revealScore', context.applicationId);

    assert.equal(context.simulator.getLedger().scoreCommitments.member(commitment), false);
    assert.throws(
      () => context.simulator.call('revealScore', context.applicationId),
      /Matching score commitment was not found/,
    );
  });

  test('aggregates reveals from multiple registered reviewers', () => {
    const context = setupReview({ score: 60n });
    const secondReviewerSecret = bytes(66);
    const secondScoreSalt = bytes(77);

    context.simulator.setPrivateState({
      reviewerSecret: secondReviewerSecret,
      scoreSalt: secondScoreSalt,
      score: 80n,
    });
    const secondReviewerId = pureCircuits.reviewerId(secondReviewerSecret);

    // Registration is setup-only, so create a fresh round containing both reviewers.
    const simulator = new AequiraSimulator({
      roundId: context.roundId,
      adminSecret: context.adminSecret,
      reviewerSecret: context.reviewerSecret,
      score: 60n,
      scoreSalt: context.scoreSalt,
    });
    simulator.call('registerReviewer', pureCircuits.reviewerId(context.reviewerSecret));
    simulator.call('registerReviewer', secondReviewerId);
    simulator.call('openApplications');
    simulator.call('openReview');
    simulator.call('commitScore', context.applicationId);

    simulator.setPrivateState({
      reviewerSecret: secondReviewerSecret,
      scoreSalt: secondScoreSalt,
      score: 80n,
    });
    simulator.call('commitScore', context.applicationId);
    simulator.call('openReveal');
    simulator.call('revealScore', context.applicationId);

    simulator.setPrivateState({
      reviewerSecret: context.reviewerSecret,
      scoreSalt: context.scoreSalt,
      score: 60n,
    });
    simulator.call('revealScore', context.applicationId);

    assert.equal(simulator.getLedger().scoreSums.lookup(context.applicationId).read(), 140n);
    assert.equal(simulator.getLedger().revealedCounts.lookup(context.applicationId).read(), 2n);
  });

  test('reveals both applications for one reviewer when the salt is derived per application', async () => {
    // Regression coverage for a real bug class: `AequiraPrivateState` holds
    // exactly one `scoreSalt`, so a fresh random salt per commit (as the CLI
    // used to generate) silently strands the reveal of any application
    // scored earlier by the same reviewer once a second one is committed.
    // The fix (packages/sdk/src/client.ts's `deriveScoreSalt`) makes the salt
    // a deterministic function of (roundId, applicationId, reviewerSecret),
    // so both applications stay independently revealable. This exercises the
    // real compiled circuits directly, which the CLI's mocked unit tests
    // cannot: there, `commitTx`/`revealTx` are stubs and never check that the
    // recomputed commitment actually matches what's on the ledger.
    const deriveScoreSalt = async (roundId, applicationId, reviewerSecret) => {
      const domain = new TextEncoder().encode('aequira:ui-salt:v1');
      const input = new Uint8Array(domain.length + 32 * 3);
      input.set(domain, 0);
      input.set(roundId, domain.length);
      input.set(applicationId, domain.length + 32);
      input.set(reviewerSecret, domain.length + 64);
      return new Uint8Array(await webcrypto.subtle.digest('SHA-256', input));
    };

    const roundId = bytes(11);
    const adminSecret = bytes(22);
    const reviewerSecret = bytes(33);
    const applicationA = bytes(55);
    const applicationB = bytes(56);
    const scoreA = 87n;
    const scoreB = 42n;
    const saltA = await deriveScoreSalt(roundId, applicationA, reviewerSecret);
    const saltB = await deriveScoreSalt(roundId, applicationB, reviewerSecret);

    assert.notDeepEqual(saltA, saltB);

    const simulator = new AequiraSimulator({
      roundId,
      adminSecret,
      reviewerSecret,
      score: scoreA,
      scoreSalt: saltA,
    });
    simulator.call('registerReviewer', pureCircuits.reviewerId(reviewerSecret));
    simulator.call('openApplications');
    simulator.call('openReview');

    simulator.call('commitScore', applicationA);
    // Committing a second application overwrites the single scoreSalt/score
    // slot, exactly as it would between two `commit-score` CLI invocations.
    simulator.setPrivateState({ score: scoreB, scoreSalt: saltB });
    simulator.call('commitScore', applicationB);

    simulator.call('openReveal');

    // Revealing A must recompute A's own opening rather than reuse whatever
    // committing B left behind.
    simulator.setPrivateState({ score: scoreA, scoreSalt: saltA });
    simulator.call('revealScore', applicationA);
    simulator.setPrivateState({ score: scoreB, scoreSalt: saltB });
    simulator.call('revealScore', applicationB);

    const ledger = simulator.getLedger();
    assert.equal(ledger.scoreSums.lookup(applicationA).read(), scoreA);
    assert.equal(ledger.scoreSums.lookup(applicationB).read(), scoreB);
    assert.equal(ledger.revealedCounts.lookup(applicationA).read(), 1n);
    assert.equal(ledger.revealedCounts.lookup(applicationB).read(), 1n);
  });
});
