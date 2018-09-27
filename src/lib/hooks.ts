import * as  http from 'http';
import { compare } from './jsonpatch';
import * as zlib from 'zlib';
import { request } from './http-request';

import { clone } from './helper';




let parseTiersRequest = (req: http.IncomingMessage): { entityName: string, thematique: string, entityId: string, method: string, base: string } => {
    const res = {
        entityName: '',
        thematique: '',
        entityId: '',
        method: req.method || '',
        base: ''
    };
    let url: string = req.url || '';
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
}

const filterHooks = (
    method: string,
    request: { entityName: string, thematique: string, entityId: string, method: string },
    webhooks: { method: string, topic: string, callback: string }[]
): { method: string, topic: string, callback: string }[] => {
    const res: { method: string, topic: string, callback: string }[] = [];
    webhooks.forEach((webhook: any) => {
        if (webhook.topic.indexOf(method + '+*/' + request.entityName) === 0)
            res.push(webhook);
    });
    return res;

}

const patchOrigin = (tiersHeaders: any, errorHeaders: any) => {
    if (tiersHeaders['access-control-allow-origin'])
        errorHeaders['access-control-allow-origin'] = tiersHeaders['access-control-allow-origin'];
}

export function canHookRequest(req: http.IncomingMessage, config: any): boolean {
    const tiersService = parseTiersRequest(req);
    if (tiersService.entityName === 'tiers' && tiersService.entityId === 'similar') return false;
    if (!config.webhooks || !config.webhooks.length)
        return false
    const webHooks = filterHooks(req.method || '', parseTiersRequest(req), config.webhooks);
    return webHooks.length > 0;
}


export async function hookRequest(req: http.IncomingMessage, res: http.ServerResponse, config: any): Promise<void> {
    console.log(req.method + ' ' + req.url);
    const tiersService = parseTiersRequest(req);
    const isPost = (req.method === 'POST');
    const isDelete = (req.method === 'DELETE');
    const isTiers = (tiersService.entityName === 'tiers');
    const webHooks = filterHooks(req.method || '', parseTiersRequest(req), config.webhooks);
    const payload = await _readData(req);
    let tiersId = tiersService.entityId || payload.id;

    const original: { body: any, headers: any, statusCode: number } | null = (req.method !== 'POST') ?
        await _execGet(req, '', tiersId, tiersService, config) : null;
    if (original && original.statusCode >= 400) {
        _writeResponse(res, original);
        return;
    }
    let tiersResponse: any = original;
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
    const current: { body: any, headers: any, statusCode: number } | null = isDelete ? null : await _execGet(req, '', tiersId, tiersService, config);
    if (current && current.statusCode >= 400) {
        _writeResponse(res, current);
        return;
    }
    if (isTiers && current && (['BLOCKED', 'SUPPORTED'].indexOf(current.body.status) < 0)) {
        // No webHooks
    } else if (!isTiers && tiersResponse && (['BLOCKED', 'SUPPORTED'].indexOf(tiersResponse.body.status) < 0)) {
        // No webHooks
    } else {
        for (const webHook of webHooks) {
            const opts = {
                method: webHook.method,
                headers: {
                    'Accept': 'application/json',
                    'content-type': 'application/json'
                },
                data: requestResponse.body,
            }
            const hookRes = await request(webHook.callback, opts);
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
                    const patches = compare(modifiedBody, originalBody);
                    if (patches.length) {
                        const pr = await _execPatch(req, tiersId, tiersService, patches, config)
                    }
                } else if (!original && isPost) {
                    // Remove tiers
                    if (isTiers) {
                        const dr = await _execDelete(req, tiersId, tiersService, config)
                    }

                }
                // send error to client
                const options = {
                    statusCode: hookRes.statusCode,
                    headers: {
                        'content-type': hookRes.headers['content-type']
                    },
                    body: hookRes.body
                }
                patchOrigin(requestResponse.headers, options.headers);
                _writeResponse(res, options);
                return;

            }
        }
    }

    // send back to client
    _writeResponse(res, requestResponse);
}

async function _readData(req: http.IncomingMessage): Promise<any> {
    if (['POST', 'PATCH', 'PUT'].indexOf(req.method || '') >= 0)
        return new Promise((resolve, reject) => {
            let body: any = '';
            req.on('data', chunk => {
                body += chunk.toString();
            });
            req.on('end', () => {
                try {
                    body = JSON.parse(body)
                } catch (e) {
                }
                resolve(body);
            });
        });
    else
        return null;
}

async function _execGet(req: http.IncomingMessage, uri: string, tiersId: string, tiersRequest: { entityName: string, thematique: string, entityId: string, method: string }, config: any): Promise<{ body: any, headers: any, statusCode: number }> {
    const opts = {
        method: 'GET',
        headers: clone(req.headers),
        data: null
    }
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
    const res = await request(url, opts);
    return res;
}

async function _execPatch(req: http.IncomingMessage, tiersId: string, tiersRequest: { entityName: string, thematique: string, entityId: string, method: string }, patches: any[], config: any): Promise<{ body: any, headers: any, statusCode: number }> {
    const opts = {
        method: 'PATCH',
        headers: clone(req.headers),
        data: patches
    }
    opts.headers['content-type'] = 'application/json'
    delete opts.headers['content-length'];
    delete opts.headers['host'];
    delete opts.headers['origin'];
    delete opts.headers['user-agent'];
    delete opts.headers['referer'];
    delete opts.headers['connection'];

    let url = config.host + req.url;
    if (!tiersRequest.entityId)
        url = url + '/' + tiersId;
    const res = await request(url, opts);
    return res;
}

async function _execDelete(req: http.IncomingMessage, tiersId: string, tiersRequest: { entityName: string, thematique: string, entityId: string, method: string }, config: any): Promise<{ body: any, headers: any, statusCode: number }> {
    const opts = {
        method: 'DELETE',
        headers: clone(req.headers),
        data: null
    }
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
    const res = await request(url, opts);
    return res;
}



function _writeResponse(res: http.ServerResponse, data: { body: any, headers: any, statusCode: number }) {
    Object.keys(data.headers).forEach(header => {
        if (header !== 'content-length')
            res.setHeader(header, data.headers[header]);
    });
    res.statusCode = data.statusCode;
    let output: any = res;
    if (data.body) {
        let bodyString = (typeof data.body === 'object' ? JSON.stringify(data.body) : data.body)
        const contentEncoding = data.headers['content-encoding'];
        if (contentEncoding === 'gzip') {
            output = zlib.createGzip();
            output.pipe(res);
        } else if (contentEncoding === 'deflate') {
            output = zlib.createDeflate();
            output.pipe(res);
        }
        output.write(bodyString);
    }
    output.end();
}




async function _forwardRequest(req: http.IncomingMessage, payload: any, config: any): Promise<{ body: any, headers: any, statusCode: number }> {
    const opts = {
        method: req.method || '',
        headers: clone(req.headers),
        data: null
    }
    delete opts.headers['host'];
    delete opts.headers['origin'];
    delete opts.headers['user-agent'];
    delete opts.headers['referer'];
    delete opts.headers['connection'];

    opts.data = payload;
    const res = await request(config.host + req.url, opts);
    return res;
}

