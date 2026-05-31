const Scorer = (() => {
  const INJURY_MULTIPLIER = {
    'out': 0, 'injured reserve': 0, 'ir': 0,
    'doubtful': 0.5, 'questionable': 0.85, 'probable': 0.95,
  };

  function injuryMult(status) {
    if (!status) return 1.0;
    const s = status.toLowerCase();
    for (const [key, val] of Object.entries(INJURY_MULTIPLIER)) {
      if (s.includes(key)) return val;
    }
    return 1.0;
  }

  function recentAvg(playerId, recentStatsWeeks) {
    const scores = recentStatsWeeks
      .map(w => { const p = w[playerId]; return p ? (p.pts_ppr ?? p.pts_std ?? p.pts_half_ppr ?? null) : null; })
      .filter(v => v !== null);
    if (!scores.length) return 0;
    return scores.reduce((a, b) => a + b, 0) / scores.length;
  }

  function defFactor(oppRank) {
    if (!oppRank) return 1.0;
    return 0.8 + ((oppRank - 1) / 31) * 0.4;
  }

  function scorePlayers(rosterPlayerIds, playerMeta, projections, recentStatsWeeks, injuryMap) {
    return rosterPlayerIds.map(playerId => {
      const meta = playerMeta[playerId] || {};
      const proj = projections[playerId] || {};
      const projPts = proj.pts_ppr ?? proj.pts_std ?? proj.pts_half_ppr ?? 0;
      const position = (meta.fantasy_positions && meta.fantasy_positions[0]) || meta.position || 'UNKNOWN';
      const recent = recentAvg(playerId, recentStatsWeeks);
      const injuryStatus = injuryMap[playerId] || injuryMap[meta.espn_id] || 'Active';
      const iMult = injuryMult(injuryStatus);
      const base = projPts > 0 ? projPts : recent;

      return {
        playerId,
        name: `${meta.first_name || ''} ${meta.last_name || ''}`.trim() || playerId,
        position,
        team: meta.team || '',
        projPts,
        recentAvg: recent,
        injuryStatus,
        opponent: '?',
        oppRank: null,
        score: base * iMult,
      };
    });
  }

  function applyDefense(players, defRankings, opponentOf) {
    players.forEach(p => {
      const oppTeam = opponentOf(p.playerId, p.team);
      p.opponent = oppTeam || '?';
      p.oppRank = (oppTeam && defRankings[oppTeam] && defRankings[oppTeam][p.position]) || null;
      p.score = p.score * defFactor(p.oppRank);
    });
  }

  function rankByPosition(players) {
    const groups = {};
    players.forEach(p => {
      if (!groups[p.position]) groups[p.position] = [];
      groups[p.position].push(p);
    });
    Object.values(groups).forEach(arr => arr.sort((a, b) => b.score - a.score));
    return groups;
  }

  function getTier(rank, position) {
    const starters = { QB: 1, RB: 2, WR: 3, TE: 1, K: 1, DEF: 1 };
    const flexPos = new Set(['RB', 'WR', 'TE']);
    const n = starters[position] ?? 1;
    if (rank <= n) return 'START';
    if (flexPos.has(position) && rank <= n + 2) return 'FLEX';
    return 'SIT';
  }

  return { scorePlayers, applyDefense, rankByPosition, getTier };
})();
