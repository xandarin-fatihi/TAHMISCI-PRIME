// ========== MAIN APPLICATION SCRIPT ==========
// Site kökü: index.php ve assets'ın bulunduğu dizin. app.js yüklendiği yoldan türetilir (assets/ üstü = kök).
// PHP ile override: header'da window.SITE_ROOT = '/yeppos' veya '' yazılabilir.

//localStorage.clear();
(function () {

    var scripts = document.getElementsByTagName('script');
    for (var i = scripts.length - 1; i >= 0; i--) {
        var src = scripts[i].src;
        if (src && src.indexOf('app.js') !== -1) {
            try {
                var u = new URL(src);
                var path = u.pathname;
                window.__APP_BASE_PATH = path.replace(/\/assets\/.*$/i, '').replace(/\/$/, '') || '';
            } catch (e) { }
            break;
        }
    }
})();
function getSiteRoot() {
    if (typeof window.SITE_ROOT !== 'undefined' && window.SITE_ROOT !== null && window.SITE_ROOT !== '') {
        return String(window.SITE_ROOT).replace(/\/$/, '');
    }
    if (typeof window.__APP_BASE_PATH !== 'undefined' && window.__APP_BASE_PATH !== '') {
        return window.__APP_BASE_PATH;
    }
    return '';
}
window.getSiteRoot = getSiteRoot;

function isTahmisciBackendCatalogMode() {
    return document.body?.classList.contains('tahmisci-static-menu') === true;
}
window.isTahmisciBackendCatalogMode = isTahmisciBackendCatalogMode;

// AJAX çağrılarında kullanılacak dil (JSON diline göre veri dönmek için)
function getAjaxLang() {
    return (window.I18N && typeof window.I18N.getPreferredLanguage === 'function' && window.I18N.getPreferredLanguage()) || localStorage.getItem('site_language') || 'tr';
}
window.getAjaxLang = getAjaxLang;

// Üye ol / sipariş için şube id: URL > localStorage > 48
function getRegisterCompanyId() {
    const p = new URLSearchParams(window.location.search);
    const fromUrl = p.get('company_id');
    if (fromUrl) return parseInt(fromUrl, 10) || 48;
    const fromStorage = localStorage.getItem('menuBranchId') || localStorage.getItem('menuCompanyId');
    if (fromStorage) return parseInt(fromStorage, 10) || 48;
    return 48;
}
window.getRegisterCompanyId = getRegisterCompanyId;

// AJAX çağrılarında dil parametresi (JSON diline göre veri dönmek için)
function getApiLang() {
    return window.I18N?.getPreferredLanguage?.() || localStorage.getItem('site_language') || 'tr';
}
window.getApiLang = getApiLang;

// ========== SWAL TOAST (toastContainer yerine) ==========
function showSwalToast(message, type = 'info', duration = 3000) {
    if (typeof window.Swal !== 'undefined' && typeof window.Swal.fire === 'function') {
        window.Swal.fire({
            text: message,
            icon: type,
            timer: duration,
            timerProgressBar: true,
            toast: true,
            position: 'top-end',
            showConfirmButton: false,
            width: 'auto',
            padding: '1rem 1.5rem'
        });
    }
}
window.showSwalToast = showSwalToast;

// ========== GLOBAL FUNCTIONS ==========

// QR Code generation function (for HTML onclick)
function generateQR() {
    if (window.app) {
        window.app.generateQRCode();
    }
}

// ========== SET ACTIVE NAV FUNCTION ========== //
function setActiveNavLink() {
    const path = window.location.pathname;
    const normalizedPath = path.toLowerCase().replace(/\/$/, '');
    const pathSegments = path.split('/').filter(Boolean);
    const currentPathSegment = normalizedPath.split('/').pop() || '';
    const pathSegmentWithoutExt = currentPathSegment.replace(/\.php$/, '');

    const knownPageSlugs = ['menuler', 'hakkimizda', 'subeler', 'franchise', 'kampanyalar', 'iletisim', 'haberler', 'sayfalar', 'sepet'];

    let targetSegment = '';
    if (pathSegmentWithoutExt === 'hesabim' || pathSegmentWithoutExt === 'siparislerim' ||
        pathSegmentWithoutExt === 'bilgilerim' || pathSegmentWithoutExt === 'adreslerim') {
        targetSegment = '';
    } else if (currentPathSegment === 'menuler' || currentPathSegment === 'menu.php') {
        targetSegment = 'menuler';
    } else if (currentPathSegment === 'hakkimizda' || currentPathSegment === 'hakkimizda.php') {
        targetSegment = 'hakkimizda';
    } else if (currentPathSegment === 'subeler' || currentPathSegment === 'subeler.php') {
        targetSegment = 'subeler';
    } else if (currentPathSegment === 'franchise' || currentPathSegment === 'franchise.php') {
        targetSegment = 'franchise';
    } else if (currentPathSegment === 'kampanyalar' || currentPathSegment === 'kampanyalar.php') {
        targetSegment = 'kampanyalar';
    } else if (currentPathSegment === 'iletisim' || currentPathSegment === 'iletisim.php') {
        targetSegment = 'iletisim';
    } else if (currentPathSegment === 'haberler' || normalizedPath.includes('/haberler/')) {
        targetSegment = 'haberler';
    } else if (currentPathSegment === 'sayfalar' || normalizedPath.includes('/sayfalar/')) {
        targetSegment = 'sayfalar';
    } else if (currentPathSegment === 'sepet') {
        targetSegment = 'sepet';
    } else if (pathSegments.length === 0 || normalizedPath === '/' || normalizedPath === '/web' || normalizedPath.endsWith('/web') || currentPathSegment === 'index.php' ||
        (pathSegments.length === 1 && !knownPageSlugs.includes(pathSegments[0].toLowerCase()))) {
        targetSegment = 'index';
    }

    const navLinks = document.querySelectorAll('.nav-link, .mobile-nav-link, .nav-dropdown-item, .mobile-nav-submenu-item');

    // First, remove all active classes
    navLinks.forEach((link) => {
        link.classList.remove('active');
    });

    // Profile pages - don't set any nav as active, return early
    if (targetSegment === '') {
        return;
    }

    // Then, activate matching links (nav-link, mobile-nav-link, nav-dropdown-item, mobile-nav-submenu-item)
    navLinks.forEach((link) => {
        const linkHref = link.getAttribute('href') || '';
        if (linkHref === '#') return;
        const linkPath = linkHref.toLowerCase().replace(/^\.\.\//, '').replace(/^\.\//, '').replace(/^\//, '').replace(/\/$/, '');
        const linkSegment = linkPath.split('/').pop() || linkPath;

        let isActive = false;

        if (targetSegment === 'index') {
            if (linkPath === 'index.php' || linkPath === '' || linkPath === 'index' || linkHref === './' || linkHref === '') {
                isActive = true;
            }
        } else if (targetSegment) {
            if (linkSegment === targetSegment || linkPath === targetSegment || linkPath.endsWith('/' + targetSegment)) {
                isActive = true;
            }
        }

        if (isActive) {
            link.classList.add('active');

            // Dropdown alt sayfasındaysak parent (Kurumsal) linkini de aktif yap
            if (targetSegment === 'hakkimizda' || targetSegment === 'subeler' || targetSegment === 'franchise' || targetSegment === 'haberler' || targetSegment === 'sayfalar') {
                const parentItem = link.closest('.has-dropdown, .has-submenu');
                if (parentItem) {
                    const parentLink = parentItem.querySelector('.nav-link, .mobile-nav-link');
                    if (parentLink) {
                        parentLink.classList.add('active');
                    }
                }
            }
        }
    });
}

// ========== HEADER MANAGER ========== //
class HeaderManager {
    constructor() {
        this.header = document.querySelector('.header');
        this.mobileMenuBtn = document.getElementById('mobileMenuBtn');
        this.mobileNav = document.getElementById('mobileNav');
        this.headerOverlay = document.getElementById('headerOverlay');
        this.searchToggle = document.getElementById('searchToggle');
        this.searchOverlay = document.getElementById('searchOverlay');
        this.searchClose = document.getElementById('searchClose');
        this.searchInput = document.getElementById('searchInput');

        this.init();
    }

    init() {
        this.setupScrollEffect();
        this.setupMobileMenu();
        this.setupSearch();
        this.setupDropdowns();
        this.setupClickOutside();
        this.setupKeyboardShortcuts();
        this.setActiveNav();
    }

    setupScrollEffect() {
        if (!this.header) return;

        let lastScrollY = window.scrollY;
        const scrollThreshold = 80;
        const showThreshold = 20;

        window.addEventListener('scroll', () => {
            const currentScrollY = window.scrollY;
            const scrollingDown = currentScrollY > lastScrollY;

            if (currentScrollY <= showThreshold) {
                this.header.classList.remove('header-hidden');
                document.body.classList.remove('header-is-hidden');
                this.header.classList.remove('scrolled');
            } else {
                this.header.classList.add('scrolled');
                if (scrollingDown && currentScrollY > scrollThreshold) {
                    this.header.classList.add('header-hidden');
                    document.body.classList.add('header-is-hidden');
                } else {
                    this.header.classList.remove('header-hidden');
                    document.body.classList.remove('header-is-hidden');
                }
            }
            lastScrollY = currentScrollY;
        });
    }

    setupMobileMenu() {
        if (!this.mobileMenuBtn || !this.mobileNav) return;

        this.mobileMenuBtn.addEventListener('click', (e) => {
            e.preventDefault();
            this.toggleMobileMenu();
        });

        // Mobile dropdown toggles
        const mobileDropdowns = document.querySelectorAll('.mobile-dropdown');
        mobileDropdowns.forEach(dropdown => {
            const link = dropdown.querySelector('.mobile-nav-link');
            const arrow = dropdown.querySelector('.mobile-dropdown-arrow');

            if (link && arrow) {
                link.addEventListener('click', (e) => {
                    if (e.target.closest('.mobile-dropdown-arrow')) {
                        e.preventDefault();
                        this.toggleMobileDropdown(dropdown);
                    }
                });
            }
        });

        // Close mobile menu when clicking on overlay
        if (this.headerOverlay) {
            this.headerOverlay.addEventListener('click', () => {
                this.closeMobileMenu();
            });
        }
    }

    toggleMobileMenu() {
        const isActive = this.mobileNav.classList.contains('active');

        if (isActive) {
            this.closeMobileMenu();
        } else {
            this.openMobileMenu();
        }
    }

    openMobileMenu() {
        if (this.mobileNav) this.mobileNav.classList.add('active');
        if (this.mobileMenuBtn) this.mobileMenuBtn.classList.add('active');
        if (this.headerOverlay) this.headerOverlay.classList.add('active');
        document.body.style.overflow = 'hidden';
    }

    closeMobileMenu() {
        if (this.mobileNav) this.mobileNav.classList.remove('active');
        if (this.mobileMenuBtn) this.mobileMenuBtn.classList.remove('active');
        if (this.headerOverlay) this.headerOverlay.classList.remove('active');
        document.body.style.overflow = '';

        // Close all mobile dropdowns
        const activeDropdowns = document.querySelectorAll('.mobile-dropdown.active');
        activeDropdowns.forEach(dropdown => {
            dropdown.classList.remove('active');
        });
    }

    toggleMobileDropdown(dropdown) {
        const isActive = dropdown.classList.contains('active');

        // Close other dropdowns
        const otherDropdowns = document.querySelectorAll('.mobile-dropdown.active');
        otherDropdowns.forEach(other => {
            if (other !== dropdown) {
                other.classList.remove('active');
            }
        });

        // Toggle current dropdown
        dropdown.classList.toggle('active', !isActive);
    }

    setupSearch() {
        if (!this.searchToggle || !this.searchOverlay) return;

        this.searchToggle.addEventListener('click', (e) => {
            e.preventDefault();
            this.openSearch();
        });

        if (this.searchClose) {
            this.searchClose.addEventListener('click', (e) => {
                e.preventDefault();
                this.closeSearch();
            });
        }

        if (this.searchInput) {
            this.searchInput.addEventListener('input', (e) => {
                this.handleSearchInput(e.target.value);
            });

            this.searchInput.addEventListener('keydown', (e) => {
                if (e.key === 'Escape') {
                    this.closeSearch();
                }
            });
        }

        // Close search when clicking on overlay
        this.searchOverlay.addEventListener('click', (e) => {
            if (e.target === this.searchOverlay) {
                this.closeSearch();
            }
        });
    }

    openSearch() {
        this.searchOverlay.classList.add('active');
        document.body.style.overflow = 'hidden';

        // Focus on input after animation
        setTimeout(() => {
            if (this.searchInput) {
                this.searchInput.focus();
            }
        }, 300);
    }

    closeSearch() {
        this.searchOverlay.classList.remove('active');
        document.body.style.overflow = '';

        if (this.searchInput) {
            this.searchInput.value = '';
        }
    }

    handleSearchInput(query) {
        if (query.length > 2) {
            // Implement search functionality here
            console.log('Searching for:', query);
            // You can add actual search logic here
        }
    }

    setupDropdowns() {
        const dropdownItems = document.querySelectorAll('.nav-item');

        dropdownItems.forEach(item => {
            const dropdown = item.querySelector('.dropdown-menu');
            if (!dropdown) return;

            let hoverTimeout;

            item.addEventListener('mouseenter', () => {
                clearTimeout(hoverTimeout);
                this.showDropdown(dropdown);
            });

            item.addEventListener('mouseleave', () => {
                hoverTimeout = setTimeout(() => {
                    this.hideDropdown(dropdown);
                }, 100);
            });
        });
    }

    showDropdown(dropdown) {
        dropdown.style.opacity = '1';
        dropdown.style.visibility = 'visible';
        dropdown.style.transform = 'translateX(-50%) translateY(0) scale(1)';
    }

    hideDropdown(dropdown) {
        dropdown.style.opacity = '0';
        dropdown.style.visibility = 'hidden';
        dropdown.style.transform = 'translateX(-50%) translateY(-10px) scale(0.95)';
    }

    setupClickOutside() {
        document.addEventListener('click', (e) => {
            // Close mobile menu if clicking outside
            if (this.mobileNav && !this.mobileNav.contains(e.target) &&
                this.mobileMenuBtn && !this.mobileMenuBtn.contains(e.target) &&
                this.mobileNav.classList.contains('active')) {
                this.closeMobileMenu();
            }

            // Close search if clicking outside
            if (this.searchOverlay && !e.target.closest('.search-container') &&
                !e.target.closest('.search-overlay') &&
                this.searchOverlay.classList.contains('active')) {
                this.closeSearch();
            }
        });
    }

    setupKeyboardShortcuts() {
        document.addEventListener('keydown', (e) => {
            // Ctrl/Cmd + K to open search
            if ((e.ctrlKey || e.metaKey) && e.key === 'k') {
                e.preventDefault();
                this.openSearch();
            }

            // Escape to close overlays
            if (e.key === 'Escape') {
                if (this.searchOverlay && this.searchOverlay.classList.contains('active')) {
                    this.closeSearch();
                }
                if (this.mobileNav && this.mobileNav.classList.contains('active')) {
                    this.closeMobileMenu();
                }
            }
        });
    }

    setActiveNav() {
        setActiveNavLink();
    }

    // Public methods for external use
    updateCartCount(count) {
        const cartCounts = document.querySelectorAll('.cart-count, .mobile-cart-count, #mobileCartCount, #fixedCartCount');
        cartCounts.forEach(element => {
            element.textContent = count;
            element.style.display = count > 0 ? 'flex' : 'none';
        });
    }

    updateCartTotal(total) {
        const cartTotals = document.querySelectorAll('.cart-total');
        cartTotals.forEach(element => {
            element.textContent = `${total} TL`;
        });
    }

}

// ========== CART MANAGER ========== //
class CartManager {
    constructor() {
        this.items = this.loadCartFromStorage();
        this.headerManager = null;
        this.init();
    }

    init() {
        this.updateCartDisplay();
        this.setupEventListeners();
    }

    setHeaderManager(headerManager) {
        this.headerManager = headerManager;
    }

    loadCartFromStorage() {
        try {
            const saved = localStorage.getItem('yeppos_cart');
            return saved ? JSON.parse(saved) : [];
        } catch (error) {
            console.error('Error loading cart from storage:', error);
            return [];
        }
    }

    saveCartToStorage() {
        try {
            localStorage.setItem('yeppos_cart', JSON.stringify(this.items));
        } catch (error) {
            console.error('Error saving cart to storage:', error);
        }
    }

    addItem(item) {
        const existingItem = this.items.find(cartItem => cartItem.id === item.id);

        if (existingItem) {
            existingItem.quantity += item.quantity || 1;
        } else {
            this.items.push({
                ...item,
                quantity: item.quantity || 1,
                addedAt: new Date().toISOString()
            });
        }

        this.saveCartToStorage();
        this.updateCartDisplay();
        this.showAddToCartFeedback(item);
    }

    removeItem(itemId) {
        this.items = this.items.filter(item => item.id !== itemId);
        this.saveCartToStorage();
        this.updateCartDisplay();
    }

    updateItemQuantity(itemId, quantity) {
        const item = this.items.find(cartItem => cartItem.id === itemId);
        if (item) {
            if (quantity <= 0) {
                this.removeItem(itemId);
            } else {
                item.quantity = quantity;
                this.saveCartToStorage();
                this.updateCartDisplay();
            }
        }
    }

    clearCart() {
        this.items = [];
        this.saveCartToStorage();
        this.updateCartDisplay();
    }

    getCartCount() {
        return this.items.reduce((total, item) => total + item.quantity, 0);
    }

    getCartTotal() {
        return this.items.reduce((total, item) => total + (item.price * item.quantity), 0);
    }

    updateCartDisplay() {
        const count = this.getCartCount();
        const total = this.getCartTotal();

        if (this.headerManager) {
            this.headerManager.updateCartCount(count);
            this.headerManager.updateCartTotal(total.toFixed(2));
        }
    }

    showAddToCartFeedback(item) {
        // Create and show feedback notification
        const feedback = document.createElement('div');
        feedback.className = 'cart-feedback show';
        feedback.innerHTML = `
            <div class="cart-feedback-content">
                <i class="fas fa-check-circle"></i>
                <span>${item.name} sepete eklendi!</span>
            </div>
        `;

        document.body.appendChild(feedback);

        setTimeout(() => {
            feedback.classList.remove('show');
            setTimeout(() => {
                document.body.removeChild(feedback);
            }, 300);
        }, 2000);
    }

    setupEventListeners() {
        // Add to cart buttons
        document.addEventListener('click', (e) => {
            if (e.target.classList.contains('add-to-cart') ||
                e.target.closest('.add-to-cart')) {

                const button = e.target.classList.contains('add-to-cart') ?
                    e.target : e.target.closest('.add-to-cart');

                const productCard = button.closest('.menu-card, .product-card');
                if (productCard) {
                    this.handleAddToCart(productCard, button);
                }
            }
        });
    }

    handleAddToCart(productCard, button) {
        // Extract product data from card
        const id = productCard.dataset.productId || Date.now().toString();
        const name = productCard.querySelector('h3, .product-name')?.textContent || 'Ürün';
        const priceText = productCard.querySelector('.price')?.textContent || '0';
        const price = parseFloat(priceText.replace(/[\s]/g, '').replace(',', '.')) || 0;
        const image = productCard.querySelector('img')?.src || '';

        const item = {
            id,
            name,
            price,
            image,
            quantity: 1
        };

        // Add loading state to button
        const originalText = button.innerHTML;
        button.innerHTML = '<i class="fas fa-spinner fa-spin"></i>';
        button.disabled = true;

        // Simulate add to cart delay
        setTimeout(() => {
            this.addItem(item);

            // Reset button
            button.innerHTML = originalText;
            button.disabled = false;
        }, 500);
    }
}

// ========== APP INITIALIZATION ========== //
class App {
    constructor() {
        this.headerManager = new HeaderManager();
        this.cartManager = new CartManager();

        // DARK MODE TOGGLE
        this.initDarkMode();

        this.init();
    }

    initDarkMode() {
        const darkModeToggle = document.getElementById('darkModeToggle');
        // Tercihi uygula
        const theme = localStorage.getItem('yeppos_theme');
        if (theme === 'dark') {
            document.body.classList.add('dark-mode');
        } else {
            document.body.classList.remove('dark-mode');
        }
        // Toggle butonu
        if (darkModeToggle) {
            darkModeToggle.addEventListener('click', () => {
                const isDark = document.body.classList.toggle('dark-mode');
                localStorage.setItem('yeppos_theme', isDark ? 'dark' : 'light');
            });
        }
    }

    init() {
        // Show loading screen
        this.showLoadingScreen();

        // Connect managers
        this.cartManager.setHeaderManager(this.headerManager);

        // Setup global event listeners
        this.setupGlobalEvents();

        // Hide loading screen after initialization
        setTimeout(() => {
            this.hideLoadingScreen();
        }, 1000);
    }

    showLoadingScreen() {
        const loadingScreen = document.getElementById('loading-screen');
        if (loadingScreen) {
            loadingScreen.style.display = 'flex';
        }
    }

    hideLoadingScreen() {
        const loadingScreen = document.getElementById('loading-screen');
        if (loadingScreen) {
            loadingScreen.classList.add('fade-out');
            setTimeout(() => {
                loadingScreen.style.display = 'none';
                loadingScreen.classList.remove('fade-out');
                document.body.classList.add('loaded');
            }, 500);
        }
    }

    setupGlobalEvents() {
        // Page load complete
        window.addEventListener('load', () => {
            this.hideLoadingScreen();
        });

        // Handle page navigation
        window.addEventListener('beforeunload', () => {
            // Save any pending data
        });

        // Handle online/offline status
        window.addEventListener('online', () => {
            console.log('Connection restored');
        });

        window.addEventListener('offline', () => {
            console.log('Connection lost');
        });
    }
}

// ========== START APP ========== //
document.addEventListener('DOMContentLoaded', () => {
    window.yepposApp = new App();

    // Mobile Navigation Close Button
    const mobileNavClose = document.getElementById('mobileNavClose');
    const mobileMenuBtn = document.getElementById('mobileMenuBtn');
    const mobileNav = document.getElementById('mobileNav');

    if (mobileNavClose && mobileMenuBtn && mobileNav) {
        mobileNavClose.addEventListener('click', () => {
            mobileMenuBtn.classList.remove('active');
            mobileNav.classList.remove('active');
            document.body.classList.remove('menu-open');

            // Remove all overlays and backdrops
            const backdrop = document.querySelector('.mobile-nav-backdrop');
            if (backdrop) {
                backdrop.classList.remove('active');
            }

            const headerOverlay = document.getElementById('headerOverlay');
            if (headerOverlay) {
                headerOverlay.classList.remove('active');
            }

            // Remove any blur from body
            document.body.style.overflow = '';
            document.body.style.filter = '';

            // Close all mobile dropdowns
            const mobileDropdowns = document.querySelectorAll('.mobile-dropdown.active');
            mobileDropdowns.forEach(dropdown => {
                dropdown.classList.remove('active');
            });
        });
    }
});

// ========== UTILITY FUNCTIONS ========== //
function generateQR() {
    const qrCodeImg = document.querySelector('.qr-code img');
    if (qrCodeImg) {
        const url = window.location.origin + '/pages/menu.html?qr=true';
        qrCodeImg.src = `https://api.qrserver.com/v1/create-qr-code/?size=200x200&data=${encodeURIComponent(url)}`;
    }
}

// Make functions globally available
window.generateQR = generateQR;
