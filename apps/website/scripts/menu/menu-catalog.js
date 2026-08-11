// ========== MODERN MENU PAGE SCRIPT ==========

function isValidProductInfo(value) {
    const text = String(value ?? "").trim();
    if (!text) return false;
    const normalized = text.toLocaleLowerCase("tr-TR");
    return !["0", "n/a", "undefined", "null", "kaynakta tanımlı değil", "kaynakta tanimli degil"].includes(normalized);
}

function isLogoFallbackSource(source) {
    return ["company_logo", "brand-placeholder"].includes(String(source || ""));
}

class ModernMenuPage {
    constructor() {
        // Products will be loaded from PHP via menu-products-loader.js
        this.products = window.MenuProducts || [];
        this.cart = [];
        this.currentProduct = null;
        this.currentProductOptions = {};
        this.currentQuantity = 1;
        this.basePrice = 0;
        this.appliedPromos = []; // Uygulanan promosyon listesi
        this.selectedCampaign = null; // Seçili kampanya
        this.selectedCampaignValidation = null; // { eligible: bool, reason: string } - backend doğrulama sonucu
        // Kampanya/kupon uyumluluk durumu
        this.appliedPromotions = [];
        this.appliedCampaigns = [];
        this.engineCampaignDiscountCents = 0;
        this.freeItems = [];
        this.couponAllowed = true;
        this.couponBlockReason = "";
        this.editingCartItemId = null; // Cart item being edited

        // Wait for products to load if not available yet
        if (this.products.length === 0) {
            document.addEventListener("menuProductsLoaded", () => {
                this.products = window.MenuProducts || [];
                this.init();
            });
        } else {
            this.init();
        }
    }

    init() {
        // Clean up any leftover fly-to-cart elements
        const leftoverFlyElements = document.querySelectorAll(".fly-to-cart-img");
        leftoverFlyElements.forEach((el) => {
            if (el.parentNode) {
                el.parentNode.removeChild(el);
            }
        });
        // Initialize filter system
        this.initializeFilters();

        // Initialize search and sort
        this.initializeSearchAndSort();

        // Initialize sticky filter
        this.initializeStickyFilter();

        // Initialize dropdown filter
        this.initializeDropdownFilter();

        // Initialize modal system
        this.initializeProductModal();

        // Initialize new cart modal
        this.initializeNewCartModal();

        // Initialize favorites
        this.initializeFavorites();

        // Load cart from localStorage (start with empty cart)
        this.cart = [];
        this.loadCart();

        // Load promo from localStorage
        this.loadPromo();
        // Seçili kampanyayı yükle
        this.loadSelectedCampaign();

        // Kampanya motoru + kampanya listesi + global listener'lar sadece bir kez (tekrarlı AJAX önlenir)
        if (!this._promoCampaignsAndListenersDone) {
            this._promoCampaignsAndListenersDone = true;
            this.loadPromotionEngineState();
            this.initializeCampaigns();
            window.addEventListener("resize", () => {
                this.updateDesktopCartButtonPosition();
            });
            document.addEventListener("menuSelectionChanged", () => {
                this.updateDesktopCartButtonPosition();
                this.loadPromotionEngineState();
                this.updateCampaignSelectVisibility();
            });
        }

        // Update cart counter
        this.updateCartCounter();

        // SCROLL BASED CATEGORY
        this.initializeScrollBasedCategoryActivation();

        // Update desktop cart button position
        this.updateDesktopCartButtonPosition();
    }

    // ========== PRODUCT DATA ==========
    // Ürünler DB'den window.MenuProducts olarak gelir (menu-products-loader / PHP). Eski demo liste kaldırıldı.

    initializeProducts() {
        // Artık kullanılmıyor; ürünler constructor'da window.MenuProducts ile atanıyor.
        return;
    }

    // ========== FILTER SYSTEM ==========

    initializeFilters() {
        if (this._filtersDelegationBound) return;
        this._filtersDelegationBound = true;

        const filterCategories = document.querySelector(".filter-categories");
        const subWrapper = document.querySelector(".filter-subcategories-wrapper");
        const subContainer = document.querySelector(".filter-subcategories");
        const menuCategories = () => window.MenuCategories || [];

        if (filterCategories) {
            filterCategories.addEventListener("click", (e) => {
                if (filterCategories.dataset.dragJustEnded === '1') return;
                const btn = e.target.closest(".filter-categories .filter-btn:not(.dropdown-toggle)");
                if (!btn) return;
                const idStr = btn.dataset.category;
                const catId = idStr === "all" ? "all" : Number(idStr);
                const filterButtons = filterCategories.querySelectorAll(".filter-btn:not(.dropdown-toggle)");
                filterButtons.forEach((b) => b.classList.remove("active"));
                btn.classList.add("active");

                const cat = menuCategories().find((c) => c.id === catId);
                if (window.TahmisciCatalog) {
                    if (subWrapper && subContainer) {
                        subWrapper.style.display = "none";
                        subContainer.innerHTML = "";
                    }
                    if (typeof window.loadMenuProductsForCategory === "function") {
                        window.loadMenuProductsForCategory(catId === "all" ? 0 : catId);
                    } else {
                        this.scrollToCategory(catId);
                    }
                    return;
                }
                if (cat && cat.subcategories && cat.subcategories.length > 0) {
                    if (subWrapper && subContainer) {
                        subWrapper.style.display = "";
                        document.querySelector(".menu-filters-sticky")?.classList.add("subcategories-visible");
                        subContainer.innerHTML = "";
                        const inner = document.createElement("div");
                        inner.className = "filter-subcategories-inner";
                        cat.subcategories.forEach((sub) => {
                            const subBtn = document.createElement("button");
                            subBtn.className = "filter-btn filter-sub-btn";
                            subBtn.setAttribute("data-category", String(sub.id));
                            subBtn.innerHTML = sub.icon
                                ? `<i class="${sub.icon}"></i> ${sub.name}`
                                : sub.name;
                            inner.appendChild(subBtn);
                        });
                        subContainer.appendChild(inner);
                    }
                    this.scrollToCategory(catId);
                } else {
                    if (subWrapper) {
                        subWrapper.style.display = "none";
                        document.querySelector(".menu-filters-sticky")?.classList.remove("subcategories-visible");
                    }
                    this.scrollToCategory(catId);
                }
            });
        }

        if (subWrapper) {
            subWrapper.addEventListener("click", (e) => {
                const subContainerForDrag = document.querySelector(".filter-subcategories");
                if (subContainerForDrag && subContainerForDrag.dataset.dragJustEnded === '1') return;
                const btn = e.target.closest(".filter-sub-btn");
                if (!btn) return;
                e.stopPropagation();
                const subBtns = subWrapper.querySelectorAll(".filter-sub-btn");
                subBtns.forEach((b) => b.classList.remove("active"));
                btn.classList.add("active");
                const catId = Number(btn.dataset.category);
                if (window.TahmisciCatalog && typeof window.loadMenuProductsForCategory === "function") {
                    window.loadMenuProductsForCategory(catId);
                } else {
                    this.scrollToCategory(catId);
                }
            });
        }
    }

    /**
     * Scroll to category section.
     * Desktop: window.scrollTo (mevcut davranış).
     * Mobile (<= 600px): yalnızca .main container içinde scroll.
     */
    scrollToCategory(category) {
        const isMobile = window.innerWidth <= 600;

        // "Tümü" için en üste dön
        if (category === "all") {
            if (isMobile) {
                const main = document.querySelector(".main");
                if (main) {
                    main.scrollTo({ top: 0, behavior: "smooth" });
                }
            } else {
                window.scrollTo({ top: 0, behavior: "smooth" });
            }
            return;
        }

        let targetCategory = category;
        let anchor = document.querySelector(
            '.category-anchor[data-category="' + category + '"]',
        );
        if (!anchor) {
            const menuCats = window.MenuCategories || [];
            const mainCategory = menuCats.find((c) => Number(c.id) === Number(category));
            const subcategories = Array.isArray(mainCategory?.subcategories) ? mainCategory.subcategories : [];
            for (const sub of subcategories) {
                anchor = document.querySelector(
                    '.category-anchor[data-category="' + String(sub.id) + '"]',
                );
                if (anchor) {
                    targetCategory = sub.id;
                    break;
                }
            }
        }
        if (!anchor) return;

        const menuCats = window.MenuCategories || [];
        const subcategoryIds = new Set();
        menuCats.forEach((c) => {
            if (c.subcategories) c.subcategories.forEach((s) => subcategoryIds.add(s.id));
        });
        const isSubcategory = subcategoryIds.has(Number(targetCategory));
        const titleExtra = isSubcategory ? 20 : 0;

        if (isMobile) {
            const main = document.querySelector(".main");
            const productsSection = document.querySelector(".products-section");
            if (!main || !productsSection) return;

            const mainRect = main.getBoundingClientRect();
            const anchorRect = anchor.getBoundingClientRect();
            const offsetInsideMain = 110 + titleExtra;
            const target =
                main.scrollTop + (anchorRect.top - mainRect.top) - offsetInsideMain;

            main.scrollTo({
                top: Math.max(0, target),
                behavior: "smooth",
            });
        } else {
            const header = document.querySelector(".header");
            const filterSticky = document.querySelector(".menu-filters-sticky");
            const offset =
                (header?.offsetHeight || 50) + (filterSticky?.offsetHeight || 60) + titleExtra;
            const top =
                anchor.getBoundingClientRect().top + window.pageYOffset - offset;
            window.scrollTo({ top: Math.max(0, top), behavior: "smooth" });
        }
    }

    // ========== STICKY FILTER SYSTEM ==========

    initializeStickyFilter() {
        const menuFiltersSection = document.getElementById("menuFilters");
        const header = document.querySelector(".header");

        if (!menuFiltersSection || !header) return;

        const headerHeight = header.offsetHeight;
        const observer = new IntersectionObserver(
            (entries) => {
                entries.forEach((entry) => {
                    if (entry.isIntersecting) {
                        menuFiltersSection.classList.remove("sticky");
                    } else {
                        menuFiltersSection.classList.add("sticky");
                    }
                });
            },
            {
                threshold: 0,
                rootMargin: `-${headerHeight + 10}px 0px 0px 0px`,
            },
        );

        // Observe the element that comes before the filters
        const productsSection = document.querySelector(".products-section");
        if (productsSection) {
            observer.observe(productsSection);
        }

        // Mobilde scroll ile kategori aktif hale getirme
        this.initializeScrollBasedCategoryActivation();
    }

    // ========== SCROLL BASED CATEGORY ACTIVATION ==========

    initializeScrollBasedCategoryActivation() {
        const filterButtons = document.querySelectorAll(
            ".filter-btn[data-category]",
        );
        const filterCategories = document.querySelector(".filter-categories");
        const anchors = document.querySelectorAll(
            ".category-anchor[data-category]",
        );
        if (!filterButtons.length || !anchors.length) return;
        let lastActive = null;
        const menuCats = window.MenuCategories || [];
        const subToParent = new Map();
        menuCats.forEach((c) => {
            if (c.subcategories) c.subcategories.forEach((s) => subToParent.set(String(s.id), c.id));
        });
        const subWrapper = document.querySelector(".filter-subcategories-wrapper");
        const subContainer = document.querySelector(".filter-subcategories");
        let lastRenderedSubMainId = null;
        const scrollSubButtonIntoView = (subCategoryId) => {
            if (!subContainer || subCategoryId == null) return;
            const activeSubBtn = subContainer.querySelector(`.filter-sub-btn[data-category="${String(subCategoryId)}"]`);
            if (activeSubBtn && activeSubBtn.scrollIntoView) {
                activeSubBtn.scrollIntoView({
                    behavior: "smooth",
                    inline: "center",
                    block: "nearest",
                });
            }
        };

        const renderSubcategoriesForMain = (mainCategoryId, activeSubCategoryId = null) => {
            if (!subWrapper || !subContainer) return;
            if (window.TahmisciCatalog) {
                subWrapper.style.display = "none";
                subContainer.innerHTML = "";
                lastRenderedSubMainId = null;
                return;
            }
            const mainCat = menuCats.find((c) => Number(c.id) === Number(mainCategoryId));
            const hasSubs = !!(mainCat && Array.isArray(mainCat.subcategories) && mainCat.subcategories.length > 0);

            if (!hasSubs) {
                subWrapper.style.display = "none";
                subContainer.innerHTML = "";
                document.querySelector(".menu-filters-sticky")?.classList.remove("subcategories-visible");
                lastRenderedSubMainId = null;
                return;
            }

            // Aynı ana kategori için sadece aktif alt kategori state'ini güncelle.
            if (lastRenderedSubMainId === Number(mainCategoryId)) {
                const subBtns = subContainer.querySelectorAll(".filter-sub-btn");
                subBtns.forEach((btn) => {
                    const isActive = activeSubCategoryId != null && Number(btn.dataset.category) === Number(activeSubCategoryId);
                    btn.classList.toggle("active", !!isActive);
                });
                if (activeSubCategoryId != null) {
                    scrollSubButtonIntoView(activeSubCategoryId);
                }
                return;
            }

            subWrapper.style.display = "";
            document.querySelector(".menu-filters-sticky")?.classList.add("subcategories-visible");
            subContainer.innerHTML = "";
            const inner = document.createElement("div");
            inner.className = "filter-subcategories-inner";

            mainCat.subcategories.forEach((sub) => {
                const subBtn = document.createElement("button");
                subBtn.className = "filter-btn filter-sub-btn";
                subBtn.setAttribute("data-category", String(sub.id));
                subBtn.innerHTML = sub.icon ? `<i class="${sub.icon}"></i> ${sub.name}` : sub.name;
                if (activeSubCategoryId != null && Number(activeSubCategoryId) === Number(sub.id)) {
                    subBtn.classList.add("active");
                }
                inner.appendChild(subBtn);
            });

            subContainer.appendChild(inner);
            lastRenderedSubMainId = Number(mainCategoryId);
            if (activeSubCategoryId != null) {
                scrollSubButtonIntoView(activeSubCategoryId);
            }
        };

        const observer = new IntersectionObserver(
            (entries) => {
                entries.forEach((entry) => {
                    if (entry.isIntersecting) {
                        const category = entry.target.dataset.category;
                        if (lastActive !== category) {
                            lastActive = category;
                            const parentMainId = subToParent.get(category) || null;
                            filterButtons.forEach((btn) => {
                                const btnCat = btn.dataset.category;
                                const isParentOfCurrent = parentMainId != null && Number(btnCat) === parentMainId;
                                if (btnCat === category || isParentOfCurrent) {
                                    btn.classList.add("active");
                                    if (filterCategories && btn.scrollIntoView && (btnCat === category || isParentOfCurrent)) {
                                        btn.scrollIntoView({
                                            behavior: "smooth",
                                            inline: "center",
                                            block: "nearest",
                                        });
                                    }
                                } else {
                                    btn.classList.remove("active");
                                }
                            });

                            // Scroll ile aktif kategori değiştiğinde alt kategori şeridini de senkron tut.
                            if (parentMainId != null) {
                                renderSubcategoriesForMain(parentMainId, Number(category));
                            } else {
                                renderSubcategoriesForMain(Number(category), null);
                            }
                        }
                    }
                });
            },
            {
                root: null,
                rootMargin: "-100px 0px -60% 0px",
                threshold: 0.2,
            },
        );
        anchors.forEach((anchor) => observer.observe(anchor));
    }

    // ========== DROPDOWN FILTER ==========

    initializeDropdownFilter() {
        const moreCategoriesBtn = document.getElementById("moreCategoriesBtn");
        const moreCategoriesMenu = document.getElementById("moreCategoriesMenu");
        const filterDropdown = document.querySelector(".filter-dropdown");

        if (!moreCategoriesBtn || !moreCategoriesMenu || !filterDropdown) {
            return;
        }

        // Toggle function removed - logic moved to click event listener

        // Add click event listener
        moreCategoriesBtn.addEventListener("click", (e) => {
            e.preventDefault();
            e.stopPropagation();
            e.stopImmediatePropagation();

            const isActive = filterDropdown.classList.contains("active");

            if (isActive) {
                filterDropdown.classList.remove("active");
            } else {
                filterDropdown.classList.add("active");
            }
        });

        // Close dropdown when clicking outside
        document.addEventListener("click", (e) => {
            if (!filterDropdown.contains(e.target)) {
                filterDropdown.classList.remove("active");
            }
        });

        // Handle dropdown filter button clicks (id, has sub -> load + sub row; no sub -> scroll veya load all + scroll)
        const dropdownButtons = moreCategoriesMenu.querySelectorAll(".filter-btn");
        const menuCategories = window.MenuCategories || [];
        const subWrapper = document.querySelector(".filter-subcategories-wrapper");
        const subContainer = document.querySelector(".filter-subcategories");

        dropdownButtons.forEach((btn) => {
            const handleButtonClick = (e) => {
                e.preventDefault();
                e.stopPropagation();
                const idStr = btn.dataset.category;
                const catId = Number(idStr);
                const mainFilterButtons = document.querySelectorAll(
                    ".filter-categories .filter-btn:not(.dropdown-toggle)",
                );
                mainFilterButtons.forEach((b) => b.classList.remove("active"));
                btn.classList.add("active");
                filterDropdown.classList.remove("active");

                const cat = menuCategories.find((c) => c.id === catId);
                if (window.TahmisciCatalog) {
                    if (subWrapper && subContainer) {
                        subWrapper.style.display = "none";
                        subContainer.innerHTML = "";
                    }
                    if (typeof window.loadMenuProductsForCategory === "function") {
                        window.loadMenuProductsForCategory(catId);
                    } else {
                        this.scrollToCategory(catId);
                    }
                    return;
                }
                if (cat && cat.subcategories && cat.subcategories.length > 0) {
                    if (subWrapper && subContainer) {
                        subWrapper.style.display = "";
                        document.querySelector(".menu-filters-sticky")?.classList.add("subcategories-visible");
                        subContainer.innerHTML = "";
                        const inner = document.createElement("div");
                        inner.className = "filter-subcategories-inner";
                        cat.subcategories.forEach((sub) => {
                            const subBtn = document.createElement("button");
                            subBtn.className = "filter-btn filter-sub-btn";
                            subBtn.setAttribute("data-category", String(sub.id));
                            subBtn.innerHTML = sub.icon ? `<i class="${sub.icon}"></i> ${sub.name}` : sub.name;
                            inner.appendChild(subBtn);
                        });
                        subContainer.appendChild(inner);
                    }
                    this.scrollToCategory(catId);
                } else {
                    if (subWrapper) {
                        subWrapper.style.display = "none";
                        document.querySelector(".menu-filters-sticky")?.classList.remove("subcategories-visible");
                    }
                    this.scrollToCategory(catId);
                }
            };
            btn.addEventListener("click", handleButtonClick);
        });

        // Close dropdown on escape key
        document.addEventListener("keydown", (e) => {
            if (e.key === "Escape") {
                filterDropdown.classList.remove("active");
            }
        });

        const backdrop = filterDropdown.querySelector(".filter-dropdown-backdrop");
        if (backdrop) {
            backdrop.addEventListener("click", () => {
                filterDropdown.classList.remove("active");
            });
        }

        // GLOBAL DAHA DROPDOWN MENU
        const globalMenu = document.getElementById("moreCategoriesMenuGlobal");
        if (moreCategoriesBtn && moreCategoriesMenu && globalMenu) {
            moreCategoriesBtn.addEventListener("click", (e) => {
                e.preventDefault();
                // Menü içeriğini taşı
                globalMenu.innerHTML = moreCategoriesMenu.innerHTML;
                globalMenu.classList.add("active");
                globalMenu.style.display = "block";

                // Butonun konumunu bul
                const btnRect = moreCategoriesBtn.getBoundingClientRect();
                globalMenu.style.top = btnRect.bottom + window.scrollY + "px";
                globalMenu.style.right = window.innerWidth - btnRect.right - 8 + "px"; // 8px sağ boşluk
                globalMenu.style.left = "auto";
            });
            // Dışarı tıklayınca kapat
            document.addEventListener("click", (e) => {
                if (!globalMenu.contains(e.target) && e.target !== moreCategoriesBtn) {
                    globalMenu.classList.remove("active");
                    globalMenu.style.display = "none";
                    globalMenu.style.top = "";
                    globalMenu.style.right = "";
                    globalMenu.style.left = "";
                }
            });
            // Menü içindeyken tıklama event'ini durdur
            globalMenu.addEventListener("click", (e) => {
                e.stopPropagation();
            });
        }
    }

    updateProductsCount(category, customCount = null) {
        const productsCount = document.getElementById("productsCount");
        const productsCategory = document.getElementById("productsCategory");

        if (!productsCount || !productsCategory) return;

        let visibleProducts;
        const totalProducts = document.querySelectorAll(".product-card").length;

        if (customCount !== null) {
            visibleProducts = customCount;
        } else {
            visibleProducts = document.querySelectorAll(
                '.product-card[style*="block"]',
            ).length;
        }

        if (category === "all" || category === null) {
            productsCount.textContent = `${visibleProducts} ürün`;
            productsCategory.textContent = "tüm kategoriler";
        } else {
            productsCount.textContent = `${visibleProducts} ürün`;
            productsCategory.textContent = category;
        }
    }

    // ========== SEARCH AND SORT SYSTEM ==========

    initializeSearchAndSort() {
        const searchInput = document.getElementById("productSearch");
        const sortSelect = document.getElementById("sortSelect");

        if (searchInput) {
            searchInput.addEventListener("input", (e) => {
                const searchTerm = e.target.value.toLowerCase().trim();
                this.searchProducts(searchTerm);
            });
        }

        if (sortSelect) {
            sortSelect.addEventListener("change", (e) => {
                const sortBy = e.target.value;
                this.sortProducts(sortBy);
            });
        }
    }

    searchProducts(searchTerm) {
        const productCards = document.querySelectorAll("#productsGrid .product-card");
        const currentCategory = "all";

        let visibleCount = 0;

        productCards.forEach((card) => {
            const productCategory = card.dataset.category;
            const productName = card
                .querySelector(".product-name")
                .textContent.toLowerCase();
            const productDescription = card
                .querySelector(".product-description")
                .textContent.toLowerCase();

            // Check category filter
            const matchesCategory = true;

            // Check search filter
            const matchesSearch =
                searchTerm === "" ||
                productName.includes(searchTerm) ||
                productDescription.includes(searchTerm);

            if (matchesCategory && matchesSearch) {
                card.style.display = "flex";
                visibleCount++;
            } else {
                card.style.display = "none";
            }
        });

        // Update products count
        this.updateProductsCount(currentCategory, visibleCount);
    }

    sortProducts(sortBy) {
        const productsGrid = document.getElementById("productsGrid");
        const compareCards = (a, b) => {
            const nameA = a.querySelector(".product-name").textContent.toLowerCase();
            const nameB = b.querySelector(".product-name").textContent.toLowerCase();

            const priceA = this.extractPrice(a);
            const priceB = this.extractPrice(b);

            switch (sortBy) {
                case "name":
                    return nameA.localeCompare(nameB);
                case "price-low":
                    return priceA - priceB;
                case "price-high":
                    return priceB - priceA;
                case "popular":
                    // Sort by badge presence (popular items have badges)
                    const badgeA = a.querySelector(".product-badge");
                    const badgeB = b.querySelector(".product-badge");
                    return (badgeB ? 1 : 0) - (badgeA ? 1 : 0);
                default:
                    return Number(a.dataset.productId) - Number(b.dataset.productId);
            }
        };

        productsGrid.querySelectorAll(".category-title").forEach((title) => {
            const cards = [];
            let next = title.nextElementSibling;
            while (next && next.classList.contains("product-card")) {
                cards.push(next);
                next = next.nextElementSibling;
            }
            cards.sort(compareCards).forEach((card) => productsGrid.insertBefore(card, next));
        });
    }

    extractPrice(card) {
        const currentPriceElement = card.querySelector(".current-price");
        if (currentPriceElement) {
            const priceText = currentPriceElement.textContent;
            const match = priceText.match(/\d+(?:[.,]\d+)?/);
            return match ? parseFloat(match[0].replace(",", ".")) : 0;
        }
        return 0;
    }

    // ========== PRODUCT MODAL SYSTEM ==========

    initializeProductModal() {
        // Modal elements
        this.productModalOverlay = document.getElementById("productModalOverlay");
        this.productModalClose = document.getElementById("productModalClose");
        this.modalQuantityMinus = document.getElementById("modalQuantityMinus");
        this.modalQuantityPlus = document.getElementById("modalQuantityPlus");
        this.modalQuantity = document.getElementById("modalQuantity");
        this.modalAddToCart = document.getElementById("modalAddToCart");
        this.modalTotalPrice = document.getElementById("modalTotalPrice");

        // Event listeners
        if (this.productModalClose) {
            this.productModalClose.addEventListener("click", () =>
                this.closeProductModal(),
            );
        }

        if (this.productModalOverlay) {
            this.productModalOverlay.addEventListener("click", (e) => {
                if (e.target === this.productModalOverlay) {
                    this.closeProductModal();
                }
            });
        }
        // Swipe-to-close: tüm modallar tek listeden, kod tekrarı yok
        if (typeof SwipeModalController !== "undefined" && SwipeModalController.registerModals) {
            SwipeModalController.registerModals([
                { overlay: "productModalOverlay", onClose: () => this.closeProductModal() },
                { overlay: "newCartModalOverlay", onClose: () => this.closeNewCartModal() },
                {
                    overlay: "campaignModal",
                    onClose: () => {
                        const m = document.getElementById("campaignModal");
                        if (m) {
                            m.classList.remove("active");
                            m.style.opacity = "";
                            const box = m.querySelector(".campaign-modal");
                            if (box) box.style.transform = "";
                        }
                    },
                },
            ]);
        }

        // Quantity controls - Remove existing listeners first to prevent duplicates
        if (this.modalQuantityMinus) {
            // Clone and replace to remove all event listeners
            const newMinusBtn = this.modalQuantityMinus.cloneNode(true);
            this.modalQuantityMinus.parentNode.replaceChild(
                newMinusBtn,
                this.modalQuantityMinus,
            );
            this.modalQuantityMinus = newMinusBtn;

            this.modalQuantityMinus.addEventListener("click", () =>
                this.changeQuantity(-1),
            );
        }

        if (this.modalQuantityPlus) {
            // Clone and replace to remove all event listeners
            const newPlusBtn = this.modalQuantityPlus.cloneNode(true);
            this.modalQuantityPlus.parentNode.replaceChild(
                newPlusBtn,
                this.modalQuantityPlus,
            );
            this.modalQuantityPlus = newPlusBtn;

            this.modalQuantityPlus.addEventListener("click", () =>
                this.changeQuantity(1),
            );
        }

        // Add to cart button
        if (this.modalAddToCart) {
            this.modalAddToCart.addEventListener("click", () =>
                this.addToCartFromModal(),
            );
        }

        // Option change listeners will be initialized after options are rendered

        // Nutrition button click handler
        const nutritionBtn = document.getElementById("modalNutritionBtn");
        const self = this;
        if (nutritionBtn) {
            nutritionBtn.addEventListener("click", (e) => {
                e.preventDefault();
                e.stopPropagation();
                if (window.menuPage && window.menuPage.openNutritionTooltip) {
                    window.menuPage.openNutritionTooltip();
                } else if (self && self.openNutritionTooltip) {
                    self.openNutritionTooltip();
                }
            });
        } else {
            console.error("modalNutritionBtn not found");
        }

        // Nutrition tooltip close handlers
        const nutritionTooltipOverlay = document.getElementById(
            "nutritionTooltipOverlay",
        );
        const nutritionTooltipClose = document.getElementById(
            "nutritionTooltipClose",
        );

        if (nutritionTooltipOverlay) {
            nutritionTooltipOverlay.addEventListener("click", (e) => {
                if (e.target === nutritionTooltipOverlay) {
                    this.closeNutritionTooltip();
                }
            });
        }

        if (nutritionTooltipClose) {
            nutritionTooltipClose.addEventListener("click", () => {
                this.closeNutritionTooltip();
            });
        }
    }

    openNutritionTooltip() {
        const tooltipOverlay = document.getElementById("nutritionTooltipOverlay");
        const tooltipContent = document.getElementById("nutritionTooltipContent");

        if (!tooltipOverlay || !tooltipContent) {
            console.error("Nutrition tooltip elements not found");
            return;
        }

        if (!this.currentProduct) {
            console.error("No current product selected");
            return;
        }

        const nutritionData = this.getProductNutrition(this.currentProduct);
        if (!nutritionData.hasDetails) {
            return;
        }

        const translations = window.I18N?.getTranslations?.();
        const lang = window.I18N?.getPreferredLanguage?.() || "tr";
        const t = (key, fallback) =>
            translations?.[lang]?.[key] !== undefined
                ? translations[lang][key]
                : fallback;

        const subtitle = nutritionData.caloriesUnit
            ? `${this.escapeHtml(nutritionData.caloriesUnit)} ${this.escapeHtml(
                t("nutrition_subtitle_suffix", "başına besin değeri"),
            )}`
            : "";

        let rowsHtml = "";
        nutritionData.details.forEach((item) => {
            const valueText = this.formatNutritionDisplayValue(
                item.value,
                item.unit,
            );
            rowsHtml += `
            <div class="nutrition-value-row">
              <span class="nutrition-label">${this.escapeHtml(item.name)}</span>
              <span class="nutrition-value">${this.escapeHtml(valueText)}</span>
            </div>
          `;
        });

        const html = `
        <div class="nutrition-item">
          <h3 class="nutrition-item-title">${this.escapeHtml(this.currentProduct.name || t("nutrition_title", "Ürün"))}</h3>
          ${subtitle
                ? `<p class="nutrition-item-subtitle">${subtitle}</p>`
                : ""
            }
          <div class="nutrition-values">
            ${rowsHtml}
          </div>
        </div>
      `;

        tooltipContent.innerHTML = html;
        tooltipOverlay.classList.add("active");
        document.body.style.overflow = "hidden";
    }

    closeNutritionTooltip() {
        const tooltipOverlay = document.getElementById("nutritionTooltipOverlay");
        if (tooltipOverlay) {
            tooltipOverlay.classList.remove("active");
        }
        // Only enable scroll if product modal is not open
        const productModal = document.getElementById("productModalOverlay");
        if (!productModal || !productModal.classList.contains("active")) {
            document.body.style.overflow = "";
        }
    }

    getProductNutrition(product) {
        const details = Array.isArray(product?.nutrition)
            ? product.nutrition
                .map((item) => ({
                    name: String(item?.name ?? "").trim(),
                    value: String(item?.value ?? "").trim(),
                    unit: String(item?.unit ?? "").trim(),
                    sort: Number(item?.sort ?? 0) || 0,
                }))
                .filter((item) => item.name !== "" && item.value !== "")
            : [];

        const calories = String(
            product?.caloriesText || product?.calories || product?.products_branches_calories || "",
        ).trim();
        const caloriesUnit = String(product?.caloriesUnit || product?.products_branches_calories_unit || "").trim();
        const hasCalories = isValidProductInfo(calories);

        return {
            calories,
            caloriesUnit,
            details,
            hasCalories,
            hasDetails: details.length > 0,
            hasAny: hasCalories || details.length > 0,
        };
    }

    normalizeNutritionNumber(value) {
        const raw = String(value ?? "").trim();
        if (raw === "") {
            return "";
        }

        const normalizedRaw = raw.replace(",", ".");
        const parsed = Number(normalizedRaw);
        if (!Number.isFinite(parsed)) {
            return raw;
        }

        return parsed.toFixed(2).replace(/\.?0+$/, "");
    }

    formatNutritionDisplayValue(value, unit) {
        const formattedValue = this.normalizeNutritionNumber(value);
        const unitText = String(unit ?? "").trim();
        if (formattedValue === "") {
            return unitText;
        }
        return unitText ? `${formattedValue} ${unitText}` : formattedValue;
    }

    formatTahmisciPriceLabel(product) {
        const variants = Array.isArray(product?.variants)
            ? product.variants.filter((item) => Number.isFinite(Number(item?.price)) && Number(item.price) > 0)
            : [];
        if (variants.length > 0) {
            return variants.map((item) => {
                const rawName = String(item.name || "").trim();
                let label = rawName.replace(String(product?.name || ""), "").trim() || rawName || "Fiyat";
                label = label
                    .replace(/^KÜÇÜK$/i, "K")
                    .replace(/^ORTA$/i, "O")
                    .replace(/^BÜYÜK$/i, "B");
                return `${label} ${this.formatPriceValue(item.price)}`;
            }).join(" | ");
        }
        const directPrice = Number(product?.basePrice || product?.price || 0);
        if (Number.isFinite(directPrice) && directPrice > 0) {
            return this.formatPriceValue(directPrice);
        }
        const priceLabel = String(product?.priceLabel || "").trim();
        return priceLabel && !priceLabel.includes("-") ? priceLabel : "";
    }

    formatPriceValue(value) {
        const amount = Number(value);
        if (!Number.isFinite(amount) || amount <= 0) return "";
        const clean = amount.toFixed(2).replace(/\.00$/, "").replace(/(\.\d)0$/, "$1");
        return `${clean}₺`;
    }

    updateNutritionActions(product) {
        const nutritionData = this.getProductNutrition(product || {});
        const nutritionBtn = document.getElementById("modalNutritionBtn");
        const calorieBadge = document.getElementById("modalCalorieBadge");
        const calorieValue = document.getElementById("modalCalorieValue");

        if (calorieBadge && calorieValue) {
            if (nutritionData.hasCalories) {
                calorieValue.textContent = nutritionData.calories;
                calorieBadge.style.display = "inline-flex";
            } else {
                calorieValue.textContent = "";
                calorieBadge.style.display = "none";
            }
        }

        if (nutritionBtn) {
            nutritionBtn.style.display = nutritionData.hasDetails
                ? "inline-flex"
                : "none";
        }

        return nutritionData;
    }

    renderTahmisciRecipeSummary(product) {
        if (!window.TahmisciCatalog) return;

        const modalDescription = document.getElementById("modalProductDescription");
        if (!modalDescription) return;

        let panel = document.getElementById("tahmisciRecipeSummary");
        if (!panel) {
            panel = document.createElement("div");
            panel.id = "tahmisciRecipeSummary";
            panel.className = "tahmisci-recipe-summary";
            modalDescription.insertAdjacentElement("afterend", panel);
        }

        const nutritionData = this.getProductNutrition(product || {});
        const details = nutritionData.details || [];
        const findDetail = (needle) => details.find((item) => {
            const key = String(item.name || "").toLocaleLowerCase("tr-TR");
            return key.includes(needle);
        });

        const contentItem = findDetail("reçete") || findDetail("icerik") || findDetail("içerik");
        const allergenItem = findDetail("alerjen");
        const content = contentItem
            ? this.formatNutritionDisplayValue(contentItem.value, contentItem.unit)
            : (product?.description || "Kaynakta tanımlı değil");
        const allergens = allergenItem
            ? this.formatNutritionDisplayValue(allergenItem.value, allergenItem.unit)
            : "Kaynakta tanımlı değil";
        const calories = nutritionData.hasCalories
            ? this.formatNutritionDisplayValue(nutritionData.calories, nutritionData.caloriesUnit || "kcal")
            : "Kaynakta tanımlı değil";

        panel.innerHTML = `
            <div class="tahmisci-recipe-summary-row">
                <strong>İçerik</strong>
                <span>${this.escapeHtml(content)}</span>
            </div>
            <div class="tahmisci-recipe-summary-row">
                <strong>Kalori</strong>
                <span>${this.escapeHtml(calories)}</span>
            </div>
            <div class="tahmisci-recipe-summary-row">
                <strong>Alerjen</strong>
                <span>${this.escapeHtml(allergens)}</span>
            </div>
        `;
    }

    initializeOptionListeners() {
        const container = document.getElementById("dynamicOptionsContainer");
        if (!container) return;

        // Eski dinleyicileri kaldır
        if (this.handleOptionChange) {
            container.removeEventListener("change", this.handleOptionChange);
        }
        if (this.handleOptionSearchClick) {
            container.removeEventListener("click", this.handleOptionSearchClick);
        }
        if (this.handleOptionSearchInput) {
            container.removeEventListener("input", this.handleOptionSearchInput);
        }
        if (this.handleOptionClick) {
            container.removeEventListener("click", this.handleOptionClick);
        }

        // 1) Opsiyon değişiklikleri (radio / checkbox)
        this.handleOptionChange = (e) => {
            if (e.target.type === "radio" || e.target.type === "checkbox") {
                // Optional radio + min=0 ise "Seçim yok" seçeneğini sadece seçim yapıldıktan sonra ekle
                this.syncNoneChoiceVisibility(e.target);
                this.updatePrice();

                // Radio/checkbox değiştiğinde her zaman alt opsiyonları kontrol et
                // (önceki seçimin alt opsiyonlarını temizlemek ve yeni seçimin alt opsiyonlarını göstermek için)
                if (e.target.type === "radio") {
                    this.handleSubOptionsToggle(e.target);
                } else if (e.target.type === "checkbox") {
                    // Checkbox için de aynı mantık: seçildiğinde alt opsiyonları kontrol et
                    this.handleSubOptionsToggle(e.target);
                }
            }
        };
        container.addEventListener("change", this.handleOptionChange);

        // 2) Arama butonu tıklaması
        this.handleOptionSearchClick = (e) => {
            const toggle = e.target.closest(".option-search-toggle");
            if (!toggle) return;

            const header = toggle.closest(".option-group-header");
            if (!header) return;

            const input = header.querySelector(".option-search-input");
            if (!input) return;

            const isActive = input.classList.toggle("active");
            toggle.classList.toggle("active", isActive);

            // Input açıkken ikonu gizle, kapalıyken göster
            if (isActive) {
                toggle.style.display = "none";
                // Input açılır açılmaz focus yap
                setTimeout(() => {
                    input.focus();
                }, 50);
            } else {
                toggle.style.display = "flex";
            }

            const group = toggle.closest(".product-option-group");
            if (!group) return;

            const choices = group.querySelectorAll(".option-choices .option-choice");

            if (isActive) {
                // Focus zaten yukarıda yapıldı
            } else {
                // Aramayı kapatırken filtreyi temizle
                input.value = "";
                choices.forEach((choice) => {
                    choice.style.display = "";
                });
            }
        };
        container.addEventListener("click", this.handleOptionSearchClick);

        // 3) Arama input'u ile filtreleme
        this.handleOptionSearchInput = (e) => {
            if (!e.target.classList.contains("option-search-input")) return;

            const query = e.target.value.trim().toLowerCase();
            const group = e.target.closest(".product-option-group");
            if (!group) return;

            const choices = group.querySelectorAll(".option-choices .option-choice");
            choices.forEach((choice) => {
                const nameEl = choice.querySelector(".choice-name");
                const text = (nameEl ? nameEl.textContent : "").toLowerCase();
                choice.style.display = text.includes(query) ? "" : "none";
            });
        };
        container.addEventListener("input", this.handleOptionSearchInput);

        // 4) Hover ile input açıldığında focus yap
        container.addEventListener(
            "mouseenter",
            (e) => {
                const wrapper = e.target.closest(".option-search-wrapper");
                if (!wrapper) return;

                const input = wrapper.querySelector(".option-search-input");
                if (!input || input.classList.contains("active")) return;

                // Hover ile input açıldığında focus yap
                setTimeout(() => {
                    if (!input.classList.contains("active")) {
                        input.classList.add("active");
                    }
                    input.focus();
                }, 100);
            },
            true,
        );
    }

    // Optional radio + min=0 ise "Seçim yok" seçeneğini sadece seçim yapıldıktan sonra göster
    syncNoneChoiceVisibility(changedInput) {
        if (!changedInput || changedInput.type !== "radio") return;

        // "Seçim yok" zaten ise bir şey yapma (grupta kalsın)
        const optionGroup = changedInput.closest(".product-option-group");
        if (!optionGroup) return;

        // "Seçim yok" seçildiyse: tüm radio seçimlerini kaldır, alt opsiyonları temizle ve kendisini kaldır
        if (changedInput.dataset && changedInput.dataset.none === "1") {
            // Aynı isimdeki tüm radio butonlarının seçimini kaldır
            const groupName = changedInput.name;
            if (groupName) {
                const radios = optionGroup.querySelectorAll(
                    `input[type="radio"][name="${groupName}"]`,
                );
                radios.forEach((r) => {
                    r.checked = false;
                    // Varsayılan qty'yi de sıfırla
                    r.setAttribute("data-qty", "0");
                });
            }

            // alt opsiyonları temizle (varsa)
            const subOptionsContainer = optionGroup.querySelector(
                ".sub-options-container",
            );
            if (subOptionsContainer) {
                subOptionsContainer.innerHTML = "";
                subOptionsContainer.style.display = "none";
            }

            // "Seçim yok" label'ını kaldır
            const noneLabel = changedInput.closest("label.option-choice");
            if (noneLabel) noneLabel.remove();

            // Fiyatı güncelle
            this.updatePrice();

            return;
        }

        const requiredEl = optionGroup.querySelector(".option-required");
        const isRequired = requiredEl && requiredEl.classList.contains("required");

        // Koşul: radio + isteğe bağlı (required:false) ise "Seçim yok" göster
        const isEligible = !isRequired;
        if (!isEligible) return;

        const optionChoices = optionGroup.querySelector(".option-choices");
        if (!optionChoices) return;

        const noneExists = !!optionChoices.querySelector(
            'input[type="radio"][data-none="1"]',
        );
        const anyChecked = !!optionChoices.querySelector(
            'input[type="radio"]:checked',
        );

        // Hiç seçim yoksa "Seçim yok" görünmesin (varsa kaldır)
        if (!anyChecked) {
            if (noneExists) {
                const noneInput = optionChoices.querySelector(
                    'input[type="radio"][data-none="1"]',
                );
                const noneLabel = noneInput
                    ? noneInput.closest("label.option-choice")
                    : null;
                if (noneLabel) noneLabel.remove();
            }
            return;
        }

        // Bir seçim yapıldıysa "Seçim yok" ekle (yoksa)
        if (!noneExists) {
            const optionId = optionGroup.getAttribute("data-option-id");
            const optionTitle =
                optionGroup.querySelector(".option-title")?.textContent?.trim() || "";

            // Aynı gruptaki gerçek radio'nun name'ini bul (instance id için)
            const firstRadio = optionChoices.querySelector('input[type="radio"]');
            const groupName =
                firstRadio?.name || (optionId ? `option_${optionId}` : "");

            // Option objesi benzeri minimal yapı (createOptionChoice için)
            const fauxOption = {
                id: optionId,
                type: "radio",
                title: optionTitle,
                required: false,
                min: 0,
                inputName: groupName,
            };

            const noneLabel = this.createOptionChoice(
                fauxOption,
                {
                    id: "__none__",
                    name: "Seçim yok",
                    price: 0,
                    maxQty: 1,
                    suboption: 0,
                    __none: true,
                },
                -1,
            );

            // En sona ekle (daha kullanıcı dostu)
            optionChoices.appendChild(noneLabel);
        }
    }

    // Handle sub-options toggle (show/hide sub-options when parent is selected)
    // Handle sub-options toggle (show/hide sub-options when parent is selected)
    async handleSubOptionsToggle(input) {
        if (isTahmisciBackendCatalogMode()) {
            this.updatePrice();
            return;
        }
        // Radio ve checkbox için çalışır
        if (input.type !== "radio" && input.type !== "checkbox") return;

        const container = document.getElementById("dynamicOptionsContainer");
        if (!container) return;

        // Sub option AJAX isteklerini takip etmek için instance-level state
        // Böylece geç dönen eski cevaplar DOM'a yanlış alt opsiyon basamaz.
        if (!this._productSubOptionRequests) {
            this._productSubOptionRequests = {};
        }

        // Aynı option grubundaki ortak sub-options host'u bul
        const optionGroup = input.closest(".product-option-group");
        if (!optionGroup) return;

        const subOptionsContainer = optionGroup.querySelector(
            ".sub-options-container",
        );
        if (!subOptionsContainer) return;

        const productId = this.currentProduct ? this.currentProduct.id : null;
        const optionId =
            input.getAttribute("data-option-id") ||
            optionGroup.getAttribute("data-option-id") ||
            "";

        const parentSelectionId =
            input.getAttribute("data-selection-id") ||
            input.value ||
            "";

        const requestKey = [
            productId || "no_product",
            optionId || "no_option",
            parentSelectionId || "no_selection",
        ].join("_");

        // Radio için: aynı grup içindeki tüm radio'ların alt opsiyonlarını temizle
        // Checkbox için: sadece bu checkbox'ın alt opsiyonlarını kontrol et
        if (input.type === "radio") {
            // Radio değiştiğinde her zaman container'ı temizle (önceki seçimin alt opsiyonlarını kaldırmak için)
            subOptionsContainer.innerHTML = "";
            subOptionsContainer.style.display = "none";
        } else if (input.type === "checkbox") {
            // Checkbox için: birden fazla checkbox seçili olabilir,
            // her birinin alt opsiyonları ayrı ayrı gösterilebilir.
            if (!input.checked) {
                // Bu seçime ait bekleyen AJAX cevabı varsa geçersiz kıl
                this._productSubOptionRequests[requestKey] =
                    "cancelled_" + Date.now();

                // Checkbox kaldırıldıysa, sadece bu checkbox'a ait alt opsiyon bloklarını temizle.
                const parentKey =
                    input.getAttribute("data-selection-id") || input.value || "";

                if (parentKey) {
                    const relatedGroups = subOptionsContainer.querySelectorAll(
                        `.product-option-group.sub-option-group[data-parent-selection="${parentKey}"]`,
                    );
                    relatedGroups.forEach((el) => el.remove());
                }

                // Eğer hiç alt opsiyon kalmadıysa container'ı gizle
                if (
                    !subOptionsContainer.querySelector(
                        ".product-option-group.sub-option-group",
                    )
                ) {
                    subOptionsContainer.style.display = "none";
                }

                this.updatePrice();
                return;
            }
        }

        // "Seçim yok" (optional radio) seçildiyse alt opsiyonları kapat ve çık
        if (input.dataset && input.dataset.none === "1") {
            // Bu seçime ait bekleyen AJAX cevabı varsa geçersiz kıl
            this._productSubOptionRequests[requestKey] =
                "cancelled_" + Date.now();

            this.updatePrice();
            return;
        }

        // Seçim kaldırıldıysa direkt fiyatı güncelle
        if (!input.checked) {
            // Bu seçime ait bekleyen AJAX cevabı varsa geçersiz kıl
            this._productSubOptionRequests[requestKey] =
                "cancelled_" + Date.now();

            this.updatePrice();
            return;
        }

        let subOptions = input._subOptions;

        // data-sub="1" ise bu seçenek için alt opsiyon AJAX ile yüklenecek
        const hasSubOptionFlag = input.dataset.sub === "1";

        if (
            (!subOptions || !Array.isArray(subOptions) || subOptions.length === 0) &&
            hasSubOptionFlag
        ) {
            try {
                const selectionId = input.getAttribute("data-selection-id") || null;

                // selectionId yoksa (ör: seçim yok) alt opsiyon arama
                if (!selectionId) {
                    this.updatePrice();
                    return;
                }

                const requestToken =
                    Date.now() + "_" + Math.random().toString(36).substring(2);

                this._productSubOptionRequests[requestKey] = requestToken;

                const resp = await fetch(getSiteRoot() + "/yeppanel/db/ajax/web/product-suboptions.php", {
                    method: "POST",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({
                        productId,
                        optionId,
                        selectionId,
                        lang: getAjaxLang(),
                    }),
                });

                const data = await resp.json();

                // Geç dönen eski cevap ise DOM'a basma
                if (this._productSubOptionRequests[requestKey] !== requestToken) {
                    return;
                }

                // Modal kapandıysa, ürün değiştiyse veya input artık DOM'da değilse işlem yapma
                if (
                    !this.currentProduct ||
                    String(this.currentProduct.id) !== String(productId) ||
                    !input.isConnected
                ) {
                    return;
                }

                // Parent seçim artık seçili değilse eski cevabı yok say
                if (!input.checked) {
                    return;
                }

                if (
                    data &&
                    data.success &&
                    data.data &&
                    Array.isArray(data.data.options)
                ) {
                    subOptions = data.data.options;
                    input._subOptions = subOptions;
                }
            } catch (e) {
                console.error("Sub options load error:", e);
            }
        }

        // Seçilen input'a bağlı alt opsiyonlar yoksa sadece fiyatı güncelle
        if (!subOptions || !Array.isArray(subOptions) || subOptions.length === 0) {
            this.updatePrice();
            return;
        }

        // Render öncesi tekrar kontrol: input hala DOM'da ve seçili olmalı
        if (!input.isConnected || !input.checked) {
            this.updatePrice();
            return;
        }

        // Parantez içindeki isim: seçili öğenin kendi adı olmalı (örn: "Acı Sos"),
        // opsiyon grubu başlığı değil (örn: "Ek Malzemeler").
        const parentSelectionName =
            (input.value && input.value.trim()) ||
            (input.getAttribute("data-selection-name") || "").trim() ||
            (input.getAttribute("data-option-title") || "").trim() ||
            "";

        // Yeni alt opsiyonları render et (ana opsiyonlarla aynı yapı)
        subOptions.forEach((subOption) => {
            // Aynı sub-option farklı ana opsiyonlarda kullanılıyorsa,
            // radio gruplarının çakışmaması için instance bazlı bir id kullan.
            const originalId = subOption.id;
            const parentKey =
                input.getAttribute("data-selection-id") || input.value || "";
            const instanceId = parentKey
                ? `${originalId}_${parentKey}`
                : `${originalId}`;

            const subOptionGroup = document.createElement("div");
            subOptionGroup.className = "product-option-group sub-option-group";
            // Validasyon ve backend için orijinal option id'yi sakla
            subOptionGroup.setAttribute("data-option-id", originalId);
            // Hangi ana seçime (checkbox/radio) bağlı olduğunu takip et
            if (parentKey) {
                subOptionGroup.setAttribute("data-parent-selection", parentKey);
            }
            // min/max değerlerini data attribute olarak sakla (validasyon için)
            if (subOption.min !== undefined)
                subOptionGroup.setAttribute("data-option-min", subOption.min);
            if (subOption.max !== undefined)
                subOptionGroup.setAttribute("data-option-max", subOption.max);

            // Header (başlık + arama)
            const header = document.createElement("div");
            header.className = "option-group-header";

            const title = document.createElement("h4");
            title.className = "option-title";
            // Başlığa hangi ana opsiyona bağlı olduğunu ekle: "Sucuk Yoğunluğu (Acı Sos)"
            if (parentSelectionName) {
                title.textContent = `${subOption.title || "Seçenekler"} (${parentSelectionName})`;
            } else {
                title.textContent = subOption.title || "Seçenekler";
            }
            header.appendChild(title);

            // Arama butonu + input (opsiyonel - sub-optionlarda arama gerekli değilse kaldırılabilir)
            const searchWrapper = document.createElement("div");
            searchWrapper.className = "option-search-wrapper";

            const searchInput = document.createElement("input");
            searchInput.type = "text";
            searchInput.className = "option-search-input";
            const optionSearchPlaceholder =
                window.I18N?.getTranslations?.()?.[
                    window.I18N?.getPreferredLanguage?.() || "tr"
                ]?.option_search_placeholder || "Ara...";
            searchInput.placeholder = optionSearchPlaceholder;

            const searchToggle = document.createElement("button");
            searchToggle.type = "button";
            searchToggle.className = "option-search-toggle";
            searchToggle.innerHTML = '<i class="fas fa-search"></i>';

            searchWrapper.appendChild(searchInput);
            searchWrapper.appendChild(searchToggle);
            header.appendChild(searchWrapper);

            subOptionGroup.appendChild(header);

            // Limit & required bilgisi satırı
            const metaRow = document.createElement("div");
            metaRow.className = "option-meta-row";

            // min/max değerlerini kullan (maxSelectable yerine max kullan)
            const maxSelectable =
                subOption.max !== undefined
                    ? subOption.max
                    : subOption.maxSelectable ||
                    (subOption.type === "radio" ? 1 : subOption.items.length);

            const limitSpan = document.createElement("span");
            limitSpan.className = "option-limit";
            const limitPrefix =
                window.I18N?.getTranslations?.()?.[
                    window.I18N?.getPreferredLanguage?.() || "tr"
                ]?.option_limit_prefix || "En fazla";
            const limitSuffix =
                window.I18N?.getTranslations?.()?.[
                    window.I18N?.getPreferredLanguage?.() || "tr"
                ]?.option_limit_suffix || "adet seçebilirsiniz!";
            limitSpan.textContent = `${limitPrefix} ${maxSelectable} ${limitSuffix}`;

            const requiredSpan = document.createElement("span");
            requiredSpan.className = `option-required ${subOption.required ? "required" : "optional"}`;
            const requiredText =
                window.I18N?.getTranslations?.()?.[
                    window.I18N?.getPreferredLanguage?.() || "tr"
                ]?.option_required || "Zorunlu";
            const optionalText =
                window.I18N?.getTranslations?.()?.[
                    window.I18N?.getPreferredLanguage?.() || "tr"
                ]?.option_optional || "İsteğe Bağlı";
            requiredSpan.textContent = subOption.required
                ? requiredText
                : optionalText;

            metaRow.appendChild(limitSpan);
            metaRow.appendChild(requiredSpan);

            subOptionGroup.appendChild(metaRow);

            const subChoicesContainer = document.createElement("div");
            subChoicesContainer.className = "option-choices";

            subOption.items.forEach((subItem, subIndex) => {
                // createOptionChoice için: instance id'yi kullan ama orijinal id'yi de sakla
                const renderOption = {
                    ...subOption,
                    id: instanceId,
                    originalId: originalId,
                };

                const subChoiceLabel = this.createOptionChoice(
                    renderOption,
                    subItem,
                    subIndex,
                );
                subChoicesContainer.appendChild(subChoiceLabel);
            });

            subOptionGroup.appendChild(subChoicesContainer);

            // Alt opsiyonların gösterileceği ortak container (nested sub-options için)
            const nestedSubOptionsHost = document.createElement("div");
            nestedSubOptionsHost.className = "sub-options-container";
            nestedSubOptionsHost.style.display = "none";
            subOptionGroup.appendChild(nestedSubOptionsHost);

            subOptionsContainer.appendChild(subOptionGroup);
        });

        subOptionsContainer.style.display = "block";

        this.updatePrice();
    }
    async openProductModal(productId, cartItemId = null) {
        if (!productId) {
            return;
        }

        const product = this.products.find((p) => p.id === productId);
        if (!product) {
            return;
        }

        this.currentProduct = product;
        this.currentProduct.nutrition = Array.isArray(product.nutrition) ? product.nutrition : [];
        this.editingCartItemId = cartItemId;

        const nutritionTooltipContent = document.getElementById(
            "nutritionTooltipContent",
        );
        if (nutritionTooltipContent) {
            nutritionTooltipContent.innerHTML = "";
        }
        this.closeNutritionTooltip();

        // Find cart item if editing
        let cartItem = null;
        if (cartItemId) {
            const cartItems = window.globalCart
                ? window.globalCart.getItems()
                : this.cart;
            cartItem = cartItems.find((item) => item.id === cartItemId);
            if (cartItem) {
                this.currentQuantity = cartItem.quantity || 1;
                this.basePrice = cartItem.basePrice || product.basePrice;
            } else {
                this.currentQuantity = 1;
                this.basePrice = product.basePrice;
            }
        } else {
            this.currentQuantity = 1;
            this.basePrice = product.basePrice;
        }

        // Show spinner immediately before updating content
        const modalImageSpinner = document.getElementById(
            "modalImageLoadingSpinner",
        );
        if (modalImageSpinner) {
            modalImageSpinner.style.display = "flex";
        }

        // Show modal first (so spinner is visible)
        this.productModalOverlay.classList.add("active");
        document.body.style.overflow = "hidden";

        // Reset scroll position to top
        const modalInfo = document.querySelector(".product-modal-info");
        if (modalInfo) {
            modalInfo.scrollTop = 0;
        }

        // Update modal content with basic info first
        this.updateModalContent(product, null, null);
        this.updateModalOrderTypeVisibility();

        // Tükendi ise sepete ekle satırını gizle
        const addToCartRow = document.querySelector(".add-to-cart-row");
        if (addToCartRow) {
            addToCartRow.style.display = product.product_qr_status === "2" ? "none" : "";
        }

        // Load options and nutrition from API
        await this.loadProductOptions(productId);

        // Populate or reset form
        if (cartItem && cartItem.options) {
            await this.populateModalForm(cartItem);
        } else {
            this.resetModalForm();
        }

        // Update modal button text
        this.updateModalButtonText();

        // Calculate initial price
        this.updatePrice();

        // Initialize viewport detection for mobile browser chrome
        this.initializeViewportDetection();

        // Galeri sistemini başlat
        setTimeout(() => {
            const product = this.currentProduct;

            if (product) {
                // Eğer media array varsa kullan, yoksa product.image'dan tek resimli galeri oluştur
                if (
                    product.media &&
                    Array.isArray(product.media) &&
                    product.media.length > 0
                ) {
                    if (window.initProductGallery) {
                        const mediaWithSource = product.media.map((m) => ({
                            ...m,
                            isLogoFallback: !!(isLogoFallbackSource(product.image_source) && m.type === "image" && m.url === product.image),
                        }));
                        window.initProductGallery(mediaWithSource);
                    }
                } else if (product.image) {
                    // Fallback: Tek resimli galeri oluştur
                    if (window.initProductGallery) {
                        window.initProductGallery([{
                            type: "image",
                            url: product.image,
                            isLogoFallback: isLogoFallbackSource(product.image_source),
                        }]);
                    }
                }
            }
        }, 100);
    }

    updateModalOrderTypeVisibility() {
        const orderType = localStorage.getItem("menuOrderType");
        const modalFooter = document.querySelector(".product-modal-footer");
        if (!modalFooter) return;
        if (orderType === "tableMenu") {
            modalFooter.style.display = "none";
        } else {
            modalFooter.style.display = "";
        }
    }

    updateModalContent(product, options = null, nutrition = null) {
        const modalImageSpinner = document.getElementById(
            "modalImageLoadingSpinner",
        );

        // Eğer media array varsa eski resim sistemini atla (galeri kullanılacak)
        if (
            product.media &&
            Array.isArray(product.media) &&
            product.media.length > 0
        ) {
            // Galeri sistemi kullanılacak, eski resim sistemini atla
            // Spinner galeri render edildiğinde gizlenecek
            // Gallery will be initialized by window.initProductGallery in openProductModal
            if (modalImageSpinner) {
                modalImageSpinner.style.display = "flex";
            }
        } else {
            // Update product image with lazy loading and spinner (eski sistem)
            const modalImage = document.getElementById("modalProductImage");
            const modalImageSpinner = document.getElementById(
                "modalImageLoadingSpinner",
            );

            if (modalImage) {
                modalImage.alt = product.name || "";
                modalImage.classList.toggle("logo-fallback-image", isLogoFallbackSource(product.image_source));

                // Reset image state
                modalImage.src = "";
                modalImage.classList.remove("loaded");
                modalImage.classList.add("lazy-image");

                // Ensure spinner is visible (already shown in openProductModal, but double-check)
                if (modalImageSpinner) {
                    modalImageSpinner.style.display = "flex";
                }

                // Load image with lazy loading
                if (product.image) {
                    const tempImg = new Image();

                    tempImg.onload = () => {
                        modalImage.src = product.image;
                        modalImage.classList.add("loaded");
                        modalImage.classList.remove("lazy-image");

                        // Hide spinner after image loads
                        if (modalImageSpinner) {
                            modalImageSpinner.style.display = "none";
                        }
                    };

                    tempImg.onerror = () => {
                        // Hide spinner on error
                        if (modalImageSpinner) {
                            modalImageSpinner.style.display = "none";
                        }
                        // Set placeholder image
                        modalImage.src = "/assets/brand/logo-large.png";
                        modalImage.classList.remove("lazy-image");
                        modalImage.classList.add("logo-fallback-image");
                    };

                    // Start loading
                    tempImg.src = product.image;
                } else {
                    if (modalImageSpinner) {
                        modalImageSpinner.style.display = "none";
                    }
                    modalImage.src = "/assets/brand/logo-large.png";
                    modalImage.classList.add("logo-fallback-image");
                    modalImage.classList.remove("lazy-image");
                }
            }
        }

        // Update badge (tükendi öncelikli)
        const modalBadge = document.getElementById("modalProductBadge");
        if (modalBadge) {
            if (product.product_qr_status === "2") {
                modalBadge.textContent = "Tükendi";
                modalBadge.style.display = "block";
            } else if (product.badge) {
                modalBadge.textContent = this.getBadgeText(product.badge);
                modalBadge.style.display = "block";
            } else {
                modalBadge.style.display = "none";
            }
        }

        // Update product details
        const modalName = document.getElementById("modalProductName");
        if (modalName) modalName.textContent = product.name;

        if (modalName) {
            let categoryEl = document.getElementById("modalProductCategory");
            if (!categoryEl) {
                categoryEl = document.createElement("p");
                categoryEl.id = "modalProductCategory";
                categoryEl.className = "tahmisci-modal-category";
                modalName.insertAdjacentElement("afterend", categoryEl);
            }
            const categoryText = String(product.categoryName || product.parentCategoryName || "").trim();
            categoryEl.textContent = categoryText;
            categoryEl.style.display = categoryText ? "" : "none";
        }

        const modalDescription = document.getElementById("modalProductDescription");
        if (modalDescription) {
            const descriptionText = String(product.description || "").trim();
            modalDescription.textContent = descriptionText;
            modalDescription.style.display = descriptionText ? "" : "none";
        }

        // Store nutrition in currentProduct for getProductNutrition
        if (nutrition !== null) {
            if (!this.currentProduct) this.currentProduct = product;
            this.currentProduct.nutrition = Array.isArray(nutrition) ? nutrition : [];
        }
        this.updateNutritionActions(this.currentProduct || product);
        this.renderTahmisciRecipeSummary(this.currentProduct || product);

        // Render dynamic options only when data is available
        if (options !== null) {
            this.renderDynamicOptions(options || []);
        }

        // Initialize option listeners after rendering
        this.initializeOptionListeners();
    }

    // Public bootstrap already carries every detail safe to show on the website.
    async loadProductOptions(productId) {
        const optionsSpinner = document.getElementById("optionsLoadingSpinner");
        if (optionsSpinner) optionsSpinner.classList.remove("loading");
        if (!this.currentProduct || this.currentProduct.id !== productId) return;
        this.updateModalContent(this.currentProduct, [], this.currentProduct.nutrition || []);
    }

    // (duplicate initializeOptionListeners removed - use the main implementation above)

    // Render dynamic options with nested sub-options support
    renderDynamicOptions(options) {
        const container = document.getElementById("dynamicOptionsContainer");
        if (!container) return;

        const optionsSpinner = document.getElementById("optionsLoadingSpinner");
        container.innerHTML = "";
        if (optionsSpinner) {
            container.appendChild(optionsSpinner);
        }

        if (!options || options.length === 0) {
            if (optionsSpinner) {
                optionsSpinner.classList.remove("loading");
            }
            return;
        }

        options.forEach((option) => {
            if (!option.items || option.items.length === 0) {
                return; // Skip empty options
            }

            const optionGroup = document.createElement("div");
            optionGroup.className = "product-option-group";
            optionGroup.setAttribute("data-option-id", option.id);
            // min/max değerlerini data attribute olarak sakla (validasyon için)
            if (option.min !== undefined)
                optionGroup.setAttribute("data-option-min", option.min);
            if (option.max !== undefined)
                optionGroup.setAttribute("data-option-max", option.max);

            // Grup başlığı + arama alanı
            const header = document.createElement("div");
            header.className = "option-group-header";

            const title = document.createElement("h4");
            title.className = "option-title";
            title.textContent = option.title || "Seçenekler";
            header.appendChild(title);

            // Arama butonu + input
            const searchWrapper = document.createElement("div");
            searchWrapper.className = "option-search-wrapper";

            const searchInput = document.createElement("input");
            searchInput.type = "text";
            searchInput.className = "option-search-input";
            const optionSearchPlaceholder =
                window.I18N?.getTranslations?.()?.[
                    window.I18N?.getPreferredLanguage?.() || "tr"
                ]?.option_search_placeholder || "Ara...";
            searchInput.placeholder = optionSearchPlaceholder;

            const searchToggle = document.createElement("button");
            searchToggle.type = "button";
            searchToggle.className = "option-search-toggle";
            searchToggle.innerHTML = '<i class="fas fa-search"></i>';

            searchWrapper.appendChild(searchInput);
            searchWrapper.appendChild(searchToggle);
            header.appendChild(searchWrapper);

            optionGroup.appendChild(header);

            // Limit & required bilgisi satırı
            const metaRow = document.createElement("div");
            metaRow.className = "option-meta-row";

            // max değerini kullan (yoksa maxSelectable, yoksa varsayılan)
            const maxSelectable =
                option.max !== undefined
                    ? option.max
                    : option.maxSelectable ||
                    (option.type === "radio" ? 1 : option.items.length);

            const limitSpan = document.createElement("span");
            limitSpan.className = "option-limit";
            const limitPrefix =
                window.I18N?.getTranslations?.()?.[
                    window.I18N?.getPreferredLanguage?.() || "tr"
                ]?.option_limit_prefix || "En fazla";
            const limitSuffix =
                window.I18N?.getTranslations?.()?.[
                    window.I18N?.getPreferredLanguage?.() || "tr"
                ]?.option_limit_suffix || "adet seçebilirsiniz!";
            limitSpan.textContent = `${limitPrefix} ${maxSelectable} ${limitSuffix}`;

            const requiredSpan = document.createElement("span");
            requiredSpan.className = `option-required ${option.required ? "required" : "optional"
                }`;
            const requiredText =
                window.I18N?.getTranslations?.()?.[
                    window.I18N?.getPreferredLanguage?.() || "tr"
                ]?.option_required || "Zorunlu";
            const optionalText =
                window.I18N?.getTranslations?.()?.[
                    window.I18N?.getPreferredLanguage?.() || "tr"
                ]?.option_optional || "İsteğe Bağlı";
            requiredSpan.textContent = option.required ? requiredText : optionalText;

            metaRow.appendChild(limitSpan);
            metaRow.appendChild(requiredSpan);

            optionGroup.appendChild(metaRow);

            const choicesContainer = document.createElement("div");
            choicesContainer.className = "option-choices";
            optionGroup.appendChild(choicesContainer);

            // Alt opsiyonların gösterileceği ortak container
            const subOptionsHost = document.createElement("div");
            subOptionsHost.className = "sub-options-container";
            subOptionsHost.style.display = "none";
            optionGroup.appendChild(subOptionsHost);

            // Render option items
            option.items.forEach((item, index) => {
                const choiceLabel = this.createOptionChoice(option, item, index);
                choicesContainer.appendChild(choiceLabel);

                // Eğer bu item'in önceden yüklenmiş statik alt opsiyonu varsa, referansı sakla
                const inputEl = choiceLabel.querySelector("input");
                if (
                    inputEl &&
                    item.subOptions &&
                    Array.isArray(item.subOptions) &&
                    item.subOptions.length > 0
                ) {
                    inputEl._subOptions = item.subOptions;
                }
            });

            container.appendChild(optionGroup);
        });

        if (optionsSpinner) {
            optionsSpinner.classList.remove("loading");
        }
    }

    // Create option choice element
    createOptionChoice(option, item, index) {
        const label = document.createElement("label");
        label.className = "option-choice";

        const inputType = option.type === "radio" ? "radio" : "checkbox";
        // inputName override (özellikle "Seçim yok" için, mevcut grup ismini kullanmak üzere)
        const inputName = option.inputName || `option_${option.id}`;
        const isNoneChoice = !!(item && item.__none === true);
        const checkedAttr = ""; // default seçim yapılmasın
        const priceValue =
            item.price !== undefined && item.price !== null ? item.price : 0;
        const hasPrice = priceValue !== 0;

        const itemIdAttr = isNoneChoice
            ? ""
            : item && item.id !== undefined && item.id !== null
                ? String(item.id)
                : "";
        // Backend ve cart yapısı için orijinal option id'yi kullan (instance id değil)
        const logicalOptionId =
            option && option.originalId !== undefined && option.originalId !== null
                ? option.originalId
                : option.id;
        const optionIdAttr = String(logicalOptionId);
        const optionTitleAttr = option && option.title ? String(option.title) : "";
        const maxQtyAttr =
            item && item.maxQty !== undefined && item.maxQty !== null
                ? String(item.maxQty)
                : "";
        const subFlagAttr = isNoneChoice
            ? "0"
            : item && item.suboption !== undefined && item.suboption !== null
                ? String(item.suboption)
                : "0";

        // Checkbox options: quantity selector UI (no tick)
        if (inputType === "checkbox") {
            label.classList.add("option-choice-qty");
            label.innerHTML = `
        <input 
          type="checkbox" 
          name="${inputName}" 
          value="${this.escapeHtml(item.name)}" 
          data-price="${priceValue}"
          data-option-id="${this.escapeHtml(optionIdAttr)}"
          data-option-title="${this.escapeHtml(optionTitleAttr)}"
          data-selection-id="${this.escapeHtml(itemIdAttr)}"
          data-max-qty="${this.escapeHtml(maxQtyAttr)}"
          data-sub="${this.escapeHtml(subFlagAttr)}"
          class="option-qty-checkbox"
        >
        <div class="choice-content">
          <div class="choice-qty-left">
            <div class="choice-qty-controls" style="display:none;">
              <button type="button" class="choice-qty-btn" data-action="decrease" aria-label="decrease">-</button>
              <span class="choice-qty-value">1</span>
              <button type="button" class="choice-qty-btn" data-action="increase" aria-label="increase">+</button>
            </div>
          </div>
          <div class="choice-left">
            <span class="choice-name">${this.escapeHtml(item.name)}</span>
            ${hasPrice
                    ? `<span class="choice-price">${priceValue > 0 ? "+" : ""}${parseFloat(priceValue || 0).toFixed(2)}</span>`
                    : ""
                }
          </div>
        </div>
      `;

            // Bind qty buttons
            const checkbox = label.querySelector("input.option-qty-checkbox");
            const qtyValueEl = label.querySelector(".choice-qty-value");
            const controlsEl = label.querySelector(".choice-qty-controls");
            const decBtn = label.querySelector(
                '.choice-qty-btn[data-action="decrease"]',
            );
            const incBtn = label.querySelector(
                '.choice-qty-btn[data-action="increase"]',
            );
            const contentEl = label.querySelector(".choice-content");

            const getMax = () => {
                const raw = checkbox?.getAttribute("data-max-qty");
                const n = parseInt(raw, 10);
                // maxQty > 0 ise o değeri kullan, 0 / null / boş / geçersiz ise limitsiz (Infinity) kabul et
                return Number.isFinite(n) && n > 0 ? n : Infinity;
            };

            const setQty = (nextQty) => {
                const max = getMax();
                const clamped = Math.max(0, Math.min(max, nextQty));
                if (qtyValueEl) qtyValueEl.textContent = String(clamped);
                if (checkbox) {
                    const prevChecked = checkbox.checked;
                    checkbox.checked = clamped > 0;
                    checkbox.setAttribute("data-qty", String(clamped));
                    // Sadece checked durumu değiştiyse change event'i tetikle
                    // (0 -> 1 veya 1 -> 0). Qty artarken tekrar tekrar AJAX gitmesin.
                    if (prevChecked !== checkbox.checked) {
                        const changeEvent = new Event("change", { bubbles: true });
                        checkbox.dispatchEvent(changeEvent);
                    }
                }
                if (controlsEl) {
                    if (clamped <= 0) {
                        controlsEl.style.display = "none";
                    } else {
                        controlsEl.style.display = "inline-flex";
                    }
                }
                // update price when qty changes
                this.updatePrice();
            };

            // default qty 0 (unchecked) -> kontroller gizli, sadece satıra tıklayınca açılacak
            setQty(0);

            if (incBtn) {
                incBtn.addEventListener("click", (e) => {
                    e.preventDefault();
                    e.stopPropagation();
                    const current =
                        parseInt(checkbox?.getAttribute("data-qty") || "0", 10) || 0;
                    setQty(current + 1);
                });
            }
            if (decBtn) {
                decBtn.addEventListener("click", (e) => {
                    e.preventDefault();
                    e.stopPropagation();
                    const current =
                        parseInt(checkbox?.getAttribute("data-qty") || "0", 10) || 0;
                    setQty(current - 1);
                });
            }

            // Ana içerik alana tıklayınca da miktarı arttır (plus gibi davransın)
            if (contentEl) {
                contentEl.addEventListener("click", (e) => {
                    e.preventDefault();
                    e.stopPropagation();
                    const current =
                        parseInt(checkbox?.getAttribute("data-qty") || "0", 10) || 0;
                    setQty(current + 1);
                });
            }

            return label;
        }

        label.innerHTML = `
      <input 
        type="${inputType}" 
        name="${inputName}" 
        value="${this.escapeHtml(item.name)}" 
        data-price="${priceValue}"
        data-option-id="${this.escapeHtml(optionIdAttr)}"
        data-option-title="${this.escapeHtml(optionTitleAttr)}"
        data-selection-id="${this.escapeHtml(itemIdAttr)}"
        data-sub="${this.escapeHtml(subFlagAttr)}"
        ${isNoneChoice ? 'data-none="1"' : ""}
        ${checkedAttr}>
                <div class="choice-content">
        <span class="choice-name">${this.escapeHtml(item.name)}</span>
        ${hasPrice
                ? `<span class="choice-price">${priceValue > 0 ? "+" : ""
                }${parseFloat(priceValue || 0).toFixed(2)}</span>`
                : ""
            }
                </div>
            `;

        return label;
    }

    // Escape HTML to prevent XSS
    escapeHtml(text) {
        const map = {
            "&": "&amp;",
            "<": "&lt;",
            ">": "&gt;",
            '"': "&quot;",
            "'": "&#2B2A28;",
        };
        return text ? text.replace(/[&<>"']/g, (m) => map[m]) : "";
    }

    resetModalForm() {
        // Reset quantity
        this.currentQuantity = 1;
        if (this.modalQuantity) this.modalQuantity.textContent = "1";

        // Clear notes
        const productNotes = document.getElementById("productNotes");
        if (productNotes) productNotes.value = "";

        // Reset all option inputs - radio buttons: none checked, checkboxes: all unchecked
        const allOptionInputs = document.querySelectorAll(
            '#dynamicOptionsContainer input[type="radio"], #dynamicOptionsContainer input[type="checkbox"]',
        );
        allOptionInputs.forEach((input) => {
            // Tüm radio ve checkbox butonlarını seçili olmayan hale getir
            input.checked = false;
        });

        // Hide all sub-options containers
        const subOptionsContainers = document.querySelectorAll(
            ".sub-options-container",
        );
        subOptionsContainers.forEach((container) => {
            container.style.display = "none";
        });
    }

    async populateModalForm(cartItem) {
        // Set quantity
        this.currentQuantity = cartItem.quantity || 1;
        if (this.modalQuantity)
            this.modalQuantity.textContent = String(this.currentQuantity);

        // Set notes - clear if no notes exist
        const productNotes = document.getElementById("productNotes");
        if (productNotes) {
            if (
                cartItem.options &&
                cartItem.options.notes &&
                cartItem.options.notes.trim()
            ) {
                productNotes.value = cartItem.options.notes.trim();
            } else {
                productNotes.value = "";
            }
        }

        // Populate options from cartItem.options.selections hiyerarşik olarak
        if (!cartItem.options || !cartItem.options.selections) {
            this.updatePrice();
            return;
        }

        const container = document.getElementById("dynamicOptionsContainer");
        if (!container) {
            this.updatePrice();
            return;
        }

        // Seçimleri düz listeye çevir ve depth'e göre sırala (önce ana opsiyonlar, sonra sub'lar)
        const selectionRecords = [];

        Object.keys(cartItem.options.selections).forEach((optionKey) => {
            const list = Array.isArray(cartItem.options.selections[optionKey])
                ? cartItem.options.selections[optionKey]
                : [];

            list.forEach((sel) => {
                if (!sel) return;
                const id = sel.id ?? sel.selectionId ?? null;
                const rec = {
                    raw: sel,
                    optionKey,
                    optionId: sel.optionId || optionKey,
                    id,
                    name: sel.name || "",
                    qty: parseInt(sel.qty ?? sel.quantity ?? "1", 10) || 1,
                    isSubOption: !!sel.isSubOption,
                    parentSelectionId: sel.parentSelectionId ?? null,
                    depth: sel.depth ?? 0,
                };
                selectionRecords.push(rec);
            });
        });

        // Derinliğe göre sırala (önce ana opsiyonlar)
        selectionRecords.sort((a, b) => (a.depth || 0) - (b.depth || 0));

        const findInputForSelection = (rec) => {
            const idStr = rec.id !== null ? String(rec.id) : null;

            if (!rec.isSubOption) {
                // Ana opsiyon: doğrudan option_{id} grubunda ara
                if (idStr) {
                    return container.querySelector(
                        `input[name="option_${rec.optionId}"][data-selection-id="${idStr}"]`,
                    );
                }
                if (rec.name) {
                    return container.querySelector(
                        `input[name="option_${rec.optionId}"][value="${rec.name}"]`,
                    );
                }
                return null;
            }

            // Sub-option: selection id + parentSelectionId'ye göre bul
            const candidates = Array.from(
                container.querySelectorAll(
                    idStr
                        ? `input[data-selection-id="${idStr}"]`
                        : `input[value="${rec.name}"]`,
                ),
            );
            if (candidates.length === 0) return null;

            if (rec.parentSelectionId != null) {
                const parentKey = String(rec.parentSelectionId);
                const withParent = candidates.find((input) => {
                    const group = input.closest(".product-option-group.sub-option-group");
                    if (!group) return false;
                    const grpParent = group.getAttribute("data-parent-selection");
                    return grpParent && String(grpParent) === parentKey;
                });
                if (withParent) return withParent;
            }

            // Fallback: ilk adayı kullan
            return candidates[0];
        };

        // Seçimleri sırayla uygula, sub-option'lar için de gerekirse alt seviye aç
        for (const rec of selectionRecords) {
            const input = findInputForSelection(rec);
            if (!input) continue;

            const qty = rec.qty || 1;

            if (input.type === "radio") {
                input.checked = true;
                input.setAttribute("data-qty", String(qty));
                // Radio için alt opsiyonları ve "Seçim yok" butonunu hazırla
                await this.handleSubOptionsToggle(input);
                this.syncNoneChoiceVisibility(input);
            } else if (input.type === "checkbox") {
                input.checked = qty > 0;
                input.setAttribute("data-qty", String(qty));

                const parentChoice = input.closest(".option-choice-qty");
                const qtyEl = parentChoice
                    ? parentChoice.querySelector(".choice-qty-value")
                    : null;
                const addBtn = parentChoice
                    ? parentChoice.querySelector(".choice-qty-add")
                    : null;
                const controlsEl = parentChoice
                    ? parentChoice.querySelector(".choice-qty-controls")
                    : null;

                if (qtyEl) qtyEl.textContent = String(qty);
                if (controlsEl) {
                    if (addBtn) {
                        if (qty > 0) {
                            controlsEl.style.display = "inline-flex";
                            addBtn.style.display = "none";
                        } else {
                            controlsEl.style.display = "none";
                            addBtn.style.display = "inline-flex";
                        }
                    } else {
                        controlsEl.style.display = qty > 0 ? "inline-flex" : "none";
                    }
                }

                // Checkbox için de alt opsiyonları kontrol et (varsa)
                await this.handleSubOptionsToggle(input);
            }
        }

        this.updatePrice();
    }

    updateModalButtonText() {
        const modalAddToCartBtn = this.modalAddToCart;
        if (!modalAddToCartBtn) return;

        // Get translations
        const translations = window.I18N?.getTranslations?.();
        const lang = window.I18N?.getPreferredLanguage?.() || "tr";
        const t = (key, fallback) =>
            translations?.[lang]?.[key] !== undefined
                ? translations[lang][key]
                : fallback;

        if (this.editingCartItemId) {
            modalAddToCartBtn.textContent = t("cart_update_btn", "Güncelle");
            modalAddToCartBtn.setAttribute("data-i18n", "cart_update_btn");
        } else {
            modalAddToCartBtn.textContent = t("product_action_add", "Ekle");
            modalAddToCartBtn.setAttribute("data-i18n", "product_action_add");
        }
    }

    changeQuantity(change) {
        const newQuantity = this.currentQuantity + change;

        if (newQuantity >= 1) {
            this.currentQuantity = newQuantity;
            if (this.modalQuantity) {
                this.modalQuantity.textContent = this.currentQuantity;
            }
            this.updatePrice();
        }
    }

    updatePrice() {
        if (!this.currentProduct) return;

        let totalPrice = parseFloat(this.currentProduct.basePrice) || 0;

        // Get all checked option inputs (radio and checkbox)
        const allCheckedInputs = document.querySelectorAll(
            "#dynamicOptionsContainer input:checked",
        );

        allCheckedInputs.forEach((input) => {
            // "Seçim yok" radioları fiyat hesabına dahil etme
            if (input.dataset && input.dataset.none === "1") return;
            const price = parseFloat(input.dataset.price) || 0;
            const qty = parseInt(input.getAttribute("data-qty") || "1", 10) || 1;
            totalPrice += price * qty;
        });

        // Multiply by quantity
        const finalPrice = totalPrice * this.currentQuantity;

        // Update price display
        if (this.modalTotalPrice) {
            this.modalTotalPrice.textContent = finalPrice.toFixed(2) + "";
        }

        // Update current price display
        const modalCurrentPrice = document.getElementById("modalCurrentPrice");
        if (modalCurrentPrice) {
            const priceText = window.TahmisciCatalog
                ? this.formatTahmisciPriceLabel(this.currentProduct)
                : (this.currentProduct?.priceLabel || ("₺" + totalPrice.toFixed(2)));
            modalCurrentPrice.textContent = priceText;
            const priceWrap = modalCurrentPrice.closest(".product-modal-price");
            if (priceWrap) priceWrap.style.display = priceText ? "flex" : "none";
        }

        // Update old price if exists
        const modalOldPrice = document.getElementById("modalOldPrice");
        const modalOldPriceTop = document.getElementById("modalOldPriceTop");

        if (this.currentProduct && this.currentProduct.oldPrice) {
            if (modalOldPrice) {
                modalOldPrice.textContent =
                    (this.currentProduct.oldPrice * this.currentQuantity).toFixed(2) + "";
                modalOldPrice.style.display = "inline";
            }
            if (modalOldPriceTop) {
                modalOldPriceTop.textContent =
                    Number(this.currentProduct.oldPrice).toFixed(2) + "";
                modalOldPriceTop.style.display = "inline";
            }
        } else {
            if (modalOldPrice) {
                modalOldPrice.style.display = "none";
            }
            if (modalOldPriceTop) {
                modalOldPriceTop.style.display = "none";
            }
        }
    }

    // Validate options before adding to cart
    validateOptions() {
        const container = document.getElementById("dynamicOptionsContainer");
        if (!container) return { valid: true, error: null };

        // Sadece ana option group'ları bul (sub-option-group olmayan)
        const mainOptionGroups = container.querySelectorAll(
            ".product-option-group:not(.sub-option-group)",
        );

        // Ana opsiyonları kontrol et
        for (const group of mainOptionGroups) {
            const validationResult = this.validateOptionGroup(group);
            if (!validationResult.valid) {
                return validationResult;
            }
        }

        // Görünür sub-option group'ları kontrol et
        const visibleSubOptionGroups =
            container.querySelectorAll(".sub-option-group");
        for (const subGroup of visibleSubOptionGroups) {
            // Sub-option container'ının display:none olup olmadığını kontrol et
            const subContainer = subGroup.closest(".sub-options-container");
            if (subContainer && subContainer.style.display === "none") {
                continue; // Görünür değilse kontrol etme
            }

            const validationResult = this.validateOptionGroup(subGroup);
            if (!validationResult.valid) {
                return validationResult;
            }
        }

        return { valid: true, error: null };
    }

    // Tek bir option group'u kontrol et
    validateOptionGroup(group) {
        const optionId = group.getAttribute("data-option-id");
        if (!optionId) return { valid: true, error: null };

        // Option metadata'sını bul (required, min, max, title)
        const titleEl = group.querySelector(".option-title");
        const optionTitle = titleEl ? titleEl.textContent.trim() : "Opsiyon";

        const requiredEl = group.querySelector(".option-required");
        const isRequired = requiredEl && requiredEl.classList.contains("required");

        // min/max değerlerini data attribute'dan al
        const minValue =
            parseInt(group.getAttribute("data-option-min") || "0", 10) || 0;
        const maxValueAttr = group.getAttribute("data-option-max");
        const maxValue =
            maxValueAttr !== null ? parseInt(maxValueAttr, 10) || Infinity : Infinity;

        // Bu option için seçilen input'ları bul (sadece bu group'un direkt option-choices'ından)
        const optionChoices = group.querySelector(".option-choices");
        if (!optionChoices) return { valid: true, error: null };

        const checkedInputs = optionChoices.querySelectorAll(
            'input:checked:not([data-none="1"])',
        );

        // min/max kontrolü için: seçilen opsiyon SAYISI (radio veya checkbox'ların kendisi, qty değil)
        const selectedCount = checkedInputs.length;

        // Çok dilli mesajlar için
        const lang = window.I18N?.getPreferredLanguage?.() || "tr";
        const translations = window.I18N?.getTranslations?.()?.[lang] || {};

        // Required kontrolü: required ise en az 1 seçim olmalı
        if (isRequired && selectedCount === 0) {
            const template =
                translations.validation_required ||
                "{title} zorunludur. Lütfen seçim yapınız.";
            return {
                valid: false,
                error: template.replace("{title}", optionTitle),
            };
        }

        // min kontrolü: min değerinden az seçim yapılmışsa (ve seçim yapılmışsa)
        if (selectedCount > 0 && selectedCount < minValue) {
            const template =
                translations.validation_min_selection ||
                "{title} için en az {min} adet seçim yapmalısınız.";
            return {
                valid: false,
                error: template
                    .replace("{title}", optionTitle)
                    .replace("{min}", minValue),
            };
        }

        // max kontrolü: max değerinden fazla seçim yapılmışsa
        if (Number.isFinite(maxValue) && selectedCount > maxValue) {
            const template =
                translations.validation_max_selection ||
                "{title} için en fazla {max} adet seçebilirsiniz.";
            return {
                valid: false,
                error: template
                    .replace("{title}", optionTitle)
                    .replace("{max}", maxValue),
            };
        }

        return { valid: true, error: null };
    }

    addToCartFromModal() {
        if (!this.currentProduct) {
            return;
        }
        if (this.currentProduct.product_qr_status === "2") {
            return;
        }

        // Validasyon kontrolü
        const validation = this.validateOptions();
        if (!validation.valid) {
            if (window.Swal && typeof window.Swal.fire === "function") {
                const lang = window.I18N?.getPreferredLanguage?.() || "tr";
                const translations = window.I18N?.getTranslations?.()?.[lang] || {};
                const warningTitle = translations.warning_title || "Uyarı";
                const confirmText = translations.confirm_button || "Tamam";

                window.Swal.fire({
                    title: warningTitle,
                    text: validation.error,
                    icon: "warning",
                    confirmButtonText: confirmText,
                    confirmButtonColor: "#8C734B",
                });
            }
            return;
        }

        // Fly-to-cart animation (only for new items, not when editing)
        if (!this.editingCartItemId) {
            this.flyToCart();
        }

        // Get all selected options (dynamic)
        const allCheckedInputs = document.querySelectorAll(
            "#dynamicOptionsContainer input:checked",
        );
        const notes = document.getElementById("productNotes");

        // Calculate total price
        let totalPrice = this.currentProduct.basePrice || 0;

        // Build options object from all checked inputs
        const options = {
            notes: notes ? notes.value : "",
            selections: {},
        };
        const normalizeSelectionRef = (value) => {
            if (value === null || value === undefined) return null;
            const raw = String(value).trim();
            if (!raw || raw === "0") return null;
            if (/^-?\d+$/.test(raw)) {
                const n = parseInt(raw, 10);
                return n > 0 ? String(n) : null;
            }
            return raw;
        };

        let invalidOptionSelection = false;
        let invalidOptionMessage = "";

        // Group selections by option id and store selection ids too
        allCheckedInputs.forEach((input) => {
            // "Seçim yok" radiolarını options içine alma
            if (input.dataset && input.dataset.none === "1") {
                return;
            }
            const optionId =
                input.getAttribute("data-option-id") ||
                input.name.replace("option_", "");
            const selectionId = normalizeSelectionRef(
                input.getAttribute("data-selection-id") || null,
            );
            const optionValue = input.value;

            // Gerçek option detail ID yoksa bu seçim güvenli değil.
            // Bu alan backend'de units_type çözümü için zorunlu.
            if (!selectionId) {
                invalidOptionSelection = true;
                invalidOptionMessage = "Seçilen ürün opsiyonlarından biri eksik veya hatalı görünüyor. Lütfen ürünü tekrar seçiniz.";
                return;
            }
            const optionPrice = parseFloat(input.dataset.price) || 0;
            const optQty = parseInt(input.getAttribute("data-qty") || "1", 10) || 1;
            const optionTitle = input.getAttribute("data-option-title") || "";

            // Hiyerarşi bilgisi: bu seçim bir sub-option mı?
            let isSubOption = false;
            let parentSelectionId = null;
            let parentOptionId = null;
            let depth = 0;

            const nearestSubGroup = input.closest(
                ".product-option-group.sub-option-group",
            );
            if (nearestSubGroup) {
                isSubOption = true;
                parentSelectionId = normalizeSelectionRef(
                    nearestSubGroup.getAttribute("data-parent-selection") || null,
                );

                if (!parentSelectionId) {
                    invalidOptionSelection = true;
                    invalidOptionMessage = "Alt opsiyon bağlantısı doğrulanamadı. Lütfen ürünü tekrar seçiniz.";
                    return;
                }

                // Parent option id'yi bul (parent selection input'unun option-id'si)
                if (parentSelectionId) {
                    const parentInput = document.querySelector(
                        `#dynamicOptionsContainer input[data-selection-id="${parentSelectionId}"]`,
                    );
                    if (parentInput) {
                        parentOptionId = normalizeSelectionRef(
                            parentInput.getAttribute("data-option-id") || null,
                        );
                    }
                }

                // Derinlik (sub-option of sub-option vs.) hesapla
                let currentGroup = nearestSubGroup;
                while (
                    currentGroup &&
                    currentGroup.classList.contains("sub-option-group")
                ) {
                    depth += 1;
                    const parentSubGroup =
                        currentGroup
                            .closest(".sub-options-container")
                            ?.closest(".product-option-group.sub-option-group") || null;
                    currentGroup = parentSubGroup;
                }
            }

            totalPrice += optionPrice * optQty;

            if (!options.selections[optionId]) {
                options.selections[optionId] = [];
            }

            options.selections[optionId].push({
                id: selectionId,
                optionId: optionId,
                name: optionValue,
                price: optionPrice,
                qty: optQty,
                optionTitle: optionTitle,
                // Hiyerarşi bilgisi: ana opsiyon / sub opsiyon zinciri
                isSubOption,
                parentOptionId,
                parentSelectionId,
                depth,
            });
        });

        if (invalidOptionSelection) {
            if (window.Swal && typeof window.Swal.fire === "function") {
                const lang = window.I18N?.getPreferredLanguage?.() || "tr";
                const translations = window.I18N?.getTranslations?.()?.[lang] || {};
                const warningTitle = translations.warning_title || "Uyarı";
                const confirmText = translations.confirm_button || "Tamam";

                window.Swal.fire({
                    title: warningTitle,
                    text: invalidOptionMessage || "Ürün opsiyonları doğrulanamadı. Lütfen tekrar deneyiniz.",
                    icon: "warning",
                    confirmButtonText: confirmText,
                    confirmButtonColor: "#8C734B",
                });
            }

            return;
        }

        // Calculate unit price (NOT total price - will be multiplied by quantity in cart display)
        const unitPrice = totalPrice; // price per unit (basePrice + options with qty)

        // Save product info before adding to cart (for notification)
        const productName = this.currentProduct.name || "Ürün";
        const quantity = this.currentQuantity || 1;

        // If editing, preserve addedAt timestamp from old item
        let preserveAddedAt = null;
        if (this.editingCartItemId) {
            const cartItems = window.globalCart
                ? window.globalCart.getItems()
                : this.cart;
            const oldItem = cartItems.find(
                (item) => item.id === this.editingCartItemId,
            );
            if (oldItem && oldItem.addedAt) {
                preserveAddedAt = oldItem.addedAt;
            }
            this.removeFromCart(this.editingCartItemId);
        }

        // Add to cart (or update by removing and re-adding)
        // Preserve addedAt if editing
        if (preserveAddedAt) {
            options._preserveAddedAt = preserveAddedAt;
        }

        this.addToCart(
            this.currentProduct,
            this.currentQuantity,
            options,
            unitPrice, // Unit price, not total price
        );

        // Close modal
        this.closeProductModal();

        // Update cart counter and modal
        this.updateCartCounter();
        this.renderNewCartModal();
    }

    flyToCart() {
        if (!this.currentProduct) return;

        let startRect = null;
        let imageSrc = null;
        let initialWidth = 80;
        let initialHeight = 80;

        // Start from the "Ekle" (Add to Cart) button
        const addToCartBtn =
            this.modalAddToCart || document.getElementById("modalAddToCart");

        if (addToCartBtn) {
            startRect = addToCartBtn.getBoundingClientRect();
            // Get product image for the flying element
            const productGalleryMain = document.getElementById("productGalleryMain");
            if (productGalleryMain) {
                const productImage =
                    productGalleryMain.querySelector("img.loaded:not(.hidden)") ||
                    productGalleryMain.querySelector("img.loaded") ||
                    productGalleryMain.querySelector("img:not(.hidden)") ||
                    productGalleryMain.querySelector("img");

                if (productImage) {
                    imageSrc =
                        productImage.src ||
                        productImage.getAttribute("data-src") ||
                        productImage.getAttribute("src");
                }
            }

            // Fallback: use product image from data
            if (!imageSrc && this.currentProduct && this.currentProduct.image) {
                imageSrc = this.currentProduct.image;
            }
        }

        // If button not found, use modal center as fallback
        if (!startRect) {
            const modal = document.getElementById("productModalOverlay");
            if (modal) {
                const modalRect = modal.getBoundingClientRect();
                startRect = {
                    left: modalRect.left + modalRect.width / 2 - initialWidth / 2,
                    top: modalRect.top + modalRect.height / 2 - initialHeight / 2,
                };
            }

            // Get product image
            if (this.currentProduct && this.currentProduct.image) {
                imageSrc = this.currentProduct.image;
            }
        }

        // Ensure minimum size
        if (initialWidth < 80) initialWidth = 80;
        if (initialHeight < 60) initialHeight = 60;

        if (!imageSrc || !startRect) return;

        // Determine target button (mobile or desktop)
        const isMobile = window.innerWidth < 992;
        const targetCartBtn = isMobile
            ? document.getElementById("mobileCartBtn")
            : document.getElementById("desktopCartBtn");

        if (!targetCartBtn) return;

        // Get cart button position
        const cartRect = targetCartBtn.getBoundingClientRect();

        // Create fly element
        const flyElement = document.createElement("div");
        flyElement.className = "fly-to-cart-img";

        // Set initial styles (start from button position)
        const startX = startRect.left + startRect.width / 2;
        const startY = startRect.top + startRect.height / 2;

        flyElement.style.cssText = `
      position: fixed;
      left: ${startX - initialWidth / 2}px;
      top: ${startY - initialHeight / 2}px;
      width: ${initialWidth}px;
      height: ${initialHeight}px;
      background-image: url("${imageSrc}");
      background-size: cover;
      background-position: center;
      background-repeat: no-repeat;
      border-radius: 8px;
      transform: scale(1);
      opacity: 1;
      z-index: 99999;
      pointer-events: none !important;
      transition: none;
      box-shadow: 0 4px 12px rgba(46, 36, 24, 0.15);
      will-change: transform, opacity;
    `;

        document.body.appendChild(flyElement);

        // Force reflow
        flyElement.offsetHeight;

        // Calculate target position (center of cart button)
        // Target the exact center for both mobile and desktop
        const targetX = cartRect.left + cartRect.width / 2;
        const targetY = cartRect.top + cartRect.height / 2;

        // Animate to target
        requestAnimationFrame(() => {
            flyElement.style.transition =
                "transform 0.8s cubic-bezier(0.4, 0, 0.2, 1), opacity 0.8s ease-out";
            flyElement.style.transform = `translate3d(${targetX - startX}px, ${targetY - startY}px, 0) scale(0.2)`;
            flyElement.style.opacity = "0";
        });

        // Remove element after animation
        const removeElement = () => {
            if (flyElement.parentNode) {
                flyElement.parentNode.removeChild(flyElement);
            }
        };

        flyElement.addEventListener("transitionend", removeElement, { once: true });

        // Safety: Remove element after max duration (in case transitionend doesn't fire)
        setTimeout(removeElement, 1500); // 800ms animation + 700ms buffer
    }

    closeProductModal() {
        if (this.productModalOverlay) {
            this.productModalOverlay.classList.remove("active");
            // Swipe sonrası inline stilleri temizle (tekrar açılışta kayma kalmasın)
            this.productModalOverlay.style.opacity = "";
            const modalBox = this.productModalOverlay.querySelector(".product-modal");
            if (modalBox) modalBox.style.transform = "";
        }
        document.body.style.overflow = "";
        this.currentProduct = null;
        this.editingCartItemId = null;
        // Reset options container + spinner for next open
        const optionsContainer = document.getElementById("dynamicOptionsContainer");
        const optionsSpinner = document.getElementById("optionsLoadingSpinner");
        if (optionsContainer) {
            optionsContainer.innerHTML = "";
            if (optionsSpinner) {
                optionsSpinner.classList.add("loading");
                optionsContainer.appendChild(optionsSpinner);
            }
        } else if (optionsSpinner) {
            optionsSpinner.classList.add("loading");
        }

        // Cleanup viewport detection
        this.cleanupViewportDetection();
    }

    getBadgeText(badge) {
        const badges = {
            popular: "Popüler",
            new: "Yeni",
            discount: "%15 İndirim",
            healthy: "Sağlıklı",
            hot: "Sıcak",
            breakfast: "Kahvaltı",
        };
        return badges[badge] || "";
    }

    // ========== CART SYSTEM ==========

    addToCart(product, quantity, options, totalPrice) {
        if (!product) {
            return;
        }
        // Use global cart manager if available
        if (window.globalCart) {
            // CartSystem.generateCartItemId ile id üret
            const cartSystem =
                window.Cart || (window.CartSystem ? window.CartSystem : null);
            let id = null;
            if (cartSystem && typeof cartSystem.generateCartItemId === "function") {
                id = cartSystem.generateCartItemId(product.id, options);
            }
            // options objesine id ekle (gerekirse)
            if (id) options._cartId = id;
            window.globalCart.addToCart(product, quantity, options, totalPrice);
            try {
                var ot = localStorage.getItem("menuOrderType");
                if (ot) localStorage.setItem("lastCartOrderType", ot);
            } catch (e) { }
            // Force update cart count immediately
            if (
                window.globalCart &&
                typeof window.globalCart.updateCartCount === "function"
            ) {
                window.globalCart.updateCartCount();
            }
        } else {
            // Fallback to local cart
            // CartSystem.generateCartItemId ile id üret
            const cartSystem =
                window.Cart || (window.CartSystem ? window.CartSystem : null);
            let id = null;
            if (cartSystem && typeof cartSystem.generateCartItemId === "function") {
                id = cartSystem.generateCartItemId(product.id, options);
            }
            const cartItem = {
                id: id || product.id + "_" + Date.now(),
                productId: product.id,
                name: product.name,
                image: product.image,
                image_source: product.image_source || "product",
                quantity: quantity,
                price: totalPrice,
                options: options,
            };
            this.cart.push(cartItem);
            this.saveCart();
            this.updateCartCounter();
            this.renderNewCartModal();
        }
    }

    removeFromCart(cartItemId) {
        // Use global cart manager if available
        if (window.globalCart) {
            window.globalCart.removeFromCart(cartItemId);
            // Force update cart count immediately
            if (
                window.globalCart &&
                typeof window.globalCart.updateCartCount === "function"
            ) {
                window.globalCart.updateCartCount();
            }
            // Update modal if open
            const modalOverlay = document.getElementById("newCartModalOverlay");
            if (modalOverlay && modalOverlay.classList.contains("active")) {
                this.renderNewCartModal();
            }
            return;
        }

        // Fallback to local cart
        const initialLength = this.cart.length;
        this.cart = this.cart.filter((item) => item.id !== cartItemId);

        if (this.cart.length < initialLength) {
            this.saveCart();
            this.updateCartCounter();
            this.renderCartItems();
        }
    }

    updateCartQuantity(cartItemId, newQuantity) {
        // Use global cart manager if available
        if (window.globalCart) {
            window.globalCart.updateCartQuantity(cartItemId, newQuantity);
            // Force update cart count immediately
            if (
                window.globalCart &&
                typeof window.globalCart.updateCartCount === "function"
            ) {
                window.globalCart.updateCartCount();
            }
            // Update modal if open
            const modalOverlay = document.getElementById("newCartModalOverlay");
            if (modalOverlay && modalOverlay.classList.contains("active")) {
                this.renderNewCartModal();
            }
            return;
        }

        // Fallback to local cart
        const item = this.cart.find((item) => item.id === cartItemId);
        if (item) {
            if (newQuantity <= 0) {
                // Remove item if quantity is 0 or less
                this.removeFromCart(cartItemId);
            } else {
                item.quantity = newQuantity;
                this.saveCart();
                this.updateCartCounter();
                this.renderCartItems();
            }
        }
    }

    getCartTotal() {
        return this.cart.reduce(
            (total, item) => total + item.price * item.quantity,
            0,
        );
    }

    getCartItemCount() {
        return this.cart.reduce((count, item) => count + item.quantity, 0);
    }

    updateCartCounter() {
        // Use global cart manager if available
        if (window.globalCart) {
            // Global cart kullanıyorsa, direkt updateCartDisplay çağır (zaten mobile-cart-count'u güncelliyor)
            window.globalCart.updateCartDisplay();

            // Update desktop cart button badge
            const desktopCartBadge = document.getElementById("desktopCartBadge");
            if (desktopCartBadge) {
                const totalItems = window.globalCart.getTotalItems
                    ? window.globalCart.getTotalItems()
                    : window.globalCart.getItems
                        ? window.globalCart
                            .getItems()
                            .reduce((count, item) => count + (item.quantity || 1), 0)
                        : 0;
                desktopCartBadge.textContent = totalItems > 0 ? totalItems : "";
                desktopCartBadge.style.display = totalItems > 0 ? "flex" : "none";
            }
            return; // Global cart kullanıyorsa, local cart güncellemesine gerek yok
        }

        // Fallback to local cart counter update (only if globalCart is not available)
        const cartCountElements = document.querySelectorAll(
            ".cart-count, .mobile-cart-count, #fixedCartCount, #mobileCartCount",
        );
        const cartTotalElements = document.querySelectorAll(
            ".cart-total, .mobile-cart-total",
        );
        const itemCount = this.getCartItemCount();
        const totalAmount = this.getCartTotal();

        // Update count
        cartCountElements.forEach((element) => {
            element.textContent = itemCount;
            element.style.display = itemCount > 0 ? "flex" : "none";
        });

        // Update total amount
        cartTotalElements.forEach((element) => {
            if (totalAmount > 0) {
                element.textContent = this.formatPrice(totalAmount);
                element.style.display = "block";
            } else {
                element.style.display = "none";
            }
        });
    }

    formatPrice(amount) {
        return parseFloat(amount || 0).toFixed(2);
    }

    saveCart() {
        try {
            localStorage.setItem("yeppos_cart", JSON.stringify(this.cart));
        } catch (e) {
            // Cart save error
        }
    }

    loadCart() {
        try {
            const savedCart = localStorage.getItem("yeppos_cart");
            if (savedCart) {
                const parsedCart = JSON.parse(savedCart);

                // Clean up old cart data structure
                this.cart = parsedCart.filter((item) => {
                    if (!item.id || !item.name || !item.price) {
                        return false;
                    }

                    // Ensure options structure exists
                    if (!item.options) {
                        item.options = { size: null, extras: [], notes: "" };
                    }
                    if (!item.options.extras) {
                        item.options.extras = [];
                    }

                    return true;
                });
            } else {
                this.cart = [];
            }
        } catch (e) {
            this.cart = [];
        }
    }

    savePromo() {
        try {
            if (this.appliedPromos && this.appliedPromos.length > 0) {
                const json = JSON.stringify(this.appliedPromos);
                localStorage.setItem("yeppos_applied_promo", json);
            } else {
                localStorage.removeItem("yeppos_applied_promo");
            }
        } catch (e) {
            console.error("Promo save error:", e);
        }
    }

    loadPromo() {
        try {
            const savedPromo = localStorage.getItem("yeppos_applied_promo")
            if (savedPromo) {
                const parsed = JSON.parse(savedPromo);
                if (Array.isArray(parsed)) {
                    this.appliedPromos = parsed;
                } else if (parsed) {
                    // Eski tekli formatı da destekle
                    this.appliedPromos = [parsed];
                } else {
                    this.appliedPromos = [];
                }
            } else {
                this.appliedPromos = [];
            }
        } catch (e) {
            this.appliedPromos = [];
        }
    }

    updateDesktopCartButtonPosition() {
        const callWaiterBtn = document.getElementById("callWaiterBtn");
        const desktopCartBtn = document.querySelector(".desktop-cart-btn");

        if (!desktopCartBtn) return;

        // Always hide on mobile devices (width < 992px)
        const isMobile = window.innerWidth < 992;
        if (isMobile) {
            desktopCartBtn.style.display = "none";
            return;
        }

        // Check order type - hide button if tableMenu (Masa Menüsü) on desktop
        const orderType = localStorage.getItem("menuOrderType");
        if (orderType === "tableMenu") {
            desktopCartBtn.style.display = "none";
            return;
        }

        // Show button on desktop (non-mobile) when not tableMenu
        desktopCartBtn.style.display = "flex";

        // Check if callWaiterBtn is visible
        let isCallWaiterVisible = false;
        if (callWaiterBtn) {
            // First check inline style (most reliable for programmatic changes)
            const inlineDisplay = callWaiterBtn.style.display;
            if (inlineDisplay) {
                isCallWaiterVisible = inlineDisplay !== "none";
            } else {
                // Fallback to computed style
                const computedStyle = window.getComputedStyle(callWaiterBtn);
                isCallWaiterVisible =
                    computedStyle.display !== "none" &&
                    computedStyle.visibility !== "hidden" &&
                    callWaiterBtn.offsetParent !== null;
            }
        }

        // Set bottom position: 4.5rem if callWaiterBtn is visible, 1rem if hidden
        const bottomValue = isCallWaiterVisible ? "4.5rem" : "1rem";
        desktopCartBtn.style.bottom = bottomValue;
    }

    clearCart() {
        this.cart = [];
        this.saveCart();
        this.updateCartCounter();
        this.renderNewCartModal();
    }

    // ========== NEW CART MODAL SYSTEM ==========

    initializeNewCartModal() {
        const cartCloseBtn = document.getElementById("newCartClose");
        const cartOverlay = document.getElementById("newCartModalOverlay");
        const cartCheckoutBtn = document.getElementById("newCartCheckoutBtn");

        // Close button
        if (cartCloseBtn) {
            cartCloseBtn.addEventListener("click", () => this.closeNewCartModal());
        }

        // Overlay click to close
        if (cartOverlay) {
            cartOverlay.addEventListener("click", (e) => {
                if (e.target === cartOverlay) {
                    this.closeNewCartModal();
                }
            });
        }

        // Checkout button
        if (cartCheckoutBtn) {
            cartCheckoutBtn.addEventListener("click", () => {
                // Çift tıklamayı engelle ve loading spinner göster
                if (cartCheckoutBtn.disabled) return;

                cartCheckoutBtn.disabled = true;
                cartCheckoutBtn.classList.add("is-loading");

                // Buton metnini sakla, spinner göster
                const labelSpan = cartCheckoutBtn.querySelector("span");
                const icon = cartCheckoutBtn.querySelector("i");
                if (labelSpan) {
                    labelSpan.dataset.originalText = labelSpan.textContent || "";
                }
                if (icon) {
                    icon.style.display = "none";
                }

                // Küçük bir gecikme ile yönlendir (spinner'ı görselleştirmek için)
                setTimeout(() => {
                    window.location.href = "siparis";
                }, 100);
            });
        }

        // Initialize promo code functionality
        this.initializePromoCode();

        // Expose to window
        if (!window.menuPage) {
            window.menuPage = {};
        }
        window.menuPage.openNewCartModal = this.openNewCartModal.bind(this);
        window.menuPage.closeNewCartModal = this.closeNewCartModal.bind(this);
        window.menuPage.renderNewCartModal = this.renderNewCartModal.bind(this);
        window.menuPage.updateCartQuantity = this.updateCartQuantity.bind(this);
        window.menuPage.removeFromCart = this.removeFromCart.bind(this);

        // Listen to cart updates to refresh modal if open
        if (window.EVENTS) {
            document.addEventListener(window.EVENTS.CART_UPDATED, () => {
                const modalOverlay = document.getElementById("newCartModalOverlay");
                if (modalOverlay && modalOverlay.classList.contains("active")) {
                    this.renderNewCartModal();
                }
            });
        }
    }

    openNewCartModal() {
        const modalOverlay = document.getElementById("newCartModalOverlay");
        if (!modalOverlay) return;

        // Modalı hemen aç; içerik sonra yüklensin (çok ürün varken gecikme olmasın)
        const cartItemsContainer = document.getElementById("newCartItems");
        const loadingText = (window.I18N && window.I18N.t) ? window.I18N.t("loading") : "Yükleniyor...";
        if (cartItemsContainer) {
            cartItemsContainer.innerHTML =
                '<div class="new-cart-modal-loading"><div class="new-cart-modal-loading-spinner"></div><span>' +
                loadingText.replace(/</g, "&lt;") +
                "</span></div>";
        }
        modalOverlay.classList.add("active");
        document.body.style.overflow = "hidden";

        // İçeriği bir sonraki paint sonrası render et (modal önce görünsün)
        const self = this;
        requestAnimationFrame(function () {
            requestAnimationFrame(function () {
                self.loadPromo();
                self.renderNewCartModal();
                // Kampanya satırı async yüklendiği için sepette tekrar güncelle (fetch tamamlansın)
                setTimeout(function () {
                    self.updateCampaignSelectVisibility();
                }, 350);
            });
        });
    }

    closeNewCartModal() {
        const modalOverlay = document.getElementById("newCartModalOverlay");
        if (!modalOverlay) return;

        modalOverlay.classList.remove("active");
        modalOverlay.style.opacity = "";
        const newCartBox = modalOverlay.querySelector(".new-cart-modal");
        if (newCartBox) newCartBox.style.transform = "";

        // Sadece başka modal yoksa scroll'u aç
        const productModal = document.querySelector(".product-modal-overlay");
        if (!productModal || !productModal.classList.contains("active")) {
            document.body.style.overflow = "";
        }
    }

    openOrdersModal() {
        // Helper function to check recent orders
        function hasRecentOrders(hours = 8) {
            try {
                const saved = localStorage.getItem("user_orders");
                const orders = saved ? JSON.parse(saved) : [];
                const now = Date.now();
                const hoursInMs = hours * 60 * 60 * 1000;
                return orders.some((order) => {
                    const orderTime =
                        order.timestamp || new Date(order.time).getTime() || now;
                    return now - orderTime < hoursInMs;
                });
            } catch (e) {
                return false;
            }
        }

        // Helper to load orders
        function loadOrdersFromHistory() {
            try {
                const saved = localStorage.getItem("user_orders");
                return saved ? JSON.parse(saved) : [];
            } catch (e) {
                return [];
            }
        }

        // Helper to delete order
        function deleteOrderFromHistory(orderId) {
            try {
                const orders = loadOrdersFromHistory();
                const filtered = orders.filter((o) => o.id !== orderId);
                localStorage.setItem("user_orders", JSON.stringify(filtered));
                return true;
            } catch (e) {
                return false;
            }
        }

        const orders = loadOrdersFromHistory();
        const translations = window.I18N?.getTranslations?.();
        const lang = window.I18N?.getPreferredLanguage?.() || "tr";
        const t = (key, fallback) =>
            translations?.[lang]?.[key] !== undefined
                ? translations[lang][key]
                : fallback;

        // Create or get modal
        let ordersModal = document.getElementById("ordersHistoryModal");
        if (!ordersModal) {
            ordersModal = document.createElement("div");
            ordersModal.id = "ordersHistoryModal";
            ordersModal.className = "orders-history-modal-overlay";
            document.body.appendChild(ordersModal);
        }

        // Sort orders by timestamp (newest first)
        const sortedOrders = [...orders].sort((a, b) => {
            const timeA = a.timestamp || new Date(a.time).getTime() || 0;
            const timeB = b.timestamp || new Date(b.time).getTime() || 0;
            return timeB - timeA;
        });

        let ordersHTML = `
      <div class="orders-history-modal">
        <button type="button" class="orders-history-close" id="ordersHistoryClose">
          <i class="fas fa-times"></i>
        </button>
        <div class="orders-history-header">
          <h2>${t("prev_orders_title", "Sipariş Geçmişi")}</h2>
        </div>
        <div class="orders-history-content" id="ordersHistoryContent">
    `;

        if (sortedOrders.length === 0) {
            ordersHTML += `
        <div class="orders-empty">
          <i class="fas fa-inbox"></i>
          <p>${t("prev_orders_empty", "Henüz sipariş geçmişiniz bulunmamaktadır.")}</p>
        </div>
      `;
        } else {
            sortedOrders.forEach((order, index) => {
                const itemsCount = order.items
                    ? order.items.reduce((sum, item) => sum + (item.quantity || 1), 0)
                    : 0;
                const orderDate = order.time
                    ? new Date(order.time).toLocaleString("tr-TR")
                    : order.timestamp
                        ? new Date(order.timestamp).toLocaleString("tr-TR")
                        : "-";

                // Format order items
                let itemsHTML = "";
                if (order.items && order.items.length > 0) {
                    order.items.forEach((item) => {
                        const itemTotal = (item.price || 0) * (item.quantity || 1);
                        const itemOptions = item.options || {};

                        // Opsiyonları new-cart-item-options-list görünümü ile yaz
                        let optionsHTML = "";
                        const optionLines = [];

                        if (
                            itemOptions.selections &&
                            typeof itemOptions.selections === "object"
                        ) {
                            const selectionRecords = [];

                            Object.keys(itemOptions.selections).forEach((optionKey) => {
                                const list = Array.isArray(itemOptions.selections[optionKey])
                                    ? itemOptions.selections[optionKey]
                                    : [];

                                list.forEach((sel) => {
                                    if (!sel) return;
                                    const id = sel.id ?? sel.selectionId ?? null;
                                    selectionRecords.push({
                                        raw: sel,
                                        optionKey,
                                        optionId: sel.optionId || optionKey,
                                        id,
                                        name: sel.name || "",
                                        qty: parseInt(sel.qty ?? sel.quantity ?? "1", 10) || 1,
                                        isSubOption: !!sel.isSubOption,
                                        parentSelectionId: sel.parentSelectionId ?? null,
                                        depth: sel.depth ?? 0,
                                    });
                                });
                            });

                            // Derinliğe göre sırala
                            selectionRecords.sort((a, b) => (a.depth || 0) - (b.depth || 0));

                            const nodesById = {};
                            const rootNodes = [];

                            selectionRecords.forEach((rec) => {
                                const node = { rec, children: [] };
                                const idStr = rec.id !== null ? String(rec.id) : null;
                                if (idStr) {
                                    nodesById[idStr] = node;
                                } else {
                                    rootNodes.push(node);
                                }
                            });

                            // Parent-child ilişkilerini kur
                            Object.values(nodesById).forEach((node) => {
                                const rec = node.rec;
                                const parentSelId = rec.parentSelectionId ?? null;
                                if (
                                    rec.isSubOption &&
                                    parentSelId !== null &&
                                    nodesById[String(parentSelId)]
                                ) {
                                    nodesById[String(parentSelId)].children.push(node);
                                } else {
                                    rootNodes.push(node);
                                }
                            });

                            const resolveOptionTitle = (node) => {
                                const sel = node.rec.raw || {};
                                const optionKey = node.rec.optionKey;
                                let optionTitle = sel.optionTitle || optionKey;

                                if (optionTitle === optionKey) {
                                    const optionKeyLower = String(optionKey).toLowerCase();
                                    if (
                                        optionKeyLower.includes("size") ||
                                        optionKeyLower.includes("boyut")
                                    ) {
                                        optionTitle = "Boyut Seçimi";
                                    } else if (
                                        optionKeyLower.includes("extra") ||
                                        optionKeyLower.includes("ekstra") ||
                                        optionKeyLower.includes("malzeme")
                                    ) {
                                        optionTitle = "Ek Malzemeler";
                                    } else if (
                                        optionKeyLower.includes("sos") ||
                                        optionKeyLower.includes("sauce")
                                    ) {
                                        optionTitle = "Soslar";
                                    }
                                }

                                return optionTitle;
                            };

                            const renderNode = (node, level = 0) => {
                                const rec = node.rec;
                                const sel = rec.raw || {};
                                const name = rec.name || "";
                                if (!name) return;

                                const qty = rec.qty || 1;
                                const qtyPrefix = qty > 1 ? `${qty}x ` : "";
                                const optionTitle = resolveOptionTitle(node);

                                const depthClass = `depth-${Math.min(level, 3)}`;
                                if (optionTitle && optionTitle !== name) {
                                    optionLines.push(
                                        `<div class="cart-option-line ${depthClass}"><span class="cart-option-line-label">${qtyPrefix}${name}</span><small class="cart-option-label-extra">(${optionTitle})</small></div>`,
                                    );
                                } else {
                                    optionLines.push(
                                        `<div class="cart-option-line ${depthClass}">${qtyPrefix}${name}</div>`,
                                    );
                                }

                                if (Array.isArray(node.children) && node.children.length > 0) {
                                    node.children.forEach((child) =>
                                        renderNode(child, level + 1),
                                    );
                                }
                            };

                            rootNodes.forEach((node) => renderNode(node, 0));
                        }

                        // Eski format fallback
                        if (optionLines.length === 0) {
                            if (itemOptions.size) {
                                const sizeText =
                                    typeof itemOptions.size === "object"
                                        ? itemOptions.size.name || itemOptions.size
                                        : itemOptions.size;
                                if (sizeText) {
                                    optionLines.push(
                                        `<div class="cart-option-line depth-0">Boyut Seçimi: ${sizeText}</div>`,
                                    );
                                }
                            }
                            if (
                                itemOptions.extras &&
                                Array.isArray(itemOptions.extras) &&
                                itemOptions.extras.length > 0
                            ) {
                                const extrasText = itemOptions.extras
                                    .map((e) => (typeof e === "object" ? e.name || "" : e))
                                    .filter((e) => e)
                                    .join(", ");
                                if (extrasText) {
                                    optionLines.push(
                                        `<div class="cart-option-line depth-0">Ek Malzemeler: ${extrasText}</div>`,
                                    );
                                }
                            }
                        }

                        if (optionLines.length > 0) {
                            optionsHTML = `<div class="new-cart-item-options-list">${optionLines.join(
                                "",
                            )}</div>`;
                        }

                        const notesHTML =
                            itemOptions.notes && itemOptions.notes.trim()
                                ? `<p class="order-history-item-product-notes"><i class="fas fa-sticky-note"></i> ${itemOptions.notes.trim()}</p>`
                                : "";

                        itemsHTML += `
              <div class="order-history-item-product">
                <div class="order-history-item-product-info">
                  <h4>${item.name || ""} <span class="order-history-item-quantity">x${item.quantity || 1}</span></h4>
                  ${optionsHTML || ""}
                  ${notesHTML}
                </div>
                <div class="order-history-item-product-price">${itemTotal.toFixed(2)}</div>
              </div>
            `;
                    });
                }

                ordersHTML += `
          <div class="order-history-item" data-order-id="${order.id}">
            <div class="order-history-header-item">
              <div class="order-history-info">
                <h3>${t("order_info_order_code", "Sipariş Kodu")}: <strong>${order.code || order.id}</strong></h3>
                <p>${itemsCount} ${t("prev_orders_items", "ürün")} • ${orderDate}</p>
              </div>
              <div class="order-history-actions">
                <button type="button" class="order-history-toggle-items" data-order-index="${index}">
                  <i class="fas fa-chevron-down"></i>
                  <span>${t("prev_orders_show_items", "Ürünleri Gör")}</span>
                </button>
                <button type="button" class="order-history-delete" data-order-id="${order.id}">
                  <i class="fas fa-trash"></i>
                </button>
              </div>
            </div>
            <div class="order-history-items-container" id="orderItems${index}" style="display: none;">
              <div class="order-history-items-list">
                ${itemsHTML}
              </div>
            </div>
            <div class="order-history-details">
              <div class="order-history-total">
                <span>${t("order_summary_total", "Sipariş tutarı")}:</span>
                <strong>${(order.totals?.total || 0).toFixed(2)}</strong>
              </div>
            </div>
          </div>
        `;
            });
        }

        ordersHTML += `
        </div>
      </div>
    `;

        ordersModal.innerHTML = ordersHTML;
        ordersModal.classList.add("active");
        document.body.style.overflow = "hidden";

        // Close button
        const closeBtn = document.getElementById("ordersHistoryClose");
        if (closeBtn) {
            closeBtn.addEventListener("click", () => {
                ordersModal.classList.remove("active");
                document.body.style.overflow = "";
            });
        }

        // Toggle items buttons
        document.querySelectorAll(".order-history-toggle-items").forEach((btn) => {
            btn.addEventListener("click", (e) => {
                e.preventDefault();
                e.stopPropagation();
                const orderIndex = btn.getAttribute("data-order-index");
                const itemsContainer = document.getElementById(
                    `orderItems${orderIndex}`,
                );
                const icon = btn.querySelector("i");
                const span = btn.querySelector("span");

                if (itemsContainer) {
                    const isHidden =
                        itemsContainer.style.display === "none" ||
                        !itemsContainer.style.display;
                    itemsContainer.style.display = isHidden ? "block" : "none";

                    if (icon) {
                        if (isHidden) {
                            icon.classList.remove("fa-chevron-down");
                            icon.classList.add("fa-chevron-up");
                        } else {
                            icon.classList.remove("fa-chevron-up");
                            icon.classList.add("fa-chevron-down");
                        }
                    }

                    if (span) {
                        span.textContent = isHidden
                            ? t("prev_orders_hide_items", "Ürünleri Gizle")
                            : t("prev_orders_show_items", "Ürünleri Gör");
                    }
                }
            });
        });

        // Delete buttons
        document.querySelectorAll(".order-history-delete").forEach((btn) => {
            btn.addEventListener("click", async (e) => {
                const orderId = e.currentTarget.getAttribute("data-order-id");
                const confirmed = await window.Swal.fire({
                    title: t("order_delete_confirm_title", "Siparişi Sil"),
                    text: t(
                        "order_delete_confirm_message",
                        "Bu siparişi silmek istediğinize emin misiniz?",
                    ),
                    icon: "warning",
                    showCancelButton: true,
                    confirmButtonText: t("order_delete_confirm", "Evet, Sil"),
                    cancelButtonText: t("cancel", "İptal"),
                    confirmButtonColor: "#8C734B",
                    cancelButtonColor: "#8C734B",
                });

                if (confirmed.isConfirmed) {
                    const success = deleteOrderFromHistory(orderId);
                    if (success) {
                        await window.Swal.fire({
                            title: t("order_deleted_title", "Silindi"),
                            text: t("order_deleted_message", "Sipariş başarıyla silindi."),
                            icon: "success",
                            timer: 2000,
                            timerProgressBar: true,
                            toast: true,
                            position: "top-end",
                            showConfirmButton: false,
                        });
                        // Refresh modal
                        this.openOrdersModal();
                    }
                }
            });
        });
    }

    renderNewCartModal() {
        // Promoları her render'da localStorage'dan yeniden yükle (sayfa yenilemeden senkron)
        this.loadPromo();
        // Kampanyayı her render'da localStorage'dan yeniden yükle
        this.loadSelectedCampaign();
        const cartItems = window.globalCart
            ? window.globalCart.getItems()
            : this.cart;
        const cartItemsContainer = document.getElementById("newCartItems");
        const cartEmpty = document.getElementById("newCartEmpty");
        const cartSummary = document.getElementById("newCartSummary");
        const cartFooter = document.getElementById("newCartFooter");

        if (!cartItemsContainer) return;

        // Calculate total items count to check if cart is empty
        const totalItems =
            window.globalCart && typeof window.globalCart.getTotalItems === "function"
                ? window.globalCart.getTotalItems()
                : cartItems
                    ? cartItems.reduce((sum, item) => sum + (item.quantity || 1), 0)
                    : 0;

        if (!cartItems || cartItems.length === 0 || totalItems === 0) {
            // Empty state
            // Get translations for multilingual support (define early for use in button)
            const translations = window.I18N?.getTranslations?.();
            const lang = window.I18N?.getPreferredLanguage?.() || "tr";
            const t = (key, fallback) =>
                translations?.[lang]?.[key] !== undefined
                    ? translations[lang][key]
                    : fallback;

            const cartTitleEl = document.querySelector(".new-cart-title");
            if (cartTitleEl) {
                cartTitleEl.textContent = t("cart_title", "Sepetim");
            }
            if (cartEmpty) cartEmpty.style.display = "block";
            if (cartItemsContainer) cartItemsContainer.innerHTML = "";
            if (cartSummary) cartSummary.style.display = "none";
            if (cartFooter) {
                cartFooter.style.display = "none";
                cartFooter.style.setProperty("display", "none", "important");
            }

            // Helper function to check recent orders
            function hasRecentOrders(hours = 8) {
                try {
                    const saved = localStorage.getItem("user_orders");
                    const orders = saved ? JSON.parse(saved) : [];
                    const now = Date.now();
                    const hoursInMs = hours * 60 * 60 * 1000;
                    return orders.some((order) => {
                        const orderTime =
                            order.timestamp || new Date(order.time).getTime() || now;
                        return now - orderTime < hoursInMs;
                    });
                } catch (e) {
                    return false;
                }
            }

            // Check if there are recent orders (within last 8 hours)
            if (hasRecentOrders(8)) {
                // Show "Previous Orders" button
                let prevOrdersBtn = document.getElementById("prevOrdersBtn");
                if (!prevOrdersBtn) {
                    prevOrdersBtn = document.createElement("button");
                    prevOrdersBtn.id = "prevOrdersBtn";
                    prevOrdersBtn.className = "prev-orders-btn";
                    prevOrdersBtn.innerHTML = `<i class="fas fa-history"></i><span>${t("prev_orders_btn", "Daha Önceki Siparişler")}</span>`;
                    prevOrdersBtn.addEventListener("click", () => {
                        this.closeNewCartModal();
                        this.openOrdersModal();
                    });
                    const cartContent = document.querySelector(".new-cart-content");
                    if (cartContent) {
                        cartContent.appendChild(prevOrdersBtn);
                    }
                }
                prevOrdersBtn.style.display = "flex";
            } else {
                const prevOrdersBtn = document.getElementById("prevOrdersBtn");
                if (prevOrdersBtn) {
                    prevOrdersBtn.style.display = "none";
                }
            }

            this.updateCampaignSelectVisibility();
            return;
        }

        // Hide empty state
        if (cartEmpty) cartEmpty.style.display = "none";
        if (cartSummary) cartSummary.style.display = "flex";
        if (cartFooter) cartFooter.style.display = "block";

        // Show/hide previous orders button based on recent orders
        // Helper function to check recent orders
        function hasRecentOrders(hours = 8) {
            try {
                const saved = localStorage.getItem("user_orders");
                const orders = saved ? JSON.parse(saved) : [];
                const now = Date.now();
                const hoursInMs = hours * 60 * 60 * 1000;
                return orders.some((order) => {
                    const orderTime =
                        order.timestamp || new Date(order.time).getTime() || now;
                    return now - orderTime < hoursInMs;
                });
            } catch (e) {
                return false;
            }
        }

        // Show "Previous Orders" button if there are recent orders (when cart has items)
        if (hasRecentOrders(8)) {
            let prevOrdersBtn = document.getElementById("prevOrdersBtn");
            if (!prevOrdersBtn) {
                prevOrdersBtn = document.createElement("button");
                prevOrdersBtn.id = "prevOrdersBtn";
                prevOrdersBtn.className = "prev-orders-btn";

                const translations = window.I18N?.getTranslations?.();
                const lang = window.I18N?.getPreferredLanguage?.() || "tr";
                const t = (key, fallback) =>
                    translations?.[lang]?.[key] !== undefined
                        ? translations[lang][key]
                        : fallback;

                prevOrdersBtn.innerHTML = `<i class="fas fa-history"></i><span>${t("prev_orders_btn", "Daha Önceki Siparişler")}</span>`;
                prevOrdersBtn.addEventListener("click", () => {
                    this.closeNewCartModal();
                    this.openOrdersModal();
                });
                // Add button to summary section
                if (cartSummary) {
                    cartSummary.appendChild(prevOrdersBtn);
                } else {
                    const cartContent = document.querySelector(".new-cart-content");
                    if (cartContent) {
                        cartContent.appendChild(prevOrdersBtn);
                    }
                }
            }
            prevOrdersBtn.style.display = "flex";
        } else {
            const prevOrdersBtn = document.getElementById("prevOrdersBtn");
            if (prevOrdersBtn) {
                prevOrdersBtn.style.display = "none";
            }
        }

        // Promo input her zaman görünür, birden fazla promosyon eklenebilsin
        const promoRow = document.querySelector(".promo-row");
        const promoInput = document.getElementById("promoCodeInput");
        const applyBtn = document.getElementById("applyPromoBtn");
        const errorMessage = document.getElementById("promoErrorMessage");
        if (promoRow) promoRow.style.display = "flex";
        if (promoInput) {
            promoInput.disabled = false;
            promoInput.style.backgroundColor = "#FAF8F2";
            if (promoInput.value.trim().length > 0 && applyBtn) {
                applyBtn.style.display = "block";
            } else if (applyBtn) {
                applyBtn.style.display = "none";
            }
        }
        if (errorMessage) errorMessage.style.display = "none";

        // Render items - sort by addedAt (newest first) or by ID to maintain order
        cartItemsContainer.innerHTML = "";
        let itemsTotal = 0;
        let itemsCount = 0;

        // Sort items: newest first (by addedAt) or by ID to maintain insertion order
        const sortedItems = [...cartItems].sort((a, b) => {
            // If both have addedAt, sort by date (newest first - en yeni en başta)
            if (a.addedAt && b.addedAt) {
                return new Date(b.addedAt).getTime() - new Date(a.addedAt).getTime();
            }
            // If only one has addedAt, prioritize it (newer items first)
            if (a.addedAt && !b.addedAt) return -1;
            if (!a.addedAt && b.addedAt) return 1;
            // If neither has addedAt, maintain original order
            return 0;
        });

        sortedItems.forEach((item) => {
            itemsTotal += (item.price || 0) * (item.quantity || 1);
            itemsCount += item.quantity || 1;

            const itemDiv = document.createElement("div");
            itemDiv.className = "new-cart-item";
            itemDiv.style.position = "relative";
            itemDiv.setAttribute("data-item-id", item.id);

            // Get product info first (needed for option titles)
            const productId = item.productId || item.id;
            const product = this.products.find((p) => p.id === productId);

            // Format options text - list format (option name + selections)
            let optionsHTML = "";
            let notesHTML = "";
            if (item.options) {
                const optionLines = [];

                // Yeni yapı: selections + hiyerarşi (isSubOption, parentSelectionId, depth, ...)
                if (
                    item.options.selections &&
                    typeof item.options.selections === "object"
                ) {
                    const selectionNodesById = {};
                    const rootNodes = [];

                    // Tüm seçimleri tek listeye topla ve node haritası oluştur
                    Object.keys(item.options.selections).forEach((optionKey) => {
                        const list = Array.isArray(item.options.selections[optionKey])
                            ? item.options.selections[optionKey]
                            : [];

                        list.forEach((sel) => {
                            if (!sel) return;
                            const selId = sel.id ?? sel.selectionId ?? null;
                            const node = {
                                sel,
                                optionKey,
                                children: [],
                            };
                            if (selId !== null) {
                                selectionNodesById[String(selId)] = node;
                            } else {
                                // id yoksa doğrudan root kabul et
                                rootNodes.push(node);
                            }
                        });
                    });

                    // Parent-child ilişkilerini kur
                    Object.values(selectionNodesById).forEach((node) => {
                        const sel = node.sel || {};
                        const parentSelId = sel.parentSelectionId ?? null;
                        if (
                            sel.isSubOption &&
                            parentSelId !== null &&
                            selectionNodesById[String(parentSelId)]
                        ) {
                            selectionNodesById[String(parentSelId)].children.push(node);
                        } else {
                            // Ana opsiyon
                            rootNodes.push(node);
                        }
                    });

                    // Option title bulucu (mevcut mantığı koru)
                    const resolveOptionTitle = (node) => {
                        const sel = node.sel || {};
                        const optionKey = node.optionKey;
                        let optionTitle = sel.optionTitle || optionKey;

                        if (product && product.options && Array.isArray(product.options)) {
                            const option = product.options.find(
                                (opt) =>
                                    String(opt.id) === String(sel.optionId || optionKey) ||
                                    opt.name === optionKey ||
                                    (opt.title &&
                                        opt.title.toLowerCase().replace(/\s+/g, "") ===
                                        String(optionKey).toLowerCase().replace(/\s+/g, "")),
                            );
                            if (option && option.title) {
                                optionTitle = option.title;
                            }
                        }

                        if (optionTitle === optionKey) {
                            const optionKeyLower = String(optionKey).toLowerCase();
                            if (
                                optionKeyLower.includes("size") ||
                                optionKeyLower.includes("boyut")
                            ) {
                                optionTitle = "Boyut Seçimi";
                            } else if (
                                optionKeyLower.includes("extra") ||
                                optionKeyLower.includes("ekstra") ||
                                optionKeyLower.includes("malzeme")
                            ) {
                                optionTitle = "Ek Malzemeler";
                            } else if (
                                optionKeyLower.includes("sos") ||
                                optionKeyLower.includes("sauce")
                            ) {
                                optionTitle = "Soslar";
                            }
                        }

                        return optionTitle;
                    };

                    // Ağaç yapısını satırlara dök
                    const renderNode = (node, level = 0) => {
                        const sel = node.sel || {};
                        const name = sel.name || "";
                        if (!name) return;

                        const qty = parseInt(sel.qty || "0", 10) || 0;
                        const qtyPrefix = qty > 1 ? `${qty}x ` : "";
                        const optionTitle = resolveOptionTitle(node);

                        // Satır metni: "2x Acı Sos (Ek Malzemeler)" gibi (parantez içi küçük)
                        const depthClass = `depth-${Math.min(level, 3)}`;
                        if (optionTitle && optionTitle !== name) {
                            optionLines.push(
                                `<div class="cart-option-line ${depthClass}"><span class="cart-option-line-label">${qtyPrefix}${name}</span><small class="cart-option-label-extra">(${optionTitle})</small></div>`,
                            );
                        } else {
                            optionLines.push(
                                `<div class="cart-option-line ${depthClass}">${qtyPrefix}${name}</div>`,
                            );
                        }

                        if (Array.isArray(node.children) && node.children.length > 0) {
                            node.children.forEach((child) => renderNode(child, level + 1));
                        }
                    };

                    // Root node'ları render et
                    rootNodes.forEach((node) => renderNode(node, 0));
                }

                // Eski format için fallback (size + extras), eğer hiç satır üretilmediyse
                if (optionLines.length === 0) {
                    if (item.options.size) {
                        const sizeText =
                            typeof item.options.size === "object"
                                ? item.options.size.name || item.options.size
                                : item.options.size;
                        if (sizeText) {
                            optionLines.push(
                                `<div class="cart-option-line depth-0">Boyut Seçimi: ${sizeText}</div>`,
                            );
                        }
                    }
                    if (
                        item.options.extras &&
                        Array.isArray(item.options.extras) &&
                        item.options.extras.length > 0
                    ) {
                        const extrasText = item.options.extras
                            .map((e) => (typeof e === "object" ? e.name || "" : e))
                            .filter((e) => e)
                            .join(", ");
                        if (extrasText) {
                            optionLines.push(
                                `<div class="cart-option-line depth-0">Ek Malzemeler: ${extrasText}</div>`,
                            );
                        }
                    }
                }

                if (optionLines.length > 0) {
                    optionsHTML = `<div class="new-cart-item-options-list">${optionLines.join(
                        "",
                    )}</div>`;
                }

                // Show notes if available
                if (item.options.notes && item.options.notes.trim()) {
                    notesHTML = `<div class="new-cart-item-notes">
                        <i class="fas fa-sticky-note"></i>
                        <span>${item.options.notes.trim()}</span>
                    </div>`;
                }
            }

            const itemPrice = (item.price || 0) * (item.quantity || 1);
            const basePrice = item.basePrice || item.price || 0;
            // Get oldPrice from product or item
            const productOldPrice =
                product && product.oldPrice ? product.oldPrice : null;
            const itemOldPrice = item.oldPrice || null;
            const oldPrice = itemOldPrice || productOldPrice;
            // Calculate old total price if oldPrice exists
            const oldTotalPrice = oldPrice ? oldPrice * (item.quantity || 1) : null;
            const hasDiscount = oldTotalPrice && oldTotalPrice > itemPrice;

            // Get translations for multilingual support
            const translations = window.I18N?.getTranslations?.();
            const lang = window.I18N?.getPreferredLanguage?.() || "tr";
            const t = (key, fallback) =>
                translations?.[lang]?.[key] !== undefined
                    ? translations[lang][key]
                    : fallback;

            itemDiv.innerHTML = `
                <div class="new-cart-item-image">
                    <div class="image-loading-spinner">
                        <div class="spinner"></div>
                    </div>
                    <img src="" alt="${item.name || ""}" class="lazy-image${isLogoFallbackSource(item.image_source) ? " logo-fallback-image" : ""}" data-src="${item.image || ""}">
                </div>
                <div class="new-cart-item-content">
                    <h4 class="new-cart-item-name">${item.name || ""}</h4>
                    <div class="new-cart-item-details">
                        ${optionsHTML || ""}
                        ${notesHTML || ""}
                    </div>
                    <div class="new-cart-item-price-row">
                        <div class="new-cart-item-price">
                            ${itemPrice.toFixed(2)}                            ${hasDiscount ? `<span class="new-cart-item-old-price">${oldTotalPrice.toFixed(2)}</span>` : ""}
                        </div>
                        <div class="new-cart-item-actions">
                            <button type="button" class="new-cart-item-change-btn" data-item-id="${item.id}" data-product-id="${productId}">
                                ${t("cart_change_btn", "Değiştir")}
                            </button>
                            <div class="new-cart-item-quantity">
                                <button type="button" class="new-cart-item-quantity-btn" data-action="decrease" data-item-id="${item.id}">
                                    <i class="fas fa-minus"></i>
                                </button>
                                <span class="new-cart-item-quantity-value">${item.quantity || 1}</span>
                                <button type="button" class="new-cart-item-quantity-btn" data-action="increase" data-item-id="${item.id}">
                                    <i class="fas fa-plus"></i>
                                </button>
                            </div>
                        </div>
                    </div>
                </div>
                <button type="button" class="new-cart-item-remove" data-item-id="${item.id}">
                    <i class="fas fa-times"></i>
                </button>
            `;

            cartItemsContainer.appendChild(itemDiv);

            // Add event listeners for change, quantity and remove buttons
            const changeBtn = itemDiv.querySelector(".new-cart-item-change-btn");
            const decreaseBtn = itemDiv.querySelector('[data-action="decrease"]');
            const increaseBtn = itemDiv.querySelector('[data-action="increase"]');
            const removeBtn = itemDiv.querySelector(".new-cart-item-remove");

            if (changeBtn) {
                changeBtn.addEventListener("click", () => {
                    const cartItemId = changeBtn.getAttribute("data-item-id");
                    const productId = changeBtn.getAttribute("data-product-id");
                    if (
                        window.menuPage &&
                        window.menuPage.openProductModal &&
                        cartItemId &&
                        productId
                    ) {
                        // Don't close cart modal, just open product modal with cart item
                        window.menuPage.openProductModal(parseInt(productId), cartItemId);
                    }
                });
            }

            if (decreaseBtn) {
                decreaseBtn.addEventListener("click", () => {
                    const currentQty = item.quantity || 1;
                    if (window.menuPage && window.menuPage.updateCartQuantity) {
                        window.menuPage.updateCartQuantity(item.id, currentQty - 1);
                    }
                });
            }

            if (increaseBtn) {
                increaseBtn.addEventListener("click", () => {
                    const currentQty = item.quantity || 1;
                    if (window.menuPage && window.menuPage.updateCartQuantity) {
                        window.menuPage.updateCartQuantity(item.id, currentQty + 1);
                    }
                });
            }

            if (removeBtn) {
                removeBtn.addEventListener("click", () => {
                    if (window.menuPage && window.menuPage.removeFromCart) {
                        window.menuPage.removeFromCart(item.id);
                    }
                });
            }

            // Load image with spinner (similar to product modal)
            const itemImage = itemDiv.querySelector(".new-cart-item-image img");
            const itemSpinner = itemDiv.querySelector(
                ".new-cart-item-image .image-loading-spinner",
            );
            const imageSrc = itemImage ? itemImage.getAttribute("data-src") : null;

            if (imageSrc && itemImage && itemSpinner) {
                // Show spinner
                itemSpinner.style.display = "flex";
                itemImage.classList.add("lazy-image");

                // Load image
                const tempImg = new Image();

                tempImg.onload = () => {
                    itemImage.src = imageSrc;
                    itemImage.classList.add("loaded");
                    itemImage.classList.remove("lazy-image");
                    itemSpinner.style.display = "none";
                };

                tempImg.onerror = () => {
                    itemSpinner.style.display = "none";
                    itemImage.src = "/assets/brand/logo-large.png";
                    itemImage.classList.remove("lazy-image");
                };

                tempImg.src = imageSrc;
            } else if (itemSpinner) {
                itemSpinner.style.display = "none";
            }
        });

        // Update cart title with item count
        const cartTitleEl = document.querySelector(".new-cart-title");
        if (cartTitleEl) {
            // Get translations for multilingual support
            const translations = window.I18N?.getTranslations?.();
            const lang = window.I18N?.getPreferredLanguage?.() || "tr";
            const t = (key, fallback) =>
                translations?.[lang]?.[key] !== undefined
                    ? translations[lang][key]
                    : fallback;

            const cartTitleText = t("cart_title", "Sepetim");
            cartTitleEl.textContent = `${cartTitleText} (${itemsCount})`;
        }

        // Update totals with promo discount
        this.updateCartTotals(itemsTotal, itemsCount);
        // Kampanya motorunu güncelle; sonuç gelince toplamları yeniden çiz
        if (itemsTotal > 0 && itemsCount > 0) {
            this.loadPromotionEngineState().then(() => this.updateCartTotals(itemsTotal, itemsCount));
        }
        // Kampanya butonu görünürlüğünü güncelle
        this.updateCampaignSelectVisibility();
    }

    // ========== PROMO CODE SYSTEM ==========

    // Kampanya motorundan kupon uyumluluk bilgisini al
    async loadPromotionEngineState(options) {
        if (isTahmisciBackendCatalogMode()) {
            this.selectedCampaignValidation = null;
            this.appliedCampaigns = [];
            this.engineCampaignDiscountCents = 0;
            this.freeItems = [];
            this.appliedPromotions = [];
            this.couponAllowed = false;
            this.couponBlockReason = '';
            return;
        }
        try {
            const orderType = localStorage.getItem("menuOrderType") || "tableOrder";
            // Geçmiş siparişleri localStorage’dan al (birikimli kampanya için)
            const companyId = parseInt(localStorage.getItem("menuBranchId") || localStorage.getItem("menuCompanyId") || "0", 10) || 0;
            const cartItems = window.globalCart ? (window.globalCart.getItems && window.globalCart.getItems()) : (this.cart || []);
            const list = Array.isArray(cartItems) ? cartItems : [];
            const items = list.map((item) => ({
                productId: item.productId || item.id || 0,
                categoryId: item.categoryId || item.category_id || 0,
                quantity: Number(item.quantity) || 1,
                unitPrice: item.price != null ? item.price : (item.unitPrice != null ? item.unitPrice : 0),
                price: item.price != null ? item.price : (item.unitPrice != null ? item.unitPrice : 0),
                name: item.name || item.title || "Ürün",
            }));
            const userId = (this.currentUser && this.currentUser.id) ? this.currentUser.id : (localStorage.getItem("userId") ? parseInt(localStorage.getItem("userId"), 10) : null);
            const userPayload = userId ? { id: userId } : null;
            if (userPayload && this.currentUser) {
                if (this.currentUser.phone) userPayload.phone = this.currentUser.phone;
                if (this.currentUser.email) userPayload.email = this.currentUser.email;
            }
            if (userPayload && !userPayload.phone && localStorage.getItem("userPhone")) userPayload.phone = localStorage.getItem("userPhone");
            if (userPayload && !userPayload.email && localStorage.getItem("userEmail")) userPayload.email = localStorage.getItem("userEmail");
            const body = {
                order: { orderType, items, branchId: companyId, companyId, is_first_order: localStorage.getItem("is_first_order") === "true", visit_count: parseInt(localStorage.getItem("visit_count") || "0", 10), selected_campaign: this.selectedCampaign || null, user: userPayload },
                company_id: companyId,
                context: { customer: { is_first_order: localStorage.getItem("is_first_order") === "true", visit_count: parseInt(localStorage.getItem("visit_count") || "0", 10) } },
            };
            if ((options && options.skipAutoCampaigns === true) || localStorage.getItem("yeppos_skip_auto_campaigns") === "1") body.skip_auto_campaigns = true;
            const resp = await fetch(getSiteRoot() + "/yeppanel/db/ajax/web/promotion-engine.php", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify(body),
            });
            const data = await resp.json();
            if (!data || !data.success) return;
            const validation = data.selected_campaign_validation;
            this.selectedCampaignValidation = validation || null;
            if (validation && validation.eligible === false && validation.reason) {
                if (typeof showSwalToast === "function") showSwalToast(validation.reason, "warning", 4500);
                this.saveSelectedCampaign(null);
            }
            this.appliedCampaigns = Array.isArray(data.applied_campaigns) ? data.applied_campaigns : [];
            this.engineCampaignDiscountCents = typeof data.campaign_discount_total_cents === "number" ? data.campaign_discount_total_cents : 0;
            this.freeItems = Array.isArray(data.free_items) ? data.free_items : [];
            this.appliedPromotions = Array.isArray(data.applied_promotions) ? data.applied_promotions : this.appliedCampaigns;
            this.couponAllowed = data.coupon_allowed !== false;
            this.couponBlockReason = data.coupon_block_reason || "";
            this.applyCouponPolicyToMenuInput();
        } catch (e) {
            this.appliedCampaigns = [];
            this.engineCampaignDiscountCents = 0;
            this.freeItems = [];
        }
    }

    // Kupon input'unu kampanya kuralına göre aç/kapat
    applyCouponPolicyToMenuInput() {
        const promoInput = document.getElementById("promoCodeInput");
        const applyBtn = document.getElementById("applyPromoBtn");
        const errorMessage = document.getElementById("promoErrorMessage");
        if (!promoInput) return;

        const reason =
            this.couponBlockReason || "Kupon bu kampanya ile kullanılamaz";

        if (this.couponAllowed) {
            promoInput.disabled = false;
            if (applyBtn) applyBtn.disabled = false;
            if (errorMessage) errorMessage.style.display = "none";
            return;
        }

        promoInput.disabled = true;
        if (applyBtn) {
            applyBtn.disabled = true;
            applyBtn.style.display = "none";
        }
        if (errorMessage) {
            errorMessage.textContent = reason;
            errorMessage.style.display = "block";
        }
    }

    // =========================
    // Kampanya seçim sistemi
    // =========================
    loadSelectedCampaign() {
        try {
            const raw = localStorage.getItem("yeppos_selected_campaign")
            this.selectedCampaign = raw ? JSON.parse(raw) : null;
        } catch (e) {
            this.selectedCampaign = null;
        }
    }

    saveSelectedCampaign(campaign) {
        try {
            if (campaign) {
                try { localStorage.removeItem("yeppos_skip_auto_campaigns"); } catch (e) { }
                const json = JSON.stringify(campaign);
                localStorage.setItem("yeppos_selected_campaign", json);
                try { if (typeof window.refreshOrderPageFromStorage === "function") window.refreshOrderPageFromStorage(); } catch (e) { }
            } else {
                localStorage.removeItem("yeppos_selected_campaign");
            }
        } catch (e) {
            // ignore
        }
        this.selectedCampaign = campaign || null;
    }

    moneyToCents(value) {
        if (value == null) return 0;
        const s = String(value).trim().replace(",", ".");
        const m = s.match(/^(-)?(\d+)(?:\.(\d{0,}))?$/);
        if (!m) return 0;
        const sign = m[1] ? -1 : 1;
        const intPart = m[2] || "0";
        const fracRaw = m[3] || "";
        const frac2 = (fracRaw + "00").slice(0, 2);
        const cents = sign * (Number(intPart) * 100 + Number(frac2));
        return Number.isFinite(cents) ? cents : 0;
    }

    centsToMoneyText(cents) {
        const n = Number(cents) || 0;
        return (n / 100).toFixed(2);
    }

    calcCampaignDiscountCents(itemsSubtotalCents) {
        if (!this.selectedCampaign) return 0;
        const subtotal = Math.max(Number(itemsSubtotalCents) || 0, 0);
        const type = String(this.selectedCampaign.discount_type || "fixed");
        const val = Number(this.selectedCampaign.discount_value || 0);
        let discount = 0;
        if (type === "percentage") {
            discount = Math.round((subtotal * val) / 100);
        } else if (type === "fixed") {
            discount = this.moneyToCents(val);
        } else if (type === "free_shipping") {
            discount = 0;
        }
        return Math.min(discount, subtotal);
    }

    async fetchCampaigns() {
        if (isTahmisciBackendCatalogMode()) return [];
        const cacheKey = "__menuCampaignsCache";
        const cacheMaxAge = 10000;
        const now = Date.now();
        if (
            window[cacheKey] &&
            window[cacheKey].ts &&
            now - window[cacheKey].ts < cacheMaxAge
        ) {
            return window[cacheKey].data || [];
        }
        try {
            const lang = getAjaxLang();
            const resp = await fetch(getSiteRoot() + "/yeppanel/db/ajax/web/campaigns.php?lang=" + encodeURIComponent(lang));
            const data = await resp.json();
            let list = [];
            if (Array.isArray(data?.data)) {
                list = data.data;
            } else if (data?.data && Array.isArray(data.data.campaigns)) {
                list = data.data.campaigns;
            }
            window[cacheKey] = { data: list, ts: now };
            return list;
        } catch (e) {
            return [];
        }
    }

    async hasActivePromotions() {
        if (isTahmisciBackendCatalogMode()) return false;
        const cacheKey = "__menuPromotionsAvailabilityCache";
        const cacheMaxAge = 10000;
        const now = Date.now();
        const branchId = localStorage.getItem("menuBranchId") || localStorage.getItem("menuCompanyId") || "";
        if (
            window[cacheKey] &&
            window[cacheKey].ts &&
            window[cacheKey].branchId === branchId &&
            now - window[cacheKey].ts < cacheMaxAge
        ) {
            return window[cacheKey].hasActive;
        }
        try {
            const resp = await fetch(getSiteRoot() + "/yeppanel/db/ajax/web/validate-promo-code.php", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ mode: "availability", branch_id: branchId ? Number(branchId) : 0 }),
            });
            const data = await resp.json();
            const hasActive = !!(data && data.success && data.has_active_promotions);
            window[cacheKey] = { hasActive, branchId, ts: now };
            return hasActive;
        } catch (e) {
            return false;
        }
    }

    isCampaignEligible(campaign, itemsSubtotalCents, orderType, branchId) {
        const branches = Array.isArray(campaign.branches) ? campaign.branches : [];
        if (branches.length > 0 && branchId && orderType !== "delivery") {
            const branchIdNum = Number(branchId);
            const hasBranch = branches.some((b) => b && Number(b.id) === branchIdNum);
            if (!hasBranch) return false;
        }
        const types = Array.isArray(campaign.order_types)
            ? campaign.order_types
            : [];
        if (types.length > 0 && orderType) {
            if (!types.includes(orderType)) return false;
        }
        const minCents = Number(campaign.min_subtotal_cents || 0);
        return itemsSubtotalCents >= minCents;
    }

    buildCampaignDetailHtml(campaign) {
        const translations = window.I18N?.getTranslations?.();
        const lang = window.I18N?.getPreferredLanguage?.() || "tr";
        const t = (key, fallback) =>
            translations?.[lang]?.[key] !== undefined
                ? translations[lang][key]
                : fallback;
        const orderTypeToLabel = (key) => {
            const k = String(key || "").toLowerCase();
            if (k === "takeaway") return t("order_type_takeaway", "Gel-Al");
            if (k === "delivery") return t("order_type_delivery", "Paket");
            if (k === "tableorder") return t("order_type_tableOrder", "Masada");
            return key;
        };
        const startStr = campaign.startDate
            ? new Date(campaign.startDate).toLocaleDateString("tr-TR")
            : "—";
        const endStr = campaign.endDate
            ? new Date(campaign.endDate).toLocaleDateString("tr-TR")
            : "—";
        const terms = Array.isArray(campaign.terms) ? campaign.terms : [];
        const couponPolicy = campaign.coupon_policy;
        const couponText =
            couponPolicy && couponPolicy.allow_coupon === false
                ? t("campaign_coupon_no", "Kuponla birlikte kullanılamaz")
                : t("campaign_coupon_yes", "Kuponla birlikte kullanılabilir");
        const termsHtml = terms
            .map((term) => `<li>${String(term).replace(/</g, "&lt;")}</li>`)
            .join("");
        const minCents = Number(campaign.min_subtotal_cents);
        const minStr =
            minCents > 0 ? this.centsToMoneyText(minCents).replace(".", ",") : "—";
        const discountType = String(campaign.discount_type || "").toLowerCase();
        const discountVal = Number(campaign.discount_value);
        const discountStr =
            discountType === "percentage"
                ? "%" + discountVal
                : discountVal > 0
                    ? discountVal.toFixed(2).replace(".", ",")
                    : "—";
        const orderTypes = Array.isArray(campaign.order_types) ? campaign.order_types : (Array.isArray(campaign.channels) ? campaign.channels : (Array.isArray(campaign.campaigns_channels) ? campaign.campaigns_channels : []));
        const orderTypesLabel = orderTypes.length > 0
            ? orderTypes.map((k) => orderTypeToLabel(k)).join(", ")
            : t("campaign_order_types_all", "Tümü");
        return `
      <div class="campaign-detail-line">
        <div class="campaign-detail-pair">
          <span class="campaign-detail-label">${t("campaign_min_subtotal", "Min. sepet tutarı")}</span>
          <span class="campaign-detail-value">${minStr}</span>
        </div>
        <div class="campaign-detail-pair">
          <span class="campaign-detail-label">${t("campaign_discount", "İndirim")}</span>
          <span class="campaign-detail-value">${discountStr}</span>
        </div>
      </div>
      <div class="campaign-detail-line">
        <div class="campaign-detail-pair">
          <span class="campaign-detail-label">${t("campaign_start_date", "Başlangıç tarihi")}</span>
          <span class="campaign-detail-value">${startStr}</span>
        </div>
        <div class="campaign-detail-pair">
          <span class="campaign-detail-label">${t("campaign_end_date", "Bitiş tarihi")}</span>
          <span class="campaign-detail-value">${endStr}</span>
        </div>
      </div>
      <div class="campaign-detail-row">
        <span class="campaign-detail-label">${t("campaign_order_types_label", "Sipariş tipleri")}</span>
        <span class="campaign-detail-value">${orderTypesLabel.replace(/</g, "&lt;")}</span>
      </div>
      <div class="campaign-detail-row">
        <span class="campaign-detail-label">${t("campaign_coupon_usage", "Kuponla kullanım")}</span>
        <span class="campaign-detail-value">${couponText}</span>
      </div>
      ${terms.length ? `<div class="campaign-detail-row campaign-detail-terms"><span class="campaign-detail-label">${t("campaign_terms", "Katılım şartları")}</span><ul class="campaign-detail-list">${termsHtml}</ul></div>` : ""}
    `;
    }

    renderCampaignCard(campaign, eligible, onApply, isApplied = false) {
        const translations = window.I18N?.getTranslations?.();
        const lang = window.I18N?.getPreferredLanguage?.() || "tr";
        const t = (key, fallback) =>
            translations?.[lang]?.[key] !== undefined
                ? translations[lang][key]
                : fallback;
        const btnText = isApplied
            ? t("campaign_applied_btn", "Uygulandı")
            : eligible
                ? t("campaign_apply_btn", "Uygula")
                : t("campaign_detail_btn", "Detay");
        const card = document.createElement("div");
        card.className = "campaign-card";
        card.innerHTML = `
      <div class="campaign-card-top">
        <div class="campaign-card-icon">
          <i class="fas fa-gift"></i>
        </div>
        <div class="campaign-card-content">
          <div class="campaign-card-title">${(campaign.title || "Kampanya").replace(/</g, "&lt;")}</div>
          <div class="campaign-card-desc">${(campaign.fullDescription || campaign.description || "").replace(/</g, "&lt;")}</div>
        </div>
        <button type="button" class="campaign-card-action">
          ${btnText}
        </button>
      </div>
      <button type="button" class="campaign-card-toggle" aria-expanded="false">
        <i class="fas fa-chevron-down campaign-card-toggle-icon"></i>
        <span>${t("campaign_detail_toggle", "Kampanya detayı")}</span>
      </button>
      <div class="campaign-card-detail" hidden>
        <div class="campaign-card-detail-inner">${this.buildCampaignDetailHtml(campaign)}</div>
      </div>
    `;
        const actionBtn = card.querySelector(".campaign-card-action");
        if (isApplied) actionBtn.classList.add("campaign-card-action--applied");
        if (isApplied || !eligible) actionBtn.setAttribute("disabled", "disabled");
        actionBtn.addEventListener("click", (e) => {
            e.stopPropagation();
            if (eligible && !isApplied) onApply();
        });
        const toggleBtn = card.querySelector(".campaign-card-toggle");
        const detailEl = card.querySelector(".campaign-card-detail");
        const iconEl = card.querySelector(".campaign-card-toggle-icon");
        toggleBtn.addEventListener("click", () => {
            const isOpen = toggleBtn.getAttribute("aria-expanded") === "true";
            if (isOpen) {
                detailEl.hidden = true;
                toggleBtn.setAttribute("aria-expanded", "false");
                if (iconEl) iconEl.classList.remove("campaign-card-toggle-icon--open");
            } else {
                detailEl.hidden = false;
                toggleBtn.setAttribute("aria-expanded", "true");
                if (iconEl) iconEl.classList.add("campaign-card-toggle-icon--open");
            }
        });
        return card;
    }

    async openCampaignModalForMenu() {
        const modal = document.getElementById("campaignModal");
        const listReady = document.getElementById("campaignListReady");
        const listEligible = document.getElementById("campaignListEligible");
        if (!modal || !listReady || !listEligible) return;

        // Kupon uygulanmışsa kampanya seçimine izin verme
        if (Array.isArray(this.appliedPromos) && this.appliedPromos.length > 0) {
            const translations = window.I18N?.getTranslations?.();
            const lang = window.I18N?.getPreferredLanguage?.() || "tr";
            const t = (key, fallback) =>
                translations?.[lang]?.[key] !== undefined
                    ? translations[lang][key]
                    : fallback;
            if (window.Swal && typeof window.Swal.fire === "function") {
                window.Swal.fire({
                    icon: "warning",
                    title: t("campaign_blocked_by_coupon_title", "Kampanya Uygulanamaz"),
                    text: t(
                        "campaign_blocked_by_coupon_desc",
                        "Kupon kullandığınız için kampanya sizin için geçerli değil.",
                    ),
                    confirmButtonText: t("ok", "Tamam"),
                });
            }
            return;
        }

        listReady.innerHTML = "";
        listEligible.innerHTML = "";

        // Her açılışta run-id artır; sadece en son açılışın cevabı listelensin (tekrarları önle)
        window.__campaignModalRunId = (window.__campaignModalRunId || 0) + 1;
        const myRunId = window.__campaignModalRunId;

        let campaigns = await this.fetchCampaigns();
        if (myRunId !== window.__campaignModalRunId) return;
        listReady.innerHTML = "";
        listEligible.innerHTML = "";

        // Aynı kampanyanın birden fazla görünmesini engelle: ID'ye göre tekil listele
        const seenIds = new Set();
        campaigns = campaigns.filter((c) => {
            const id = c?.id != null ? String(c.id) : "";
            if (!id || seenIds.has(id)) return false;
            seenIds.add(id);
            return true;
        });
        if (!campaigns.length) {
            modal.classList.add("active");
            return;
        }

        const branchId = localStorage.getItem("menuBranchId");
        const orderType = localStorage.getItem("menuOrderType") || "tableOrder";
        let itemsSubtotalCents = this.moneyToCents(
            document.getElementById("cartItemsTotal")?.textContent || "0",
        );
        if (itemsSubtotalCents <= 0) {
            const cartItems = window.globalCart ? window.globalCart.getItems() : this.cart;
            const list = Array.isArray(cartItems) ? cartItems : [];
            itemsSubtotalCents = list.reduce((sum, item) => {
                const qty = Number(item.quantity || 0) || 0;
                const priceCents = this.moneyToCents(item.price);
                return sum + priceCents * qty;
            }, 0);
        }

        campaigns.forEach((c) => {
            if (String(c.status || "") !== "active") return;
            const eligible = this.isCampaignEligible(
                c,
                itemsSubtotalCents,
                orderType,
                branchId,
            );
            const isApplied =
                this.selectedCampaign &&
                String(this.selectedCampaign.id) === String(c.id);
            const card = this.renderCampaignCard(
                c,
                eligible,
                () => {
                    this.applyCampaignSelection(c);
                    modal.classList.remove("active");
                },
                isApplied,
            );
            if (eligible) {
                listReady.appendChild(card);
            } else {
                listEligible.appendChild(card);
            }
        });

        modal.classList.add("active");
    }

    applyCampaignSelection(campaign) {
        // Kupon uygulanmışsa kampanya seçimine izin verme
        if (Array.isArray(this.appliedPromos) && this.appliedPromos.length > 0) {
            const translations = window.I18N?.getTranslations?.();
            const lang = window.I18N?.getPreferredLanguage?.() || "tr";
            const t = (key, fallback) =>
                translations?.[lang]?.[key] !== undefined
                    ? translations[lang][key]
                    : fallback;
            if (window.Swal && typeof window.Swal.fire === "function") {
                window.Swal.fire({
                    icon: "warning",
                    title: t("campaign_blocked_by_coupon_title", "Kampanya Uygulanamaz"),
                    text: t(
                        "campaign_blocked_by_coupon_desc",
                        "Kupon kullandığınız için kampanya sizin için geçerli değil.",
                    ),
                    confirmButtonText: t("ok", "Tamam"),
                });
            }
            return;
        }
        this.saveSelectedCampaign(campaign);
        this.renderNewCartModal();

        // Kampanya kupon politikasını stabil uygula (geçişlerde durum sıfırlansın)
        if (campaign?.coupon_policy?.allow_coupon === false) {
            this.couponAllowed = false;
            this.couponBlockReason = campaign.coupon_policy.description || "";
        } else {
            this.couponAllowed = true;
            this.couponBlockReason = "";
        }
        this.applyCouponPolicyToMenuInput();
    }

    removeCampaignSelection() {
        this.saveSelectedCampaign(null);
        try { localStorage.setItem("yeppos_skip_auto_campaigns", "1"); } catch (e) { }
        this.renderNewCartModal();
        // Kampanya kaldır: motor otomatik uygulama yapmasın, indirim sıfırlansın
        this.loadPromotionEngineState({ skipAutoCampaigns: true }).then(() => {
            const cartItems = window.globalCart ? window.globalCart.getItems() : this.cart;
            const list = Array.isArray(cartItems) ? cartItems : [];
            const itemsTotal = list.reduce((s, i) => s + (Number(i.price) || 0) * (Number(i.quantity) || 1), 0);
            const itemsCount = list.reduce((s, i) => s + (Number(i.quantity) || 1), 0);
            this.updateCartTotals(itemsTotal, itemsCount);
        });
        // Sipariş sayfası açıksa kampanya kaldırma senkronla
        try {
            if (typeof window.refreshOrderPageFromStorage === "function") window.refreshOrderPageFromStorage();
        } catch (e) { }
    }

    async updateCampaignSelectVisibility() {
        const row = document.getElementById("menuCampaignSelectRow");
        const promoRow = document.getElementById("promoCodeInput")?.closest(".promo-row");
        if (!row && !promoRow) return;
        const cartItems = window.globalCart ? window.globalCart.getItems() : this.cart;
        const cartItemsList = Array.isArray(cartItems) ? cartItems : [];
        const totalFromCart = window.globalCart && typeof window.globalCart.getTotalItems === "function"
            ? window.globalCart.getTotalItems()
            : cartItemsList.reduce((s, i) => s + (Number(i.quantity) || 1), 0);
        const hasCartItems = cartItemsList.length > 0 || (typeof totalFromCart === "number" && totalFromCart > 0);
        if (!hasCartItems) {
            if (row) row.style.display = "none";
            if (promoRow) promoRow.style.display = "none";
            return;
        }
        const campaigns = await this.fetchCampaigns();
        const branchId = localStorage.getItem("menuBranchId");
        const orderType = localStorage.getItem("menuOrderType") || "tableOrder";
        const itemsSubtotalCents = cartItemsList.reduce((sum, item) => {
            const qty = Number(item.quantity || 0) || 0;
            const priceCents = this.moneyToCents(item.price);
            return sum + priceCents * qty;
        }, 0);
        const hasAny = Array.isArray(campaigns) && campaigns.length > 0 && campaigns.some((c) => {
            if (String(c.status || "") !== "active") return false;
            const branches = Array.isArray(c.branches) ? c.branches : [];
            if (branches.length > 0 && branchId) {
                const branchIdNum = Number(branchId);
                if (!branches.some((b) => b && Number(b.id) === branchIdNum)) return false;
            }
            const types = Array.isArray(c.order_types) ? c.order_types : [];
            if (types.length > 0 && orderType) {
                if (!types.includes(orderType)) return false;
            }
            return true;
        });
        if (row) row.style.display = hasCartItems && hasAny ? "flex" : "none";
        const hasPromotions = await this.hasActivePromotions();
        if (promoRow) promoRow.style.display = hasCartItems && hasPromotions ? "flex" : "none";
        if (this.selectedCampaign) {
            const eligible = this.isCampaignEligible(
                this.selectedCampaign,
                itemsSubtotalCents,
                orderType,
                branchId,
            );
            if (!hasCartItems || !hasAny || !eligible) {
                this.removeCampaignSelection();
            }
        }
    }

    initializeCampaigns() {
        const selectBtn = document.getElementById("menuCampaignSelectBtn");
        const modal = document.getElementById("campaignModal");
        const modalClose = document.getElementById("campaignModalClose");
        if (selectBtn && !selectBtn.hasAttribute("data-campaign-initialized")) {
            selectBtn.setAttribute("data-campaign-initialized", "true");
            selectBtn.addEventListener("click", () =>
                this.openCampaignModalForMenu(),
            );
        }
        // Kampanya kaldır: event delegation (sepet modal içindeki buton her render'da aynı kalabilir ama tek listener)
        if (!document.body.hasAttribute("data-menu-campaign-remove-bound")) {
            document.body.setAttribute("data-menu-campaign-remove-bound", "true");
            document.body.addEventListener("click", (e) => {
                const btn = e.target.closest("#menuCampaignRemoveBtn");
                if (btn && typeof this.removeCampaignSelection === "function") this.removeCampaignSelection();
            });
        }
        if (modalClose) {
            modalClose.addEventListener(
                "click",
                () => modal && modal.classList.remove("active"),
            );
        }
        if (modal) {
            modal.addEventListener("click", (e) => {
                if (e.target === modal) modal.classList.remove("active");
            });
        }
        this.updateCampaignSelectVisibility();
    }

    initializePromoCode() {
        const promoInput = document.getElementById("promoCodeInput");
        const applyBtn = document.getElementById("applyPromoBtn");
        const errorMessage = document.getElementById("promoErrorMessage");

        if (!promoInput || !applyBtn) return;

        // Prevent duplicate event listeners
        if (promoInput.hasAttribute("data-promo-initialized")) return;
        promoInput.setAttribute("data-promo-initialized", "true");

        // Show/hide apply button based on input value
        promoInput.addEventListener("input", (e) => {
            const value = e.target.value.trim();
            if (value.length > 0) {
                applyBtn.style.display = "block";
                if (errorMessage) errorMessage.style.display = "none";
            } else {
                applyBtn.style.display = "none";
                if (errorMessage) errorMessage.style.display = "none";
            }
        });

        // Apply promo code on button click
        applyBtn.addEventListener("click", () => {
            this.applyPromoCode();
        });

        // Apply promo code on Enter key
        promoInput.addEventListener("keypress", (e) => {
            if (e.key === "Enter" && promoInput.value.trim().length > 0) {
                this.applyPromoCode();
            }
        });

        // Remove all promos button
        const removePromoBtn = document.getElementById("removePromoBtn");
        if (removePromoBtn) {
            removePromoBtn.addEventListener("click", () => {
                this.removePromoCode();
            });
        }

        // Tek tek promo silmek için chip alanında event delegation
        const promoAppliedCode = document.getElementById("promoAppliedCode");
        if (promoAppliedCode) {
            promoAppliedCode.addEventListener("click", (e) => {
                const btn = e.target.closest(".promo-chip-remove");
                if (!btn) return;
                const promoId = btn.getAttribute("data-promo-id");
                if (!promoId) return;
                this.removeSinglePromo(promoId);
            });
        }
    }

    removeSinglePromo(promoId) {
        if (!Array.isArray(this.appliedPromos) || this.appliedPromos.length === 0)
            return;
        const idNum = isNaN(Number(promoId)) ? null : Number(promoId);
        this.appliedPromos = this.appliedPromos.filter((p) => {
            if (p.id != null && idNum != null) {
                return Number(p.id) !== idNum;
            }
            // id yoksa koda göre eşle
            return String(p.code) !== String(promoId);
        });
        this.savePromo();
        // Sepet görünümünü ve toplamları yenile
        this.renderNewCartModal();
    }

    removePromoCode() {
        this.appliedPromos = [];
        this.savePromo(); // Remove from localStorage

        // Reset UI
        const promoRow = document.querySelector(".promo-row");
        const promoInput = document.getElementById("promoCodeInput");
        const applyBtn = document.getElementById("applyPromoBtn");
        const errorMessage = document.getElementById("promoErrorMessage");
        const promoAppliedRow = document.getElementById("promoAppliedRow");

        // Promo satırını sıfırla
        if (promoRow) promoRow.style.display = "flex";
        if (promoInput) {
            promoInput.value = "";
            promoInput.disabled = false;
            promoInput.style.backgroundColor = "#FAF8F2";
        }
        if (applyBtn) applyBtn.style.display = "none";
        if (errorMessage) errorMessage.style.display = "none";
        if (promoAppliedRow) promoAppliedRow.style.display = "none";

        // Refresh cart totals
        this.renderNewCartModal();

        // Kupon politikası varsa tekrar uygula
        this.applyCouponPolicyToMenuInput();
    }

    async applyPromoCode() {
        if (isTahmisciBackendCatalogMode()) return;
        const promoInput = document.getElementById("promoCodeInput");
        const applyBtn = document.getElementById("applyPromoBtn");
        const errorMessage = document.getElementById("promoErrorMessage");

        if (!promoInput || !applyBtn || !errorMessage) return;

        // Get translations
        const translations = window.I18N?.getTranslations?.();
        const lang = window.I18N?.getPreferredLanguage?.() || "tr";
        const t = (key, fallback) =>
            translations?.[lang]?.[key] !== undefined
                ? translations[lang][key]
                : fallback;

        // Prevent multiple simultaneous requests
        const checkingText = t("promo_checking", "Kontrol ediliyor...");
        if (applyBtn.disabled || applyBtn.textContent === checkingText) return;

        const promoCode = promoInput.value.trim();

        // Kampanya kuponu engelliyorsa burada dur
        if (!this.couponAllowed) {
            errorMessage.textContent =
                this.couponBlockReason || "Kupon bu kampanya ile kullanılamaz";
            errorMessage.style.display = "block";
            return;
        }

        if (!promoCode) {
            errorMessage.textContent = t(
                "promo_enter_code",
                "Lütfen promosyon kodunu girin",
            );
            errorMessage.style.display = "block";
            return;
        }

        // Disable button during request
        applyBtn.disabled = true;
        applyBtn.textContent = checkingText;
        errorMessage.style.display = "none";

        try {
            // Sepet ve bağlam (genişletilmiş kupon motoru için)
            const cartItems = window.globalCart && window.globalCart.getItems ? window.globalCart.getItems() : (this.cart || []);
            const cartList = Array.isArray(cartItems) ? cartItems : [];
            const items = cartList.map((item) => ({
                productId: item.productId || item.id || 0,
                categoryId: item.categoryId || item.category_id || 0,
                quantity: Number(item.quantity) || 1,
                unitPrice: item.price != null ? item.price : (item.unitPrice != null ? item.unitPrice : 0),
                price: item.price != null ? item.price : (item.unitPrice != null ? item.unitPrice : 0),
                name: item.name || item.title || "Ürün",
            }));
            const companyId = parseInt(localStorage.getItem("menuBranchId") || localStorage.getItem("menuCompanyId") || "0", 10) || 0;
            const orderType = localStorage.getItem("menuOrderType") || "tableOrder";
            const isFirstOrder = localStorage.getItem("is_first_order") === "true";
            const visitCount = parseInt(localStorage.getItem("visit_count") || "0", 10);
            const body = {
                code: promoCode,
                lang: getAjaxLang(),
                items,
                branch_id: companyId,
                order_type: orderType,
                is_first_order: isFirstOrder,
                visit_count: visitCount,
                customer: { is_first_order: isFirstOrder, visit_count: visitCount },
            };
            const response = await fetch(getSiteRoot() + "/yeppanel/db/ajax/web/validate-promo-code.php", {
                method: "POST",
                headers: {
                    "Content-Type": "application/json",
                },
                body: JSON.stringify(body),
            });

            const data = await response.json();

            if (data.success && data.promo) {
                // Promo code is valid
                const newPromo = {
                    id: data.promo.id ?? null,
                    code: promoCode,
                    discount: data.promo.discount,
                    discount_cents: data.promo.discount_cents ?? null,
                    percent_int: data.promo.percent_int ?? null,
                    type: data.promo.type || "fixed",
                    description: data.promo.description || "",
                    min_order_cents: data.promo.min_order_cents ?? null,
                    max_discount_cents: data.promo.max_discount_cents ?? null,
                    free_items: Array.isArray(data.promo.free_items) ? data.promo.free_items : [],
                    free_shipping: data.promo.free_shipping === true,
                    points: data.promo.points ?? 0,
                    promotion_policy: data.promo.promotion_policy || null,
                };

                // Daha önce aynı ID'ye sahip promo eklenmiş mi?
                const alreadyExists = Array.isArray(this.appliedPromos)
                    ? this.appliedPromos.some((p) => p.id === newPromo.id)
                    : false;

                if (alreadyExists) {
                    // Aynı promosyon tekrar eklenemez
                    errorMessage.textContent = t(
                        "promo_already_applied",
                        "Bu promosyon kodu zaten uygulanmış.",
                    );
                    errorMessage.style.display = "block";
                } else {
                    // Listeye ekle
                    if (!Array.isArray(this.appliedPromos)) {
                        this.appliedPromos = [];
                    }
                    this.appliedPromos.push(newPromo);

                    // Save to localStorage
                    this.savePromo();

                    // Input'u temizle, bir sonraki kod için hazır bırak
                    promoInput.value = "";
                    promoInput.disabled = false;
                    promoInput.style.backgroundColor = "#FAF8F2";
                    applyBtn.style.display = "none";
                    errorMessage.style.display = "none";

                    // Refresh cart totals
                    this.renderNewCartModal();

                    // Show success message
                    if (window.Swal && typeof window.Swal.fire === "function") {
                        const successMessage = t(
                            "promo_success_message",
                            'Promosyon kodu "{code}" uygulandı! {discount} TL indirim kazandınız.',
                        )
                            .replace("{code}", promoCode)
                            .replace("{discount}", data.promo.discount);

                        await window.Swal.fire({
                            title: t("promo_success_title", "Başarılı!"),
                            text: successMessage,
                            icon: "success",
                            confirmButtonText: "Tamam",
                            confirmButtonColor: "#8C734B",
                            timer: 2000,
                            timerProgressBar: true,
                            toast: true,
                            position: "top-end",
                            showConfirmButton: false,
                            width: "auto",
                            padding: "1rem 1.5rem",
                        });
                    }
                }
            } else {
                // Promo code is invalid
                this.appliedPromo = null;
                this.savePromo(); // Remove from localStorage
                errorMessage.textContent =
                    data.message ||
                    t(
                        "promo_not_found",
                        "Promosyon kodu bulunamadı. Lütfen farklı bir kod deneyin",
                    );
                errorMessage.style.display = "block";

                // Reset input
                promoInput.focus();
            }
        } catch (error) {
            console.error("Promo code validation error:", error);
            errorMessage.textContent = t(
                "promo_error",
                "Bir hata oluştu. Lütfen tekrar deneyin.",
            );
            errorMessage.style.display = "block";
            this.appliedPromo = null;
            this.savePromo(); // Remove from localStorage
        } finally {
            // Re-enable button
            applyBtn.disabled = false;
            applyBtn.textContent = t("promo_apply_btn", "Uygula");
        }
    }

    updateCartTotals(itemsTotal, itemsCount) {
        const itemsTotalEl = document.getElementById("cartItemsTotal");
        const itemsCountEl = document.getElementById("cartItemsCount");
        const orderTotalEl = document.getElementById("cartOrderTotal");
        const footerTotalEl = document.getElementById("newCartFooterTotal");
        const campaignAppliedRow = document.getElementById(
            "menuCampaignAppliedRow",
        );
        const campaignAppliedCode = document.getElementById(
            "menuCampaignAppliedCode",
        );
        const campaignAppliedDiscount = document.getElementById(
            "menuCampaignAppliedDiscount",
        );
        const promoAppliedRow = document.getElementById("promoAppliedRow");
        const promoAppliedCode = document.getElementById("promoAppliedCode");
        const promoAppliedDiscount = document.getElementById(
            "promoAppliedDiscount",
        );

        // Kampanya indirimi: Backend motoru tek kaynak; motor indirim döndüyse client tarafı eklenmez (çift hesaplama önlenir)
        const itemsTotalCents = this.moneyToCents(itemsTotal);
        const engineCents = typeof this.engineCampaignDiscountCents === "number" ? this.engineCampaignDiscountCents : 0;
        const useOnlyEngine = Array.isArray(this.appliedCampaigns) && this.appliedCampaigns.length > 0 && engineCents > 0;
        const legacyCampaignCents = useOnlyEngine ? 0 : ((this.selectedCampaignValidation && this.selectedCampaignValidation.eligible === false) ? 0 : this.calcCampaignDiscountCents(itemsTotalCents));
        const campaignDiscountCents = Math.min(itemsTotalCents, legacyCampaignCents + engineCents);
        const subtotalAfterCampaignCents = Math.max(
            itemsTotalCents - campaignDiscountCents,
            0,
        );

        // Birden fazla promosyonun satır bazında ve toplam indirimini hesapla
        let promoDiscountCents = 0;
        const perPromoDiscounts = [];
        if (Array.isArray(this.appliedPromos) && this.appliedPromos.length > 0) {
            this.appliedPromos.forEach((promo) => {
                const minOrderCents = Number(promo.min_order_cents || 0) || 0;
                if (minOrderCents > 0 && subtotalAfterCampaignCents < minOrderCents) return;
                const discountVal = Number(promo.discount || 0);
                const discountCentsRaw = promo.discount_cents != null ? Number(promo.discount_cents) : null;
                const percentInt = promo.percent_int != null ? Number(promo.percent_int) : null;
                let lineDiscountCents = 0;
                if (promo.type === "fixed" || promo.type === "min_order_fixed") {
                    lineDiscountCents = discountCentsRaw != null ? discountCentsRaw : this.moneyToCents(discountVal);
                } else if (promo.type === "percentage" || promo.type === "percent" || promo.type === "percentage_capped" || promo.type === "min_order_percent") {
                    const pct = percentInt != null ? percentInt : discountVal;
                    lineDiscountCents = Math.round((subtotalAfterCampaignCents * pct) / 100);
                    const maxCents = promo.max_discount_cents != null ? Number(promo.max_discount_cents) : null;
                    if (maxCents != null && lineDiscountCents > maxCents) lineDiscountCents = maxCents;
                }
                if (lineDiscountCents > 0) {
                    perPromoDiscounts.push({
                        promo,
                        amountCents: lineDiscountCents,
                    });
                    promoDiscountCents += lineDiscountCents;
                }
            });
            // Toplam indirim, ürün toplamını aşmasın
            promoDiscountCents = Math.min(
                promoDiscountCents,
                subtotalAfterCampaignCents,
            );
        }

        const finalTotalCents = Math.max(
            0,
            itemsTotalCents - campaignDiscountCents - promoDiscountCents,
        );

        // Get translations
        const translations = window.I18N?.getTranslations?.();
        const lang = window.I18N?.getPreferredLanguage?.() || "tr";
        const t = (key, fallback) =>
            translations?.[lang]?.[key] !== undefined
                ? translations[lang][key]
                : fallback;

        // Kampanya satırı (seçili kampanya veya motor kampanyaları) – indirim veya bedava ürün varsa satır + kaldır butonu göster
        const hasFreeItems = Array.isArray(this.freeItems) && this.freeItems.length > 0;
        const hasCampaign = (this.selectedCampaign || (Array.isArray(this.appliedCampaigns) && this.appliedCampaigns.length > 0)) && (campaignDiscountCents > 0 || hasFreeItems);
        if (hasCampaign && campaignAppliedRow && campaignAppliedCode && campaignAppliedDiscount) {
            campaignAppliedRow.style.display = "flex";
            let name = "";
            if (Array.isArray(this.appliedCampaigns) && this.appliedCampaigns.length > 0) {
                name = this.appliedCampaigns.map((c) => c.title || "").filter(Boolean).join(", ");
            }
            if (!name && this.selectedCampaign) name = this.selectedCampaign.title || "Kampanya";
            if (!name) name = "Kampanya indirimi";
            campaignAppliedCode.textContent = name;
            campaignAppliedDiscount.textContent = campaignDiscountCents > 0
                ? "-" + this.centsToMoneyText(campaignDiscountCents)
                : (hasFreeItems ? (t("cart_free_items", "Ücretsiz ürünler") || "Ücretsiz ürünler") : "");
        } else if (campaignAppliedRow) {
            campaignAppliedRow.style.display = "none";
        }

        // Ücretsiz ürünler satırı (kampanya motoru)
        const freeItemsRow = document.getElementById("menuFreeItemsRow");
        const freeItemsList = document.getElementById("menuFreeItemsList");
        if (Array.isArray(this.freeItems) && this.freeItems.length > 0 && freeItemsRow && freeItemsList) {
            freeItemsRow.style.display = "flex";
            freeItemsList.innerHTML = this.freeItems.map((f) => {
                const n = (f.name || "Ürün").replace(/</g, "&lt;").replace(/>/g, "&gt;");
                const q = Number(f.quantity) || 1;
                return "<div class=\"free-item-line\"><span class=\"free-item-badge\">Ücretsiz</span> " + n + " x " + q + "</div>";
            }).join("");
        } else if (freeItemsRow) {
            freeItemsRow.style.display = "none";
        }

        // Show/hide promo applied row
        if (perPromoDiscounts.length > 0 && promoAppliedRow) {
            promoAppliedRow.style.display = "flex";
            if (promoAppliedCode) {
                // Her promosyon için ayrı satır (sol kod, sağ tutar)
                const linesHtml = perPromoDiscounts
                    .map(({ promo, amountCents }) => {
                        const desc = (promo.description || "").trim();
                        const safeId = promo.id != null ? String(promo.id) : "";
                        const label = desc
                            ? `${desc} (<small class="promo-chip-code">${promo.code}</small>)`
                            : `<small class="promo-chip-code">${promo.code}</small>`;
                        return `
              <div class="promo-line">
                <span class="promo-chip" data-promo-id="${safeId}">
                  <span>${label}</span>
                  <button type="button" class="promo-chip-remove" data-promo-id="${safeId}">&times;</button>
                </span>
                <span class="promo-line-amount">-${this.centsToMoneyText(
                            amountCents,
                        )}</span>
              </div>
            `;
                    })
                    .join("");
                promoAppliedCode.innerHTML = linesHtml;
            }
            if (promoAppliedDiscount) {
                promoAppliedDiscount.textContent = "";
            }
        } else if (promoAppliedRow) {
            promoAppliedRow.style.display = "none";
        }

        if (itemsTotalEl)
            itemsTotalEl.textContent = this.centsToMoneyText(itemsTotalCents) + "";
        if (itemsCountEl)
            itemsCountEl.textContent = `${itemsCount} ${t("cart_items_unit", "ürün")}`;
        if (orderTotalEl)
            orderTotalEl.textContent = this.centsToMoneyText(finalTotalCents) + "";
        if (footerTotalEl)
            footerTotalEl.textContent = this.centsToMoneyText(finalTotalCents) + "";
    }

    // ========== NOTIFICATION SYSTEM ==========

    showAddToCartNotification(product, quantity) {
        if (!product) {
            return;
        }

        const notification = document.getElementById("addToCartNotification");

        // Cart edit modal elements
        this.cartEditModalOverlay = document.getElementById("cartEditModalOverlay");
        this.cartEditModalClose = document.getElementById("cartEditModalClose");
        this.cartEditQuantityMinus = document.getElementById(
            "cartEditQuantityMinus",
        );
        this.cartEditQuantityPlus = document.getElementById("cartEditQuantityPlus");
        this.cartEditQuantity = document.getElementById("cartEditQuantity");
        this.cartEditUpdateBtn = document.getElementById("cartEditUpdateBtn");
        this.cartEditTotalPrice = document.getElementById("cartEditTotalPrice");

        // Check if elements exist
        if (!this.cartDrawerOverlay) {
            return;
        }

        // Event listeners
        if (this.cartDrawerClose) {
            this.cartDrawerClose.addEventListener("click", () =>
                this.closeCartDrawer(),
            );
        }

        if (this.cartContinueBtn) {
            this.cartContinueBtn.addEventListener("click", () =>
                this.closeCartDrawer(),
            );
        }

        if (this.cartCheckoutBtn) {
            this.cartCheckoutBtn.addEventListener("click", () => {
                window.location.href = "siparis";
            });
        }

        if (this.cartDrawerOverlay) {
            this.cartDrawerOverlay.addEventListener("click", (e) => {
                if (e.target === this.cartDrawerOverlay) {
                    this.closeCartDrawer();
                }
            });
        }

        // Cart edit modal event listeners
        if (this.cartEditModalClose) {
            this.cartEditModalClose.addEventListener("click", () =>
                this.closeCartEditModal(),
            );
        }

        if (this.cartEditModalOverlay) {
            this.cartEditModalOverlay.addEventListener("click", (e) => {
                if (e.target === this.cartEditModalOverlay) {
                    this.closeCartEditModal();
                }
            });
        }

        if (this.cartEditQuantityMinus) {
            this.cartEditQuantityMinus.addEventListener("click", () =>
                this.changeCartEditQuantity(-1),
            );
        }

        if (this.cartEditQuantityPlus) {
            this.cartEditQuantityPlus.addEventListener("click", () =>
                this.changeCartEditQuantity(1),
            );
        }

        if (this.cartEditUpdateBtn) {
            this.cartEditUpdateBtn.addEventListener("click", () =>
                this.updateCartItem(),
            );
        }

        // Cart button listeners
        const cartButtons = document.querySelectorAll(
            '.cart-btn, .mobile-action-btn[href*="cart"], .action-btn[href*="cart"]',
        );

        cartButtons.forEach((btn) => {
            btn.addEventListener("click", (e) => {
                e.preventDefault();
                this.openCartDrawer();
            });
        });

        // Header cart button
        const headerCartBtn = document.querySelector('.action-btn[href="siparis"]');
        if (headerCartBtn) {
            headerCartBtn.addEventListener("click", (e) => {
                e.preventDefault();
                this.openCartDrawer();
            });
        }

        // Cart edit option change listeners
        this.initializeCartEditOptionListeners();
    }

    // ========== CART EDIT MODAL SYSTEM ==========

    openCartEditModal(cartItemId) {
        // Sepet drawer'ı kapat
        this.closeCartDrawer();

        const cartItem = this.cart.find((item) => item.id === cartItemId);
        if (!cartItem) {
            return;
        }

        // Find the original product
        const product = this.products.find((p) => p.id === cartItem.productId);
        if (!product) {
            return;
        }

        this.currentCartItem = cartItem;
        this.currentCartItemId = cartItemId;
        this.currentCartEditQuantity = cartItem.quantity;
        this.baseCartEditPrice = product.basePrice;

        // Update modal content
        this.updateCartEditModalContent(product, cartItem);

        // Reset form with current options
        this.resetCartEditModalForm(cartItem);

        // Calculate initial price
        this.updateCartEditPrice();

        // Show modal
        this.cartEditModalOverlay.classList.add("active");
        document.body.style.overflow = "hidden";
    }

    updateCartEditModalContent(product, cartItem) {
        // Update product image
        const modalImage = document.getElementById("cartEditProductImage");
        if (modalImage) {
            modalImage.src = product.image;
            modalImage.alt = product.name;
            modalImage.classList.toggle("logo-fallback-image", isLogoFallbackSource(product.image_source));
        }

        // Update product name
        const modalName = document.getElementById("cartEditProductName");
        if (modalName) {
            modalName.textContent = product.name;
        }

        // Update product description
        const modalDescription = document.getElementById(
            "cartEditProductDescription",
        );
        if (modalDescription) {
            modalDescription.textContent = product.description;
        }

        // Update price
        const modalCurrentPrice = document.getElementById("cartEditCurrentPrice");
        const modalOldPrice = document.getElementById("cartEditOldPrice");
        if (modalCurrentPrice) {
            modalCurrentPrice.textContent =
                parseFloat(product.basePrice || 0).toFixed(2) + "";
        }
        if (modalOldPrice && product.oldPrice) {
            modalOldPrice.textContent =
                parseFloat(product.oldPrice || 0).toFixed(2) + "";
            modalOldPrice.style.display = "inline";
        } else if (modalOldPrice) {
            modalOldPrice.style.display = "none";
        }

        // Update badge (tükendi öncelikli)
        const modalBadge = document.getElementById("cartEditProductBadge");
        if (modalBadge) {
            if (product.product_qr_status === "2") {
                modalBadge.textContent = "Tükendi";
                modalBadge.style.display = "block";
            } else if (product.badge) {
                modalBadge.textContent = this.getBadgeText(product.badge);
                modalBadge.style.display = "block";
            } else {
                modalBadge.style.display = "none";
            }
        }

        // Update size options
        this.updateCartEditSizeOptions(product.sizeOptions);

        // Update extra options
        this.updateCartEditExtraOptions(product.extraOptions);
    }

    updateCartEditSizeOptions(sizeOptions) {
        const sizeOptionsContainer = document.getElementById("cartEditSizeOptions");
        if (!sizeOptionsContainer) return;

        sizeOptionsContainer.innerHTML = "";

        sizeOptions.forEach((option, index) => {
            const label = document.createElement("label");
            label.className = "option-choice";
            label.innerHTML = `
                <input type="radio" name="cartEditSize" value="${option.name.toLowerCase()}" data-price="${option.price
                }" ${index === 1 ? "checked" : ""}>
                <div class="choice-content">
                    <span class="choice-name">${option.name}</span>
                    <span class="choice-price">+${parseFloat(option.price || 0).toFixed(2)}</span>
                </div>
            `;
            sizeOptionsContainer.appendChild(label);
        });
    }

    updateCartEditExtraOptions(extraOptions) {
        const extraOptionsContainer = document.getElementById(
            "cartEditExtraOptions",
        );
        if (!extraOptionsContainer) return;

        extraOptionsContainer.innerHTML = "";

        extraOptions.forEach((option) => {
            const label = document.createElement("label");
            label.className = "option-choice";
            label.innerHTML = `
                <input type="checkbox" name="cartEditExtra" value="${option.name.toLowerCase()}" data-price="${option.price
                }">
                <div class="choice-content">
                    <span class="choice-name">${option.name}</span>
                    <span class="choice-price">+${parseFloat(option.price || 0).toFixed(2)}</span>
                </div>
            `;
            extraOptionsContainer.appendChild(label);
        });
    }

    resetCartEditModalForm(cartItem) {
        // Set quantity
        if (this.cartEditQuantity) {
            this.cartEditQuantity.textContent = cartItem.quantity;
        }

        // Set size option
        if (
            cartItem.options &&
            cartItem.options.size &&
            cartItem.options.size.name
        ) {
            const sizeInput = document.querySelector(
                `input[name="cartEditSize"][value="${cartItem.options.size.name.toLowerCase()}"]`,
            );
            if (sizeInput) {
                sizeInput.checked = true;
            }
        }

        // Set extra options
        if (
            cartItem.options &&
            cartItem.options.extras &&
            Array.isArray(cartItem.options.extras)
        ) {
            cartItem.options.extras.forEach((extra) => {
                if (extra && extra.name) {
                    const extraInput = document.querySelector(
                        `input[name="cartEditExtra"][value="${extra.name.toLowerCase()}"]`,
                    );
                    if (extraInput) {
                        extraInput.checked = true;
                    }
                }
            });
        }

        // Set notes
        const notesTextarea = document.getElementById("cartEditProductNotes");
        if (notesTextarea && cartItem.options && cartItem.options.notes) {
            notesTextarea.value = cartItem.options.notes;
        }
    }

    changeCartEditQuantity(change) {
        const newQuantity = this.currentCartEditQuantity + change;
        if (newQuantity >= 1 && newQuantity <= 10) {
            this.currentCartEditQuantity = newQuantity;
            if (this.cartEditQuantity) {
                this.cartEditQuantity.textContent = newQuantity;
            }
            this.updateCartEditPrice();
        }
    }

    updateCartEditPrice() {
        let totalPrice = this.baseCartEditPrice;

        // Add size price
        const selectedSize = document.querySelector(
            'input[name="cartEditSize"]:checked',
        );
        if (selectedSize) {
            totalPrice += parseInt(selectedSize.dataset.price) || 0;
        }

        // Add extra prices
        const selectedExtras = document.querySelectorAll(
            'input[name="cartEditExtra"]:checked',
        );
        selectedExtras.forEach((extra) => {
            totalPrice += parseInt(extra.dataset.price) || 0;
        });

        // Multiply by quantity
        totalPrice *= this.currentCartEditQuantity;

        // Update display
        if (this.cartEditTotalPrice) {
            this.cartEditTotalPrice.textContent = totalPrice.toFixed(2) + "";
        }
    }

    updateCartItem() {
        if (!this.currentCartItem || !this.currentCartItemId) {
            return;
        }
        // Get selected options
        const selectedSize = document.querySelector(
            'input[name="cartEditSize"]:checked',
        );
        const selectedExtras = document.querySelectorAll(
            'input[name="cartEditExtra"]:checked',
        );
        const notes = document.getElementById("cartEditProductNotes");
        // Calculate total price
        let totalPrice = this.baseCartEditPrice;
        const options = {
            size: selectedSize ? selectedSize.value : null,
            extras: Array.from(selectedExtras).map((extra) => extra.value),
            notes: notes ? notes.value : "",
        };
        if (selectedSize) {
            totalPrice += parseInt(selectedSize.dataset.price) || 0;
        }
        selectedExtras.forEach((extra) => {
            const extraPrice = parseInt(extra.dataset.price) || 0;
            totalPrice += extraPrice;
        });
        // Update cart item
        const cartItem = this.cart.find(
            (item) => item.id === this.currentCartItemId,
        );
        if (cartItem) {
            cartItem.quantity = this.currentCartEditQuantity;
            cartItem.options = options;
            cartItem.price = totalPrice;
            this.saveCart();
            this.updateCartCounter();
            this.renderCartItems();
        }
        // Close modal
        this.closeCartEditModal();
        // Sepet drawer'ı tekrar aç
        this.openCartDrawer();
    }

    closeCartEditModal() {
        if (this.cartEditModalOverlay) {
            this.cartEditModalOverlay.classList.remove("active");
        }
        document.body.style.overflow = "";
        this.currentCartItem = null;
        this.currentCartItemId = null;
        this.currentCartEditQuantity = 1;
        this.baseCartEditPrice = 0;
    }

    initializeCartEditOptionListeners() {
        // Size options
        document.addEventListener("change", (e) => {
            if (e.target.name === "cartEditSize") {
                this.updateCartEditPrice();
            }
        });

        // Extra options
        document.addEventListener("change", (e) => {
            if (e.target.name === "cartEditExtra") {
                this.updateCartEditPrice();
            }
        });
    }

    openCartDrawer() {
        // Use global cart manager if available
        if (window.globalCart) {
            window.globalCart.openCartDrawer();
            if (window.updateFixedCartBtnVisibility)
                window.updateFixedCartBtnVisibility();
            // Sepet butonunu gizle
            hideCartButtons();
            // Modal açıldıktan sonra scroll listener'ı ekle
            setTimeout(() => {
                setupCartScrollControl();
            }, 100);
            return;
        }

        // Fallback to local cart drawer
        if (!this.cartDrawerOverlay) {
            return;
        }

        this.renderCartItems();
        this.cartDrawerOverlay.classList.add("active");
        document.body.style.overflow = "hidden";
        if (window.updateFixedCartBtnVisibility)
            window.updateFixedCartBtnVisibility();

        // Sepet butonunu gizle
        hideCartButtons();

        // Modal açıldıktan sonra scroll listener'ı ekle
        setTimeout(() => {
            setupCartScrollControl();
        }, 100);
    }

    closeCartDrawer() {
        if (window.globalCart) {
            window.globalCart.closeCartDrawer();
            if (window.updateFixedCartBtnVisibility)
                window.updateFixedCartBtnVisibility();
            // Sepet butonunu göster
            showCartButtons();
            return;
        }
        if (this.cartDrawerOverlay) {
            this.cartDrawerOverlay.classList.remove("active");
        }
        // Sadece başka modal yoksa scroll'u aç
        const productModal = document.querySelector(".product-modal-overlay");
        if (!productModal || !productModal.classList.contains("active")) {
            document.body.style.overflow = "";
        }
        if (window.updateFixedCartBtnVisibility)
            window.updateFixedCartBtnVisibility();

        // Sepet butonunu göster
        showCartButtons();
    }

    renderCartItems() {
        // Use global cart manager if available
        if (window.globalCart) {
            window.globalCart.renderCartItems();
            return;
        }
        // Fallback to local cart rendering
        const cartItemsContainer = document.getElementById("cartDrawerItems");
        const cartEmpty = document.getElementById("cartEmpty");
        const cartFooter = document.getElementById("cartDrawerFooter");
        const cartTotalAmount = document.getElementById("cartTotalAmount");
        if (!cartItemsContainer) {
            return;
        }
        if (this.cart.length === 0) {
            if (cartEmpty) cartEmpty.style.display = "block";
            if (cartFooter) cartFooter.style.display = "none";
            return;
        }
        if (cartEmpty) cartEmpty.style.display = "none";
        if (cartFooter) cartFooter.style.display = "block";
        // Render cart items
        cartItemsContainer.innerHTML = "";
        this.cart.forEach((item) => {
            // Ensure options structure exists
            if (!item.options) {
                item.options = { size: null, extras: [], notes: "" };
            }
            if (!item.options.extras) {
                item.options.extras = [];
            }
            // Boyut (size) stringleştirme
            let sizeText = "";
            if (item.options.size) {
                if (
                    typeof item.options.size === "object" &&
                    item.options.size !== null
                ) {
                    sizeText = `<span class="cart-option">Boyut: ${item.options.size.name || ""
                        }</span>`;
                } else {
                    sizeText = `<span class="cart-option">Boyut: ${item.options.size}</span>`;
                }
            }
            // Ekstralar (extras) stringleştirme
            let extrasArr = [];
            if (Array.isArray(item.options.extras)) {
                extrasArr = item.options.extras
                    .filter((e) => e && e !== "null" && e !== "")
                    .map((e) => (typeof e === "object" && e !== null ? e.name || "" : e))
                    .filter((e) => e);
            }
            const extrasText =
                extrasArr.length > 0
                    ? `<span class="cart-option">Ekstra: ${extrasArr.join(", ")}</span>`
                    : "";
            const cartItem = document.createElement("div");
            cartItem.className = "cart-item";
            cartItem.innerHTML = `
                <div class="cart-item-image">
                    <img src="${item.image}" alt="${item.name}">
                </div>
                <div class="cart-item-details">
                    <h4 class="cart-item-name">${item.name}</h4>
                    <div class="cart-item-options">
                        ${sizeText}
                        ${extrasText}
                    </div>
                    <div class="cart-item-price">${parseFloat(item.price || 0).toFixed(2)}</div>
                </div>
                <div class="cart-item-actions">
                    <div class="cart-item-quantity">
                        <button class="quantity-btn minus" onclick="window.menuPage.updateCartQuantity('${item.id
                }', ${item.quantity - 1})">
                            <i class="fas fa-minus"></i>
                        </button>
                        <span class="quantity-display">${item.quantity}</span>
                        <button class="quantity-btn plus" onclick="window.menuPage.updateCartQuantity('${item.id
                }', ${item.quantity + 1})">
                            <i class="fas fa-plus"></i>
                        </button>
                    </div>
                    <div class="cart-item-buttons">
                        <button class="edit-item-btn" onclick="window.menuPage.openCartEditModal('${item.id
                }')" title="Düzenle">
                            <i class="fas fa-edit"></i>
                        </button>
                        <button class="remove-item-btn" onclick="window.menuPage.removeFromCart('${item.id
                }')" title="Sil">
                            <i class="fas fa-trash"></i>
                        </button>
                    </div>
                </div>
            `;
            cartItemsContainer.appendChild(cartItem);
        });
        // Update total
        if (cartTotalAmount) {
            cartTotalAmount.textContent = this.getCartTotal().toFixed(2) + "";
        }
    }

    // ========== NOTIFICATION SYSTEM ==========

    showAddToCartNotification(product, quantity) {
        if (!product) {
            return;
        }

        const titleText = "Ürün sepete eklendi!";
        const descText = `${product.name}${quantity > 1 ? ` (${quantity} adet)` : ""} sepetinize eklendi`;

        if (window.Swal && typeof window.Swal.fire === "function") {
            window.Swal.fire({
                icon: "success",
                title: titleText,
                text: descText,
                toast: true,
                position: "top-end",
                showConfirmButton: false,
                timer: 4000,
                timerProgressBar: true,
                width: "auto",
                padding: "1rem 1.5rem",
            });
        }

        this.updateCartCounter();
        setTimeout(() => {
            this.openCartDrawer();
        }, 1000);
    }

    // ========== FAVORITES SYSTEM ==========

    initializeFavorites() {
        this.favorites = this.loadFavorites();
        this.updateFavoriteButtons();
    }

    toggleFavorite(productId) {
        const index = this.favorites.indexOf(productId);

        if (index === -1) {
            this.favorites.push(productId);
        } else {
            this.favorites.splice(index, 1);
        }

        this.saveFavorites();
        this.updateFavoriteButtons();
    }

    updateFavoriteButtons() {
        const favoriteButtons = document.querySelectorAll(".product-favorite");

        favoriteButtons.forEach((btn) => {
            const productId = parseInt(btn.dataset.id);
            const isFavorite = this.favorites.includes(productId);

            if (isFavorite) {
                btn.classList.add("active");
                btn.innerHTML = '<i class="fas fa-heart"></i>';
            } else {
                btn.classList.remove("active");
                btn.innerHTML = '<i class="far fa-heart"></i>';
            }
        });
    }

    saveFavorites() {
        try {
            localStorage.setItem("yeppos_favorites", JSON.stringify(this.favorites));
        } catch (e) {
            // Favorites save error
        }
    }

    loadFavorites() {
        try {
            const savedFavorites = localStorage.getItem("yeppos_favorites");
            return savedFavorites ? JSON.parse(savedFavorites) : [];
        } catch (e) {
            return [];
        }
    }

    // ========== MOBİL TARAYICI CHROME DETECTION ==========

    initializeViewportDetection() {
        // Store initial viewport height
        this.initialViewportHeight = window.visualViewport
            ? window.visualViewport.height
            : window.innerHeight;
        this.lastViewportHeight = this.initialViewportHeight;
        this.viewportChangeThreshold = 50; // 50px değişim eşiği
        this.isChromeVisible = false;

        // Setup event listeners
        this.setupViewportEventListeners();

        // Start periodic check
        this.startViewportPolling();
    }

    setupViewportEventListeners() {
        // Visual Viewport API (modern browsers)
        if (window.visualViewport) {
            window.visualViewport.addEventListener("resize", () => {
                this.handleViewportChange();
            });
        }

        // Window resize events
        window.addEventListener("resize", () => {
            this.handleViewportChange();
        });

        // Orientation change
        window.addEventListener("orientationchange", () => {
            setTimeout(() => {
                this.handleViewportChange();
            }, 100);
        });
    }

    startViewportPolling() {
        // Poll viewport height every 100ms to catch browser chrome changes
        this.viewportPollInterval = setInterval(() => {
            const currentHeight = window.visualViewport
                ? window.visualViewport.height
                : window.innerHeight;

            if (
                Math.abs(currentHeight - this.lastViewportHeight) >
                this.viewportChangeThreshold
            ) {
                this.handleViewportChange();
            }

            this.lastViewportHeight = currentHeight;
        }, 100);
    }

    handleViewportChange() {
        const currentHeight = window.visualViewport
            ? window.visualViewport.height
            : window.innerHeight;
        const heightDifference = this.initialViewportHeight - currentHeight;

        // Detect if browser chrome is visible (significant height reduction)
        const chromeVisible = heightDifference > this.viewportChangeThreshold;

        if (chromeVisible !== this.isChromeVisible) {
            this.isChromeVisible = chromeVisible;
            this.adjustAddToCartButton(chromeVisible, heightDifference);
        }
    }

    adjustAddToCartButton(chromeVisible, chromeHeight) {
        const addToCartRow = document.querySelector(".add-to-cart-row");
        if (!addToCartRow) return;

        if (chromeVisible) {
            // Browser chrome is visible, move button up
            addToCartRow.style.bottom = `${chromeHeight}px`;
        } else {
            // Browser chrome is hidden, reset to bottom
            addToCartRow.style.bottom = "0px";
        }
    }

    cleanupViewportDetection() {
        // Remove event listeners
        if (window.visualViewport) {
            window.visualViewport.removeEventListener(
                "resize",
                this.handleViewportChange,
            );
        }
        window.removeEventListener("resize", this.handleViewportChange);
        window.removeEventListener("orientationchange", this.handleViewportChange);

        // Clear polling interval
        if (this.viewportPollInterval) {
            clearInterval(this.viewportPollInterval);
            this.viewportPollInterval = null;
        }

        // Reset button position
        const addToCartRow = document.querySelector(".add-to-cart-row");
        if (addToCartRow) {
            addToCartRow.style.bottom = "0px";
        }
    }
}

// ========== GLOBAL FUNCTIONS ==========

// Make functions available globally
window.openProductModal = function (productId, cartItemId = null) {
    if (!window.menuPage || !productId) {
        return;
    }

    window.menuPage.openProductModal(productId, cartItemId);

    // Galeri sistemini başlat
    setTimeout(() => {
        const products = window.MenuProducts || [];
        const product = products.find((p) => p.id == productId);

        if (product) {
            // Eğer media array varsa kullan, yoksa product.image'dan tek resimli galeri oluştur
            if (
                product.media &&
                Array.isArray(product.media) &&
                product.media.length > 0
            ) {
                const mediaWithSource = product.media.map((m) => ({
                    ...m,
                    isLogoFallback: !!(isLogoFallbackSource(product.image_source) && m.type === "image" && m.url === product.image),
                }));
                window.initProductGallery(mediaWithSource);
            } else if (product.image) {
                // Fallback: Tek resimli galeri oluştur
                window.initProductGallery([{
                    type: "image",
                    url: product.image,
                    isLogoFallback: isLogoFallbackSource(product.image_source),
                }]);
            }
        }
    }, 100);
};

window.toggleFavorite = function (productId, btn) {
    if (!window.menuPage || !productId) {
        return;
    }

    window.menuPage.toggleFavorite(productId);
};

ModernMenuPage.prototype.renderTahmisciRecipeSummary = function (product) {
    const modalDescription = document.getElementById("modalProductDescription");
    if (!modalDescription) return;

    let panel = document.getElementById("tahmisciRecipeSummary");
    if (!panel) {
        panel = document.createElement("div");
        panel.id = "tahmisciRecipeSummary";
        panel.className = "tahmisci-recipe-summary";
        modalDescription.insertAdjacentElement("afterend", panel);
    }

    const isValidInfo = (value) => {
        const text = String(value ?? "").trim();
        if (!text) return false;
        const normalized = normalizeInfoKey(text);
        return !["0", "n/a", "undefined", "null", "kaynakta tanimli degil"].includes(normalized);
    };
    const nutritionData = this.getProductNutrition(product || {});
    const details = nutritionData.details || [];
    const normalizeInfoKey = (value) => String(value || "")
        .toLocaleLowerCase("tr-TR")
        .normalize("NFKD")
        .replace(/[\u0300-\u036f]/g, "")
        .replace(/\u0131/g, "i")
        .replace(/\u0130/g, "i");
    const findDetail = (needle) => details.find((item) => {
        const key = normalizeInfoKey(item.name);
        return key.includes(normalizeInfoKey(needle));
    });

    const contentItem = findDetail("icerik") || findDetail("içerik") || findDetail("recete") || findDetail("reçete");
    const allergenItem = findDetail("alerjen");
    const content = contentItem
        ? this.formatNutritionDisplayValue(contentItem.value, contentItem.unit)
        : (product?.description || "");
    const allergens = allergenItem
        ? this.formatNutritionDisplayValue(allergenItem.value, allergenItem.unit)
        : "";
    const calories = nutritionData.hasCalories
        ? this.formatNutritionDisplayValue(nutritionData.calories, nutritionData.caloriesUnit || "kcal")
        : "";

    const rows = [
        { label: "\u0130\u00e7erik", value: content },
        { label: "Kalori", value: calories },
        { label: "Alerjen", value: allergens }
    ].filter((row) => isValidInfo(row.value));

    panel.innerHTML = rows.map((row) => `
        <div class="tahmisci-recipe-summary-row">
            <strong>${this.escapeHtml(row.label)}</strong>
            <span>${this.escapeHtml(row.value)}</span>
        </div>
    `).join("");
    panel.style.display = rows.length ? "grid" : "none";
};

