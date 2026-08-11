/**
 * Homepage Product Modal Handler
 * Menu.html'deki modal yapısına uygun modal yönetimi
 */

(function () {
    'use strict';

    // Modal elementleri
    const modalOverlay = document.getElementById('productModalOverlay');
    const modalCloseBtn = document.getElementById('productModalClose');

    // Modal içerik elementleri
    const modalImage = document.getElementById('modalProductImage');
    const modalBadge = document.getElementById('modalProductBadge');
    const modalName = document.getElementById('modalProductName');
    const modalRating = document.getElementById('modalProductRating');
    const modalDescription = document.getElementById('modalProductDescription');
    const modalCurrentPrice = document.getElementById('modalCurrentPrice');
    const modalOldPriceTop = document.getElementById('modalOldPriceTop');
    const modalTotalPrice = document.getElementById('modalTotalPrice');
    const modalOldPrice = document.getElementById('modalOldPrice');
    const sizeOptionsContainer = document.getElementById('sizeOptions');
    const extraOptionsContainer = document.getElementById('extraOptions');
    const modalQuantity = document.getElementById('modalQuantity');
    const modalQuantityMinus = document.getElementById('modalQuantityMinus');
    const modalQuantityPlus = document.getElementById('modalQuantityPlus');
    const productNotes = document.getElementById('productNotes');
    const modalAddToCart = document.getElementById('modalAddToCart');

    // Mevcut ürün ve seçimler
    let currentProduct = null;
    let currentQuantity = 1;
    let basePrice = 0;
    let selectedOptions = {
        size: null,
        extras: []
    };

    const getProductById = (productId) => {
        if (window.MenuProducts && Array.isArray(window.MenuProducts)) {
            const product = window.MenuProducts.find(p => p.id === productId);
            if (product) {
                return {
                    ...product,
                    basePrice: product.basePrice || product.price,
                    price: product.basePrice || product.price
                };
            }
        }
        return undefined;
    };

    // Modal aç - Optimized for performance
    function openProductModal(productId) {
        // İlk önce modal'ı göster (DOM reflow'u azaltmak için)
        if (modalOverlay) {
            modalOverlay.classList.add('active');
            document.body.style.overflow = 'hidden';
        }

        // Show spinner immediately
        const modalImageSpinner = document.getElementById('modalImageLoadingSpinner');
        if (modalImageSpinner) {
            modalImageSpinner.style.display = 'flex';
        }

        // Ürünü bul
        const product = getProductById(productId);
        if (!product) {
            console.error('Ürün bulunamadı:', productId);
            if (modalOverlay) modalOverlay.classList.remove('active');
            if (modalImageSpinner) modalImageSpinner.style.display = 'none';
            return;
        }

        // State'i güncelle
        currentProduct = product;
        currentQuantity = 1;
        basePrice = product.basePrice || product.price;
        selectedOptions = { size: null, extras: [] };

        // Reset scroll position to top
        const modalInfo = document.querySelector(".product-modal-info");
        if (modalInfo) {
            modalInfo.scrollTop = 0;
        }

        // DOM işlemlerini requestAnimationFrame ile optimize et
        requestAnimationFrame(() => {
            // Modal içeriğini güncelle
            updateModalContent(product);

            // Formu sıfırla
            resetModalForm();

            // Fiyatı hesapla
            updatePrice();
        });
    }

    // Modal içeriğini güncelle - Optimized batch DOM updates
    function updateModalContent(product) {
        // Batch DOM updates to reduce reflows
        // 1. Text content updates (fast operations)
        if (modalName) modalName.textContent = product.name || '';
        if (modalDescription) modalDescription.textContent = product.description || '';

        if (modalRating) {
            const rating = product.rating || 4.5;
            const ratingCount = product.ratingCount || 0;
            modalRating.textContent = `${rating} (${ratingCount} değerlendirme)`;
        }

        // 2. Image update (defer loading with spinner)
        if (modalImage) {
            const modalImageSpinner = document.getElementById('modalImageLoadingSpinner');

            modalImage.alt = product.name || '';
            modalImage.classList.toggle("logo-fallback-image", ["company_logo", "brand-placeholder"].includes(String(product.image_source || "")));

            // Reset image state
            modalImage.src = '';
            modalImage.classList.remove('loaded');
            modalImage.classList.add('lazy-image');

            // Show spinner
            if (modalImageSpinner) {
                modalImageSpinner.style.display = 'flex';
            }

            // Load image with lazy loading
            if (product.image) {
                const tempImg = new Image();

                tempImg.onload = () => {
                    if (modalImage) {
                        modalImage.src = product.image;
                        modalImage.classList.add('loaded');
                        modalImage.classList.remove('lazy-image');
                    }

                    // Hide spinner after image loads
                    if (modalImageSpinner) {
                        modalImageSpinner.style.display = 'none';
                    }
                };

                tempImg.onerror = () => {
                    // Hide spinner on error
                    if (modalImageSpinner) {
                        modalImageSpinner.style.display = 'none';
                    }
                    // Set placeholder image
                    if (modalImage) {
                        modalImage.src = "/assets/brand/logo-large.png";
                        modalImage.classList.remove('lazy-image');
                        modalImage.classList.add("logo-fallback-image");
                    }
                };

                // Start loading
                tempImg.src = product.image;
            } else {
                // No image, hide spinner
                if (modalImageSpinner) {
                    modalImageSpinner.style.display = 'none';
                }
                if (modalImage) {
                    modalImage.src = "/assets/brand/logo-large.png";
                    modalImage.classList.remove('lazy-image');
                    modalImage.classList.add("logo-fallback-image");
                }
            }
        }

        // 3. Badge update (tükendi öncelikli)
        if (modalBadge) {
            const badgeText = product.product_qr_status === '2' ? 'Tükendi' : (product.badge === 'popular' ? 'Popüler' : product.badge === 'new' ? 'Yeni' : '');
            if (badgeText) {
                modalBadge.textContent = badgeText;
                modalBadge.style.display = 'block';
            } else {
                modalBadge.style.display = 'none';
            }
        }

        // 4. Price updates
        if (modalCurrentPrice) modalCurrentPrice.textContent = `${product.price}`;

        if (modalOldPriceTop) {
            if (product.oldPrice) {
                modalOldPriceTop.textContent = `${product.oldPrice}`;
                modalOldPriceTop.style.display = 'inline';
            } else {
                modalOldPriceTop.style.display = 'none';
            }
        }

        // 5. Options (these are heavier operations, do them last)
        updateRatingStars(product.rating || 4.5);
        updateSizeOptions(product.sizeOptions || []);
        updateExtraOptions(product.extraOptions || []);
    }

    // Rating stars güncelle
    function updateRatingStars(rating) {
        const ratingStars = document.querySelector('.rating-stars');
        if (!ratingStars) return;

        const stars = ratingStars.querySelectorAll('i');
        stars.forEach((star, index) => {
            if (index < Math.floor(rating)) {
                star.classList.add('fas');
                star.classList.remove('far');
            } else {
                star.classList.add('far');
                star.classList.remove('fas');
            }
        });
    }

    // Size options güncelle
    function updateSizeOptions(sizeOptions) {
        if (!sizeOptionsContainer) return;

        sizeOptionsContainer.innerHTML = '';

        if (sizeOptions.length === 0) {
            sizeOptionsContainer.parentElement.style.display = 'none';
            return;
        }

        sizeOptionsContainer.parentElement.style.display = 'block';

        sizeOptions.forEach((size, index) => {
            const sizeOption = document.createElement('label');
            sizeOption.className = 'option-choice';
            sizeOption.innerHTML = `
        <input type="radio" name="size" value="${size.name}" data-price="${size.price}" ${index === 1 || sizeOptions.length === 1 ? 'checked' : ''}>
        <div class="choice-content">
          <span class="choice-name">${size.name}</span>
          <span class="choice-price">${size.price > 0 ? '+' + size.price : '+0'}</span>
        </div>
      `;

            const input = sizeOption.querySelector('input');
            input.addEventListener('change', () => {
                if (input.checked) {
                    selectedOptions.size = { name: size.name, price: size.price };
                    updatePrice();
                }
            });

            if (index === 1 || (sizeOptions.length === 1 && index === 0)) {
                selectedOptions.size = { name: size.name, price: size.price };
            }

            sizeOptionsContainer.appendChild(sizeOption);
        });
    }

    // Extra options güncelle - Optimized with DocumentFragment
    function updateExtraOptions(extraOptions) {
        if (!extraOptionsContainer) return;

        // Use DocumentFragment for batch DOM insertion
        const fragment = document.createDocumentFragment();

        if (extraOptions.length === 0) {
            extraOptionsContainer.innerHTML = '';
            extraOptionsContainer.parentElement.style.display = 'none';
            return;
        }

        extraOptionsContainer.parentElement.style.display = 'block';

        extraOptions.forEach(extra => {
            const extraOption = document.createElement('label');
            extraOption.className = 'option-choice';
            extraOption.innerHTML = `
        <input type="checkbox" name="extra" value="${extra.name}" data-price="${extra.price}">
        <div class="choice-content">
          <span class="choice-name">${extra.name}</span>
          <span class="choice-price">+${extra.price}</span>
        </div>
      `;

            const input = extraOption.querySelector('input');
            input.addEventListener('change', () => {
                if (input.checked) {
                    selectedOptions.extras.push({ name: extra.name, price: extra.price });
                } else {
                    selectedOptions.extras = selectedOptions.extras.filter(e => e.name !== extra.name);
                }
                updatePrice();
            });

            fragment.appendChild(extraOption);
        });

        // Single DOM update instead of multiple
        extraOptionsContainer.innerHTML = '';
        extraOptionsContainer.appendChild(fragment);
    }

    // Formu sıfırla
    function resetModalForm() {
        if (modalQuantity) modalQuantity.textContent = '1';
        if (productNotes) productNotes.value = '';
        selectedOptions.extras = [];

        // Checkboxları sıfırla
        if (extraOptionsContainer) {
            const checkboxes = extraOptionsContainer.querySelectorAll('input[type="checkbox"]');
            checkboxes.forEach(cb => cb.checked = false);
        }
    }

    // Fiyat hesapla
    function updatePrice() {
        if (!currentProduct) return;

        let totalPrice = basePrice;

        // Size price ekle
        if (selectedOptions.size) {
            totalPrice += selectedOptions.size.price;
        }

        // Extras price ekle
        selectedOptions.extras.forEach(extra => {
            totalPrice += extra.price;
        });

        // Quantity ile çarp
        const finalPrice = totalPrice * currentQuantity;

        // Modal fiyatını güncelle
        if (modalTotalPrice) modalTotalPrice.textContent = `${finalPrice.toFixed(2)}`;

        if (modalOldPrice && currentProduct.oldPrice) {
            const oldTotalPrice = currentProduct.oldPrice * currentQuantity;
            modalOldPrice.textContent = `${oldTotalPrice.toFixed(2)}`;
            modalOldPrice.style.display = 'inline';
        } else if (modalOldPrice) {
            modalOldPrice.style.display = 'none';
        }
    }

    // Modal kapat
    function closeModal() {
        if (modalOverlay) {
            modalOverlay.classList.remove('active');
            document.body.style.overflow = '';
        }
    }

    // Event listeners
    if (modalCloseBtn) {
        modalCloseBtn.addEventListener('click', closeModal);
    }

    if (modalOverlay) {
        modalOverlay.addEventListener('click', (e) => {
            if (e.target === modalOverlay) {
                closeModal();
            }
        });
    }

    // Quantity controls
    if (modalQuantityMinus) {
        modalQuantityMinus.addEventListener('click', () => {
            if (currentQuantity > 1) {
                currentQuantity--;
                if (modalQuantity) modalQuantity.textContent = currentQuantity;
                updatePrice();
            }
        });
    }

    if (modalQuantityPlus) {
        modalQuantityPlus.addEventListener('click', () => {
            if (currentQuantity < 50) {
                currentQuantity++;
                if (modalQuantity) modalQuantity.textContent = currentQuantity;
                updatePrice();
            }
        });
    }

    // Add to cart
    if (modalAddToCart) {
        modalAddToCart.addEventListener('click', () => {
            if (!currentProduct) return;

            // Sepete ekleme işlemi (cart.js'deki sistemi kullan)
            // cart.js'deki addItem: addItem(product, quantity, options)
            if (window.Cart && typeof window.Cart.addItem === 'function') {
                // Toplam fiyatı hesapla (basePrice + size + extras)
                const totalPrice = basePrice +
                    (selectedOptions.size ? selectedOptions.size.price : 0) +
                    selectedOptions.extras.reduce((sum, e) => sum + e.price, 0);

                // Product objesi oluştur (cart.js'nin beklediği format)
                // cart.js içinde product.price kullanılıyor, bu yüzden totalPrice'ı price olarak gönderiyoruz
                const product = {
                    id: currentProduct.id,
                    name: currentProduct.name,
                    price: totalPrice, // Toplam fiyat (base + size + extras)
                    image: currentProduct.image || '',
                    category: currentProduct.category || null
                };

                // Options objesi oluştur (menu.js formatına uygun)
                const options = {
                    size: selectedOptions.size ? selectedOptions.size.name : null,
                    extras: selectedOptions.extras.map(e => e.name),
                    notes: productNotes ? productNotes.value : ''
                };

                // Cart.addItem çağır (product, quantity, options)
                const result = window.Cart.addItem(product, currentQuantity, options);

                if (result && result.success) {
                    // Modal'ı kapat
                    closeModal();
                }
                // Hata durumunda cart.js içindeki ToastManager zaten mesaj gösteriyor
            } else if (window.addToCart && typeof window.addToCart === 'function') {
                // Global addToCart fonksiyonu varsa kullan (cart.js'de tanımlı)
                const totalPrice = basePrice +
                    (selectedOptions.size ? selectedOptions.size.price : 0) +
                    selectedOptions.extras.reduce((sum, e) => sum + e.price, 0);

                const product = {
                    id: currentProduct.id,
                    name: currentProduct.name,
                    price: totalPrice,
                    image: currentProduct.image || '',
                    category: currentProduct.category || null
                };

                const options = {
                    size: selectedOptions.size ? selectedOptions.size.name : null,
                    extras: selectedOptions.extras.map(e => e.name),
                    notes: productNotes ? productNotes.value : ''
                };

                const result = window.addToCart(product, currentQuantity, options);
                if (result && result.success) {
                    closeModal();
                }
            } else {
                // Fallback: Console'a yazdır
                console.error('Cart sistemi bulunamadı. config.js, utils.js ve cart.js yüklü olmalı.');
                closeModal();
            }
        });
    }

    // Global function olarak export et
    window.openProductModal = openProductModal;

    // ESC tuşu ile kapat
    document.addEventListener('keydown', (e) => {
        if (e.key === 'Escape' && modalOverlay && modalOverlay.classList.contains('active')) {
            closeModal();
        }
    });

})();
