import * as  http from 'http';
import { compare } from './jsonpatch';
import * as zlib from 'zlib';
import { request, IRerquestInfo } from './http-request';
import { clone } from './helper';
import * as winston from 'winston';

export interface ILogInfo {
    method: string;
    url: string;
    reference: string;
    referenceAdministrative: string;
    errorMessage: string;
    written: boolean;
    statusCode: number;
}

export let logger: { instance: winston.Logger | null, errors: boolean, info: boolean } = { instance: null, errors: false, info: false };

export function canHookRequest(req: http.IncomingMessage, config: any): boolean {
    const tiersRequest = parseTiersRequest(req);
    const isPost = (req.method === 'POST' || req.method === 'PUT');
    if (!isPost && !tiersRequest.entityId) return false;
    if (!tiersRequest.entityName) return false;
    if (tiersRequest.entityName === 'tiers' && tiersRequest.entityId === 'similar') return false;
    if (!config.webhooks)
        return false;
    const webHooks = filterHooks(tiersRequest, config.webhooks);
    return webHooks.length > 0;
}

const
    sopCookies: any = {};

export async function hookRequest(req: http.IncomingMessage, res: http.ServerResponse, config: any, logInfo: ILogInfo): Promise<void> {
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

    let original: IRerquestInfo | null = tiersRequest.entityId ?
        await getTiersOrThematique(req, '', tiersId, tiersRequest, config) : null;
    if (isTiers && original) {
        logInfo.referenceAdministrative = original.body.referenceAdministrative;

    }
    if (original && original.statusCode >= 400) {
        if (original.statusCode === 404) {
            if (isPost) {
                original = null;
            } else if (isDelete) {
                original.body = '';
                original.statusCode = 200;
                patchOriginHeaders(original.headers);
                writeResponse(res, original);
                return;
            } else {
                patchOriginHeaders(original.headers);
                writeResponse(res, original);
                return;
            }
            return;
        }
        logInfo.statusCode = original.statusCode;
        log('error', original.method, original.url, 'Service Tiers (Get Original object)', logInfo, null, original.body);
        patchOriginHeaders(original.headers);
        writeResponse(res, original);
        return;
    }
    let tiersResponse: any = original;
    if (!isTiers) {
        tiersResponse = await getTiersOrThematique(req, tiersRequest.base + '/tiers/' + tiersId, tiersId, tiersRequest, config);
        if (tiersResponse && tiersResponse.statusCode >= 400) {
            logInfo.statusCode = tiersResponse.statusCode;
            log('error', tiersResponse.method, tiersResponse.url, 'Service Tiers (Get Tiers)', logInfo, null, tiersResponse.body);
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
        log('error', requestResponse.method, requestResponse.url, 'Service Tiers (Forward)', logInfo, payload, requestResponse.body);
        patchOriginHeaders(requestResponse.headers);
        writeResponse(res, requestResponse);
        return;
    }
    const current: IRerquestInfo | null = isDelete ? null : await getTiersOrThematique(req, '', tiersId, tiersRequest, config);
    if (current && current.statusCode >= 400) {
        logInfo.statusCode = current.statusCode;
        log('error', current.method, current.url, 'Service Tiers (Get Modified object)', logInfo, null, current.body);
        patchOriginHeaders(current.headers);
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
            };
            const callback = webHook.callback.replace(/\{tenant\}/g, tiersRequest.tenant);
            const isSpo = callback.indexOf('/ServiceWCF.svc/');

            if (isSpo) {
                if (sopCookies[cookieKey]) {
                    opts.headers.cookie = sopCookies[cookieKey];
                }
            }
            const hookRes = await request(callback, opts);
            if (hookRes.statusCode >= 400) {
                logInfo.statusCode = hookRes.statusCode;
                log('error', hookRes.method, hookRes.url, 'Wehook error (Tiers propagation)', logInfo, requestResponse.body, hookRes.body);
                // do rollback
                if (original && current && original.body) {
                    const originalBody = original.body;
                    delete originalBody.date;
                    const modifiedBody = current.body;
                    delete modifiedBody.date;
                    const patches = compare(modifiedBody, originalBody);
                    if (patches.length) {
                        await patchTiersOrThematique(req, tiersId, tiersRequest, patches, config, logInfo);
                    }
                } else if (!original && isPost) {
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
                    sopCookies[cookieKey] = hookRes.headers['set-cookie'].map((cookie: string) => {
                        return cookie.split(';')[0];
                    }).join('; ');
            }
        }
    }

    // send back to client
    patchOriginHeaders(requestResponse.headers);
    writeResponse(res, requestResponse);

}

const
    escapeString = (value?: string): string => {
        value = value || '';
        value.replace(/\"/g, '""');
        value = '"' + value + '"';
        return value;
    };

export const log = (level: string, method: string, url: string, message: string, logInfo: ILogInfo | null, requestBody: any, responseBody: any) => {
    if (!logger.instance) return;
    if (!logInfo) {
        logger.instance.info(level);
        return;
    }
    const line: string[] = [];
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
        logger.instance.info(line.join(';'));
    }
    if (level === 'error' && (requestBody || responseBody)) {
        logger.instance.error({
            message: method + ' ' + url,
            level: level,
            requestBody: requestBody || null,
            responseBody: responseBody || null,
            error: true,
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
    const ii = url.indexOf('?');
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
        requestInfo: { tenant: string, entityName: string, thematique: string, entityId: string, method: string },
        webhooks: any): Array<{ method: string, topic: string, callback: string }> => {
        const res: Array<{ method: string, topic: string, callback: string }> = [];
        if (webhooks[requestInfo.tenant]) {
            webhooks[requestInfo.tenant].forEach((webhook: any) => {
                if (webhook.topic.indexOf(requestInfo.method + '+*/' + requestInfo.entityName) === 0)
                    res.push(webhook);
            });
        }
        if (webhooks.$all) {
            webhooks.$all.forEach((webhook: any) => {
                if (webhook.topic.indexOf(requestInfo.method + '+*/' + requestInfo.entityName) === 0)
                    res.push(webhook);
            });
        }

        return res;
    };

const patchOriginHeaders = (headers: any) => {
    if (!headers['access-control-allow-origin'])
        headers['access-control-allow-origin'] = '*';
};

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
                        body = JSON.parse(body);
                        // tslint:disable-next-line:no-empty
                    } catch (e) { }
                    resolve(body);
                });
            });
        else
            return null;
    };

const
    getTiersOrThematique = async (
        req: http.IncomingMessage, uri: string, tiersId: string,
        tiersRequest: { entityName: string, thematique: string, entityId: string, method: string },
        config: any): Promise<IRerquestInfo> => {

        const newLocal: any = null;
        const opts = {
            method: 'GET',
            headers: clone(req.headers),
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
        const res = await request(url, opts);
        return res;
    };

const
    patchTiersOrThematique = async (
        req: http.IncomingMessage, tiersId: string,
        tiersRequest: { entityName: string, thematique: string, entityId: string, method: string },
        patches: any[], config: any, logInfo: ILogInfo): Promise<IRerquestInfo> => {
        const opts = {
            method: 'PATCH',
            headers: clone(req.headers),
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
        const res = await request(url, opts);
        if (res.statusCode >= 400 && res.statusCode !== 404 && res.statusCode !== 409) {
            res.statusCode = res.statusCode;
            log('error', opts.method, url, 'Tiers (Rollback Failed)', logInfo, opts.data, res.body);
        }
        return res;
    };

const
    deleteTiers = async (
        req: http.IncomingMessage, tiersId: string,
        tiersRequest: { entityName: string, thematique: string, entityId: string, method: string },
        config: any, logInfo: ILogInfo): Promise<IRerquestInfo> => {
        const opts = {
            method: 'PATCH',
            headers: clone(req.headers),
            data: [{ op: 'replace', path: '/status', value: 'TEMPORARY' }]
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
        const res = await request(url, opts);
        if (res.statusCode >= 400 && res.statusCode !== 404 && res.statusCode !== 409) {
            log('error', opts.method, url, 'Tiers (Rollback Failed)', logInfo, null, res.body);
        }
        return res;
    };

const
    writeResponse = (res: http.ServerResponse, data: { body: any, headers: any, statusCode: number }) => {
        Object.keys(data.headers).forEach(header => {
            if (header !== 'content-length' && data.headers[header])
                res.setHeader(header, data.headers[header]);
        });
        res.statusCode = data.statusCode;
        let output: any = res;
        if (data.body) {
            const bodyString = (typeof data.body === 'object' ? JSON.stringify(data.body) : data.body);
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
    sendRequestToRefTiers = async (req: http.IncomingMessage, payload: any, config: any, logInfo: ILogInfo): Promise<IRerquestInfo> => {
        const newLocal: any = null;
        const opts = {
            method: req.method || '',
            headers: clone(req.headers),
            data: newLocal
        };
        delete opts.headers.host;
        delete opts.headers.origin;
        delete opts.headers['user-agent'];
        delete opts.headers.referer;
        delete opts.headers.connection;

        opts.data = payload;
        const res = await request(config.host + req.url, opts);
        return res;
    };
