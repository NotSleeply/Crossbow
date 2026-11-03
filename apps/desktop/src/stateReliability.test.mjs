import {test} from 'node:test';
import assert from 'node:assert/strict';
import {cumulativeTotals} from './stateReliability.ts';
test('overview reads cumulative core counters rather than integrating rate samples', () => {
 assert.deepEqual(cumulativeTotals({upload_total:123456,download_total:789012}),{up:123456,down:789012});
 // A remounted overview receives the same backend totals; a restarted core may return zero.
 assert.deepEqual(cumulativeTotals({upload_total:123456,download_total:789012}),{up:123456,down:789012});
 assert.deepEqual(cumulativeTotals({upload_total:0,download_total:0}),{up:0,down:0});
 assert.deepEqual(cumulativeTotals({upload_total:NaN}),{up:null,down:null});
});

import {createReadGate} from './stateReliability.ts';
test('late reads cannot replace a newer event, and unrelated fields remain readable', () => {
 const gate=createReadGate(); const core=gate.begin('core'); const proxy=gate.begin('proxy');
 gate.invalidate('core');
 assert.equal(gate.current('core',core),false);
 assert.equal(gate.current('proxy',proxy),true);
 const next=gate.begin('proxy'); assert.equal(gate.current('proxy',proxy),false);
 assert.equal(gate.current('proxy',next),true);
});
