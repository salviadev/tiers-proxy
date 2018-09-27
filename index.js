"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const util = require("util");
const http = require("http");
const fs = require("fs");
const hooks_1 = require("./lib/hooks");
const url = require('url');
const httpProxy = require('http-proxy');
const proxy = httpProxy.createProxyServer();
let cfg = {};
if (fs.existsSync('./config.json')) {
    cfg = JSON.parse(fs.readFileSync('./config.json').toString('utf8'));
}
const port = process.env.PORT || process.env.REVERSE_PROXY_PORT || cfg.port || 7500;
const host = process.env.REFERENTIEL_TIERS_ADDRESS || cfg.host || 'http://sercentos1';
cfg.host = host;
const referentielTiersRoute = 'referentiel-tiers';
function reverseProxy(route, req, res) {
    if (!req.method || req.method === 'GET' || req.method === 'OPTIONS' || !hooks_1.canHookRequest(req, cfg))
        proxy.web(req, res, { target: host, changeOrigin: true });
    else
        hooks_1.hookRequest(req, res, cfg).then(() => { }).catch((e) => {
            res.setHeader('content-type', 'application/json');
            res.write(JSON.stringify({ error: { message: e.message, detail: e.stack ? e.stack.split('\n') : '' } }));
            res.statusCode = 500;
            res.end();
        });
}
proxy.on('proxyRes', function (proxyRes, req, res) {
    delete proxyRes.headers['x-frame-options'];
});
proxy.on('proxyReq', function (proxyReq, req, res, options) {
    if (cfg.removeAcceptEncoding)
        proxyReq.removeHeader('Accept-Encoding');
});
const server = http.createServer((req, res) => {
    const uri = req.url || '';
    const path = url.parse(uri).pathname || '';
    const regex = new RegExp('^\/' + referentielTiersRoute + '\/.*');
    if (regex.test(path)) {
        reverseProxy(referentielTiersRoute, req, res);
    }
    else {
        res.writeHead(404, { 'Content-Type': 'text/plain' });
        res.end(util.format('Not found %s %s.', req.method, path));
    }
});
server.listen(port, () => {
    console.log(util.format('Tiers reverse proxy (Tiers host = %s) started at %d', host, port));
});
