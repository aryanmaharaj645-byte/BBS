exports.handler = async function(event) {
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, body: 'Method not allowed' };
  }

  const token = process.env.GITHUB_PAT;
  const owner = process.env.GITHUB_OWNER;
  const repo  = process.env.GITHUB_REPO;

  if (!token || !owner || !repo) {
    return {
      statusCode: 500,
      body: JSON.stringify({ error: 'GITHUB_PAT / GITHUB_OWNER / GITHUB_REPO not set in Netlify env vars' })
    };
  }

  const res = await fetch(
    `https://api.github.com/repos/${owner}/${repo}/actions/workflows/generate-gap-signal.yml/dispatches`,
    {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: 'application/vnd.github.v3+json',
        'Content-Type': 'application/json',
        'User-Agent': 'TradeIntel-Platform',
      },
      body: JSON.stringify({ ref: 'main' }),
    }
  );

  if (res.status === 204) {
    return {
      statusCode: 200,
      body: JSON.stringify({ ok: true }),
    };
  }

  const text = await res.text();
  return {
    statusCode: res.status,
    body: JSON.stringify({ error: text }),
  };
};
