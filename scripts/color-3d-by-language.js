// Recolors the 3D contribution chart (yoshi389111/github-profile-3d-contrib) so that each
// day's block is one solid color: the language colors of that day's commits, mixed by share.
// Language of a contribution = primary language of its repository (same rule as the pie chart).
const fs = require('node:fs');
const USERNAME = process.env.PROFILE_USERNAME || 'sidumandr';
const FILE = process.argv[2] || 'profile-3d-contrib/profile-transparent.svg';
const UNKNOWN_COLOR = '#8b949e'; // days whose repositories have no visible language
const WINDOW_DAYS = 90; // keeps every repo under 100 day-nodes per query
// Same side shading as the chart's own colors: d3.rgb(c).darker(k) = c * 0.7^k
const SHADE = {top: 0, left: 0.5, right: 1};

async function graphql(query, variables, request = fetch) {
  if (!process.env.GITHUB_TOKEN) throw new Error('GITHUB_TOKEN required. Configure the PROFILE_TOKEN repository secret.');
  const res = await request('https://api.github.com/graphql', {method:'POST', headers:{Authorization:`bearer ${process.env.GITHUB_TOKEN}`,'Content-Type':'application/json'},body:JSON.stringify({query,variables}),signal:AbortSignal.timeout(60000)});
  if (!res.ok) throw new Error(`GitHub HTTP ${res.status}; check token permissions and rate limits.`);
  const json = await res.json();
  if (json.errors?.length || !json.data) throw new Error(`GitHub: ${(json.errors || []).map(e=>e.message).join('; ') || 'Missing data'}`);
  return json.data;
}

const hexToRgb = hex => { const h=hex.replace('#',''); const f=h.length===3?[...h].map(c=>c+c).join(''):h; return [0,2,4].map(i=>parseInt(f.slice(i,i+2),16)); };
const rgbToHex = rgb => '#'+rgb.map(v=>Math.round(Math.max(0,Math.min(255,v))).toString(16).padStart(2,'0')).join('');

// Weighted average of colors: {color: weight} -> one homogeneous color (no gradient).
function mixColors(weights) {
  const entries=Object.entries(weights).filter(([,w])=>w>0);
  const total=entries.reduce((s,[,w])=>s+w,0);
  if(!total) return null;
  const sum=[0,0,0];
  for(const [color,w] of entries) hexToRgb(color).forEach((v,i)=>{sum[i]+=v*w/total;});
  return rgbToHex(sum);
}
const darker = (hex,k) => rgbToHex(hexToRgb(hex).map(v=>v*0.7**k));

const addDays = (date,n) => { const d=new Date(`${date}T00:00:00Z`); d.setUTCDate(d.getUTCDate()+n); return d.toISOString().slice(0,10); };
const REPO = 'repository{primaryLanguage{color}}';
const NODES = 'pageInfo{hasNextPage} nodes{occurredAt';

// date -> {commits:{color:count}, other:{color:count}}
async function fetchDailyLanguages(api=graphql) {
  const cal=(await api(`query($login:String!){user(login:$login){contributionsCollection{contributionCalendar{weeks{contributionDays{date contributionCount contributionLevel}}}}}}`,{login:USERNAME})).user.contributionsCollection.contributionCalendar;
  const days=cal.weeks.flatMap(w=>w.contributionDays);
  const daily=new Map(days.map(d=>[d.date,{commits:{},other:{}}]));
  const add=(bucket,date,color,n) => { const day=daily.get(date); if(day) day[bucket][color||UNKNOWN_COLOR]=(day[bucket][color||UNKNOWN_COLOR]||0)+n; };
  for(let start=days[0].date; start<=days.at(-1).date; start=addDays(start,WINDOW_DAYS)) {
    const end=addDays(start,WINDOW_DAYS-1);
    // One extra day on each side absorbs timezone edges; nodes are then filtered to [start, end].
    const c=(await api(`query($login:String!,$from:DateTime!,$to:DateTime!){user(login:$login){contributionsCollection(from:$from,to:$to){
      commitContributionsByRepository(maxRepositories:100){${REPO} contributions(first:100){${NODES} commitCount}}}
      pullRequestContributionsByRepository(maxRepositories:100){${REPO} contributions(first:100){${NODES}}}}
      issueContributionsByRepository(maxRepositories:100){${REPO} contributions(first:100){${NODES}}}}
      pullRequestReviewContributionsByRepository(maxRepositories:100){${REPO} contributions(first:100){${NODES}}}}}}}`,
      {login:USERNAME,from:`${addDays(start,-1)}T00:00:00Z`,to:`${addDays(end,1)}T23:59:59Z`})).user.contributionsCollection;
    for(const [key,bucket] of [['commitContributionsByRepository','commits'],['pullRequestContributionsByRepository','other'],['issueContributionsByRepository','other'],['pullRequestReviewContributionsByRepository','other']]) for(const repo of c[key]) {
      if(repo.contributions.pageInfo.hasNextPage) throw new Error(`${key}: more than 100 days in one window; lower WINDOW_DAYS`);
      for(const node of repo.contributions.nodes) {
        const date=node.occurredAt.slice(0,10);
        if(date>=start && date<=end) add(bucket,date,repo.repository.primaryLanguage?.color,node.commitCount ?? 1);
      }
    }
  }
  return days.map(d=>({...d,...daily.get(d.date)}));
}

const LEVELS = {NONE:0,FIRST_QUARTILE:1,SECOND_QUARTILE:2,THIRD_QUARTILE:3,FOURTH_QUARTILE:4};
const PANEL_RE = /<rect\b[^>]*\bclass="cont-(top|left|right)-(?:p\d+-)?(\d)"/g;

// Bars are drawn one per calendar day, in calendar order, as top/left/right rects.
function recolorSvg(svg, days) {
  const panels=[...svg.matchAll(PANEL_RE)];
  if(panels.length!==days.length*3) throw new Error(`SVG has ${panels.length/3} bars but calendar has ${days.length} days`);
  let i=0;
  return svg.replace(PANEL_RE, (match,panel,level) => {
    const day=days[Math.floor(i++/3)];
    if(LEVELS[day.contributionLevel]!==Number(level)) throw new Error(`Calendar mismatch on ${day.date}`);
    if(!day.contributionCount) return match; // empty cells keep the theme's own color
    const base=mixColors(day.commits) || mixColors(day.other) || UNKNOWN_COLOR;
    return `${match} style="fill:${darker(base,SHADE[panel])}"`;
  });
}

async function main() {
  const days=await fetchDailyLanguages();
  fs.writeFileSync(FILE, recolorSvg(fs.readFileSync(FILE,'utf8'), days));
  const active=days.filter(d=>d.contributionCount);
  const unknown=active.filter(d=>!Object.keys(d.commits).length && !Object.keys(d.other).length).length;
  console.log(`Recolored ${active.length} days in ${FILE}; ${unknown} without visible repository language (private/restricted)`);
}
if(require.main===module) main().catch(e=>{console.error(e.message);process.exit(1);});
module.exports={mixColors,darker,recolorSvg,fetchDailyLanguages};
