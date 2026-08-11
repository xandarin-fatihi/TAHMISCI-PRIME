/**
 * SwipeModalController – Tekrar kullanılabilir modal swipe-to-close sınıfı
 * Sadece mobil (touch) cihazlarda çalışır. Soldan sağa kaydırarak modal kapatma.
 * Tüm önemli adımlar Türkçe yorumludur.
 */
(function (global) {
    "use strict";

    /**
     * Platform tespiti: iOS / Android için eşik değerleri
     */
    function getPlatformConfig() {
        const ua = navigator.userAgent || navigator.vendor || "";
        const isIOS = /iPad|iPhone|iPod/.test(ua) || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
        const isAndroid = /android/i.test(ua);
        if (isIOS) {
            return { edgePx: 20, distancePx: 80, name: "ios" };
        }
        if (isAndroid) {
            return { edgePx: 30, distancePx: 100, name: "android" };
        }
        return { edgePx: 25, distancePx: 90, name: "other" };
    }

    /**
     * Touch cihaz mı kontrolü
     */
    function isTouchDevice() {
        return "ontouchstart" in window || navigator.maxTouchPoints > 0;
    }

    /**
     * Elastic (lastik) offset hesaplama – kaydırma arttıkça direnç hissi
     */
    function elasticOffset(rawPx) {
        if (rawPx <= 0) return 0;
        const resistance = 280;
        return (rawPx * resistance) / (resistance + rawPx);
    }

    /**
     * @param {Object} options
     * @param {string|HTMLElement} options.overlay – Overlay element veya id
     * @param {string|HTMLElement|'auto'} [options.modal='auto'] – Modal kutusu; 'auto' = overlay'ın ilk çocuğu
     * @param {Function} options.onClose – Modal kapatıldığında çağrılacak fonksiyon
     * @param {string} [options.draggingClass='swipe-dragging'] – Sürüklenirken eklenecek CSS sınıfı
     */
    function SwipeModalController(options) {
        if (!options || !options.overlay || typeof options.onClose !== "function") {
            console.warn("SwipeModalController: overlay ve onClose zorunludur.");
            return;
        }

        // Sadece touch cihazlarda etkinleştir
        if (!isTouchDevice()) return;

        const overlay =
            typeof options.overlay === "string"
                ? document.getElementById(options.overlay) || document.querySelector(options.overlay)
                : options.overlay;
        if (!overlay) return;

        let modal = null;
        if (options.modal === "auto" || !options.modal) {
            modal = overlay.firstElementChild;
        } else if (typeof options.modal === "string") {
            modal = overlay.querySelector(options.modal) || document.querySelector(options.modal);
        } else {
            modal = options.modal;
        }
        if (!modal) return;

        const onClose = options.onClose;
        const draggingClass = options.draggingClass || "swipe-dragging";
        const platform = getPlatformConfig();

        // Hız eşiği: bu hızın üzerinde swipe kapatma tetiklenir (px/ms)
        const VELOCITY_THRESHOLD = 0.35;
        // Dikey hareket bu katsayıdan büyükse swipe iptal (yatay baskınsa devam)
        const VERTICAL_CANCEL_RATIO = 1.1;

        let startX = 0;
        let startY = 0;
        let startTime = 0;
        let isCapturing = false;
        let isCancelled = false;
        let lastX = 0;
        let lastY = 0;
        let lastTime = 0;
        let rafId = null;

        /**
         * Transform ve backdrop güncellemesi – requestAnimationFrame ile performanslı
         */
        function applyTransform(offsetX, backdropOpacity) {
            if (!modal || !overlay) return;
            modal.style.transform = "translate(" + offsetX + "px, 0)";
            overlay.style.opacity = String(backdropOpacity);
        }

        /**
         * Swipe durumunu sıfırla, class kaldır
         */
        function resetState() {
            isCapturing = false;
            isCancelled = false;
            overlay.classList.remove(draggingClass);
            if (rafId != null) {
                cancelAnimationFrame(rafId);
                rafId = null;
            }
            modal.style.transform = "";
            overlay.style.opacity = "";
        }

        /**
         * Yetersiz swipe – yumuşak animasyonla eski yerine dön
         */
        function animateBack() {
            overlay.classList.remove(draggingClass);
            modal.style.transition = "transform 0.25s cubic-bezier(0.4, 0, 0.2, 1)";
            overlay.style.transition = "opacity 0.25s ease";
            modal.style.transform = "translate(0, 0)";
            overlay.style.opacity = "1";
            const onEnd = function () {
                modal.style.transition = "";
                overlay.style.transition = "";
                modal.removeEventListener("transitionend", onEnd);
            };
            modal.addEventListener("transitionend", onEnd);
            setTimeout(function () {
                modal.style.transform = "";
                overlay.style.opacity = "";
            }, 280);
        }

        function handleTouchStart(e) {
            if (!overlay.classList.contains("active")) return;
            const touch = e.touches[0];
            const clientX = touch.clientX;
            const clientY = touch.clientY;
            // Swipe SADECE ekranın en sol kenarından başlarsa aktif
            if (clientX > platform.edgePx) return;
            startX = clientX;
            startY = clientY;
            startTime = Date.now();
            lastX = clientX;
            lastY = clientY;
            lastTime = startTime;
            isCapturing = true;
            isCancelled = false;
            overlay.classList.add(draggingClass);
        }

        function handleTouchMove(e) {
            if (!isCapturing || isCancelled) return;
            const touch = e.touches[0];
            const clientX = touch.clientX;
            const clientY = touch.clientY;
            const deltaX = clientX - startX;
            const deltaY = clientY - startY;

            // Dikey kaydırma baskınsa swipe-to-close iptal (scroll bozulmasın)
            const absX = Math.abs(deltaX);
            const absY = Math.abs(deltaY);
            if (absY > absX * VERTICAL_CANCEL_RATIO) {
                isCancelled = true;
                resetState();
                animateBack();
                return;
            }
            // Sadece sağa kaydırma (pozitif deltaX) – sola kaydırma modalı kapatmaz
            if (deltaX < 0) return;

            e.preventDefault();

            const displayX = elasticOffset(deltaX);
            const opacity = Math.max(0.35, 1 - (displayX / 350));
            lastX = clientX;
            lastY = clientY;
            lastTime = Date.now();

            /* Hemen uygula; rAF bir kare gecikme yapıyordu, telefonda kasma hissi veriyordu */
            applyTransform(displayX, opacity);
        }

        function handleTouchEnd(e) {
            if (!isCapturing) return;
            const touch = e.changedTouches[0];
            const endX = touch.clientX;
            const endY = touch.clientY;
            const deltaX = endX - startX;
            const deltaY = endY - startY;
            const duration = Date.now() - startTime;
            const velocity = duration > 0 ? Math.abs(deltaX) / duration : 0;

            const shouldClose =
                isCancelled === false &&
                deltaX > 0 &&
                (deltaX >= platform.distancePx || velocity >= VELOCITY_THRESHOLD);

            if (shouldClose) {
                // Sadece state ve class temizle; inline stiller onClose içinde temizlenecek
                isCapturing = false;
                isCancelled = false;
                overlay.classList.remove(draggingClass);
                if (rafId != null) {
                    cancelAnimationFrame(rafId);
                    rafId = null;
                }
                onClose();
            } else {
                resetState();
                animateBack();
            }
        }

        // Touch dinleyicileri – passive: false sadece touchmove'da (preventDefault için)
        overlay.addEventListener("touchstart", handleTouchStart, { passive: true });
        overlay.addEventListener("touchmove", handleTouchMove, { passive: false });
        overlay.addEventListener("touchend", handleTouchEnd, { passive: true });
        overlay.addEventListener("touchcancel", function () {
            if (isCapturing) {
                resetState();
                animateBack();
            }
        }, { passive: true });
    }

    /**
     * Birden fazla modalı tek seferde swipe-to-close ile kaydeder (kod tekrarı yok).
     * Yeni modal eklemek için configs dizisine { overlay: "modalOverlayId", onClose: fn } ekle;
     * overlay: id veya element, modal: "auto" (varsayılan, ilk çocuk) veya selector.
     * @param {Array<{overlay: string|HTMLElement, modal?: string|HTMLElement|'auto', onClose: Function, draggingClass?: string}>} configs – Modal config listesi
     */
    function registerModals(configs) {
        if (!Array.isArray(configs) || !configs.length) return;
        configs.forEach(function (cfg) {
            try {
                new SwipeModalController(cfg);
            } catch (err) {
                console.warn("SwipeModalController.registerModals:", cfg.overlay, err);
            }
        });
    }

    SwipeModalController.registerModals = registerModals;
    global.SwipeModalController = SwipeModalController;
})(typeof window !== "undefined" ? window : this);

