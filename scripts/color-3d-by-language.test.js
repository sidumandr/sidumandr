const {test}=require('node:test');
const assert=require('node:assert/strict');
const {mixColors,darker,recolorSvg}=require('./color-3d-by-language');
test('colors mix by share into one solid color',()=>{
 assert.equal(mixColors({'#000000':3,'#ffffff':1}),'#404040');
 assert.equal(mixColors({'#3178c6':1}),'#3178c6');
 assert.equal(mixColors({}),null);
});
test('side panels use the chart shading',()=>{assert.equal(darker('#ffffff',0),'#ffffff');assert.equal(darker('#646464',1),'#464646');});
test('each day recolors its three panels and keeps empty days',()=>{
 const bar=l=>['top','left','right'].map(p=>`<rect x="0" class="cont-${p}-${l}"></rect>`).join('');
 const svg=bar(0)+bar(2);
 const days=[{date:'2026-01-01',contributionCount:0,contributionLevel:'NONE',commits:{},other:{}},{date:'2026-01-02',contributionCount:4,contributionLevel:'SECOND_QUARTILE',commits:{'#000000':1,'#ffffff':3},other:{}}];
 const out=recolorSvg(svg,days);
 assert.ok(out.startsWith(bar(0)));
 assert.ok(out.includes('class="cont-top-2" style="fill:#bfbfbf"'));
 assert.equal((out.match(/style=/g)||[]).length,3);
 assert.throws(()=>recolorSvg(bar(1),days),/bars/);
});
