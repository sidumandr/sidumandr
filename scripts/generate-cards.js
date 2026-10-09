// Modern GitHub istatistik + dil kartları (SVG) üretir.
// Çalıştırma: GITHUB_TOKEN=... USERNAME=sidumandr node scripts/generate-cards.js
const fs = require("fs");
const path = require("path");

const USERNAME = process.env.USERNAME || "sidumandr";
const TOKEN = process.env.GITHUB_TOKEN;
const OUT = process.env.OUT_DIR || "dist";

// ---- Tasarım ----
const C = {
  bg: "#0d1117",
  border: "#21262d",
  title: "#f0f6fc",
  text: "#c9d1d9",
  muted: "#7d8590",
  track: "#161b22",
};
// Uyumlu, modern bir palet (dil sırasına göre atanır)
const PALETTE = ["#6366f1", "#22d3ee", "#34d399", "#fbbf24", "#a78bfa", "#94a3b8"];

function font(weight) {
  const file = path.join(
    require.resolve("@fontsource/inter/package.json"),
    "..",
    "files",
    `inter-latin-${weight}-normal.woff2`
  );
  const b64 = fs.readFileSync(file).toString("base64");
  return `@font-face{font-family:'InterCard';font-weight:${weight};src:url(data:font/woff2;base64,${b64}) format('woff2');}`;
}
const FONTS = [400, 500, 600].map(font).join("");
const FAMILY = "'InterCard', -apple-system, BlinkMacSystemFont, 'Segoe UI', Helvetica, Arial, sans-serif";

const esc = (s) => String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
const fmt = (n) => (n >= 1000 ? (n / 1000).toFixed(1).replace(/\.0$/, "") + "k" : String(n));

function frame(w, h, body) {
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}" fill="none">
<style>${FONTS}
text{font-family:${FAMILY};}
.t{font-size:15px;font-weight:600;fill:${C.title};letter-spacing:-0.01em}
.s{font-size:12px;font-weight:400;fill:${C.muted}}
.v{font-size:22px;font-weight:600;fill:${C.title};letter-spacing:-0.02em}
.l{font-size:11px;font-weight:500;fill:${C.muted};letter-spacing:0.04em;text-transform:uppercase}
.n{font-size:12.5px;font-weight:500;fill:${C.text}}
.p{font-size:12.5px;font-weight:400;fill:${C.muted}}
.fade{opacity:0;animation:in .5s ease forwards}
@keyframes in{to{opacity:1}}
</style>
<rect x="0.5" y="0.5" width="${w - 1}" height="${h - 1}" rx="12" fill="${C.bg}" stroke="${C.border}"/>
${body}
</svg>`;
}

function statsCard(d) {
  const W = 440, H = 190;
  const items = [
    ["Stars", d.stars],
    ["Yearly Commits", d.commits],
    ["Pull Requests", d.prs],
    ["Issues", d.issues],
    ["Repositories", d.repos],
    ["Contributed to", d.contributed],
  ];
  const colW = (W - 48) / 3;
  const cells = items
    .map(([label, val], i) => {
      const x = 24 + (i % 3) * colW;
      const y = 92 + Math.floor(i / 3) * 62;
      return `<g class="fade" style="animation-delay:${i * 80}ms">
<text x="${x}" y="${y}" class="v">${fmt(val)}</text>
<text x="${x}" y="${y + 20}" class="l">${esc(label)}</text></g>`;
    })
    .join("\n");
  const body = `<text x="24" y="36" class="t">GitHub Stats</text>
<text x="${W - 24}" y="36" class="s" text-anchor="end">@${esc(USERNAME)}</text>
<line x1="24" y1="52" x2="${W - 24}" y2="52" stroke="${C.border}"/>
${cells}`;
  return frame(W, H, body);
}

function langsCard(langs) {
  const W = 360, H = 190;
  const barX = 24, barW = W - 48, barY = 66, gap = 3;
  const usable = barW - gap * (langs.length - 1);
  let x = barX;
  const segs = langs
    .map((l, i) => {
      const w = Math.max(usable * (l.pct / 100), 3);
      const s = `<rect x="${x.toFixed(2)}" y="${barY}" width="${w.toFixed(2)}" height="6" rx="3" fill="${l.color}"/>`;
      x += w + gap;
      return s;
    })
    .join("");
  const legend = langs
    .map((l, i) => {
      const lx = 24 + (i % 2) * ((W - 48) / 2);
      const ly = 106 + Math.floor(i / 2) * 26;
      return `<g class="fade" style="animation-delay:${i * 80}ms">
<circle cx="${lx + 4}" cy="${ly - 4}" r="4" fill="${l.color}"/>
<text x="${lx + 16}" y="${ly}" class="n">${esc(l.name)}</text>
<text x="${lx + (W - 48) / 2 - 16}" y="${ly}" class="p" text-anchor="end">${l.pct.toFixed(1)}%</text></g>`;
    })
    .join("\n");
  const body = `<text x="24" y="36" class="t">Most Used Languages</text>
<rect x="${barX}" y="${barY}" width="${barW}" height="6" rx="3" fill="${C.track}"/>
${segs}
${legend}`;
  return frame(W, H, body);
}

async function fetchData() {
  const query = `query($login:String!,$prq:String!){user(login:$login){
    repositories(ownerAffiliations:OWNER,isFork:false,first:100){totalCount nodes{stargazerCount
      languages(first:10,orderBy:{field:SIZE,direction:DESC}){edges{size node{name}}}}}
    pullRequests{totalCount} issues{totalCount}
    contributionsCollection{totalCommitContributions totalPullRequestContributions restrictedContributionsCount}
    repositoriesContributedTo(first:1,contributionTypes:[COMMIT,ISSUE,PULL_REQUEST,REPOSITORY]){totalCount}}
    viewer{login}
    prSearch:search(query:$prq,type:ISSUE,first:1){issueCount}}`;
  const res = await fetch("https://api.github.com/graphql", {
    method: "POST",
    headers: { Authorization: `bearer ${TOKEN}`, "Content-Type": "application/json" },
    body: JSON.stringify({ query, variables: { login: USERNAME, prq: `author:${USERNAME} is:pr` } }),
  });
  const json = await res.json();
  if (json.errors || !json.data) throw new Error(JSON.stringify(json.errors || json));
  const u = json.data.user;
  const cc = u.contributionsCollection;
  console.log("Token sahibi:", json.data.viewer.login);
  console.log("PR (profil):", u.pullRequests.totalCount, "| PR (arama):", json.data.prSearch.issueCount,
    "| PR katkısı (son 1 yıl):", cc.totalPullRequestContributions);
  console.log("Commit (son 1 yıl):", cc.totalCommitContributions, "| Gizli kalan katkılar:", cc.restrictedContributionsCount);

  const sizes = {};
  for (const r of u.repositories.nodes)
    for (const e of r.languages.edges) sizes[e.node.name] = (sizes[e.node.name] || 0) + e.size;
  const total = Object.values(sizes).reduce((a, b) => a + b, 0) || 1;
  const langs = Object.entries(sizes)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 6)
    .map(([name, size], i) => ({ name, pct: (size / total) * 100, color: PALETTE[i] }));

  return {
    stats: {
      stars: u.repositories.nodes.reduce((a, r) => a + r.stargazerCount, 0),
      commits: u.contributionsCollection.totalCommitContributions,
      prs: Math.max(u.pullRequests.totalCount, json.data.prSearch.issueCount),
      issues: u.issues.totalCount,
      repos: u.repositories.totalCount,
      contributed: u.repositoriesContributedTo.totalCount,
    },
    langs,
  };
}

(async () => {
  const data = process.env.MOCK
    ? {
        stats: { stars: 1, commits: 73, prs: 0, issues: 0, repos: 12, contributed: 1 },
        langs: [["JavaScript", 86.07], ["TypeScript", 6.45], ["HTML", 2.58], ["C#", 2.53], ["CSS", 1.62], ["Python", 0.76]]
          .map(([name, pct], i) => ({ name, pct, color: PALETTE[i] })),
      }
    : await fetchData();
  fs.mkdirSync(OUT, { recursive: true });
  fs.writeFileSync(path.join(OUT, "github-stats.svg"), statsCard(data.stats));
  fs.writeFileSync(path.join(OUT, "top-langs.svg"), langsCard(data.langs));
  console.log("Kartlar üretildi:", OUT);
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
