import * as url from 'url';
import * as zlib from 'zlib';
import * as httpUtils from 'http';
import * as httpsUtils from 'https';

import { clone } from './helper';


export const request = (uri: string, options: { method: string, headers: any, data: any }): Promise<{ body: any, headers: any, statusCode: number }> => {
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
    }

    return new Promise<any>((resolve, reject) => {
        const request = pUrl.protocol === 'https:' ? httpsUtils.request : httpUtils.request;
        const clientRequest = request(requestOptions, (res) => {
            let responseContent: any = res;
            const zlibOptions = {
                flush: zlib.Z_SYNC_FLUSH,
                finishFlush: zlib.Z_SYNC_FLUSH
            }
            const contentEncoding = res.headers['content-encoding'];
            if (contentEncoding === 'gzip') {
                responseContent = zlib.createGunzip(zlibOptions)
                res.pipe(responseContent)
            } else if (contentEncoding === 'deflate') {
                responseContent = zlib.createInflate(zlibOptions)
                res.pipe(responseContent)
            } else
                res.setEncoding('utf-8');
            let body = '';
            responseContent.on('data', (chunk: any) => {
                body += chunk.toString();
            });

            responseContent.on('end', () => {
                let bodyJSON: any = null;
                if (body) {
                    try {
                        bodyJSON = JSON.parse(body);
                    } catch (e) {

                    }
                }
                resolve(
                    {
                        body: bodyJSON ? bodyJSON : body,
                        headers: clone(res.headers),
                        statusCode: res.statusCode
                    }
                )
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

}


