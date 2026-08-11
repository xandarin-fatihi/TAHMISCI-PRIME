// ========== HERO SLIDER FUNCTIONALITY ==========

(function () {
    'use strict';

    let currentSlide = 0;
    let autoplayTimer = null;
    let isTransitioning = false;

    function initHeroSlider() {
        const sliderTrack = document.getElementById('heroSliderTrack');
        const sliderDots = document.getElementById('heroSliderDots');
        const prevBtn = document.getElementById('heroSliderPrev');
        const nextBtn = document.getElementById('heroSliderNext');

        if (!sliderTrack || !APP_CONFIG.hero || !APP_CONFIG.hero.slides) {
            return;
        }

        const slides = APP_CONFIG.hero.slides;
        const isSingleSlide = slides.length <= 1;
        const sliderWrapper = sliderTrack.closest('.hero-slider-wrapper');
        sliderWrapper?.classList.toggle('is-single-slide', isSingleSlide);
        [prevBtn, nextBtn].forEach((button) => {
            if (!button) return;
            button.hidden = isSingleSlide;
            button.disabled = isSingleSlide;
            button.setAttribute('aria-hidden', isSingleSlide ? 'true' : 'false');
        });
        if (sliderDots) {
            sliderDots.hidden = isSingleSlide;
            sliderDots.setAttribute('aria-hidden', isSingleSlide ? 'true' : 'false');
        }

        if (typeof window.__cleanupTahmisciHeroMedia === 'function') {
            window.__cleanupTahmisciHeroMedia();
            window.__cleanupTahmisciHeroMedia = null;
        }

        // Render slides
        sliderTrack.innerHTML = '';
        slides.forEach((slide, index) => {
            const slideElement = createSlideElement(slide, index);
            sliderTrack.appendChild(slideElement);
        });

        // Render dots
        if (sliderDots && !isSingleSlide) {
            sliderDots.innerHTML = '';
            slides.forEach((_, index) => {
                const dot = document.createElement('button');
                dot.className = 'hero-slider-dot';
                if (index === 0) dot.classList.add('active');
                dot.setAttribute('aria-label', `Slide ${index + 1}`);
                dot.addEventListener('click', () => goToSlide(index));
                sliderDots.appendChild(dot);
            });
        }

        // Navigation buttons
        if (prevBtn && !isSingleSlide) {
            prevBtn.addEventListener('click', () => prevSlide());
        }

        if (nextBtn && !isSingleSlide) {
            nextBtn.addEventListener('click', () => nextSlide());
        }

        if (isSingleSlide) {
            currentSlide = 0;
            updateSlider();
            stopAutoplay();
            return;
        }

        // Touch/swipe support
        let startX = 0;
        let currentX = 0;
        let isDragging = false;

        sliderTrack.addEventListener('touchstart', (e) => {
            startX = e.touches[0].clientX;
            isDragging = true;
            stopAutoplay();
        });

        sliderTrack.addEventListener('touchmove', (e) => {
            if (!isDragging) return;
            currentX = e.touches[0].clientX;
        });

        sliderTrack.addEventListener('touchend', () => {
            if (!isDragging) return;
            isDragging = false;

            const diff = startX - currentX;
            if (Math.abs(diff) > 50) {
                if (diff > 0) {
                    nextSlide();
                } else {
                    prevSlide();
                }
            }
            startAutoplay();
        });

        // Mouse drag support
        sliderTrack.addEventListener('mousedown', (e) => {
            startX = e.clientX;
            isDragging = true;
            stopAutoplay();
            e.preventDefault();
        });

        document.addEventListener('mousemove', (e) => {
            if (!isDragging) return;
            currentX = e.clientX;
        });

        document.addEventListener('mouseup', () => {
            if (!isDragging) return;
            isDragging = false;

            const diff = startX - currentX;
            if (Math.abs(diff) > 50) {
                if (diff > 0) {
                    nextSlide();
                } else {
                    prevSlide();
                }
            }
            startAutoplay();
        });

        // Keyboard navigation
        document.addEventListener('keydown', (e) => {
            if (e.key === 'ArrowLeft') {
                prevSlide();
            } else if (e.key === 'ArrowRight') {
                nextSlide();
            }
        });

        // Initialize
        updateSlider();
        startAutoplay();
    }

    function getHeroBasePath() {
        return getSiteRoot();
    }

    function resolveHeroMediaUrl(source) {
        let mediaUrl = String(source || '').trim();
        if (mediaUrl && !/^https?:\/\//i.test(mediaUrl)) {
            const base = getHeroBasePath();
            mediaUrl = (base ? base + '/' : '') + mediaUrl.replace(/^\//, '');
        }
        return mediaUrl;
    }

    function createSlideElement(slide, index) {
        const slideDiv = document.createElement('div');
        slideDiv.className = 'hero-slide';
        const imgUrl = resolveHeroMediaUrl(slide.backgroundImage);
        if (imgUrl) {
            slideDiv.style.backgroundImage = `url("${imgUrl}")`;
        }
        slideDiv.setAttribute('data-slide-index', index);

        const content = document.createElement('div');
        content.className = 'hero-slide-content';

        const brand = document.createElement('span');
        brand.className = 'hero-slide-brand';
        brand.textContent = slide.brand || 'Tahmisçi Coffee & Roastery';

        const title = document.createElement('h1');
        title.className = 'hero-slide-title';
        title.textContent = slide.title;

        const description = document.createElement('p');
        description.className = 'hero-slide-description';
        description.textContent = slide.description;

        const actions = document.createElement('div');
        actions.className = 'hero-slide-actions';

        const button = document.createElement('a');
        const url = slide.buttonUrl || slide.buttonLink || '#';
        if (url.startsWith('http') || url.startsWith('/')) {
            button.href = url;
        } else {
            const basePath = getHeroBasePath();
            button.href = (basePath ? basePath + '/' : '') + url;
        }
        button.className = 'btn btn-primary btn-large';

        if (slide.buttonIcon) {
            const icon = document.createElement('i');
            icon.className = slide.buttonIcon;
            button.appendChild(icon);
        }

        button.appendChild(document.createTextNode(` ${slide.buttonText || ''}`));

        const aboutButton = document.createElement('a');
        aboutButton.href = slide.secondaryButtonUrl || '#about';
        aboutButton.className = 'btn btn-secondary btn-large hero-about-btn';
        aboutButton.textContent = slide.secondaryButtonText || (localStorage.getItem('site_language') === 'en' ? 'About Us' : 'Hakkımızda');

        actions.appendChild(button);
        actions.appendChild(aboutButton);
        content.appendChild(brand);
        content.appendChild(title);
        content.appendChild(description);
        content.appendChild(actions);
        slideDiv.appendChild(content);

        if (index === 0 && APP_CONFIG.hero?.media) {
            const media = APP_CONFIG.hero.media;
            const productMediaUrl = resolveHeroMediaUrl(media.coldDrinksTop);
            const productFallbackUrl = resolveHeroMediaUrl(media.coldDrinksFront);
            const baristaMediaUrl = resolveHeroMediaUrl(media.detail);
            const baristaFallbackUrl = resolveHeroMediaUrl(media.primary);
            const useHeroVideo = APP_CONFIG.hero.mediaType !== 'image';
            const heroImageUrl = resolveHeroMediaUrl(media.primary);
            const reelPlaylist = (useHeroVideo ? [media.reelSecondary, media.reelPrimary] : [])
                .map(resolveHeroMediaUrl)
                .filter(Boolean);
            const reelMediaUrl = reelPlaylist[0] || '';
            const reelPosterUrl = resolveHeroMediaUrl(media.reelPoster || media.coldDrinksFront || media.detail);

            if (reelMediaUrl || productMediaUrl || baristaMediaUrl) {
                const mediaStage = document.createElement('div');
                mediaStage.className = 'hero-media-stage';

                if (reelMediaUrl) {
                    const reelPanel = document.createElement('figure');
                    reelPanel.className = 'hero-main-media';
                    reelPanel.setAttribute('aria-label', localStorage.getItem('site_language') === 'en'
                        ? 'Tahmisçi featured video'
                        : 'Tahmisçi öne çıkan video');

                    const reelVideo = document.createElement('video');
                    reelVideo.className = 'hero-main-video';
                    reelVideo.poster = reelPosterUrl;
                    reelVideo.autoplay = true;
                    reelVideo.muted = true;
                    reelVideo.defaultMuted = true;
                    reelVideo.loop = false;
                    reelVideo.playsInline = true;
                    reelVideo.preload = 'auto';
                    reelVideo.disablePictureInPicture = true;
                    reelVideo.controls = false;
                    reelVideo.setAttribute('autoplay', '');
                    reelVideo.setAttribute('muted', '');
                    reelVideo.setAttribute('playsinline', '');
                    reelVideo.setAttribute('preload', 'auto');
                    const reduceMotion = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
                    if (reduceMotion) {
                        reelVideo.autoplay = false;
                        reelVideo.removeAttribute('autoplay');
                        reelVideo.preload = 'metadata';
                    }

                    const reelSource = document.createElement('source');
                    reelSource.src = reelMediaUrl;
                    reelSource.type = 'video/mp4';
                    reelVideo.appendChild(reelSource);
                    reelPanel.appendChild(reelVideo);
                    mediaStage.appendChild(reelPanel);

                    reelPanel.dataset.mediaState = 'loading';
                    reelPanel.dataset.playlistLoop = 'true';
                    let reelIndex = 0;
                    let consecutiveReelErrors = 0;
                    const pauseReel = (state) => {
                        reelPanel.dataset.mediaState = state;
                        reelVideo.pause();
                    };
                    const playReel = () => {
                        if (reduceMotion) {
                            pauseReel('reduced-motion');
                            return;
                        }
                        reelVideo.autoplay = true;
                        reelVideo.setAttribute('autoplay', '');
                        const playPromise = reelVideo.play();
                        if (playPromise && typeof playPromise.catch === 'function') {
                            playPromise
                                .then(() => { reelPanel.dataset.mediaState = 'playing'; })
                                .catch(() => pauseReel('play-blocked'));
                        }
                    };
                    const handleLoadedData = () => {
                        consecutiveReelErrors = 0;
                        reelPanel.dataset.loadedData = 'true';
                        reelPanel.dataset.mediaState = 'loadeddata';
                        playReel();
                    };
                    const handleCanPlay = () => {
                        reelPanel.dataset.canPlay = 'true';
                        reelPanel.dataset.mediaState = 'canplay';
                        playReel();
                    };
                    const loadReelAt = (indexToLoad) => {
                        if (!reelPlaylist.length) return;
                        reelIndex = (indexToLoad + reelPlaylist.length) % reelPlaylist.length;
                        reelPanel.dataset.reelIndex = String(reelIndex);
                        reelSource.src = reelPlaylist[reelIndex];
                        reelPanel.dataset.mediaState = 'loading-next';
                        reelVideo.load();
                    };
                    const handleReelEnded = () => loadReelAt(reelIndex + 1);
                    const handleReelError = () => {
                        consecutiveReelErrors += 1;
                        if (consecutiveReelErrors < reelPlaylist.length) {
                            loadReelAt(reelIndex + 1);
                            return;
                        }
                        pauseReel('error');
                    };
                    reelVideo.addEventListener('loadeddata', handleLoadedData);
                    reelVideo.addEventListener('canplay', handleCanPlay);
                    reelVideo.addEventListener('ended', handleReelEnded);
                    reelVideo.addEventListener('error', handleReelError);
                    window.__cleanupTahmisciHeroMedia = () => {
                        reelVideo.removeEventListener('loadeddata', handleLoadedData);
                        reelVideo.removeEventListener('canplay', handleCanPlay);
                        reelVideo.removeEventListener('ended', handleReelEnded);
                        reelVideo.removeEventListener('error', handleReelError);
                        reelVideo.pause();
                    };
                    requestAnimationFrame(playReel);
                } else if (!useHeroVideo && heroImageUrl) {
                    const imagePanel = document.createElement('figure');
                    imagePanel.className = 'hero-main-media';
                    const mainImage = document.createElement('img');
                    mainImage.className = 'hero-main-image';
                    mainImage.src = heroImageUrl;
                    mainImage.alt = localStorage.getItem('site_language') === 'en'
                        ? 'Tahmisçi hero image'
                        : 'Tahmisçi hero görseli';
                    mainImage.loading = 'eager';
                    imagePanel.appendChild(mainImage);
                    mediaStage.appendChild(imagePanel);
                }

                if (productMediaUrl) {
                    const productMedia = document.createElement('figure');
                    productMedia.className = 'hero-product-media';
                    const productImage = document.createElement('img');
                    productImage.src = productMediaUrl;
                    productImage.alt = localStorage.getItem('site_language') === 'en'
                        ? 'Tahmisçi colorful cold drinks'
                        : 'Tahmisçi renkli soğuk içecekleri';
                    productImage.loading = 'eager';
                    if (productFallbackUrl) {
                        productImage.addEventListener('error', () => {
                            if (productImage.src !== productFallbackUrl) productImage.src = productFallbackUrl;
                        }, { once: true });
                    }
                    productMedia.appendChild(productImage);
                    mediaStage.appendChild(productMedia);
                }

                if (baristaMediaUrl) {
                    const baristaMedia = document.createElement('figure');
                    baristaMedia.className = 'hero-barista-media';
                    const baristaImage = document.createElement('img');
                    baristaImage.src = baristaMediaUrl;
                    baristaImage.alt = localStorage.getItem('site_language') === 'en'
                        ? 'Tahmisçi barista pouring milk into a cup'
                        : 'Fincana süt döken Tahmisçi baristası';
                    baristaImage.loading = 'eager';
                    if (baristaFallbackUrl) {
                        baristaImage.addEventListener('error', () => {
                            if (baristaImage.src !== baristaFallbackUrl) baristaImage.src = baristaFallbackUrl;
                        }, { once: true });
                    }
                    baristaMedia.appendChild(baristaImage);
                    mediaStage.appendChild(baristaMedia);
                }

                slideDiv.appendChild(mediaStage);
                slideDiv.classList.add('hero-slide--editorial');
            }
        }

        return slideDiv;
    }

    function updateSlider() {
        const sliderTrack = document.getElementById('heroSliderTrack');
        const dots = document.querySelectorAll('.hero-slider-dot');

        if (!sliderTrack) return;

        const slideWidth = 100;
        sliderTrack.style.transform = `translateX(-${currentSlide * slideWidth}%)`;

        // Update dots
        dots.forEach((dot, index) => {
            if (index === currentSlide) {
                dot.classList.add('active');
            } else {
                dot.classList.remove('active');
            }
        });

        isTransitioning = false;
    }

    function nextSlide() {
        if (isTransitioning) return;
        isTransitioning = true;

        const slides = APP_CONFIG.hero?.slides || [];
        currentSlide = (currentSlide + 1) % slides.length;
        updateSlider();
        startAutoplay();
    }

    function prevSlide() {
        if (isTransitioning) return;
        isTransitioning = true;

        const slides = APP_CONFIG.hero?.slides || [];
        currentSlide = (currentSlide - 1 + slides.length) % slides.length;
        updateSlider();
        startAutoplay();
    }

    function goToSlide(index) {
        if (isTransitioning) return;
        isTransitioning = true;

        currentSlide = index;
        updateSlider();
        startAutoplay();
    }

    function startAutoplay() {
        stopAutoplay();

        if (document.body.classList.contains('tahmisci-static-menu')) return;
        if (!APP_CONFIG.hero?.autoplay) return;

        const interval = APP_CONFIG.hero.autoplayInterval || 5000;
        autoplayTimer = setInterval(() => {
            nextSlide();
        }, interval);
    }

    function stopAutoplay() {
        if (autoplayTimer) {
            clearInterval(autoplayTimer);
            autoplayTimer = null;
        }
    }

    // Pause autoplay on hover
    const sliderWrapper = document.querySelector('.hero-slider-wrapper');
    if (sliderWrapper) {
        sliderWrapper.addEventListener('mouseenter', stopAutoplay);
        sliderWrapper.addEventListener('mouseleave', startAutoplay);
    }

    // Initialize when DOM is ready or when hero data is loaded
    function initializeSlider() {
        if (APP_CONFIG && APP_CONFIG.hero && APP_CONFIG.hero.slides && APP_CONFIG.hero.slides.length > 0) {
            initHeroSlider();
        }
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', initializeSlider);
    } else {
        initializeSlider();
    }

    // Listen for hero data loaded event
    window.addEventListener('heroDataLoaded', initializeSlider);

    // Expose for external use
    window.HeroSlider = {
        next: nextSlide,
        prev: prevSlide,
        goTo: goToSlide,
        startAutoplay: startAutoplay,
        stopAutoplay: stopAutoplay
    };
})();
