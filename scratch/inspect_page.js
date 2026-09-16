import WebSocket from 'ws';

async function run() {
  const tabs = await fetch('http://127.0.0.1:9222/json/list').then(r => r.json());
  const tab = tabs.find(t => t.url.includes('myjino.ru'));
  if (!tab) return;
  const ws = new WebSocket(tab.webSocketDebuggerUrl);
  await new Promise(resolve => ws.on('open', resolve));

  function sendCommand(method, params = {}) {
    return new Promise((resolve, reject) => {
      const id = Math.floor(Math.random() * 100000);
      const handler = (data) => {
        const msg = JSON.parse(data.toString());
        if (msg.id === id) {
          ws.off('message', handler);
          if (msg.error) reject(msg.error);
          else resolve(msg.result);
        }
      };
      ws.on('message', handler);
      ws.send(JSON.stringify({ id, method, params }));
    });
  }

  ws.on('message', (data) => {
    const msg = JSON.parse(data.toString());
    if (msg.method?.startsWith('Network.')) {
      console.log('NET EVENT:', msg.method, msg.params?.errorText || msg.params?.response?.status || '');
    }
  });

  await sendCommand('Network.enable');

  await sendCommand('Runtime.evaluate', {
    expression: `fetch('/api/auth/status')`
  });

  await new Promise(r => setTimeout(r, 2000));
  ws.close();
}

run().catch(console.error);
