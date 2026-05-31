// State
const state = {
  sleeperUsername: '', sleeperUserId: '',
  groqKey: '', rapidApiKey: '',
  leagueId: '', season: (() => { const d = new Date(); return String(d.getMonth() < 8 ? d.getFullYear() - 1 : d.getFullYear()); })(), week: 1,
};

function loadSettings() {
  try {
    const s = JSON.parse(localStorage.getItem('ffl_settings') || '{}');
    Object.assign(state, s);
  } catch {}
  if (window.APP_CONFIG?.GROQ_API_KEY) state.groqKey = APP_CONFIG.GROQ_API_KEY;
  if (window.APP_CONFIG?.RAPIDAPI_KEY) state.rapidApiKey = APP_CONFIG.RAPIDAPI_KEY;
}

function saveSettings() {
  localStorage.setItem('ffl_settings', JSON.stringify(state));
}

function showView(id) {
  document.querySelectorAll('.view').forEach(v => v.classList.add('hidden'));
  document.getElementById(id).classList.remove('hidden');
  document.getElementById('btn-back').classList.toggle('hidden', id !== 'view-dashboard');
}

function setStatus(msg, isError) {
  const el = document.getElementById('status');
  el.textContent = msg;
  el.className = 'status ' + (isError ? 'error' : 'info');
  el.classList.remove('hidden');
}

function clearStatus() {
  document.getElementById('status').classList.add('hidden');
}

function setLoading(msg) {
  document.getElementById('loading-msg').textContent = msg;
}

// --- Load leagues ---
async function loadLeagues() {
  const username = document.getElementById('inp-username').value.trim();
  const season = document.getElementById('inp-season').value.trim();

  if (!username) { setStatus('Enter your Sleeper username.', true); return; }

  setStatus('Looking up Sleeper account...');
  try {
    const user = await SleeperAPI.getUser(username);
    if (!user || !user.user_id) throw new Error('Sleeper user not found. Check your username.');

    state.sleeperUsername = username;
    state.sleeperUserId = user.user_id;
    state.season = season || String(new Date().getFullYear());
    saveSettings();

    const leagues = await SleeperAPI.getUserLeagues(user.user_id, state.season);
    if (!leagues || !leagues.length) throw new Error('No NFL leagues found for this season.');

    const select = document.getElementById('sel-league');
    select.innerHTML = '<option value="">-- Select a league --</option>';
    leagues.forEach(l => {
      const opt = document.createElement('option');
      opt.value = l.league_id;
      opt.textContent = l.name;
      if (l.league_id === state.leagueId) opt.selected = true;
      select.appendChild(opt);
    });

    document.getElementById('league-row').classList.remove('hidden');
    document.getElementById('analyze-row').classList.remove('hidden');
    clearStatus();
  } catch (e) {
    setStatus(e.message, true);
  }
}

// --- Run analysis ---
async function runAnalysis() {
  const leagueId = document.getElementById('sel-league').value;
  const week = parseInt(document.getElementById('inp-week').value, 10);
  const season = document.getElementById('inp-season').value.trim() || state.season;

  if (!leagueId) { setStatus('Select a league.', true); return; }
  if (!week || week < 1 || week > 18) { setStatus('Enter a valid week (1–18).', true); return; }

  state.leagueId = leagueId;
  state.week = week;
  state.season = season;
  clearStatus();
  saveSettings();
  showView('view-loading');

  try {
    setLoading('Fetching roster and player data...');
    const [rosters, matchups, allPlayers] = await Promise.all([
      SleeperAPI.getRosters(leagueId),
      SleeperAPI.getMatchups(leagueId, week),
      SleeperAPI.getAllPlayers(),
    ]);

    const myRoster = rosters.find(r => r.owner_id === state.sleeperUserId);
    if (!myRoster) throw new Error('Could not find your roster. Make sure you selected the right league.');

    const myMatchup = matchups.find(m => m.roster_id === myRoster.roster_id);
    const oppMatchup = myMatchup
      ? matchups.find(m => m.matchup_id === myMatchup.matchup_id && m.roster_id !== myRoster.roster_id)
      : null;

    const rosterIds = myRoster.players || [];

    setLoading('Fetching projections and recent stats...');
    const weekNums = [1, 2, 3].map(o => week - o).filter(w => w > 0);
    const [projections, ...recentStats] = await Promise.all([
      SleeperAPI.getProjections(season, week),
      ...weekNums.map(w => SleeperAPI.getStats(season, w)),
    ]);

    setLoading('Fetching injury and defense data...');
    let injuryMap = {}, defRankings = {};
    if (state.rapidApiKey) {
      try {
        [injuryMap, defRankings] = await Promise.all([
          NFLAPI.getInjuryStatuses(state.rapidApiKey, season, week),
          NFLAPI.getTeamDefenseRankings(state.rapidApiKey, season),
        ]);
      } catch (e) {
        console.warn('NFL API unavailable, continuing without:', e.message);
      }
    }

    setLoading('Fetching weekly schedule...');
    const scheduleMap = await getWeeklySchedule(season, week);

    setLoading('Scoring players...');
    const scored = Scorer.scorePlayers(rosterIds, allPlayers, projections, recentStats, injuryMap);

    Scorer.applyDefense(scored, defRankings, (_playerId, myTeam) => {
      return myTeam ? (scheduleMap[myTeam] || null) : null;
    });

    const groqKey = state.groqKey;
    saveSettings();

    setLoading('Generating AI explanations...');
    let explanations = {};
    let groqError = '';
    if (groqKey) {
      try {
        const forGroq = scored
          .filter(p => ['QB','RB','WR','TE','K','DEF'].includes(p.position))
          .slice(0, 30)
          .map(p => {
            const weekProj = projections[p.playerId] || {};
            const recentWeeks = recentStats.map(w => w[p.playerId] || {});
            const avg = key => {
              const vals = recentWeeks.map(w => w[key] || 0).filter((_, i) => recentWeeks[i] && Object.keys(recentWeeks[i]).length);
              return vals.length ? (vals.reduce((a, b) => a + b, 0) / vals.length).toFixed(1) : null;
            };

            const base = {
              name: p.name,
              position: p.position,
              team: p.team,
              opponent: p.opponent || '?',
              injuryStatus: p.injuryStatus,
              oppRankVsPos: p.oppRank ? `#${p.oppRank} (1=hardest, 32=easiest)` : 'unknown',
              projectedPoints: Number(p.projPts).toFixed(1),
              recentAvgPoints: Number(p.recentAvg).toFixed(1),
            };

            if (p.position === 'QB') {
              Object.assign(base, {
                projYards: weekProj.pass_yd || 0, projTDs: weekProj.pass_td || 0, projINTs: weekProj.pass_int || 0,
                recentAvgYards: avg('pass_yd'), recentAvgTDs: avg('pass_td'), recentAvgINTs: avg('pass_int'),
              });
            } else if (p.position === 'RB') {
              Object.assign(base, {
                projCarries: weekProj.rush_att || 0, projRushYds: weekProj.rush_yd || 0, projTargets: weekProj.rec_tgt || 0,
                recentAvgCarries: avg('rush_att'), recentAvgRushYds: avg('rush_yd'), recentAvgTargets: avg('rec_tgt'),
              });
            } else if (p.position === 'WR' || p.position === 'TE') {
              Object.assign(base, {
                projTargets: weekProj.rec_tgt || 0, projRecYds: weekProj.rec_yd || 0, projRecTDs: weekProj.rec_td || 0,
                recentAvgTargets: avg('rec_tgt'), recentAvgRecYds: avg('rec_yd'), recentAvgRecTDs: avg('rec_td'),
              });
            }
            return base;
          });
        // Returns { playerName: explanation } — also build lowercase index for fuzzy matching
        const raw = await GroqAPI.getStartSitExplanations(groqKey, forGroq);
        Object.entries(raw).forEach(([k, v]) => {
          if (v) {
            explanations[k] = v;
            explanations[k.trim().toLowerCase()] = v;
          }
        });
      } catch (e) {
        groqError = e.message;
      }
    } else {
      groqError = 'No Groq API key — add GROQ_API_KEY to your .env file.';
    }

    const ranked = Scorer.rankByPosition(scored);
    renderDashboard(ranked, explanations, groqError);
    showView('view-dashboard');

  } catch (e) {
    setStatus(e.message, true);
    showView('view-settings');
  }
}

// --- Schedule ---
// Returns { "KC": "DET", "DET": "KC", ... } for every game that week
async function getWeeklySchedule(season, week) {
  const cacheKey = `espn_schedule_${season}_${week}`;
  try {
    const raw = localStorage.getItem(cacheKey);
    if (raw) {
      const { data, expires } = JSON.parse(raw);
      if (Date.now() < expires) return data;
    }
  } catch {}

  try {
    const url = `https://site.api.espn.com/apis/site/v2/sports/football/nfl/scoreboard?seasontype=2&season=${season}&week=${week}`;
    const res = await fetch(url);
    if (!res.ok) return {};
    const data = await res.json();
    // Normalize ESPN abbreviations to match Sleeper's conventions
    const normalize = abbr => ({ JAC: 'JAX', WSH: 'WAS', LAR: 'LA' }[abbr] || abbr);
    const map = {};
    (data.events || []).forEach(event => {
      const teams = (event.competitions?.[0]?.competitors || [])
        .map(c => normalize(c.team?.abbreviation))
        .filter(Boolean);
      if (teams.length === 2) {
        map[teams[0]] = teams[1];
        map[teams[1]] = teams[0];
      }
    });
    try { localStorage.setItem(cacheKey, JSON.stringify({ data: map, expires: Date.now() + 7 * 24 * 60 * 60 * 1000 })); } catch {}
    return map;
  } catch (e) {
    console.warn('Schedule fetch failed:', e.message);
    return {};
  }
}

// --- Render ---
function injuryBadgeClass(status) {
  const s = (status || '').toLowerCase();
  if (s.includes('out') || s.includes('ir')) return 'out';
  if (s.includes('doubtful')) return 'doubtful';
  if (s.includes('questionable')) return 'questionable';
  return 'probable';
}

function renderDashboard(ranked, explanations, groqError) {
  const container = document.getElementById('position-groups');
  container.innerHTML = '';

  if (groqError) {
    const banner = document.createElement('div');
    banner.className = 'status error';
    banner.style.marginBottom = '20px';
    banner.textContent = 'AI explanations unavailable: ' + groqError;
    container.appendChild(banner);
  }

  const posOrder = ['QB','RB','WR','TE','K','DEF'];

  posOrder.forEach(pos => {
    const players = ranked[pos];
    if (!players || !players.length) return;

    const section = document.createElement('section');
    section.className = 'pos-group';
    section.innerHTML = `<h2>${pos}</h2>`;

    const grid = document.createElement('div');
    grid.className = 'player-grid';

    players.forEach((p, idx) => {
      try {
        const tier = Scorer.getTier(idx + 1, pos);
        const explanation = explanations[p.name] || explanations[p.name.trim().toLowerCase()] || '';

        const card = document.createElement('div');
        card.className = `player-card tier-${tier.toLowerCase()}`;

        // Header row
        const header = document.createElement('div');
        header.className = 'card-header';

        const tierEl = document.createElement('span');
        tierEl.className = 'tier-label';
        tierEl.textContent = tier;
        header.appendChild(tierEl);

        const nameEl = document.createElement('span');
        nameEl.className = 'player-name';
        nameEl.textContent = p.name;
        header.appendChild(nameEl);

        if (p.injuryStatus && p.injuryStatus !== 'Active') {
          const badge = document.createElement('span');
          badge.className = `badge badge-${injuryBadgeClass(p.injuryStatus)}`;
          badge.textContent = p.injuryStatus;
          header.appendChild(badge);
        }
        card.appendChild(header);

        // Meta row
        const meta = document.createElement('div');
        meta.className = 'card-meta';

        const addMeta = (text, cls) => {
          const s = document.createElement('span');
          s.textContent = text;
          if (cls) s.className = cls;
          meta.appendChild(s);
        };
        addMeta(p.team || '—');
        addMeta(`vs ${p.opponent}`);
        addMeta(p.projPts > 0 ? `${Number(p.projPts).toFixed(1)} proj` : 'No proj', 'proj');
        if (p.recentAvg > 0) addMeta(`${Number(p.recentAvg).toFixed(1)} recent avg`);
        if (p.oppRank) addMeta(`Opp #${p.oppRank} vs ${pos}`);
        card.appendChild(meta);

        // AI explanation
        if (explanation) {
          const expEl = document.createElement('p');
          expEl.className = 'explanation';
          expEl.textContent = explanation;
          card.appendChild(expEl);
        }

        grid.appendChild(card);
      } catch (err) {
        console.error('Card render error:', p && p.name, err);
      }
    });

    section.appendChild(grid);
    container.appendChild(section);
  });
}

// --- Boot ---
loadSettings();

document.getElementById('inp-username').value = state.sleeperUsername;
document.getElementById('inp-season').value = state.season;
document.getElementById('inp-week').value = state.week;

document.getElementById('btn-load-leagues').addEventListener('click', loadLeagues);
document.getElementById('btn-analyze').addEventListener('click', runAnalysis);
document.getElementById('btn-back').addEventListener('click', () => showView('view-settings'));


// Restore league dropdown if returning
if (state.sleeperUserId) {
  loadLeagues().catch(() => {});
}
