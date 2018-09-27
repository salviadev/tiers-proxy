"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const _cloneArray = (src) => {
    return src.map(item => {
        if (item) {
            if (Array.isArray(item))
                return _cloneArray(item);
            else if (typeof item === 'object')
                return _cloneObject(item);
            else
                return item;
        }
        else
            return item;
    });
}, _cloneObject = (src) => {
    if (src === null || src === undefined)
        return src;
    let res = {};
    Object.keys(src).forEach(propertyName => {
        let item = src[propertyName];
        if (item) {
            if (Array.isArray(item)) {
                res[propertyName] = _cloneArray(item);
            }
            else if (typeof item === 'object') {
                res[propertyName] = _cloneObject(item);
            }
            else
                res[propertyName] = item;
        }
        else
            res[propertyName] = item;
    });
    return res;
}, _merge = (src, dst) => {
    if (!src)
        return;
    for (let p in src) {
        let pv = src[p];
        let ov = dst[p];
        if (pv === null)
            continue;
        if (typeof pv === 'object' && !Array.isArray(pv)) {
            ov = ov || {};
            _merge(pv, ov);
            dst[p] = ov;
        }
        else
            dst[p] = pv;
    }
}, _isEmpty = (value) => {
    return value === undefined || value === null || value === '';
}, _clone = (src) => {
    if (!src)
        return src;
    let tt = typeof src;
    if (tt === 'object') {
        if (Array.isArray(src))
            return _cloneArray(src);
        else
            return _cloneObject(src);
    }
    else
        return src;
};
exports.merge = _merge;
exports.clone = _clone;
exports.isEmpty = _isEmpty;
