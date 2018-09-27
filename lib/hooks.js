"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const jsonpatch_1 = require("./jsonpatch");
const zlib = require("zlib");
const http_request_1 = require("./http-request");
const helper_1 = require("./helper");
let parseTiersRequest = (req) => {
    const res = {
        entityName: '',
        thematique: '',
        entityId: '',
        method: req.method || '',
        base: ''
    };
    let url = req.url || '';
    let ii = url.indexOf('?');
    if (ii > 0)
        url = url.substring(0, ii - 1);
    const segments = url.split('/');
    let rti = segments.indexOf('referentiel-tiers');
    rti++;
    rti++;
    res.entityName = segments[rti];
    res.base = segments.slice(0, rti).join('/');
    rti++;
    if (res.entityName === 'thematiques') {
        res.thematique = segments[rti];
        rti++;
    }
    res.entityId = segments[rti] || '';
    return res;
};
const filterHooks = (method, request, webhooks) => {
    const res = [];
    webhooks.forEach((webhook) => {
        if (webhook.topic.indexOf(method + '+*/' + request.entityName) === 0)
            res.push(webhook);
    });
    return res;
};
const patchOrigin = (tiersHeaders, errorHeaders) => {
    if (tiersHeaders['access-control-allow-origin'])
        errorHeaders['access-control-allow-origin'] = tiersHeaders['access-control-allow-origin'];
};
function canHookRequest(req, config) {
    const tiersService = parseTiersRequest(req);
    if (tiersService.entityName === 'tiers' && tiersService.entityId === 'similar')
        return false;
    if (!config.webhooks || !config.webhooks.length)
        return false;
    const webHooks = filterHooks(req.method || '', parseTiersRequest(req), config.webhooks);
    return webHooks.length > 0;
}
exports.canHookRequest = canHookRequest;
async function hookRequest(req, res, config) {
    console.log(req.method + ' ' + req.url);
    const tiersService = parseTiersRequest(req);
    const isPost = (req.method === 'POST');
    const isDelete = (req.method === 'DELETE');
    const isTiers = (tiersService.entityName === 'tiers');
    const webHooks = filterHooks(req.method || '', parseTiersRequest(req), config.webhooks);
    const payload = await _readData(req);
    let tiersId = tiersService.entityId || payload.id;
    const original = (req.method !== 'POST') ?
        await _execGet(req, '', tiersId, tiersService, config) : null;
    if (original && original.statusCode >= 400) {
        _writeResponse(res, original);
        return;
    }
    let tiersResponse = original;
    if (!isTiers) {
        tiersResponse = await _execGet(req, tiersService.base + '/tiers/' + tiersId, tiersId, tiersService, config);
        if (tiersResponse && tiersResponse.statusCode >= 400) {
            _writeResponse(res, tiersResponse);
            return;
        }
    }
    const requestResponse = await _forwardRequest(req, payload, config);
    if (!tiersId)
        tiersId = requestResponse.body.reference;
    if (requestResponse && requestResponse.statusCode >= 400) {
        _writeResponse(res, requestResponse);
        return;
    }
    const current = isDelete ? null : await _execGet(req, '', tiersId, tiersService, config);
    if (current && current.statusCode >= 400) {
        _writeResponse(res, current);
        return;
    }
    if (isTiers && current && (['BLOCKED', 'SUPPORTED'].indexOf(current.body.status) < 0)) {
        // No webHooks
    }
    else if (!isTiers && tiersResponse && (['BLOCKED', 'SUPPORTED'].indexOf(tiersResponse.body.status) < 0)) {
        // No webHooks
    }
    else {
        for (const webHook of webHooks) {
            const opts = {
                method: webHook.method,
                headers: {
                    'Accept': 'application/json',
                    'content-type': 'application/json'
                },
                data: requestResponse.body,
            };
            const hookRes = await http_request_1.request(webHook.callback, opts);
            console.log(hookRes);
            if (hookRes.statusCode >= 400) {
                console.error(webHook.callback);
                console.error(hookRes);
                // do rollback
                if (original && current && original.body) {
                    const originalBody = original.body;
                    delete originalBody.date;
                    const modifiedBody = current.body;
                    delete modifiedBody.date;
                    const patches = jsonpatch_1.compare(modifiedBody, originalBody);
                    if (patches.length) {
                        const pr = await _execPatch(req, tiersId, tiersService, patches, config);
                    }
                }
                else if (!original && isPost) {
                    // Remove tiers
                    if (isTiers) {
                        const dr = await _execDelete(req, tiersId, tiersService, config);
                    }
                }
                // send error to client
                const options = {
                    statusCode: hookRes.statusCode,
                    headers: {
                        'content-type': hookRes.headers['content-type']
                    },
                    body: hookRes.body
                };
                patchOrigin(requestResponse.headers, options.headers);
                _writeResponse(res, options);
                return;
            }
        }
    }
    // send back to client
    _writeResponse(res, requestResponse);
}
exports.hookRequest = hookRequest;
async function _readData(req) {
    if (['POST', 'PATCH', 'PUT'].indexOf(req.method || '') >= 0)
        return new Promise((resolve, reject) => {
            let body = '';
            req.on('data', chunk => {
                body += chunk.toString();
            });
            req.on('end', () => {
                try {
                    body = JSON.parse(body);
                }
                catch (e) {
                }
                resolve(body);
            });
        });
    else
        return null;
}
async function _execGet(req, uri, tiersId, tiersRequest, config) {
    const opts = {
        method: 'GET',
        headers: helper_1.clone(req.headers),
        data: null
    };
    delete opts.headers['content-length'];
    delete opts.headers['content-type'];
    delete opts.headers['host'];
    delete opts.headers['origin'];
    delete opts.headers['user-agent'];
    delete opts.headers['referer'];
    delete opts.headers['connection'];
    let url = config.host + (uri || req.url);
    if (!tiersRequest.entityId && !uri)
        url = url + '/' + tiersId;
    const res = await http_request_1.request(url, opts);
    return res;
}
async function _execPatch(req, tiersId, tiersRequest, patches, config) {
    const opts = {
        method: 'PATCH',
        headers: helper_1.clone(req.headers),
        data: patches
    };
    opts.headers['content-type'] = 'application/json';
    delete opts.headers['content-length'];
    delete opts.headers['host'];
    delete opts.headers['origin'];
    delete opts.headers['user-agent'];
    delete opts.headers['referer'];
    delete opts.headers['connection'];
    let url = config.host + req.url;
    if (!tiersRequest.entityId)
        url = url + '/' + tiersId;
    const res = await http_request_1.request(url, opts);
    return res;
}
async function _execDelete(req, tiersId, tiersRequest, config) {
    const opts = {
        method: 'DELETE',
        headers: helper_1.clone(req.headers),
        data: null
    };
    delete opts.headers['content-type'];
    delete opts.headers['content-length'];
    delete opts.headers['host'];
    delete opts.headers['origin'];
    delete opts.headers['user-agent'];
    delete opts.headers['referer'];
    delete opts.headers['connection'];
    let url = config.host + req.url;
    if (!tiersRequest.entityId)
        url = url + '/' + tiersId;
    const res = await http_request_1.request(url, opts);
    return res;
}
function _writeResponse(res, data) {
    Object.keys(data.headers).forEach(header => {
        if (header !== 'content-length')
            res.setHeader(header, data.headers[header]);
    });
    res.statusCode = data.statusCode;
    let output = res;
    if (data.body) {
        let bodyString = (typeof data.body === 'object' ? JSON.stringify(data.body) : data.body);
        const contentEncoding = data.headers['content-encoding'];
        if (contentEncoding === 'gzip') {
            output = zlib.createGzip();
            output.pipe(res);
        }
        else if (contentEncoding === 'deflate') {
            output = zlib.createDeflate();
            output.pipe(res);
        }
        output.write(bodyString);
    }
    output.end();
}
async function _forwardRequest(req, payload, config) {
    const opts = {
        method: req.method || '',
        headers: helper_1.clone(req.headers),
        data: null
    };
    delete opts.headers['host'];
    delete opts.headers['origin'];
    delete opts.headers['user-agent'];
    delete opts.headers['referer'];
    delete opts.headers['connection'];
    opts.data = payload;
    const res = await http_request_1.request(config.host + req.url, opts);
    return res;
}
