const
    _cloneArray = (src: any[]): any[] => {
        return src.map(item => {
            if (item) {
                if (Array.isArray(item))
                    return _cloneArray(item);
                else if (typeof item === 'object')
                    return _cloneObject(item);
                else
                    return item;

            } else
                return item;
        });
    };
const
    _cloneObject = (src: any): any => {
        if (src === null || src === undefined) return src;
        const res: any = {};
        Object.keys(src).forEach(propertyName => {
            const item = src[propertyName];
            if (item) {
                if (Array.isArray(item)) {
                    res[propertyName] = _cloneArray(item);
                } else if (typeof item === 'object') {
                    res[propertyName] = _cloneObject(item);
                } else
                    res[propertyName] = item;
            } else
                res[propertyName] = item;
        });
        return res;
    };
const
    _merge = (src: any, dst: any): void => {
        if (!src) return;
        Object.keys(src).forEach(key => {
            const pv = src[key];
            let ov = dst[key];
            if (pv === null) return;
            if (typeof pv === 'object' && !Array.isArray(pv)) {
                ov = ov || {};
                _merge(pv, ov);
                dst[key] = ov;
            } else
                dst[key] = pv;
        });
    };
const
    _isEmpty = (value: any): boolean => {
        return value === undefined || value === null || value === '';
    };
const
    _clone = (src: any): any => {
        if (!src) return src;
        const tt = typeof src;
        if (tt === 'object') {
            if (Array.isArray(src))
                return _cloneArray(src);
            else
                return _cloneObject(src);
        } else
            return src;
    };

export const merge = _merge;
export const clone = _clone;
export const isEmpty = _isEmpty;
