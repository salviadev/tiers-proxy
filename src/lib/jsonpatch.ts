export function compare(tree1: any, tree2: any, options?: any): any[] {
    const patches: any[] = [];
    options = options || {};
    _generate(tree1, tree2, patches, '', options);
    return patches;
}

const
    _objectKeys = (obj: any) => {
        if (Array.isArray(obj)) {
            let keys = new Array(obj.length);
            for (let i = 0; i < keys.length; i++)
                keys[i] = '' + i;
            return keys;
        }
        return Object.keys(obj);
    },

    _equals = (a: any, b: any) => {
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
                        if (!_equals(a[i], b[i])) return false;

                    return true;
                }

                let bKeys = _objectKeys(b);
                let bLength = bKeys.length;
                if (_objectKeys(a).length !== bLength)
                    return false;

                for (let i = 0; i < bLength; i++)
                    if (!_equals(a[i], b[i])) return false;

                return true;

            default:
                return false;

        }
    },
    _escapePathComponent = (str: string) => {
        if (str.indexOf('/') === -1 && str.indexOf('~') === -1) return str;
        return str.replace(/~/g, '~0').replace(/\//g, '~1');
    },
    _deepClone = (obj: any) => {
        switch (typeof obj) {
            case 'object':
                return JSON.parse(JSON.stringify(obj));
            case 'undefined':
                return null;
            default:
                return obj;
        }
    },

    _generate = (mirror: any, obj: any, patches: any[], path: string, options: any) => {
        let useId = options.useId;
        let isArray = Array.isArray(obj)
        let newKeys = _objectKeys(obj);
        let oldKeys = _objectKeys(mirror);
        let deleted = false;

        for (let t = oldKeys.length - 1; t >= 0; t--) {
            let key = oldKeys[t];
            let oldVal = mirror[key];
            let pathKey = isArray && useId ? (oldVal.id ? (oldVal.id + '') : key) : key;
            if (obj.hasOwnProperty(key) && !(obj[key] === undefined && oldVal !== undefined && Array.isArray(obj) === false)) {
                let newVal = obj[key];
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

        for (let t = 0; t < newKeys.length; t++) {
            let key = newKeys[t];
            if (!mirror.hasOwnProperty(key) && obj[key] !== undefined) {
                patches.push({ op: 'add', path: path + '/' + (isArray && useId ? '-' : _escapePathComponent(key)), value: _deepClone(obj[key]) });
            }
        }
    };
