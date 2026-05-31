const GroqAPI = (() => {
  const GROQ_URL = 'https://api.groq.com/openai/v1/chat/completions';
  const MODEL = 'llama-3.3-70b-versatile';

  async function getStartSitExplanations(apiKey, players) {
    const res = await fetch(GROQ_URL, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: MODEL,
        temperature: 0.4,
        messages: [
          {
            role: 'system',
            content:
              'You are a sharp fantasy football analyst. ' +
              'Each player object has position-specific stats: targets, carries, yards, TDs, and opponent defensive rank. ' +
              'Return a JSON object mapping each player\'s exact "name" to one sentence (max 22 words) with a START or SIT verdict. ' +
              'Cite a specific stat or matchup detail — not just points. Example: "Start — averaging 9 targets and faces the league\'s 30th-ranked WR defense." ' +
              'Return ONLY the JSON object, no markdown, no extra text.',
          },
          {
            role: 'user',
            content: JSON.stringify(players),
          },
        ],
      }),
    });

    if (!res.ok) {
      const err = await res.text();
      throw new Error(`Groq ${res.status}: ${err.slice(0, 200)}`);
    }

    const json = await res.json();
    const text = (json.choices?.[0]?.message?.content ?? '').trim();

    // Try object first (most reliable for name-keyed response)
    const objMatch = text.match(/\{[\s\S]*\}/);
    if (objMatch) {
      try {
        const obj = JSON.parse(objMatch[0]);
        if (obj && typeof obj === 'object' && !Array.isArray(obj)) return obj;
      } catch {}
    }

    // Fall back: try array and convert to name-keyed object using input order
    const arrMatch = text.match(/\[[\s\S]*\]/);
    if (arrMatch) {
      try {
        const arr = JSON.parse(arrMatch[0]);
        if (Array.isArray(arr)) {
          const obj = {};
          arr.forEach((sentence, i) => {
            if (players[i] && sentence) obj[players[i].name] = sentence;
          });
          return obj;
        }
      } catch {}
    }

    return {};
  }

  return { getStartSitExplanations };
})();
