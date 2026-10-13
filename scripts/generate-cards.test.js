const {test}=require('node:test');
const assert=require('node:assert/strict');
const {fetchData,paginate,render,mock}=require('./generate-cards');
test('PR counts use direct connections and include all pages',async()=>{
 let pages=0;
 const api=async(q,v)=>{
  assert.ok(!q.includes('search('),'PR search must not be used');
  if(q.includes('contributionsCollection'))return {user:{login:'sidumandr',authored:{totalCount:3},prOpen:{totalCount:1},prMerged:{totalCount:1},prClosed:{totalCount:1},followers:{totalCount:0},following:{totalCount:0},contributionsCollection:{totalPullRequestContributions:2},repositoriesContributedTo:{totalCount:0}}};
  if(q.includes('ownerAffiliations'))return {user:{repositories:{nodes:[],pageInfo:{hasNextPage:false}}}};
  if(q.includes('pullRequests(first:100')){pages++;return {user:{pullRequests:{nodes:v.cursor?[{repository:{owner:{login:'other'}}}]:[{repository:{owner:{login:'sidumandr'}}},{repository:{owner:{login:'sidumandr'}}}],pageInfo:{hasNextPage:!v.cursor,endCursor:'next'}}}};}
  if(q.includes('issues(first:1)'))return {user:{issues:{totalCount:0}}};
  throw new Error('Unexpected query');
 };
 const d=await fetchData(api,new Date('2026-10-09T00:00:00Z'));
 assert.equal(d.prs.authored,3);assert.equal(d.prs.external,1);assert.equal(d.prs.open+d.prs.merged+d.prs.closed,3);assert.equal(pages,2);assert.equal(d.stats.totalPullRequestContributions,2);assert.deepEqual(d.langs.map(l=>l.name),['TypeScript','C#','Python','CSS','JavaScript','Other']);assert.ok(Math.abs(d.langs.reduce((sum,l)=>sum+l.pct,0)-100)<1e-9);
});
test('invalid cursor fails instead of truncating data',async()=>{await assert.rejects(()=>paginate(async()=>({nodes:[],pageInfo:{hasNextPage:true,endCursor:null}})),/cursor/);});
test('profile PR contributions come from live API data',()=>{const d=mock();d.stats.totalPullRequestContributions=1234;const svg=render(d)['github-stats.svg'];assert.ok(svg.includes('>1,234</text>'));assert.ok(svg.includes('Yearly PRs'));assert.ok(!svg.includes('manually set to 24'));});

test('manual language distribution is disclosed',async()=>{ const d=mock(); const svg=render(d)['profile-languages.svg'];assert.ok(svg.includes('Manually selected display distribution'));});

