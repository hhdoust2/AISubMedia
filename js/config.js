// مدیریت تنظیمات کاربر (پروایدرها و کلیدهای API) در localStorage.
// نکته امنیتی: این کلیدها فقط در همین مرورگر ذخیره می‌شوند و به سرور ما فرستاده
// نمی‌شوند (مگر در لحظه‌ی خودِ درخواست ترجمه/تبدیل که مستقیماً لازم است).
// localStorage به‌طور ذاتی رمزنگاری‌شده نیست؛ اگر روی سیستم مشترک کار می‌کنید
// کلیدهای API را از پنل پروایدر با محدودیت مصرف/IP بسازید.

const STORAGE_KEY = 'ai_config_data';

// کلیدهایی که هرگز نباید به‌عنوان نام پروایدر پذیرفته شوند — جلوگیری از
// آلودگی پروتوتایپ (prototype pollution) هنگام وارد کردن یک فایل JSON دستکاری‌شده.
const RESERVED_KEYS = new Set(['version', 'export_date', 'api_keys', '__proto__', 'constructor', 'prototype']);

function emptyConfig() {
    return {
        version: '1.0',
        export_date: new Date().toISOString(),
        api_keys: [],
        providers: Object.create(null),
    };
}

let configData = emptyConfig();

export function getConfig() {
    return configData;
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
                    configData.providers[key] = value;
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

// نام پروایدر را نرمال می‌کند تا تفاوت‌های ظاهری نامرئی (فاصله، حروف عربی/فارسی
// مشابه مثل ي/ی یا ك/ک) باعث ساخته‌شدن یک پروایدر تکراری نشوند.
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

export function addProvider(rawName, baseUrl, modelsCsv, isFree = false, maxRps = null) {
    const name = rawName.trim();
    const url = baseUrl.trim();
    const modelList = modelsCsv.split(',').map((m) => m.trim()).filter((m) => m.length > 0);

    if (!name || !url || modelList.length === 0) {
        throw new Error('لطفاً نام پروایدر، اندپوینت و حداقل یک مدل را پر کنید.');
    }
    if (!/^https:\/\//i.test(url)) {
        throw new Error('اندپوینت باید با https:// شروع شود.');
    }

    const existingKey = findExistingProviderKey(name);
    const key = existingKey || normalizeProviderName(name);
    if (RESERVED_KEYS.has(key)) {
        throw new Error('این نام پروایدر مجاز نیست.');
    }

    if (!configData.providers[key]) {
        configData.providers[key] = { name, url, models: [], isFree: false };
    }
    modelList.forEach((model) => {
        if (!configData.providers[key].models.includes(model)) {
            configData.providers[key].models.push(model);
        }
    });
    configData.providers[key].url = url;
    configData.providers[key].name = configData.providers[key].name || name;
    // اگر همین الان با تیک "رایگان" اضافه شده، پروایدر رایگان علامت بخوره؛
    // اگر پروایدر از قبل بود و این‌بار تیک نخورده بود، وضعیت قبلی‌اش را خراب نمی‌کنیم.
    if (isFree) {
        configData.providers[key].isFree = true;
    }
    if (maxRps && !isNaN(parseFloat(maxRps)) && parseFloat(maxRps) > 0) {
        configData.providers[key].maxRps = parseFloat(maxRps);
    }
    saveConfig();

    return { key, addedCount: modelList.length, providerName: configData.providers[key].name };
}

export function addApiKey(label, key) {
    const trimmedLabel = label.trim();
    const trimmedKey = key.trim();
    if (!trimmedLabel || !trimmedKey) {
        throw new Error('لطفاً برچسب کلید و خود کلید را وارد کنید.');
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
        throw new Error('ساختار فایل نامعتبر است.');
    }
    const next = emptyConfig();
    next.version = imported.version || '1.0';
    next.export_date = imported.export_date || new Date().toISOString();
    next.api_keys = Array.isArray(imported.api_keys) ? imported.api_keys : [];

    Object.keys(imported).forEach((k) => {
        if (RESERVED_KEYS.has(k)) return;
        next.providers[k] = imported[k];
    });

    configData = next;
    saveConfig();
}
