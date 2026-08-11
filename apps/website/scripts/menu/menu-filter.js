// ========== INITIALIZE ON PAGE LOAD ==========

document.addEventListener("DOMContentLoaded", function () {
    // Initialize menu page
    window.menuPage = new ModernMenuPage();

    document.addEventListener("categoriesLoaded", () => {
        if (window.menuPage) {
            window.menuPage.initializeFilters();
            window.menuPage.initializeScrollBasedCategoryActivation();
        }
    });

    document.addEventListener("productsRendered", () => {
        if (window.menuPage) {
            window.menuPage.initializeFilters();
            window.menuPage.initializeScrollBasedCategoryActivation();
            if (window.pendingScrollToCategoryId != null) {
                window.menuPage.scrollToCategory(window.pendingScrollToCategoryId);
                window.pendingScrollToCategoryId = null;
            }
        }
    });

    // Menü DOM'da gerçekten body'nin sonunda mı? Değilse taşı
    const globalMenu = document.getElementById("moreCategoriesMenuGlobal");
    if (globalMenu && globalMenu.parentNode !== document.body) {
        document.body.appendChild(globalMenu);
    }

    // Add cart item CSS styles
    const cartItemStyles = `
        <style>
        .cart-item {
            display: flex;
            align-items: center;
            padding: 1rem;
            border-bottom: 1px solid #F4F0E7;
            gap: 1rem;
        }
        
        .cart-item-image {
            width: 60px;
            height: 60px;
            border-radius: 8px;
            overflow: hidden;
            flex-shrink: 0;
        }
        
        .cart-item-image img {
            width: 100%;
            height: 100%;
            object-fit: cover;
        }
        
        .cart-item-details {
            flex: 1;
        }
        
        .cart-item-name {
            font-size: 0.9rem;
            font-weight: 600;
            color: #2B2A28;
            margin: 0 0 0.25rem 0;
        }
        
        .cart-item-options {
            display: flex;
            flex-direction: column;
            gap: 0.25rem;
            margin-bottom: 0.5rem;
        }
        
        .cart-option {
            font-size: 0.75rem;
            color: #8C734B;
        }
        
        .cart-item-price {
            font-weight: 600;
            color: #8C734B;
            font-size: 0.9rem;
        }
        
        .cart-item-actions {
            display: flex;
            flex-direction: column;
            align-items: center;
            gap: 0.5rem;
        }
        
        .cart-item-quantity {
            display: flex;
            align-items: center;
            gap: 0.5rem;
        }
        
        .cart-item-quantity .quantity-btn {
            width: 28px;
            height: 28px;
            border: 1px solid #F4F0E7;
            background: white;
            border-radius: 6px;
            display: flex;
            align-items: center;
            justify-content: center;
            cursor: pointer;
            font-size: 0.75rem;
        }
        
        .cart-item-quantity .quantity-display {
            font-size: 0.9rem;
            font-weight: 600;
            min-width: 20px;
            text-align: center;
        }
        
        .remove-item-btn {
            background: none;
            border: none;
            color: #8C734B;
            cursor: pointer;
            padding: 0.25rem;
            border-radius: 4px;
            background: antiquewhite;
        }
        
        .remove-item-btn:hover {
            background: rgba(140, 115, 75, 0.1);
        }
        </style>
    `;

    document.head.insertAdjacentHTML("beforeend", cartItemStyles);

    // === Sticky Filter Bar ve Smooth Scroll ===
    const filterBar = document.getElementById("stickyFilterBar");
    const filterBtns = filterBar ? filterBar.querySelectorAll(".filter-btn") : [];
    let productGrid = document.getElementById("productsGrid");
    let productCards = productGrid
        ? productGrid.querySelectorAll(".product-card")
        : [];

    function refreshProductCards() {
        productGrid = document.getElementById("productsGrid");
        productCards = productGrid
            ? productGrid.querySelectorAll(".product-card")
            : [];
    }

    // Kategoriye göre ürünleri göster/gizle
    function filterProducts(category) {
        if (!productCards || productCards.length === 0) {
            refreshProductCards();
        }
        const categoryMatches = (card) =>
            category === "all" ||
            card.dataset.category === category ||
            card.dataset.parentCategory === category;
        productCards.forEach((card) => {
            if (categoryMatches(card)) {
                card.style.display = "";
            } else {
                card.style.display = "none";
            }
        });
    }

    // Filtre butonuna tıklayınca
    filterBtns.forEach((btn) => {
        btn.addEventListener("click", function () {
            filterBtns.forEach((b) => b.classList.remove("active"));
            btn.classList.add("active");
            const category = btn.dataset.category;
            filterProducts(category);
            // İlk görünen ürüne smooth scroll
            if (category === "all") {
                window.scrollTo({
                    top: filterBar.offsetTop + filterBar.offsetHeight,
                    behavior: "smooth",
                });
            } else {
                const firstCard = Array.from(productCards).find(
                    (card) =>
                        card.dataset.category === category ||
                        card.dataset.parentCategory === category,
                );
                if (firstCard) {
                    const y =
                        firstCard.getBoundingClientRect().top +
                        window.scrollY -
                        filterBar.offsetHeight -
                        12;
                    window.scrollTo({ top: y, behavior: "smooth" });
                }
            }
        });
    });

    // Sticky bar için (mobilde de çalışır)
    let lastScrollY = window.scrollY;
    let scrollTimeout;
    function updateActiveCategoryOnScroll() {
        if (!productCards || productCards.length === 0) {
            refreshProductCards();
            if (!productCards || productCards.length === 0) {
                return;
            }
        }
        // Sticky bar zaten CSS ile sticky, burada aktif kategori vurgusu için scroll takibi yapılabilir.
        // Eğer sticky bar üstte ise, aktif kategori güncellenebilir.
        let currentCategory = "all";
        let minDist = Infinity;
        const headerHeight = document.querySelector(".header")?.offsetHeight || 0;
        const filterHeight =
            document.querySelector(".menu-filters-section")?.offsetHeight || 0;
        const offset = headerHeight + filterHeight + 20;

        productCards.forEach((card) => {
            if (card.style.display !== "none") {
                const cardRect = card.getBoundingClientRect();
                const dist = Math.abs(cardRect.top - offset);
                if (dist < minDist) {
                    minDist = dist;
                    currentCategory = card.dataset.category;
                }
            }
        });

        // Aktif kategoriyi güncelle
        filterBtns.forEach((btn) => {
            btn.classList.toggle(
                "active",
                btn.dataset.category === currentCategory ||
                (currentCategory === "all" && btn.dataset.category === "all"),
            );
        });

        // Aktif kategoriyi görünür hale getir (mobilde)
        if (filterBar && window.innerWidth <= 768) {
            const activeButton = document.querySelector(
                `.filter-btn[data-category="${currentCategory}"]`,
            );
            if (activeButton) {
                const containerRect = filterBar.getBoundingClientRect();
                const buttonRect = activeButton.getBoundingClientRect();

                // Eğer buton container'ın dışındaysa scroll et
                if (
                    buttonRect.left < containerRect.left ||
                    buttonRect.right > containerRect.right
                ) {
                    const scrollLeft =
                        activeButton.offsetLeft -
                        containerRect.width / 2 +
                        buttonRect.width / 2;
                    filterBar.scrollTo({
                        left: scrollLeft,
                        behavior: "smooth",
                    });
                }
            }
        }

        lastScrollY = window.scrollY;
    }

    window.addEventListener("scroll", function () {
        clearTimeout(scrollTimeout);
        scrollTimeout = setTimeout(() => {
            updateActiveCategoryOnScroll();
        }, 50); // 50ms debounce
    });

    document.addEventListener("productsRendered", () => {
        refreshProductCards();
        updateActiveCategoryOnScroll();
    });

    // Mobilde yatay scroll için swipe desteği (opsiyonel)
    if (filterBar) {
        let isDown = false,
            startX,
            scrollLeft;
        filterBar.addEventListener("mousedown", (e) => {
            isDown = true;
            filterBar.classList.add("dragging");
            startX = e.pageX - filterBar.offsetLeft;
            scrollLeft = filterBar.scrollLeft;
        });
        filterBar.addEventListener("mouseleave", () => {
            isDown = false;
            filterBar.classList.remove("dragging");
        });
        filterBar.addEventListener("mouseup", () => {
            isDown = false;
            filterBar.classList.remove("dragging");
        });
        filterBar.addEventListener("mousemove", (e) => {
            if (!isDown) return;
            e.preventDefault();
            const x = e.pageX - filterBar.offsetLeft;
            const walk = (x - startX) * 1.5;
            filterBar.scrollLeft = scrollLeft - walk;
        });
    }

    // Responsive filter-btn overflow: Sığmayanları Daha'ya taşı
    function updateFilterButtonsOverflow() {
        const container = document.querySelector(".filter-categories");
        const moreBtn = document.getElementById("moreCategoriesBtn");
        const moreMenu = document.getElementById("moreCategoriesMenu");
        if (!container || !moreBtn || !moreMenu) return;

        // Tüm butonları geri ana menüye al
        const overflowBtns = Array.from(moreMenu.querySelectorAll(".filter-btn"));
        overflowBtns.forEach((btn) => container.insertBefore(btn, moreBtn));

        // Mobilde çalışsın
        if (window.innerWidth > 991) {
            moreBtn.style.display = "";
            moreMenu.innerHTML = "";
            return;
        }

        // Sığmayanları bul
        const containerRect = container.getBoundingClientRect();
        let lastRight = moreBtn.offsetLeft + moreBtn.offsetWidth;
        let foundOverflow = false;
        const btns = Array.from(
            container.querySelectorAll(".filter-btn:not(.dropdown-toggle)"),
        );
        btns.forEach((btn) => {
            const btnRect = btn.getBoundingClientRect();
            if (btnRect.right > containerRect.right - moreBtn.offsetWidth - 8) {
                moreMenu.appendChild(btn);
                foundOverflow = true;
            }
        });
        // Eğer hiç taşan yoksa Daha butonunu gizle
        moreBtn.style.display = foundOverflow ? "" : "none";
    }

    window.addEventListener("resize", updateFilterButtonsOverflow);
    document.addEventListener("DOMContentLoaded", updateFilterButtonsOverflow);

    // Ürün kartına tıklayınca modal aç (mobil ve masaüstü)
    setTimeout(function () {
        const productCards = document.querySelectorAll(
            ".product-card, .modern-product-card",
        );
        productCards.forEach((card) => {
            card.style.cursor = "pointer";
            card.addEventListener("click", function (e) {
                // Sadece kartın içindeki butonlara tıklanmadıysa modal aç
                if (e.target.closest("button, .btn, .product-favorite")) return;
                const id = card.dataset.id || card.getAttribute("data-id");
                if (id) openProductModal(parseInt(id));
            });
            // Kart içindeki butonlara tıklanınca bubbling'i engelle
            const buttons = card.querySelectorAll("button, .btn, .product-favorite");
            buttons.forEach((btn) => {
                btn.addEventListener("click", function (ev) {
                    ev.stopPropagation();
                });
            });
        });
    }, 300);
});

// ========== KEYBOARD SHORTCUTS ==========

document.addEventListener("keydown", function (e) {
    // ESC key to close modals
    if (e.key === "Escape") {
        if (window.menuPage) {
            window.menuPage.closeProductModal();
            window.menuPage.closeCartDrawer();
        }
    }
});

// Sepete ekleme fonksiyonunu düzelt: Sadece isimleri kaydet
function getSelectedOptions() {
    // Boyut
    const selectedSizeInput = document.querySelector(
        'input[name="size"]:checked',
    );
    const size = selectedSizeInput ? selectedSizeInput.value : null;
    // Ekstralar
    const selectedExtraInputs = document.querySelectorAll(
        'input[name="extra"]:checked',
    );
    const extras = Array.from(selectedExtraInputs).map((input) => input.value);
    return { size, extras };
}

// Mobil filtre slider okları
function scrollFilterCategories(direction) {
    const container = document.querySelector(".filter-categories");
    if (!container) return;
    const scrollAmount = 120;
    if (direction === "left") {
        container.scrollBy({ left: -scrollAmount, behavior: "smooth" });
    } else {
        container.scrollBy({ left: scrollAmount, behavior: "smooth" });
    }
}

function setupFilterArrows() {
    const leftArrow = document.getElementById("filterArrowLeft");
    const rightArrow = document.getElementById("filterArrowRight");
    if (leftArrow && rightArrow) {
        leftArrow.addEventListener("click", function () {
            scrollFilterCategories("left");
        });
        rightArrow.addEventListener("click", function () {
            scrollFilterCategories("right");
        });
    }
}

document.addEventListener("DOMContentLoaded", setupFilterArrows);

document.addEventListener("DOMContentLoaded", function () {
    var moreBtn = document.getElementById("moreCategoriesBtn");
    var moreMenu = document.getElementById("moreCategoriesMenu");
    var dropdown = moreBtn ? moreBtn.closest(".filter-dropdown") : null;
    if (moreBtn && dropdown) {
        moreBtn.addEventListener("click", function (e) {
            e.stopPropagation();
            dropdown.classList.toggle("open");
        });
        document.addEventListener("click", function (e) {
            if (!dropdown.contains(e.target)) {
                dropdown.classList.remove("open");
            }
        });
    }
});

function updateFixedCartBtnVisibility() {
    const cartDrawer = document.getElementById("cartDrawerOverlay");
    const productModal = document.querySelector(".product-modal-overlay");
    const btn = document.getElementById("fixedCartBtn");
    if (!btn) return;

    // Hide on mobile devices (max-width: 991px)
    if (window.innerWidth <= 991) {
        btn.style.setProperty("display", "none", "important");
        btn.style.setProperty("visibility", "hidden", "important");
        btn.style.setProperty("opacity", "0", "important");
        btn.style.setProperty("pointer-events", "none", "important");
        return;
    }

    const cartOpen = cartDrawer && cartDrawer.classList.contains("active");
    const modalOpen = productModal && productModal.classList.contains("active");

    if (cartOpen || modalOpen) {
        btn.style.setProperty("display", "none", "important");
        btn.style.setProperty("visibility", "hidden", "important");
        btn.style.setProperty("opacity", "0", "important");
        btn.style.setProperty("pointer-events", "none", "important");
    } else {
        btn.style.setProperty("display", "flex", "important");
        btn.style.setProperty("visibility", "visible", "important");
        btn.style.setProperty("opacity", "1", "important");
        btn.style.setProperty("pointer-events", "auto", "important");
    }
}

// Sepet drawer ve ürün modalı açılıp kapandığında kontrol et
document.addEventListener("DOMContentLoaded", function () {
    // Sabit sepet butonunu varsayılan olarak görünür yap (sadece desktop'ta)
    const btn = document.getElementById("fixedCartBtn");
    if (btn) {
        // Hide on mobile devices
        if (window.innerWidth <= 991) {
            btn.style.display = "none";
            btn.style.visibility = "hidden";
            btn.style.opacity = "0";
            btn.style.pointerEvents = "none";
        } else {
            btn.style.display = "flex";
            btn.style.visibility = "visible";
            btn.style.opacity = "1";
            btn.style.position = "fixed";
            btn.style.right = "18px";
            btn.style.bottom = "18px";
            btn.style.zIndex = "99999";
        }
        btn.style.width = "58px";
        btn.style.height = "58px";
        btn.style.background = "#8C734B";
        btn.style.color = "#FAF8F2";
        btn.style.boxShadow = "0 4px 24px rgba(46, 36, 24, 0.18)";
        btn.style.alignItems = "center";
        btn.style.justifyContent = "center";
        btn.style.fontSize = "2.1em";
        btn.style.border = "none";
        btn.style.cursor = "pointer";
    }

    updateFixedCartBtnVisibility();

    // Sepet modalı scroll kontrolü
    setupCartScrollControl();

    // Sepet drawer
    const cartDrawer = document.getElementById("cartDrawerOverlay");
    if (cartDrawer) {
        cartDrawer.addEventListener("transitionend", updateFixedCartBtnVisibility);
        cartDrawer.addEventListener("click", function () {
            setTimeout(updateFixedCartBtnVisibility, 100);
        });
    }

    // Ürün modalı
    const productModal = document.querySelector(".product-modal-overlay");
    if (productModal) {
        productModal.addEventListener(
            "transitionend",
            updateFixedCartBtnVisibility,
        );
        productModal.addEventListener("click", function () {
            setTimeout(updateFixedCartBtnVisibility, 100);
        });
        // Modal açıldığında hemen gizle
        productModal.addEventListener("DOMNodeInserted", function () {
            if (productModal.classList.contains("active")) {
                updateFixedCartBtnVisibility();
            }
        });
    }

    // Fallback: Her tıklamada da kontrol et
    document.body.addEventListener("click", function () {
        setTimeout(updateFixedCartBtnVisibility, 100);
    });
});

// Sayfa yüklendiğinde ve her etkileşimde kontrol et
["DOMContentLoaded", "click", "transitionend", "keyup"].forEach((evt) => {
    document.addEventListener(evt, updateFixedCartBtnVisibility);
});

// Global erişim için
window.updateFixedCartBtnVisibility = updateFixedCartBtnVisibility;

// YENİ: Sepet modalı scroll kontrolü
function setupCartScrollControl() {
    // Elementleri bul
    const cartContent = document.querySelector(".cart-drawer-content");
    const cartNextBtn = document.getElementById("cartNextBtn");
    const cartFeatures = document.getElementById("cartFeatures");

    // Elementler varsa scroll event'i ekle
    if (cartContent && cartNextBtn) {
        cartContent.addEventListener("scroll", function () {
            const scrollTop = cartContent.scrollTop;
            const scrollHeight = cartContent.scrollHeight;
            const clientHeight = cartContent.clientHeight;
            const scrollPercentage = (scrollTop + clientHeight) / scrollHeight;

            // %70'e gelince değiştir
            if (scrollPercentage >= 0.7) {
                cartNextBtn.innerHTML =
                    'Ödeme Adımına Git <i class="fas fa-chevron-right"></i>';
                cartNextBtn.style.background = "#8C734B";
                cartNextBtn.style.fontWeight = "700";

                if (cartFeatures) {
                    cartFeatures.style.display = "flex";
                    // Sepet bilgilerini güncelle
                    updateCartInfo();
                }
            } else {
                cartNextBtn.innerHTML = 'Sonraki <i class="fas fa-chevron-right"></i>';
                cartNextBtn.style.background = "var(--color-primary)";
                cartNextBtn.style.fontWeight = "600";

                if (cartFeatures) {
                    cartFeatures.style.display = "none";
                }
            }
        });

        // Sonraki butonuna tıklama olayı ekle
        cartNextBtn.addEventListener("click", function () {
            // Hem "Sonraki" hem de "Ödeme Adımına Git" için siparis'e yönlendir
            window.location.href = "siparis";
        });
    }
}

// Sonraki butonuna tıklama (backup listener)
const cartNextBtn = document.getElementById("cartNextBtn");
if (cartNextBtn) {
    cartNextBtn.addEventListener("click", function () {
        // siparis sayfasına yönlendir
        window.location.href = "siparis";
    });
}

// Alt toplam tutarını ve sepet bilgilerini güncelle
function updateCartBottomTotal() {
    const cartBottomTotalAmount = document.getElementById(
        "cartBottomTotalAmount",
    );
    const cartTotalAmount = document.getElementById("cartTotalAmount");

    if (cartBottomTotalAmount && cartTotalAmount) {
        cartBottomTotalAmount.textContent = cartTotalAmount.textContent;
    }

    // Sepet bilgilerini güncelle
    updateCartInfo();
}

// Sepet bilgilerini güncelle
function updateCartInfo() {
    const cartItemCount = document.getElementById("cartItemCount");

    let totalItems = 0;

    // Global cart'ı kontrol et
    if (window.globalCart) {
        if (window.globalCart.getCartItemCount) {
            totalItems = window.globalCart.getCartItemCount();
        } else if (
            window.globalCart.cart &&
            Array.isArray(window.globalCart.cart)
        ) {
            totalItems = window.globalCart.cart.reduce(
                (sum, item) => sum + (item.quantity || 1),
                0,
            );
        }
    } else if (window.menuPage && window.menuPage.getCartItemCount) {
        totalItems = window.menuPage.getCartItemCount();
    }

    // Ürün sayısını güncelle
    if (cartItemCount) {
        cartItemCount.textContent = `${totalItems} Ürün`;
    }
}

// Sepet butonlarını gizle
function hideCartButtons() {
    const cartButtons = document.querySelectorAll(".cart-btn, .fixed-cart-btn");
    cartButtons.forEach((btn) => {
        btn.style.setProperty("display", "none", "important");
    });
    // mobile-cart-btn'i gizleme, sadece drawer açıkken gizli olsun
}

// Sepet butonlarını göster
function showCartButtons() {
    const cartButtons = document.querySelectorAll(".cart-btn, .fixed-cart-btn");
    cartButtons.forEach((btn) => {
        btn.style.removeProperty("display");
    });
    // mobile-cart-btn zaten görünür, dokunma
}

// Global scope'a ekle
window.hideCartButtons = hideCartButtons;
window.showCartButtons = showCartButtons;

// Global cart update fonksiyonunu yakala
if (window.globalCart && window.globalCart.updateCartDisplay) {
    const originalUpdateCartDisplay = window.globalCart.updateCartDisplay;
    window.globalCart.updateCartDisplay = function () {
        originalUpdateCartDisplay.call(this);
        updateCartBottomTotal();
    };
}

// Cart drawer açıldığında da güncelle
if (window.globalCart && window.globalCart.renderCartItems) {
    const originalRenderCartItems = window.globalCart.renderCartItems;
    window.globalCart.renderCartItems = function () {
        originalRenderCartItems.call(this);
        updateCartBottomTotal();
    };
}

// Sayfa yüklendiğinde ilk güncellemeyi yap
setTimeout(updateCartBottomTotal, 500);

// ========== SCROLL İLE KATEGORİ BUTONU AKTİFLEŞTİRME ==========
document.addEventListener("DOMContentLoaded", function () {
    const filterButtons = document.querySelectorAll(".filter-btn[data-category]");
    const filterCategories = document.querySelector(".filter-categories");
    const anchors = document.querySelectorAll(".category-anchor[data-category]");
    const header = document.querySelector(".header");

    if (!filterButtons.length || !anchors.length) return;

    // IntersectionObserver ile anchorları gözlemle
    let lastActive = null;
    const observer = new IntersectionObserver(
        (entries) => {
            entries.forEach((entry) => {
                if (entry.isIntersecting) {
                    const category = entry.target.dataset.category;
                    if (lastActive !== category) {
                        lastActive = category;
                        filterButtons.forEach((btn) => {
                            if (btn.dataset.category === category) {
                                btn.classList.add("active");
                                // Butonu ortala
                                if (filterCategories && btn.scrollIntoView) {
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
                    }
                }
            });
        },
        {
            root: null,
            rootMargin: "-100px 0px -60% 0px", // header ve filter bar yüksekliği kadar offset
            threshold: 0.2,
        },
    );
    anchors.forEach((anchor) => observer.observe(anchor));
});

// ========== MOBİL TARAYICI CHROME DETECTION ==========

// ========== DODO PIZZA STYLE NAVIGATION ==========

// Initialize cart drawer buttons when page loads
document.addEventListener("DOMContentLoaded", function () {
    // Initialize cart drawer buttons
    const continueBtn = document.getElementById("cartContinueBtn");
    const checkoutBtn = document.getElementById("cartCheckoutBtn");

    if (continueBtn) {
        continueBtn.addEventListener("click", () => {
            // Close cart drawer
            if (window.menuPage) {
                window.menuPage.closeCartDrawer();
            }
        });
    }

    if (checkoutBtn) {
        checkoutBtn.addEventListener("click", () => {
            // Navigate to cart page
            window.location.href = "siparis";
        });
    }

    // Initialize cart scroll control
    setupCartScrollControl();

    // Ayrıca timeout ile de çağır (delayed initialization)
    setTimeout(() => {
        setupCartScrollControl();
    }, 1000);
});

// ========== MENU ENTRY SELECTION (BRANCH + ORDER TYPE) ==========
(function () {
    const STORAGE_KEYS = {
        branchId: "menuBranchId",
        orderType: "menuOrderType",
        tableId: "menuTableId",
        branchSelectionType: "menuBranchSelectionType", // "qr" veya "manual"
    };

    function getParams() {
        return new URLSearchParams(window.location.search);
    }

    function getOrderTypeFromParams(params) {
        const type = params.get("type");
        if (
            type === "tableMenu" ||
            type === "tableOrder" ||
            type === "takeaway" ||
            type === "delivery"
        ) {
            return type;
        }
        if (type === "table") {
            return params.get("table") ? "tableOrder" : "tableMenu";
        }
        if (params.get("g") === "1") return "takeaway";
        if (params.get("w") === "1") return "delivery";
        if (params.get("table")) return "tableOrder";
        // Eğer sadece company_id varsa ve başka parametre yoksa tableMenu döndür
        if (
            params.get("company_id") &&
            !type &&
            params.get("g") !== "1" &&
            params.get("w") !== "1"
        ) {
            return "tableMenu";
        }
        return null;
    }

    function getTableFromParams(params) {
        return params.get("table") || params.get("t") || null;
    }

    // Menü sayfasında URL'deki company_id / type'ı hemen işle; ürünler yüklensin (dispatch sonraki tick'te ki dinleyiciler hazır olsun)
    (function applyUrlParamsSync() {
        var path = window.location.pathname || '';
        if (path.indexOf('menuler') === -1) return;
        var params = getParams();
        var urlBranchId = params.get('company_id');
        var urlOrderType = getOrderTypeFromParams(params);
        if (urlBranchId) {
            localStorage.setItem(STORAGE_KEYS.branchId, urlBranchId);
            localStorage.setItem(STORAGE_KEYS.branchSelectionType, 'qr');
        }
        if (urlOrderType) {
            localStorage.setItem(STORAGE_KEYS.orderType, urlOrderType);
        }
        if (urlBranchId || urlOrderType) {
            var branchId = localStorage.getItem(STORAGE_KEYS.branchId);
            var orderType = localStorage.getItem(STORAGE_KEYS.orderType) || 'tableMenu';
            var ev = new CustomEvent('menuSelectionChanged', {
                detail: { branchId: branchId, orderType: orderType, tableId: null }
            });
            setTimeout(function () {
                document.dispatchEvent(ev);
            }, 0);
        }
    })();

    function setBodyLock(locked) {
        document.body.style.overflow = locked ? "hidden" : "";
    }

    function openModal(modal) {
        if (!modal) return;
        modal.classList.add("active");
        setBodyLock(true);

        // Şube seçim modalı açıldığında listeyi yeniden render et
        if (modal.id === "branchSelectModal") {
            renderBranches();
        }

        // Masa seçim modalı açıldığında close butonunu kontrol et
        if (modal.id === "tableSelectModal" && tableSelectModalClose) {
            const storedTableId = localStorage.getItem(STORAGE_KEYS.tableId);
            tableSelectModalClose.style.display = storedTableId ? "flex" : "none";
        }
    }

    function closeModal(modal) {
        if (!modal) return;
        modal.classList.remove("active");
        if (
            !document.querySelector(".selection-modal-overlay.active") &&
            !document.querySelector(".auth-modal-overlay.active") &&
            !document.querySelector(".product-modal-overlay.active")
        ) {
            setBodyLock(false);
        }
    }

    async function initSelectionFlow(data) {
        // The public brand site is browse-only. The legacy order-selection flow
        // must never open a modal (or leave body overflow locked) on this page.
        if (document.body?.classList.contains("tahmisci-static-menu")) {
            document.querySelectorAll(".selection-modal-overlay.active").forEach((modal) => {
                modal.classList.remove("active");
            });
            setBodyLock(false);
            return;
        }
        if (window.TahmisciCatalog) return;
        const app = data?.app || {};
        const branches = Array.isArray(app.branches) ? app.branches : [];
        const orderTypeLabels = app.orderTypeLabels || {};
        const tablesEndpoint = app.tablesEndpoint || "";
        const isMultiBranch = app.isMultiBranch && branches.length > 1;
        const defaultBranchId = app.defaultBranchId || branches[0]?.id || null;

        const branchModal = document.getElementById("branchSelectModal");
        const orderModal = document.getElementById("orderTypeModal");
        const tableModal = document.getElementById("tableSelectModal");
        const branchList = document.getElementById("branchList");
        const orderTypeList = document.getElementById("orderTypeList");
        const orderTypeBackBtn = document.getElementById("orderTypeBackBtn");
        const tableList = document.getElementById("tableList");
        const tableBackBtn = document.getElementById("tableBackBtn");
        const tableSelectModalClose = document.getElementById(
            "tableSelectModalClose",
        );
        const tableSearchInput = document.getElementById("tableSearchInput");
        const tableSearchClear = document.getElementById("tableSearchClear");
        const branchSearchInput = document.getElementById("branchSearchInput");
        const branchSearchClear = document.getElementById("branchSearchClear");
        const branchSearchWrap = document.getElementById("branchSearchWrap");
        const selectionStatusBtn = document.getElementById("selectionStatusBtn");
        const selectionStatusText = selectionStatusBtn?.querySelector(
            ".selection-status-text",
        );
        const qrScanBtn = document.getElementById("qrScanBtn");
        const qrScanModal = document.getElementById("qrScanModal");
        const qrScanReader = document.getElementById("qrScanReader");
        const qrScanStatus = document.getElementById("qrScanStatus");
        const qrScanCloseBtn = document.getElementById("qrScanCloseBtn");

        if (
            !branchModal ||
            !orderModal ||
            !tableModal ||
            !branchList ||
            !orderTypeList ||
            !tableList
        ) {
            return;
        }

        const params = getParams();
        const urlBranchId = params.get("company_id");
        const urlOrderType = getOrderTypeFromParams(params);
        const urlTableId = getTableFromParams(params);
        const urlToken = params.get("token");

        // URL parametrelerini localStorage'e kaydet
        if (urlBranchId) {
            localStorage.setItem(STORAGE_KEYS.branchId, urlBranchId);
            // QR ile geldiğini işaretle
            localStorage.setItem(STORAGE_KEYS.branchSelectionType, "qr");
        }
        if (urlOrderType) {
            localStorage.setItem(STORAGE_KEYS.orderType, urlOrderType);
            if (urlOrderType === "tableOrder" || urlOrderType === "tableMenu") {
                try { localStorage.removeItem("guestOrder"); } catch (e) { }
                try { localStorage.removeItem("yeppos_guest_order_contact"); } catch (e) { }
                try { localStorage.removeItem("yeppos_guest_delivery_address"); } catch (e) { }
            }
        }

        const isReservationPage =
            document.body?.classList.contains("reservation-page") ||
            /(?:^|\/)(rezervasyon|reservation)(?:\.php)?\/?$/i.test(
                window.location.pathname || "",
            );

        function openOrderTypeModal() {
            if (isReservationPage) return;
            openModal(orderModal);
        }
        if (urlTableId) {
            localStorage.setItem(STORAGE_KEYS.tableId, urlTableId);
        }
        if (urlToken) {
            localStorage.setItem("tableOrderToken", urlToken);
        }

        // Eğer URL'den hiçbir parametre gelmediyse ve branchSelectionType yoksa manuel olarak işaretle
        if (!urlBranchId && !urlOrderType && !urlTableId && !urlToken) {
            const existingType = localStorage.getItem(
                STORAGE_KEYS.branchSelectionType,
            );
            if (!existingType) {
                localStorage.setItem(STORAGE_KEYS.branchSelectionType, "manual");
            }
        }

        // URL'den aldıktan sonra temizle
        if (urlBranchId || urlOrderType || urlTableId) {
            cleanUrl();
        }

        // localStorage'den al
        let selectedBranchId = localStorage.getItem(STORAGE_KEYS.branchId);
        let selectedOrderType = localStorage.getItem(STORAGE_KEYS.orderType);

        // Tek şube: otomatik seç, tüm localStorage'ı seçilmiş şube gibi doldur
        if (branches.length === 1 && !isMultiBranch) {
            const singleBranch = branches[0];
            const branchId = String(singleBranch.id);
            selectedBranchId = branchId;
            localStorage.setItem(STORAGE_KEYS.branchId, branchId);
            localStorage.setItem("menuCompanyId", branchId);
            localStorage.setItem(STORAGE_KEYS.branchSelectionType, "auto");
        } else if (!selectedBranchId && defaultBranchId) {
            selectedBranchId = String(defaultBranchId);
            localStorage.setItem(STORAGE_KEYS.branchId, selectedBranchId);
        }

        // Token'dan masa bilgisini çek ve otomatik seç (tableOrder için)
        async function resolveTableFromTokenSilent(token) {
            try {
                const lang = getAjaxLang();
                const url = getSiteRoot() + `/yeppanel/db/ajax/web/table-token.php?token=${encodeURIComponent(token)}&lang=${encodeURIComponent(lang)}`;
                console.log("Token API çağrısı yapılıyor:", url);
                const response = await fetch(url);
                const result = await response.json();
                console.log("Token API yanıtı:", result);

                if (result?.success && result.data?.table_id) {
                    return {
                        branchId: result.data.branch_id,
                        tableId: result.data.table_id,
                        tableName: result.data.table_name || null,
                    };
                }
            } catch (error) {
                console.error("Token resolve error:", error);
            }
            return null;
        }

        // URL'den token varsa veya localStorage'da token varsa kullan
        const tokenToUse = urlToken || localStorage.getItem("tableOrderToken");
        if (selectedOrderType === "tableOrder" && tokenToUse && !urlTableId) {
            const resolved = await resolveTableFromTokenSilent(tokenToUse);
            if (resolved?.tableId) {
                // Token'dan gelen branch_id varsa onu kullan, yoksa mevcut branch_id'yi kullan
                const finalBranchId = resolved.branchId || selectedBranchId;
                // Masa bilgisini localStorage'a kaydet (table_id = yep_tables.tables_id)
                localStorage.setItem(STORAGE_KEYS.tableId, String(resolved.tableId));
                localStorage.setItem(STORAGE_KEYS.branchId, String(finalBranchId));
                if (resolved.tableName) {
                    try { localStorage.setItem("menuTableName", String(resolved.tableName)); } catch (e) { }
                }
                selectedBranchId = String(finalBranchId);
            }
        }

        function cleanUrl() {
            // URL'den parametreleri temizle, sadece base URL kalsın
            const url = new URL(window.location.href);
            const cleanPath = url.origin + url.pathname;
            window.history.replaceState({}, document.title, cleanPath);
        }

        function getCurrentBranch() {
            return (
                branches.find((b) => String(b.id) === String(selectedBranchId)) ||
                branches.find((b) => b.isDefault) ||
                branches[0] ||
                null
            );
        }

        // Seçili sipariş tipi bu şubede kapalıysa (panelden kapatılmışsa) tableMenu'ye geçir ve bilgilendir
        const currentBranch = getCurrentBranch();
        if (
            currentBranch &&
            selectedOrderType &&
            currentBranch.orderTypes &&
            currentBranch.orderTypes[selectedOrderType] === false
        ) {
            selectedOrderType = "tableMenu";
            localStorage.setItem(STORAGE_KEYS.orderType, selectedOrderType);
            if (window.Swal && typeof window.Swal.fire === "function") {
                const title = window.I18N?.t?.("order_type_disabled_redirect_title", "Sipariş tipi değişti");
                const text = window.I18N?.t?.("order_type_disabled_redirect_text", "Seçtiğiniz sipariş tipi bu şubede artık sunulmuyor. Masa menüsüne yönlendirildiniz.");
                window.Swal.fire({
                    title: title,
                    text: text,
                    icon: "info",
                    confirmButtonText: window.I18N?.t?.("ok", "Tamam"),
                    confirmButtonColor: "#8C734B",
                });
            }
        }

        function renderBranches() {
            branchList.innerHTML = "";
            const currentSelectedId = localStorage.getItem(STORAGE_KEYS.branchId);
            const selectionType = localStorage.getItem(
                STORAGE_KEYS.branchSelectionType,
            );

            // selectedBranchId değişkenini güncelle
            if (currentSelectedId) {
                selectedBranchId = String(currentSelectedId);
            }

            // Seçili şubeyi bul ve en üste taşı
            const selectedBranch = branches.find(
                (b) => String(b.id) === String(currentSelectedId),
            );
            const otherBranches = branches.filter(
                (b) => String(b.id) !== String(currentSelectedId),
            );
            let sortedBranches = selectedBranch
                ? [selectedBranch, ...otherBranches]
                : branches;

            const branchSearchQuery = (branchSearchInput && branchSearchInput.value.trim()) || "";
            if (branchSearchQuery) {
                const q = branchSearchQuery.toLowerCase();
                sortedBranches = sortedBranches.filter(
                    (b) =>
                        (b.name || "").toLowerCase().includes(q) ||
                        (b.city || "").toLowerCase().includes(q) ||
                        (b.district || "").toLowerCase().includes(q),
                );
            }

            sortedBranches.forEach((branch) => {
                const isSelected = String(branch.id) === String(currentSelectedId);
                const item = document.createElement("button");
                item.type = "button";
                item.className = "selection-item";
                if (isSelected) {
                    item.classList.add("selected");
                }
                item.dataset.branchId = branch.id;

                const badgeText = isSelected ? '<i class="fas fa-check"></i>' : "Seç";
                item.innerHTML = `
          <div>
            <div class="selection-item-title">${branch.name}</div>
            <div class="selection-item-subtitle">${[branch.district, branch.city].filter(Boolean).join(" / ") || ""}</div>
          </div>
          <span class="selection-item-badge">${badgeText}</span>
        `;
                item.addEventListener("click", () => {
                    selectedBranchId = String(branch.id);
                    localStorage.setItem(STORAGE_KEYS.branchId, selectedBranchId);
                    // Manuel seçim yapıldığını işaretle
                    localStorage.setItem(STORAGE_KEYS.branchSelectionType, "manual");
                    // Store company id for backend inserts (if available)
                    try {
                        if (branch.companyId !== undefined && branch.companyId !== null) {
                            localStorage.setItem("menuCompanyId", String(branch.companyId));
                        } else if (
                            branch.company_id !== undefined &&
                            branch.company_id !== null
                        ) {
                            localStorage.setItem("menuCompanyId", String(branch.company_id));
                        } else {
                            // fallback: use branch id as company id in demo mode
                            localStorage.setItem("menuCompanyId", String(branch.id));
                        }
                    } catch (e) {
                        // ignore
                    }
                    closeModal(branchModal);
                    openOrderTypeModal();
                    renderOrderTypes();
                    updateSelectionStatus();
                    emitSelectionChanged();
                });
                branchList.appendChild(item);
            });
        }

        function renderOrderTypes() {
            orderTypeList.innerHTML = "";
            const currentBranch = getCurrentBranch();
            const enabledTypes = Object.entries(orderTypeLabels).filter(
                ([key]) => currentBranch?.orderTypes?.[key],
            );

            // Seçili sipariş tipini güncelle
            const currentOrderType = localStorage.getItem(STORAGE_KEYS.orderType);
            if (currentOrderType) {
                selectedOrderType = currentOrderType;
            }

            // QR ile gelmişse geri butonunu gizle
            if (orderTypeBackBtn) {
                const selectionType = localStorage.getItem(
                    STORAGE_KEYS.branchSelectionType,
                );
                orderTypeBackBtn.style.display =
                    selectionType === "qr" ? "none" : "flex";
            }

            // Sipariş tiplerinde sıralama değişmesin - seçili olsa bile yerinde kalsın
            const sortedTypes = enabledTypes;

            // Sipariş tipi ikon ve renkleri
            const orderTypeConfig = {
                tableMenu: {
                    icon: "fa-utensils",
                    color: "#5A4A31",
                    bgColor: "rgba(90, 74, 49, 0.1)",
                },
                tableOrder: {
                    icon: "fa-table",
                    color: "#8C734B",
                    bgColor: "rgba(140, 115, 75, 0.1)",
                },
                takeaway: {
                    icon: "fa-shopping-bag",
                    color: "#8C734B",
                    bgColor: "#8C734B",
                },
                delivery: {
                    icon: "fa-truck",
                    color: "#C7B28C",
                    bgColor: "#C7B28C",
                },
            };

            sortedTypes.forEach(([key, value]) => {
                const config = orderTypeConfig[key] || {
                    icon: "fa-circle",
                    color: "#8C734B",
                    bgColor: "rgba(140, 115, 75, 0.1)",
                };

                const isSelected = key === selectedOrderType;
                const item = document.createElement("button");
                item.type = "button";
                item.className = "selection-item order-type-item";
                if (isSelected) {
                    item.classList.add("selected");
                }
                item.dataset.orderType = key;
                item.style.setProperty("--order-type-color", config.color);
                item.style.setProperty("--order-type-bg", config.bgColor);

                const badgeText = isSelected ? '<i class="fas fa-check"></i>' : "Seç";
                item.innerHTML = `
          <div class="order-type-item-content">
            <div class="order-type-icon" style="background: ${config.bgColor}; color: ${config.color};">
              <i class="fas ${config.icon}"></i>
            </div>
            <div class="order-type-text">
              <div class="selection-item-title" style="color: ${config.color};">${value.label || key}</div>
              ${value.description ? `<div class="selection-item-subtitle">${value.description}</div>` : ""}
            </div>
          </div>
          <span class="selection-item-badge">${badgeText}</span>
        `;

                item.addEventListener("click", () => {
                    selectedOrderType = key;
                    localStorage.setItem(STORAGE_KEYS.orderType, selectedOrderType);

                    // Masa / Masa menü seçilirse misafir alışverişi kaldır (sadece Paket ve Gel-Al'da geçerli)
                    if (key === "tableOrder" || key === "tableMenu") {
                        const hadGuest = localStorage.getItem("guestOrder") === "1";
                        try { localStorage.removeItem("guestOrder"); } catch (e) { }
                        try { localStorage.removeItem("yeppos_guest_order_contact"); } catch (e) { }
                        try { localStorage.removeItem("yeppos_guest_delivery_address"); } catch (e) { }
                        if (hadGuest) {
                            const msg = window.I18N?.t?.("guest_removed_for_table_type", "Misafir seçimi sadece Paket ve Gel-Al için geçerlidir. Masa siparişi/masa menüsü seçildiği için misafir kaldırıldı.");
                            if (msg && window.Swal && typeof window.Swal.fire === "function") {
                                window.Swal.fire({ text: msg, icon: "info", toast: true, timer: 4000 });
                            }
                        }
                    }

                    // Sipariş tipi seçildiğinde listeyi yeniden render et (seçili item'ı göstermek için)
                    renderOrderTypes();

                    if (selectedOrderType === "tableOrder") {
                        closeModal(orderModal);
                        openModal(tableModal);
                        loadTablesForBranch();
                    } else {
                        closeModal(orderModal);
                        if (document.getElementById("orderPage")) window.location.reload();
                    }
                    updateSelectionStatus();
                    emitSelectionChanged();
                });
                orderTypeList.appendChild(item);
            });
        }

        let cachedTables = [];

        function renderTables(tables = []) {
            tableList.innerHTML = "";
            if (!tables.length) {
                tableList.innerHTML = `<div class="selection-list-loading">Masa bulunamadı.</div>`;
                return;
            }

            // Seçili masayı bul ve en üste taşı
            const currentTableId = localStorage.getItem(STORAGE_KEYS.tableId);
            const selectedTable = tables.find(
                (t) => String(t.id) === String(currentTableId),
            );
            const otherTables = tables.filter(
                (t) => String(t.id) !== String(currentTableId),
            );
            const sortedTables = selectedTable
                ? [selectedTable, ...otherTables]
                : tables;

            sortedTables.forEach((table) => {
                const isSelected = String(table.id) === String(currentTableId);
                const item = document.createElement("button");
                item.type = "button";
                item.className = "selection-item table-item";
                if (isSelected) {
                    item.classList.add("selected");
                }
                item.dataset.tableId = table.id;
                const status = table.status || "available";
                const statusLabel =
                    status === "occupied"
                        ? "Dolu"
                        : status === "reserved"
                            ? "Rezerve"
                            : "Boş";
                // Seçili masaya disabled ekleme
                if (status !== "available" && !isSelected) {
                    item.classList.add("disabled");
                }

                const badgeText = isSelected
                    ? '<i class="fas fa-check"></i>'
                    : statusLabel;
                const badgeClass = isSelected
                    ? "selection-item-badge"
                    : `selection-item-status ${status}`;

                item.innerHTML = `
          <div class="table-item-content">
            <div class="table-item-icon">
              <i class="fas fa-table"></i>
            </div>
            <div class="table-item-text">
              <div class="selection-item-title">${table.name}</div>
              <div class="selection-item-subtitle">${table.area || ""}</div>
            </div>
          </div>
          <span class="${badgeClass}">${badgeText}</span>
        `;
                item.addEventListener("click", () => {
                    // Seçili masayı her zaman seçilebilir yap, diğerlerinde status kontrolü yap
                    if (status !== "available" && !isSelected) return;
                    const selectedTableId = String(table.id);
                    localStorage.setItem(STORAGE_KEYS.tableId, selectedTableId);
                    // Store table label details for order page (name + area)
                    try {
                        if (table.name)
                            localStorage.setItem("menuTableName", String(table.name));
                        if (table.area)
                            localStorage.setItem("menuTableArea", String(table.area));
                    } catch (e) {
                        // ignore storage errors
                    }
                    // Masa seçildiğinde listeyi yeniden render et (seçili item'ı göstermek için)
                    renderTables(cachedTables);
                    closeModal(tableModal);
                    updateSelectionStatus();
                    emitSelectionChanged();
                    if (document.getElementById("orderPage")) window.location.reload();
                });
                tableList.appendChild(item);
            });
        }

        function getOrderTypeLabel(typeKey) {
            const type = orderTypeLabels?.[typeKey];
            return type?.label || typeKey || "";
        }

        function getTableLabel(tableId) {
            return `Masa ${tableId}`;
        }

        function applyTableFilter() {
            const query = (tableSearchInput?.value || "").trim().toLowerCase();
            if (tableSearchClear) {
                tableSearchClear.classList.toggle("visible", Boolean(query));
            }
            if (!query) {
                renderTables(cachedTables);
                return;
            }
            const filtered = cachedTables.filter((table) => {
                const name = (table.name || "").toLowerCase();
                const area = (table.area || "").toLowerCase();
                return name.includes(query) || area.includes(query);
            });
            renderTables(filtered);
        }

        async function loadTablesForBranch() {
            if (!tablesEndpoint || !selectedBranchId) {
                tableList.innerHTML = `<div class="selection-list-loading">Masa bilgisi yok.</div>`;
                return;
            }
            tableList.innerHTML = `<div class="selection-list-loading">Masalar yükleniyor...</div>`;
            try {
                const url = `${tablesEndpoint}?branch_id=${encodeURIComponent(
                    selectedBranchId,
                )}`;
                const response = await fetch(url);
                const result = await response.json();
                if (result?.success && Array.isArray(result.data?.tables)) {
                    cachedTables = result.data.tables;
                    if (tableSearchInput) {
                        tableSearchInput.value = "";
                    }
                    renderTables(cachedTables);
                } else {
                    cachedTables = [];
                    renderTables([]);
                }
            } catch (error) {
                cachedTables = [];
                renderTables([]);
            }
        }

        function updateSelectionStatus() {
            const currentType =
                localStorage.getItem(STORAGE_KEYS.orderType) || selectedOrderType;
            const currentTable =
                localStorage.getItem(STORAGE_KEYS.tableId) || urlTableId;

            updateCartButtonsForOrderType(currentType);

            const translations = window.I18N?.getTranslations?.();
            const lang = window.I18N?.getPreferredLanguage?.() || "tr";
            const t = (key, fallback) =>
                translations?.[lang]?.[key] !== undefined
                    ? translations[lang][key]
                    : fallback;

            if (selectionStatusText) {
                if (currentType === "tableMenu") {
                    selectionStatusText.textContent = t("selection_menu", "Menü");
                } else if (currentType === "tableOrder") {
                    const tableName = localStorage.getItem("menuTableName");
                    selectionStatusText.textContent = tableName
                        ? tableName
                        : (currentTable ? getTableLabel(currentTable) : t("selection_table_pick", "Masa Seç"));
                } else if (currentType === "takeaway") {
                    selectionStatusText.textContent = t("selection_takeaway", "Gel-Al");
                } else if (currentType === "delivery") {
                    selectionStatusText.textContent = t("selection_delivery", "Paket");
                } else {
                    selectionStatusText.textContent = t("selection_label", "Seçim");
                }
            }

            // orderTypeCurrent kaldırıldı - seçili sipariş tipi item'da selected class'ı ile gösteriliyor

            // Call Waiter Button visibility
            const callWaiterBtn = document.getElementById("callWaiterBtn");
            if (callWaiterBtn) {
                const currentBranchId =
                    localStorage.getItem(STORAGE_KEYS.branchId) || selectedBranchId;
                const currentBranch = branches.find(
                    (b) => String(b.id) === String(currentBranchId),
                );

                // Şube seçili + (masa menüsü veya masa siparişi) + callWaiter aktif
                const shouldShow =
                    currentBranchId &&
                    (currentType === "tableMenu" || currentType === "tableOrder") &&
                    currentBranch?.callWaiter === true;

                callWaiterBtn.style.display = shouldShow ? "inline-flex" : "none";

                // Update desktop cart button position based on callWaiterBtn visibility
                // Use setTimeout to ensure DOM is updated before checking visibility
                if (
                    window.menuPage &&
                    typeof window.menuPage.updateDesktopCartButtonPosition === "function"
                ) {
                    setTimeout(() => {
                        window.menuPage.updateDesktopCartButtonPosition();
                    }, 0);
                }
            } else {
                // If callWaiterBtn doesn't exist, set default position
                if (
                    window.menuPage &&
                    typeof window.menuPage.updateDesktopCartButtonPosition === "function"
                ) {
                    window.menuPage.updateDesktopCartButtonPosition();
                }
            }
        }

        let html5QrScanner = null;
        let qrScanProcessing = false; // Aynı QR için callback'in tek tetiklenmesi

        function setQrStatus(key, fallback) {
            if (!qrScanStatus) return;
            const translations = window.I18N?.getTranslations?.();
            const lang = window.I18N?.getPreferredLanguage?.() || "tr";
            const text =
                translations?.[lang]?.[key] !== undefined
                    ? translations[lang][key]
                    : fallback;
            qrScanStatus.textContent = text;
        }

        async function startQrScanner() {
            // Önceki instance varsa temizle; ikinci açılışta her zaman yeni scanner
            if (html5QrScanner) {
                await stopQrScanner();
            }
            qrScanProcessing = false;

            // Container'ı tamamen boşalt (çift kamera görüntüsünü önle)
            if (qrScanReader) {
                qrScanReader.innerHTML = "";
            }

            // Her durumda modalı aç
            if (qrScanModal) {
                openModal(qrScanModal);
            }

            if (!qrScanModal || !qrScanReader) {
                setQrStatus("qr_scan_no_camera", "DEBUG: Modal/Reader bulunamadı");
                return;
            }

            if (!window.Html5Qrcode) {
                setQrStatus("qr_scan_not_supported", "DEBUG: Html5Qrcode yüklenmedi");
                return;
            }

            if (!window.isSecureContext) {
                setQrStatus("qr_scan_https", "DEBUG: HTTPS gerekli");
                return;
            }
            setQrStatus("qr_scan_waiting", "Kamera bekleniyor...");

            try {
                html5QrScanner = new Html5Qrcode("qrScanReader");

                await html5QrScanner.start(
                    { facingMode: "environment" },
                    {
                        fps: 10,
                        qrbox: { width: 250, height: 250 },
                    },
                    async (decodedText) => {
                        if (qrScanProcessing) return;
                        qrScanProcessing = true;
                        try {
                            await html5QrScanner?.stop().catch(() => { });
                        } catch (e) { }
                        html5QrScanner = null;
                        try {
                            await handleQrResult(decodedText);
                        } finally {
                            if (qrScanModal) closeModal(qrScanModal);
                            qrScanProcessing = false;
                        }
                    },
                    (errorMessage) => {
                        // Sürekli hata mesajları gösterme
                    },
                );

                setQrStatus("qr_scan_waiting", "QR kod aranıyor...");
            } catch (error) {
                html5QrScanner = null; // Hata durumunda null yap
                const errorMsg = error?.message || error?.toString() || "Bilinmeyen";
                if (
                    errorMsg.includes("NotAllowedError") ||
                    errorMsg.includes("Permission") ||
                    errorMsg.includes("permission")
                ) {
                    setQrStatus("qr_scan_permission", "İzin reddedildi");
                } else if (errorMsg.includes("NotFoundError")) {
                    setQrStatus("qr_scan_no_camera", "Kamera bulunamadı");
                } else {
                    setQrStatus(
                        "qr_scan_no_camera",
                        "HATA: " + errorMsg.substring(0, 60),
                    );
                }
            }
        }

        async function stopQrScanner() {
            if (html5QrScanner) {
                try {
                    await html5QrScanner.stop();
                    html5QrScanner.clear();
                } catch (error) {
                    // Zaten kapalı
                }
                html5QrScanner = null;
            }
            if (qrScanModal) {
                closeModal(qrScanModal);
            }
        }

        async function resolveTableFromToken(token) {
            setQrStatus("qr_scan_resolving", "Masa doğrulanıyor...");

            // Spinner göster (QR reader içinde zaten var)
            if (qrScanReader) {
                qrScanReader.style.opacity = "0.5";
            }

            try {
                const lang = getAjaxLang();
                const url = getSiteRoot() + `/yeppanel/db/ajax/web/table-token.php?token=${encodeURIComponent(
                    token,
                )}&lang=${encodeURIComponent(lang)}&_=${Date.now()}`;
                const response = await fetch(url, { cache: "no-store" });
                const result = await response.json();

                // Spinner gizle
                if (qrScanReader) {
                    qrScanReader.style.opacity = "1";
                }

                if (result?.success && result.data?.table_id) {
                    return {
                        branchId: result.data.branch_id,
                        tableId: result.data.table_id,
                        tableName: result.data.table_name || null,
                    };
                }
            } catch (error) {
                console.error("Token resolve error:", error);
                if (qrScanReader) {
                    qrScanReader.style.opacity = "1";
                }
                return null;
            }
            return null;
        }

        async function handleQrResult(rawValue) {
            const cleanValue = (rawValue || "")
                .replace(/&amp;/g, "&")
                .replace(/&lt;/g, "<")
                .replace(/&gt;/g, ">")
                .replace(/&quot;/g, '"')
                .trim();

            let url;
            try {
                if (/^https?:\/\//i.test(cleanValue)) {
                    url = new URL(cleanValue);
                } else {
                    url = new URL(cleanValue, window.location.origin);
                }
            } catch (error) {
                setQrStatus("qr_scan_no_camera", "Geçersiz QR kod");
                stopQrScanner();
                return;
            }

            const getParam = (key) => (url ? url.searchParams.get(key) : null);
            const companyId = getParam("company_id");
            const orderType = getParam("type") || "tableOrder";
            const tableIdParam = getParam("table") || getParam("t");
            const token = getParam("table_token") || getParam("token");

            // Öncelik: token varsa her zaman token ile yep_tables.tables_token üzerinden masayı seç (table/t parametresini yok say)
            if (token) {
                setQrStatus("qr_scan_resolving", "Masa doğrulanıyor...");
                const resolved = await resolveTableFromToken(token);
                if (resolved?.tableId) {
                    // Önce masa adını yaz (toast ve status bu değeri kullanıyor)
                    if (resolved.tableName) {
                        try { localStorage.setItem("menuTableName", String(resolved.tableName)); } catch (e) { }
                    }
                    const finalBranchId = resolved.branchId != null ? String(resolved.branchId) : (companyId || "");
                    applyTableSelection(finalBranchId, resolved.tableId, orderType);
                    setQrStatus("qr_scan_waiting", (resolved.tableName || ("Masa " + resolved.tableId)) + " seçildi!");
                    // setTimeout(() => { window.location.reload(); }, 800);
                    return;
                }
                setQrStatus("qr_scan_no_camera", "Masa bulunamadı");
                stopQrScanner();
                return;
            }

            // Token yoksa direkt table/t parametresi varsa onu kullan
            if (tableIdParam) {
                applyTableSelection(companyId, tableIdParam, orderType);
                setQrStatus("qr_scan_waiting", `Masa ${tableIdParam} seçildi!`);
                setTimeout(() => { window.location.reload(); }, 800);
                return;
            }

            // Token yoksa uyarı göster
            if (window.Swal && typeof window.Swal.fire === "function") {
                const title = window.I18N?.t
                    ? window.I18N.t("qr_scan_no_token_title", "Token Bulunamadı")
                    : "Token Bulunamadı";
                const message = window.I18N?.t
                    ? window.I18N.t(
                        "qr_scan_no_token_message",
                        "Masa token bulunamadı. Lütfen masayı manuel seçiniz.",
                    )
                    : "Masa token bulunamadı. Lütfen masayı manuel seçiniz.";

                await window.Swal.fire({
                    title: title,
                    text: message,
                    icon: "warning",
                    confirmButtonText: window.I18N?.t
                        ? window.I18N.t("ok", "Tamam")
                        : "Tamam",
                    confirmButtonColor: "#8C734B",
                });
            } else {
                setQrStatus(
                    "qr_scan_no_camera",
                    "Masa token bulunamadı. Lütfen masayı manuel seçiniz.",
                );
            }

            stopQrScanner();
        }

        async function applyTableSelection(branchId, tableId, orderType) {
            // QR'dan gelen company_id (branchId) varsa güncelle
            if (branchId) {
                selectedBranchId = String(branchId);
                localStorage.setItem(STORAGE_KEYS.branchId, selectedBranchId);
                renderOrderTypes();
            }

            // QR'dan gelen order type varsa kullan, yoksa tableOrder varsayılan
            selectedOrderType = orderType || "tableOrder";
            localStorage.setItem(STORAGE_KEYS.orderType, selectedOrderType);
            localStorage.setItem(STORAGE_KEYS.tableId, String(tableId));

            // Tüm modalları kapat
            closeModal(tableModal);
            closeModal(orderModal);
            closeModal(branchModal);

            // Durumu güncelle - URL'ye yazmıyoruz, sadece UI güncellemesi
            updateSelectionStatus();
            emitSelectionChanged();

            // Toast notification göster
            showTableSelectionToast(tableId);
        }

        function showTableSelectionToast(tableId) {
            const translations = window.I18N?.getTranslations?.();
            const lang = window.I18N?.getPreferredLanguage?.() || "tr";
            const tableName = (typeof localStorage !== "undefined" && localStorage.getItem("menuTableName")) || tableId;
            const titleText = lang === "tr" ? "Masa Seçildi!" : "Table Selected!";
            const descText =
                lang === "tr"
                    ? (tableName ? tableName + " seçildi. Şimdi sipariş verebilirsiniz." : "Masa seçildi. Şimdi sipariş verebilirsiniz.")
                    : (tableName ? tableName + " selected. You can now order." : "Table selected. You can now order.");

            if (window.Swal && typeof window.Swal.fire === "function") {
                window.Swal.fire({
                    icon: "success",
                    title: titleText,
                    text: descText,
                    toast: true,
                    position: "top-end",
                    showConfirmButton: false,
                    timer: 3000,
                    timerProgressBar: true,
                    width: "auto",
                    padding: "1rem 1.5rem",
                });
            }
        }

        async function handleCallWaiter() {
            const tableId = localStorage.getItem(STORAGE_KEYS.tableId);
            const translations = window.I18N?.getTranslations?.();
            const lang = window.I18N?.getPreferredLanguage?.() || "tr";

            const t = (key, fallback) =>
                translations?.[lang]?.[key] !== undefined
                    ? translations[lang][key]
                    : fallback;

            // Eğer masa seçili değilse, masa seçme ekranını aç
            if (!tableId) {
                console.log("Masa seçili değil, masa seçme ekranı açılıyor");
                openModal(tableModal);
                loadTablesForBranch();
                return;
            }

            // Cooldown kontrolü (3 dakika = 180 saniye)
            const COOLDOWN_DURATION = 180 * 1000; // 3 dakika milisaniye cinsinden
            const lastCallTimeKey = `callWaiterLastCall_${tableId}`;
            const lastCallTime = localStorage.getItem(lastCallTimeKey);

            if (lastCallTime) {
                const timeSinceLastCall = Date.now() - parseInt(lastCallTime);
                const remainingTime = COOLDOWN_DURATION - timeSinceLastCall;

                if (remainingTime > 0) {
                    // Henüz cooldown süresi dolmamış
                    const remainingSeconds = Math.ceil(remainingTime / 1000);

                    await window.Swal.fire({
                        title: t("call_waiter_cooldown_title", "Çok Sık Çağrı"),
                        text: t(
                            "call_waiter_cooldown_message",
                            "Garson çağrısı yapabilmek için {seconds} saniye daha beklemeniz gerekiyor. Lütfen bekleyin.",
                        ).replace("{seconds}", remainingSeconds),
                        icon: "warning",
                        confirmButtonText: t("ok", "Tamam"),
                        confirmButtonColor: "#8C734B",
                        timer: 3000,
                        timerProgressBar: true,
                        toast: true,
                        position: "top-end",
                        showConfirmButton: true,
                        width: "auto",
                        padding: "1rem 1.5rem",
                    });

                    return;
                }
            }

            // Reason modal'ı aç
            const reasonModal = document.getElementById("callWaiterModalOverlay");
            const reasonBtns = document.querySelectorAll(".call-waiter-reason-btn");
            const confirmBtn = document.getElementById("callWaiterConfirmBtn");
            const cancelBtn = document.getElementById("callWaiterCancelBtn");

            if (!reasonModal) {
                console.error("Call waiter reason modal bulunamadı");
                return;
            }

            let selectedReason = null;
            let selectedReasonId = null;

            // Modal'ı aç
            reasonModal.classList.add("active");
            document.body.style.overflow = "hidden";

            // i18n güncellemesi
            if (window.I18N && window.I18N.updateElements) {
                window.I18N.updateElements();
            }

            // Reason butonlarına click event ekle
            const handleReasonClick = (e) => {
                const btn = e.currentTarget;
                const reason = btn.dataset.reason;
                const reasonId = btn.dataset.reasonId != null ? parseInt(btn.dataset.reasonId, 10) : null;

                reasonBtns.forEach((b) => b.classList.remove("selected"));
                btn.classList.add("selected");
                selectedReason = reason;
                selectedReasonId = reasonId;

                confirmBtn.disabled = false;
            };

            reasonBtns.forEach((btn) => {
                btn.addEventListener("click", handleReasonClick);
            });

            // Confirm butonuna click event ekle
            const tableName = localStorage.getItem(STORAGE_KEYS.tableName) || localStorage.getItem("menuTableName") || tableId || "";
            const branchId = selectedBranchId || localStorage.getItem("menuBranchId") || "";
            const companyId = typeof getRegisterCompanyId === "function" ? getRegisterCompanyId() : (localStorage.getItem("menuCompanyId") || localStorage.getItem("menuBranchId") || "48");
            const isLoggedIn = localStorage.getItem("isLoggedIn") === "true";

            const buildCallWaiterPayload = (opts) => {
                const reasonVal = opts.reason !== undefined ? opts.reason : selectedReason;
                const reasonIdVal = opts.reason_id !== undefined ? opts.reason_id : selectedReasonId;
                const base = {
                    reason: reasonVal,
                    reason_id: reasonIdVal,
                    table_id: tableId,
                    table_name: tableName,
                    company_id: companyId,
                    is_logged_in: !!opts.isLoggedIn,
                    lang: lang,
                    user_agent: navigator.userAgent || "",
                    screen: (window.screen && (window.screen.width + "x" + window.screen.height)) || "",
                    language: navigator.language || "",
                    client_ip: (window._callWaiterClientIp || "").trim(),
                };
                if (opts.isLoggedIn) {
                    base.user_phone = (localStorage.getItem("userPhone") || "").replace(/\D/g, "").slice(-10);
                    base.user_name = [localStorage.getItem("userFirstName"), localStorage.getItem("userLastName")].filter(Boolean).join(" ").trim() || localStorage.getItem("userName") || "";
                    base.user_email = localStorage.getItem("userEmail") || "";
                } else {
                    base.phone = opts.phone || "";
                    base.code = opts.code || "";
                }
                return base;
            };

            const submitCallWaiter = async (payload) => {
                const baseUrl = (typeof getSiteRoot === "function" ? getSiteRoot() : (window.getSiteRoot && window.getSiteRoot())) || "";
                const res = await fetch(baseUrl + "/yeppanel/db/ajax/web/call-waiter.php", {
                    method: "POST",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify(payload),
                });
                const data = await res.json().catch(() => ({}));
                return data;
            };

            const showCallWaiterSuccess = () => {
                localStorage.setItem(lastCallTimeKey, Date.now().toString());
                const successMessage = t("call_waiter_success", "Masa {tableId} adlı masaya garson çağrısı yapılmıştır. Teşekkürler!").replace("{tableId}", tableId);
                window.Swal.fire({
                    title: t("call_waiter_success_title", "Garson Çağrıldı"),
                    text: successMessage,
                    icon: "success",
                    confirmButtonText: t("ok", "Tamam"),
                    confirmButtonColor: "#8C734B",
                    timer: 2000,
                    timerProgressBar: true,
                    toast: true,
                    position: "top-end",
                    showConfirmButton: false,
                    width: "auto",
                    padding: "0.31rem 0.85rem",
                });
            };

            let confirmInProgress = false;
            const handleConfirm = async () => {
                if (confirmInProgress || !selectedReason) return;
                confirmInProgress = true;
                confirmBtn.removeEventListener("click", handleConfirm);
                confirmBtn.disabled = true;

                const savedReason = selectedReason;
                const savedReasonId = selectedReasonId;
                reasonModal.classList.remove("active");
                document.body.style.overflow = "";
                reasonBtns.forEach((btn) => btn.removeEventListener("click", handleReasonClick));
                cancelBtn.removeEventListener("click", handleCancel);
                selectedReason = null;
                selectedReasonId = null;
                reasonBtns.forEach((b) => b.classList.remove("selected"));

                if (isLoggedIn) {
                    const payload = buildCallWaiterPayload({ isLoggedIn: true, reason: savedReason, reason_id: savedReasonId });
                    const data = await submitCallWaiter(payload);
                    if (data && data.success) {
                        showCallWaiterSuccess();
                    } else {
                        window.Swal.fire({
                            title: t("call_waiter_success_title", "Garson Çağrıldı"),
                            text: (data && data.message) || "İstek gönderilemedi.",
                            icon: "error",
                            confirmButtonText: t("ok", "Tamam"),
                        });
                    }
                    return;
                }

                let branchSmsRequired = true;
                const currentBranch = getCurrentBranch();
                if (currentBranch && currentBranch.waiterCallSmsRequired === false) {
                    branchSmsRequired = false;
                }
                if (branchSmsRequired) {
                    const baseUrl = (typeof getSiteRoot === "function" ? getSiteRoot() : (window.getSiteRoot && window.getSiteRoot())) || "";
                    try {
                        const headerRes = await fetch(baseUrl + "/yeppanel/db/ajax/web/header.php?lang=" + encodeURIComponent(lang));
                        const headerJson = await headerRes.json();
                        const app = headerJson?.data?.app || headerJson?.app || {};
                        const branchListFresh = Array.isArray(app.branches) ? app.branches : [];
                        const bid = selectedBranchId || localStorage.getItem(STORAGE_KEYS.branchId);
                        const branchFresh = bid ? branchListFresh.find(function (b) { return String(b.id) === String(bid); }) : (branchListFresh[0] || null);
                        if (branchFresh && branchFresh.waiterCallSmsRequired === false) branchSmsRequired = false;
                    } catch (e) { }
                }
                if (!branchSmsRequired) {
                    const payload = buildCallWaiterPayload({ isLoggedIn: false, reason: savedReason, reason_id: savedReasonId });
                    const data = await submitCallWaiter(payload);
                    if (data && data.success) {
                        showCallWaiterSuccess();
                    } else {
                        window.Swal.fire({
                            title: t("call_waiter_success_title", "Garson Çağrıldı"),
                            text: (data && data.message) || "İstek gönderilemedi.",
                            icon: "error",
                            confirmButtonText: t("ok", "Tamam"),
                        });
                    }
                    return;
                }

                window._callWaiterPending = {
                    reason: savedReason,
                    reason_id: savedReasonId,
                    buildCallWaiterPayload,
                    submitCallWaiter,
                    showCallWaiterSuccess,
                    lastCallTimeKey,
                    t,
                    tableId,
                };
                const phoneModal = document.getElementById("callWaiterPhoneModal");
                const phoneInput = document.getElementById("callWaiterPhoneInput");
                const phoneError = document.getElementById("callWaiterPhoneError");
                const phoneSend = document.getElementById("callWaiterPhoneSend");
                const phoneClose = document.getElementById("callWaiterPhoneClose");
                if (phoneModal && phoneInput) {
                    phoneInput.value = "";
                    if (phoneError) phoneError.textContent = "";
                    if (phoneSend) phoneSend.disabled = false;
                    phoneModal.classList.add("active");
                    document.body.style.overflow = "hidden";
                    setTimeout(() => phoneInput.focus(), 100);
                    const baseUrlForIp = (typeof getSiteRoot === "function" ? getSiteRoot() : (window.getSiteRoot && window.getSiteRoot())) || "";
                    fetch(baseUrlForIp + "/yeppanel/db/ajax/web/get-client-ip.php").then((r) => r.json()).then((d) => { if (d && d.ip) window._callWaiterClientIp = d.ip; }).catch(() => { });
                }
                let phoneSendInProgress = false;
                const onPhoneSend = async () => {
                    if (phoneSendInProgress) return;
                    const raw = (phoneInput && phoneInput.value || "").replace(/\D/g, "");
                    if (raw.length !== 10 || !/^[2-5]/.test(raw)) {
                        if (phoneError) phoneError.textContent = "Geçerli bir telefon numarası girin (5XX XXX XX XX).";
                        return;
                    }
                    if (phoneError) phoneError.textContent = "";
                    phoneSendInProgress = true;
                    if (phoneSend) {
                        phoneSend.disabled = true;
                        phoneSend.removeEventListener("click", onPhoneSend);
                    }
                    const baseUrl = (typeof getSiteRoot === "function" ? getSiteRoot() : (window.getSiteRoot && window.getSiteRoot())) || "";
                    try {
                        const res = await fetch(baseUrl + "/yeppanel/db/ajax/web/send-sms-code.php", {
                            method: "POST",
                            headers: { "Content-Type": "application/json" },
                            body: JSON.stringify({ phone: raw, company_id: companyId, call_waiter: true, lang: lang }),
                        });
                        const data = await res.json().catch(() => ({}));
                        if (data && data.success) {
                            phoneModal.classList.remove("active");
                            document.body.style.overflow = "";
                            phoneSend.removeEventListener("click", onPhoneSend);
                            const codeModal = document.getElementById("callWaiterCodeModal");
                            const codeInputs = document.querySelectorAll("#callWaiterCodeInputs .verification-code-input");
                            const codeError = document.getElementById("callWaiterCodeError");
                            const codeVerify = document.getElementById("callWaiterCodeVerify");
                            const codePhoneDisplay = document.getElementById("callWaiterCodePhoneDisplay");
                            const codeClose = document.getElementById("callWaiterCodeClose");
                            const codeChangePhone = document.getElementById("callWaiterCodeChangePhone");
                            if (codePhoneDisplay) codePhoneDisplay.textContent = "0" + raw;
                            codeInputs.forEach((inp) => { inp.value = ""; });
                            if (codeError) codeError.textContent = "";
                            if (codeModal) {
                                codeModal.classList.add("active");
                                document.body.style.overflow = "hidden";
                                setTimeout(() => codeInputs[0] && codeInputs[0].focus(), 100);
                            }
                            const getCodeValue = () => Array.from(codeInputs).map((i) => i.value).join("");
                            const applyCodeDigits = (rawDigits, startIdx) => {
                                const digits = String(rawDigits || "").replace(/\D/g, "").slice(0, 4);
                                if (!digits) return;
                                let cursor = startIdx;
                                for (let i = 0; i < digits.length && cursor < codeInputs.length; i++) {
                                    codeInputs[cursor].value = digits[i];
                                    cursor += 1;
                                }
                                if (codeInputs.length) {
                                    codeInputs[Math.min(cursor, codeInputs.length - 1)].focus();
                                }
                            };
                            const onCodeInput = (e) => {
                                const el = e.target;
                                const idx = parseInt(el.dataset.idx, 10);
                                const clean = String(el.value || "").replace(/\D/g, "");
                                if (clean.length > 1) {
                                    el.value = "";
                                    applyCodeDigits(clean, idx);
                                } else {
                                    el.value = clean;
                                    if (clean && idx < 3) codeInputs[idx + 1].focus();
                                }
                            };
                            const onCodePaste = (e) => {
                                const pasted = (e.clipboardData && e.clipboardData.getData("text")) || "";
                                if (!String(pasted).replace(/\D/g, "")) return;
                                e.preventDefault();
                                const firstIdx = parseInt((e.target && e.target.dataset && e.target.dataset.idx) || "0", 10) || 0;
                                applyCodeDigits(pasted, firstIdx);
                            };
                            const onCodeKeydown = (e) => {
                                const el = e.target;
                                const idx = parseInt(el.dataset.idx, 10);
                                if (e.key === "Backspace" && !el.value && idx > 0) codeInputs[idx - 1].focus();
                            };
                            codeInputs.forEach((inp) => {
                                inp.addEventListener("input", onCodeInput);
                                inp.addEventListener("paste", onCodePaste);
                                inp.addEventListener("keydown", onCodeKeydown);
                            });
                            let verifyInProgress = false;
                            const onVerify = async () => {
                                if (verifyInProgress) return;
                                const code = getCodeValue();
                                if (code.length !== 4) {
                                    if (codeError) codeError.textContent = "4 haneli kodu girin.";
                                    return;
                                }
                                if (codeError) codeError.textContent = "";
                                verifyInProgress = true;
                                if (codeVerify) {
                                    codeVerify.disabled = true;
                                    codeVerify.removeEventListener("click", onVerify);
                                }
                                try {
                                    const verifyRes = await fetch(baseUrl + "/yeppanel/db/ajax/web/order-verify-code.php", {
                                        method: "POST",
                                        headers: { "Content-Type": "application/json" },
                                        body: JSON.stringify({ phone: raw, code: code, call_waiter: true }),
                                    });
                                    const verifyData = await verifyRes.json().catch(() => ({}));
                                    if (verifyData && verifyData.success) {
                                        const p = window._callWaiterPending;
                                        const payload = p && p.buildCallWaiterPayload
                                            ? p.buildCallWaiterPayload({ isLoggedIn: false, phone: raw, code: code, reason: p.reason, reason_id: p.reason_id })
                                            : { reason: (p && p.reason) || "", reason_id: (p && p.reason_id) || 0, table_id: tableId, table_name: tableName, company_id: companyId, phone: raw, code: code, is_logged_in: false, lang: lang, user_agent: navigator.userAgent || "", screen: (window.screen && (window.screen.width + "x" + window.screen.height)) || "", language: navigator.language || "" };
                                        const submitData = await submitCallWaiter(payload);
                                        if (submitData && submitData.success) {
                                            closeCodeModalAndCleanup();
                                            showCallWaiterSuccess();
                                            if (window._callWaiterPending) window._callWaiterPending = null;
                                        } else {
                                            if (codeError) codeError.textContent = (submitData && submitData.message) || "Gönderilemedi.";
                                        }
                                    } else {
                                        if (codeError) codeError.textContent = (verifyData && verifyData.message) || "Kod hatalı.";
                                    }
                                } finally {
                                    verifyInProgress = false;
                                    if (codeVerify) codeVerify.disabled = false;
                                }
                            };
                            const closeCodeModalAndCleanup = () => {
                                codeModal.classList.remove("active");
                                document.body.style.overflow = "";
                                codeVerify.removeEventListener("click", onVerify);
                                codeClose && codeClose.removeEventListener("click", closeCodeModalAndCleanup);
                                codeChangePhone && codeChangePhone.removeEventListener("click", onChangePhone);
                            };
                            const onChangePhone = () => {
                                closeCodeModalAndCleanup();
                                codeInputs.forEach((inp) => { inp.value = ""; });
                                if (codeError) codeError.textContent = "";
                                phoneSendInProgress = false;
                                if (phoneSend) phoneSend.disabled = false;
                                phoneModal.classList.add("active");
                                document.body.style.overflow = "hidden";
                                phoneInput.value = raw;
                                if (phoneError) phoneError.textContent = "";
                                phoneSend && phoneSend.addEventListener("click", onPhoneSend);
                                setTimeout(() => phoneInput.focus(), 100);
                            };
                            codeVerify.addEventListener("click", onVerify);
                            codeClose && codeClose.addEventListener("click", closeCodeModalAndCleanup);
                            codeChangePhone && codeChangePhone.addEventListener("click", onChangePhone);
                        } else {
                            if (phoneError) phoneError.textContent = (data && data.message) || "SMS gönderilemedi.";
                            phoneSendInProgress = false;
                            if (phoneSend) { phoneSend.disabled = false; phoneSend.addEventListener("click", onPhoneSend); }
                        }
                    } finally {
                        if (!phoneSendInProgress && phoneSend) phoneSend.disabled = false;
                    }
                };
                phoneSend && phoneSend.addEventListener("click", onPhoneSend);
                phoneClose && phoneClose.addEventListener("click", () => {
                    phoneModal.classList.remove("active");
                    document.body.style.overflow = "";
                    phoneSend.removeEventListener("click", onPhoneSend);
                });
            };

            // Cancel butonuna click event ekle
            const handleCancel = () => {
                // Modal'ı kapat
                reasonModal.classList.remove("active");
                document.body.style.overflow = "";

                // Event listener'ları temizle
                reasonBtns.forEach((btn) => {
                    btn.removeEventListener("click", handleReasonClick);
                });
                confirmBtn.removeEventListener("click", handleConfirm);
                cancelBtn.removeEventListener("click", handleCancel);

                // Reset
                selectedReason = null;
                selectedReasonId = null;
                reasonBtns.forEach((b) => b.classList.remove("selected"));
                confirmBtn.disabled = true;
            };

            confirmBtn.addEventListener("click", handleConfirm);
            cancelBtn.addEventListener("click", handleCancel);

            // Overlay'e tıklayınca kapat
            reasonModal.addEventListener("click", (e) => {
                if (e.target === reasonModal) {
                    handleCancel();
                }
            });
        }

        function updateCartButtonsForOrderType(orderType) {
            const fixedCartBtn = document.getElementById("fixedCartBtn");
            const mobileCartBtn = document.getElementById("mobileCartBtn");
            const shouldHide = orderType === "tableMenu";

            if (fixedCartBtn) {
                if (shouldHide) {
                    fixedCartBtn.style.setProperty("display", "none", "important");
                } else {
                    fixedCartBtn.style.removeProperty("display");
                }
            }

            if (mobileCartBtn) {
                if (shouldHide) {
                    mobileCartBtn.style.setProperty("display", "none", "important");
                } else {
                    mobileCartBtn.style.removeProperty("display");
                }
            }
        }

        function emitSelectionChanged() {
            if (!selectedBranchId || !selectedOrderType) {
                return;
            }
            const tableId = localStorage.getItem(STORAGE_KEYS.tableId) || urlTableId;
            if (selectedOrderType === "tableOrder" && !tableId) {
                return;
            }
            const detail = {
                branchId: selectedBranchId,
                orderType: selectedOrderType,
                tableId: tableId || null,
            };
            window.MenuSelection = detail;
            document.dispatchEvent(
                new CustomEvent("menuSelectionChanged", { detail }),
            );
        }

        if (orderTypeBackBtn) {
            // QR ile gelmişse geri butonunu gizle
            const selectionType = localStorage.getItem(
                STORAGE_KEYS.branchSelectionType,
            );
            if (selectionType === "qr") {
                orderTypeBackBtn.style.display = "none";
            }

            orderTypeBackBtn.addEventListener("click", () => {
                closeModal(orderModal);
                const selectionType = localStorage.getItem(
                    STORAGE_KEYS.branchSelectionType,
                );
                // QR ile gelmişse şube seçim modalını açma
                if (isMultiBranch && selectionType !== "qr") {
                    if (branchSearchInput) { branchSearchInput.value = ""; if (branchSearchWrap) branchSearchWrap.classList.remove("has-value"); }
                    renderBranches();
                    openModal(branchModal);
                }
            });
        }
        if (tableBackBtn) {
            tableBackBtn.addEventListener("click", () => {
                closeModal(tableModal);
                openOrderTypeModal();
            });
        }
        if (qrScanBtn) {
            qrScanBtn.addEventListener("click", () => {
                startQrScanner();
            });
        }
        if (qrScanCloseBtn) {
            qrScanCloseBtn.addEventListener("click", () => {
                stopQrScanner();
            });
        }
        if (tableSearchInput) {
            tableSearchInput.addEventListener("input", applyTableFilter);
        }
        if (tableSearchClear && tableSearchInput) {
            tableSearchClear.addEventListener("click", () => {
                tableSearchInput.value = "";
                applyTableFilter();
                tableSearchInput.focus();
            });
        }
        if (branchSearchInput) {
            branchSearchInput.addEventListener("input", () => {
                if (branchSearchWrap) branchSearchWrap.classList.toggle("has-value", branchSearchInput.value.length > 0);
                renderBranches();
            });
            branchSearchInput.addEventListener("focus", () => branchSearchWrap?.classList.add("is-open"));
            branchSearchInput.addEventListener("blur", () => branchSearchWrap?.classList.remove("is-open"));
        }
        if (branchSearchClear && branchSearchInput) {
            branchSearchClear.addEventListener("click", () => {
                branchSearchInput.value = "";
                if (branchSearchWrap) branchSearchWrap.classList.remove("has-value");
                renderBranches();
                branchSearchInput.focus();
            });
        }
        if (tableSelectModalClose) {
            tableSelectModalClose.addEventListener("click", () => {
                closeModal(tableModal);
            });
        }
        if (selectionStatusBtn) {
            selectionStatusBtn.addEventListener("click", () => {
                const selectionType = localStorage.getItem(
                    STORAGE_KEYS.branchSelectionType,
                );
                // QR ile gelmişse şube seçim modalını açma, direkt order type modalını aç
                if (selectionType === "qr") {
                    updateSelectionStatus();
                    openOrderTypeModal();
                } else {
                    // Manuel gelmişse normal akış
                    updateSelectionStatus();
                    openOrderTypeModal();
                }
            });
        }

        // Call Waiter Button Event
        const callWaiterBtn = document.getElementById("callWaiterBtn");
        if (callWaiterBtn) {
            callWaiterBtn.addEventListener("click", (e) => {
                e.preventDefault();
                e.stopPropagation();
                handleCallWaiter();
            });
        } else {
            console.warn("callWaiterBtn bulunamadı");
        }

        window.addEventListener("languageChanged", () => {
            updateSelectionStatus();
        });

        renderBranches();
        renderOrderTypes();
        updateSelectionStatus();

        // Order type modal close butonunu kontrol et
        const orderTypeModalClose = document.getElementById("orderTypeModalClose");
        const hasStoredSelection = Boolean(
            localStorage.getItem(STORAGE_KEYS.branchId) &&
            localStorage.getItem(STORAGE_KEYS.orderType),
        );

        if (orderTypeModalClose) {
            orderTypeModalClose.style.display = hasStoredSelection ? "flex" : "none";
            orderTypeModalClose.addEventListener("click", () => {
                closeModal(orderModal);
            });
        }

        if (!selectedBranchId && isMultiBranch) {
            const selectionType = localStorage.getItem(
                STORAGE_KEYS.branchSelectionType,
            );
            // QR ile gelmişse şube seçim modalını açma
            if (selectionType !== "qr") {
                if (branchSearchInput) { branchSearchInput.value = ""; if (branchSearchWrap) branchSearchWrap.classList.remove("has-value"); }
                openModal(branchModal);
                return;
            }
        }

        if (!selectedOrderType) {
            const currentBranch = getCurrentBranch();
            const enabledTypes = Object.entries(orderTypeLabels).filter(
                ([key]) => currentBranch?.orderTypes?.[key],
            );
            if (enabledTypes.length === 1 && isMultiBranch) {
                selectedOrderType = enabledTypes[0][0];
                localStorage.setItem(STORAGE_KEYS.orderType, selectedOrderType);
                if (selectedOrderType === "tableOrder") {
                    openModal(tableModal);
                    loadTablesForBranch();
                } else {
                    updateSelectionStatus();
                    emitSelectionChanged();
                }
            } else {
                openOrderTypeModal();
            }
        } else {
            if (selectedOrderType === "tableOrder") {
                const storedTableId = localStorage.getItem(STORAGE_KEYS.tableId);
                const tableId = urlTableId || storedTableId;
                if (!tableId) {
                    openModal(tableModal);
                    loadTablesForBranch();
                    return;
                }
            }
            updateSelectionStatus();
            emitSelectionChanged();
        }

        // Expose functions for inline onclick
        if (!window.menuPage) {
            window.menuPage = {};
        }
        window.menuPage.openQrScanner = startQrScanner;
        window.menuPage.handleCallWaiter = handleCallWaiter;
    }

    function bootSelection() {
        if (window.HeaderData) {
            initSelectionFlow(window.HeaderData);
        }
    }

    document.addEventListener("headerDataLoaded", (event) => {
        initSelectionFlow(event.detail);
    });

    document.addEventListener("DOMContentLoaded", () => {
        bootSelection();
    });
})();
