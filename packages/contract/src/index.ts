import { CompiledContract } from '@midnight-ntwrk/midnight-js-protocol/compact-js';

export * from './managed/aequira/contract/index.js';
export * from './witnesses.js';

import * as Aequira from './managed/aequira/contract/index.js';
import * as Witnesses from './witnesses.js';

export const compiledAequiraContract = CompiledContract.make<
  Aequira.Contract<Witnesses.AequiraPrivateState>
>('Aequira', Aequira.Contract<Witnesses.AequiraPrivateState>).pipe(
  CompiledContract.withWitnesses(Witnesses.witnesses),
  CompiledContract.withCompiledFileAssets('./managed/aequira'),
);
