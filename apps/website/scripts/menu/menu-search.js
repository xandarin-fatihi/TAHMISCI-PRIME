// ========== MENU PRODUCTS LOADER ==========

(function () {
    'use strict';

    /** Seçili kategori id (0 = tümü, sadece alt kategorisi olan ana kategoriye tıklanınca set edilir) */
    let currentCategoryId = 0;
    let currentMenuSearchTerm = "";
    let currentMenuView = "categories";
    let cachedMenuProducts = [];
    let cachedProductsByCategory = {};

    function menuText(key, fallback) {
        return window.I18N?.t?.(key) || fallback;
    }

    function normalizeMenuText(value) {
        return String(value || "")
            .toLocaleLowerCase("tr-TR")
            .normalize("NFD")
            .replace(/[\u0300-\u036f]/g, "")
            .replace(/ı/g, "i")
            .replace(/[^a-z0-9]+/g, " ")
            .trim();
    }

    function buildProductSearchText(product) {
        const parts = [
            product?.name,
            product?.categoryName,
            product?.parentCategoryName,
            product?.description,
            product?.content,
            product?.ingredients,
            product?.products_branches_calories,
            ...(Array.isArray(product?.variants) ? product.variants.map((variant) => variant?.name) : [])
        ];
        return normalizeMenuText(parts.filter(Boolean).join(" "));
    }

    function updateCategoryTitleVisibility() {
        const grid = document.getElementById("productsGrid");
        if (!grid) return;
        const children = Array.from(grid.children);
        children.forEach((node, index) => {
            if (!node.classList?.contains("category-title")) return;
            let hasVisibleProduct = false;
            for (let i = index + 1; i < children.length; i += 1) {
                const item = children[i];
                if (item.classList?.contains("category-title")) break;
                if (item.classList?.contains("product-card") && item.style.display !== "none") {
                    hasVisibleProduct = true;
                    break;
                }
            }
            node.style.display = hasVisibleProduct ? "" : "none";
        });
    }

    function applyMenuSearch() {
        const searchNeedle = normalizeMenuText(currentMenuSearchTerm);
        const cards = document.querySelectorAll("#productsGrid .product-card");
        const categoryCards = document.querySelectorAll("#productsGrid .menu-category-card");
        let visibleCount = 0;

        if (categoryCards.length && cards.length === 0) {
            categoryCards.forEach((card) => {
                const haystack = card.dataset.search || normalizeMenuText(card.textContent);
                const visible = !searchNeedle || haystack.includes(searchNeedle);
                card.style.display = visible ? "flex" : "none";
                if (visible) visibleCount += 1;
            });
            const emptyState = document.getElementById("emptyState");
            if (emptyState) {
                emptyState.style.display = visibleCount === 0 ? "block" : "none";
            }
            return;
        }

        cards.forEach((card) => {
            const haystack = card.dataset.search || normalizeMenuText(card.textContent);
            const visible = !searchNeedle || haystack.includes(searchNeedle);
            card.style.display = visible ? "flex" : "none";
            if (visible) visibleCount += 1;
        });

        updateCategoryTitleVisibility();
        const emptyState = document.getElementById("emptyState");
        if (emptyState) {
            emptyState.style.display = visibleCount === 0 ? "block" : "none";
        }
    }

    function initMenuSearch() {
        const searchInput = document.getElementById("productSearch");
        if (!searchInput || searchInput.dataset.tahmisciSearchBound === "1") return;
        searchInput.dataset.tahmisciSearchBound = "1";
        searchInput.addEventListener("input", (event) => {
            currentMenuSearchTerm = event.target.value || "";
            if (cachedMenuProducts.length && currentMenuView === "categories" && currentMenuSearchTerm) {
                renderCategoryProducts(0, { searchMode: true });
                return;
            }
            if (cachedMenuProducts.length && currentMenuView === "search" && !currentMenuSearchTerm) {
                renderCategoryCards();
                return;
            }
            applyMenuSearch();
        });
    }

    function getSelectionParams() {
        const branchId = localStorage.getItem('menuBranchId');
        const orderType = localStorage.getItem('menuOrderType');
        const lang = getAjaxLang();

        const params = new URLSearchParams();
        if (branchId) params.set('branch_id', branchId);
        if (orderType) params.set('order_type', orderType);
        if (lang) params.set('lang', lang);
        params.set('include_subcategories', '1');

        return params.toString();
    }

    /** Sadece alt kategorisi olan ana kategori seçildiğinde çağrılır; id=0 veya '' = tüm ürünler. */
    window.loadMenuProductsForCategory = function (id) {
        currentCategoryId = normalizeCategoryId(id);
        if (cachedMenuProducts.length) {
            if (currentCategoryId > 0) {
                renderCategoryProducts(currentCategoryId);
            } else if (currentMenuSearchTerm) {
                renderCategoryProducts(0, { searchMode: true });
            } else {
                renderCategoryCards();
            }
            return;
        }
        loadMenuProducts();
    };

    let _menuProductsLoading = false;

    async function loadMenuProducts() {
        if (_menuProductsLoading) return;
        _menuProductsLoading = true;
        const loadingState = document.getElementById('loadingState');
        if (loadingState) loadingState.style.display = 'block';

        try {
            const provider = window.TahmisciPublicData;
            if (!provider) throw new Error('Public veri sağlayıcısı bulunamadı.');
            await provider.ready;
            const products = provider.getProducts();
            window.APP_CONFIG.menu = window.APP_CONFIG.menu || {};
            window.APP_CONFIG.menu.products = products;
            window.MenuProducts = products;
            renderProducts(products);
            document.dispatchEvent(new CustomEvent('menuProductsLoaded', { detail: { products } }));
        } catch (error) {
            console.error('Error loading menu products:', error);
            if (loadingState) loadingState.style.display = 'none';
            const emptyState = document.getElementById('emptyState');
            if (emptyState) emptyState.style.display = 'block';
        } finally {
            _menuProductsLoading = false;
        }
    }

    function normalizeCategoryId(value) {
        const id = Number(value);
        return Number.isInteger(id) && id > 0 ? id : 0;
    }

    function getMainCategories() {
        return (window.MenuCategories || []).filter((cat) => cat && cat.id !== "all" && normalizeCategoryId(cat.id) > 0);
    }

    function buildProductsByCategory(products) {
        const productsByCategory = {};
        const validCategoryIds = new Set();
        getMainCategories().forEach((cat) => {
            const mainId = normalizeCategoryId(cat.id);
            if (mainId) validCategoryIds.add(mainId);
            (cat.subcategories || []).forEach((sub) => {
                const subId = normalizeCategoryId(sub && sub.id);
                if (subId) validCategoryIds.add(subId);
            });
        });

        products.forEach((product) => {
            const categoryId = normalizeCategoryId(product && product.category);
            if (!categoryId) return;
            if (validCategoryIds.size > 0 && !validCategoryIds.has(categoryId)) return;
            const categoryKey = String(categoryId);
            if (!productsByCategory[categoryKey]) productsByCategory[categoryKey] = [];
            productsByCategory[categoryKey].push(product);
        });

        return productsByCategory;
    }

    function getCategoryProducts(categoryId) {
        const id = normalizeCategoryId(categoryId);
        if (!id) return cachedMenuProducts;
        const mainCategory = getMainCategories().find((cat) => normalizeCategoryId(cat.id) === id);
        if (mainCategory) {
            const allowedIds = new Set([id, ...(mainCategory.subcategories || []).map((sub) => normalizeCategoryId(sub.id)).filter(Boolean)]);
            return cachedMenuProducts.filter((product) => {
                const parentId = normalizeCategoryId(product && product.parentCategory);
                const productCategoryId = normalizeCategoryId(product && product.category);
                return parentId ? parentId === id : allowedIds.has(productCategoryId);
            });
        }
        return cachedProductsByCategory[String(id)] || [];
    }

    function getCategorySearchText(category) {
        const parts = [category?.name, ...(category?.subcategories || []).map((sub) => sub?.name)];
        return normalizeMenuText(parts.filter(Boolean).join(" "));
    }

    function getCategoryPreviewImage(categoryId) {
        const product = getCategoryProducts(categoryId).find((item) => item && item.image);
        return product?.image || "assets/brand/favicon.png";
    }

    function syncFilterButton(categoryId) {
        const activeId = categoryId ? String(categoryId) : "all";
        document.querySelectorAll("#menu .filter-btn[data-category]").forEach((btn) => {
            btn.classList.toggle("active", btn.dataset.category === activeId);
        });
    }

    function updateMenuSummary(categoryName, count) {
        const productsCount = document.getElementById("productsCount");
        const productsCategory = document.getElementById("productsCategory");
        if (productsCount) productsCount.textContent = `${count} ${menuText("product_unit", "ürün")}`;
        if (productsCategory) productsCategory.textContent = categoryName || "kategoriler";
    }

    function notifyProductsRendered() {
        setTimeout(() => {
            document.dispatchEvent(new CustomEvent('productsRendered'));
        }, 100);
    }

    function createCategoryCard(category) {
        const productCount = getCategoryProducts(category.id).length || Number(category.productCount) || 0;
        const card = document.createElement("button");
        card.type = "button";
        card.className = "menu-category-card";
        card.setAttribute("data-category", String(category.id));
        card.setAttribute("data-search", getCategorySearchText(category));
        card.innerHTML = `
            <span class="menu-category-card-media">
                <img src="${getCategoryPreviewImage(category.id)}" alt="${category.name || ''}">
                <span class="menu-category-card-icon">${category.icon ? `<i class="${category.icon}"></i>` : ''}</span>
            </span>
            <span class="menu-category-card-body">
                <span class="menu-category-card-name">${category.name || ''}</span>
                <span class="menu-category-card-count">${productCount} ${menuText("product_unit", "ürün")}</span>
            </span>
        `;
        card.addEventListener("click", () => {
            window.loadMenuProductsForCategory?.(normalizeCategoryId(category.id));
        });
        return card;
    }

    function renderCategoryCards() {
        const productsGrid = document.getElementById('productsGrid');
        if (!productsGrid) return;
        currentMenuView = "categories";
        currentCategoryId = 0;
        productsGrid.className = "products-grid is-category-panel";
        productsGrid.innerHTML = "";

        getMainCategories().forEach((category) => {
            productsGrid.appendChild(createCategoryCard(category));
        });

        updateMenuSummary(menuText("main_categories_label", "ana kategoriler"), getMainCategories().length);
        syncFilterButton(0);
        initMenuSearch();
        applyMenuSearch();
        notifyProductsRendered();
    }

    function renderCategoryProducts(categoryId, options = {}) {
        const productsGrid = document.getElementById('productsGrid');
        if (!productsGrid) return;
        const searchMode = options.searchMode === true;
        const selectedId = normalizeCategoryId(categoryId);
        const products = selectedId > 0 ? getCategoryProducts(selectedId) : cachedMenuProducts;
        const title = searchMode ? menuText("search_results_title", "Arama Sonuçları") : (selectedId > 0 ? getCategoryName(selectedId) : menuText("all_products_title", "Tüm Ürünler"));

        currentMenuView = searchMode ? "search" : "products";
        if (!searchMode) currentCategoryId = selectedId;
        productsGrid.className = "products-grid is-product-panel";
        productsGrid.innerHTML = "";

        const toolbar = document.createElement("div");
        toolbar.className = "menu-product-panel-toolbar";
        toolbar.innerHTML = `
            <button type="button" class="menu-product-panel-back">
                <i class="fas fa-arrow-left"></i>
                <span>${menuText("categories_back", "Kategoriler")}</span>
            </button>
            <div class="menu-product-panel-title">
                <strong>${title}</strong>
                <span>${products.length} ${menuText("product_unit", "ürün")}</span>
            </div>
        `;
        toolbar.querySelector(".menu-product-panel-back")?.addEventListener("click", () => {
            const searchInput = document.getElementById("productSearch");
            if (searchInput) searchInput.value = "";
            currentMenuSearchTerm = "";
            renderCategoryCards();
        });
        productsGrid.appendChild(toolbar);

        updateMenuSummary(title.toLocaleLowerCase("tr-TR"), products.length);
        syncFilterButton(selectedId);

        if (products.length === 0) {
            const emptyState = document.getElementById('emptyState');
            if (emptyState) emptyState.style.display = 'block';
            notifyProductsRendered();
            return;
        }

        const emptyState = document.getElementById('emptyState');
        if (emptyState) emptyState.style.display = 'none';
        products.forEach((product) => {
            productsGrid.appendChild(createProductCard(product));
        });

        initLazyLoading();
        initMenuSearch();
        applyMenuSearch();
        notifyProductsRendered();
    }

    function renderProducts(products) {
        const productsGrid = document.getElementById('productsGrid');
        if (!productsGrid) return;

        const loadingState = document.getElementById('loadingState');
        if (loadingState) loadingState.style.display = 'none';

        const emptyState = document.getElementById('emptyState');
        if (!products || products.length === 0) {
            if (emptyState) emptyState.style.display = 'block';
            return;
        }
        if (emptyState) emptyState.style.display = 'none';

        cachedMenuProducts = products.slice();
        cachedProductsByCategory = buildProductsByCategory(cachedMenuProducts);

        if (currentCategoryId > 0) {
            renderCategoryProducts(currentCategoryId);
        } else if (currentMenuSearchTerm) {
            renderCategoryProducts(0, { searchMode: true });
        } else {
            renderCategoryCards();
        }
    }

    function initLazyLoading() {
        const lazyImages = document.querySelectorAll('.lazy-image');
        if (lazyImages.length === 0) return;

        // Intersection Observer for lazy loading
        const imageObserver = new IntersectionObserver((entries, observer) => {
            entries.forEach(entry => {
                if (entry.isIntersecting) {
                    const img = entry.target;
                    const imageContainer = img.closest('.product-image');
                    const spinner = imageContainer?.querySelector('.image-loading-spinner');

                    // Show spinner if exists
                    if (spinner) {
                        spinner.style.display = 'flex';
                    }

                    // Load image
                    const imageSrc = img.getAttribute('data-src');
                    if (imageSrc) {
                        const tempImg = new Image();

                        tempImg.onload = () => {
                            img.src = imageSrc;
                            img.classList.add('loaded');
                            // Hide spinner after image loads
                            if (spinner) {
                                spinner.style.display = 'none';
                            }
                            observer.unobserve(img);
                        };

                        tempImg.onerror = () => {
                            // Hide spinner on error
                            if (spinner) {
                                spinner.style.display = 'none';
                            }
                            // Optionally set a placeholder image
                            img.src = "assets/brand/favicon.png";
                            observer.unobserve(img);
                        };

                        tempImg.src = imageSrc;
                    } else {
                        // No image source, hide spinner
                        if (spinner) {
                            spinner.style.display = 'none';
                        }
                        observer.unobserve(img);
                    }
                }
            });
        }, {
            rootMargin: '50px' // Start loading 50px before image enters viewport
        });

        // Observe all lazy images
        lazyImages.forEach(img => {
            imageObserver.observe(img);
        });
    }

    function getCategoryName(categoryId) {
        const id = Number(categoryId);
        const menuCats = window.MenuCategories || [];
        for (const cat of menuCats) {
            if (cat.id === id) return cat.name;
            if (cat.subcategories) {
                const sub = cat.subcategories.find(s => s.id === id);
                if (sub) return sub.name;
            }
        }
        return String(categoryId);
    }

    function createProductCard(product) {
        const card = document.createElement('div');
        card.className = 'product-card';
        if (product && product.image_source === 'company_logo') {
            card.classList.add('product-logo-fallback');
        }
        card.setAttribute('data-category', String(product.category));
        if (product.parentCategory) {
            card.setAttribute('data-parent-category', String(product.parentCategory));
        }
        card.setAttribute('data-product-id', product.id);
        card.setAttribute('data-search', buildProductSearchText(product));
        card.style.cursor = 'pointer';

        const badgeMap = {
            'popular': 'Çok Satan',
            'new': 'Yeni',
            'discount': 'İndirim',
            'healthy': 'Sağlıklı',
            'hot': 'Sıcak',
            'breakfast': 'Kahvaltı'
        };
        const isOutOfStock = product.product_qr_status === '2';
        const badgeText = isOutOfStock ? 'Tükendi' : (product.badge ? badgeMap[product.badge] || product.badge : null);
        const hasFeatureBadge = Boolean(product.badge) && !isOutOfStock;
        const image = String(product.image || '').trim();
        const hasImage = Boolean(image) && product.image_source !== 'company_logo';
        const basePrice = Number(product.basePrice || product.price || 0);
        const priceLabel = String(product.priceLabel || '').trim() || (Number.isFinite(basePrice) ? `₺${basePrice.toLocaleString('tr-TR')}` : '');
        if (isOutOfStock) card.classList.add('product-out-of-stock');
        if (hasFeatureBadge) card.classList.add('product-card--featured');
        if (!hasImage) card.classList.add('product-card--no-media');

        const orderType = localStorage.getItem('menuOrderType');
        const translations = window.I18N?.getTranslations?.();
        const lang = window.I18N?.getPreferredLanguage?.() || 'tr';
        const viewLabel = translations?.[lang]?.product_action_view || 'İncele';
        const addLabel = translations?.[lang]?.product_action_add || 'Ekle';
        const actionLabel = window.TahmisciCatalog ? viewLabel : (isOutOfStock ? viewLabel : (orderType === 'tableMenu' ? viewLabel : addLabel));

        card.innerHTML = `
            ${hasImage ? `<div class="product-image">
                <div class="image-loading-spinner"></div>
                <img data-src="${image}" alt="${product.name || ''}" class="lazy-image">
                ${badgeText ? `<div class="product-badge${isOutOfStock ? ' product-badge-out' : ''}">${badgeText}</div>` : ''}
            </div>` : ''}
            <div class="product-content">
                <div class="product-header">
                    <h3 class="product-name">${product.name || ''}</h3>
                </div>
                <p class="product-description">${product.description || ''}</p>
                ${priceLabel ? `<div class="product-price"><span class="current-price">${priceLabel}</span>${product.oldPrice ? `<span class="old-price">₺${Number(product.oldPrice).toLocaleString('tr-TR')}</span>` : ''}</div>` : ''}
            </div>
            <div class="product-footer">
                <button class="product-add-btn" type="button">${actionLabel}</button>
            </div>
        `;

        card.addEventListener('click', () => window.openProductModal?.(product.id));
        const actionButton = card.querySelector('.product-add-btn');
        actionButton?.addEventListener('click', (event) => {
            event.stopPropagation();
            window.openProductModal?.(product.id);
        });

        return card;
    }

    // Ürünler sadece seçim yapıldıktan sonra yüklensin (branch_id + order_type); DOMContentLoaded ile erken çağrı boş sonuç verir.
    document.addEventListener('menuSelectionChanged', () => {
        currentCategoryId = 0;
        currentMenuSearchTerm = "";
        cachedMenuProducts = [];
        cachedProductsByCategory = {};
        loadMenuProducts();
    });
    // Kategoriler render olur olmaz, ürün yoksa otomatik yükleme yap.
    document.addEventListener('categoriesLoaded', () => {
        if (!Array.isArray(window.MenuProducts) || window.MenuProducts.length === 0) {
            currentCategoryId = 0;
            loadMenuProducts();
        }
    });
    window.addEventListener('languageChanged', () => {
        cachedMenuProducts = [];
        cachedProductsByCategory = {};
        currentCategoryId = 0;
        loadMenuProducts();
    });
    window.addEventListener('publicBootstrapUpdated', () => {
        cachedMenuProducts = [];
        cachedProductsByCategory = {};
        currentCategoryId = 0;
        loadMenuProducts();
    });
})();
