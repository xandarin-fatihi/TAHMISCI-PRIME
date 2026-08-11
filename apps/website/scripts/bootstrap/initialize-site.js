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

class YepPosApp {
    constructor() {
        this.isLoaded = false;
        this.currentUser = null;
        this.cart = [];

        // Initialize app when DOM is ready
        if (document.readyState === 'loading') {
            document.addEventListener('DOMContentLoaded', () => this.init());
        } else {
            this.init();
        }
    }

    // ========== INITIALIZATION ==========

    async init() {
        try {
            console.log('Initializing YepPos App...');

            // Process URL parameters for QR code compatibility
            this.processURLParameters();

            // Show loading screen
            this.showLoadingScreen();

            // Initialize core components
            await this.initializeComponents();

            // Load user data and preferences
            this.loadUserData();
            this.loadCart();
            this.loadPreferences();

            // Setup event listeners
            this.setupEventListeners();

            // Initialize page-specific functionality
            this.initializePage();

            // Hide loading screen
            setTimeout(() => {
                this.hideLoadingScreen();
                this.isLoaded = true;

                // Emit app ready event
                Utils.emit(document, EVENTS.APP_READY);

                console.log('✅ YepPos App initialized successfully');
            }, APP_CONFIG.ui.animations.loadingScreen);

        } catch (error) {
            console.error('❌ App initialization failed:', error);
            this.handleError(error);
        }
    }

    // ========== URL PARAMETER PROCESSING ==========

    processURLParameters() {
        const urlParams = new URLSearchParams(window.location.search);
        const companyId = urlParams.get('company_id');
        const type = urlParams.get('type');
        const g = urlParams.get('g');
        const w = urlParams.get('w');
        const token = urlParams.get('token');

        console.log('URL Parameter Processing:', {
            companyId,
            type,
            g,
            w,
            token,
            fullUrl: window.location.href
        });

        // Eski QR kodlar için (yeppos/menuler?company_id=48)
        if (companyId && !type) {
            // Branch ID'yi localStorage'a kaydet
            localStorage.setItem('menuBranchId', companyId);
            // QR ile geldiğini işaretle
            localStorage.setItem('menuBranchSelectionType', 'qr');

            // Eski QR formatları - sadece type parametresi yoksa işle
            if (g === '1') {
                // Gel-Al siparişi
                localStorage.setItem('menuOrderType', 'takeaway');
            } else if (w === '1') {
                // Paket servis
                localStorage.setItem('menuOrderType', 'delivery');
            } else {
                // Sadece company_id varsa ve g/w yoksa masa menüsü
                localStorage.setItem('menuOrderType', 'tableMenu');
            }
        }

        // Yeni QR kodlar için (web/menuler?company_id=48&type=tableMenu)
        if (type) {
            // Branch ID varsa kaydet
            if (companyId) {
                localStorage.setItem('menuBranchId', companyId);
                // QR ile geldiğini işaretle
                localStorage.setItem('menuBranchSelectionType', 'qr');
            }

            // Order type'ı localStorage'a kaydet
            if (type === 'tableMenu' || type === 'tableOrder' || type === 'takeaway' || type === 'delivery') {
                localStorage.setItem('menuOrderType', type);
            }

            // Token varsa kaydet (tableOrder için)
            if (token) {
                localStorage.setItem('tableOrderToken', token);
            }
        }

        // Eğer URL'den hiçbir parametre gelmediyse ve branchSelectionType yoksa manuel olarak işaretle
        if (!companyId && !type && !g && !w && !token) {
            const existingType = localStorage.getItem('menuBranchSelectionType');
            if (!existingType) {
                localStorage.setItem('menuBranchSelectionType', 'manual');
            }
        }

        // URL parametrelerini temizle (isteğe bağlı - sayfa yeniden yüklendiğinde tekrar işlenmesin)
        if (companyId || type || g || w || token) {
            const newUrl = window.location.pathname;
            window.history.replaceState({}, document.title, newUrl);
        }
    }

    async initializeComponents() {
        // Initialize header functionality
        this.initializeHeader();

        // Initialize search functionality
        this.initializeSearch();

        // Initialize user menu
        this.initializeUserMenu();

        // Initialize mobile navigation
        this.initializeMobileNav();

        // Initialize scroll effects
        this.initializeScrollEffects();

        // Initialize cookie notice
        this.initializeCookieNotice();

        // Bildirimler: Swal toast (showSwalToast) kullanılıyor

        // Initialize lazy loading
        this.initializeLazyLoading();
    }

    // ========== LOADING SCREEN ==========

    showLoadingScreen() {
        const loadingScreen = $('#loading-screen');
        if (loadingScreen) {
            loadingScreen.style.display = 'flex';
        }
    }

    hideLoadingScreen() {
        const loadingScreen = $('#loading-screen');
        if (loadingScreen) {
            loadingScreen.classList.add('fade-out');
            setTimeout(() => {
                loadingScreen.style.display = 'none';
                loadingScreen.classList.remove('fade-out');
            }, APP_CONFIG.ui.animations.normal);
        }
    }

    // ========== HEADER FUNCTIONALITY ==========

    initializeHeader() {
        const header = $('#header');
        if (!header) return;

        // Header scroll: aşağı kaydırınca gizle, yukarı kaydırınca göster
        let lastScrollTop = 0;
        const scrollThreshold = 80;
        const showThreshold = 20;

        const handleScroll = Utils.throttle(() => {
            const scrollTop = window.pageYOffset || document.documentElement.scrollTop;
            const scrollingDown = scrollTop > lastScrollTop;

            if (scrollTop <= showThreshold) {
                header.classList.remove('header-hidden');
                document.body.classList.remove('header-is-hidden');
                header.classList.remove('scrolled');
            } else {
                header.classList.add('scrolled');
                if (scrollingDown && scrollTop > scrollThreshold) {
                    header.classList.add('header-hidden');
                    document.body.classList.add('header-is-hidden');
                } else {
                    header.classList.remove('header-hidden');
                    document.body.classList.remove('header-is-hidden');
                }
            }
            lastScrollTop = scrollTop;
        }, 80);

        window.addEventListener('scroll', handleScroll);

        // Update cart count display
        this.updateCartCount();
    }

    // ========== SEARCH FUNCTIONALITY ==========

    initializeSearch() {
        const searchBtn = $('#searchToggle');
        const searchOverlay = $('#searchOverlay');
        const searchClose = $('#searchClose');
        const searchInput = $('#searchInput');

        if (!searchBtn || !searchOverlay) return;

        // Open search overlay
        searchBtn.addEventListener('click', () => {
            searchOverlay.classList.add('show');
            document.body.style.overflow = 'hidden';

            // Focus input after animation
            setTimeout(() => {
                if (searchInput) searchInput.focus();
            }, APP_CONFIG.ui.animations.normal);
        });

        // Close search overlay
        const closeSearch = () => {
            searchOverlay.classList.remove('show');
            document.body.style.overflow = '';
            if (searchInput) searchInput.value = '';
        };

        if (searchClose) {
            searchClose.addEventListener('click', closeSearch);
        }

        // Close on escape key
        document.addEventListener('keydown', (e) => {
            if (e.key === 'Escape' && searchOverlay.classList.contains('show')) {
                closeSearch();
            }
        });

        // Close on backdrop click
        searchOverlay.addEventListener('click', (e) => {
            if (e.target === searchOverlay) {
                closeSearch();
            }
        });

        // Search functionality (demo)
        if (searchInput) {
            const debouncedSearch = Utils.debounce((query) => {
                if (query.length >= APP_CONFIG.ui.search.minCharacters) {
                    this.performSearch(query);
                }
            }, APP_CONFIG.ui.search.debounceDelay);

            searchInput.addEventListener('input', (e) => {
                debouncedSearch(e.target.value.trim());
            });

            searchInput.addEventListener('keydown', (e) => {
                if (e.key === 'Enter') {
                    e.preventDefault();
                    const query = e.target.value.trim();
                    if (query) {
                        // Redirect to menu page with search query
                        window.location.href = `pages/menu.html?search=${encodeURIComponent(query)}`;
                    }
                }
            });
        }
    }

    performSearch(query) {
        // Demo search functionality
        console.log('Searching for:', query);
        Utils.emit(document, EVENTS.SEARCH_PERFORMED, { query });

        // In a real app, this would make an API call
        // For demo, we'll just show a toast
        setTimeout(() => {
            showSwalToast(`"${query}" için arama yapıldı`, 'info');
        }, 300);
    }

    // ========== USER MENU ==========

    initializeUserMenu() {
        const userBtn = $('#userBtn');
        const userDropdown = $('#userDropdown');
        const logoutBtn = $('#logoutBtn');

        if (!userBtn || !userDropdown) return;

        // Toggle user dropdown
        userBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            userDropdown.classList.toggle('show');
        });

        // Close dropdown when clicking outside
        document.addEventListener('click', (e) => {
            if (!userDropdown.contains(e.target) && !userBtn.contains(e.target)) {
                userDropdown.classList.remove('show');
            }
        });

        // Handle logout
        if (logoutBtn) {
            logoutBtn.addEventListener('click', () => {
                this.logout();
            });
        }

        // Update user menu display
        this.updateUserMenu();
    }

    updateUserMenu() {
        const authLinks = $('#authLinks');
        const userLinks = $('#userLinks');
        const userName = $('#userName');

        // Mobile elements
        const mobileAuth = $('#mobileAuth');
        const mobileUserWelcome = $('#mobileUserWelcome');
        const mobileUserName = $('.mobile-user-name');

        if (this.currentUser) {
            // User is logged in
            if (authLinks) authLinks.style.display = 'none';
            if (userLinks) userLinks.style.display = 'block';
            if (userName) userName.textContent = `Merhaba, ${this.currentUser.firstName}!`;

            // Update mobile elements
            if (mobileAuth) mobileAuth.style.display = 'none';
            if (mobileUserWelcome) mobileUserWelcome.style.display = 'flex';
            if (mobileUserName) mobileUserName.textContent = this.currentUser.firstName;
        } else {
            // User is not logged in
            if (authLinks) authLinks.style.display = 'block';
            if (userLinks) userLinks.style.display = 'none';

            // Update mobile elements
            if (mobileAuth) mobileAuth.style.display = 'flex';
            if (mobileUserWelcome) mobileUserWelcome.style.display = 'none';
        }
    }

    // ========== MOBILE NAVIGATION ==========

    initializeMobileNav() {
        const mobileToggle = $('#mobileMenuBtn');
        const mobileNav = $('#mobileNav');
        const headerOverlay = $('#headerOverlay');

        if (!mobileToggle || !mobileNav) return;

        // Mobile menu toggle
        mobileToggle.addEventListener('click', () => {
            const isActive = mobileToggle.classList.contains('active');

            if (isActive) {
                this.closeMobileMenu();
            } else {
                this.openMobileMenu();
            }
        });

        // Close mobile menu when clicking on overlay
        if (headerOverlay) {
            headerOverlay.addEventListener('click', () => {
                this.closeMobileMenu();
            });
        }

        // Close mobile menu when clicking on a link
        const mobileLinks = $$('.mobile-nav-link');
        mobileLinks.forEach(link => {
            link.addEventListener('click', () => {
                this.closeMobileMenu();
            });
        });

        // Mobile dropdown functionality
        const mobileDropdowns = $$('.mobile-dropdown');
        mobileDropdowns.forEach(dropdown => {
            const link = dropdown.querySelector('.mobile-nav-link');
            const arrow = dropdown.querySelector('.mobile-dropdown-arrow');

            if (link && arrow) {
                arrow.addEventListener('click', (e) => {
                    e.preventDefault();
                    e.stopPropagation();
                    dropdown.classList.toggle('active');
                });
            }
        });

        // Close mobile menu on escape key
        document.addEventListener('keydown', (e) => {
            if (e.key === 'Escape' && mobileNav.classList.contains('active')) {
                this.closeMobileMenu();
            }
        });
    }

    openMobileMenu() {
        const mobileToggle = $('#mobileMenuBtn');
        const mobileNav = $('#mobileNav');
        const headerOverlay = $('#headerOverlay');

        // Create backdrop if it doesn't exist
        let backdrop = $('.mobile-nav-backdrop');
        if (!backdrop) {
            backdrop = document.createElement('div');
            backdrop.className = 'mobile-nav-backdrop';
            document.body.appendChild(backdrop);

            // Add click listener to backdrop
            backdrop.addEventListener('click', () => {
                this.closeMobileMenu();
            });
        }

        if (mobileToggle && mobileNav) {
            mobileToggle.classList.add('active');
            mobileNav.classList.add('active');
            backdrop.classList.add('active');
            document.body.classList.add('menu-open');

            if (headerOverlay) {
                headerOverlay.classList.add('active');
            }
        }
    }

    closeMobileMenu() {
        const mobileToggle = $('#mobileMenuBtn');
        const mobileNav = $('#mobileNav');
        const headerOverlay = $('#headerOverlay');
        const backdrop = $('.mobile-nav-backdrop');

        if (mobileToggle && mobileNav) {
            mobileToggle.classList.remove('active');
            mobileNav.classList.remove('active');
            document.body.classList.remove('menu-open');

            if (backdrop) {
                backdrop.classList.remove('active');
            }

            if (headerOverlay) {
                headerOverlay.classList.remove('active');
            }

            // Close all mobile dropdowns
            const mobileDropdowns = $$('.mobile-dropdown.active');
            mobileDropdowns.forEach(dropdown => {
                dropdown.classList.remove('active');
            });
        }
    }

    // ========== SCROLL EFFECTS ==========

    initializeScrollEffects() {
        // Smooth scroll for anchor links
        const anchorLinks = $$('a[href^="#"]');
        anchorLinks.forEach(link => {
            link.addEventListener('click', (e) => {
                const href = link.getAttribute('href');
                if (href === '#') return;

                e.preventDefault();
                const target = $(href);
                if (target) {
                    Utils.scrollTo(target, 80); // Offset for fixed header
                }
            });
        });

        // Intersection Observer for animations
        if (FEATURES.intersectionObserver) {
            this.initializeScrollAnimations();
        }
    }

    initializeScrollAnimations() {
        const observerOptions = {
            threshold: 0.1,
            rootMargin: '0px 0px -50px 0px'
        };

        const observer = new IntersectionObserver((entries) => {
            entries.forEach(entry => {
                if (entry.isIntersecting) {
                    entry.target.classList.add('animate-in');
                    observer.unobserve(entry.target);
                }
            });
        }, observerOptions);

        // Observe elements for animation
        const animateElements = $$('.category-card, .contact-card, .about-content, .qr-content');
        animateElements.forEach(el => observer.observe(el));
    }

    // ========== LAZY LOADING ==========

    initializeLazyLoading() {
        if (!FEATURES.intersectionObserver) return;

        const imageObserver = new IntersectionObserver((entries) => {
            entries.forEach(entry => {
                if (entry.isIntersecting) {
                    const img = entry.target;
                    if (img.dataset.src) {
                        Utils.lazyLoadImage(img, img.dataset.src);
                        imageObserver.unobserve(img);
                    }
                }
            });
        });

        // Observe all images with data-src attribute
        const lazyImages = $$('img[data-src]');
        lazyImages.forEach(img => imageObserver.observe(img));
    }

    // ========== COOKIE NOTICE ==========

    initializeCookieNotice() {
        const cookieNotice = $('#cookieNotice');
        const cookieAccept = $('#cookieAccept');
        const cookieDecline = $('#cookieDecline');

        if (!cookieNotice) return;

        // Check if user has already made a choice
        const cookiesAccepted = Utils.getStorage(APP_CONFIG.storage.cookies);

        if (cookiesAccepted === null) {
            // Show cookie notice after a delay
            setTimeout(() => {
                cookieNotice.classList.add('show');
            }, 2000);
        }

        // Handle accept
        if (cookieAccept) {
            cookieAccept.addEventListener('click', () => {
                Utils.setStorage(APP_CONFIG.storage.cookies, true);
                cookieNotice.classList.remove('show');
                showSwalToast('Çerez ayarları kaydedildi', 'success');
            });
        }

        // Handle decline
        if (cookieDecline) {
            cookieDecline.addEventListener('click', () => {
                Utils.setStorage(APP_CONFIG.storage.cookies, false);
                cookieNotice.classList.remove('show');
                showSwalToast('Çerez ayarları kaydedildi', 'info');
            });
        }
    }

    // ========== USER DATA MANAGEMENT ==========

    loadUserData() {
        const userData = Utils.getStorage(APP_CONFIG.storage.user);
        if (userData) {
            this.currentUser = userData;
            console.log('User data loaded:', this.currentUser);
        }
    }

    saveUserData() {
        if (this.currentUser) {
            Utils.setStorage(APP_CONFIG.storage.user, this.currentUser);
        }
    }

    logout() {
        this.currentUser = null;
        Utils.removeStorage(APP_CONFIG.storage.user);
        Utils.removeStorage(APP_CONFIG.storage.session);

        this.updateUserMenu();
        showSwalToast(APP_CONFIG.success.logout, 'success');

        // Emit logout event
        Utils.emit(document, EVENTS.USER_LOGOUT);

        // Redirect to home page if on a protected page
        if (window.location.pathname.includes('/profile') || window.location.pathname.includes('/orders')) {
            window.location.href = '/index.html';
        }
    }

    // ========== CART MANAGEMENT ==========

    loadCart() {
        const cartData = Utils.getStorage(APP_CONFIG.storage.cart, []);
        this.cart = Array.isArray(cartData) ? cartData : [];
        this.updateCartCount();
    }

    updateCartCount() {
        const cartCount = $('#cartCount');
        const mobileCartCounts = document.querySelectorAll('.mobile-cart-count');

        if (cartCount) {
            const totalItems = this.cart.reduce((sum, item) => sum + (item.quantity || 1), 0);
            cartCount.textContent = totalItems;
            cartCount.style.display = totalItems > 0 ? 'flex' : 'none';

            // Update all mobile cart count elements
            mobileCartCounts.forEach(element => {
                element.textContent = totalItems;
                element.style.display = totalItems > 0 ? 'flex' : 'none';
            });
        }
    }

    // ========== PREFERENCES ==========

    loadPreferences() {
        const preferences = Utils.getStorage(APP_CONFIG.storage.preferences, {});

        // Apply theme preference
        if (preferences.theme) {
            this.applyTheme(preferences.theme);
        }
    }

    applyTheme(theme) {
        document.documentElement.setAttribute('data-theme', theme);
        if (theme === 'dark') {
            document.body.classList.add('dark-mode');
        } else {
            document.body.classList.remove('dark-mode');
        }
        Utils.setStorage(APP_CONFIG.storage.preferences, { theme });
    }

    // ========== PAGE-SPECIFIC INITIALIZATION ==========

    initializePage() {
        const path = window.location.pathname;

        if (path.includes('index.html') || path === '/' || path === '') {
            this.initializeHomePage();
        } else if (path.includes('menu.html')) {
            this.initializeMenuPage();
        } else if (path.includes('siparis')) {
            this.initializeCartPage();
        } else if (path.includes('profile.html')) {
            this.initializeProfilePage();
        }
    }

    initializeHomePage() {
        console.log('Initializing home page...');

        // Initialize category cards hover effects
        const categoryCards = $$('.category-card');
        categoryCards.forEach(card => {
            card.addEventListener('click', () => {
                const category = card.dataset.category;
                if (category) {
                    window.location.href = `pages/menu.html?category=${category}`;
                }
            });
        });

        // QR code generation
        const generateQRBtn = $('button[onclick="generateQR()"]');
        if (generateQRBtn) {
            generateQRBtn.removeAttribute('onclick');
            generateQRBtn.addEventListener('click', this.generateQRCode.bind(this));
        }

        // Hero image parallax effect (if supported)
        if (!ENV.isMobile) {
            this.initializeParallax();
        }
    }

    initializeMenuPage() {
        console.log('Initializing menu page...');
        // Menu page specific functionality will be added when we create the menu page
    }

    initializeCartPage() {
        console.log('Initializing cart page...');
        // Cart page specific functionality will be added when we create the cart page
    }

    initializeProfilePage() {
        console.log('Initializing profile page...');
        // Profile page specific functionality will be added when we create the profile page
    }

    // ========== PARALLAX EFFECT ==========

    initializeParallax() {
        const heroImage = $('.hero-img');
        if (!heroImage) return;

        const handleParallax = Utils.throttle(() => {
            const scrolled = window.pageYOffset;
            const rate = scrolled * -0.5;
            heroImage.style.transform = `translateY(${rate}px)`;
        }, 16); // ~60fps

        window.addEventListener('scroll', handleParallax);
    }

    // ========== QR CODE GENERATION ==========

    generateQRCode() {
        const menuUrl = `${window.location.origin}/pages/menu.html`;
        const qrCodeImg = $('.qr-code img');

        if (qrCodeImg) {
            const newQRUrl = `https://api.qrserver.com/v1/create-qr-code/?size=200x200&data=${encodeURIComponent(menuUrl)}`;
            qrCodeImg.src = newQRUrl;

            showSwalToast('QR kod yenilendi!', 'success');
        }
    }

    // ========== ERROR HANDLING ==========

    handleError(error) {
        console.error('App Error:', error);

        const errorMessage = error.message || APP_CONFIG.errors.generic;
        showSwalToast(errorMessage, 'error');

        // Emit error event
        Utils.emit(document, EVENTS.APP_ERROR, { error });

        // Hide loading screen on error
        this.hideLoadingScreen();
    }

    // ========== GLOBAL EVENT HANDLERS ==========

    setupEventListeners() {
        // Online/offline status
        window.addEventListener('online', () => {
            showSwalToast('İnternet bağlantısı yeniden kuruldu', 'success');
        });

        window.addEventListener('offline', () => {
            showSwalToast('İnternet bağlantısı kesildi', 'warning');
        });

        // Unload warning for unsaved changes (cart items)
        window.addEventListener('beforeunload', (e) => {
            if (this.cart.length > 0) {
                const message = 'Sepetinizde ürünler var. Sayfadan ayrılmak istediğinizden emin misiniz?';
                e.returnValue = message;
                return message;
            }
        });

        // Handle app-level custom events
        document.addEventListener(EVENTS.USER_LOGIN, () => {
            this.updateUserMenu();
        });

        document.addEventListener(EVENTS.CART_UPDATED, () => {
            this.updateCartCount();
        });

        // Dark mode toggle
        const darkModeToggle = document.getElementById('darkModeToggle');
        if (darkModeToggle) {
            darkModeToggle.addEventListener('click', () => {
                const isDark = document.body.classList.toggle('dark-mode');
                this.applyTheme(isDark ? 'dark' : 'light');
            });
        }
    }
}

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

    updateUserStatus(isLoggedIn, userData = null) {
        const authLinks = document.getElementById('authLinks');
        const userLinks = document.getElementById('userLinks');
        const mobileAuth = document.getElementById('mobileAuth');
        const mobileUserWelcome = document.getElementById('mobileUserWelcome');

        if (!customerAccountsEnabled()) {
            if (authLinks) authLinks.style.display = 'none';
            if (userLinks) userLinks.style.display = 'none';
            if (mobileAuth) mobileAuth.style.display = 'none';
            if (mobileUserWelcome) mobileUserWelcome.style.display = 'none';
            return;
        }

        if (isLoggedIn && userData) {
            // Desktop
            if (authLinks) authLinks.style.display = 'none';
            if (userLinks) userLinks.style.display = 'block';

            // Mobile
            if (mobileAuth) mobileAuth.style.display = 'none';
            if (mobileUserWelcome) mobileUserWelcome.style.display = 'flex';

            // Update user info; userNameDisplay: sadece name, en fazla 10 karakter
            const userNameElements = document.querySelectorAll('#userName, .mobile-user-name');
            const userEmailElements = document.querySelectorAll('#userEmail');
            const userDisplayElements = document.querySelectorAll('#userNameDisplay');
            const namePart = (userData.firstName && userData.firstName.trim()) ? userData.firstName.trim() : (String(userData.name || '').trim().split(/\s+/)[0] || userData.name || '');
            const displayName = namePart.length > 10 ? namePart.substring(0, 10) : namePart;

            userNameElements.forEach(el => el.textContent = userData.name);
            userEmailElements.forEach(el => el.textContent = userData.email);
            userDisplayElements.forEach(el => el.textContent = displayName);
            // Header avatar: baş harfler (AÇ, YEP)
            const userAvatar = document.getElementById('userAvatar');
            if (userAvatar && userData.name) {
                const words = String(userData.name).trim().split(/\s+/).filter(Boolean);
                const initials = words.slice(0, 3).map((w) => (w.charAt(0) || '')).join('').toUpperCase();
                if (initials) {
                    userAvatar.innerHTML = '<span class="profile-menu-avatar-initials">' + initials + '</span>';
                } else {
                    userAvatar.innerHTML = '<i class="fas fa-user"></i>';
                }
            } else if (userAvatar) {
                userAvatar.innerHTML = '<i class="fas fa-user"></i>';
            }

        } else {
            // Desktop
            if (authLinks) authLinks.style.display = 'block';
            if (userLinks) userLinks.style.display = 'none';

            // Mobile
            if (mobileAuth) mobileAuth.style.display = 'flex';
            if (mobileUserWelcome) mobileUserWelcome.style.display = 'none';

            // Reset display text
            const userDisplayElements = document.querySelectorAll('#userNameDisplay');
            userDisplayElements.forEach(el => el.textContent = 'Giriş');
            const userAvatar = document.getElementById('userAvatar');
            if (userAvatar) {
                userAvatar.innerHTML = '<i class="fas fa-user"></i>';
            }
        }
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

// ========== AUTH MANAGER ========== //
class AuthManager {
    constructor() {
        this.currentUser = this.loadUserFromStorage();
        this.headerManager = null;
        this.init();
    }

    init() {
        this.updateAuthDisplay();
        this.setupEventListeners();
    }

    setHeaderManager(headerManager) {
        this.headerManager = headerManager;
    }

    loadUserFromStorage() {
        try {
            const saved = localStorage.getItem('yeppos_user');
            return saved ? JSON.parse(saved) : null;
        } catch (error) {
            console.error('Error loading user from storage:', error);
            return null;
        }
    }

    saveUserToStorage(user) {
        try {
            localStorage.setItem('yeppos_user', JSON.stringify(user));
        } catch (error) {
            console.error('Error saving user to storage:', error);
        }
    }

    login(userData) {
        this.currentUser = userData;
        this.saveUserToStorage(userData);
        this.updateAuthDisplay();
    }

    logout() {
        this.currentUser = null;
        localStorage.removeItem('yeppos_user');
        this.updateAuthDisplay();
    }

    updateAuthDisplay() {
        if (this.headerManager) {
            this.headerManager.updateUserStatus(!!this.currentUser, this.currentUser);
        }
    }

    setupEventListeners() {
        // Logout button
        const logoutBtn = document.getElementById('logoutBtn');
        if (logoutBtn) {
            logoutBtn.addEventListener('click', () => {
                this.logout();
            });
        }
    }

    isLoggedIn() {
        return !!this.currentUser;
    }

    getCurrentUser() {
        return this.currentUser;
    }
}

function customerAccountsEnabled() {
    return window.TAHMISCI_CUSTOMER_ACCOUNTS_ENABLED === true ||
        document.documentElement.dataset.customerAccounts === 'enabled';
}

// ========== APP INITIALIZATION ========== //
class App {
    constructor() {
        this.headerManager = new HeaderManager();
        this.cartManager = new CartManager();
        this.authManager = customerAccountsEnabled() ? new AuthManager() : null;

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
        if (this.authManager) {
            this.authManager.setHeaderManager(this.headerManager);
        } else if (this.headerManager && typeof this.headerManager.updateUserStatus === 'function') {
            this.headerManager.updateUserStatus(false, null);
        }

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
