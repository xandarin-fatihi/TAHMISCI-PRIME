/**
 * Homepage Sections Manager
 * Section'ları aktif/pasif yapma ve yönetme sistemi
 */

class HomepageSectionsManager {
    constructor() {
        this.sections = {};
        this.init();
    }

    init() {
        // Tüm section'ları bul ve kaydet
        const sections = document.querySelectorAll('.homepage-section[data-section]');

        sections.forEach(section => {
            const sectionName = section.getAttribute('data-section');
            const isActive = section.getAttribute('data-active') === 'true';

            this.sections[sectionName] = {
                element: section,
                active: isActive
            };

            // Eğer pasifse gizle
            if (!isActive) {
                section.style.display = 'none';
            }
        });

        // LocalStorage'dan section durumlarını yükle
        this.loadSectionStates();
    }

    /**
     * Section'ı aktif/pasif yap
     * @param {string} sectionName - Section adı
     * @param {boolean} active - Aktif mi pasif mi
     */
    setSectionActive(sectionName, active) {
        if (!this.sections[sectionName]) {
            console.warn(`Section "${sectionName}" bulunamadı`);
            return;
        }

        const section = this.sections[sectionName];
        section.active = active;

        // DOM'da güncelle
        section.element.setAttribute('data-active', active.toString());

        if (active) {
            section.element.style.display = '';
        } else {
            section.element.style.display = 'none';
        }

        // LocalStorage'a kaydet
        this.saveSectionStates();
    }

    /**
     * Section durumunu al
     * @param {string} sectionName - Section adı
     * @returns {boolean} - Aktif mi?
     */
    isSectionActive(sectionName) {
        if (!this.sections[sectionName]) {
            return false;
        }
        return this.sections[sectionName].active;
    }

    /**
     * Tüm section durumlarını kaydet
     */
    saveSectionStates() {
        const states = {};

        Object.keys(this.sections).forEach(sectionName => {
            states[sectionName] = this.sections[sectionName].active;
        });

        try {
            localStorage.setItem('homepage_sections', JSON.stringify(states));
        } catch (e) {
            console.error('Section durumları kaydedilemedi:', e);
        }
    }

    /**
     * LocalStorage'dan section durumlarını yükle
     */
    loadSectionStates() {
        try {
            const saved = localStorage.getItem('homepage_sections');
            if (saved) {
                const states = JSON.parse(saved);

                Object.keys(states).forEach(sectionName => {
                    if (this.sections[sectionName]) {
                        this.setSectionActive(sectionName, states[sectionName]);
                    }
                });
            }
        } catch (e) {
            console.error('Section durumları yüklenemedi:', e);
        }
    }

    /**
     * Tüm section'ları göster
     */
    showAllSections() {
        Object.keys(this.sections).forEach(sectionName => {
            this.setSectionActive(sectionName, true);
        });
    }

    /**
     * Tüm section'ları gizle
     */
    hideAllSections() {
        Object.keys(this.sections).forEach(sectionName => {
            this.setSectionActive(sectionName, false);
        });
    }

    /**
     * Section listesini al
     * @returns {Object} - Section bilgileri
     */
    getSections() {
        return Object.keys(this.sections).map(sectionName => ({
            name: sectionName,
            active: this.sections[sectionName].active,
            element: this.sections[sectionName].element
        }));
    }
}

// Global instance oluştur
window.HomepageSections = new HomepageSectionsManager();

// Kullanım örneği (admin paneli için):
// HomepageSections.setSectionActive('hero', false); // Hero section'ı gizle
// HomepageSections.setSectionActive('popular-products', true); // Popüler ürünleri göster


/**
 * Homepage Popular Products Loader
 * Popüler ürünleri ana sayfada slider olarak gösterir (menu.html yapısına uygun)
 */

(function () {
    'use strict';

    // Popüler ürünler: products-loader menu-products.php'den sadece popular=1 olanları doldurur.
    function getDemoProducts() {
        return Array.isArray(APP_CONFIG?.demo?.products?.items) ? APP_CONFIG.demo.products.items : [];
    }

    // Popüler ürünleri yükle (slider olarak)
    function loadPopularProducts() {
        const track = document.getElementById('productsSliderTrack');
        if (!track) return;

        // Güncel products'ı al
        const products = getDemoProducts();

        // Ürün kartlarını oluştur (menu.html yapısına uygun)
        track.innerHTML = products.map(product => createProductCard(product)).join('');

        // Slider'ı başlat
        initSlider();

        // Ürün kartlarına event listener ekle
        attachProductEvents();
    }

    // Ürün kartı HTML'i oluştur (menu sayfasındaki yapıya birebir uygun)
    function createProductCard(product) {
        const image = String(product.image || '').trim();
        const isLogoFallback = product && product.image_source === 'company_logo';
        const hasImage = Boolean(image) && !isLogoFallback;
        const viewLabel = window.I18N?.t?.('product_action_view') || 'İncele';

        const badgeMap = {
            'popular': 'Çok Satan',
            'new': 'Yeni',
            'discount': 'İndirim',
            'healthy': 'Sağlıklı',
            'hot': 'Sıcak',
            'breakfast': 'Kahvaltı'
        };

        const badgeText = product.badge ? badgeMap[product.badge] || product.badge : null;
        const price = product.basePrice || product.price || 0;
        const priceLabel = String(product.priceLabel || '').trim() || `₺${parseFloat(price || 0).toLocaleString('tr-TR')}`;

        return `
      <div class="product-card product-card--featured${hasImage ? '' : ' product-card--no-media'}" data-product-id="${product.id}">
        ${hasImage ? `<div class="product-image">
          <img src="${image}" alt="${product.name || ''}" loading="lazy" class="${isLogoFallback ? 'logo-fallback-image' : ''}">
          ${badgeText ? `<div class="product-badge">${badgeText}</div>` : ''}
        </div>` : ''}
        <div class="product-content">
          <div class="product-header">
            <h3 class="product-name">${product.name || ''}</h3>
          </div>
          <p class="product-description">${product.description || ''}</p>
          <div class="product-footer">
            <div class="product-price">
              <span class="current-price">${priceLabel}</span>
              ${product.oldPrice ? `<span class="old-price">${parseFloat(product.oldPrice || 0).toFixed(2)}</span>` : ''}
            </div>
            <button class="product-add-btn" data-product-id="${product.id}">${viewLabel}</button>
          </div>
        </div>
      </div>
    `;
    }

    // Slider'ı başlat
    function initSlider() {
        const track = document.getElementById('productsSliderTrack');
        const prevBtn = document.getElementById('sliderPrev');
        const nextBtn = document.getElementById('sliderNext');

        if (!track) return;

        let currentIndex = 0;
        let cardsPerView = getCardsPerView();
        let autoSlideInterval;

        function getCardsPerView() {
            if (window.innerWidth >= 1200) return 4;
            if (window.innerWidth >= 768) return 3;
            if (window.innerWidth >= 576) return 2;
            return 1;
        }

        function updateSlider() {
            cardsPerView = getCardsPerView();
            const firstCard = track.querySelector('.product-card');
            if (!firstCard) return;

            // Kart genişliğini ve margin'ini al
            const cardRect = firstCard.getBoundingClientRect();
            const cardWidth = cardRect.width;
            const cardStyle = window.getComputedStyle(firstCard);
            const marginRight = parseFloat(cardStyle.marginRight) || 1.5 * 16; // 1.5rem = 24px

            // Slider'ı kaydır
            const translateX = -currentIndex * (cardWidth + marginRight);
            track.style.transform = `translateX(${translateX}px)`;
        }

        // İlk yüklemede slider'ı ayarla
        setTimeout(() => {
            updateSlider();
        }, 100);

        function nextSlide() {
            const products = getDemoProducts();
            const maxIndex = Math.max(0, products.length - getCardsPerView());
            currentIndex = (currentIndex + 1) % (maxIndex + 1);
            updateSlider();
        }

        function prevSlide() {
            const products = getDemoProducts();
            const maxIndex = Math.max(0, products.length - getCardsPerView());
            currentIndex = (currentIndex - 1 + (maxIndex + 1)) % (maxIndex + 1);
            updateSlider();
        }

        function startAutoSlide() {
            clearInterval(autoSlideInterval);
            autoSlideInterval = setInterval(nextSlide, 5000);
        }

        // Otomatik kaydırma başlat
        startAutoSlide();

        // Buton event'leri
        if (nextBtn) {
            nextBtn.addEventListener('click', () => {
                clearInterval(autoSlideInterval);
                nextSlide();
                startAutoSlide();
            });
        }

        if (prevBtn) {
            prevBtn.addEventListener('click', () => {
                clearInterval(autoSlideInterval);
                prevSlide();
                startAutoSlide();
            });
        }

        // Responsive için yeniden hesapla
        let resizeTimeout;
        window.addEventListener('resize', () => {
            clearTimeout(resizeTimeout);
            resizeTimeout = setTimeout(() => {
                currentIndex = 0;
                updateSlider();
            }, 250);
        });

        // Mouse ile kaydırma desteği
        let startX = 0;
        let scrollLeft = 0;
        let isDragging = false;
        let startTransform = 0;

        track.addEventListener('mousedown', (e) => {
            // Butonlara tıklanırsa kaydırmayı engelle
            if (e.target.closest('.slider-nav-btn') || e.target.closest('button')) {
                return;
            }

            isDragging = true;
            startX = e.pageX;
            track.style.cursor = 'grabbing';
            track.style.transition = 'none'; // Kaydırma sırasında animasyonu kapat

            // Mevcut transform değerini al
            const transform = track.style.transform || 'translateX(0px)';
            const match = transform.match(/translateX\((-?\d+\.?\d*)px\)/);
            startTransform = match ? parseFloat(match[1]) : 0;

            clearInterval(autoSlideInterval);
            e.preventDefault();
        });

        document.addEventListener('mousemove', (e) => {
            if (!isDragging) return;

            e.preventDefault();
            const x = e.pageX;
            const walk = (startX - x) * 1.5; // Kaydırma hızı
            const newTransform = startTransform - walk;

            track.style.transform = `translateX(${newTransform}px)`;
        });

        document.addEventListener('mouseup', () => {
            if (!isDragging) return;

            isDragging = false;
            track.style.cursor = 'grab';
            track.style.transition = 'transform 0.5s ease'; // Animasyonu geri aç

            // Kaydırma miktarını kontrol et ve slide'a hizala
            const firstCard = track.querySelector('.product-card');
            if (firstCard) {
                const cardRect = firstCard.getBoundingClientRect();
                const cardWidth = cardRect.width;
                const cardStyle = window.getComputedStyle(firstCard);
                const marginRight = parseFloat(cardStyle.marginRight) || 1.5 * 16;

                const transform = track.style.transform || 'translateX(0px)';
                const match = transform.match(/translateX\((-?\d+\.?\d*)px\)/);
                const currentTransform = match ? parseFloat(match[1]) : 0;

                // En yakın slide pozisyonunu hesapla
                const slideWidth = cardWidth + marginRight;
                const newIndex = Math.round(-currentTransform / slideWidth);
                const products = getDemoProducts();
                const maxIndex = Math.max(0, products.length - getCardsPerView());
                currentIndex = Math.max(0, Math.min(newIndex, maxIndex));

                updateSlider();
            }

            startAutoSlide();
        });

        track.addEventListener('mouseleave', () => {
            if (isDragging) {
                isDragging = false;
                track.style.cursor = 'grab';
                track.style.transition = 'transform 0.5s ease';
                updateSlider();
                startAutoSlide();
            }
        });
    }

    // Ürün kartlarına event listener ekle
    function attachProductEvents() {
        const selectBtns = document.querySelectorAll('#productsSliderTrack .product-add-btn');

        selectBtns.forEach(btn => {
            btn.addEventListener('click', function (e) {
                e.stopPropagation();
                const productId = parseInt(this.getAttribute('data-product-id'));

                // Modal aç
                if (typeof window.openProductModal === 'function') {
                    window.openProductModal(productId);
                }
            });
        });

        // Ürün kartına tıklama (modal aç)
        const productCards = document.querySelectorAll('#productsSliderTrack .product-card');
        productCards.forEach(card => {
            card.addEventListener('click', function (e) {
                // Butona tıklanmışsa işlem yapma
                if (e.target.closest('button')) return;

                const productId = parseInt(this.getAttribute('data-product-id'));
                if (typeof window.openProductModal === 'function') {
                    window.openProductModal(productId);
                }
            });
        });
    }

    var TESTIMONIAL_MAX_LEN = 120;

    function escapeHtml(str) {
        if (!str) return '';
        return String(str)
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;');
    }

    // Müşteri yorumlarını yükle
    function loadTestimonials() {
        const grid = document.getElementById('testimonialsGrid');
        if (!grid) return;

        // PHP'den gelen testimonials verilerini kullan
        const testimonials = APP_CONFIG?.demo?.testimonials || [];

        if (testimonials.length === 0) return;

        grid.innerHTML = testimonials.map(testimonial => createTestimonialCard(testimonial)).join('');
    }

    // Testimonial "Tamamını gör" / "Daha az" (tek seferlik delegation)
    (function initTestimonialToggle() {
        if (window._testimonialToggleInited) return;
        window._testimonialToggleInited = true;
        document.body.addEventListener('click', function (e) {
            var btn = e.target.closest('#testimonialsGrid .testimonial-toggle');
            if (!btn) return;
            var wrap = btn.closest('.testimonial-text-wrap');
            if (!wrap) return;
            var full = wrap.getAttribute('data-full');
            var short = wrap.getAttribute('data-short');
            var inner = wrap.querySelector('.testimonial-text-inner');
            if (!inner) return;
            if (wrap.classList.contains('is-expanded')) {
                inner.innerHTML = short;
                btn.textContent = 'Tamamını gör';
                wrap.classList.remove('is-expanded');
            } else {
                inner.innerHTML = full;
                btn.textContent = 'Daha az';
                wrap.classList.add('is-expanded');
            }
        });
    })();

    // Yorum kartı HTML'i oluştur
    function createTestimonialCard(testimonial) {
        const rating = testimonial.rating || 5;
        const stars = '<span class="testimonial-star" aria-hidden="true"></span>'.repeat(rating);
        const avatarContent = (testimonial.avatarImage)
            ? `<img src="${testimonial.avatarImage}" alt="${(testimonial.name || '').replace(/"/g, '&quot;')}" loading="lazy">`
            : (testimonial.avatar || '');
        const rawText = testimonial.text || '';
        const escapedFull = '"' + escapeHtml(rawText) + '"';
        let textBlock;
        if (rawText.length <= TESTIMONIAL_MAX_LEN) {
            textBlock = '<p class="testimonial-text testimonial-text-wrap"><span class="testimonial-text-inner">' + escapedFull + '</span></p>';
        } else {
            const shortText = '"' + escapeHtml(rawText.slice(0, TESTIMONIAL_MAX_LEN)) + '..."';
            textBlock = '<p class="testimonial-text testimonial-text-wrap" data-short="' + escapeHtml(shortText) + '" data-full="' + escapeHtml(escapedFull) + '">' +
                '<span class="testimonial-text-inner">' + shortText + '</span> ' +
                '<button type="button" class="testimonial-toggle">Tamamını gör</button></p>';
        }
        const safeName = escapeHtml(testimonial.name || '');
        return `
      <article class="testimonial-card">
        <div class="testimonial-card-inner">
          <header class="testimonial-card-header">
            <div class="testimonial-avatar">${avatarContent}</div>
            <div class="testimonial-meta">
              <div class="testimonial-stars" aria-label="${rating} yıldız">${stars}</div>
              <p class="testimonial-author">${safeName}</p>
            </div>
          </header>
          <div class="testimonial-body">
            ${textBlock}
          </div>
        </div>
      </article>
    `;
    }

    // DOM yüklendiğinde çalıştır
    function initializeProducts() {
        loadPopularProducts();
        loadTestimonials();
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', initializeProducts);
    } else {
        initializeProducts();
    }

    // Listen for products data loaded event
    window.addEventListener('productsDataLoaded', () => {
        loadPopularProducts();
    });

    window.addEventListener('publicBootstrapUpdated', () => {
        loadPopularProducts();
    });

    // Listen for testimonials data loaded event
    window.addEventListener('testimonialsDataLoaded', () => {
        loadTestimonials();
    });

})();
