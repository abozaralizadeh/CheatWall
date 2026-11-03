// Recording helper only: forwards to the app on 3100 and drops the CSP header so the recorder overlay can draw.
import http from 'node:http';
http.createServer((req, res) => {
  const up = http.request({ host: '127.0.0.1', port: 3100, path: req.url, method: req.method, headers: req.headers }, (r) => {
    const h = { ...r.headers }; delete h['content-security-policy'];
    res.writeHead(r.statusCode, h); r.pipe(res);
  });
  req.pipe(up);
}).listen(3101, '127.0.0.1');
