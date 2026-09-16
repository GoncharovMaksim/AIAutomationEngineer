import WebSocket from 'ws';

async function check() {
  const tabs = await fetch('http://127.0.0.1:9222/json/list').then(r => r.json());
  const tab = tabs.find(t => t.url.includes('myjino.ru'));
  if (!tab) {
    console.log('No tab found for myjino.ru');
    return;
  }
  const ws = new WebSocket(tab.webSocketDebuggerUrl);
  await new Promise(r => ws.on('open', r));

  function send(method, params = {}) {
    return new Promise((res, rej) => {
      const id = Math.floor(Math.random() * 100000);
      const handler = (data) => {
        const msg = JSON.parse(data.toString());
        if (msg.id === id) {
          ws.off('message', handler);
          msg.error ? rej(msg.error) : res(msg.result);
        }
      };
      ws.on('message', handler);
      ws.send(JSON.stringify({ id, method, params }));
    });
  }

  const evalRes = await send('Runtime.evaluate', {
    expression: `(async () => {
      const res = await fetch('/api/games?limit=50');
      const d = await res.json();
      return JSON.stringify({
        total: d.count,
        games: d.data.map(g => ({
          title: g.title,
          slug: g.slug,
          metascore: g.max_metascore,
          userscore: g.avg_userscore,
          platforms: g.platforms_str
        }))
      });
    })()`,
    returnByValue: true,
    awaitPromise: true
  });
  console.log('Games list:', JSON.parse(evalRes.result?.value || '{}'));
  ws.close();
  return;
  console.log('Raw evalRes:', evalRes);
  ws.close();
  return;

  console.log('EvalRes:', evalRes);
  console.log(JSON.stringify(evalRes.result?.value, null, 2));
  ws.close();
}

check().catch(console.error);
