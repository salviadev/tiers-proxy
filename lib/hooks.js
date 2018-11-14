"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const jsonpatch_1 = require("./jsonpatch");
const zlib = require("zlib");
const http_request_1 = require("./http-request");
const helper_1 = require("./helper");
exports.logger = { instance: null, errors: false, info: false };
function canHookRequest(req, config) {
    const tiersRequest = parseTiersRequest(req);
    const isPost = (req.method === 'POST' || req.method === 'PUT');
    if (!isPost && !tiersRequest.entityId)
        return false;
    if (!tiersRequest.entityName)
        return false;
    if (tiersRequest.entityName === 'tiers' && tiersRequest.entityId === 'similar')
        return false;
    if (!config.webhooks)
        return false;
    const webHooks = filterHooks(tiersRequest, config.webhooks);
    return webHooks.length > 0;
}
exports.canHookRequest = canHookRequest;
const sopCookies = {};
async function hookRequest(req, res, config, logInfo) {
    const tiersRequest = parseTiersRequest(req);
    const isPost = (req.method === 'POST');
    const isPut = (req.method === 'PUT');
    logInfo.url = req.url || '';
    logInfo.method = req.method || 'method';
    const isDelete = (req.method === 'DELETE');
    const isTiers = (tiersRequest.entityName === 'tiers');
    const webHooks = filterHooks(tiersRequest, config.webhooks);
    const payload = await readRequestData(req);
    let tiersId = tiersRequest.entityId || payload.reference;
    logInfo.reference = tiersId;
    let original = tiersRequest.entityId ?
        await getTiersOrThematique(req, '', tiersId, tiersRequest, config) : null;
    if (isTiers && original) {
        logInfo.referenceAdministrative = original.body.referenceAdministrative;
    }
    if (original && original.statusCode >= 400) {
        if (original.statusCode === 404) {
            if (isPost) {
                original = null;
            }
            else if (isDelete) {
                original.body = '';
                original.statusCode = 200;
                patchOriginHeaders(original.headers);
                writeResponse(res, original);
                return;
            }
            else {
                patchOriginHeaders(original.headers);
                writeResponse(res, original);
                return;
            }
            return;
        }
        logInfo.statusCode = original.statusCode;
        exports.log('error', original.method, original.url, 'Service Tiers (Get Original object)', logInfo, null, original.body);
        patchOriginHeaders(original.headers);
        writeResponse(res, original);
        return;
    }
    let tiersResponse = original;
    if (!isTiers) {
        tiersResponse = await getTiersOrThematique(req, tiersRequest.base + '/tiers/' + tiersId, tiersId, tiersRequest, config);
        if (tiersResponse && tiersResponse.statusCode >= 400) {
            logInfo.statusCode = tiersResponse.statusCode;
            exports.log('error', tiersResponse.method, tiersResponse.url, 'Service Tiers (Get Tiers)', logInfo, null, tiersResponse.body);
            patchOriginHeaders(tiersResponse.headers);
            writeResponse(res, tiersResponse);
            return;
        }
    }
    if (tiersResponse) {
        logInfo.reference = tiersResponse.body.reference;
        logInfo.referenceAdministrative = tiersResponse.body.referenceAdministrative;
    }
    const requestResponse = await sendRequestToRefTiers(req, payload, config, logInfo);
    if (!tiersId && requestResponse.body) {
        tiersId = requestResponse.body.reference;
        logInfo.reference = requestResponse.body.reference;
        logInfo.referenceAdministrative = requestResponse.body.referenceAdministrative;
    }
    if (requestResponse && requestResponse.statusCode >= 400) {
        logInfo.statusCode = requestResponse.statusCode;
        exports.log('error', requestResponse.method, requestResponse.url, 'Service Tiers (Forward)', logInfo, payload, requestResponse.body);
        patchOriginHeaders(requestResponse.headers);
        writeResponse(res, requestResponse);
        return;
    }
    const current = isDelete ? null : await getTiersOrThematique(req, '', tiersId, tiersRequest, config);
    if (current && current.statusCode >= 400) {
        logInfo.statusCode = current.statusCode;
        exports.log('error', current.method, current.url, 'Service Tiers (Get Modified object)', logInfo, null, current.body);
        patchOriginHeaders(current.headers);
        writeResponse(res, current);
        return;
    }
    if (isTiers && current && (['BLOCKED', 'SUPPORTED'].indexOf(current.body.status) < 0)) {
        // No webHooks
    }
    else if (!isTiers && tiersResponse && (['BLOCKED', 'SUPPORTED'].indexOf(tiersResponse.body.status) < 0)) {
        // No webHooks
    }
    else {
        const cookieKey = tiersRequest.tenant;
        for (const webHook of webHooks) {
            const opts = {
                method: webHook.method,
                headers: {
                    'accept': 'application/json',
                    'content-type': 'application/json'
                },
                data: requestResponse.body,
            };
            const callback = webHook.callback.replace(/\{tenant\}/g, tiersRequest.tenant);
            const isSpo = callback.indexOf('/ServiceWCF.svc/');
            if (isSpo) {
                if (sopCookies[cookieKey]) {
                    opts.headers.cookie = sopCookies[cookieKey];
                }
            }
            const hookRes = await http_request_1.request(callback, opts);
            if (hookRes.statusCode >= 400) {
                logInfo.statusCode = hookRes.statusCode;
                exports.log('error', hookRes.method, hookRes.url, 'Wehook error (Tiers propagation)', logInfo, requestResponse.body, hookRes.body);
                // do rollback
                if (original && current && original.body) {
                    const originalBody = original.body;
                    delete originalBody.date;
                    const modifiedBody = current.body;
                    delete modifiedBody.date;
                    const patches = jsonpatch_1.compare(modifiedBody, originalBody);
                    if (patches.length) {
                        await patchTiersOrThematique(req, tiersId, tiersRequest, patches, config, logInfo);
                    }
                }
                else if (!original && isPost) {
                    // Remove tiers
                    if (isTiers) {
                        await deleteTiers(req, tiersId, tiersRequest, config, logInfo);
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
                patchOriginHeaders(options.headers);
                writeResponse(res, options);
                return;
            }
            if (isSpo) {
                if (hookRes.headers['set-cookie'])
                    sopCookies[cookieKey] = hookRes.headers['set-cookie'].map((cookie) => {
                        return cookie.split(';')[0];
                    }).join('; ');
            }
        }
    }
    // send back to client
    patchOriginHeaders(requestResponse.headers);
    writeResponse(res, requestResponse);
}
exports.hookRequest = hookRequest;
const escapeString = (value) => {
    value = value || '';
    value.replace(/\"/g, '""');
    value = '"' + value + '"';
    return value;
};
exports.log = (level, method, url, message, logInfo, requestBody, responseBody) => {
    if (!exports.logger.instance)
        return;
    if (!logInfo) {
        exports.logger.instance.info(level);
        return;
    }
    const line = [];
    if (!logInfo.errorMessage && responseBody) {
        logInfo.errorMessage = typeof responseBody === 'object' ? JSON.stringify(responseBody) : responseBody;
    }
    if (!logInfo.written) {
        logInfo.written = true;
        line.push(new Date().toISOString());
        line.push(escapeString(level));
        line.push(escapeString(method + ' ' + url));
        line.push(escapeString(logInfo.statusCode + ''));
        line.push(escapeString(logInfo.reference));
        line.push(escapeString(logInfo.referenceAdministrative));
        line.push(escapeString(logInfo.errorMessage));
        exports.logger.instance.info(line.join(';'));
    }
    if (level === 'error' && (requestBody || responseBody)) {
        exports.logger.instance.error({
            message: method + ' ' + url,
            level: level,
            requestBody: requestBody || null,
            responseBody: responseBody || null,
            error: true,
        });
    }
};
const parseTiersRequest = (req) => {
    const res = {
        entityName: '',
        thematique: '',
        entityId: '',
        tenant: '',
        method: req.method || '',
        base: ''
    };
    let url = req.url || '';
    const ii = url.indexOf('?');
    if (ii > 0)
        url = url.substring(0, ii - 1);
    const segments = url.split('/');
    let rti = segments.indexOf('referentiel-tiers');
    if (rti < 0)
        return res;
    rti++;
    res.tenant = segments[rti];
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
const filterHooks = (requestInfo, webhooks) => {
    const res = [];
    if (webhooks[requestInfo.tenant]) {
        webhooks[requestInfo.tenant].forEach((webhook) => {
            if (webhook.topic.indexOf(requestInfo.method + '+*/' + requestInfo.entityName) === 0)
                res.push(webhook);
        });
    }
    if (webhooks.$all) {
        webhooks.$all.forEach((webhook) => {
            if (webhook.topic.indexOf(requestInfo.method + '+*/' + requestInfo.entityName) === 0)
                res.push(webhook);
        });
    }
    return res;
};
const patchOriginHeaders = (headers) => {
    if (!headers['access-control-allow-origin'])
        headers['access-control-allow-origin'] = '*';
};
const readRequestData = async (req) => {
    if (['POST', 'PATCH', 'PUT'].indexOf(req.method || '') >= 0)
        return new Promise((resolve, reject) => {
            let body = '';
            req.on('data', chunk => {
                body += chunk.toString();
            });
            req.on('end', () => {
                try {
                    body = JSON.parse(body);
                    // tslint:disable-next-line:no-empty
                }
                catch (e) { }
                resolve(body);
            });
        });
    else
        return null;
};
const getTiersOrThematique = async (req, uri, tiersId, tiersRequest, config) => {
    const newLocal = null;
    const opts = {
        method: 'GET',
        headers: helper_1.clone(req.headers),
        data: newLocal
    };
    delete opts.headers['content-length'];
    delete opts.headers['content-type'];
    delete opts.headers.host;
    delete opts.headers.origin;
    delete opts.headers['user-agent'];
    delete opts.headers.referer;
    delete opts.headers.connection;
    let url = config.host + (uri || req.url);
    if (!tiersRequest.entityId && !uri)
        url = url + '/' + tiersId;
    const res = await http_request_1.request(url, opts);
    return res;
};
const patchTiersOrThematique = async (req, tiersId, tiersRequest, patches, config, logInfo) => {
    const opts = {
        method: 'PATCH',
        headers: helper_1.clone(req.headers),
        data: patches
    };
    opts.headers['content-type'] = 'application/json';
    delete opts.headers['content-length'];
    delete opts.headers.host;
    delete opts.headers.origin;
    delete opts.headers['user-agent'];
    delete opts.headers.referer;
    delete opts.headers.connection;
    let url = config.host + req.url;
    if (!tiersRequest.entityId)
        url = url + '/' + tiersId;
    const res = await http_request_1.request(url, opts);
    if (res.statusCode >= 400 && res.statusCode !== 404 && res.statusCode !== 409) {
        res.statusCode = res.statusCode;
        exports.log('error', opts.method, url, 'Tiers (Rollback Failed)', logInfo, opts.data, res.body);
    }
    return res;
};
const deleteTiers = async (req, tiersId, tiersRequest, config, logInfo) => {
    const opts = {
        method: 'PATCH',
        headers: helper_1.clone(req.headers),
        data: [{ op: 'replace', path: '/status', value: 'TEMPORARY' }, { op: 'replace', path: '/active', value: false }]
    };
    delete opts.headers['content-type'];
    delete opts.headers['content-length'];
    delete opts.headers.host;
    delete opts.headers.origin;
    delete opts.headers['user-agent'];
    delete opts.headers.referer;
    delete opts.headers.connection;
    opts.headers['content-type'] = 'application/json';
    let url = config.host + req.url;
    if (!tiersRequest.entityId)
        url = url + '/' + tiersId;
    const res = await http_request_1.request(url, opts);
    if (res.statusCode >= 400 && res.statusCode !== 404 && res.statusCode !== 409) {
        exports.log('error', opts.method, url, 'Tiers (Rollback Failed)', logInfo, null, res.body);
    }
    return res;
};
const writeResponse = (res, data) => {
    Object.keys(data.headers).forEach(header => {
        if (header !== 'content-length' && data.headers[header])
            res.setHeader(header, data.headers[header]);
    });
    res.statusCode = data.statusCode;
    let output = res;
    if (data.body) {
        const bodyString = (typeof data.body === 'object' ? JSON.stringify(data.body) : data.body);
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
};
const sendRequestToRefTiers = async (req, payload, config, logInfo) => {
    const newLocal = null;
    const opts = {
        method: req.method || '',
        headers: helper_1.clone(req.headers),
        data: newLocal
    };
    delete opts.headers.host;
    delete opts.headers.origin;
    delete opts.headers['user-agent'];
    delete opts.headers.referer;
    delete opts.headers.connection;
    opts.data = payload;
    const res = await http_request_1.request(config.host + req.url, opts);
    return res;
};
