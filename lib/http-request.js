"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const url = require("url");
const zlib = require("zlib");
const httpUtils = require("http");
const httpsUtils = require("https");
const helper_1 = require("./helper");
exports.request = (uri, options) => {
    const pUrl = url.parse(uri);
    let port = pUrl.port;
    if (!port) {
        if (pUrl.protocol === 'http:')
            port = '80';
        else
            port = '445';
    }
    const dataString = options.data ? (typeof options.data === 'object' ? JSON.stringify(options.data) : options.data) : '';
    let requestOptions = {
        method: options.method,
        protocol: pUrl.protocol,
        hostname: pUrl.hostname,
        port: parseInt(port, 10),
        path: pUrl.path,
        headers: options.headers
    };
    return new Promise((resolve, reject) => {
        const request = pUrl.protocol === 'https:' ? httpsUtils.request : httpUtils.request;
        const clientRequest = request(requestOptions, (res) => {
            let responseContent = res;
            const zlibOptions = {
                flush: zlib.Z_SYNC_FLUSH,
                finishFlush: zlib.Z_SYNC_FLUSH
            };
            const contentEncoding = res.headers['content-encoding'];
            if (contentEncoding === 'gzip') {
                responseContent = zlib.createGunzip(zlibOptions);
                res.pipe(responseContent);
            }
            else if (contentEncoding === 'deflate') {
                responseContent = zlib.createInflate(zlibOptions);
                res.pipe(responseContent);
            }
            else
                res.setEncoding('utf-8');
            let body = '';
            responseContent.on('data', (chunk) => {
                body += chunk.toString();
            });
            responseContent.on('end', () => {
                let bodyJSON = null;
                if (body) {
                    try {
                        bodyJSON = JSON.parse(body);
                    }
                    catch (e) {
                    }
                }
                resolve({
                    body: bodyJSON ? bodyJSON : body,
                    headers: helper_1.clone(res.headers),
                    statusCode: res.statusCode
                });
            });
        });
        // clientRequest.setTimeout(10000, () => {
        //     resolve({ body: 'Can\'t connect to ' + uri, headers: {}, statusCode: 500 });
        // })
        clientRequest.on('error', (err) => {
            resolve({ body: null, headers: {}, statusCode: 500 });
        });
        if (dataString)
            clientRequest.write(dataString);
        clientRequest.end();
    });
};
