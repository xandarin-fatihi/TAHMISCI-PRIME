// ========== CATEGORIES LOADER ==========

(function () {
    'use strict';

    function getSelectionParams() {
        const branchId = localStorage.getItem('menuBranchId');
        const orderType = localStorage.getItem('menuOrderType');
        const lang = getAjaxLang();

        const params = new URLSearchParams();
        params.set('lang', lang);
        if (branchId) params.set('branch_id', branchId);
        if (orderType) params.set('order_type', orderType);

        return params.toString();
    }

    async function loadCategories() {
        try {
            const provider = window.TahmisciPublicData;
            if (!provider) throw new Error('Public veri sağlayıcısı bulunamadı.');
            await provider.ready;
            const categories = provider.getCategories();
            window.MenuCategories = categories;
            renderCategories(categories);
        } catch (error) {
            console.error('Error loading categories:', error);
        }
    }

    function renderCategories(categories) {
        const filterCategoriesContainer = document.querySelector('.filter-categories');
        if (!filterCategoriesContainer) return;

        const subWrapper = document.querySelector('.filter-subcategories-wrapper');
        const subContainer = document.querySelector('.filter-subcategories');
        if (subWrapper) {
            subWrapper.style.display = 'none';
            document.querySelector(".menu-filters-sticky")?.classList.remove("subcategories-visible");
        }

        filterCategoriesContainer.innerHTML = '';
        const inner = document.createElement('div');
        inner.className = 'filter-categories-inner';

        categories.forEach((category) => {
            const button = document.createElement('button');
            button.className = 'filter-btn';
            button.setAttribute('data-category', String(category.id));
            button.innerHTML = `
                <i class="${category.icon}"></i>
                ${category.name}
            `;

            if (String(category.id) === 'all') {
                button.classList.add('active');
            }

            inner.appendChild(button);
        });

        filterCategoriesContainer.appendChild(inner);

        // İlk kategori alt kategori içeriyorsa, kullanıcı tıklamadan alt kategori şeridini de render et.
        const firstCategory = Array.isArray(categories) && categories.length > 0 ? categories[0] : null;
        if (
            !window.TahmisciCatalog &&
            firstCategory &&
            Array.isArray(firstCategory.subcategories) &&
            firstCategory.subcategories.length > 0 &&
            subWrapper &&
            subContainer
        ) {
            subWrapper.style.display = '';
            document.querySelector(".menu-filters-sticky")?.classList.add("subcategories-visible");
            subContainer.innerHTML = '';
            const subInner = document.createElement('div');
            subInner.className = 'filter-subcategories-inner';
            firstCategory.subcategories.forEach((sub) => {
                const subBtn = document.createElement('button');
                subBtn.className = 'filter-btn filter-sub-btn';
                subBtn.setAttribute('data-category', String(sub.id));
                subBtn.innerHTML = sub.icon ? `<i class="${sub.icon}"></i> ${sub.name}` : sub.name;
                subInner.appendChild(subBtn);
            });
            subContainer.appendChild(subInner);
        }

        // Dispatch event for menu.js to initialize filters
        document.dispatchEvent(new CustomEvent('categoriesLoaded', {
            detail: { categories }
        }));
    }

    // Load categories when DOM is ready
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', loadCategories);
    } else {
        loadCategories();
    }

    document.addEventListener('menuSelectionChanged', loadCategories);
    window.addEventListener('languageChanged', loadCategories);
    window.addEventListener('publicBootstrapUpdated', loadCategories);
})();

// ========== DRAG TO SCROLL (filter-categories & filter-subcategories) - sadece masaüstü ==========
(function () {
    var activeContainer = null;
    var startX = 0;
    var scrollStart = 0;
    var moved = false;
    var boundDocMove = false;
    var dragMultiplier = 2;
    var pendingScrollLeft = 0;
    var rafScheduled = false;
    var savedScrollBehavior = '';

    function isDesktop() {
        return window.innerWidth > 768;
    }

    function applyScroll() {
        rafScheduled = false;
        if (activeContainer) activeContainer.scrollLeft = pendingScrollLeft;
    }

    function onDocMove(e) {
        if (!activeContainer) return;
        e.preventDefault();
        var x = e.pageX;
        var walk = (startX - x) * dragMultiplier;
        if (Math.abs(walk) > 2) moved = true;
        pendingScrollLeft = scrollStart + walk;
        if (!rafScheduled) {
            rafScheduled = true;
            requestAnimationFrame(applyScroll);
        }
    }
    function onDocEnd() {
        if (!activeContainer) return;
        var el = activeContainer;
        el.style.cursor = 'grab';
        el.style.scrollBehavior = savedScrollBehavior || '';
        activeContainer = null;
        rafScheduled = false;
        if (moved) {
            el.dataset.dragJustEnded = '1';
            setTimeout(function () { delete el.dataset.dragJustEnded; }, 0);
        }
    }

    function setupDragToScroll(container) {
        if (!container || container._dragScrollSetup || !isDesktop()) return;
        container._dragScrollSetup = true;
        container.style.cursor = 'grab';
        container.style.userSelect = 'none';

        if (!boundDocMove) {
            boundDocMove = true;
            document.addEventListener('mousemove', onDocMove, true);
            document.addEventListener('mouseup', onDocEnd, true);
        }

        function start(e) {
            if (e.type.indexOf('touch') === 0) return;
            e.preventDefault();
            activeContainer = container;
            moved = false;
            savedScrollBehavior = container.style.scrollBehavior || '';
            container.style.scrollBehavior = 'auto';
            container.style.cursor = 'grabbing';
            startX = e.pageX;
            scrollStart = container.scrollLeft;
            pendingScrollLeft = scrollStart;
        }
        function end() {
            if (activeContainer === container) onDocEnd();
        }

        container.addEventListener('mousedown', start, true);
        container.addEventListener('mouseleave', end);
    }

    function initDragScroll() {
        if (!isDesktop()) return;
        var cat = document.querySelector('.filter-categories');
        var sub = document.querySelector('.filter-subcategories');
        if (cat) setupDragToScroll(cat);
        if (sub) setupDragToScroll(sub);
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', initDragScroll);
    } else {
        initDragScroll();
    }
    document.addEventListener('categoriesLoaded', initDragScroll);
})();

// ========== TAHMİSÇİ COMPACT STICKY FILTER ==========
(function () {
    let forceHideFilter = false;
    let forceHideTimer = null;

    function updateHeaderHeight() {
        if (!document.body.classList.contains('tahmisci-static-menu')) return;
        const header = document.getElementById('header') || document.querySelector('.modern-header, .header');
        const height = Math.ceil(header?.getBoundingClientRect().height || 76);
        document.documentElement.style.setProperty('--tahmisci-header-height', `${height}px`);
    }

    function updateActiveSectionNav(headerHeight) {
        const sectionIds = ['top', 'menu', 'about', 'qr-menu', 'contact'];
        const probe = (headerHeight || 76) + 18;
        let activeId = 'top';

        sectionIds.forEach((id) => {
            const el = id === 'top' ? document.body : document.getElementById(id);
            if (!el) return;
            const rect = el.getBoundingClientRect();
            if (rect.top <= probe && rect.bottom > probe) {
                activeId = id;
            }
        });

        document.querySelectorAll('.nav-link[href^="#"], .mobile-nav-link[href^="#"]').forEach((link) => {
            const target = (link.getAttribute('href') || '').replace('#', '') || 'top';
            link.classList.toggle('active', target === activeId);
        });
    }

    function updateCompactFilter() {
        if (!document.body.classList.contains('tahmisci-static-menu')) return;
        updateHeaderHeight();
        const filters = document.getElementById('menuFilters');
        const menu = document.getElementById('menu');
        if (!filters || !menu) return;

        const headerHeight = parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--tahmisci-header-height')) || 76;
        const menuRect = menu.getBoundingClientRect();
        const filterHeight = filters.offsetHeight || 0;
        document.documentElement.style.setProperty('--tahmisci-filter-height', `${Math.ceil(filterHeight)}px`);

        const activationLine = Math.min(window.innerHeight * 0.45, headerHeight + 180);
        const nextSectionReached = ['about', 'qr-menu', 'contact'].some((id) => {
            const section = document.getElementById(id);
            return section && section.getBoundingClientRect().top <= activationLine;
        });
        const isMenuActive =
            !forceHideFilter &&
            !nextSectionReached &&
            menuRect.top <= activationLine &&
            menuRect.bottom > headerHeight + Math.max(filterHeight, 56);

        filters.classList.toggle('is-menu-active', isMenuActive);
        filters.classList.toggle('is-compact-sticky', isMenuActive && menuRect.top < headerHeight);
        document.body.classList.toggle('menu-filter-active', isMenuActive);
        updateActiveSectionNav(headerHeight);
    }

    function bindFilterNavVisibility() {
        document.addEventListener('click', (event) => {
            const link = event.target.closest('a[href^="#"]');
            if (!link) return;
            const target = link.hash || link.getAttribute('href');
            const filters = document.getElementById('menuFilters');
            if (target !== '#menu') {
                forceHideFilter = true;
                filters?.setAttribute('data-force-hidden', '1');
                filters?.classList.remove('is-menu-active', 'is-compact-sticky');
                document.body.classList.remove('menu-filter-active');
                clearTimeout(forceHideTimer);
                forceHideTimer = setTimeout(() => {
                    forceHideFilter = false;
                    filters?.removeAttribute('data-force-hidden');
                    updateCompactFilter();
                }, 1200);
            } else {
                forceHideFilter = false;
                filters?.removeAttribute('data-force-hidden');
                clearTimeout(forceHideTimer);
                setTimeout(updateCompactFilter, 80);
            }
        }, true);
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', () => {
            updateHeaderHeight();
            bindFilterNavVisibility();
            updateCompactFilter();
        });
    } else {
        updateHeaderHeight();
        bindFilterNavVisibility();
        updateCompactFilter();
    }
    window.addEventListener('scroll', updateCompactFilter, { passive: true });
    window.addEventListener('resize', () => {
        updateHeaderHeight();
        updateCompactFilter();
    });
    document.addEventListener('productsRendered', updateCompactFilter);
    document.addEventListener('categoriesLoaded', updateCompactFilter);
})();
