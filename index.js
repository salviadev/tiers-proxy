"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const util = require("util");
const http = require("http");
const fs = require("fs");
const winston = require("winston");
const DailyRotateFile = require("winston-daily-rotate-file");
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
if (cfg.log && (cfg.log.error || cfg.log.info)) {
    const infoTransport = new DailyRotateFile({
        json: false,
        format: winston.format.printf((info) => {
            if (info.error)
                return '';
            return info.message || '';
        }),
        level: 'info',
        dirname: './logs',
        filename: 'proxy-tiers-logs-%DATE%.csv',
        datePattern: 'YYYY-MM-DD-HH',
        zippedArchive: false,
        maxSize: '20m',
        maxFiles: '14d'
    });
    const errorTransport = new DailyRotateFile({
        format: winston.format.json(),
        level: 'error',
        dirname: './logs',
        filename: 'proxy-tiers-errors-%DATE%.log',
        datePattern: 'YYYY-MM-DD-HH',
        zippedArchive: false,
        maxSize: '20m',
        maxFiles: '14d'
    });
    hooks_1.logger.instance = winston.createLogger({
        transports: [
            infoTransport,
            errorTransport
        ]
    });
}
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
