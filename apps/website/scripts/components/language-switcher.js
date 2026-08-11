// ========== LANGUAGE SWITCHER ==========
class LanguageSwitcher {
    constructor() {
        this.currentLanguage = window.I18N?.getPreferredLanguage?.() || localStorage.getItem('site_language') || 'tr';
        this.languageBtn = document.getElementById('languageBtn');
        this.languageDropdown = document.getElementById('languageDropdown');
        this.currentLanguageSpan = document.getElementById('currentLanguage');
        this.mobileLanguageBtn = document.getElementById('mobileLanguageBtn');
        this.mobileLanguageDropdown = document.getElementById('mobileLanguageDropdown');
        this.mobileCurrentLanguageSpan = document.getElementById('mobileCurrentLanguage');
        this.init();
    }

    init() {
        // Set initial language from storage/default
        this.currentLanguage = window.I18N?.getPreferredLanguage?.() || localStorage.getItem('site_language') || 'tr';
        this.updateCurrentLanguageDisplay();
        this.updateActiveLanguage();

        // Desktop language switcher
        if (this.languageBtn && this.languageDropdown) {
            // Toggle dropdown
            this.languageBtn.addEventListener('click', (e) => {
                e.preventDefault();
                e.stopPropagation();
                this.toggleDropdown();
            });

            // Close dropdown when clicking outside
            document.addEventListener('click', (e) => {
                if (!this.languageBtn.contains(e.target) && !this.languageDropdown.contains(e.target)) {
                    this.closeDropdown();
                }
            });

            // Handle language selection
            const languageOptions = this.languageDropdown.querySelectorAll('.language-option');
            languageOptions.forEach(option => {
                option.addEventListener('click', () => {
                    const lang = option.getAttribute('data-lang');
                    this.changeLanguage(lang);
                });
            });
        }

        // Mobile language switcher
        if (this.mobileLanguageBtn && this.mobileLanguageDropdown) {
            // Toggle dropdown
            this.mobileLanguageBtn.addEventListener('click', (e) => {
                e.stopPropagation();
                this.toggleMobileDropdown();
            });

            // Close dropdown when clicking outside (only on mobile)
            document.addEventListener('click', (e) => {
                if (!this.mobileLanguageBtn.contains(e.target) && !this.mobileLanguageDropdown.contains(e.target)) {
                    this.closeMobileDropdown();
                }
            });

            // Handle mobile language selection
            const mobileLanguageOptions = this.mobileLanguageDropdown.querySelectorAll('.mobile-language-option');
            mobileLanguageOptions.forEach(option => {
                option.addEventListener('click', () => {
                    const lang = option.getAttribute('data-lang');
                    this.changeLanguage(lang);
                });
            });
        }

    }

    toggleDropdown() {
        if (!this.languageBtn) return;
        const switcher = this.languageBtn.closest('.language-switcher');
        if (switcher) {
            switcher.classList.toggle('active');
        }
    }

    closeDropdown() {
        const switcher = this.languageBtn?.closest('.language-switcher');
        if (switcher) {
            switcher.classList.remove('active');
        }
    }

    toggleMobileDropdown() {
        const switcher = this.mobileLanguageBtn?.closest('.mobile-language-switcher');
        if (switcher) {
            switcher.classList.toggle('active');
        }
    }

    closeMobileDropdown() {
        const switcher = this.mobileLanguageBtn?.closest('.mobile-language-switcher');
        if (switcher) {
            switcher.classList.remove('active');
        }
    }

    changeLanguage(lang) {
        if (lang === this.currentLanguage) {
            this.closeDropdown();
            this.closeMobileDropdown();
            return;
        }

        this.currentLanguage = lang;
        if (window.I18N && typeof window.I18N.setLanguage === 'function') {
            window.I18N.setLanguage(lang);
        } else {
            localStorage.setItem('site_language', lang);
            window.dispatchEvent(new CustomEvent('languageChanged', { detail: { language: lang } }));
        }

        // Update display
        this.updateCurrentLanguageDisplay();
        this.updateActiveLanguage();
        this.closeDropdown();
        this.closeMobileDropdown();
    }

    updateCurrentLanguageDisplay() {
        if (this.currentLanguageSpan) {
            this.currentLanguageSpan.textContent = this.currentLanguage.toUpperCase();
        }
        if (this.mobileCurrentLanguageSpan) {
            this.mobileCurrentLanguageSpan.textContent = this.currentLanguage.toUpperCase();
        }
    }

    updateActiveLanguage() {
        // Desktop language options
        const languageOptions = this.languageDropdown?.querySelectorAll('.language-option') || [];
        languageOptions.forEach(option => {
            const lang = option.getAttribute('data-lang');
            if (lang === this.currentLanguage) {
                option.classList.add('active');
            } else {
                option.classList.remove('active');
            }
        });

        // Mobile language options
        const mobileLanguageOptions = document.querySelectorAll('.mobile-language-option');
        mobileLanguageOptions.forEach(option => {
            const lang = option.getAttribute('data-lang');
            if (lang === this.currentLanguage) {
                option.classList.add('active');
            } else {
                option.classList.remove('active');
            }
        });
    }

    getCurrentLanguage() {
        return this.currentLanguage;
    }
}

// Initialize language switcher when DOM is ready
function initLanguageSwitcher() {
    if (!window.languageSwitcher) {
        window.languageSwitcher = new LanguageSwitcher();
    }
}

if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initLanguageSwitcher);
} else {
    initLanguageSwitcher();
}


// ========== MOBILE CONTACT ACTION SHEET ==========

(function () {
    'use strict';

    function initMobileContact() {
        const contactBtn = document.getElementById('mobileContactBtn');
        const contactOverlay = document.getElementById('mobileContactOverlay');
        const contactCancel = document.getElementById('mobileContactCancel');

        if (!contactBtn || !contactOverlay) return;

        // Open contact sheet
        contactBtn.addEventListener('click', function (e) {
            e.stopPropagation();
            contactOverlay.classList.add('active');
            document.body.style.overflow = 'hidden';
        });

        // Close contact sheet
        function closeContactSheet() {
            contactOverlay.classList.remove('active');
            document.body.style.overflow = '';
        }

        // Close on cancel button
        if (contactCancel) {
            contactCancel.addEventListener('click', closeContactSheet);
        }

        // Close on overlay click
        contactOverlay.addEventListener('click', function (e) {
            if (e.target === contactOverlay) {
                closeContactSheet();
            }
        });

        // Close on escape key
        document.addEventListener('keydown', function (e) {
            if (e.key === 'Escape' && contactOverlay.classList.contains('active')) {
                closeContactSheet();
            }
        });
    }

    // Initialize when DOM is ready
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', initMobileContact);
    } else {
        initMobileContact();
    }
})();

// ========== MOBILE CART BUTTON HANDLER ==========
// Global mobile cart button handler for all pages

(function () {
    'use strict';

    function initMobileCartButton() {
        const mobileCartBtn = document.getElementById('mobileCartBtn');

        if (!mobileCartBtn) return;

        // Remove any existing listeners by cloning
        const newBtn = mobileCartBtn.cloneNode(true);
        mobileCartBtn.parentNode.replaceChild(newBtn, mobileCartBtn);

        // Add click listener
        newBtn.addEventListener('click', function (e) {
            e.preventDefault();
            e.stopPropagation();

            // Try new cart modal first (if on menu page)
            if (window.menuPage && typeof window.menuPage.openNewCartModal === 'function') {
                window.menuPage.openNewCartModal();
            }
            // Fallback to old cart drawer system
            else if (window.globalCart && typeof window.globalCart.openCartDrawer === 'function') {
                window.globalCart.openCartDrawer();
            } else if (window.menuPage && typeof window.menuPage.openCartDrawer === 'function') {
                window.menuPage.openCartDrawer();
            }
        });
    }

    // Initialize when DOM is ready
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', initMobileCartButton);
    } else {
        initMobileCartButton();
    }

    // Re-initialize after header loads (if header is loaded dynamically)
    window.addEventListener('headerLoaded', initMobileCartButton);
})();
