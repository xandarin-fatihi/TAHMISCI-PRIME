// ========== HEADER LOADER ==========
// Header verilerini PHP'den AJAX ile çeker ve HTML'e yükler

class HeaderLoader {
    constructor() {
        this.headerElement = null;
        this.mobileNavElement = null;
    }

    async loadHeader() {
        try {
            const provider = window.TahmisciPublicData;
            if (!provider) return;
            await provider.ready;
            const bootstrap = provider.getBootstrap && provider.getBootstrap();
            if (!bootstrap) {
                if (typeof provider.applyHeader === 'function') provider.applyHeader({}, 'fallback');
                return;
            }
            const siteState = bootstrap.siteState || {};
            window.SITE_TITLE_BRAND = siteState.global?.siteName || 'Tahmisçi';
            if (typeof provider.applyHeader === 'function') {
                provider.applyHeader(siteState, 'header-loader');
            } else {
                window.HeaderData = { siteState };
                document.dispatchEvent(new CustomEvent('headerDataLoaded', { detail: window.HeaderData }));
            }
        } catch (error) {
            console.warn('Header yükleme uyarısı:', error);
        }
    }

    renderHeader(data) {
        if (window.TahmisciPublicData && typeof window.TahmisciPublicData.applyHeader === 'function') {
            window.TahmisciPublicData.applyHeader(data && data.siteState ? data.siteState : data, 'legacy-render');
            return;
        }
        if (!data.logo) return;
        const logoType = parseInt(data.logo.type, 10) || 0;
        const logoLink = data.logo.logoLink || './';
        const logoHeightRaw = data.logo.logoHeight || '20px';
        const logoHeightCss = /^\d+$/.test(String(logoHeightRaw).trim()) ? logoHeightRaw + 'px' : String(logoHeightRaw).trim();
        const esc = (s) => (s == null ? '' : String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;'));
        const basePath = getSiteRoot();

        // Desktop Header Logo: type 0 = ikon+yazı, type 1 = resim (logoUrl)
        const headerLogo = document.querySelector('.header-logo .logo-link');
        if (headerLogo) {
            headerLogo.href = logoLink;
            if (logoType === 1 && data.logo.logoUrl) {
                let imgUrl = (data.logo.logoUrl || '').trim();
                if (imgUrl && !/^https?:\/\//i.test(imgUrl)) {
                    imgUrl = (basePath ? basePath + '/' : '') + imgUrl.replace(/^\//, '');
                }
                headerLogo.innerHTML = imgUrl
                    ? `<div class="logo-image-wrapper"><img src="${imgUrl.replace(/"/g, '&quot;')}" alt="${esc(data.logo.brandName)}" class="logo-image" style="height:${esc(logoHeightCss)}" loading="lazy"></div>`
                    : `<div class="logo-icon">${esc(data.logo.icon)}</div><div class="logo-text"><span class="brand-name">${esc(data.logo.brandName)}</span>${data.logo.tagline ? `<span class="brand-tagline">${esc(data.logo.tagline)}</span>` : ''}</div>`;
            } else {
                headerLogo.innerHTML = `<div class="logo-icon">${esc(data.logo.icon)}</div><div class="logo-text"><span class="brand-name">${esc(data.logo.brandName)}</span>${data.logo.tagline ? `<span class="brand-tagline">${esc(data.logo.tagline)}</span>` : ''}</div>`;
            }
            headerLogo.classList.add('logo-ready');
        }

        // Desktop Navigation
        const navLinks = document.querySelector('.nav-links');
        if (navLinks && data.navigation) {
            navLinks.innerHTML = '';
            data.navigation.forEach(item => {
                const li = document.createElement('li');
                li.className = 'nav-item';
                const itemIcon = (item.icon && String(item.icon).trim()) ? `<i class="nav-link-icon ${String(item.icon).trim()}" aria-hidden="true"></i>` : '';

                // Check if item has dropdown
                if (item.dropdown && item.dropdown.length > 0) {
                    li.classList.add('has-dropdown');

                    const a = document.createElement('a');
                    a.href = item.url || '#';
                    a.className = 'nav-link';
                    a.innerHTML = itemIcon + ` <span class="nav-link-text">${esc(item.text)}</span> <i class="fas fa-chevron-down dropdown-icon" aria-hidden="true"></i>`;

                    const dropdown = document.createElement('div');
                    dropdown.className = 'nav-dropdown';

                    item.dropdown.forEach(subItem => {
                        const dropdownLink = document.createElement('a');
                        dropdownLink.href = subItem.url || '#';
                        dropdownLink.className = 'nav-dropdown-item';
                        const subIcon = (subItem.icon && String(subItem.icon).trim()) ? `<i class="nav-dropdown-item-icon ${String(subItem.icon).trim()}" aria-hidden="true"></i>` : '';
                        dropdownLink.innerHTML = subIcon ? subIcon + ' <span class="nav-dropdown-item-text">' + esc(subItem.text) + '</span>' : esc(subItem.text);
                        dropdown.appendChild(dropdownLink);
                    });

                    li.appendChild(a);
                    li.appendChild(dropdown);
                } else {
                    const a = document.createElement('a');
                    a.href = item.url || './';
                    a.className = 'nav-link';
                    a.innerHTML = itemIcon ? itemIcon + ' <span class="nav-link-text">' + esc(item.text) + '</span>' : esc(item.text);

                    li.appendChild(a);
                }

                navLinks.appendChild(li);
            });
        }

        // Mobile Navigation Logo: type 0 = ikon+yazı, type 1 = resim (logoUrl)
        const mobileNavLogo = document.querySelector('.mobile-nav-logo');
        if (mobileNavLogo) {
            mobileNavLogo.href = logoLink;
            if (logoType === 1 && data.logo.logoUrl) {
                let imgUrl = (data.logo.logoUrl || '').trim();
                if (imgUrl && !/^https?:\/\//i.test(imgUrl)) {
                    imgUrl = (basePath ? basePath + '/' : '') + imgUrl.replace(/^\//, '');
                }
                mobileNavLogo.innerHTML = imgUrl
                    ? `<div class="logo-image-wrapper"><img src="${imgUrl.replace(/"/g, '&quot;')}" alt="${esc(data.logo.brandName)}" class="logo-image" style="height:${esc(logoHeightCss)}" loading="lazy"></div>`
                    : `<div class="logo-icon">${esc(data.logo.icon)}</div><span class="brand-name">${esc(data.logo.brandName)}</span>`;
            } else {
                mobileNavLogo.innerHTML = `<div class="logo-icon">${esc(data.logo.icon)}</div><span class="brand-name">${esc(data.logo.brandName)}</span>`;
            }
            mobileNavLogo.classList.add('logo-ready');
        }

        // Mobile Navigation Menu Items
        const mobileNavContent = document.querySelector('.mobile-nav-content');
        if (mobileNavContent && data.navigation) {
            const mobileNavLinks = mobileNavContent.querySelector('.mobile-nav-links');
            if (mobileNavLinks) {
                mobileNavLinks.innerHTML = '';
                data.navigation.forEach(item => {
                    const li = document.createElement('li');
                    li.className = 'mobile-nav-item';
                    const itemIcon = (item.icon && String(item.icon).trim()) ? `<i class="mobile-nav-link-icon ${String(item.icon).trim()}" aria-hidden="true"></i>` : '';

                    // Check if item has dropdown
                    if (item.dropdown && item.dropdown.length > 0) {
                        li.classList.add('has-submenu');

                        const a = document.createElement('a');
                        a.href = '#';
                        a.className = 'mobile-nav-link';
                        a.innerHTML = (itemIcon ? itemIcon + ' ' : '') + `
                            <span class="mobile-nav-text">${esc(item.text)}</span>
                            <i class="fas fa-chevron-down mobile-nav-arrow" aria-hidden="true"></i>
                        `;

                        const submenu = document.createElement('div');
                        submenu.className = 'mobile-nav-submenu';

                        item.dropdown.forEach(subItem => {
                            const subLink = document.createElement('a');
                            subLink.href = subItem.url || '#';
                            subLink.className = 'mobile-nav-submenu-item';
                            const subIcon = (subItem.icon && String(subItem.icon).trim()) ? `<i class="mobile-nav-submenu-item-icon ${String(subItem.icon).trim()}" aria-hidden="true"></i>` : '';
                            subLink.innerHTML = subIcon ? subIcon + ' <span class="mobile-nav-submenu-item-text">' + esc(subItem.text) + '</span>' : esc(subItem.text);
                            submenu.appendChild(subLink);
                        });

                        li.appendChild(a);
                        li.appendChild(submenu);

                        // Toggle submenu on click
                        a.addEventListener('click', (e) => {
                            e.preventDefault();
                            li.classList.toggle('active');
                        });
                    } else {
                        const a = document.createElement('a');
                        a.href = item.url || './';
                        a.className = 'mobile-nav-link';
                        a.innerHTML = itemIcon ? itemIcon + ' <span class="mobile-nav-text">' + esc(item.text) + '</span>' : esc(item.text);

                        li.appendChild(a);
                    }

                    mobileNavLinks.appendChild(li);
                });
            }
        }

        // Set active nav link immediately after header is rendered
        if (typeof setActiveNavLink === 'function') {
            setActiveNavLink();
        }

        // Re-initialize language switcher after header is rendered
        if (window.languageSwitcher) {
            window.languageSwitcher.init();
        } else if (typeof LanguageSwitcher !== 'undefined') {
            window.languageSwitcher = new LanguageSwitcher();
        }

        // Re-initialize auth modal buttons after header is rendered
        // Use setTimeout to ensure DOM is fully updated
        setTimeout(() => {
            if (typeof window.attachAuthButtonListeners === 'function') {
                window.attachAuthButtonListeners();
            }
        }, 100);
    }

    applySiteConfig(cfg) {
        if (!cfg) return;
        const defLang = (cfg.default_language || 'tr').toLowerCase();
        const defTheme = (cfg.default_theme || 'default').trim();
        const elLang = document.getElementById('defaultlanguage');
        const elTheme = document.getElementById('defaultTheme');
        if (elLang) elLang.value = defLang;
        if (elTheme) elTheme.value = defTheme;
        if (!localStorage.getItem('site_language')) {
            localStorage.setItem('site_language', defLang);
        }
        const themeValue = defTheme;
        if (!themeValue) return;
        if (themeValue.startsWith('#')) {
            document.documentElement.style.setProperty('--color-primary', themeValue);
            const hexToRgb = (hex) => {
                const result = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex);
                return result ? { r: parseInt(result[1], 16), g: parseInt(result[2], 16), b: parseInt(result[3], 16) } : null;
            };
            const lighten = (hex, pct) => {
                const rgb = hexToRgb(hex);
                if (!rgb) return hex;
                const r = Math.min(255, Math.round(rgb.r + (255 - rgb.r) * pct));
                const g = Math.min(255, Math.round(rgb.g + (255 - rgb.g) * pct));
                const b = Math.min(255, Math.round(rgb.b + (255 - rgb.b) * pct));
                return `rgb(${r}, ${g}, ${b})`;
            };
            const darken = (hex, pct) => {
                const rgb = hexToRgb(hex);
                if (!rgb) return hex;
                const r = Math.max(0, Math.round(rgb.r * (1 - pct)));
                const g = Math.max(0, Math.round(rgb.g * (1 - pct)));
                const b = Math.max(0, Math.round(rgb.b * (1 - pct)));
                return `rgb(${r}, ${g}, ${b})`;
            };
            const rgb = hexToRgb(themeValue);
            if (rgb) {
                document.documentElement.style.setProperty('--color-primary-rgb', `${rgb.r}, ${rgb.g}, ${rgb.b}`);
                document.documentElement.style.setProperty('--color-primary-light', lighten(themeValue, 0.3));
                document.documentElement.style.setProperty('--color-primary-dark', darken(themeValue, 0.15));
            }
        } else {
            document.documentElement.setAttribute('data-theme', themeValue);
        }
        if (cfg.primary_color && !themeValue.startsWith('#')) {
            document.documentElement.style.setProperty('--color-primary', cfg.primary_color);
        }
        if (cfg.accent_color) {
            document.documentElement.style.setProperty('--color-primary-dark', cfg.accent_color);
            document.documentElement.style.setProperty('--color-primary-light', cfg.accent_color);
        }
        try {
            if (cfg.primary_color) localStorage.setItem('yep_theme_primary', cfg.primary_color);
            if (themeValue.startsWith('#')) localStorage.setItem('yep_theme_primary', themeValue);
            if (cfg.accent_color) localStorage.setItem('yep_theme_accent', cfg.accent_color);
            if (cfg.default_theme != null) localStorage.setItem('yep_default_theme', String(cfg.default_theme));
            if (cfg.logo_type != null) localStorage.setItem('yep_logo_type', String(cfg.logo_type));
            if (cfg.logo_image != null) localStorage.setItem('yep_logo_image', String(cfg.logo_image));
            if (cfg.logo_icon != null) localStorage.setItem('yep_logo_icon', String(cfg.logo_icon));
            if (cfg.logo_title != null) localStorage.setItem('yep_logo_title', String(cfg.logo_title));
            if (cfg.logo_tagline != null) localStorage.setItem('yep_logo_tagline', String(cfg.logo_tagline));
            if (cfg.logo_height != null) localStorage.setItem('yep_logo_height', String(cfg.logo_height));
            if (cfg.favicon_url != null) localStorage.setItem('yep_favicon_url', String(cfg.favicon_url));
        } catch (e) { }
        if (cfg.favicon_url) {
            applyFavicon(cfg.favicon_url);
        }
    }
}

function applyFavicon(url) {
    if (!url || typeof url !== 'string') return;
    const basePath = (typeof getSiteRoot === 'function' ? getSiteRoot() : (window.SITE_ROOT || '')) || '';
    const href = url.trim().match(/^https?:\/\//i) ? url : (basePath ? basePath + '/' : '') + url.replace(/^\//, '');
    const ext = (href.split('?')[0].split('.').pop() || '').toLowerCase();
    const typeMap = { png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', gif: 'image/gif', ico: 'image/x-icon', svg: 'image/svg+xml' };
    const type = typeMap[ext] || 'image/x-icon';
    let link = document.querySelector('link[rel="icon"]') || document.querySelector('link[rel="shortcut icon"]');
    if (!link) {
        link = document.createElement('link');
        link.rel = 'icon';
        document.head.appendChild(link);
    }
    link.href = href;
    link.type = type;
}

function applySiteConfigFromStorage() {
    try {
        const faviconUrl = localStorage.getItem('yep_favicon_url');
        if (faviconUrl) {
            applyFavicon(faviconUrl);
        }
        if (document.body?.classList.contains("tahmisci-static-menu") || isTahmisciBackendCatalogMode()) {
            return;
        }
        const hasStoredLogo = localStorage.getItem('yep_logo_type') != null || localStorage.getItem('yep_logo_icon') != null || localStorage.getItem('yep_logo_title') != null || localStorage.getItem('yep_logo_image') != null;
        if (!hasStoredLogo) return;

        const logoType = parseInt(localStorage.getItem('yep_logo_type'), 10);
        const logoIcon = localStorage.getItem('yep_logo_icon') || '';
        const logoTitle = localStorage.getItem('yep_logo_title') || 'YepPos';
        const logoTagline = localStorage.getItem('yep_logo_tagline') || '';
        const logoImage = localStorage.getItem('yep_logo_image') || '';
        const logoHeight = localStorage.getItem('yep_logo_height') || '32px';
        const logoHeightCss = /^\d+$/.test(String(logoHeight).trim()) ? logoHeight + 'px' : String(logoHeight).trim();
        const esc = (s) => (s == null ? '' : String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;'));
        const basePath = (typeof getSiteRoot === 'function' ? getSiteRoot() : (window.SITE_ROOT || '')) || '';

        const headerLogo = document.querySelector('.header-logo .logo-link');
        if (headerLogo) {
            headerLogo.href = './';
            if (logoType === 1 && logoImage) {
                let imgUrl = logoImage.trim();
                if (imgUrl && !/^https?:\/\//i.test(imgUrl)) {
                    imgUrl = (basePath ? basePath + '/' : '') + imgUrl.replace(/^\//, '');
                }
                headerLogo.innerHTML = imgUrl
                    ? `<div class="logo-image-wrapper"><img src="${imgUrl.replace(/"/g, '&quot;')}" alt="${esc(logoTitle)}" class="logo-image" style="height:${esc(logoHeightCss)}" loading="lazy"></div>`
                    : `<div class="logo-icon">${esc(logoIcon)}</div><div class="logo-text"><span class="brand-name">${esc(logoTitle)}</span>${logoTagline ? `<span class="brand-tagline">${esc(logoTagline)}</span>` : ''}</div>`;
            } else {
                headerLogo.innerHTML = `<div class="logo-icon">${esc(logoIcon)}</div><div class="logo-text"><span class="brand-name">${esc(logoTitle)}</span>${logoTagline ? `<span class="brand-tagline">${esc(logoTagline)}</span>` : ''}</div>`;
            }
            headerLogo.classList.add('logo-ready');
        }
        const mobileNavLogo = document.querySelector('.mobile-nav-logo');
        if (mobileNavLogo) {
            mobileNavLogo.href = './';
            if (logoType === 1 && logoImage) {
                let imgUrl = logoImage.trim();
                if (imgUrl && !/^https?:\/\//i.test(imgUrl)) {
                    imgUrl = (basePath ? basePath + '/' : '') + imgUrl.replace(/^\//, '');
                }
                mobileNavLogo.innerHTML = imgUrl
                    ? `<div class="logo-image-wrapper"><img src="${imgUrl.replace(/"/g, '&quot;')}" alt="${esc(logoTitle)}" class="logo-image" style="height:${esc(logoHeightCss)}" loading="lazy"></div>`
                    : `<div class="logo-icon">${esc(logoIcon)}</div><span class="brand-name">${esc(logoTitle)}</span>`;
            } else {
                mobileNavLogo.innerHTML = `<div class="logo-icon">${esc(logoIcon)}</div><span class="brand-name">${esc(logoTitle)}</span>`;
            }
            mobileNavLogo.classList.add('logo-ready');
        }
    } catch (e) { }
}

// Sayfa yüklendiğinde önce localStorage'daki logo/tema uygula, sonra header'ı yükle
document.addEventListener('DOMContentLoaded', () => {
    if (typeof applySiteConfigFromStorage === 'function') {
        applySiteConfigFromStorage();
    }
    const headerLoader = new HeaderLoader();
    window.headerLoader = headerLoader;
    headerLoader.loadHeader();

    window.addEventListener('languageChanged', () => {
        headerLoader.loadHeader();
    });

    // PWA Service Worker
    const shouldRegisterServiceWorker =
        'serviceWorker' in navigator &&
        window.location.protocol === 'https:';
    if (shouldRegisterServiceWorker) {
        const base = (typeof getSiteRoot === 'function' ? getSiteRoot() : (window.getSiteRoot && window.getSiteRoot())) || '';
        navigator.serviceWorker.register(base + '/sw.js', { scope: base + '/' }).catch(function () { });
    }

    // Şube bazlı popup (panelden, yep_popups)
    initSitePopup();
});

function initSitePopup() {
    if (document.body?.classList.contains("tahmisci-static-menu")) return;
    if (isTahmisciBackendCatalogMode()) return;
    const isReservationPage =
        document.body?.classList.contains("reservation-page") ||
        /(?:^|\/)(rezervasyon|reservation)(?:\.php)?\/?$/i.test(
            window.location.pathname || "",
        );
    if (isReservationPage) return;

    const base = (typeof getSiteRoot === 'function' ? getSiteRoot() : (window.getSiteRoot && window.getSiteRoot())) || '';
    const apiUrl = base + '/yeppanel/db/ajax/web/popup.php';
    const branchId = localStorage.getItem('menuBranchId');
    let url = apiUrl;
    if (branchId) url += (apiUrl.indexOf('?') !== -1 ? '&' : '?') + 'branch_id=' + encodeURIComponent(branchId);

    fetch(url)
        .then(function (r) { return r.json(); })
        .then(function (result) {
            if (!result.success || !result.data || !result.data.popup) return;
            var p = result.data.popup;
            var id = p.popups_id;
            var sessionKey = 'popup_shown_' + id;
            if (sessionStorage.getItem(sessionKey)) return;

            var delay = Math.max(0, parseInt(p.popups_must, 10) || 0) * 1000;
            setTimeout(function () {
                if (sessionStorage.getItem(sessionKey)) return;
                sessionStorage.setItem(sessionKey, '1');
                showSitePopup(p, base);
            }, delay);
        })
        .catch(function () { });
}

function showSitePopup(p, base) {
    const isReservationPage =
        document.body?.classList.contains("reservation-page") ||
        /(?:^|\/)(rezervasyon|reservation)(?:\.php)?\/?$/i.test(
            window.location.pathname || "",
        );
    if (isReservationPage) return;

    var overlay = document.getElementById('sitePopupOverlay');
    if (overlay) return;
    var imgPath = (p.popups_file && p.popups_file.trim()) ? (base + '/yeppanel/yep/yep_popups/' + p.popups_file.replace(/^\/+/, '')) : '';
    overlay = document.createElement('div');
    overlay.id = 'sitePopupOverlay';
    overlay.className = 'site-popup-overlay';
    var modal = document.createElement('div');
    modal.className = 'site-popup-modal';
    var closeBtn = document.createElement('button');
    closeBtn.type = 'button';
    closeBtn.className = 'site-popup-close';
    closeBtn.setAttribute('aria-label', 'Kapat');
    closeBtn.innerHTML = '&times;';
    var imageWrap = document.createElement('div');
    imageWrap.className = 'site-popup-image-wrap';
    if (imgPath) {
        var img = document.createElement('img');
        img.src = imgPath;
        img.alt = (p.popups_name || '').trim() || 'Popup';
        if ((p.popups_url || '').trim()) {
            var a = document.createElement('a');
            a.href = p.popups_url.trim();
            a.appendChild(img);
            imageWrap.appendChild(a);
        } else {
            imageWrap.appendChild(img);
        }
    }
    modal.appendChild(closeBtn);
    modal.appendChild(imageWrap);
    var body = document.createElement('div');
    body.className = 'site-popup-body';
    if ((p.popups_detail || '').trim()) {
        var detail = document.createElement('div');
        detail.className = 'site-popup-detail';
        detail.innerHTML = p.popups_detail.trim();
        body.appendChild(detail);
    }
    if ((p.popups_url || '').trim() && !imgPath) {
        var btnWrap = document.createElement('div');
        btnWrap.className = 'site-popup-btn-wrap';
        var link = document.createElement('a');
        link.href = p.popups_url.trim();
        link.className = 'site-popup-btn';
        link.textContent = 'Detay';
        btnWrap.appendChild(link);
        body.appendChild(btnWrap);
    }
    modal.appendChild(body);
    overlay.appendChild(modal);
    document.body.appendChild(overlay);
    document.body.style.overflow = 'hidden';

    function closePopup() {
        overlay.classList.add('site-popup-hidden');
        document.body.style.overflow = '';
        setTimeout(function () {
            if (overlay.parentNode) overlay.parentNode.removeChild(overlay);
        }, 300);
    }
    closeBtn.addEventListener('click', closePopup);
    overlay.addEventListener('click', function (e) {
        if (e.target === overlay) closePopup();
    });
    document.addEventListener('keydown', function onEsc(e) {
        if (e.key === 'Escape') {
            closePopup();
            document.removeEventListener('keydown', onEsc);
        }
    });
}

// ========== HERO LOADER (hero.php'den slider verisi, DB'den) ==========
class HeroLoader {
    async loadHero() {
        try {
            const provider = window.TahmisciPublicData;
            if (!provider) throw new Error('Public veri sağlayıcısı bulunamadı.');
            await provider.ready;
            APP_CONFIG.hero.slides = Array.isArray(APP_CONFIG.hero.slides) ? APP_CONFIG.hero.slides : [];
            APP_CONFIG.hero.autoplay = APP_CONFIG.hero.autoplay !== false;
            APP_CONFIG.hero.autoplayInterval = APP_CONFIG.hero.autoplayInterval || 5000;
            APP_CONFIG.hero.transitionSpeed = APP_CONFIG.hero.transitionSpeed || 600;
            window.dispatchEvent(new CustomEvent('heroDataLoaded'));
        } catch (e) {
            console.error('Hero yükleme hatası:', e);
            APP_CONFIG.hero = APP_CONFIG.hero || {};
            APP_CONFIG.hero.slides = [];
            window.dispatchEvent(new CustomEvent('heroDataLoaded'));
        }
    }
}

document.addEventListener('DOMContentLoaded', () => {
    const heroLoader = new HeroLoader();
    window.tahmisciHeroLoader = heroLoader;
    heroLoader.loadHero();
    window.addEventListener('publicBootstrapUpdated', () => heroLoader.loadHero());
});
