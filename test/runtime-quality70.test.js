'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
const path=require('node:path');
const source=fs.readFileSync(path.join(__dirname,'../public/app.js'),'utf8');
const html=fs.readFileSync(path.join(__dirname,'../public/index.html'),'utf8');
function guardContext(withModule=false){
  const begin=source.indexOf('const MISSING_QUALITY70');
  const end=source.indexOf('let cfg =',begin);
  assert.ok(begin>0 && end>begin,'quality-70 fallback must be in app.js');
  const window=withModule?{RadarQuality70:require('../public/quality70.js')} : {};
  const context={window};
  vm.createContext(context);
  vm.runInContext(source.slice(begin,end)+'\nthis.gateTest=(entry,score)=>quality70().gate(entry,score);this.chooseTest=(rows)=>quality70().choose(rows,6);this.readyTest=quality70Ready;',context);
  return context;
}
test('missing Quality70 browser module fails closed: never silently allows BUY',()=>{
  const x=guardContext();
  assert.equal(x.readyTest(),false);
  assert.equal(x.gateTest({status:'BUY'},100).status,'WATCH');
  assert.match(x.gateTest({status:'BUY'},100).reason,/disekat/);
  assert.equal(x.gateTest({status:'AVOID'},100).status,'AVOID');
  const pick=x.chooseTest([{status:'BUY',score:100}]);
  assert.equal(pick.buyCount,0);
  assert.equal(pick.watchCount,0);
});
test('loaded Quality70 module retains original score gate',()=>{
  const x=guardContext(true);
  assert.equal(x.readyTest(),true);
  assert.equal(x.gateTest({status:'BUY'},70).status,'BUY');
  assert.equal(x.gateTest({status:'BUY'},69).status,'WATCH');
});
test('versioned quality script loads ahead of app script and warning exists on both tabs',()=>{
  const first=html.search(/src="\/quality70\.js\?v=[0-9.]+"/);
  const last=html.search(/src="\/app\.js\?v=[0-9.]+"/);
  assert.ok(first>0 && last>first);
  assert.ok(html.includes('id="runtimeWarning"'));
  assert.ok(html.includes('id="top70View"'));
  assert.ok(html.includes('id="journalSection"'));
});
test('network fetch errors and browser render errors are handled separately',()=>{
  const fetch=source.slice(source.indexOf('async function fetchData('),source.indexOf('function node(',source.indexOf('async function fetchData(')));
  assert.ok(fetch.includes("Dashboard rendering error:"));
  assert.ok(fetch.includes('state.latest=data;'));
  assert.ok(fetch.includes('Ralat paparan dashboard:'));
  assert.ok(fetch.includes('Tidak dapat menghubungi server scanner:'));
});
