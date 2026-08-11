// ========== PRODUCT GALLERY SYSTEM ==========
(function () {
    let currentGalleryIndex = 0;
    let currentMediaList = [];
    let fullscreenMode = false;

    const gallerySlides = document.getElementById("gallerySlides");
    const galleryDots = document.getElementById("galleryDots");
    const galleryPrev = document.getElementById("galleryPrev");
    const galleryNext = document.getElementById("galleryNext");
    const galleryFullscreen = document.getElementById("galleryFullscreen");
    const galleryFullscreenContent = document.getElementById(
        "galleryFullscreenContent",
    );
    const galleryFullscreenClose = document.getElementById(
        "galleryFullscreenClose",
    );
    const fullscreenPrev = document.getElementById("fullscreenPrev");
    const fullscreenNext = document.getElementById("fullscreenNext");
    const fullscreenDots = document.getElementById("fullscreenDots");

    window.initProductGallery = function (media) {
        const spinner = document.getElementById("modalImageLoadingSpinner");
        const gallerySlides = document.getElementById("gallerySlides");

        if (!media || !Array.isArray(media) || media.length === 0) {
            // Eski tek resim sistemi - spinner'ı gizle
            if (spinner) {
                spinner.style.display = "none";
            }
            if (gallerySlides) {
                gallerySlides.style.display = "none";
            }
            return;
        }

        // Gallery'yi görünür yap
        if (gallerySlides) {
            gallerySlides.style.display = "flex";
        }

        // Spinner'ı göster
        if (spinner) {
            spinner.style.display = "flex";
        }

        currentMediaList = media;
        currentGalleryIndex = 0;
        renderGallery();
        renderDots();
        updateNavButtons();

        // Tek item kontrolü - navigation elemanlarını gizle/göster
        const isSingleItem = media.length === 1;

        if (galleryPrev) {
            galleryPrev.classList.toggle("single-item", isSingleItem);
        }
        if (galleryNext) {
            galleryNext.classList.toggle("single-item", isSingleItem);
        }
        if (galleryDots) {
            galleryDots.classList.toggle("single-item", isSingleItem);
        }
    };

    function renderGallery() {
        if (!gallerySlides) return;

        gallerySlides.innerHTML = "";
        const spinner = document.getElementById("modalImageLoadingSpinner");

        // Spinner'ı göster
        if (spinner) {
            spinner.style.display = "flex";
        }

        // Gallery slides'i görünür yap
        if (gallerySlides) {
            gallerySlides.style.display = "flex";
        }

        let imagesToLoad = 0;
        let imagesLoaded = 0;
        let firstImageLoaded = false;

        currentMediaList.forEach((item, index) => {
            const slide = document.createElement("div");
            slide.className = "gallery-slide";

            if (item.type === "video") {
                slide.innerHTML = `
          <video id="galleryVideo${index}" ${item.poster ? `poster="${item.poster}"` : ""
                    }>
            <source src="${item.url}" type="video/mp4">
          </video>
          <div class="gallery-video-overlay" data-index="${index}">
            <button class="gallery-play-btn">
              <i class="fas fa-play"></i>
            </button>
          </div>
        `;

                const overlay = slide.querySelector(".gallery-video-overlay");
                const video = slide.querySelector("video");

                overlay.addEventListener("click", () => {
                    video.play();
                    overlay.classList.add("playing");
                });

                video.addEventListener("pause", () => {
                    overlay.classList.remove("playing");
                });

                video.addEventListener("ended", () => {
                    overlay.classList.remove("playing");
                });

                // Video için poster varsa yükleme sayısına ekle
                if (item.poster) {
                    imagesToLoad++;
                    const posterImg = new Image();
                    posterImg.onload = () => {
                        imagesLoaded++;
                        if (!firstImageLoaded && index === 0) {
                            firstImageLoaded = true;
                            if (spinner) {
                                spinner.style.display = "none";
                            }
                        }
                        checkAllLoaded();
                    };
                    posterImg.onerror = () => {
                        imagesLoaded++;
                        if (!firstImageLoaded && index === 0) {
                            firstImageLoaded = true;
                            if (spinner) {
                                spinner.style.display = "none";
                            }
                        }
                        checkAllLoaded();
                    };
                    posterImg.src = item.poster;
                } else {
                    // Video yüklendiğinde say
                    video.addEventListener("loadedmetadata", () => {
                        imagesLoaded++;
                        if (!firstImageLoaded && index === 0) {
                            firstImageLoaded = true;
                            if (spinner) {
                                spinner.style.display = "none";
                            }
                        }
                        checkAllLoaded();
                    });
                }
            } else {
                imagesToLoad++;
                slide.innerHTML = `<img alt="Product image ${index + 1}">`;
                const img = slide.querySelector("img");
                if (item.isLogoFallback) {
                    img.classList.add("logo-fallback-image");
                }

                // Resme tıklayınca fullscreen aç - sadece drag yoksa
                slide.style.cursor = "pointer";
                slide.addEventListener("click", (e) => {
                    // Hareket yoksa fullscreen aç
                    if (!hasMoved) {
                        openFullscreen(index);
                    }
                });

                // Attach event handlers before setting src
                img.onload = () => {
                    imagesLoaded++;
                    // İlk resim yüklendiğinde spinner'ı gizle
                    if (!firstImageLoaded && index === 0) {
                        firstImageLoaded = true;
                        if (spinner) {
                            spinner.style.display = "none";
                        }
                    }
                    checkAllLoaded();
                };

                img.onerror = () => {
                    imagesLoaded++;
                    // İlk resim yüklenemese bile spinner'ı gizle
                    if (!firstImageLoaded && index === 0) {
                        firstImageLoaded = true;
                        if (spinner) {
                            spinner.style.display = "none";
                        }
                    }
                    checkAllLoaded();
                };

                // Set src after attaching event handlers
                img.src = item.url;

                // Check if image is already loaded (cached) - immediately after setting src
                if (img.complete && img.naturalHeight !== 0) {
                    // Image is already loaded from cache, trigger load handler immediately
                    img.onload();
                }
            }

            gallerySlides.appendChild(slide);
        });

        // After all slides are added, check if all images are already loaded (cached)
        // This ensures spinner is hidden even if onload events didn't fire
        setTimeout(() => {
            const allImages = gallerySlides.querySelectorAll("img");
            let allComplete = true;

            if (allImages.length > 0) {
                allImages.forEach((img) => {
                    if (!img.complete || img.naturalHeight === 0) {
                        allComplete = false;
                    }
                });

                if (allComplete && spinner && spinner.style.display !== "none") {
                    // All images are already loaded, hide spinner
                    spinner.style.display = "none";
                }
            }
        }, 50);

        // Tüm medya yüklendiğinde kontrol (backup)
        function checkAllLoaded() {
            if (
                imagesLoaded >= imagesToLoad ||
                imagesLoaded >= currentMediaList.length
            ) {
                // Always hide spinner if all images are loaded
                if (spinner) {
                    spinner.style.display = "none";
                }
            }
        }

        // Eğer hiç resim yoksa direkt gizle
        if (imagesToLoad === 0 && currentMediaList.length > 0) {
            setTimeout(() => {
                if (spinner) {
                    spinner.style.display = "none";
                }
            }, 500);
        }

        // Fallback: 3 saniye sonra spinner'ı gizle
        setTimeout(() => {
            if (spinner && spinner.style.display !== "none") {
                spinner.style.display = "none";
            }
        }, 3000);

        updateSlidePosition();
    }

    function renderDots() {
        if (!galleryDots) return;

        galleryDots.innerHTML = "";

        currentMediaList.forEach((_, index) => {
            const dot = document.createElement("button");
            dot.className = "gallery-dot";
            dot.type = "button";
            if (index === currentGalleryIndex) {
                dot.classList.add("active");
            }
            dot.addEventListener("click", () => goToSlide(index));
            galleryDots.appendChild(dot);
        });
    }

    function updateDots() {
        if (!galleryDots) return;

        const dots = galleryDots.querySelectorAll(".gallery-dot");
        dots.forEach((dot, index) => {
            dot.classList.toggle("active", index === currentGalleryIndex);
        });
    }

    function updateSlidePosition() {
        if (!gallerySlides) return;

        const offset = -currentGalleryIndex * 100;
        gallerySlides.style.transform = `translateX(${offset}%)`;
    }

    function updateNavButtons() {
        if (galleryPrev) {
            galleryPrev.disabled = currentGalleryIndex === 0;
        }
        if (galleryNext) {
            galleryNext.disabled =
                currentGalleryIndex === currentMediaList.length - 1;
        }
    }

    function goToSlide(index) {
        if (index < 0 || index >= currentMediaList.length) return;

        // Pause all videos
        document.querySelectorAll(".gallery-slide video").forEach((video) => {
            video.pause();
        });

        currentGalleryIndex = index;
        updateSlidePosition();
        updateDots();
        updateNavButtons();
    }

    function nextSlide() {
        if (currentGalleryIndex < currentMediaList.length - 1) {
            goToSlide(currentGalleryIndex + 1);
        }
    }

    function prevSlide() {
        if (currentGalleryIndex > 0) {
            goToSlide(currentGalleryIndex - 1);
        }
    }

    function openFullscreen(index) {
        if (!galleryFullscreen || !galleryFullscreenContent) return;

        fullscreenMode = true;
        currentGalleryIndex = index;

        const item = currentMediaList[index];

        if (item.type === "video") {
            galleryFullscreenContent.innerHTML = `
        <video controls autoplay ${item.poster ? `poster="${item.poster}"` : ""
                }>
          <source src="${item.url}" type="video/mp4">
        </video>
      `;
        } else {
            galleryFullscreenContent.innerHTML = `<img src="${item.url}" alt="Product image">`;
        }

        renderFullscreenDots();
        updateFullscreenNavButtons();

        // Tek item kontrolü - fullscreen navigation elemanlarını gizle/göster
        const isSingleItem = currentMediaList.length === 1;

        if (fullscreenPrev) {
            fullscreenPrev.classList.toggle("single-item", isSingleItem);
        }
        if (fullscreenNext) {
            fullscreenNext.classList.toggle("single-item", isSingleItem);
        }
        if (fullscreenDots) {
            fullscreenDots.classList.toggle("single-item", isSingleItem);
        }

        galleryFullscreen.classList.add("active");
        document.body.style.overflow = "hidden";
    }

    function closeFullscreen() {
        if (!galleryFullscreen) return;

        fullscreenMode = false;
        galleryFullscreen.classList.remove("active");
        document.body.style.overflow = "";

        // Stop video
        const video = galleryFullscreenContent.querySelector("video");
        if (video) {
            video.pause();
        }
    }

    function renderFullscreenDots() {
        if (!fullscreenDots) return;

        fullscreenDots.innerHTML = "";

        currentMediaList.forEach((_, index) => {
            const dot = document.createElement("button");
            dot.className = "gallery-fullscreen-dot";
            dot.type = "button";
            if (index === currentGalleryIndex) {
                dot.classList.add("active");
            }
            dot.addEventListener("click", () => goToFullscreenSlide(index));
            fullscreenDots.appendChild(dot);
        });
    }

    function updateFullscreenDots() {
        if (!fullscreenDots) return;

        const dots = fullscreenDots.querySelectorAll(".gallery-fullscreen-dot");
        dots.forEach((dot, index) => {
            dot.classList.toggle("active", index === currentGalleryIndex);
        });
    }

    function updateFullscreenNavButtons() {
        if (fullscreenPrev) {
            fullscreenPrev.disabled = currentGalleryIndex === 0;
        }
        if (fullscreenNext) {
            fullscreenNext.disabled =
                currentGalleryIndex === currentMediaList.length - 1;
        }
    }

    function goToFullscreenSlide(index) {
        if (index < 0 || index >= currentMediaList.length) return;

        currentGalleryIndex = index;
        const item = currentMediaList[index];

        if (item.type === "video") {
            galleryFullscreenContent.innerHTML = `
        <video controls autoplay ${item.poster ? `poster="${item.poster}"` : ""
                }>
          <source src="${item.url}" type="video/mp4">
        </video>
      `;
        } else {
            galleryFullscreenContent.innerHTML = `<img src="${item.url}" alt="Product image">`;
        }

        updateFullscreenDots();
        updateFullscreenNavButtons();
    }

    function nextFullscreenSlide() {
        if (currentGalleryIndex < currentMediaList.length - 1) {
            goToFullscreenSlide(currentGalleryIndex + 1);
        }
    }

    function prevFullscreenSlide() {
        if (currentGalleryIndex > 0) {
            goToFullscreenSlide(currentGalleryIndex - 1);
        }
    }

    // Event Listeners
    if (galleryPrev) {
        galleryPrev.addEventListener("click", prevSlide);
    }

    if (galleryNext) {
        galleryNext.addEventListener("click", nextSlide);
    }

    if (galleryFullscreenClose) {
        galleryFullscreenClose.addEventListener("click", closeFullscreen);
    }

    if (fullscreenPrev) {
        fullscreenPrev.addEventListener("click", prevFullscreenSlide);
    }

    if (fullscreenNext) {
        fullscreenNext.addEventListener("click", nextFullscreenSlide);
    }

    // Close fullscreen on Escape
    document.addEventListener("keydown", (e) => {
        if (e.key === "Escape" && fullscreenMode) {
            closeFullscreen();
        }
    });

    // Arrow keys for navigation
    document.addEventListener("keydown", (e) => {
        if (!fullscreenMode) return;

        if (e.key === "ArrowLeft") {
            prevFullscreenSlide();
        } else if (e.key === "ArrowRight") {
            nextFullscreenSlide();
        }
    });

    // ========== SWIPE/DRAG SUPPORT ==========

    // Normal gallery swipe support
    let startX = 0;
    let currentX = 0;
    let isDragging = false;
    let hasMoved = false; // Hareket var mı kontrolü
    let startTransform = 0;

    if (gallerySlides) {
        gallerySlides.addEventListener("mousedown", handleDragStart);
        gallerySlides.addEventListener("touchstart", handleDragStart, {
            passive: true,
        });

        document.addEventListener("mousemove", handleDragMove);
        document.addEventListener("touchmove", handleDragMove, { passive: false });

        document.addEventListener("mouseup", handleDragEnd);
        document.addEventListener("touchend", handleDragEnd);
    }

    function handleDragStart(e) {
        if (fullscreenMode) return;

        isDragging = true;
        hasMoved = false; // Reset
        startX = e.type.includes("mouse") ? e.pageX : e.touches[0].pageX;
        currentX = startX;

        const currentTransform = window.getComputedStyle(gallerySlides).transform;
        if (currentTransform && currentTransform !== "none") {
            const matrix = currentTransform.match(/matrix.*\((.+)\)/);
            if (matrix) {
                startTransform = parseFloat(matrix[1].split(", ")[4]) || 0;
            }
        } else {
            startTransform = -currentGalleryIndex * gallerySlides.offsetWidth;
        }

        gallerySlides.classList.add("dragging");
        gallerySlides.style.transition = "none";
    }

    function handleDragMove(e) {
        if (!isDragging || fullscreenMode) return;

        e.preventDefault();
        currentX = e.type.includes("mouse") ? e.pageX : e.touches[0].pageX;
        const diff = currentX - startX;

        // 5px'den fazla hareket varsa işaretle
        if (Math.abs(diff) > 5) {
            hasMoved = true;
        }

        gallerySlides.style.transform = `translateX(${startTransform + diff}px)`;
    }

    function handleDragEnd(e) {
        if (!isDragging || fullscreenMode) return;

        isDragging = false;
        gallerySlides.classList.remove("dragging");
        gallerySlides.style.transition = "";

        const diff = currentX - startX;
        const threshold = gallerySlides.offsetWidth * 0.2; // 20% kaydırma yeterli

        if (Math.abs(diff) > threshold) {
            if (diff > 0 && currentGalleryIndex > 0) {
                // Sola kaydır (önceki)
                prevSlide();
            } else if (
                diff < 0 &&
                currentGalleryIndex < currentMediaList.length - 1
            ) {
                // Sağa kaydır (sonraki)
                nextSlide();
            } else {
                // Geri dön
                updateSlidePosition();
            }
        } else {
            // Geri dön
            updateSlidePosition();
        }

        // hasMoved'i biraz sonra sıfırla (click event'inden sonra)
        setTimeout(() => {
            hasMoved = false;
        }, 100);
    }

    // Fullscreen swipe support (horizontal + vertical to close)
    let fsStartX = 0;
    let fsStartY = 0;
    let fsCurrentX = 0;
    let fsCurrentY = 0;
    let fsIsDragging = false;

    if (galleryFullscreenContent) {
        galleryFullscreenContent.addEventListener("mousedown", handleFsDragStart);
        galleryFullscreenContent.addEventListener("touchstart", handleFsDragStart, {
            passive: true,
        });

        document.addEventListener("mousemove", handleFsDragMove);
        document.addEventListener("touchmove", handleFsDragMove, {
            passive: false,
        });

        document.addEventListener("mouseup", handleFsDragEnd);
        document.addEventListener("touchend", handleFsDragEnd);
    }

    function handleFsDragStart(e) {
        if (!fullscreenMode) return;

        fsIsDragging = true;
        fsStartX = e.type.includes("mouse") ? e.pageX : e.touches[0].pageX;
        fsStartY = e.type.includes("mouse") ? e.pageY : e.touches[0].pageY;
        fsCurrentX = fsStartX;
        fsCurrentY = fsStartY;

        galleryFullscreenContent.classList.add("dragging");
    }

    function handleFsDragMove(e) {
        if (!fsIsDragging || !fullscreenMode) return;

        fsCurrentX = e.type.includes("mouse") ? e.pageX : e.touches[0].pageX;
        fsCurrentY = e.type.includes("mouse") ? e.pageY : e.touches[0].pageY;

        // Vertical swipe için opacity azalt
        const diffY = Math.abs(fsCurrentY - fsStartY);
        if (diffY > 20 && galleryFullscreen) {
            const opacity = Math.max(0.3, 1 - diffY / 300);
            galleryFullscreen.style.opacity = opacity;
        }
    }

    function handleFsDragEnd(e) {
        if (!fsIsDragging || !fullscreenMode) return;

        fsIsDragging = false;
        galleryFullscreenContent.classList.remove("dragging");

        const diffX = fsCurrentX - fsStartX;
        const diffY = fsCurrentY - fsStartY;
        const thresholdX = 50; // 50px yatay kaydırma
        const thresholdY = 80; // 80px dikey kaydırma

        // Önce vertical swipe kontrolü - kapatma için
        if (Math.abs(diffY) > thresholdY && Math.abs(diffY) > Math.abs(diffX)) {
            // Dikey hareket baskın - kapat
            closeFullscreen();
            if (galleryFullscreen) {
                galleryFullscreen.style.opacity = ""; // Opacity'yi sıfırla
            }
            return;
        }

        // Horizontal swipe - slide değiştirme
        if (Math.abs(diffX) > thresholdX && Math.abs(diffX) > Math.abs(diffY)) {
            if (diffX > 0 && currentGalleryIndex > 0) {
                // Sola kaydır (önceki)
                prevFullscreenSlide();
            } else if (
                diffX < 0 &&
                currentGalleryIndex < currentMediaList.length - 1
            ) {
                // Sağa kaydır (sonraki)
                nextFullscreenSlide();
            }
        }

        // Opacity'yi geri yükle
        if (galleryFullscreen) {
            galleryFullscreen.style.opacity = "";
        }
    }
})();
