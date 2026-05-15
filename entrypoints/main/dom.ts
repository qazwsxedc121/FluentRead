import { getMainDomain, selectCompatFn } from "@/entrypoints/main/compat";
import { html } from 'js-beautify';
import { handleBtnTranslation } from "@/entrypoints/main/trans";

// 直接翻译的标签集合（块级元素）
const directSet = new Set([
    'h1', 'h2', 'h3', 'h4', 'h5', 'h6',  // 标题
    'p', 'li', 'dd', 'blockquote',       // 段落和列表
    'figcaption'                         // 图片说明
]);

// 需要跳过的标签
const skipSet = new Set([
    'html', 'body', 'script', 'style', 'noscript', 'iframe',
    'input', 'textarea', 'select', 'button', 'code', 'pre',
]);

// 内联元素集合（可以包含在其他元素内的元素）
export const inlineSet = new Set([
    'a', 'b', 'strong', 'span', 'em', 'i', 'u', 'small', 'sub', 'sup',
    'font', 'mark', 'cite', 'q', 'abbr', 'time', 'ruby', 'bdi', 'bdo',
    'img', 'br', 'wbr', 'svg'
]);

// 硬编码：永不需要翻译的常用词（大小写不敏感匹配）
const SKIP_WORDS = new Set([
    // === 科技品牌/产品 ===
    'google', 'apple', 'microsoft', 'amazon', 'facebook', 'meta',
    'twitter', 'instagram', 'youtube', 'tiktok', 'whatsapp', 'telegram',
    'spotify', 'netflix', 'discord', 'twitch', 'snapchat', 'pinterest',
    'linkedin', 'reddit', 'quora', 'medium', 'wikipedia', 'wikimedia',
    'github', 'gitlab', 'bitbucket', 'stackoverflow',
    'openai', 'chatgpt', 'claude', 'gemini', 'copilot', 'deepseek',
    'samsung', 'sony', 'intel', 'amd', 'nvidia', 'qualcomm',
    'xiaomi', 'huawei', 'oppo', 'vivo', 'oneplus', 'realme',
    'android', 'ios', 'ipados', 'macos', 'windows', 'linux', 'ubuntu',
    'chrome', 'firefox', 'safari', 'edge', 'opera', 'brave',
    'iphone', 'ipad', 'ipod', 'imac', 'macbook', 'airpods', 'apple watch',
    'playstation', 'xbox', 'nintendo', 'switch', 'steam', 'epic games',
    // === 技术术语 ===
    'wifi', 'bluetooth', 'ethernet', 'nfc', 'rfid', 'hdmi', 'usb-c',
    'javascript', 'typescript', 'python', 'rust', 'golang', 'kotlin',
    'node.js', 'react', 'vue', 'angular', 'django', 'flask',
    'docker', 'kubernetes', 'nginx', 'apache', 'tomcat',
    'mysql', 'postgresql', 'mongodb', 'redis', 'elasticsearch',
    'aws', 'azure', 'gcp', 'heroku', 'vercel', 'netlify', 'cloudflare',
    // === 常用协议/格式 ===
    'http', 'https', 'ftp', 'smtp', 'tcp', 'udp', 'dns', 'vpn',
    'ssl', 'tls', 'ssh', 'rdp', 'smtp', 'imap', 'pop3',
    // === 社交媒体/流行语 ===
    'emoji', 'meme', 'gif', 'selfie', 'vlog', 'podcast', 'webinar',
    'cookies', 'cache', 'spam', 'phishing', 'malware', 'ransomware',
    // === 品牌/商标 ===
    'coca-cola', 'pepsi', 'mcdonald', 'starbucks', 'nike', 'adidas',
    'bmw', 'mercedes', 'toyota', 'honda', 'tesla', 'ferrari', 'porsche',
    // === 常见缩写 ===
    'lte', '4g', '5g', '3g', 'volte', 'wlan', 'lan', 'wan',
    'oled', 'lcd', 'amoled', 'qled', 'hdr', 'uhd', 'fhd', 'qhd',
]);

// 传入父节点，返回所有需要翻译的 DOM 元素数组
export function grabAllNode(rootNode: Node): Element[] {
    if (!rootNode) return [];

    const result: Element[] = [];
    const MAX_NODES = 800; // 防止超大页面卡死主线程

    const walker = document.createTreeWalker(
        rootNode,
        NodeFilter.SHOW_ELEMENT | NodeFilter.SHOW_TEXT,
        {
            acceptNode: (node: Node): number => {
                if (node instanceof Text) return NodeFilter.FILTER_ACCEPT;

                if (!(node instanceof Element)) return NodeFilter.FILTER_SKIP;

                const tag = node.tagName.toLowerCase();

                // 跳过黑名单标签
                if (skipSet.has(tag) ||
                    node.classList?.contains('sr-only') ||
                    node.classList?.contains('notranslate')) {
                    return NodeFilter.FILTER_REJECT;
                }

                // 跳过 header、footer 和表格结构标签
                if (tag === 'header' || tag === 'footer' ||
                    tag === 'colgroup' || tag === 'col') {
                    return NodeFilter.FILTER_REJECT;
                }

                // 性能优化：用 textContent 和 children.length 替代遍历 childNodes
                // 原先对每个元素遍历所有子节点，在大表格中极其昂贵
                const text = node.textContent?.trim();
                if (!text) return NodeFilter.FILTER_REJECT;

                if (node.children.length > 0) return NodeFilter.FILTER_SKIP;

                return NodeFilter.FILTER_ACCEPT;
            }
        }
    );

    // 遍历出所有可翻译的节点
    let currentNode: Node | null;
    while (currentNode = walker.nextNode()) {
        if (result.length >= MAX_NODES) break;
        const translateNode = grabNode(currentNode as Element | Text);
        if (translateNode) {
            result.push(translateNode);
            // 跳过已确定要翻译的节点的所有子节点
            walker.currentNode = currentNode.nextSibling || currentNode;
        }
    }
    return Array.from(new Set(result));
}

// 返回最终应该翻译的父节点或 false
export function grabNode(node: any): any {
    // 空节点检查
    if (!node) return false;

    // 对于 Text 节点，尝试找到其可翻译的父节点
    if (node instanceof Text) {
        const parentOrSelf = findTranslatableParent(node);
        if (parentOrSelf && parentOrSelf !== node) {
            return parentOrSelf;
        }
        return false;
    }

    if (!node.tagName) return false;

    const curTag = node.tagName.toLowerCase();

    // 1. 快速过滤：跳过不需要翻译的节点
    if (shouldSkipNode(node, curTag)) return false;

    // 2. 特殊适配：根据域名进行特殊处理
    const domainHandler = selectCompatFn[getMainDomain(location.href.split('?')[0])];
    if (domainHandler) {
        const result = domainHandler(node);
        // 如果返回的是对象且包含skip属性为true，则跳过该节点
        if (result && typeof result === 'object' && 'skip' in result && result.skip === true) {
            return false;
        }
        // 如果返回值为节点或其他真值，则返回该值作为翻译节点
        if (result) return result;
    }

    // 3. 直接翻译：块级元素
    if (directSet.has(curTag)) return node;

    // 4. 按钮处理：特殊处理按钮内的文本
    if (isButton(node, curTag)) {
        handleButtonTranslation(node);
        return false;
    }

    // 5. 内联元素处理：向上查找合适的父节点
    if (isInlineElement(node, curTag)) {
        return findTranslatableParent(node);
    }

    // 6. 首行文本处理：处理 div 和 label 的首行文本
    if (curTag === 'div' || curTag === 'label') {
        return handleFirstLineText(node);
    }

    return false;
}

// 检查是否应该跳过节点
function shouldSkipNode(node: any, tag: string): boolean {
    // 1. 判断标签是否在 skipSet 内
    // 2. 检查是否具有 notranslate 类
    // 3. 判断节点是否可编辑
    // 4. 判断文本是否过长
    // 5. 判断文本是否为纯数字或标准数字格式（仅当节点内容几乎全是数字时才跳过）
    return skipSet.has(tag) ||
        node.classList?.contains('notranslate') ||
        node.isContentEditable ||
        checkTextSize(node) ||
        isMainlyNumericContent(node);
}

// 检查文本长度
function checkTextSize(node: any): boolean {
    // 1. 若文本内容长度超过 3072
    // 2. 或者 outerHTML 长度超过 4096，都视为过长
    // 3. 少于3个字符
    return node.textContent.length > 3072 ||
        (node.outerHTML && node.outerHTML.length > 4096) ||
        node.textContent.length < 3;
}

// 检查节点内容是否主要为数字/无需翻译
function isMainlyNumericContent(node: any): boolean {
    if (!node || !node.textContent) return false;

    const text = node.textContent.trim();
    if (!text) return false;

    // 先检查整体文本是否无需翻译（纯数字、技术符号、缩写等）
    if (isNumericContent(text) || isUntranslatableText(text)) return true;

    // 检查是否为用户名或用户ID格式
    if (isUserIdentifier(text)) return true;

    return false;
}

/**
 * 检查文本是否为用户标识符（用户名、ID等）
 */
function isUserIdentifier(text: string): boolean {
    if (!text || typeof text !== 'string') return false;
    
    const trimmedText = text.trim();
    
    // 检查是否为社交媒体用户名格式
    if (/^@\w+/.test(trimmedText)) return true;  // Twitter格式：@username
    if (/^u\/\w+/.test(trimmedText)) return true; // Reddit格式：u/username
    
    // 检查是否为x.com或twitter.com的ID格式
    if (/^id@https?:\/\/(x\.com|twitter\.com)\/[\w-]+\/status\/\d+/.test(trimmedText)) return true;
    
    // 检查是否包含"关注"相关内容
    if (/关注.*\w+/.test(trimmedText) || /Follow.*\w+/.test(trimmedText)) return true;
    
    // 检查是否为纯粹的用户名格式（字母、数字、下划线组合）
    if (/^[A-Za-z0-9_]{1,15}$/.test(trimmedText)) return true;
    
    // 特殊格式：带点击动作的用户名
    if (/点击.*\w+/.test(trimmedText) && trimmedText.length < 50) return true;
    
    return false;
}

/**
 * 检查文本是否为纯数字或标准数字格式
 * 
 * 识别以下数字格式：
 * 1. 整数 (例如: 12345, -123)
 * 2. 带千位分隔符的数字 (例如: 1,234,567)
 * 3. 数字范围 (例如: 1-100, 5~10)
 * 4. 小数 (例如: 3.14159)
 * 5. 百分比 (例如: 85%, -2.5%)
 * 6. 科学计数法 (例如: 1.23e+4)
 * 7. 货币金额 (例如: $123.45, €100)
 * 8. 常见日期格式 (例如: 2023-01-01, 01/01/2023)
 * 9. 时间格式 (例如: 13:45:30, 9:30)
 * 10. 版本号 (例如: 1.0.0, 2.3.5-beta)
 * 11. ID格式 (例如: id@x.com/user/status/123456789)
 * 12. 用户名格式 (例如: @username, gunsnrosesgirl3)
 * 13. #数字 格式的
 * 
 * 这些格式的数字和用户标识符通常不需要翻译，保持原样更有利于页面理解。
 */
function isNumericContent(text: string): boolean {
    if (!text || typeof text !== 'string') return false;
    
    // 去除空白字符
    const trimmedText = text.trim();
    if (!trimmedText) return false;

    // 首先检查是否为用户标识符
    if (isUserIdentifier(trimmedText)) return true;
    
    // 如果包含多个单词，则不视为纯数字内容
    if (/\s+/.test(trimmedText.replace(/[\d,.\-%+]/g, ''))) return false;
    
    // 检查是否为纯数字
    if (/^-?\d+$/.test(trimmedText)) return true;
    
    // 检查是否为标准数字格式：带逗号的数字 (例如: 1,234,567)
    if (/^-?(\d{1,3}(,\d{3})+)$/.test(trimmedText)) return true;
    
    // 检查是否为范围数字 (例如: 1-123)
    if (/^\d+\s*[-~]\s*\d+$/.test(trimmedText)) return true;

    // 检查是否为分辨率/尺寸格式 (例如: 320x240, 1920×1080, 640*480)
    if (/^\d+\s*[x×X\*]\s*\d+$/i.test(trimmedText)) return true;

    // 检查是否为比例格式 (例如: 16:9, 4:3)
    if (/^\d+\s*[:：]\s*\d+$/.test(trimmedText)) return true;

    // 检查是否为分数格式 (例如: 1/2, 3/4)
    if (/^\d+\/\d+$/.test(trimmedText)) return true;
    
    // 检查是否为小数
    if (/^-?\d+\.\d+$/.test(trimmedText)) return true;
    
    // 检查是否为百分比
    if (/^-?\d+(\.\d+)?%$/.test(trimmedText)) return true;
    
    // 检查是否为科学计数法 (例如: 1.23e+4)
    if (/^-?\d+(\.\d+)?(e[-+]\d+)?$/i.test(trimmedText)) return true;
    
    // 检查是否为带货币符号的金额 (例如: $123.45, €123, ¥123)
    if (/^[$€¥£₹₽₩]?\s*-?\d+(,\d{3})*(\.\d+)?$/.test(trimmedText)) return true;
    
    // 检查是否为日期时间格式 (仅考虑常见的数字日期格式)
    // 匹配 YYYY-MM-DD, YYYY/MM/DD, DD-MM-YYYY, DD/MM/YYYY, MM-DD-YYYY, MM/DD/YYYY
    if (/^(\d{4}[-/]\d{1,2}[-/]\d{1,2}|\d{1,2}[-/]\d{1,2}[-/]\d{4}|\d{1,2}[-/]\d{1,2}[-/]\d{1,2})$/.test(trimmedText)) return true;
    
    // 匹配时间格式 HH:MM:SS, HH:MM
    if (/^\d{1,2}:\d{2}(:\d{2})?$/.test(trimmedText)) return true;
    
    // 匹配版本号 (例如: 1.0.0, 2.3.5-beta)
    if (/^\d+(\.\d+){1,3}(-[a-zA-Z0-9]+)?$/.test(trimmedText)) return true;
    
    // 匹配社交媒体的ID格式
    if (/^id@https?:\/\/(x\.com|twitter\.com)\/[\w-]+\/status\/\d+/.test(trimmedText)) return true;
    
    // 匹配常见的数字ID格式
    if (/^ID[:：]?\s*\d+$/.test(trimmedText)) return true;
    if (/^No[\.:]?\s*\d+$/i.test(trimmedText)) return true;

    // #数字 格式的
    if (/^#[\d]+$/.test(trimmedText)) return true;

    return false;
}

/**
 * 检查文本是否为无需翻译的内容（比 isNumericContent 更广）
 *
 * 规则：
 * 0. 硬编码常用词 → 不翻译（如 Google, iPhone, WiFi, GitHub）
 * 1. 英文字母总数 ≤ 2 → 视为技术符号/数字后缀，不翻译（如 4.61K, x86, K1）
 * 2. 纯大写缩写，长度 2-5 → 不翻译（如 USB, NBA, CCTV, HTML）
 */
function isUntranslatableText(text: string): boolean {
    if (!text || typeof text !== 'string') return false;
    const trimmed = text.trim();
    if (!trimmed) return false;

    // 规则0: 硬编码常用词（大小写不敏感）
    if (SKIP_WORDS.has(trimmed.toLowerCase())) return true;

    const letterCount = (trimmed.match(/[A-Za-z]/g) || []).length;

    // 规则1: 英文字母总数 ≤ 2 → 技术符号/数字后缀，跳过
    if (letterCount <= 2) return true;

    // 规则2: 纯大写缩写，长度 2-5 → 跳过
    if (/^[A-Z]{2,5}$/.test(trimmed)) return true;

    return false;
}

// 检查是否为按钮
function isButton(node: any, tag: string): boolean {
    // 1. 若当前标签就是 button
    // 2. 或者当前标签为 span 并且其父节点为 button，则视为按钮
    return tag === 'button' ||
        (tag === 'span' && node.parentNode?.tagName.toLowerCase() === 'button');
}

// 处理按钮翻译
function handleButtonTranslation(node: any): void {
    // 1. 若文本非空，则调用 handleBtnTranslation 进行按钮文本翻译处理
    if (node.textContent.trim()) {
        handleBtnTranslation(node);
    }
}

// 检查是否为内联元素
function isInlineElement(node: any, tag: string): boolean {
    // 1. 判断是否在 inlineSet 中
    // 2. 判断是否文本节点
    // 3. 检查子元素中是否包含非内联元素
    return inlineSet.has(tag) ||
        node.nodeType === Node.TEXT_NODE ||
        detectChildMeta(node);
}

// 查找可翻译的父节点
function findTranslatableParent(node: any): any {
    // 1. 递归调用 grabNode 查找父节点是否可翻译
    // 2. 若父节点不可翻译，则返回当前节点
    const parentResult = grabNode(node.parentNode);
    return parentResult || node;
}

// 处理首行文本
function handleFirstLineText(node: any): boolean {
    // 1. 遍历子节点，找到首个文本节点
    // 2. 若存在可翻译文本，则通过 browser.runtime.sendMessage 进行翻译
    // 3. 翻译成功后，替换该文本；出现错误时，打印错误日志
    let child = node.firstChild;
    while (child) {
        if (child.nodeType === Node.TEXT_NODE && child.textContent.trim()) {
            // 跳过无需翻译的内容（数字、缩写、技术符号等）
            if (isUntranslatableText(child.textContent)) return false;
            browser.runtime.sendMessage({
                context: document.title,
                origin: child.textContent
            })
                .then((text: string) => child.textContent = text)
                .catch((error: any) => console.error('翻译失败:', error));
            return false;
        }
        child = child.nextSibling;
    }
    return false;
}

// 检测子元素中是否包含指定标签以外的元素
function detectChildMeta(parent: any): boolean {
    // 1. 逐个检查子节点
    // 2. 若发现非内联元素则返回 false；否则全部检查通过则返回 true
    let child = parent.firstChild;
    while (child) {
        if (child.nodeType === Node.ELEMENT_NODE && !inlineSet.has(child.nodeName.toLowerCase())) {
            return false;
        }
        child = child.nextSibling;
    }
    return true;
}

// 仅译文模式下获取 LLM 应当翻译的标准 HTML
export function LLMStandardHTML(node: any) {
    // 1. 初始化空字符串 text
    // 2. 遍历子节点
    // 3. 若为文本节点，拼接其文本内容
    // 4. 若为元素节点且在 inlineSet 中，拼接其 outerHTML
    // 5. 否则继续递归处理子节点
    let text = "";
    node.childNodes.forEach((child: any) => {
        if (child.nodeType === Node.TEXT_NODE) {
            text += child.nodeValue;
        } else if (child.nodeType === Node.ELEMENT_NODE) {
            if (inlineSet.has(child.tagName.toLowerCase())) {
                text += child.outerHTML;
            } else {
                text += LLMStandardHTML(child);
            }
        }
    });
    return text;
}

export function beautyHTML(text: string): string {
    // 1. 先替换 SVG 中的大小写敏感词
    // 2. 再使用 js-beautify 格式化 HTML
    text = replaceSensitiveWords(text);
    return html(text)
}

// 替换 svg 标签中的一些大小写敏感的词（html 不区分大小写，但 svg 标签区分大小写）
function replaceSensitiveWords(text: string): string {
    // 1. 使用正则匹配大小写敏感词
    // 2. 逐个替换为正确大小写形式
    return text.replace(/viewbox|preserveaspectratio|clippathunits|gradienttransform|patterncontentunits|lineargradient|clippath/gi, (match) => {
        switch (match.toLowerCase()) {
            case 'viewbox':
                return 'viewBox';
            case 'preserveaspectratio':
                return 'preserveAspectRatio';
            case 'clippathunits':
                return 'clipPathUnits';
            case 'gradienttransform':
                return 'gradientTransform';
            case 'patterncontentunits':
                return 'patternContentUnits';
            case 'lineargradient':
                return 'linearGradient';
            case 'clippath':
                return 'clipPath';
            default:
                return match;
        }
    });
}

// 移除特定样式
export function checkAndRemoveStyle(node: any, styleProperty: any) {
    // 1. 若节点存在样式且对应属性不为 undefined，则清空该属性
    if (node.style && node.style[styleProperty] !== undefined) {
        node.style[styleProperty] = '';
    }
}

// 移除截断样式
export function smashTruncationStyle(node: any) {
    // 1. 先调用 checkAndRemoveStyle 移除 webkitLineClamp 属性
    // 2. 将节点的相关样式设为 'unset'
    checkAndRemoveStyle(node, 'webkitLineClamp');
    node.style.webkitLineClamp = 'unset';
    node.style.maxHeight = 'unset';
}