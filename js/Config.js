// مدیریت تنظیمات کاربر (پروایدرها و کلیدهای API) در localStorage.
// نکته امنیتی: این کلیدها فقط در همین مرورگر ذخیره می‌شوند و به سرور ما فرستاده
// نمی‌شوند (مگر در لحظه‌ی خودِ درخواست ترجمه/تبدیل که مستقیماً لازم است).
// localStorage به‌طور ذاتی رمزنگاری‌شده نیست؛ اگر روی سیستم مشترک کار می‌کنید
// کلیدهای API را از پنل پروایدر با محدودیت مصرف/IP بسازید.

const STORAGE_KEY = 'ai_config_data';

const RESERVED_KEYS = new Set(['version', 'export_date', 'api_keys', '__proto__', 'constructor', 'prototype']);

function emptyConfig() {
    return {
        version: '1.0',
        export_date: new Date().toISOString(),
        api_keys: [],
        providers: Object.create(null),
    };
}

// هر مدل زیر یک پروایدر می‌تونه RPS متفاوتی از بقیهٔ مدل‌های همون پروایدر
// داشته باشه؛ برای همین maxRps مال خودِ پروایدر نیست، مال تک‌تک مدل‌هاست.
function normalizeModelEntry(entry, legacyMaxRps) {
    if (typeof entry === 'string') {
        return { name: entry, maxRps: legacyMaxRps || null };
    }
    if (entry && typeof entry === 'object') {
        return {
            name: String(entry.name || '').trim(),
            maxRps: entry.maxRps ? parseFloat(entry.maxRps) : null,
        };
    }
    return null;
}

function migrateProvider(rawProvider) {
    const legacyMaxRps = rawProvider.maxRps ? parseFloat(rawProvider.maxRps) : null;
    const models = Array.isArray(rawProvider.models)
        ? rawProvider.models
            .map((m) => normalizeModelEntry(m, legacyMaxRps))
            .filter((m) => m && m.name)
        : [];
    return {
        name: rawProvider.name || '',
        url: rawProvider.url || '',
        models,
    };
}

let configData = emptyConfig();

export function getConfig() {
    return configData;
}

export function findModelSettings(providerKey, modelName) {
    const provider = configData.providers[providerKey];
    if (!provider) return { maxRps: null };
    const found = provider.models.find((m) => m.name === modelName);
    return found ? { maxRps: found.maxRps || null } : { maxRps: null };
}

export function loadConfig() {
    const saved = localStorage.getItem(STORAGE_KEY);
    if (saved) {
        try {
            const parsed = JSON.parse(saved);
            configData = emptyConfig();
            configData.version = parsed.version || '1.0';
            configData.api_keys = Array.isArray(parsed.api_keys) ? parsed.api_keys : [];
            if (parsed.providers && typeof parsed.providers === 'object') {
                for (const [key, value] of Object.entries(parsed.providers)) {
                    if (RESERVED_KEYS.has(key)) continue;
                    configData.providers[key] = migrateProvider(value);
                }
            }
        } catch (e) {
            configData = emptyConfig();
        }
    }
    return configData;
}

export function saveConfig() {
    configData.export_date = new Date().toISOString();
    localStorage.setItem(STORAGE_KEY, JSON.stringify(configData));
}

function normalizeProviderName(str) {
    return str
        .trim()
        .normalize('NFC')
        .replace(/\u064A/g, '\u06CC')
        .replace(/\u0643/g, '\u06A9')
        .replace(/\s+/g, ' ');
}

export function findExistingProviderKey(name) {
    const normalized = normalizeProviderName(name).toLowerCase();
    return Object.keys(configData.providers).find(
        (k) => normalizeProviderName(k).toLowerCase() === normalized
    );
}

export function addProvider(rawName, baseUrl, modelsInput, maxRps = null) {
    const name = rawName.trim();
    const url = baseUrl.trim();

    if (!name || !url) {
        throw new Error('لطفاً نام پروایدر و اندپوینت را پر کنید[span_0](start_span)[span_0](end_span).');
    }
    if (!/^https:\/\//i.test(url)) {
        throw new Error('اندپوینت باید با https:// شروع شود[span_1](start_span)[span_1](end_span).');
    }

    // تبدیل ورودی مدل‌ها به آرایه‌ای از آبجکت‌ها (پشتیبانی از رشته یا ساختار دارای maxRps مجزا)
    let modelList = [];
    if (Array.isArray(modelsInput)) {
        modelList = modelsInput;
    } else if (typeof modelsInput === 'string') {
        modelList = modelsInput.split(',').map((m) => {
            const trimmed = m.trim();
            return trimmed ? { name: trimmed, maxRps: maxRps && !isNaN(parseFloat(maxRps)) ? parseFloat(maxRps) : null } : null;
        }).filter(Boolean);
    }

    if (modelList.length === 0) {
        throw new Error('حداقل یک مدل باید وارد شود[span_2](start_span)[span_2](end_span).');
    }

    const existingKey = findExistingProviderKey(name);
    const key = existingKey || normalizeProviderName(name);
    if (RESERVED_KEYS.has(key)) {
        throw new Error('این نام پروایدر مجاز نیست[span_3](start_span)[span_3](end_span).');
    }

    if (!configData.providers[key]) {
        configData.providers[key] = { name, url, models: [] };
    }

    // به‌روزرسانی یا اضافه کردن مدل‌ها به همراه maxRps اختصاصی هرکدام
    modelList.forEach((incomingModel) => {
        const modelName = typeof incomingModel === 'string' ? incomingModel : incomingModel.name;
        const modelRps = incomingModel.maxRps !== undefined ? (incomingModel.maxRps ? parseFloat(incomingModel.maxRps) : null) : (maxRps ? parseFloat(maxRps) : null);

        if (!modelName) return;

        const existingModel = configData.providers[key].models.find((m) => m.name === modelName);
        if (existingModel) {
            if (modelRps !== null) {
                existingModel.maxRps = modelRps;
            }
        } else {
            configData.providers[key].models.push({ name: modelName, maxRps: modelRps });
        }
    });

    configData.providers[key].url = url;
    configData.providers[key].name = configData.providers[key].name || name;
    saveConfig();

    return { key, addedCount: modelList.length, providerName: configData.providers[key].name };
}

export function addApiKey(label, key) {
    const trimmedLabel = label.trim();
    const trimmedKey = key.trim();
    if (!trimmedLabel || !trimmedKey) {
        throw new Error('لطفاً برچسب کلید و خود کلید را وارد کنید[span_4](start_span)[span_4](end_span).');
    }
    configData.api_keys.push({ label: trimmedLabel, key: trimmedKey });
    saveConfig();
}

export function deleteApiKey(index) {
    configData.api_keys.splice(index, 1);
    saveConfig();
}

export function exportConfig() {
    return {
        version: configData.version || '1.0',
        export_date: new Date().toISOString(),
        api_keys: configData.api_keys || [],
        ...configData.providers,
    };
}

export function importConfig(jsonText) {
    const imported = JSON.parse(jsonText);
    if (!imported || typeof imported !== 'object') {
        throw new Error('ساختار فایل نامعتبر است[span_5](start_span)[span_5](end_span).');
    }
    const next = emptyConfig();
    next.version = imported.version || '1.0';
    next.export_date = imported.export_date || new Date().toISOString();
    next.api_keys = Array.isArray(imported.api_keys) ? imported.api_keys : [];

    Object.keys(imported).forEach((k) => {
        if (RESERVED_KEYS.has(k)) return;
        next.providers[k] = migrateProvider(imported[k]);
    });

    configData = next;
    saveConfig();
}
