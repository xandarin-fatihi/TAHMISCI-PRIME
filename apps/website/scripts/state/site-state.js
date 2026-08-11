// ========== APPLICATION CONFIGURATION ==========

// Application Constants
const APP_CONFIG = {
    name: 'Tahmisci',
    version: '1.0.0',
    description: 'Tahmisci',
    author: 'Tahmisci',
    baseUrl: window.location.origin,

    // API Configuration (for future backend integration)
    api: {
        baseUrl: '/api',
        version: 'v1',
        timeout: 30000, // 30 seconds
        endpoints: {
            auth: '/auth',
            menu: '/menu',
            orders: '/orders',
            users: '/users',
            cart: '/cart'
        }
    },

    // Local Storage Keys
    storage: {
        cart: 'yeppos_cart',
        user: 'yeppos_user',
        session: 'yeppos_session',
        preferences: 'yeppos_preferences',
        favorites: 'yeppos_favorites',
        addresses: 'yeppos_addresses',
        cookies: 'yeppos_cookies_accepted',
        theme: 'yeppos_theme'
    },

    // Hero Slider: public bootstrap sağlayıcısından yüklenecek (heroDataLoaded)
    hero: {
        slides: [],
        autoplay: true,
        autoplayInterval: 5000,
        transitionSpeed: 600
    },

    // UI Configuration
    ui: {
        // Animation Durations (in milliseconds)
        animations: {
            fast: 150,
            normal: 300,
            slow: 500,
            loadingScreen: 1000
        },

        // Toast Notification Settings
        toast: {
            duration: 5000,
            position: 'top-right',
            maxVisible: 3
        },

        // Modal Settings
        modal: {
            backdropClose: true,
            keyboard: true,
            focus: true
        },

        // Search Settings
        search: {
            minCharacters: 2,
            debounceDelay: 300,
            maxResults: 10
        },

        // Cart Settings
        cart: {
            maxQuantity: 50,
            autoSave: true,
            persistDuration: 7 * 24 * 60 * 60 * 1000 // 7 days
        },

        // Pagination
        pagination: {
            itemsPerPage: 12,
            maxPages: 10
        }
    },

    // Feature Flags
    features: {
        userRegistration: true,
        socialLogin: false, // Disabled for demo
        onlinePayment: false, // Disabled for demo - frontend only
        guestCheckout: true,
        orderTracking: true,
        wishlist: true,
        reviews: true,
        notifications: true,
        darkMode: true,
        multiLanguage: false, // For future implementation
        geolocation: false, // For future implementation
        pwa: true
    },

    // Validation Rules
    validation: {
        email: /^[^\s@]+@[^\s@]+\.[^\s@]+$/,
        phone: /^(\+90|0)?[5][0-9]{9}$/, // Turkish mobile format
        password: {
            minLength: 6,
            requireUppercase: false,
            requireLowercase: false,
            requireNumbers: false,
            requireSymbols: false
        },
        name: {
            minLength: 2,
            maxLength: 50
        },
        address: {
            minLength: 10,
            maxLength: 200
        }
    },

    // Order Configuration
    order: {
        types: ['delivery', 'pickup', 'dine-in'],
        statuses: ['pending', 'confirmed', 'preparing', 'ready', 'delivered', 'cancelled'],
        paymentMethods: ['cash', 'card', 'online'],
        deliveryRadius: 15, // km
        minOrderAmount: 25, // TL
        deliveryFee: 8, // TL
        estimatedDeliveryTime: 45, // minutes
        estimatedPickupTime: 20 // minutes
    },

    // Demo: Artık kullanılmıyor; veriler DB/API'den geliyor. Boş yapı geriye dönük uyumluluk için.
    demo: {
        users: [],
        products: { categories: [], items: [] },
        orders: [],
        testimonials: []
    },

    // Error Messages
    errors: {
        network: 'İnternet bağlantınızı kontrol edin',
        server: 'Sunucu hatası. Lütfen daha sonra tekrar deneyin',
        validation: 'Lütfen tüm alanları doğru şekilde doldurun',
        auth: 'Giriş bilgilerinizi kontrol edin',
        notFound: 'Aradığınız sayfa bulunamadı',
        unauthorized: 'Bu işlem için yetkiniz bulunmuyor',
        cartEmpty: 'Sepetiniz boş',
        stockOut: 'Bu ürün stokta yok',
        generic: 'Bir hata oluştu. Lütfen tekrar deneyin'
    },

    // Success Messages
    success: {
        login: 'Başarıyla giriş yaptınız',
        logout: 'Güvenle çıkış yaptınız',
        register: 'Hesabınız başarıyla oluşturuldu',
        cartAdd: 'Ürün sepete eklendi',
        cartUpdate: 'Sepet güncellendi',
        cartRemove: 'Ürün sepetten çıkarıldı',
        orderPlace: 'Siparişiniz başarıyla alındı',
        profileUpdate: 'Profiliniz güncellendi',
        addressAdd: 'Adres eklendi',
        addressUpdate: 'Adres güncellendi',
        addressDelete: 'Adres silindi',
        favoriteAdd: 'Favorilere eklendi',
        favoriteRemove: 'Favorilerden çıkarıldı',
        contactForm: 'Mesajınız başarıyla gönderildi'
    },

    // Company Information
    company: {},

    // SEO Configuration
    seo: {
        keywords: 'YepPos',
        ogImage: 'assets/brand/favicon.png',
        twitterCard: 'summary_large_image'
    }
};

// Environment Detection
const ENV = {
    isDevelopment: window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1',
    isProduction: window.location.hostname !== 'localhost' && window.location.hostname !== '127.0.0.1',
    isMobile: /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(navigator.userAgent),
    isTablet: /iPad|Android/i.test(navigator.userAgent) && window.innerWidth >= 768,
    isDesktop: window.innerWidth >= 992,
    isTouch: 'ontouchstart' in window || navigator.maxTouchPoints > 0,
    isOnline: navigator.onLine,
    supportsPWA: 'serviceWorker' in navigator,
    supportsLocalStorage: typeof Storage !== 'undefined',
    supportsWebP: (() => {
        const canvas = document.createElement('canvas');
        canvas.width = 1;
        canvas.height = 1;
        return canvas.toDataURL('image/webp').indexOf('data:image/webp') === 0;
    })()
};

// Browser Feature Detection
const FEATURES = {
    intersectionObserver: 'IntersectionObserver' in window,
    webComponents: 'customElements' in window,
    es6Modules: 'noModule' in HTMLScriptElement.prototype,
    fetch: 'fetch' in window,
    promise: 'Promise' in window,
    asyncAwait: (() => {
        try {
            eval('(async () => {})');
            return true;
        } catch (e) {
            return false;
        }
    })(),
    webp: ENV.supportsWebP,
    localStorage: ENV.supportsLocalStorage,
    sessionStorage: typeof sessionStorage !== 'undefined',
    geolocation: 'geolocation' in navigator,
    notification: 'Notification' in window,
    vibration: 'vibrate' in navigator
};

// Global Event Names
const EVENTS = {
    // Cart Events
    CART_UPDATED: 'cart:updated',
    CART_ITEM_ADDED: 'cart:item-added',
    CART_ITEM_REMOVED: 'cart:item-removed',
    CART_ITEM_UPDATED: 'cart:item-updated',
    CART_CLEARED: 'cart:cleared',

    // User Events
    USER_LOGIN: 'user:login',
    USER_LOGOUT: 'user:logout',
    USER_REGISTER: 'user:register',
    USER_UPDATED: 'user:updated',

    // UI Events
    MODAL_OPENED: 'modal:opened',
    MODAL_CLOSED: 'modal:closed',
    TOAST_SHOWN: 'toast:shown',
    TOAST_HIDDEN: 'toast:hidden',
    SEARCH_PERFORMED: 'search:performed',

    // App Events
    APP_READY: 'app:ready',
    APP_ERROR: 'app:error',
    ROUTE_CHANGED: 'route:changed',
    THEME_CHANGED: 'theme:changed'
};

// CSS Classes
const CSS_CLASSES = {
    // State Classes
    ACTIVE: 'active',
    HIDDEN: 'hidden',
    VISIBLE: 'visible',
    LOADING: 'loading',
    ERROR: 'error',
    SUCCESS: 'success',
    DISABLED: 'disabled',

    // Animation Classes
    FADE_IN: 'fade-in',
    FADE_OUT: 'fade-out',
    SLIDE_UP: 'slide-up',
    SLIDE_DOWN: 'slide-down',

    // Component State Classes
    MODAL_OPEN: 'modal-open',
    MENU_OPEN: 'menu-open',
    SEARCH_OPEN: 'search-open',

    // Responsive Classes
    MOBILE_ONLY: 'd-md-none',
    DESKTOP_ONLY: 'd-mobile-none',

    // Utility Classes
    TEXT_CENTER: 'text-center',
    TEXT_LEFT: 'text-left',
    TEXT_RIGHT: 'text-right',
    D_NONE: 'd-none',
    D_BLOCK: 'd-block',
    D_FLEX: 'd-flex'
};

// Make configurations globally available
window.APP_CONFIG = APP_CONFIG;
window.ENV = ENV;
window.FEATURES = FEATURES;
window.EVENTS = EVENTS;
window.CSS_CLASSES = CSS_CLASSES;

// Debug mode for development
if (ENV.isDevelopment) {
    // Debug logs removed
}

// ========== UTILITY FUNCTIONS ==========

class Utils {
    // ========== DOM UTILITIES ==========

    static $(selector, context = document) {
        return context.querySelector(selector);
    }

    static $$(selector, context = document) {
        return Array.from(context.querySelectorAll(selector));
    }

    static createElement(tag, className = '', attributes = {}) {
        const element = document.createElement(tag);
        if (className) element.className = className;

        Object.entries(attributes).forEach(([key, value]) => {
            element.setAttribute(key, value);
        });

        return element;
    }

    static addClass(element, className) {
        if (element && className) {
            element.classList.add(...className.split(' '));
        }
    }

    static removeClass(element, className) {
        if (element && className) {
            element.classList.remove(...className.split(' '));
        }
    }

    static toggleClass(element, className) {
        if (element && className) {
            element.classList.toggle(className);
        }
    }

    static hasClass(element, className) {
        return element && element.classList.contains(className);
    }

    // ========== EVENT UTILITIES ==========

    static on(element, event, handler, options = {}) {
        if (element && event && handler) {
            element.addEventListener(event, handler, options);
        }
    }

    static off(element, event, handler) {
        if (element && event && handler) {
            element.removeEventListener(event, handler);
        }
    }

    static once(element, event, handler) {
        if (element && event && handler) {
            element.addEventListener(event, handler, { once: true });
        }
    }

    static delegate(parent, selector, event, handler) {
        if (parent && selector && event && handler) {
            parent.addEventListener(event, (e) => {
                if (e.target.matches(selector) || e.target.closest(selector)) {
                    handler.call(e.target.closest(selector) || e.target, e);
                }
            });
        }
    }

    static emit(element, eventName, detail = {}) {
        if (element && eventName) {
            const event = new CustomEvent(eventName, { detail, bubbles: true });
            element.dispatchEvent(event);
        }
    }

    // ========== ANIMATION UTILITIES ==========

    static fadeIn(element, duration = 300) {
        if (!element) return Promise.resolve();

        return new Promise((resolve) => {
            element.style.opacity = '0';
            element.style.display = 'block';

            const fadeInAnimation = element.animate([
                { opacity: 0 },
                { opacity: 1 }
            ], {
                duration,
                easing: 'ease-in-out'
            });

            fadeInAnimation.onfinish = () => {
                element.style.opacity = '';
                resolve();
            };
        });
    }

    static fadeOut(element, duration = 300) {
        if (!element) return Promise.resolve();

        return new Promise((resolve) => {
            const fadeOutAnimation = element.animate([
                { opacity: 1 },
                { opacity: 0 }
            ], {
                duration,
                easing: 'ease-in-out'
            });

            fadeOutAnimation.onfinish = () => {
                element.style.display = 'none';
                element.style.opacity = '';
                resolve();
            };
        });
    }

    static slideUp(element, duration = 300) {
        if (!element) return Promise.resolve();

        return new Promise((resolve) => {
            const height = element.offsetHeight;

            const slideAnimation = element.animate([
                { height: `${height}px`, opacity: 1 },
                { height: '0px', opacity: 0 }
            ], {
                duration,
                easing: 'ease-in-out'
            });

            slideAnimation.onfinish = () => {
                element.style.display = 'none';
                element.style.height = '';
                element.style.opacity = '';
                resolve();
            };
        });
    }

    static slideDown(element, duration = 300) {
        if (!element) return Promise.resolve();

        return new Promise((resolve) => {
            element.style.display = 'block';
            const height = element.scrollHeight;
            element.style.height = '0px';
            element.style.opacity = '0';

            const slideAnimation = element.animate([
                { height: '0px', opacity: 0 },
                { height: `${height}px`, opacity: 1 }
            ], {
                duration,
                easing: 'ease-in-out'
            });

            slideAnimation.onfinish = () => {
                element.style.height = '';
                element.style.opacity = '';
                resolve();
            };
        });
    }

    // ========== VALIDATION UTILITIES ==========

    static validateEmail(email) {
        return APP_CONFIG.validation.email.test(email);
    }

    static validatePhone(phone) {
        return APP_CONFIG.validation.phone.test(phone);
    }

    static validatePassword(password) {
        const config = APP_CONFIG.validation.password;

        if (password.length < config.minLength) return false;
        if (config.requireUppercase && !/[A-Z]/.test(password)) return false;
        if (config.requireLowercase && !/[a-z]/.test(password)) return false;
        if (config.requireNumbers && !/\d/.test(password)) return false;
        if (config.requireSymbols && !/[!@#$%^&*(),.?":{}|<>]/.test(password)) return false;

        return true;
    }

    static validateName(name) {
        const config = APP_CONFIG.validation.name;
        return name && name.length >= config.minLength && name.length <= config.maxLength;
    }

    static validateRequired(value) {
        return value !== null && value !== undefined && value.toString().trim() !== '';
    }

    // ========== STORAGE UTILITIES ==========

    static setStorage(key, value, type = 'localStorage') {
        try {
            const storage = type === 'sessionStorage' ? sessionStorage : localStorage;
            storage.setItem(key, JSON.stringify(value));
            return true;
        } catch (error) {
            console.error('Storage error:', error);
            return false;
        }
    }

    static getStorage(key, defaultValue = null, type = 'localStorage') {
        try {
            const storage = type === 'sessionStorage' ? sessionStorage : localStorage;
            const item = storage.getItem(key);
            return item ? JSON.parse(item) : defaultValue;
        } catch (error) {
            console.error('Storage error:', error);
            return defaultValue;
        }
    }

    static removeStorage(key, type = 'localStorage') {
        try {
            const storage = type === 'sessionStorage' ? sessionStorage : localStorage;
            storage.removeItem(key);
            return true;
        } catch (error) {
            console.error('Storage error:', error);
            return false;
        }
    }

    static clearStorage(type = 'localStorage') {
        try {
            const storage = type === 'sessionStorage' ? sessionStorage : localStorage;
            storage.clear();
            return true;
        } catch (error) {
            console.error('Storage error:', error);
            return false;
        }
    }

    // ========== GEOLOCATION / KONUM ==========

    /**
     * Kullanıcının konum bilgisini alır ve localStorage'a kaydeder.
     * Tüm cihazlarda çalışacak şekilde navigator.geolocation + güvenli fallback içerir.
     *
     * localStorage key: "yeppos_user_location"
     * Örnek değer:
     * {
     *   "lat": 38.42,
     *   "lng": 27.14,
     *   "accuracy": 25,
     *   "timestamp": 1700000000000,
     *   "source": "geolocation" | "permission_denied" | "unsupported",
     *   "error": "..." (opsiyonel)
     * }
     */
    static async captureUserLocation(options = {}) {
        const storageKey = 'yeppos_user_location';

        // Geolocation desteklenmiyor
        if (!('geolocation' in navigator)) {
            const fallback = {
                lat: null,
                lng: null,
                accuracy: null,
                timestamp: Date.now(),
                source: 'unsupported',
                error: 'Geolocation not supported'
            };
            this.setStorage(storageKey, fallback);
            return fallback;
        }

        const geoOptions = {
            enableHighAccuracy: true,
            timeout: options.timeout || 8000,
            maximumAge: options.maximumAge || 60 * 1000
        };

        return new Promise((resolve) => {
            navigator.geolocation.getCurrentPosition(
                (position) => {
                    const payload = {
                        lat: position.coords.latitude,
                        lng: position.coords.longitude,
                        accuracy: position.coords.accuracy,
                        timestamp: position.timestamp || Date.now(),
                        source: 'geolocation'
                    };
                    this.setStorage(storageKey, payload);
                    resolve(payload);
                },
                (error) => {
                    const payload = {
                        lat: null,
                        lng: null,
                        accuracy: null,
                        timestamp: Date.now(),
                        source: error.code === 1 ? 'permission_denied' : 'error',
                        error: error.message || 'Geolocation error'
                    };
                    this.setStorage(storageKey, payload);
                    resolve(payload);
                },
                geoOptions
            );
        });
    }

    /**
     * Daha önce kaydedilmiş konum bilgisini döndürür.
     * Yoksa null döner.
     */
    static getUserLocation() {
        return this.getStorage('yeppos_user_location', null);
    }

    // ========== URL UTILITIES ==========

    static getURLParams() {
        return new URLSearchParams(window.location.search);
    }

    static getURLParam(name, defaultValue = null) {
        return this.getURLParams().get(name) || defaultValue;
    }

    static setURLParam(name, value) {
        const params = this.getURLParams();
        params.set(name, value);

        const newURL = `${window.location.pathname}?${params.toString()}`;
        window.history.replaceState({}, '', newURL);
    }

    static removeURLParam(name) {
        const params = this.getURLParams();
        params.delete(name);

        const newURL = params.toString()
            ? `${window.location.pathname}?${params.toString()}`
            : window.location.pathname;

        window.history.replaceState({}, '', newURL);
    }

    // ========== FORMAT UTILITIES ==========

    static formatPrice(price, currency = 'TL') {
        const number = parseFloat(price);
        if (isNaN(number)) return '0,00 ' + currency;

        return number.toLocaleString('tr-TR', {
            minimumFractionDigits: 2,
            maximumFractionDigits: 2
        }) + ' ' + currency;
    }

    static formatDate(date, format = 'dd.mm.yyyy') {
        const d = new Date(date);
        if (isNaN(d.getTime())) return 'Geçersiz tarih';

        const day = d.getDate().toString().padStart(2, '0');
        const month = (d.getMonth() + 1).toString().padStart(2, '0');
        const year = d.getFullYear();
        const hours = d.getHours().toString().padStart(2, '0');
        const minutes = d.getMinutes().toString().padStart(2, '0');

        switch (format) {
            case 'dd.mm.yyyy':
                return `${day}.${month}.${year}`;
            case 'dd.mm.yyyy hh:mm':
                return `${day}.${month}.${year} ${hours}:${minutes}`;
            case 'relative':
                return this.formatRelativeTime(d);
            default:
                return d.toLocaleDateString('tr-TR');
        }
    }

    static formatRelativeTime(date) {
        const now = new Date();
        const diff = now - date;
        const seconds = Math.floor(diff / 1000);
        const minutes = Math.floor(seconds / 60);
        const hours = Math.floor(minutes / 60);
        const days = Math.floor(hours / 24);

        if (seconds < 60) return 'Az önce';
        if (minutes < 60) return `${minutes} dakika önce`;
        if (hours < 24) return `${hours} saat önce`;
        if (days < 7) return `${days} gün önce`;

        return this.formatDate(date);
    }

    static formatPhone(phone) {
        const cleaned = phone.replace(/\D/g, '');
        if (cleaned.length === 11 && cleaned.startsWith('0')) {
            return `${cleaned.slice(0, 4)} ${cleaned.slice(4, 7)} ${cleaned.slice(7, 9)} ${cleaned.slice(9)}`;
        }
        if (cleaned.length === 10) {
            return `${cleaned.slice(0, 3)} ${cleaned.slice(3, 6)} ${cleaned.slice(6, 8)} ${cleaned.slice(8)}`;
        }
        return phone;
    }

    // ========== UTILITY FUNCTIONS ==========

    static debounce(func, wait, immediate = false) {
        let timeout;
        return function executedFunction(...args) {
            const later = () => {
                timeout = null;
                if (!immediate) func(...args);
            };
            const callNow = immediate && !timeout;
            clearTimeout(timeout);
            timeout = setTimeout(later, wait);
            if (callNow) func(...args);
        };
    }

    static throttle(func, limit) {
        let inThrottle;
        return function executedFunction(...args) {
            if (!inThrottle) {
                func.apply(this, args);
                inThrottle = true;
                setTimeout(() => inThrottle = false, limit);
            }
        };
    }

    static generateId(prefix = 'id') {
        return `${prefix}_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
    }

    static deepClone(obj) {
        if (obj === null || typeof obj !== 'object') return obj;
        if (obj instanceof Date) return new Date(obj.getTime());
        if (obj instanceof Array) return obj.map(item => this.deepClone(item));
        if (typeof obj === 'object') {
            const clonedObj = {};
            Object.keys(obj).forEach(key => {
                clonedObj[key] = this.deepClone(obj[key]);
            });
            return clonedObj;
        }
    }

    static isEmpty(value) {
        if (value == null) return true;
        if (typeof value === 'string') return value.trim() === '';
        if (Array.isArray(value)) return value.length === 0;
        if (typeof value === 'object') return Object.keys(value).length === 0;
        return false;
    }

    static sanitizeHTML(str) {
        const temp = document.createElement('div');
        temp.textContent = str;
        return temp.innerHTML;
    }

    static truncate(str, length = 100, suffix = '...') {
        if (!str || str.length <= length) return str;
        return str.slice(0, length) + suffix;
    }

    static slugify(text) {
        return text
            .toString()
            .toLowerCase()
            .trim()
            .replace(/\s+/g, '-')
            .replace(/[^\w\-]+/g, '')
            .replace(/\-\-+/g, '-')
            .replace(/^-+/, '')
            .replace(/-+$/, '');
    }

    static scrollTo(element, offset = 0, behavior = 'smooth') {
        if (!element) return;

        const elementPosition = element.offsetTop - offset;
        window.scrollTo({
            top: elementPosition,
            behavior: behavior
        });
    }

    static isInViewport(element) {
        if (!element) return false;

        const rect = element.getBoundingClientRect();
        return (
            rect.top >= 0 &&
            rect.left >= 0 &&
            rect.bottom <= (window.innerHeight || document.documentElement.clientHeight) &&
            rect.right <= (window.innerWidth || document.documentElement.clientWidth)
        );
    }

    static waitForElement(selector, timeout = 5000) {
        return new Promise((resolve, reject) => {
            const element = document.querySelector(selector);
            if (element) {
                resolve(element);
                return;
            }

            const observer = new MutationObserver(() => {
                const element = document.querySelector(selector);
                if (element) {
                    observer.disconnect();
                    resolve(element);
                }
            });

            observer.observe(document.body, {
                childList: true,
                subtree: true
            });

            setTimeout(() => {
                observer.disconnect();
                reject(new Error(`Element ${selector} not found within ${timeout}ms`));
            }, timeout);
        });
    }

    // ========== LOADING UTILITIES ==========

    static showLoading(element, text = 'Yükleniyor...') {
        if (!element) return;

        element.classList.add('loading');
        const spinner = this.createElement('div', 'loading-spinner');
        const loadingText = this.createElement('span', 'loading-text');
        loadingText.textContent = text;

        const loadingContainer = this.createElement('div', 'loading-container');
        loadingContainer.appendChild(spinner);
        loadingContainer.appendChild(loadingText);

        element.appendChild(loadingContainer);
    }

    static hideLoading(element) {
        if (!element) return;

        element.classList.remove('loading');
        const loadingContainer = element.querySelector('.loading-container');
        if (loadingContainer) {
            loadingContainer.remove();
        }
    }

    // ========== IMAGE UTILITIES ==========

    static lazyLoadImage(img, src) {
        if (!img) return;

        img.style.opacity = '0';
        img.onload = () => {
            img.style.opacity = '1';
        };
        img.src = src;
    }

    static preloadImage(src) {
        return new Promise((resolve, reject) => {
            const img = new Image();
            img.onload = () => resolve(img);
            img.onerror = reject;
            img.src = src;
        });
    }

    static getImageDimensions(src) {
        return new Promise((resolve, reject) => {
            const img = new Image();
            img.onload = () => resolve({ width: img.width, height: img.height });
            img.onerror = reject;
            img.src = src;
        });
    }
}

// Make Utils globally available
window.Utils = Utils;

// Shorthand aliases
window.$ = Utils.$;
window.$$ = Utils.$$; 

// ========== AUTHENTICATION SYSTEM ==========

class AuthSystem {
    constructor() {
        this.currentUser = null;
        this.isLoggedIn = false;
        this.init();
    }
    
    init() {
        // Load saved user data
        this.loadUserData();
        
        // Update UI based on auth status
        this.updateAuthUI();
    }
    
    // ========== USER DATA MANAGEMENT ==========
    
    loadUserData() {
        const userData = Utils.getStorage(APP_CONFIG.storage.user);
        const sessionData = Utils.getStorage(APP_CONFIG.storage.session);
        
        if (userData && sessionData) {
            // Check if session is still valid
            const sessionExpiry = new Date(sessionData.expiresAt);
            const now = new Date();
            
            if (now < sessionExpiry) {
                this.currentUser = userData;
                this.isLoggedIn = true;
                console.log('ğŸ‘¤ User session restored:', this.currentUser.firstName);
            } else {
                // Session expired
                this.logout();
                console.log('⏰ Session expired');
            }
        }
    }
    
    saveUserData() {
        if (this.currentUser) {
            Utils.setStorage(APP_CONFIG.storage.user, this.currentUser);
            
            // Create session with 7 days expiry
            const session = {
                userId: this.currentUser.id,
                createdAt: new Date().toISOString(),
                expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString()
            };
            
            Utils.setStorage(APP_CONFIG.storage.session, session);
        }
    }
    
    clearUserData() {
        Utils.removeStorage(APP_CONFIG.storage.user);
        Utils.removeStorage(APP_CONFIG.storage.session);
        this.currentUser = null;
        this.isLoggedIn = false;
    }
    
    // ========== AUTHENTICATION METHODS ==========
    
    async login(email, password, rememberMe = false) {
        try {
            console.log('ğŸ” Attempting login for:', email);
            
            // Demo authentication - check against demo users
            const demoUser = this.validateDemoUser(email, password);
            
            if (demoUser) {
                this.currentUser = { ...demoUser };
                this.isLoggedIn = true;
                
                // Save user data
                this.saveUserData();
                
                // Update UI
                this.updateAuthUI();
                
                // Emit login event
                Utils.emit(document, EVENTS.USER_LOGIN, { user: this.currentUser });
                
                console.log('✅ Login successful:', this.currentUser.firstName);
                return { success: true, user: this.currentUser };
                
            } else {
                console.log('❌ Invalid credentials');
                return { success: false, error: 'Geçersiz e-posta veya şifre' };
            }
            
        } catch (error) {
            console.error('Login error:', error);
            return { success: false, error: 'Giriş sırasında bir hata oluştu' };
        }
    }
    
    async register(userData) {
        try {
            console.log('ğŸ“ Attempting registration for:', userData.email);
            
            // Check if user already exists (demo)
            const existingUser = APP_CONFIG.demo.users.find(u => u.email === userData.email);
            if (existingUser) {
                return { success: false, error: 'Bu e-posta adresi zaten kayıtlı' };
            }
            
            // Create new user
            const newUser = {
                id: Date.now(), // Simple ID generation for demo
                email: userData.email,
                firstName: userData.firstName,
                lastName: userData.lastName,
                phone: userData.phone || '',
                birthDate: userData.birthDate || '',
                createdAt: new Date().toISOString(),
                addresses: []
            };
            
            // In a real app, this would be sent to the server
            console.log('ğŸ‘¤ New user registered:', newUser);
            
            // Auto-login after registration
            this.currentUser = newUser;
            this.isLoggedIn = true;
            
            // Save user data
            this.saveUserData();
            
            // Update UI
            this.updateAuthUI();
            
            // Emit registration event
            Utils.emit(document, EVENTS.USER_REGISTER, { user: this.currentUser });
            
            return { success: true, user: this.currentUser };
            
        } catch (error) {
            console.error('Registration error:', error);
            return { success: false, error: 'Kayıt sırasında bir hata oluştu' };
        }
    }
    
    logout() {
        console.log('ğŸ‘‹ User logged out');
        
        // Clear user data
        this.clearUserData();
        
        // Update UI
        this.updateAuthUI();
        
        // Emit logout event
        Utils.emit(document, EVENTS.USER_LOGOUT);
        
        // Show success message
        (window.showSwalToast && window.showSwalToast(APP_CONFIG.success.logout, 'success'));
    }
    
    // ========== VALIDATION METHODS ==========
    
    validateDemoUser(email, password) {
        // Check against demo users
        const demoUser = APP_CONFIG.demo.users.find(user => 
            user.email === email && user.password === password
        );
        
        if (demoUser) {
            // Return user without password
            const { password: _, ...userWithoutPassword } = demoUser;
            return userWithoutPassword;
        }
        
        return null;
    }
    
    validateEmail(email) {
        return Utils.validateEmail(email);
    }
    
    validatePassword(password) {
        return Utils.validatePassword(password);
    }
    
    // ========== UI UPDATES ==========
    
    updateAuthUI() {
        const authLinks = $('#authLinks');
        const userLinks = $('#userLinks');
        const userName = $('#userName');
        
        if (this.isLoggedIn && this.currentUser) {
            // User is logged in
            if (authLinks) authLinks.style.display = 'none';
            if (userLinks) userLinks.style.display = 'block';
            if (userName) {
                userName.textContent = `Merhaba, ${this.currentUser.firstName}!`;
            }
        } else {
            // User is not logged in
            if (authLinks) authLinks.style.display = 'block';
            if (userLinks) userLinks.style.display = 'none';
        }
    }
    
    // ========== UTILITY METHODS ==========
    
    getCurrentUser() {
        return this.currentUser;
    }
    
    isAuthenticated() {
        return this.isLoggedIn;
    }
    
    hasPermission(permission) {
        // Simple permission system for demo
        if (!this.isLoggedIn) return false;
        
        switch (permission) {
            case 'order':
            case 'profile':
            case 'addresses':
                return true;
            case 'admin':
                return this.currentUser?.role === 'admin';
            default:
                return false;
        }
    }
    
    requireAuth() {
        if (!this.isLoggedIn) {
            (window.showSwalToast && window.showSwalToast('Bu işlem için giriş yapmanız gerekiyor', 'warning'));
            
            // Redirect to login page
            setTimeout(() => {
                window.location.href = 'pages/login.html';
            }, 1500);
            
            return false;
        }
        return true;
    }
    
    // ========== PASSWORD RESET ==========
    
    async requestPasswordReset(email) {
        try {
            console.log('ğŸ”‘ Password reset requested for:', email);
            
            // Check if user exists
            const userExists = APP_CONFIG.demo.users.some(u => u.email === email);
            
            if (!userExists) {
                return { success: false, error: 'Bu e-posta adresi sistemde kayıtlı değil' };
            }
            
            // Simulate sending reset email
            await new Promise(resolve => setTimeout(resolve, 1500));
            
            console.log('ğŸ“§ Password reset email sent');
            return { success: true, message: 'Şifre sıfırlama linki e-posta adresinize gönderildi' };
            
        } catch (error) {
            console.error('Password reset error:', error);
            return { success: false, error: 'Şifre sıfırlama talebinde hata oluştu' };
        }
    }
    
    async resetPassword(token, newPassword) {
        try {
            console.log('ğŸ”‘ Password reset with token:', token);
            
            // In a real app, validate token and update password
            await new Promise(resolve => setTimeout(resolve, 1000));
            
            console.log('✅ Password reset successful');
            return { success: true, message: 'Şifreniz başarıyla değiştirildi' };
            
        } catch (error) {
            console.error('Password reset error:', error);
            return { success: false, error: 'Şifre değiştirme sırasında hata oluştu' };
        }
    }
    
    // ========== PROFILE MANAGEMENT ==========
    
    async updateProfile(profileData) {
        try {
            if (!this.isLoggedIn) {
                return { success: false, error: 'Giriş yapmanız gerekiyor' };
            }
            
            console.log('ğŸ‘¤ Updating profile:', profileData);
            
            // Update current user data
            this.currentUser = { ...this.currentUser, ...profileData };
            
            // Save updated data
            this.saveUserData();
            
            // Update UI
            this.updateAuthUI();
            
            // Emit update event
            Utils.emit(document, EVENTS.USER_UPDATED, { user: this.currentUser });
            
            console.log('✅ Profile updated successfully');
            return { success: true, user: this.currentUser };
            
        } catch (error) {
            console.error('Profile update error:', error);
            return { success: false, error: 'Profil güncellenirken hata oluştu' };
        }
    }
    
    async changePassword(currentPassword, newPassword) {
        try {
            if (!this.isLoggedIn) {
                return { success: false, error: 'Giriş yapmanız gerekiyor' };
            }
            
            console.log('ğŸ” Changing password for user:', this.currentUser.email);
            
            // In a real app, verify current password and update
            await new Promise(resolve => setTimeout(resolve, 1000));
            
            console.log('✅ Password changed successfully');
            return { success: true, message: 'Şifreniz başarıyla değiştirildi' };
            
        } catch (error) {
            console.error('Password change error:', error);
            return { success: false, error: 'Şifre değiştirme sırasında hata oluştu' };
        }
    }
}

// ========== GLOBAL AUTH INSTANCE ==========

// Create global auth instance
window.Auth = new AuthSystem();

// Make auth methods available globally
window.login = (email, password, rememberMe) => Auth.login(email, password, rememberMe);
window.register = (userData) => Auth.register(userData);
window.logout = () => Auth.logout();
window.getCurrentUser = () => Auth.getCurrentUser();
window.isAuthenticated = () => Auth.isAuthenticated();
window.requireAuth = () => Auth.requireAuth(); 

// ========== UI COMPONENTS ==========

// ========== MODAL COMPONENT ==========

class Modal {
    constructor(options = {}) {
        this.options = {
            backdrop: true,
            keyboard: true,
            size: 'medium', // small, medium, large, xl
            animation: true,
            ...options
        };
        
        this.isOpen = false;
        this.element = null;
        this.backdrop = null;
        
        this.createModal();
    }
    
    createModal() {
        // Create modal element
        this.element = document.createElement('div');
        this.element.className = `modal modal-${this.options.size}`;
        this.element.setAttribute('tabindex', '-1');
        this.element.setAttribute('role', 'dialog');
        
        // Create backdrop if needed
        if (this.options.backdrop) {
            this.backdrop = document.createElement('div');
            this.backdrop.className = 'modal-backdrop';
            this.backdrop.addEventListener('click', () => {
                if (this.options.backdrop === true) {
                    this.close();
                }
            });
        }
        
        // Keyboard support
        if (this.options.keyboard) {
            document.addEventListener('keydown', (e) => {
                if (e.key === 'Escape' && this.isOpen) {
                    this.close();
                }
            });
        }
    }
    
    setContent(content) {
        if (typeof content === 'string') {
            this.element.innerHTML = content;
        } else if (content instanceof HTMLElement) {
            this.element.appendChild(content);
        }
        
        // Add close button functionality
        const closeButtons = this.element.querySelectorAll('[data-dismiss="modal"]');
        closeButtons.forEach(btn => {
            btn.addEventListener('click', () => this.close());
        });
        
        return this;
    }
    
    open() {
        if (this.isOpen) return;
        
        // Add to DOM
        if (this.backdrop) {
            document.body.appendChild(this.backdrop);
        }
        document.body.appendChild(this.element);
        
        // Add body class
        document.body.classList.add('modal-open');
        
        // Show modal
        requestAnimationFrame(() => {
            this.element.classList.add('show');
            if (this.backdrop) {
                this.backdrop.classList.add('show');
            }
        });
        
        this.isOpen = true;
        
        // Focus management
        this.element.focus();
        
        return this;
    }
    
    close() {
        if (!this.isOpen) return;
        
        // Hide modal
        this.element.classList.remove('show');
        if (this.backdrop) {
            this.backdrop.classList.remove('show');
        }
        
        // Remove from DOM after animation
        setTimeout(() => {
            if (this.element.parentNode) {
                this.element.parentNode.removeChild(this.element);
            }
            if (this.backdrop && this.backdrop.parentNode) {
                this.backdrop.parentNode.removeChild(this.backdrop);
            }
            
            // Remove body class if no other modals
            if (!document.querySelector('.modal.show')) {
                document.body.classList.remove('modal-open');
            }
        }, this.options.animation ? 300 : 0);
        
        this.isOpen = false;
        
        return this;
    }
    
    static createFromTemplate(templateContent, options = {}) {
        const modal = new Modal(options);
        modal.setContent(templateContent);
        return modal;
    }
}

// ========== LOADING COMPONENT ==========

class LoadingSpinner {
    constructor(options = {}) {
        this.options = {
            size: 'medium', // small, medium, large
            color: 'primary',
            overlay: false,
            message: '',
            ...options
        };
        
        this.element = null;
        this.isVisible = false;
        this.createSpinner();
    }
    
    createSpinner() {
        this.element = document.createElement('div');
        this.element.className = `loading-spinner loading-${this.options.size} loading-${this.options.color}`;
        
        if (this.options.overlay) {
            this.element.classList.add('loading-overlay');
        }
        
        // Create spinner HTML
        this.element.innerHTML = `
            <div class="spinner">
                <div class="spinner-border" role="status">
                    <span class="sr-only">Yükleniyor...</span>
                </div>
            </div>
            ${this.options.message ? `<div class="loading-message">${this.options.message}</div>` : ''}
        `;
    }
    
    show(container = document.body) {
        if (this.isVisible) return;
        
        container.appendChild(this.element);
        
        requestAnimationFrame(() => {
            this.element.classList.add('show');
        });
        
        this.isVisible = true;
        return this;
    }
    
    hide() {
        if (!this.isVisible) return;
        
        this.element.classList.remove('show');
        
        setTimeout(() => {
            if (this.element.parentNode) {
                this.element.parentNode.removeChild(this.element);
            }
        }, 300);
        
        this.isVisible = false;
        return this;
    }
    
    setMessage(message) {
        const messageElement = this.element.querySelector('.loading-message');
        if (messageElement) {
            messageElement.textContent = message;
        } else if (message) {
            const messageDiv = document.createElement('div');
            messageDiv.className = 'loading-message';
            messageDiv.textContent = message;
            this.element.appendChild(messageDiv);
        }
        return this;
    }
}

// ========== NOTIFICATION COMPONENT ==========

class Notification {
    constructor(message, type = 'info', options = {}) {
        this.message = message;
        this.type = type; // success, error, warning, info
        this.options = {
            duration: 5000,
            closable: true,
            position: 'top-right', // top-right, top-left, bottom-right, bottom-left
            icon: true,
            ...options
        };
        
        this.element = null;
        this.timeout = null;
        this.createNotification();
    }
    
    createNotification() {
        this.element = document.createElement('div');
        this.element.className = `notification notification-${this.type}`;
        
        // Get icon based on type
        const icons = {
            success: 'fas fa-check-circle',
            error: 'fas fa-exclamation-circle',
            warning: 'fas fa-exclamation-triangle',
            info: 'fas fa-info-circle'
        };
        
        const icon = this.options.icon ? `<i class="${icons[this.type]}"></i>` : '';
        const closeBtn = this.options.closable ? '<button class="notification-close"><i class="fas fa-times"></i></button>' : '';
        
        this.element.innerHTML = `
            ${icon}
            <div class="notification-content">${this.message}</div>
            ${closeBtn}
        `;
        
        // Add close functionality
        if (this.options.closable) {
            const closeButton = this.element.querySelector('.notification-close');
            closeButton.addEventListener('click', () => this.close());
        }
    }
    
    show() {
        // Create container if not exists
        let container = document.querySelector('.notification-container');
        if (!container) {
            container = document.createElement('div');
            container.className = `notification-container notification-${this.options.position}`;
            document.body.appendChild(container);
        }
        
        // Add to container
        container.appendChild(this.element);
        
        // Show with animation
        requestAnimationFrame(() => {
            this.element.classList.add('show');
        });
        
        // Auto close
        if (this.options.duration > 0) {
            this.timeout = setTimeout(() => {
                this.close();
            }, this.options.duration);
        }
        
        return this;
    }
    
    close() {
        if (this.timeout) {
            clearTimeout(this.timeout);
        }
        
        this.element.classList.remove('show');
        this.element.classList.add('hiding');
        
        setTimeout(() => {
            if (this.element.parentNode) {
                this.element.parentNode.removeChild(this.element);
            }
        }, 300);
        
        return this;
    }
    
    static show(message, type = 'info', options = {}) {
        return new Notification(message, type, options).show();
    }
}

// ========== TOOLTIP COMPONENT ==========

class Tooltip {
    constructor(element, options = {}) {
        this.element = element;
        this.options = {
            title: element.getAttribute('title') || element.dataset.tooltip || '',
            placement: element.dataset.placement || 'top',
            trigger: 'hover', // hover, click, focus
            delay: 100,
            ...options
        };
        
        this.tooltip = null;
        this.isVisible = false;
        this.init();
    }
    
    init() {
        // Remove default title to prevent browser tooltip
        this.element.removeAttribute('title');
        
        // Add event listeners based on trigger
        if (this.options.trigger === 'hover') {
            this.element.addEventListener('mouseenter', () => this.show());
            this.element.addEventListener('mouseleave', () => this.hide());
        } else if (this.options.trigger === 'click') {
            this.element.addEventListener('click', () => this.toggle());
        } else if (this.options.trigger === 'focus') {
            this.element.addEventListener('focus', () => this.show());
            this.element.addEventListener('blur', () => this.hide());
        }
    }
    
    createTooltip() {
        this.tooltip = document.createElement('div');
        this.tooltip.className = `tooltip tooltip-${this.options.placement}`;
        this.tooltip.innerHTML = `
            <div class="tooltip-arrow"></div>
            <div class="tooltip-inner">${this.options.title}</div>
        `;
        
        document.body.appendChild(this.tooltip);
    }
    
    show() {
        if (this.isVisible || !this.options.title) return;
        
        setTimeout(() => {
            if (!this.tooltip) {
                this.createTooltip();
            }
            
            this.updatePosition();
            this.tooltip.classList.add('show');
            this.isVisible = true;
        }, this.options.delay);
    }
    
    hide() {
        if (!this.isVisible) return;
        
        this.tooltip.classList.remove('show');
        this.isVisible = false;
        
        setTimeout(() => {
            if (this.tooltip && this.tooltip.parentNode) {
                this.tooltip.parentNode.removeChild(this.tooltip);
                this.tooltip = null;
            }
        }, 300);
    }
    
    toggle() {
        if (this.isVisible) {
            this.hide();
        } else {
            this.show();
        }
    }
    
    updatePosition() {
        if (!this.tooltip) return;
        
        const rect = this.element.getBoundingClientRect();
        const tooltipRect = this.tooltip.getBoundingClientRect();
        
        let top, left;
        
        switch (this.options.placement) {
            case 'top':
                top = rect.top - tooltipRect.height - 8;
                left = rect.left + (rect.width - tooltipRect.width) / 2;
                break;
            case 'bottom':
                top = rect.bottom + 8;
                left = rect.left + (rect.width - tooltipRect.width) / 2;
                break;
            case 'left':
                top = rect.top + (rect.height - tooltipRect.height) / 2;
                left = rect.left - tooltipRect.width - 8;
                break;
            case 'right':
                top = rect.top + (rect.height - tooltipRect.height) / 2;
                left = rect.right + 8;
                break;
        }
        
        this.tooltip.style.top = `${top}px`;
        this.tooltip.style.left = `${left}px`;
    }
    
    static init(selector = '[data-tooltip]') {
        document.querySelectorAll(selector).forEach(element => {
            if (!element._tooltip) {
                element._tooltip = new Tooltip(element);
            }
        });
    }
}

// ========== DROPDOWN COMPONENT ==========

class Dropdown {
    constructor(trigger, options = {}) {
        this.trigger = trigger;
        this.options = {
            placement: 'bottom-start',
            offset: 4,
            closeOnClick: true,
            ...options
        };
        
        this.dropdown = null;
        this.isOpen = false;
        this.init();
    }
    
    init() {
        // Find dropdown menu
        this.dropdown = this.trigger.nextElementSibling;
        if (!this.dropdown || !this.dropdown.classList.contains('dropdown-menu')) {
            console.warn('Dropdown menu not found');
            return;
        }
        
        // Add trigger event
        this.trigger.addEventListener('click', (e) => {
            e.preventDefault();
            this.toggle();
        });
        
        // Close on outside click
        document.addEventListener('click', (e) => {
            if (this.isOpen && !this.trigger.contains(e.target) && !this.dropdown.contains(e.target)) {
                this.close();
            }
        });
        
        // Close on item click if enabled
        if (this.options.closeOnClick) {
            this.dropdown.addEventListener('click', (e) => {
                if (e.target.classList.contains('dropdown-item')) {
                    this.close();
                }
            });
        }
    }
    
    open() {
        if (this.isOpen) return;
        
        this.dropdown.classList.add('show');
        this.trigger.classList.add('active');
        this.isOpen = true;
        
        // Position dropdown
        this.updatePosition();
    }
    
    close() {
        if (!this.isOpen) return;
        
        this.dropdown.classList.remove('show');
        this.trigger.classList.remove('active');
        this.isOpen = false;
    }
    
    toggle() {
        if (this.isOpen) {
            this.close();
        } else {
            this.open();
        }
    }
    
    updatePosition() {
        // Simple positioning - can be enhanced with more sophisticated logic
        const rect = this.trigger.getBoundingClientRect();
        const dropdownRect = this.dropdown.getBoundingClientRect();
        
        // Check if dropdown goes off screen and adjust
        if (rect.left + dropdownRect.width > window.innerWidth) {
            this.dropdown.style.left = 'auto';
            this.dropdown.style.right = '0';
        }
    }
    
    static init(selector = '.dropdown-toggle') {
        document.querySelectorAll(selector).forEach(trigger => {
            if (!trigger._dropdown) {
                trigger._dropdown = new Dropdown(trigger);
            }
        });
    }
}

// ========== TABS COMPONENT ==========

class Tabs {
    constructor(container, options = {}) {
        this.container = container;
        this.options = {
            activeClass: 'active',
            animation: true,
            ...options
        };
        
        this.tabs = [];
        this.panels = [];
        this.activeIndex = 0;
        
        this.init();
    }
    
    init() {
        // Find tabs and panels
        this.tabs = Array.from(this.container.querySelectorAll('.tab-trigger'));
        this.panels = Array.from(this.container.querySelectorAll('.tab-panel'));
        
        // Add click events
        this.tabs.forEach((tab, index) => {
            tab.addEventListener('click', (e) => {
                e.preventDefault();
                this.activate(index);
            });
        });
        
        // Find initially active tab
        const activeTab = this.tabs.findIndex(tab => 
            tab.classList.contains(this.options.activeClass)
        );
        
        if (activeTab !== -1) {
            this.activeIndex = activeTab;
        }
        
        // Activate initial tab
        this.activate(this.activeIndex);
    }
    
    activate(index) {
        if (index < 0 || index >= this.tabs.length || index === this.activeIndex) {
            return;
        }
        
        // Deactivate current
        this.tabs[this.activeIndex].classList.remove(this.options.activeClass);
        this.panels[this.activeIndex].classList.remove(this.options.activeClass);
        
        // Activate new
        this.tabs[index].classList.add(this.options.activeClass);
        this.panels[index].classList.add(this.options.activeClass);
        
        this.activeIndex = index;
        
        // Emit event
        Utils.emit(this.container, 'tab:activated', {
            tab: this.tabs[index],
            panel: this.panels[index],
            index: index
        });
    }
    
    static init(selector = '.tabs') {
        document.querySelectorAll(selector).forEach(container => {
            if (!container._tabs) {
                container._tabs = new Tabs(container);
            }
        });
    }
}

// ========== COMPONENT INITIALIZATION ==========

// Auto-initialize components when DOM is ready
document.addEventListener('DOMContentLoaded', () => {
    // Initialize tooltips
    Tooltip.init();
    
    // Initialize dropdowns
    Dropdown.init();
    
    // Initialize tabs
    Tabs.init();
});

// Re-initialize on dynamic content
Utils.on(document, 'content:updated', () => {
    Tooltip.init();
    Dropdown.init();
    Tabs.init();
});

// ========== GLOBAL EXPORTS ==========

window.Modal = Modal;
window.LoadingSpinner = LoadingSpinner;
window.Notification = Notification;
window.Tooltip = Tooltip;
window.Dropdown = Dropdown;
window.Tabs = Tabs; 

// ========== SHOPPING CART SYSTEM ==========

class CartSystem {
    constructor() {
        this.items = [];
        this.total = 0;
        this.deliveryFee = APP_CONFIG.order.deliveryFee;
        this.minOrderAmount = APP_CONFIG.order.minOrderAmount;
        this.init();
    }
    
    init() {
        // Load saved cart data
        this.loadCart();
        
        // Update cart display
        this.updateCartDisplay();
    }
    
    // ========== CART DATA MANAGEMENT ==========
    
    loadCart() {
        // Use the same localStorage key as menu.js
        const cartData = Utils.getStorage('yeppos_cart', []);
        this.items = Array.isArray(cartData) ? cartData : [];
        this.calculateTotal();
    }
    
    saveCart() {
        // Use the same localStorage key as menu.js
        Utils.setStorage('yeppos_cart', this.items);
        console.log('ğŸ’¾ Cart saved to localStorage:', this.items.length, 'items');
    }
    
    clearCart() {
        this.items = [];
        this.total = 0;
        this.saveCart();
        this.updateCartDisplay();
        
        // Emit cart cleared event
        Utils.emit(document, EVENTS.CART_CLEARED);
        
        console.log('ğŸ—‘ï¸ Cart cleared');
    }
    
    // ========== CART OPERATIONS ==========
    
    addItem(product, quantity = 1, options = {}) {
        try {
            // Validate product
            if (!product || !product.id) {
                throw new Error('Geçersiz ürün');
            }
            
            // Validate quantity
            if (quantity <= 0 || quantity > APP_CONFIG.ui.cart.maxQuantity) {
                throw new Error(`Miktar 1 ile ${APP_CONFIG.ui.cart.maxQuantity} arasında olmalıdır`);
            }
            
            // Create cart item
            // Preserve addedAt if provided (for updates)
            const preserveAddedAt = options && options._preserveAddedAt ? options._preserveAddedAt : null;
            // Remove _preserveAddedAt from options before saving
            const cleanOptions = { ...options };
            delete cleanOptions._preserveAddedAt;
            
            const cartItem = {
                id: this.generateCartItemId(product.id, cleanOptions),
                productId: product.id,
                name: product.name,
                price: product.price,
                quantity: quantity,
                options: cleanOptions,
                image: product.image || null,
                category: product.category || null,
                addedAt: preserveAddedAt || new Date().toISOString()
            };
            
            // Check if item already exists
            const existingItemIndex = this.items.findIndex(item => item.id === cartItem.id);
            
            if (existingItemIndex !== -1) {
                // Update existing item quantity
                const newQuantity = this.items[existingItemIndex].quantity + quantity;
                
                if (newQuantity > APP_CONFIG.ui.cart.maxQuantity) {
                    throw new Error(`Maximum ${APP_CONFIG.ui.cart.maxQuantity} adet ekleyebilirsiniz`);
                }
                
                this.items[existingItemIndex].quantity = newQuantity;
                console.log('ğŸ“¦ Updated cart item:', cartItem.name, 'x', newQuantity);
            } else {
                // Add new item
                this.items.push(cartItem);
                console.log('➕ Added to cart:', cartItem.name, 'x', quantity);
            }
            
            // Update cart
            this.calculateTotal();
            this.saveCart();
            this.updateCartDisplay();
            
            // Emit cart updated event
            Utils.emit(document, EVENTS.CART_ITEM_ADDED, { item: cartItem });
            Utils.emit(document, EVENTS.CART_UPDATED);
            
            // Show success message
            (window.showSwalToast && window.showSwalToast(`${product.name} sepete eklendi`, 'success'));
            
            return { success: true, item: cartItem };
            
        } catch (error) {
            console.error('Add to cart error:', error);
            (window.showSwalToast && window.showSwalToast(error.message, 'error'));
            return { success: false, error: error.message };
        }
    }
    
    updateItemQuantity(cartItemId, newQuantity) {
        try {
            if (newQuantity <= 0) {
                return this.removeItem(cartItemId);
            }
            
            if (newQuantity > APP_CONFIG.ui.cart.maxQuantity) {
                throw new Error(`Maximum ${APP_CONFIG.ui.cart.maxQuantity} adet olabilir`);
            }
            
            const itemIndex = this.items.findIndex(item => item.id === cartItemId);
            
            if (itemIndex === -1) {
                throw new Error('Ürün sepette bulunamadı');
            }
            
            const oldQuantity = this.items[itemIndex].quantity;
            this.items[itemIndex].quantity = newQuantity;
            
            console.log('ğŸ”„ Updated quantity:', this.items[itemIndex].name, oldQuantity, '->', newQuantity);
            
            // Update cart
            this.calculateTotal();
            this.saveCart();
            this.updateCartDisplay();
            
            // Emit cart updated event
            Utils.emit(document, EVENTS.CART_ITEM_UPDATED, { 
                item: this.items[itemIndex],
                oldQuantity,
                newQuantity
            });
            Utils.emit(document, EVENTS.CART_UPDATED);
            
            return { success: true, item: this.items[itemIndex] };
            
        } catch (error) {
            console.error('Update quantity error:', error);
            (window.showSwalToast && window.showSwalToast(error.message, 'error'));
            return { success: false, error: error.message };
        }
    }
    
    removeItem(cartItemId) {
        try {
            const itemIndex = this.items.findIndex(item => item.id === cartItemId);
            
            if (itemIndex === -1) {
                throw new Error('Ürün sepette bulunamadı');
            }
            
            const removedItem = this.items.splice(itemIndex, 1)[0];
            
            console.log('ğŸ—‘ï¸ Removed from cart:', removedItem.name);
            
            // Update cart
            this.calculateTotal();
            this.saveCart();
            this.updateCartDisplay();
            
            // Emit cart updated event
            Utils.emit(document, EVENTS.CART_ITEM_REMOVED, { item: removedItem });
            Utils.emit(document, EVENTS.CART_UPDATED);
            
            // Show success message
            (window.showSwalToast && window.showSwalToast(`${removedItem.name} sepetten çıkarıldı`, 'info'));
            
            return { success: true, item: removedItem };
            
        } catch (error) {
            console.error('Remove item error:', error);
            (window.showSwalToast && window.showSwalToast(error.message, 'error'));
            return { success: false, error: error.message };
        }
    }
    
    // ========== CART CALCULATIONS ==========
    
    calculateTotal() {
        this.total = this.items.reduce((sum, item) => {
            return sum + (item.price * item.quantity);
        }, 0);
        
        return this.total;
    }
    
    getSubTotal() {
        return this.total;
    }
    
    getDeliveryFee() {
        // Free delivery for orders above certain amount
        if (this.total >= 50) {
            return 0;
        }
        
        return this.items.length > 0 ? this.deliveryFee : 0;
    }
    
    getGrandTotal() {
        return this.getSubTotal() + this.getDeliveryFee();
    }
    
    getTotalItems() {
        return this.items.reduce((sum, item) => sum + item.quantity, 0);
    }
    
    isMinimumMet() {
        return this.total >= this.minOrderAmount;
    }
    
    // ========== CART UTILITIES ==========
    
    generateCartItemId(productId, options = {}) {
        // Create unique ID based on product and options
        const optionsString = JSON.stringify(options);
        // Unicode uyumlu base64
        const safeBase64 = typeof btoa === 'function' ? btoa(unescape(encodeURIComponent(optionsString))).slice(0, 8) : '';
        return `${productId}_${Utils.generateId('cart').split('_')[2]}_${safeBase64}`;
    }
    
    findItemById(cartItemId) {
        return this.items.find(item => item.id === cartItemId);
    }
    
    hasItem(productId, options = {}) {
        const itemId = this.generateCartItemId(productId, options);
        return this.items.some(item => item.id === itemId);
    }
    
    getItemQuantity(productId, options = {}) {
        const itemId = this.generateCartItemId(productId, options);
        const item = this.items.find(item => item.id === itemId);
        return item ? item.quantity : 0;
    }
    
    isEmpty() {
        return this.items.length === 0;
    }
    
    getItems() {
        return [...this.items]; // Return copy to prevent external modification
    }
    
    getItemCount() {
        return this.items.length;
    }
    
    // ========== GLOBAL CART COMPATIBILITY METHODS ==========
    
    get cart() {
        return this.items;
    }
    
    getCartItemCount() {
        return this.getTotalItems();
    }
    
    getCartTotal() {
        return this.total;
    }
    
    calculateItemPrice(item) {
        // If item already has price, use it
        if (item.price && item.price > 0) {
            return item.price;
        }
        
        // Calculate from basePrice if available
        let totalPrice = item.basePrice || item.price || 0;
        
        // Add size price if exists
        if (item.options && item.options.size) {
            let product = null;
            if (window.menuPage && window.menuPage.products) {
                product = window.menuPage.products.find(p => p.id === item.productId);
            }
            
            if (product && product.sizeOptions) {
                const sizeOption = product.sizeOptions.find(opt => 
                    opt.name.toLowerCase() === item.options.size.toLowerCase()
                );
                if (sizeOption) {
                    totalPrice += sizeOption.price || 0;
                }
            }
        }
        
        // Add extras prices if exist
        if (item.options && item.options.extras && Array.isArray(item.options.extras)) {
            let product = null;
            if (window.menuPage && window.menuPage.products) {
                product = window.menuPage.products.find(p => p.id === item.productId);
            }
            
            if (product && product.extraOptions) {
                item.options.extras.forEach(extraName => {
                    const extraOption = product.extraOptions.find(opt => 
                        opt.name.toLowerCase() === extraName.toLowerCase()
                    );
                    if (extraOption) {
                        totalPrice += extraOption.price || 0;
                    }
                });
            }
        }
        
        return totalPrice;
    }
    
    // Alias for menu.js compatibility
    addToCart(product, quantity, options, totalPrice) {
        if (!product) {
            return;
        }
        
        // Preserve addedAt if provided (for updates)
        const preserveAddedAt = options && options._preserveAddedAt ? options._preserveAddedAt : null;
        // Remove _preserveAddedAt from options before saving
        const cleanOptions = { ...(options || {}) };
        delete cleanOptions._preserveAddedAt;
        
        const cartSystem = window.Cart || this;
        let id = null;
        if (cartSystem && typeof cartSystem.generateCartItemId === 'function') {
            id = cartSystem.generateCartItemId(product.id, cleanOptions);
        }
        
        const basePrice = parseFloat(product.basePrice ?? product.price) || 0;
        const cartItem = {
            id: id || (product.id + '_' + Date.now()),
            productId: product.id,
            name: product.name,
            image: product.image,
            image_source: product.image_source || "product",
            quantity: quantity,
            price: totalPrice,
            basePrice: basePrice,
            options: cleanOptions,
            addedAt: preserveAddedAt || new Date().toISOString()
        };
        
        // Check if item already exists
        const existingItemIndex = this.items.findIndex(item => item.id === cartItem.id);
        
        if (existingItemIndex !== -1) {
            // Update existing item quantity, preserve addedAt
            this.items[existingItemIndex].quantity += quantity;
            if (preserveAddedAt) {
                this.items[existingItemIndex].addedAt = preserveAddedAt;
            }
        } else {
            // Add new item
            this.items.push(cartItem);
        }
        
        this.calculateTotal();
        this.saveCart();
        this.updateCartDisplay();
    }
    
    // Alias for menu.js compatibility
    removeFromCart(cartItemId) {
        const initialLength = this.items.length;
        this.items = this.items.filter(item => item.id !== cartItemId);
        
        if (this.items.length < initialLength) {
            this.calculateTotal();
            this.saveCart();
            this.updateCartDisplay();
        }
    }
    
    // Alias for menu.js compatibility
    updateCartQuantity(cartItemId, newQuantity) {
        const item = this.items.find(item => item.id === cartItemId);
        if (item) {
            if (newQuantity <= 0) {
                this.removeFromCart(cartItemId);
            } else {
                item.quantity = newQuantity;
                this.calculateTotal();
                this.saveCart();
                this.updateCartDisplay();
            }
        }
    }
    
    // Cart drawer methods (for menu page)
    renderCartItems() {
        // Only render cart items on menu page
        if (window.location.pathname && !window.location.pathname.includes('menu')) {
            return;
        }
        
        const cartItemsContainer = document.getElementById('cartDrawerItems');
        const cartEmpty = document.getElementById('cartEmpty');
        const cartFooter = document.getElementById('cartDrawerFooter');
        const cartTotalAmount = document.getElementById('cartTotalAmount');
        
        if (!cartItemsContainer) {
            return;
        }
        
        if (this.items.length === 0) {
            if (cartEmpty) cartEmpty.style.display = 'block';
            if (cartFooter) cartFooter.style.display = 'none';
            return;
        }
        
        if (cartEmpty) cartEmpty.style.display = 'none';
        if (cartFooter) cartFooter.style.display = 'block';
        
        // Render cart items
        cartItemsContainer.innerHTML = '';
        
        this.items.forEach(item => {
            // Ensure options structure exists
            if (!item.options) {
                item.options = { size: null, extras: [], notes: '' };
            }
            if (!item.options.extras) {
                item.options.extras = [];
            }
            
            // Calculate total price including options and quantity
            const unitPrice = this.calculateItemPrice(item);
            const totalPrice = unitPrice * item.quantity;
            
            const cartItem = document.createElement('div');
            cartItem.className = 'cart-item';
            cartItem.innerHTML = `
                <div class="cart-item-image">
                    <img src="${item.image || ''}" alt="${item.name}">
                </div>
                <div class="cart-item-details">
                    <h4 class="cart-item-name">${item.name}</h4>
                    <div class="cart-item-options">
                        ${item.options.size ? `<span class="cart-option">Boyut: ${item.options.size}</span>` : ''}
                        ${item.options.extras && item.options.extras.length > 0 ? 
                            `<span class="cart-option">Ekstra: ${item.options.extras.join(', ')}</span>` : ''}
                    </div>
                    <div class="cart-item-price">${totalPrice.toFixed(2)}</div>
                </div>
                <div class="cart-item-actions">
                    <div class="cart-item-quantity">
                        <button class="quantity-btn minus" onclick="window.globalCart.updateCartQuantity('${item.id}', ${item.quantity - 1})">
                            <i class="fas fa-minus"></i>
                        </button>
                        <span class="quantity-display">${item.quantity}</span>
                        <button class="quantity-btn plus" onclick="window.globalCart.updateCartQuantity('${item.id}', ${item.quantity + 1})">
                            <i class="fas fa-plus"></i>
                        </button>
                    </div>
                    <button class="remove-item-btn" onclick="window.globalCart.removeFromCart('${item.id}')">
                        <i class="fas fa-trash"></i>
                    </button>
                </div>
            `;
            cartItemsContainer.appendChild(cartItem);
        });
        
        // Update total
        if (cartTotalAmount) {
            cartTotalAmount.textContent = this.getCartTotal().toFixed(2) + '';
        }
    }
    
    openCartDrawer() {
        const cartDrawerOverlay = document.getElementById('cartDrawerOverlay');
        if (!cartDrawerOverlay) {
            return;
        }
        
        // Only render cart items on menu page (where cart drawer HTML exists)
        const isMenuPage = window.location.pathname && window.location.pathname.includes('menu');
        if (isMenuPage) {
            this.renderCartItems();
        }
        
        cartDrawerOverlay.classList.add('active');
        document.body.style.overflow = 'hidden';
        
        // Hide cart button
        if (window.hideCartButtons) {
            window.hideCartButtons();
        }
    }
    
    closeCartDrawer() {
        const cartDrawerOverlay = document.getElementById('cartDrawerOverlay');
        if (cartDrawerOverlay) {
            cartDrawerOverlay.classList.remove('active');
        }
        
        // Only enable scroll if no other modal is open
        const productModal = document.querySelector('.product-modal-overlay');
        if (!productModal || !productModal.classList.contains('active')) {
            document.body.style.overflow = '';
        }
        
        // Show cart button
        if (window.showCartButtons) {
            window.showCartButtons();
        }
    }
    
    // ========== UI UPDATES ==========
    
    updateCartDisplay() {
        this.updateCartCount();
        this.updateCartIcon();
        
        // Also update cart drawer if it's open (only on menu page)
        if (window.location.pathname && window.location.pathname.includes('menu')) {
            this.renderCartItems();
        }
    }
    
    updateCartCount() {
        // Use requestAnimationFrame to ensure DOM is ready
        requestAnimationFrame(() => {
            const cartCounts = document.querySelectorAll('.cart-count, #cartCount, .mobile-cart-count, #mobileCartCount, #fixedCartCount, #desktopCartBadge');
            const totalItems = this.getTotalItems();
            
            cartCounts.forEach(element => {
                if (element) {
                    element.textContent = totalItems;
                    element.style.display = totalItems > 0 ? 'flex' : 'none';
                }
            });
            
            // Also update desktop cart badge specifically
            const desktopCartBadge = document.getElementById('desktopCartBadge');
            if (desktopCartBadge) {
                desktopCartBadge.textContent = totalItems;
                desktopCartBadge.style.display = totalItems > 0 ? 'flex' : 'none';
            }
        });
    }
    
    updateCartIcon() {
        const cartButtons = $$('.cart-btn');
        const hasItems = !this.isEmpty();
        
        cartButtons.forEach(button => {
            if (hasItems) {
                button.classList.add('has-items');
            } else {
                button.classList.remove('has-items');
            }
        });
    }
    
    // ========== CART VALIDATION ==========
    
    validateCart() {
        const errors = [];
        
        if (this.isEmpty()) {
            errors.push('Sepetiniz boş');
        }
        
        if (!this.isMinimumMet()) {
            errors.push(`Minimum sipariş tutarı ${Utils.formatPrice(this.minOrderAmount)}`);
        }
        
        // Check for invalid items
        this.items.forEach(item => {
            if (!item.productId || !item.name || !item.price || !item.quantity) {
                errors.push(`Geçersiz ürün: ${item.name || 'Bilinmeyen'}`);
            }
            
            if (item.quantity > APP_CONFIG.ui.cart.maxQuantity) {
                errors.push(`${item.name} için maksimum miktar aşıldı`);
            }
        });
        
        return {
            isValid: errors.length === 0,
            errors: errors
        };
    }
    
    // ========== CART SUMMARY ==========
    
    getSummary() {
        return {
            items: this.getItems(),
            itemCount: this.getItemCount(),
            totalItems: this.getTotalItems(),
            subTotal: this.getSubTotal(),
            deliveryFee: this.getDeliveryFee(),
            grandTotal: this.getGrandTotal(),
            isMinimumMet: this.isMinimumMet(),
            isEmpty: this.isEmpty()
        };
    }
    
    // ========== DEMO PRODUCTS ==========
    
    getDemoProduct(productId) {
        // Demo product data for testing
        const demoProducts = {};
        
        return demoProducts[productId] || null;
    }
    
    // ========== CART PERSISTENCE ==========
    
    exportCart() {
        return {
            items: this.items,
            total: this.total,
            exportedAt: new Date().toISOString()
        };
    }
    
    importCart(cartData) {
        try {
            if (!cartData || !Array.isArray(cartData.items)) {
                throw new Error('Geçersiz sepet verisi');
            }
            
            this.items = cartData.items;
            this.calculateTotal();
            this.saveCart();
            this.updateCartDisplay();
            
            console.log('ğŸ“¥ Cart imported:', this.items.length, 'items');
            (window.showSwalToast && window.showSwalToast('Sepet yüklendi', 'success'));
            
            return { success: true };
            
        } catch (error) {
            console.error('Import cart error:', error);
            (window.showSwalToast && window.showSwalToast(error.message, 'error'));
            return { success: false, error: error.message };
        }
    }
}

// ========== GLOBAL CART INSTANCE ==========

// Create global cart instance
window.Cart = new CartSystem();
window.globalCart = window.Cart; // Alias for compatibility

// Make cart methods available globally
window.addToCart = (product, quantity, options) => Cart.addItem(product, quantity, options);
window.updateCartQuantity = (itemId, quantity) => Cart.updateItemQuantity(itemId, quantity);
window.removeFromCart = (itemId) => Cart.removeItem(itemId);
window.clearCart = () => Cart.clearCart();
window.getCartSummary = () => Cart.getSummary();
window.getCartItems = () => Cart.getItems();

// Initialize cart drawer listeners (for menu page)
document.addEventListener('DOMContentLoaded', function() {
    // Add cart button listeners (only on menu page)
    const cartButtons = document.querySelectorAll('.cart-btn, .mobile-action-btn[href*="cart"], .action-btn[href*="cart"]');
    cartButtons.forEach(btn => {
        btn.addEventListener('click', (e) => {
            // Only prevent default and open cart drawer on menu page
            if (window.location.pathname && window.location.pathname.includes('menu')) {
                e.preventDefault();
                window.globalCart.openCartDrawer();
            }
        });
    });
    
    // Add cart drawer close listeners
    const cartDrawerClose = document.getElementById('cartDrawerClose');
    if (cartDrawerClose) {
        cartDrawerClose.addEventListener('click', () => window.globalCart.closeCartDrawer());
    }
    
    const cartDrawerOverlay = document.getElementById('cartDrawerOverlay');
    if (cartDrawerOverlay) {
        cartDrawerOverlay.addEventListener('click', (e) => {
            if (e.target === cartDrawerOverlay) {
                window.globalCart.closeCartDrawer();
            }
        });
    }
}); 

// Modern Cart Page Dynamic Render
function renderCartItems() {
  const cartItemsEl = document.getElementById('cartItems');
  const cartDrawerItemsEl = document.getElementById('cartDrawerItems');
  const cartSummary = document.getElementById('cartSummary');
  const subtotalAmount = document.getElementById('subtotalAmount');
  const totalAmount = document.getElementById('totalAmount');
  const discountAmount = document.getElementById('discountAmount');
  const discountRow = document.getElementById('discountRow');
  const deliveryAmount = document.getElementById('deliveryAmount');
  const taxAmount = document.getElementById('taxAmount');
  // Sepet verisini global Cart objesinden veya localStorage'dan al
  const cart = window.Cart || (window.CartSystem ? window.CartSystem : null);
  const items = cart && typeof cart.getItems === 'function' ? cart.getItems() : (cart && cart.items ? cart.items : []);
  if (!items || items.length === 0) {
    if (cartItemsEl) cartItemsEl.innerHTML = '<div class="cart-empty"><img src="/assets/brand/favicon.png" alt="Sepet" class="cart-empty-icon"><p>Sepetiniz boş</p></div>';
    if (cartDrawerItemsEl) cartDrawerItemsEl.innerHTML = '<div class="cart-empty"><img src="/assets/brand/favicon.png" alt="Sepet" class="cart-empty-icon"><p>Sepetiniz boş</p></div>';
    if (cartSummary) cartSummary.style.display = 'none';
    return;
  }
  let html = '';
  let drawerHtml = '';
  let hasLegacyId = false;
  items.forEach(item => {
    if (typeof item.id === 'number' || (typeof item.id === 'string' && !item.id.includes('_'))) {
      hasLegacyId = true;
    }
    
    // Yeni tasarım: Resim solda, bilgiler ortada, butonlar sağda
    const itemHtml = `<div class="cart-item">
      <!-- Resim (Sol) -->
      <div class="cart-item-image">
        <img src="${item.image || ''}" alt="${item.name}">
      </div>
      
      <!-- Bilgiler (Orta) -->
      <div class="cart-item-info">
        <div class="cart-item-name">${item.name}</div>
        <div class="cart-item-details">
          <div class="cart-item-size">Boyut: ${item.options && item.options.size ? item.options.size : 'Standart'}</div>
          <div class="cart-item-extras">Ekstra: ${formatCartItemOptions(item.options)}</div>
        </div>
        <div class="cart-item-price">${parseFloat(item.price || 0).toFixed(2)}</div>
      </div>
      
      <!-- Butonlar (Sağ) -->
      <div class="cart-item-actions">
        <!-- Miktar Kontrolü -->
        <div class="cart-item-quantity">
          <button class="quantity-btn minus" onclick="updateCartQuantity('${item.id}', ${item.quantity - 1})">
            <i class="fas fa-minus"></i>
          </button>
          <span class="quantity-display">${item.quantity}</span>
          <button class="quantity-btn plus" onclick="updateCartQuantity('${item.id}', ${item.quantity + 1})">
            <i class="fas fa-plus"></i>
          </button>
        </div>
        
        <!-- Düzenle ve Sil Butonları -->
        <div class="cart-item-buttons">
          <button class="edit-item-btn" onclick="openCartItemModal('${item.id}')" title="Düzenle">
            <i class="fas fa-edit"></i>
          </button>
          <button class="remove-item-btn" onclick="removeFromCart('${item.id}')" title="Sil">
            <i class="fas fa-trash"></i>
          </button>
        </div>
      </div>
    </div>`;
    
    html += itemHtml;
    drawerHtml += itemHtml;
  });
  
  if (cartItemsEl) cartItemsEl.innerHTML = html;
  if (cartDrawerItemsEl) cartDrawerItemsEl.innerHTML = drawerHtml;
  if (cartSummary) cartSummary.style.display = '';
  if (hasLegacyId) {
    setTimeout(() => {
     // alert('Sepetinizde eski formatta ürünler var. Lütfen sepeti temizleyip tekrar ekleyin.');
    }, 500);
  }
}

// Adet artır/azalt ve sil fonksiyonları
globalThis.updateCartQuantity = function(id, qty) {
  const cart = window.Cart || (window.CartSystem ? window.CartSystem : null);
  if (!cart) return;
  if (qty < 1) { cart.removeItem(id); return; }
  cart.updateItemQuantity(id, qty);
  if (typeof renderCartItems === 'function') renderCartItems();
};
globalThis.removeFromCart = function(id) {
  const cart = window.Cart || (window.CartSystem ? window.CartSystem : null);
  if (!cart) return;
  cart.removeItem(id);
  if (typeof renderCartItems === 'function') renderCartItems();
};

// Sepet ürünlerinde silme ve adet güncelleme fonksiyonlarını düzelt
// window.Cart yerine window.removeFromCart ve window.updateCartQuantity kullan
// Ayrıca ürün seçeneklerini okunur şekilde göster
function formatCartItemOptions(options) {
  if (!options || typeof options !== 'object') return 'Yok';
  
  let result = [];
  
  // Ekstraları işle
  if (options.extras && Array.isArray(options.extras) && options.extras.length > 0) {
    const extrasStr = options.extras.filter(e => typeof e === 'string' && e.trim() !== '').join(', ');
    if (extrasStr) {
      result.push(extrasStr);
    }
  }
  
  // Diğer opsiyonlar için
  Object.keys(options).forEach(key => {
    if (key !== 'size' && key !== 'extras') {
      const val = options[key];
      if (typeof val === 'string' && val.trim() !== '') {
        result.push(val);
      }
    }
  });
  
  return result.length > 0 ? result.join(', ') : 'Yok';
}
// Cart Edit Modal Logic
(function() {
  // Modal elementleri
  const modalOverlay = document.getElementById('cartEditModalOverlay');
  const modal = document.getElementById('cartEditModal');
  const modalClose = document.getElementById('cartEditModalClose');
  const modalImage = document.getElementById('cartEditProductImage');
  const modalBadge = document.getElementById('cartEditProductBadge');
  const modalName = document.getElementById('cartEditProductName');
  const modalDescription = document.getElementById('cartEditProductDescription');
  const modalCurrentPrice = document.getElementById('cartEditCurrentPrice');
  const modalOldPrice = document.getElementById('cartEditOldPrice');
  const modalSizeOptions = document.getElementById('cartEditSizeOptions');
  const modalExtraOptions = document.getElementById('cartEditExtraOptions');
  const modalNotes = document.getElementById('cartEditProductNotes');
  const modalQuantity = document.getElementById('cartEditQuantity');
  const modalQuantityMinus = document.getElementById('cartEditQuantityMinus');
  const modalQuantityPlus = document.getElementById('cartEditQuantityPlus');
  const modalUpdateBtn = document.getElementById('cartEditUpdateBtn');
  const modalTotalPrice = document.getElementById('cartEditTotalPrice');

  let editingItem = null;
  let editingProduct = null;
  let editingOptions = {};
  let editingQuantity = 1;
  let editingBasePrice = 0;

  // Ürün modalını aç
  window.openCartItemModal = function(itemId) {
    const cart = window.Cart || (window.CartSystem ? window.CartSystem : null);
    const items = cart && typeof cart.getItems === 'function' ? cart.getItems() : (cart && cart.items ? cart.items : []);
    const item = items.find(i => i.id === itemId);
    if (!item) {
      alert('Ürün sepette bulunamadı! (ID: ' + itemId + ')');
      return;
    }
    editingItem = item;
    // Ürün bilgisini bul (menu.js'deki ürün listesinden veya item içinden)
    let product = null;
    if (window.MenuProducts) {
      product = window.MenuProducts.find(p => p.id == item.productId);
    }
    // Eğer ürün bulunamazsa, sepetteki mevcut bilgilerle devam et
    editingProduct = product || {
      id: item.productId || item.id,
      name: item.name,
      price: item.price,
      image: item.image,
      description: item.description,
      badge: item.badge,
      sizeOptions: [],
      extraOptions: []
    };
    // Modalda tüm opsiyonlar gösterilsin
    if (product) {
      editingProduct.sizeOptions = product.sizeOptions || [];
      editingProduct.extraOptions = product.extraOptions || [];
    }
    editingOptions = Object.assign({}, item.options || {});
    editingQuantity = item.quantity;
    editingBasePrice = item.price;
    // Modalı doldur
    if (modalImage) modalImage.src = editingProduct.image || '';
    if (modalBadge) {
      if (editingProduct.badge) {
        modalBadge.textContent = editingProduct.badge;
        modalBadge.style.display = 'block';
      } else {
        modalBadge.style.display = 'none';
      }
    }
    if (modalName) modalName.textContent = editingProduct.name || '';
    if (modalDescription) modalDescription.textContent = editingProduct.description || '';
    if (modalCurrentPrice) modalCurrentPrice.textContent = ((item.price || 0) * item.quantity).toFixed(2) + '';
    if (modalOldPrice) modalOldPrice.style.display = 'none';
    // Boyut seçenekleri
    if (modalSizeOptions) {
      modalSizeOptions.innerHTML = '';
      if (editingProduct.sizeOptions && Array.isArray(editingProduct.sizeOptions)) {
        editingProduct.sizeOptions.forEach(opt => {
          const checked = (editingOptions.size === opt.name) ? 'checked' : '';
          modalSizeOptions.innerHTML += `<label class="option-choice"><input type="radio" name="cartEditSize" value="${opt.name}" data-price="${opt.price}" ${checked}><div class="choice-content"><span class="choice-name">${opt.name}</span><span class="choice-price">${opt.price > 0 ? '+' + parseFloat(opt.price || 0).toFixed(2) : '+0.00'}</span></div></label>`;
        });
      } else if (editingOptions.size) {
        modalSizeOptions.innerHTML = `<label class="option-choice"><input type="radio" name="cartEditSize" value="${editingOptions.size}" checked><div class="choice-content"><span class="choice-name">${editingOptions.size}</span></div></label>`;
      }
    }
    // Ekstra seçenekler
    if (modalExtraOptions) {
      modalExtraOptions.innerHTML = '';
      if (editingProduct.extraOptions && Array.isArray(editingProduct.extraOptions)) {
        editingProduct.extraOptions.forEach(opt => {
          const checked = (editingOptions.extras && editingOptions.extras.includes(opt.name)) ? 'checked' : '';
          modalExtraOptions.innerHTML += `<label class="option-choice"><input type="checkbox" name="cartEditExtra" value="${opt.name}" data-price="${opt.price}" ${checked}><div class="choice-content"><span class="choice-name">${opt.name}</span><span class="choice-price">+${parseFloat(opt.price || 0).toFixed(2)}</span></div></label>`;
        });
      } else if (editingOptions.extras && Array.isArray(editingOptions.extras)) {
        editingOptions.extras.forEach(extra => {
          modalExtraOptions.innerHTML += `<label class="option-choice"><input type="checkbox" name="cartEditExtra" value="${extra}" checked><div class="choice-content"><span class="choice-name">${extra}</span></div></label>`;
        });
      }
    }
    // Notlar
    if (modalNotes) modalNotes.value = item.notes || '';
    // Adet
    if (modalQuantity) modalQuantity.textContent = editingQuantity;
    // Fiyat
    updateCartEditModalPrice();
    // Modalı aç
    if (modalOverlay) modalOverlay.classList.add('active');
    document.body.style.overflow = 'hidden';
  };
  // Modalı kapat
  function closeCartEditModal() {
    if (modalOverlay) modalOverlay.classList.remove('active');
    document.body.style.overflow = '';
  }
  if (modalClose) modalClose.addEventListener('click', closeCartEditModal);
  if (modalOverlay) modalOverlay.addEventListener('click', function(e) { if (e.target === modalOverlay) closeCartEditModal(); });
  // Adet artır/azalt
  if (modalQuantityMinus) modalQuantityMinus.addEventListener('click', function() {
    if (editingQuantity > 1) {
      editingQuantity--;
      if (modalQuantity) modalQuantity.textContent = editingQuantity;
      updateCartEditModalPrice();
    }
  });
  if (modalQuantityPlus) modalQuantityPlus.addEventListener('click', function() {
    editingQuantity++;
    if (modalQuantity) modalQuantity.textContent = editingQuantity;
    updateCartEditModalPrice();
  });
  // Boyut/ekstra değişince fiyatı güncelle
  if (modalSizeOptions) modalSizeOptions.addEventListener('change', function(e) {
    if (e.target.name === 'cartEditSize') {
      editingOptions.size = e.target.value;
      updateCartEditModalPrice();
    }
  });
  if (modalExtraOptions) modalExtraOptions.addEventListener('change', function(e) {
    if (e.target.name === 'cartEditExtra') {
      const checkboxes = modalExtraOptions.querySelectorAll('input[name="cartEditExtra"]:checked');
      editingOptions.extras = Array.from(checkboxes).map(cb => cb.value);
      updateCartEditModalPrice();
    }
  });
  // Notlar değişince
  if (modalNotes) modalNotes.addEventListener('input', function(e) {
    editingItem.notes = e.target.value;
  });
  // Fiyatı güncelle
  function updateCartEditModalPrice() {
    if (!editingProduct) {
      console.error('❌ Editing product is null');
      return;
    }
    
    let price = editingProduct.basePrice || editingProduct.price || editingBasePrice || 0;
    // Boyut fiyatı
    if (editingProduct.sizeOptions && editingOptions.size) {
      const sizeOpt = editingProduct.sizeOptions.find(opt => opt.name === editingOptions.size);
      if (sizeOpt) price = (editingProduct.basePrice || editingProduct.price || 0) + (sizeOpt.price || 0);
    }
    // Ekstra fiyatlar
    if (editingProduct.extraOptions && editingOptions.extras && Array.isArray(editingOptions.extras)) {
      editingOptions.extras.forEach(extraName => {
        const extraOpt = editingProduct.extraOptions.find(opt => opt.name === extraName);
        if (extraOpt) price += extraOpt.price;
      });
    }
    if (modalCurrentPrice) modalCurrentPrice.textContent = (price * editingQuantity).toFixed(2) + '';
    if (modalTotalPrice) modalTotalPrice.textContent = (price * editingQuantity).toFixed(2) + '';
  }
  // Güncelle butonu
  if (modalUpdateBtn) modalUpdateBtn.addEventListener('click', function() {
    // Sepetteki ürünü güncelle
    const cart = window.Cart || (window.CartSystem ? window.CartSystem : null);
    if (!cart) return;
    // Güncel opsiyonlar ve adet ile yeni id oluştur
    const newId = cart.generateCartItemId(editingItem.productId, editingOptions);
    // Fiyatı seçili opsiyonlara göre güncelle
    let newPrice = editingProduct.price;
    // Boyut fiyatı
    if (editingProduct.sizeOptions && editingOptions.size) {
      const sizeOpt = editingProduct.sizeOptions.find(opt => opt.name === editingOptions.size);
      if (sizeOpt) newPrice = (editingProduct.basePrice || editingProduct.price || 0) + (sizeOpt.price || 0);
    }
    // Ekstra fiyatlar
    if (editingProduct.extraOptions && editingOptions.extras && Array.isArray(editingOptions.extras)) {
      editingOptions.extras.forEach(extraName => {
        const extraOpt = editingProduct.extraOptions.find(opt => opt.name === extraName);
        if (extraOpt) newPrice += extraOpt.price;
      });
    }
    editingProduct.price = newPrice;
    // Eğer id değiştiyse (ör: opsiyon değiştiyse), yeni ürün olarak ekle
    if (newId !== editingItem.id) {
      // Önce yeni ürünü ekle, eğer aynı id'li başka ürün varsa miktarını artır
      const existing = cart.items.find(i => i.id === newId);
      if (existing) {
        existing.quantity += editingQuantity;
        existing.options = Object.assign({}, editingOptions);
        existing.notes = modalNotes ? modalNotes.value : '';
        cart.saveCart();
      } else {
        cart.addItem(editingProduct, editingQuantity, editingOptions);
      }
      cart.removeItem(editingItem.id);
    } else {
      cart.updateItemQuantity(editingItem.id, editingQuantity);
      // Notlar güncellendi ise kaydet
      editingItem.notes = modalNotes ? modalNotes.value : '';
      cart.saveCart();
    }
    // Modalı kapat
    closeCartEditModal();
    // Sepet arayüzünü güncelle
    if (typeof renderCartItems === 'function') renderCartItems();
  });
})();

(function() {
  const pickupRadio = document.querySelector('input[name="deliveryMethod"][value="pickup"]');
  const pickupDetails = document.getElementById('pickupDetails');
  const phoneInput = document.getElementById('pickupPhone');
  const customTimeRadio = document.querySelector('input[name="pickupTime"][value="custom"]');
  const asapTimeRadio = document.querySelector('input[name="pickupTime"][value="asap"]');
  const customTimeInput = document.getElementById('pickupCustomTime');
  // Teslimat yöntemi değişince açılır alanı göster/gizle
  document.querySelectorAll('input[name="deliveryMethod"]').forEach(input => {
    input.addEventListener('change', function() {
      if (pickupRadio.checked) {
        pickupDetails.style.display = '';
      } else {
        pickupDetails.style.display = 'none';
      }
    });
  });
  // Sayfa yüklenince ilk durumu ayarla
  if (pickupRadio && pickupDetails) {
    pickupDetails.style.display = pickupRadio.checked ? '' : 'none';
  }
  // Saat seçeneği custom ise time inputunu göster
  document.querySelectorAll('input[name="pickupTime"]').forEach(radio => {
    radio.addEventListener('change', function() {
      if (customTimeRadio && customTimeRadio.checked) {
        customTimeInput.style.display = '';
      } else {
        customTimeInput.style.display = 'none';
      }
    });
  });
  // Devam Et butonunda validasyon (örnek: nextStepBtn)
  const nextBtn = document.getElementById('nextStepBtn');
  if (nextBtn) {
    nextBtn.addEventListener('click', function(e) {
      if (pickupRadio && pickupRadio.checked) {
        // Şube seçili mi?
        const branch = document.querySelector('input[name="pickupBranch"]:checked');
        // Telefon kontrolü
        const phone = phoneInput.value.trim();
        if (!/^05\d{9}$/.test(phone)) {
          window.showSwalToast && window.showSwalToast('Geçerli bir telefon numarası girin (05xxxxxxxxx)', 'error');
          phoneInput.focus();
          e.preventDefault();
          e.stopImmediatePropagation();
          return false;
        }
        // Saat kontrolü (isteğe bağlı)
        if (customTimeRadio && customTimeRadio.checked) {
          if (!customTimeInput.value) {
            window.showSwalToast && window.showSwalToast('Lütfen bir saat seçin', 'error');
            customTimeInput.focus();
            e.preventDefault();
            e.stopImmediatePropagation();
            return false;
          }
        }
      }
    });
  }
})();

(function() {
  const pickupRadio = document.querySelector('input[name="deliveryMethod"][value="pickup"]');
  const inStorePaymentLabel = document.getElementById('inStorePaymentLabel');
  const cashPaymentLabel = document.getElementById('cashPaymentLabel');
  const cardPaymentLabel = document.getElementById('cardPaymentLabel');
  const onlinePaymentLabel = document.getElementById('onlinePaymentLabel');
  const cardPaymentForm = document.getElementById('cardPaymentForm');
  function updatePaymentMethods() {
    if (!inStorePaymentLabel || !cashPaymentLabel || !cardPaymentLabel || !onlinePaymentLabel) return;
    
    if (pickupRadio && pickupRadio.checked) {
      inStorePaymentLabel.style.display = '';
      const input = inStorePaymentLabel.querySelector('input');
      if (input) input.checked = true;
      cashPaymentLabel.style.display = 'none';
      cardPaymentLabel.style.display = 'none';
      onlinePaymentLabel.style.display = 'none';
      if (cardPaymentForm) cardPaymentForm.style.display = 'none';
    } else {
      inStorePaymentLabel.style.display = 'none';
      cashPaymentLabel.style.display = '';
      cardPaymentLabel.style.display = '';
      onlinePaymentLabel.style.display = '';
      // Kart ödeme seçiliyse kart formunu göster
      const cardRadio = cardPaymentLabel.querySelector('input');
      if (cardPaymentForm) cardPaymentForm.style.display = cardRadio && cardRadio.checked ? 'block' : 'none';
    }
  }
  // Teslimat yöntemi değişince ödeme adımını güncelle
  document.querySelectorAll('input[name="deliveryMethod"]').forEach(input => {
    input.addEventListener('change', updatePaymentMethods);
  });
  // Ödeme yöntemi değişince kart formunu güncelle
  document.querySelectorAll('input[name="paymentMethod"]').forEach(input => {
    input.addEventListener('change', function() {
      if (cardPaymentForm) cardPaymentForm.style.display = (this.value === 'card') ? 'block' : 'none';
    });
  });
  // Sayfa yüklenince ilk durumu ayarla
  updatePaymentMethods();
})();

// Sepet değişince otomatik güncelle
if (window.Cart) {
  const origUpdate = window.Cart.updateCartCount;
  window.Cart.updateCartCount = function() {
    if (origUpdate) origUpdate.apply(this, arguments);
    renderCartItems();
  };
}
window.addEventListener('DOMContentLoaded', renderCartItems); 


