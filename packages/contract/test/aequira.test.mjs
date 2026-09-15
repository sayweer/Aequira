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
const hex = (value) => Buffer.from(value).toString('hex');

class AequiraSimulator {
  // `witnessOverrides` stands in for a tampered client: the circuit must hold
  // even when the witness returns something the honest implementation never
  // would.
  constructor({
    roundId,
    adminSecret,
    reviewerSecret,
    score,
    scoreSalt,
    applicantSecret = bytes(66),
    applicantIncomeBand = 0n,
    applicantGpaScaled = 0n,
    applicantRegionCode = 0n,
    applicantSalt = bytes(88),
    maxIncomeBand = 3n,
    minGpaScaled = 300n,
    witnessOverrides = {},
  }) {
    this.contract = new Contract({ ...witnesses, ...witnessOverrides });
    const privateState = {
      adminSecret,
      reviewerSecret,
      score,
      scoreSalt,
      applicantSecret,
      applicantIncomeBand,
      applicantGpaScaled,
      applicantRegionCode,
      applicantSalt,
    };
    const { currentPrivateState, currentContractState, currentZswapLocalState } =
      this.contract.initialState(
        createConstructorContext(privateState, '0'.repeat(64)),
        roundId,
        adminSecret,
        maxIncomeBand,
        minGpaScaled,
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

// The applicant half of a round. The institution verifies the attributes and
// enrolls the commitment they open to; the applicant keeps the secret, so the
// leaf on chain is the only thing the institution ever holds about them.
const APPLICANT_INCOME_BAND = 2n;
const APPLICANT_GPA_SCALED = 350n;
const APPLICANT_REGION_CODE = 7n;

const APPLICANT = {
  incomeBand: APPLICANT_INCOME_BAND,
  gpaScaled: APPLICANT_GPA_SCALED,
  regionCode: APPLICANT_REGION_CODE,
  secret: bytes(66),
  salt: bytes(88),
  nonce: bytes(99),
};

// The institution's side of enrollment: verified attributes, its own salt, and
// the applicant's public ID — never the secret behind that ID.
const enroll = (simulator, { incomeBand, gpaScaled, regionCode, secret, salt }) => {
  simulator.call(
    'registerApplicant',
    pureCircuits.enrollmentLeaf(
      incomeBand,
      gpaScaled,
      regionCode,
      pureCircuits.applicantId(secret),
      salt,
    ),
  );
};

// Switches the shared private state to one applicant and submits their
// application, returning the public pseudonym reviewers score.
const submitApplication = (simulator, roundId, applicant) => {
  simulator.setPrivateState({
    applicantSecret: applicant.secret,
    applicantIncomeBand: applicant.incomeBand,
    applicantGpaScaled: applicant.gpaScaled,
    applicantRegionCode: applicant.regionCode,
    applicantSalt: applicant.salt,
  });
  simulator.call('apply', applicant.nonce);
  return pureCircuits.applicationPseudonym(roundId, applicant.secret, applicant.nonce);
};

const setupReview = ({ score = 87n, witnessOverrides, alsoRegister = [] } = {}) => {
  const roundId = bytes(11);
  const adminSecret = bytes(22);
  const reviewerSecret = bytes(33);
  const scoreSalt = bytes(44);
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

  enroll(simulator, APPLICANT);
  simulator.call('openApplications');
  const applicationId = submitApplication(simulator, roundId, APPLICANT);
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
      'applicantTree',
      'applications',
      'applyNullifiers',
      'maxIncomeBand',
      'minGpaScaled',
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
    enroll(simulator, APPLICANT);
    simulator.call('openApplications');
    assert.deepEqual(
      submitApplication(simulator, context.roundId, APPLICANT),
      context.applicationId,
    );
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
    const otherApplicant = {
      incomeBand: 1n,
      gpaScaled: 400n,
      regionCode: 5n,
      secret: bytes(77),
      salt: bytes(78),
      nonce: bytes(79),
    };
    const applicationA = pureCircuits.applicationPseudonym(
      roundId,
      APPLICANT.secret,
      APPLICANT.nonce,
    );
    const applicationB = pureCircuits.applicationPseudonym(
      roundId,
      otherApplicant.secret,
      otherApplicant.nonce,
    );
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
    enroll(simulator, APPLICANT);
    enroll(simulator, otherApplicant);
    simulator.call('openApplications');
    submitApplication(simulator, roundId, APPLICANT);
    submitApplication(simulator, roundId, otherApplicant);
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

  test('refuses to open a score for an application that was never submitted', () => {
    // commitScore cannot check the application without naming it, so a
    // commitment to an invented ID is accepted — but it must never reach the
    // published tally.
    const context = setupReview({ score: 64n });
    const inventedApplicationId = bytes(55);
    context.simulator.call('commitScore', inventedApplicationId);
    context.simulator.call('openReveal');

    assert.throws(
      () => context.simulator.call('revealScore', inventedApplicationId),
      /Application is not in this round/,
    );

    const publicState = context.simulator.getLedger();
    assert.equal(publicState.scoreSums.member(inventedApplicationId), false);
    assert.equal(publicState.revealedCounts.member(inventedApplicationId), false);
    assert.equal(
      publicState.scoreCommitments.member(
        pureCircuits.scoreCommitment(
          context.roundId,
          inventedApplicationId,
          context.score,
          context.reviewerSecret,
          context.scoreSalt,
        ),
      ),
      true,
    );
  });

  test('builds the same enrollment leaf from the applicant ID as from the secret', () => {
    // The institution only ever holds the public applicant ID; the applicant
    // rebuilds the leaf from their secret inside apply. Both must agree exactly.
    assert.deepEqual(
      pureCircuits.enrollmentLeaf(
        APPLICANT.incomeBand,
        APPLICANT.gpaScaled,
        APPLICANT.regionCode,
        pureCircuits.applicantId(APPLICANT.secret),
        APPLICANT.salt,
      ),
      pureCircuits.applicantLeaf(
        APPLICANT.incomeBand,
        APPLICANT.gpaScaled,
        APPLICANT.regionCode,
        APPLICANT.secret,
        APPLICANT.salt,
      ),
    );
  });

  test('refuses an applicant who claims attributes other than the ones enrolled', () => {
    // The institution enrolled income band 9. A client that swaps in an eligible
    // figure cannot reopen the institution's commitment, so no path matches.
    const context = setupApply({ enrolled: false, alsoEnroll: [{ ...APPLICANT, incomeBand: 9n }] });

    assert.throws(
      () => context.simulator.call('apply', context.nonce),
      /This applicant is not enrolled in the round/,
    );
  });

  const setupApply = ({
    incomeBand = APPLICANT_INCOME_BAND,
    gpaScaled = APPLICANT_GPA_SCALED,
    regionCode = APPLICANT_REGION_CODE,
    enrolled = true,
    alsoEnroll = [],
    witnessOverrides,
  } = {}) => {
    const roundId = bytes(11);
    const applicantSecret = bytes(66);
    const applicantSalt = bytes(88);
    const nonce = bytes(99);
    const simulator = new AequiraSimulator({
      roundId,
      adminSecret: bytes(22),
      reviewerSecret: bytes(33),
      score: 0n,
      scoreSalt: bytes(44),
      applicantSecret,
      applicantIncomeBand: incomeBand,
      applicantGpaScaled: gpaScaled,
      applicantRegionCode: regionCode,
      applicantSalt,
      ...(witnessOverrides === undefined ? {} : { witnessOverrides }),
    });

    if (enrolled) {
      enroll(simulator, {
        incomeBand,
        gpaScaled,
        regionCode,
        secret: applicantSecret,
        salt: applicantSalt,
      });
    }

    for (const other of alsoEnroll) {
      enroll(simulator, other);
    }

    simulator.call('openApplications');

    return { simulator, roundId, applicantSecret, applicantSalt, nonce };
  };

  test('accepts an eligible applicant and publishes only the two derived values', () => {
    const { simulator, roundId, applicantSecret, nonce } = setupApply();

    simulator.call('apply', nonce);
    const publicState = simulator.getLedger();

    assert.equal(
      publicState.applyNullifiers.member(pureCircuits.applyNullifier(roundId, applicantSecret)),
      true,
    );
    assert.equal(
      publicState.applications.member(
        pureCircuits.applicationPseudonym(roundId, applicantSecret, nonce),
      ),
      true,
    );
    // The rules the round announced, still exactly as deployed.
    assert.equal(publicState.maxIncomeBand, 3n);
    assert.equal(publicState.minGpaScaled, 300n);
  });

  test('rejects applications outside the application phase', () => {
    const context = setupApply();
    context.simulator.call('openReview');

    assert.throws(
      () => context.simulator.call('apply', context.nonce),
      /Applications can only be submitted while applications are open/,
    );
  });

  test('refuses an applicant the institution never enrolled', () => {
    const context = setupApply({ enrolled: false });

    assert.throws(
      () => context.simulator.call('apply', context.nonce),
      /This applicant is not enrolled in the round/,
    );
  });

  test('refuses an enrolled applicant whose income band is above the threshold', () => {
    // Enrolled with the real figure, so the path resolves and the enrollment
    // opening succeeds: it is the threshold alone that stops the application.
    const context = setupApply({ incomeBand: 9n });

    assert.throws(
      () => context.simulator.call('apply', context.nonce),
      /Income band is above the eligibility threshold/,
    );
  });

  test('refuses an enrolled applicant whose grade average is below the threshold', () => {
    const context = setupApply({ gpaScaled: 250n });

    assert.throws(
      () => context.simulator.call('apply', context.nonce),
      /Grade average is below the eligibility threshold/,
    );
  });

  test('refuses an enrollment proof borrowed from another applicant', () => {
    // Without the leaf binding, someone who was never enrolled could hand the
    // circuit a real applicant's path while nullifying under a secret of their
    // own, and apply once per secret they invent.
    const other = {
      incomeBand: 1n,
      gpaScaled: 400n,
      regionCode: 5n,
      secret: bytes(77),
      salt: bytes(78),
    };
    const context = setupApply({
      enrolled: false,
      alsoEnroll: [other],
      witnessOverrides: {
        applicantMerklePath: ({ ledger, privateState }) => [
          privateState,
          ledger.applicantTree.findPathForLeaf(
            pureCircuits.applicantLeaf(
              other.incomeBand,
              other.gpaScaled,
              other.regionCode,
              other.secret,
              other.salt,
            ),
          ),
        ],
      },
    });

    assert.throws(
      () => context.simulator.call('apply', context.nonce),
      /Enrollment proof is not for this applicant/,
    );
  });

  test('publishes nothing that links an application to the enrolled commitment', () => {
    // The enrollment leaf is public: the institution put it there. So the
    // property under test is not that the leaf is hidden, but that neither
    // value the application publishes can be matched back to it. Everything
    // written is enumerated, so a future extra write cannot slip past.
    const context = setupApply();
    const leafHex = hex(
      pureCircuits.applicantLeaf(
        APPLICANT_INCOME_BAND,
        APPLICANT_GPA_SCALED,
        APPLICANT_REGION_CODE,
        context.applicantSecret,
        context.applicantSalt,
      ),
    );
    const applicantIdHex = hex(pureCircuits.applicantId(context.applicantSecret));

    context.simulator.call('apply', context.nonce);
    const publicState = context.simulator.getLedger();
    const published = [...[...publicState.applyNullifiers], ...[...publicState.applications]].map(
      hex,
    );

    assert.deepEqual(
      [...published].sort(),
      [
        hex(pureCircuits.applyNullifier(context.roundId, context.applicantSecret)),
        hex(
          pureCircuits.applicationPseudonym(
            context.roundId,
            context.applicantSecret,
            context.nonce,
          ),
        ),
      ].sort(),
    );
    assert.equal(published.includes(leafHex), false);
    assert.equal(published.includes(applicantIdHex), false);
  });

  test('rejects a second application from the same applicant', () => {
    const context = setupApply();
    context.simulator.call('apply', context.nonce);

    // A fresh nonce changes the pseudonym but not the nullifier, which is what
    // one-application-per-person rests on.
    assert.throws(
      () => context.simulator.call('apply', bytes(100)),
      /This applicant already applied to the round/,
    );
  });

  test('enrolls applicants only during setup and only for the administrator', () => {
    const applicantSecret = bytes(66);
    const applicantSalt = bytes(88);
    const leaf = pureCircuits.applicantLeaf(
      APPLICANT_INCOME_BAND,
      APPLICANT_GPA_SCALED,
      APPLICANT_REGION_CODE,
      applicantSecret,
      applicantSalt,
    );
    const adminSecret = bytes(22);
    const simulator = new AequiraSimulator({
      roundId: bytes(11),
      adminSecret,
      reviewerSecret: bytes(33),
      score: 0n,
      scoreSalt: bytes(44),
    });

    simulator.setPrivateState({ adminSecret: bytes(98) });
    assert.throws(() => simulator.call('registerApplicant', leaf), /Only the round administrator/);

    simulator.setPrivateState({ adminSecret });
    simulator.call('registerApplicant', leaf);
    simulator.call('openApplications');
    assert.throws(
      () => simulator.call('registerApplicant', leaf),
      /Applicants can only be enrolled during setup/,
    );
  });
});
