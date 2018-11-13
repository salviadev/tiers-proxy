"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const util = require("util");
const http = require("http");
const path = require("path");
const fs = require("fs");
const url = require("url");
const httpProxy = require("http-proxy");
const helper_1 = require("./lib/helper");
const winston = require("winston");
const DailyRotateFile = require("winston-daily-rotate-file");
const hooks_1 = require("./lib/hooks");
const proxy = httpProxy.createProxyServer();
let cfg = {};
const pathToConfig = path.join(__dirname, 'config.js');
if (fs.existsSync(pathToConfig)) {
    // tslint:disable-next-line:no-var-requires
    cfg = require(pathToConfig);
}
const port = process.env.PORT || process.env.REVERSE_PROXY_PORT || cfg.port || 7500;
const host = process.env.REFERENTIEL_TIERS_ADDRESS || (cfg.server && cfg.server.host ? cfg.server.host : '');
cfg.host = host;
if (cfg.webhooks) {
    const nwb = { $all: [] };
    cfg.webhooks.forEach((wb) => {
        if (!wb.topic)
            return;
        const i = wb.topic.indexOf('*/');
        if (i <= 0)
            return;
        const after = wb.topic.substr(i + 2);
        const before = wb.topic.substr(0, i + 2);
        const segments = after.split('/');
        if (segments[0] === 'tiers' || segments[0] === 'thematiques') {
            nwb.$all.push(wb);
            return;
        }
        if (segments.lenth < 2)
            throw `Invalid topic ${wb.topic}.`;
        const tenant = segments.shift();
        wb.topic = before + segments.join('/');
        nwb[tenant] = nwb[tenant] || [];
        nwb[tenant].push(wb);
    });
    cfg.webhooks = nwb;
    Object.keys(cfg.webhooks).forEach(tenant => {
        const whTenant = cfg.webhooks[tenant];
        const expandwhTenant = [];
        whTenant.forEach((item) => {
            const topic = item.topic;
            if (topic) {
                const idx = topic.indexOf('+');
                if (idx > 0) {
                    const methods = topic.substr(0, idx);
                    methods.split(',').forEach(method => {
                        method = method.trim().toUpperCase();
                        const ni = helper_1.clone(item);
                        expandwhTenant.push(ni);
                        ni.topic = method + topic.substr(idx);
                    });
                }
            }
        });
        cfg.webhooks[tenant] = expandwhTenant;
    });
}
const referentielTiersRoute = 'referentiel-tiers';
if (cfg.log && cfg.log.level && cfg.log.level !== 'none') {
    const infoTransport = new DailyRotateFile({
        json: false,
        format: winston.format.printf((info) => {
            if (info.error)
                return '';
            return info.message || '';
        }),
        level: 'info',
        dirname: cfg.log && cfg.log.directory ? cfg.log.directory : path.join(__dirname, 'logs'),
        filename: 'proxy-tiers-logs-%DATE%.csv',
        datePattern: 'YYYY-MM-DD',
        zippedArchive: false,
        maxSize: '20m',
        maxFiles: '14d'
    });
    const errorTransport = new DailyRotateFile({
        format: winston.format.json(),
        level: 'error',
        dirname: cfg.log && cfg.log.directory ? cfg.log.directory : path.join(__dirname, 'logs'),
        filename: 'proxy-tiers-errors-%DATE%.log',
        datePattern: 'YYYY-MM-DD',
        zippedArchive: false,
        maxSize: '20m',
        maxFiles: '14d'
    });
    const transports = [];
    if (['info'].indexOf(cfg.log.level) >= 0)
        transports.push(infoTransport);
    if (['error', 'info'].indexOf(cfg.log.level) >= 0)
        transports.push(errorTransport);
    hooks_1.logger.instance = winston.createLogger({
        transports: transports
    });
}
function reverseProxy(route, req, res) {
    if (!req.method || req.method === 'GET' || req.method === 'OPTIONS' || !hooks_1.canHookRequest(req, cfg))
        proxy.web(req, res, { target: host, changeOrigin: true });
    else {
        const logInfo = {
            method: req.method || '',
            url: req.url || '',
            reference: '',
            referenceAdministrative: '',
            errorMessage: '',
            written: false,
            statusCode: 200
        };
        hooks_1.hookRequest(req, res, cfg, logInfo).then(() => {
            hooks_1.log('info', logInfo.method, logInfo.url, '', logInfo, null, null);
        }).catch((e) => {
            logInfo.errorMessage = e.message;
            res.statusCode = 500;
            hooks_1.log('error', logInfo.method, logInfo.url, '', logInfo, null, null);
            res.setHeader('content-type', 'application/json');
            res.setHeader('access-control-allow-origin', '*');
            res.write(JSON.stringify({ error: { message: e.message, detail: e.stack ? e.stack.split('\n') : '' } }));
            res.statusCode = 500;
            res.end();
        });
    }
}
proxy.on('proxyRes', (proxyRes, req, res) => {
    delete proxyRes.headers['x-frame-options'];
});
const server = http.createServer((req, res) => {
    const uri = req.url || '';
    const parsedUrl = url.parse(uri);
    let pathUrl = parsedUrl.href || '';
    const search = '/' + referentielTiersRoute + '/';
    const i = pathUrl.indexOf(search);
    if (i >= 0) {
        pathUrl = pathUrl.substr(i);
        req.url = url.format(pathUrl);
        reverseProxy(referentielTiersRoute, req, res);
    }
    else {
        res.writeHead(404, { 'Content-Type': 'text/plain' });
        res.end(util.format('Not found %s %s.', req.method, pathUrl));
    }
});
server.listen(port, () => {
    console.log(util.format('Tiers reverse proxy (Tiers host = %s) started at %d', host, port));
});
