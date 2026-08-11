// ========== FOOTER LOADER ==========
// Footer verilerini PHP'den AJAX ile çeker ve HTML'e yükler

class FooterLoader {
    async loadFooter() {
        try {
            const provider = window.TahmisciPublicData;
            if (!provider) return;
            await provider.ready;
            provider.apply(provider.getBootstrap(), 'footer');
        } catch (error) {
            console.error('Footer yükleme hatası:', error);
        }
    }

    renderFooter(data) {
        const footer = document.querySelector('.footer');
        if (!footer) return;

        // Logo ve Açıklama
        const footerLogo = footer.querySelector('.footer-logo h3');
        if (footerLogo && data.logo) {
            footerLogo.innerHTML = `${data.logo.icon} ${data.logo.brandName}`;
        }

        const footerDescription = footer.querySelector('.footer-description');
        if (footerDescription && data.description) {
            footerDescription.textContent = data.description;
        }

        // Sosyal Medya Linkleri
        const socialLinks = footer.querySelector('.social-links');
        if (socialLinks && data.socialLinks) {
            socialLinks.innerHTML = '';
            data.socialLinks.forEach(social => {
                const a = document.createElement('a');
                a.href = social.url;
                a.className = 'social-link';
                a.title = social.title;
                a.setAttribute('target', '_blank');
                a.setAttribute('rel', 'noopener noreferrer');
                a.innerHTML = `<i class="${social.icon}"></i>`;
                socialLinks.appendChild(a);
            });
        }

        // Hızlı Linkler
        const footerLinks = footer.querySelector('.footer-links');
        if (footerLinks && data.quickLinks) {
            footerLinks.innerHTML = '';
            data.quickLinks.forEach(link => {
                const li = document.createElement('li');
                const a = document.createElement('a');
                a.href = link.url;
                a.textContent = link.text;
                li.appendChild(a);
                footerLinks.appendChild(li);
            });
        }

        // İletişim Bilgileri
        const contactSection = footer.querySelector('.footer-section:last-of-type');
        if (contactSection && data.contact) {
            // Title'ı koru
            const title = contactSection.querySelector('.footer-title');
            const contactContainer = contactSection.querySelector('.contact-item')?.parentElement || contactSection;

            // Sadece contact-item'ları temizle
            const existingItems = contactSection.querySelectorAll('.contact-item');
            existingItems.forEach(item => item.remove());

            data.contact.forEach(contact => {
                const div = document.createElement('div');
                div.className = 'contact-item';

                const icon = document.createElement('i');
                icon.className = contact.icon;

                const span = document.createElement('span');
                if (contact.url) {
                    const a = document.createElement('a');
                    a.href = contact.url;
                    a.textContent = contact.text;
                    if (contact.url.indexOf('http') === 0) {
                        a.target = '_blank';
                        a.rel = 'noopener noreferrer';
                    }
                    span.appendChild(a);
                } else {
                    span.textContent = contact.text;
                }

                div.appendChild(icon);
                div.appendChild(span);
                contactContainer.appendChild(div);
            });
        }

        // Footer Bottom (copyright API'dan HTML gelebilir; innerHTML kullan)
        const footerBottom = footer.querySelector('.footer-bottom-content');
        if (footerBottom && data.bottom) {
            const copyright = footerBottom.querySelector('p');
            if (copyright && data.bottom.copyright) {
                copyright.innerHTML = data.bottom.copyright;
            }

            const bottomLinks = footerBottom.querySelector('.footer-bottom-links');
            if (bottomLinks && data.bottom.links) {
                bottomLinks.innerHTML = '';
                data.bottom.links.forEach(link => {
                    const a = document.createElement('a');
                    a.href = link.url;
                    a.textContent = link.text;
                    if (link.url && link.url.indexOf('http') === 0) {
                        a.target = '_blank';
                        a.rel = 'noopener noreferrer';
                    }
                    bottomLinks.appendChild(a);
                });
            }
        }

        this.updateMobileContactOverlay(data);
    }

    updateMobileContactOverlay(data) {
        const container = document.getElementById('mobileContactOptions');
        if (!container) return;
        const t = (key, fallback) => (window.I18N && window.I18N.t ? window.I18N.t(key, fallback) : fallback);

        const contact = Array.isArray(data.contact) ? data.contact : [];
        const socialLinks = Array.isArray(data.socialLinks) ? data.socialLinks : [];
        const reviewUrl = data.reviewUrl || null;
        let waHref = (data.whatsappUrl && String(data.whatsappUrl).trim()) || '';

        const phoneItem = contact.find(c => c.type === 'phone');
        const emailItem = contact.find(c => c.type === 'email');
        const addressItem = contact.find(c => c.type === 'address');
        const instagramItem = socialLinks.find(s => (s.title || '').toLowerCase().indexOf('instagram') !== -1);
        const tiktokItem = socialLinks.find(s => (s.title || '').toLowerCase().indexOf('tiktok') !== -1);

        const phone = phoneItem ? (phoneItem.text || '').trim() : '';
        let phoneHref = phoneItem && phoneItem.url ? String(phoneItem.url).replace(/^tel:/i, '').trim() : '';
        if (phone && !phoneHref) {
            const digits = phone.replace(/\D/g, '');
            phoneHref = digits.length >= 10 ? (digits.startsWith('90') ? '+' + digits : '90' + digits.replace(/^0/, '')) : '';
            if (phoneHref && phoneHref.indexOf('+') !== 0) phoneHref = '+' + phoneHref;
        }
        if (!waHref && phoneHref) {
            const waNum = phoneHref.replace(/\D/g, '').replace(/^90/, '');
            waHref = waNum ? 'https://wa.me/90' + waNum : '';
        }

        const fragments = [];

        if (phone && phoneHref) {
            const a = document.createElement('a');
            a.href = 'tel:' + phoneHref.replace(/\s/g, '');
            a.className = 'mobile-contact-option';
            a.innerHTML = '<i class="fas fa-phone"></i><span>' + (t('contact_call', 'Ara') + ' ' + phone) + '</span>';
            fragments.push(a);
        }
        if (waHref) {
            const a = document.createElement('a');
            a.href = waHref;
            a.target = '_blank';
            a.rel = 'noopener noreferrer';
            a.className = 'mobile-contact-option';
            a.innerHTML = '<i class="fab fa-whatsapp"></i><span>' + t('contact_whatsapp', "Whatsapp'tan Yaz") + '</span>';
            fragments.push(a);
        }
        if (emailItem && (emailItem.url || emailItem.text)) {
            const a = document.createElement('a');
            a.href = emailItem.url || ('mailto:' + (emailItem.text || '').trim());
            a.className = 'mobile-contact-option';
            a.innerHTML = '<i class="fas fa-envelope"></i><span>' + t('contact_email', 'E-posta Gönder') + '</span>';
            fragments.push(a);
        }
        if (addressItem && (addressItem.url || addressItem.text)) {
            const a = document.createElement('a');
            a.href = addressItem.url || ('https://www.google.com/maps?q=' + encodeURIComponent(addressItem.text || ''));
            a.target = '_blank';
            a.rel = 'noopener noreferrer';
            a.className = 'mobile-contact-option';
            a.innerHTML = '<i class="fas fa-map-marker-alt"></i><span>' + t('contact_location', 'Konuma Git') + '</span>';
            fragments.push(a);
        }
        if (instagramItem && instagramItem.url && instagramItem.url !== '#') {
            const a = document.createElement('a');
            a.href = instagramItem.url;
            a.target = '_blank';
            a.rel = 'noopener noreferrer';
            a.className = 'mobile-contact-option';
            a.innerHTML = '<i class="fab fa-instagram"></i><span>' + t('contact_instagram', "Instagram'dan Takip Edin") + '</span>';
            fragments.push(a);
        }
        if (tiktokItem && tiktokItem.url && tiktokItem.url !== '#') {
            const a = document.createElement('a');
            a.href = tiktokItem.url;
            a.target = '_blank';
            a.rel = 'noopener noreferrer';
            a.className = 'mobile-contact-option';
            a.innerHTML = '<i class="fab fa-tiktok"></i><span>TikTok</span>';
            fragments.push(a);
        }
        if (reviewUrl) {
            const a = document.createElement('a');
            a.href = reviewUrl;
            a.target = '_blank';
            a.rel = 'noopener noreferrer';
            a.className = 'mobile-contact-option';
            a.innerHTML = '<i class="fab fa-google"></i><span>' + t('contact_review', 'Google Yorum Yap') + '</span>';
            fragments.push(a);
        }

        container.innerHTML = '';
        fragments.forEach(el => container.appendChild(el));
    }
}

// Sayfa yüklendiğinde footer'ı yükle
document.addEventListener('DOMContentLoaded', () => {
    const footerLoader = new FooterLoader();
    window.footerLoader = footerLoader;
    footerLoader.loadFooter();

    window.addEventListener('languageChanged', () => {
        footerLoader.loadFooter();
    });
});
