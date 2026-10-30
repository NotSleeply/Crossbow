import {test} from 'node:test';
import assert from 'node:assert/strict';
import {fitGrid} from './fitGrid.ts';
test('fits 3 or 4 columns and rows according to actual space',()=>{
 assert.deepEqual(fitGrid(830,400,101,200,4,76,4),{columns:4,rows:4,count:16,pages:7});
 assert.deepEqual(fitGrid(620,225,101,200,4,76,4),{columns:3,rows:2,count:6,pages:17});
 assert.equal(fitGrid(620,300,101,200,4,76,4).rows,3);
});
test('reserves pager height only when required; empty and small lists stay valid',()=>{
 assert.equal(fitGrid(620,244,9,200,4,76,4).pages,1);
 assert.equal(fitGrid(620,244,10,200,4,76,4).rows,2);
 assert.equal(fitGrid(0,0,0,200,4,76,4).pages,1);
 assert.equal(fitGrid(400,400,2,200,4,76,4).rows,2);
});
