import * as  http from 'http';
import { compare } from './jsonpatch';
import * as zlib from 'zlib';
import { request, RerquestInfo } from './http-request';
import { clone } from './helper';
import * as winston from 'winston';


export let logger: { instance: winston.Logger | null } = { instance: null };

export function canHookRequest(req: http.IncomingMessage, config: any): boolean {
    const tiersRequest = parseTiersRequest(req);
    const isPost = (req.method === 'POST' || req.method === 'PUT');
    if (!isPost && !tiersRequest.entityId) return false;
    if (!tiersRequest.entityName) return false;
    if (tiersRequest.entityName === 'tiers' && tiersRequest.entityId === 'similar') return false;
    if (!config.webhooks)
        return false
    const webHooks = filterHooks(tiersRequest, config.webhooks);
    return webHooks.length > 0;
}

const
    sopCookies: any = {};



export async function hookRequest(req: http.IncomingMessage, res: http.ServerResponse, config: any): Promise<void> {
    log('info', req.method || '', req.url || '', 'Tiers (Interception)');
    const tiersRequest = parseTiersRequest(req);
    const isPost = (req.method === 'POST');
    const isPut = (req.method === 'PUT');

    const isDelete = (req.method === 'DELETE');
    const isTiers = (tiersRequest.entityName === 'tiers');
    const webHooks = filterHooks(tiersRequest, config.webhooks);
    const payload = await readRequestData(req);
    let tiersId = tiersRequest.entityId || payload.reference;

    let original: RerquestInfo | null = tiersRequest.entityId ?
        await getTiersOrThematique(req, '', tiersId, tiersRequest, config) : null;
    if (original && original.statusCode >= 400) {
        if (original.statusCode === 404) {
            if (isPost) {
                original = null;
            } else if (isDelete) {
                original.body = '';
                original.statusCode = 200;
                writeResponse(res, original);
                return
            } else {
                writeResponse(res, original);
                return
            }
            return;
        }
        log('error', original.method, original.url, 'Service Tiers (Get Original object)', null, original.body);
        writeResponse(res, original);
        return;
    }
    let tiersResponse: any = original;
    if (!isTiers) {
        tiersResponse = await getTiersOrThematique(req, tiersRequest.base + '/tiers/' + tiersId, tiersId, tiersRequest, config);
        if (tiersResponse && tiersResponse.statusCode >= 400) {
            log('error', tiersResponse.method, tiersResponse.url, 'Service Tiers (Get Tiers)', null, tiersResponse.body);
            writeResponse(res, tiersResponse);
            return;
        }

    }
    const requestResponse = await sendRequestToRefTiers(req, payload, config);
    if (!tiersId)
        tiersId = requestResponse.body.reference;
    if (requestResponse && requestResponse.statusCode >= 400) {
        log('error', requestResponse.method, requestResponse.url, 'Service Tiers (Forward)', payload, requestResponse.body);
        writeResponse(res, requestResponse);
        return;
    }
    const current: RerquestInfo | null = isDelete ? null : await getTiersOrThematique(req, '', tiersId, tiersRequest, config);
    if (current && current.statusCode >= 400) {
        log('error', current.method, current.url, 'Service Tiers (Get Modified object)', null, current.body);
        writeResponse(res, current);
        return;
    }
    if (isTiers && current && (['BLOCKED', 'SUPPORTED'].indexOf(current.body.status) < 0)) {
        // No webHooks
    } else if (!isTiers && tiersResponse && (['BLOCKED', 'SUPPORTED'].indexOf(tiersResponse.body.status) < 0)) {
        // No webHooks
    } else {
        const cookieKey = tiersRequest.tenant;
        for (const webHook of webHooks) {
            const opts: any = {
                method: webHook.method,
                headers: {
                    'accept': 'application/json',
                    'content-type': 'application/json'
                },
                data: requestResponse.body,
            }
            const isSpo = webHook.callback.indexOf('/ServiceWCF.svc/');

            if (isSpo) {
                if (sopCookies[cookieKey]) {
                    opts.headers['cookie'] = sopCookies[cookieKey];
                }
            }
            const hookRes = await request(webHook.callback, opts);
            if (hookRes.statusCode >= 400) {
                log('error', hookRes.method, hookRes.url, 'Web book error (Tiers propagation)', requestResponse.body, hookRes.body);
                // do rollback
                if (original && current && original.body) {
                    const originalBody = original.body;
                    delete originalBody.date;
                    const modifiedBody = current.body;
                    delete modifiedBody.date;
                    const patches = compare(modifiedBody, originalBody);
                    if (patches.length) {
                        const pr = await patchTiersOrThematique(req, tiersId, tiersRequest, patches, config)
                    }
                } else if (!original && isPost) {
                    // Remove tiers
                    if (isTiers) {
                        const dr = await deleteTiersOrThematique(req, tiersId, tiersRequest, config)
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
                patchOriginHeaders(requestResponse.headers, options.headers);
                writeResponse(res, options);
                return;

            }
            if (isSpo) {
                if (hookRes.headers['set-cookie'])
                    sopCookies[cookieKey] = hookRes.headers['set-cookie'].map((cookie: string) => {
                        return cookie.split(';')[0];
                    }).join('; ');
            }
        }
    }

    // send back to client
    writeResponse(res, requestResponse);

}

const
    escapeString = (value: string): string => {
        value.replace(/\"/g, '""');
        value = '"' + value + '"';
        return value;
    };



const
    log = (level: 'info' | 'error', method: string, url: string, message: string, requestBody?: any, responseBody?: any) => {
        if (!logger.instance) return;
        let line: string[] = [];
        line.push(new Date().toISOString());
        line.push(escapeString(level));
        line.push(escapeString(method + ' ' + url));
        line.push(escapeString(message));
        logger.instance.info(line.join(';'));
        if (level === 'error') {
            logger.instance.error({
                message: method + ' ' + url,
                error: true,
                level: level,
                requestBody: requestBody || null,
                responseBody: responseBody || null
            });
        }
    };

const parseTiersRequest = (req: http.IncomingMessage): { entityName: string, thematique: string, entityId: string, method: string, base: string, tenant: string } => {
    const res = {
        entityName: '',
        thematique: '',
        entityId: '',
        tenant: '',
        method: req.method || '',
        base: ''
    };
    let url: string = req.url || '';
    let ii = url.indexOf('?');
    if (ii > 0)
        url = url.substring(0, ii - 1);
    const segments = url.split('/');
    let rti = segments.indexOf('referentiel-tiers');
    if (rti < 0) return res;
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

const
    filterHooks = (
        request: { tenant: string, entityName: string, thematique: string, entityId: string, method: string },
        webhooks: any): { method: string, topic: string, callback: string }[] => {
        const res: { method: string, topic: string, callback: string }[] = [];
        if (!webhooks[request.tenant]) return res;
        webhooks[request.tenant].forEach((webhook: any) => {
            if (webhook.topic.indexOf(request.method + '+*/' + request.entityName) === 0)
                res.push(webhook);
        });
        return res;
    };

const patchOriginHeaders = (tiersHeaders: any, errorHeaders: any) => {
    if (tiersHeaders['access-control-allow-origin'])
        errorHeaders['access-control-allow-origin'] = tiersHeaders['access-control-allow-origin'];
}

const
    readRequestData = async (req: http.IncomingMessage): Promise<any> => {
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
    };


const
    getTiersOrThematique = async (req: http.IncomingMessage, uri: string, tiersId: string,
        tiersRequest: { entityName: string, thematique: string, entityId: string, method: string },
        config: any): Promise<RerquestInfo> => {
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
    };

const
    patchTiersOrThematique = async (req: http.IncomingMessage, tiersId: string,
        tiersRequest: { entityName: string, thematique: string, entityId: string, method: string },
        patches: any[], config: any): Promise<RerquestInfo> => {
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
        log('info', opts.method, url, 'Tiers (Rollback)');
        const res = await request(url, opts);
        if (res.statusCode >= 400 && res.statusCode !== 404 && res.statusCode !== 409) {
            log('error', opts.method, url, 'Tiers (Rollback Failed)', opts.data, res.body);
        }
        return res;
    };

const
    deleteTiersOrThematique = async (req: http.IncomingMessage, tiersId: string,
        tiersRequest: { entityName: string, thematique: string, entityId: string, method: string },
        config: any): Promise<RerquestInfo> => {
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
        log('info', opts.method, url, 'Tiers (Rollback)');
        const res = await request(url, opts);
        if (res.statusCode >= 400 && res.statusCode !== 404 && res.statusCode !== 409) {
            log('error', opts.method, url, 'Tiers (Rollback Failed)', null, res.body);
        }
        return res;
    };

const
    writeResponse = (res: http.ServerResponse, data: { body: any, headers: any, statusCode: number }) => {
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
    };


const
    sendRequestToRefTiers = async (req: http.IncomingMessage, payload: any, config: any): Promise<RerquestInfo> => {
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
        log('info', opts.method, config.host + req.url, 'Tiers (Forward)');
        const res = await request(config.host + req.url, opts);
        return res;
    };

