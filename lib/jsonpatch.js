"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
function compare(tree1, tree2, options) {
    const patches = [];
    options = options || {};
    _generate(tree1, tree2, patches, '', options);
    return patches;
}
exports.compare = compare;
const _objectKeys = (obj) => {
    if (Array.isArray(obj)) {
        const keys = new Array(obj.length);
        for (let i = 0; i < keys.length; i++)
            keys[i] = '' + i;
        return keys;
    }
    return Object.keys(obj);
};
const _equals = (a, b) => {
    switch (typeof a) {
        case 'boolean':
        case 'string':
        case 'number':
            return a === b;
        case 'object':
            if (a === null)
                return b === null;
            if (Array.isArray(a)) {
                if (!Array.isArray(b) || a.length !== b.length)
                    return false;
                for (let i = 0, l = a.length; i < l; i++)
                    if (!_equals(a[i], b[i]))
                        return false;
                return true;
            }
            const bKeys = _objectKeys(b);
            const bLength = bKeys.length;
            if (_objectKeys(a).length !== bLength)
                return false;
            for (let i = 0; i < bLength; i++)
                if (!_equals(a[i], b[i]))
                    return false;
            return true;
        default:
            return false;
    }
};
const _escapePathComponent = (str) => {
    if (str.indexOf('/') === -1 && str.indexOf('~') === -1)
        return str;
    return str.replace(/~/g, '~0').replace(/\//g, '~1');
};
const _deepClone = (obj) => {
    switch (typeof obj) {
        case 'object':
            return JSON.parse(JSON.stringify(obj));
        case 'undefined':
            return null;
        default:
            return obj;
    }
};
const _generate = (mirror, obj, patches, path, options) => {
    const useId = options.useId;
    const isArray = Array.isArray(obj);
    const newKeys = _objectKeys(obj);
    const oldKeys = _objectKeys(mirror);
    let deleted = false;
    for (let t = oldKeys.length - 1; t >= 0; t--) {
        const key = oldKeys[t];
        const oldVal = mirror[key];
        const pathKey = isArray && useId ? (oldVal.id ? (oldVal.id + '') : key) : key;
        if (obj.hasOwnProperty(key) && !(obj[key] === undefined && oldVal !== undefined && Array.isArray(obj) === false)) {
            const newVal = obj[key];
            if (typeof oldVal === 'object' && oldVal != null && typeof newVal === 'object' && newVal != null) {
                _generate(oldVal, newVal, patches, path + '/' + _escapePathComponent(pathKey), options);
            }
            else {
                if (oldVal !== newVal) {
                    patches.push({ op: 'replace', path: path + '/' + _escapePathComponent(pathKey), value: _deepClone(newVal) });
                }
            }
        }
        else {
            patches.push({ op: 'remove', path: path + '/' + _escapePathComponent(pathKey) });
            deleted = true;
        }
    }
    if (!deleted && newKeys.length === oldKeys.length) {
        return;
    }
    for (const key of newKeys) {
        if (!mirror.hasOwnProperty(key) && obj[key] !== undefined) {
            patches.push({ op: 'add', path: path + '/' + (isArray && useId ? '-' : _escapePathComponent(key)), value: _deepClone(obj[key]) });
        }
    }
};
