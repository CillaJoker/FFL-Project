const NFLAPI = (() => {
  const BASE = 'https://nfl-api-data.p.rapidapi.com';

  function cacheGet(key) {
    try {
      const raw = localStorage.getItem(key);
      if (!raw) return null;
      const { data, expires } = JSON.parse(raw);
      if (Date.now() > expires) { localStorage.removeItem(key); return null; }
      return data;
    } catch { return null; }
  }

  function cacheSet(key, data, ttlMs) {
    try { localStorage.setItem(key, JSON.stringify({ data, expires: Date.now() + ttlMs })); } catch {}
  }

  async function get(path, apiKey) {
    const res = await fetch(BASE + path, {
      headers: {
        'X-RapidAPI-Key': apiKey,
        'X-RapidAPI-Host': 'nfl-api-data.p.rapidapi.com',
      },
    });
    if (!res.ok) throw new Error(`NFL API ${path}: ${res.status}`);
    return res.json();
  }

  async function getTeamDefenseRankings(apiKey, season) {
    const key = `nfl_defense_rankings_${season}`;
    const cached = cacheGet(key);
    if (cached) return cached;

    const data = await get(`/nfl-team-info/v1/data?yearseason=${season}`, apiKey);
    const teams = Array.isArray(data) ? data : (data.body || data.data || []);

    const statKeys = { QB: 'passingYardsAllowed', RB: 'rushingYardsAllowed', WR: 'receivingYardsAllowedWR', TE: 'receivingYardsAllowedTE' };
    const rankings = {};

    ['QB', 'RB', 'WR', 'TE'].forEach(pos => {
      const statKey = statKeys[pos];
      const sorted = [...teams].filter(t => t[statKey] != null).sort((a, b) => Number(a[statKey]) - Number(b[statKey]));
      sorted.forEach((team, idx) => {
        const abbr = team.teamAbv || team.teamAbbreviation || team.abbr;
        if (!abbr) return;
        if (!rankings[abbr]) rankings[abbr] = {};
        rankings[abbr][pos] = idx + 1;
      });
    });

    cacheSet(key, rankings, 7 * 24 * 60 * 60 * 1000);
    return rankings;
  }

  async function getInjuryStatuses(apiKey, season, week) {
    const key = `nfl_injuries_${season}_${week}`;
    const cached = cacheGet(key);
    if (cached) return cached;

    const data = await get(`/nfl-injuries/v1/data?yearseason=${season}&week=${week}`, apiKey);
    const injuries = Array.isArray(data) ? data : (data.body || data.data || []);

    const statusMap = {};
    injuries.forEach(p => {
      const id = p.playerID || p.player_id || p.espnID;
      const status = p.injuryStatus || p.status || 'Active';
      if (id) statusMap[String(id)] = status;
    });

    cacheSet(key, statusMap, 6 * 60 * 60 * 1000);
    return statusMap;
  }

  return { getTeamDefenseRankings, getInjuryStatuses };
})();
