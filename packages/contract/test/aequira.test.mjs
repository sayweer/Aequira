import assert from 'node:assert/strict';
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
  constructor({ roundId, adminSecret, reviewerSecret, score, scoreSalt }) {
    this.contract = new Contract(witnesses);
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

const setupReview = ({ score = 87n } = {}) => {
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
  });

  simulator.call('registerReviewer', pureCircuits.reviewerId(reviewerSecret));
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

  test('rejects an unregistered reviewer', () => {
    const context = setupReview();
    context.simulator.setPrivateState({ reviewerSecret: bytes(99) });

    assert.throws(
      () => context.simulator.call('commitScore', context.applicationId),
      /Reviewer is not registered/,
    );
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
});
