const SleeperAPI = (() => {
  const BASE = 'https://api.sleeper.app/v1';

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

  async function get(path) {
    const res = await fetch(BASE + path);
    if (!res.ok) throw new Error(`Sleeper ${path}: ${res.status}`);
    return res.json();
  }

  async function getUser(username) {
    const key = `sleeper_user_${username}`;
    const cached = cacheGet(key);
    if (cached) return cached;
    const data = await get(`/user/${username}`);
    cacheSet(key, data, 24 * 60 * 60 * 1000);
    return data;
  }

  async function getUserLeagues(userId, season) {
    const key = `sleeper_leagues_${userId}_${season}`;
    const cached = cacheGet(key);
    if (cached) return cached;
    const data = await get(`/user/${userId}/leagues/nfl/${season}`);
    cacheSet(key, data, 6 * 60 * 60 * 1000);
    return data;
  }

  async function getRosters(leagueId) {
    const key = `sleeper_rosters_${leagueId}`;
    const cached = cacheGet(key);
    if (cached) return cached;
    const data = await get(`/league/${leagueId}/rosters`);
    cacheSet(key, data, 60 * 60 * 1000);
    return data;
  }

  async function getMatchups(leagueId, week) {
    const key = `sleeper_matchups_${leagueId}_${week}`;
    const cached = cacheGet(key);
    if (cached) return cached;
    const data = await get(`/league/${leagueId}/matchups/${week}`);
    cacheSet(key, data, 60 * 60 * 1000);
    return data;
  }

  async function getAllPlayers() {
    const key = 'sleeper_all_players';
    const cached = cacheGet(key);
    if (cached) return cached;
    const data = await get('/players/nfl');
    cacheSet(key, data, 24 * 60 * 60 * 1000);
    return data;
  }

  async function getProjections(season, week) {
    const key = `sleeper_proj_${season}_${week}`;
    const cached = cacheGet(key);
    if (cached) return cached;
    const data = await get(`/projections/nfl/regular/${season}/${week}`);
    cacheSet(key, data, 7 * 24 * 60 * 60 * 1000);
    return data;
  }

  async function getStats(season, week) {
    const key = `sleeper_stats_${season}_${week}`;
    const cached = cacheGet(key);
    if (cached) return cached;
    const data = await get(`/stats/nfl/regular/${season}/${week}`);
    cacheSet(key, data, 7 * 24 * 60 * 60 * 1000);
    return data;
  }

  return { getUser, getUserLeagues, getRosters, getMatchups, getAllPlayers, getProjections, getStats };
})();
