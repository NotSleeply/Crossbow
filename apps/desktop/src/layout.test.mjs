import {test} from 'node:test';
import assert from 'node:assert/strict';
import {nodeResultHeight,friendlyKind,readDensity} from './layout.ts';
import {fitGrid} from './components/fitGrid.ts';
test('sparse results use natural rows while long results reserve a pager',()=>{
 for(const density of ['cards','list'])for(const width of [380,600,1000])for(const count of [1,2,8,25,400]){
  const height=nodeResultHeight(count,width,density),row=density==='cards'?76:44;
  const grid=fitGrid(width,height,count,density==='cards'?200:0,density==='cards'?4:1,row,density==='cards'?4:8);
  assert.ok(grid.rows*row+(grid.rows-1)*8+(grid.pages>1?40:0)<=height);
  assert.equal(grid.pages>1,count>grid.count);
 }
 assert.equal(nodeResultHeight(2,900,'cards'),76);
});
test('friendly labels preserve unknown protocols and storage failures are safe',()=>{
 assert.equal(friendlyKind('URLTest',k=>k),'layout.auto');assert.equal(friendlyKind('Vless',k=>k),'VLESS');assert.equal(friendlyKind('FutureProto',k=>k),'FutureProto');assert.equal(readDensity(),'cards');
});
