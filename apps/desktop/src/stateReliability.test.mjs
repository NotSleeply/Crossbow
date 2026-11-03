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
