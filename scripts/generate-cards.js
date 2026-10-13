const fs = require('node:fs');
const path = require('node:path');
const USERNAME = process.env.PROFILE_USERNAME || 'sidumandr';
const OUT = process.env.OUT_DIR || 'dist';
// User-selected display distribution; these percentages are not GitHub language statistics.
const PROFILE_LANGUAGES = [
  {name:'TypeScript',pct:55,color:'#3178c6'},
  {name:'C#',pct:22,color:'#7355dd'},
  {name:'Python',pct:12,color:'#3572A5'},
  {name:'CSS',pct:7,color:'#663399'},
  {name:'JavaScript',pct:4,color:'#f1e05a'},
];
const esc = s => String(s).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&apos;'}[c]));
const number = n => Number(n).toLocaleString('en-US');
const PAGE = 'pageInfo{hasNextPage endCursor}';
async function graphql(query, variables, request = fetch) {
  if (!process.env.GITHUB_TOKEN) throw new Error('GITHUB_TOKEN required. Configure the PROFILE_TOKEN repository secret.');
  const res = await request('https://api.github.com/graphql', {method:'POST', headers:{Authorization:`bearer ${process.env.GITHUB_TOKEN}`,'Content-Type':'application/json'},body:JSON.stringify({query,variables}),signal:AbortSignal.timeout(60000)});
  if (!res.ok) throw new Error(`GitHub HTTP ${res.status}; check token permissions and rate limits.`);
  const json = await res.json();
  if (json.errors?.length || !json.data) throw new Error(`GitHub: ${(json.errors || []).map(e=>e.message).join('; ') || 'Missing data'}`);
  return json.data;
}
async function paginate(get) {
  const nodes=[]; let cursor=null;
  for (;;) {
    const page=await get(cursor); nodes.push(...page.nodes);
    if (!page.pageInfo.hasNextPage) return nodes;
    if (!page.pageInfo.endCursor || page.pageInfo.endCursor===cursor) throw new Error('Invalid pagination cursor');
    cursor=page.pageInfo.endCursor;
  }
}
function languageTotals(repos) {
  const sizes=new Map();
  for (const repo of repos.filter(r=>!r.isFork)) for(const edge of repo.languages.edges) {
    const old=sizes.get(edge.node.name) || {name:edge.node.name,size:0,color:edge.node.color || '#94a3b8'};
    old.size+=edge.size; sizes.set(old.name,old);
  }
  const all=[...sizes.values()].sort((a,b)=>b.size-a.size || a.name.localeCompare(b.name));
  const total=all.reduce((s,l)=>s+l.size,0);
  const top=all.slice(0,5), rest=all.slice(5).reduce((s,l)=>s+l.size,0);
  if(rest) top.push({name:'Other',size:rest,color:'#94a3b8'});
  return top.map(l=>({...l,pct:total ? l.size/total*100:0}));
}
async function fetchData(api=graphql, now=new Date()) {
  if (!/^[a-z\d](?:[a-z\d-]{0,38})$/i.test(USERNAME)) throw new Error('Invalid PROFILE_USERNAME');
  const from=new Date(now); from.setUTCFullYear(from.getUTCFullYear()-1);
  const base=await api(`query($login:String!,$from:DateTime!,$to:DateTime!){user(login:$login){login authored:pullRequests(first:1){totalCount} prOpen:pullRequests(first:1,states:[OPEN]){totalCount} prMerged:pullRequests(first:1,states:[MERGED]){totalCount} prClosed:pullRequests(first:1,states:[CLOSED]){totalCount} followers{totalCount} following{totalCount} contributionsCollection(from:$from,to:$to){totalCommitContributions totalIssueContributions totalPullRequestContributions totalPullRequestReviewContributions restrictedContributionsCount startedAt endedAt} repositoriesContributedTo(first:1,includeUserRepositories:false,contributionTypes:[COMMIT,ISSUE,PULL_REQUEST,PULL_REQUEST_REVIEW]){totalCount}}}`,{login:USERNAME,from:from.toISOString(),to:now.toISOString()});
  if(!base.user) throw new Error('GitHub user not found');
  const repos=await paginate(async cursor => (await api(`query($login:String!,$cursor:String){user(login:$login){repositories(first:50,after:$cursor,ownerAffiliations:[OWNER]){nodes{id isFork stargazerCount forkCount pullRequests(first:1){totalCount} open:pullRequests(first:1,states:[OPEN]){totalCount} merged:pullRequests(first:1,states:[MERGED]){totalCount} closed:pullRequests(first:1,states:[CLOSED]){totalCount}} ${PAGE}}}}`,{login:USERNAME,cursor})).user.repositories);
  // Direct PR connections avoid search-index visibility discrepancies.
  const authoredPRs=await paginate(async cursor => (await api(`query($login:String!,$cursor:String){user(login:$login){pullRequests(first:100,after:$cursor){nodes{repository{owner{login}}} ${PAGE}}}}`,{login:USERNAME,cursor})).user.pullRequests);
  const issueData=await api(`query($login:String!){user(login:$login){issues(first:1){totalCount}}}`,{login:USERNAME});
  const authored={authored:base.user.authored.totalCount,open:base.user.prOpen.totalCount,merged:base.user.prMerged.totalCount,closed:base.user.prClosed.totalCount,external:authoredPRs.filter(pr=>pr.repository && pr.repository.owner.login.toLowerCase()!==USERNAME.toLowerCase()).length,issues:issueData.user.issues.totalCount};
  if(authored.open+authored.merged+authored.closed!==authored.authored || authoredPRs.length!==authored.authored) throw new Error('PR counts changed during collection; retry the workflow.');
  console.log(`PRs (token-visible): ${authored.authored} authored, ${authored.open} open, ${authored.merged} merged, ${authored.closed} closed; last-12-month contributions: ${base.user.contributionsCollection.totalPullRequestContributions}`);
  const owned={total:0,open:0,merged:0,closed:0};
  for(const r of repos){owned.total+=r.pullRequests.totalCount; for(const k of ['open','merged','closed']) owned[k]+=r[k].totalCount;}
  return {username:base.user.login,updatedAt:now.toISOString(),scope:'Token-visible data',stats:{stars:repos.filter(r=>!r.isFork).reduce((s,r)=>s+r.stargazerCount,0),repos:repos.length,originals:repos.filter(r=>!r.isFork).length,forks:repos.filter(r=>r.isFork).length,followers:base.user.followers.totalCount,following:base.user.following.totalCount,contributed:base.user.repositoriesContributedTo.totalCount,issues:authored.issues,...base.user.contributionsCollection},prs:{...authored,owned},langs:PROFILE_LANGUAGES,languageSource:'manual'};
}
function text(x,y,value,cls='label',extra=''){return `<text x="${x}" y="${y}" class="${cls}" ${extra}>${esc(value)}</text>`;}
function liquidSurface(w,h) {
 const r=24;
 return `<defs><linearGradient id="water-rim" x1="0" y1="0" x2="1" y2="1"><stop stop-color="#fff" stop-opacity=".86"/><stop offset=".22" stop-color="#fff" stop-opacity=".14"/><stop offset=".48" stop-color="#91a3b5" stop-opacity=".12"/><stop offset=".72" stop-color="#fff" stop-opacity=".10"/><stop offset="1" stop-color="#fff" stop-opacity=".62"/></linearGradient><linearGradient id="inner-rim" x1="1" y1="0" x2="0" y2="1"><stop stop-color="#8aa1b5" stop-opacity=".16"/><stop offset=".45" stop-color="#fff" stop-opacity="0"/><stop offset="1" stop-color="#fff" stop-opacity=".38"/></linearGradient><linearGradient id="edge-shadow" x1="0" y1="0" x2="0" y2="1"><stop stop-color="#101820" stop-opacity=".08"/><stop offset=".5" stop-color="#101820" stop-opacity=".015"/><stop offset="1" stop-color="#101820" stop-opacity=".22"/></linearGradient><filter id="edge-soft" x="-10%" y="-20%" width="120%" height="140%"><feGaussianBlur stdDeviation="1.3"/></filter></defs><rect x="4" y="5" width="${w-8}" height="${h-10}" rx="${r}" fill="#fff" fill-opacity=".025" stroke="url(#edge-shadow)" stroke-width="5"/><rect x="6" y="6" width="${w-12}" height="${h-12}" rx="${r-2}" fill="none" stroke="url(#water-rim)" stroke-width="9" stroke-opacity=".34" filter="url(#edge-soft)"/><rect x="2" y="2" width="${w-4}" height="${h-4}" rx="${r+2}" fill="none" stroke="url(#water-rim)" stroke-width="1.3"/><rect x="10" y="10" width="${w-20}" height="${h-20}" rx="${r-6}" fill="none" stroke="url(#inner-rim)" stroke-width="1.4"/>`;
}
function frame(title,subtitle,body,d,w=440,h=190){return `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}" role="img" aria-labelledby="title desc"><title id="title">${esc(title)} — ${esc(d.username)}</title><desc id="desc">${esc(subtitle)}. Updated ${esc(d.updatedAt)}. ${esc(d.scope)}.</desc><style>text{font-family:Inter,-apple-system,BlinkMacSystemFont,Segoe UI,Helvetica,Arial,sans-serif}.title{fill:#f0f6fc;font-size:15px;font-weight:600;letter-spacing:-.2px}.label{fill:#919aa6;font-size:11px}.value{fill:#e6edf3;font-size:23px;font-weight:600;letter-spacing:-.5px}.small{fill:#7d8590;font-size:10px}.name{fill:#c9d1d9;font-size:12px}.user{fill:#919aa6;font-size:11px}@media(prefers-color-scheme:light){.title,.value{fill:#18212b}.label,.small,.user{fill:#576474}.name{fill:#283646}}</style>${liquidSurface(w,h)}${text(24,34,title,'title')}${w===440?text(w-24,34,'@'+d.username,'user','text-anchor="end"'):''}<path d="M24 51H${w-24}" stroke="#8b98a6" stroke-opacity=".18"/>${body}${d.scope.startsWith('DEMO')?text(w-24,h-10,'DEMO','small','text-anchor="end"'):''}</svg>`;}
function grid(items){return items.map(([label,value],i)=>{const x=24+i%3*132,y=89+Math.floor(i/3)*57;return text(x,y,number(value),'value')+text(x,y+19,label);}).join('');}
function profilePanel(w,h,title,body,surface=true) {
 return `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}" role="img" aria-label="${esc(title)}"><title>${esc(title)}</title><style>text{font-family:Inter,-apple-system,BlinkMacSystemFont,Segoe UI,Arial,sans-serif}.heading{font-size:27px;font-weight:600;letter-spacing:-.6px;fill:#f0f6fc}.project{font-size:19px;font-weight:600;letter-spacing:-.3px;fill:#f0f6fc}.copy{font-size:12px;fill:#a5b0bc}.tag{font-size:10px;fill:#919aa6;letter-spacing:.6px}.link{font-size:12px;font-weight:500;fill:#e6edf3}@media(prefers-color-scheme:light){.heading,.project,.link{fill:#18212b}.copy{fill:#52616e}.tag{fill:#657583}}</style>${surface?liquidSurface(w,h):''}${body}</svg>`;
}
function profileSections(){
 const header=profilePanel(800,126,'Safa — Full-stack developer',`<text x="32" y="47" class="heading">Safa</text><text x="32" y="72" class="copy">Full-stack developer</text><text x="32" y="98" class="copy">Web applications, real-time systems and AI tools.</text>`);
 const projects=[{x:0,name:'Cinapil',type:'FILM DISCOVERY',lines:['Discover films, build watchlists','and track viewing history.','Integrated with the TMDB API.'],stack:['Next.js · TypeScript']},{x:272,name:'SidusChat',type:'REAL-TIME MESSAGING',lines:['Live messaging with SignalR,','JWT authentication and','session management.'],stack:['Next.js · .NET','PostgreSQL · Redis']},{x:544,name:'MessaLM',type:'AI CHAT CLIENT',lines:['Terminal conversations with','session memory and streamed','AI responses.'],stack:['Python · LangChain · Groq']}];
 const work=profilePanel(800,208,'Selected projects: Cinapil, SidusChat and MessaLM',projects.map(p=>`<g transform="translate(${p.x},0)">${liquidSurface(256,208)}<text x="24" y="35" class="tag">${p.type}</text><text x="24" y="66" class="project">${p.name}</text>${p.lines.map((s,i)=>`<text x="24" y="${98+i*20}" class="copy">${esc(s)}</text>`).join('')}<line x1="24" y1="153" x2="232" y2="153" stroke="#8b98a6" stroke-opacity=".18"/>${p.stack.map((s,i)=>`<text x="24" y="${175+i*17}" class="tag" letter-spacing="0">${esc(s)}</text>`).join('')}</g>`).join(''),false);
 const pill=label=>profilePanel(140,48,label,`<text x="70" y="29" text-anchor="middle" class="link">${label}</text>`);
 return {'profile-intro.svg':header,'selected-work.svg':work,'contact-linkedin.svg':pill('LinkedIn'),'contact-portfolio.svg':pill('Portfolio'),'contact-email.svg':pill('Email')};
}
function render(d){
 const s=d.stats,p=d.prs;
 const stats=frame('GitHub Stats','Commits and PR contributions: last 12 months',grid([['Stars',s.stars],['Yearly Commits',s.totalCommitContributions],['Yearly PRs',s.totalPullRequestContributions],['Issues Authored',s.issues],['Repositories',s.repos],['Contributed to',s.contributed]]),d);
 const prs=frame('Pull Requests','Lifetime · authored PRs',grid([['Authored',p.authored],['Open',p.open],['Merged',p.merged],['Closed · unmerged',p.closed],['External authored',p.external],['In owned repos³',p.owned.total]]),d);
 const activity=frame('Contributions','Last 12 months',grid([['Commits',s.totalCommitContributions],['PR contributions',s.totalPullRequestContributions],['PR reviews',s.totalPullRequestReviewContributions],['Issue contributions',s.totalIssueContributions],['External repos¹',s.contributed],['Restricted²',s.restrictedContributionsCount]]),d);
 // Official language colors come from GitHub's Language.color field.
 let x=24;const gap=3,usable=312-gap*Math.max(0,d.langs.length-1);
 const bar=d.langs.map((l,i)=>{const width=usable*l.pct/100;const r=`<rect x="${x.toFixed(3)}" y="66" width="${width.toFixed(3)}" height="6" rx="3" fill="${esc(l.color || '#94a3b8')}"/>`;x+=width+gap;return r;}).join('');
 const legend=d.langs.map((l,i)=>{const lx=24+i%2*164,ly=103+Math.floor(i/2)*26;const name=l.name.length>13?l.name.slice(0,12)+'…':l.name;return `<g><title>${esc(l.name)}: ${l.pct.toFixed(1)}%</title><circle cx="${lx+4}" cy="${ly-4}" r="3.5" fill="${esc(l.color || '#94a3b8')}"/>${text(lx+14,ly,name,'name')}${text(lx+148,ly,l.pct.toFixed(1)+'%','label','text-anchor="end"')}</g>`;}).join('');
 const langs=frame('Languages','Manually selected display distribution',`<rect x="24" y="66" width="312" height="6" rx="3" fill="#161b22"/>`+bar+(legend||text(24,104,'No language data available.')),d,360);
 return {...profileSections(),'github-stats.svg':stats,'pull-requests.svg':prs,'activity.svg':activity,'top-langs.svg':langs,'github-stats-glass.svg':stats,'top-langs-glass.svg':langs,'github-stats-liquid.svg':stats,'top-langs-liquid.svg':langs,'github-stats-liquid-clean.svg':stats,'top-langs-liquid-clean.svg':langs,'github-stats-water.svg':stats,'top-langs-water.svg':langs,'github-stats-auto.svg':stats,'profile-languages.svg':langs};
}
function mock(){return {username:USERNAME,updatedAt:'2026-10-09T12:00:00.000Z',scope:'DEMO · sample data',stats:{stars:128,repos:112,originals:96,forks:16,followers:42,following:18,issues:21,contributed:8,totalCommitContributions:734,totalPullRequestContributions:56,totalPullRequestReviewContributions:32,totalIssueContributions:14,restrictedContributionsCount:0},prs:{authored:86,open:8,merged:70,closed:8,external:19,owned:{total:124,open:12,merged:104,closed:8}},langs:[{name:'TypeScript',size:860,color:'#3178c6',pct:86},{name:'JavaScript',size:65,color:'#f1e05a',pct:6.5},{name:'C#',size:25,color:'#178600',pct:2.5},{name:'CSS',size:25,color:'#563d7c',pct:2.5},{name:'Python',size:15,color:'#3572A5',pct:1.5},{name:'Other',size:10,color:'#94a3b8',pct:1}]};}
async function main(){if(process.env.GITHUB_ACTIONS==='true' && process.env.MOCK==='1') throw new Error('Demo data is not allowed in the production profile workflow');const d=process.env.MOCK==='1'?mock():await fetchData();fs.mkdirSync(OUT,{recursive:true});for(const [name,svg] of Object.entries(render(d)))fs.writeFileSync(path.join(OUT,name),svg);fs.writeFileSync(path.join(OUT,'stats.json'),JSON.stringify(d,null,2));console.log(`Generated cards in ${OUT}${process.env.MOCK==='1'?' (DEMO)':''}`);}
if(require.main===module)main().catch(e=>{console.error(e.message);process.exitCode=1;});
module.exports={paginate,languageTotals,render,fetchData,graphql,mock};





