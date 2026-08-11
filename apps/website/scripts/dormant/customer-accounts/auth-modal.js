// ========== AUTH MODAL FUNCTIONALITY ==========

(function () {
    'use strict';

    // Wait for DOM to be ready
    function initAuthModal() {
        // Modal elements
        const loginModal = document.getElementById('loginModal');
        const registerModal = document.getElementById('registerModal');
        const loginModalClose = document.getElementById('loginModalClose');
        const registerModalClose = document.getElementById('registerModalClose');
        const loginForm = document.getElementById('loginForm');
        const registerForm = document.getElementById('registerForm');
        const btnLogin = document.getElementById('btnLogin');
        const btnRegister = document.getElementById('btnRegister');
        const switchToRegister = document.getElementById('switchToRegister');
        const switchToLogin = document.getElementById('switchToLogin');

        // Open/Close Functions
        function openLoginModal() {
            if (loginModal) {
                loginModal.classList.add('active');
                document.body.classList.add('modal-open');
                document.body.style.overflow = 'hidden';
                // Add header overlay active class
                const headerOverlay = document.getElementById('headerOverlay');
                if (headerOverlay) {
                    headerOverlay.classList.add('active');
                }
                // Focus on first input
                const firstInput = loginModal.querySelector('input');
                if (firstInput) setTimeout(() => firstInput.focus(), 100);
            }
        }

        function closeLoginModal() {
            if (loginModal) {
                loginModal.classList.remove('active');
                document.body.classList.remove('modal-open');
                document.body.style.overflow = '';
                // Remove header overlay active class
                const headerOverlay = document.getElementById('headerOverlay');
                if (headerOverlay) {
                    headerOverlay.classList.remove('active');
                }
                if (loginForm) loginForm.reset();
            }
        }

        function openRegisterModal() {
            if (registerModal) {
                registerModal.classList.add('active');
                document.body.classList.add('modal-open');
                document.body.style.overflow = 'hidden';
                // Add header overlay active class
                const headerOverlay = document.getElementById('headerOverlay');
                if (headerOverlay) {
                    headerOverlay.classList.add('active');
                }
                // Reset to step 1
                resetRegisterModal();
                // Focus on first input
                const firstInput = registerModal.querySelector('#registerPhone');
                if (firstInput) setTimeout(() => firstInput.focus(), 100);
            }
        }

        function closeRegisterModal() {
            if (registerModal) {
                registerModal.classList.remove('active');
                document.body.classList.remove('modal-open');
                document.body.style.overflow = '';
                // Remove header overlay active class
                const headerOverlay = document.getElementById('headerOverlay');
                if (headerOverlay) {
                    headerOverlay.classList.remove('active');
                }
                if (registerForm) registerForm.reset();
                resetRegisterModal();
            }
        }

        function openLegalDocModal(type) {
            var modal = document.getElementById('legalDocModal');
            var titleEl = document.getElementById('legalDocModalTitle');
            var contentEl = document.getElementById('legalDocModalContent');
            var loadingEl = document.getElementById('legalDocModalLoading');
            if (!modal || !titleEl || !contentEl || !loadingEl) return;
            var branchId = parseInt(localStorage.getItem('menuBranchId') || '0', 10) || 0;
            var companyId = typeof getRegisterCompanyId === 'function' ? getRegisterCompanyId() : (parseInt(localStorage.getItem('menuCompanyId') || localStorage.getItem('menuBranchId') || '48', 10)) || 48;
            var base = (typeof getSiteRoot === 'function' ? getSiteRoot() : (window.getSiteRoot && window.getSiteRoot())) || '';
            var endpoint = type === 'terms' ? 'terms-of-use.php' : 'disclosure-notice.php';
            var params = new URLSearchParams();
            if (branchId > 0) params.set('branch_id', branchId);
            if (companyId > 0) params.set('company_id', companyId);
            params.set('lang', (window.I18N && window.I18N.getPreferredLanguage && window.I18N.getPreferredLanguage()) || localStorage.getItem('site_language') || 'tr');
            modal.classList.add('active');
            document.body.classList.add('modal-open');
            document.body.style.overflow = 'hidden';
            titleEl.textContent = type === 'terms' ? (params.get('lang') === 'en' ? 'Terms of Use' : 'Kullanım Sözleşmesi') : (params.get('lang') === 'en' ? 'Privacy Notice' : 'Aydınlatma Metni');
            contentEl.innerHTML = '';
            loadingEl.style.display = 'block';
            fetch(base + '/yeppanel/db/ajax/web/' + endpoint + '?' + params.toString())
                .then(function (r) { return r.json(); })
                .then(function (data) {
                    loadingEl.style.display = 'none';
                    if (data && data.success && data.title) {
                        titleEl.textContent = data.title;
                        contentEl.innerHTML = data.html || '';
                    } else {
                        contentEl.innerHTML = '<p>' + (params.get('lang') === 'en' ? 'Content could not be loaded.' : 'İçerik yüklenemedi.') + '</p>';
                    }
                })
                .catch(function () {
                    loadingEl.style.display = 'none';
                    contentEl.innerHTML = '<p>' + (params.get('lang') === 'en' ? 'Content could not be loaded.' : 'İçerik yüklenemedi.') + '</p>';
                });
        }

        function closeLegalDocModal() {
            var modal = document.getElementById('legalDocModal');
            if (modal) {
                modal.classList.remove('active');
                document.body.classList.remove('modal-open');
                document.body.style.overflow = '';
            }
        }

        var legalDocModalClose = document.getElementById('legalDocModalClose');
        if (legalDocModalClose) legalDocModalClose.addEventListener('click', closeLegalDocModal);
        var legalDocModalFooterClose = document.getElementById('legalDocModalFooterClose');
        if (legalDocModalFooterClose) legalDocModalFooterClose.addEventListener('click', closeLegalDocModal);
        document.addEventListener('click', function (e) {
            if (e.target.id === 'legalDocModal' && e.target.classList.contains('legal-doc-modal-overlay')) closeLegalDocModal();
        });

        // Register Modal Step Management
        function resetRegisterModal() {
            const step1 = document.getElementById('registerStep1');
            const step2 = document.getElementById('registerStep2');
            if (step1) step1.style.display = 'block';
            if (step2) step2.style.display = 'none';
            // Reset code inputs
            const codeInputs = document.querySelectorAll('.verification-code-input');
            codeInputs.forEach(input => {
                input.value = '';
                input.classList.remove('error', 'success');
            });
        }

        function showRegisterStep2() {
            const step1 = document.getElementById('registerStep1');
            const step2 = document.getElementById('registerStep2');
            if (step1) step1.style.display = 'none';
            if (step2) step2.style.display = 'flex';
            // Focus first code input
            const firstCodeInput = document.querySelector('.verification-code-input');
            if (firstCodeInput) setTimeout(() => firstCodeInput.focus(), 100);
        }

        function showRegisterStep1() {
            const step1 = document.getElementById('registerStep1');
            const step2 = document.getElementById('registerStep2');
            if (step2) step2.style.display = 'none';
            if (step1) step1.style.display = 'block';
        }

        // Validation Functions
        function validateEmail(email) {
            const re = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
            return re.test(email);
        }

        function cleanPhoneNumber(phone) {
            // Clean and format phone number to 10 digits without 0 or 90 prefix
            let cleaned = phone.replace(/\D/g, '');

            // Remove +90 or 90 prefix if present (12 digits: 90XXXXXXXXXX -> 10 digits: XXXXXXXXXX)
            if (cleaned.startsWith('90') && cleaned.length > 10) {
                cleaned = cleaned.substring(2);
            }

            // Remove leading 0
            if (cleaned.startsWith('0')) {
                cleaned = cleaned.substring(1);
            }

            // Limit to 10 digits
            cleaned = cleaned.substring(0, 10);

            return cleaned;
        }

        function validatePhone(phone) {
            // Turkish phone number validation (10 digits, cannot start with 0 or 90)
            const cleaned = cleanPhoneNumber(phone);

            // Must be exactly 10 digits
            if (cleaned.length !== 10) {
                return false;
            }

            // Cannot start with 0 or 90 (after cleaning)
            if (cleaned.startsWith('0') || cleaned.startsWith('90')) {
                return false;
            }

            return true;
        }

        function validateFirstName(name) {
            return name.trim().length >= 2;
        }

        function validateLastName(name) {
            return name.trim().length >= 2;
        }

        function validatePassword(password) {
            // Minimum 8 karakter
            return password.trim().length >= 8;
        }

        function validatePasswordMatch(password, confirmPassword) {
            return password === confirmPassword;
        }

        function showFieldError(input, message) {
            const formGroup = input.closest('.form-group');
            if (!formGroup) return;

            // Remove existing error
            const existingError = formGroup.querySelector('.field-error');
            if (existingError) existingError.remove();

            // Add error class
            input.classList.add('error');

            // Create error message
            const errorDiv = document.createElement('div');
            errorDiv.className = 'field-error';
            errorDiv.textContent = message;
            formGroup.appendChild(errorDiv);
        }

        function removeFieldError(input) {
            const formGroup = input.closest('.form-group');
            if (!formGroup) return;

            input.classList.remove('error');
            const existingError = formGroup.querySelector('.field-error');
            if (existingError) existingError.remove();
        }

        function validateRegisterForm() {
            const phone = document.getElementById('registerPhone');
            const firstName = document.getElementById('registerFirstName');
            const lastName = document.getElementById('registerLastName');
            const email = document.getElementById('registerEmail');
            const password = document.getElementById('registerPassword');
            const passwordConfirm = document.getElementById('registerPasswordConfirm');

            let isValid = true;

            // Validate phone
            if (!phone || !phone.value.trim()) {
                if (phone) showFieldError(phone, 'Telefon numarası gereklidir');
                isValid = false;
            } else {
                // Clean phone value before validation
                const cleanedValue = cleanPhoneNumber(phone.value);
                phone.value = cleanedValue;

                if (!validatePhone(phone.value)) {
                    const cleaned = phone.value.replace(/\D/g, '');
                    if (cleaned.length !== 10) {
                        showFieldError(phone, 'Telefon numarası 10 haneli olmalıdır');
                    } else if (cleaned.startsWith('0')) {
                        showFieldError(phone, 'Telefon numarası 0 ile başlayamaz');
                    } else if (cleaned.startsWith('90')) {
                        showFieldError(phone, 'Telefon numarası 90 ile başlayamaz');
                    } else {
                        showFieldError(phone, 'Geçerli bir telefon numarası giriniz');
                    }
                    isValid = false;
                } else {
                    removeFieldError(phone);
                }
            }

            // Validate first name
            if (!firstName || !firstName.value.trim()) {
                if (firstName) showFieldError(firstName, 'Ad gereklidir');
                isValid = false;
            } else if (!validateFirstName(firstName.value)) {
                showFieldError(firstName, 'Ad en az 2 karakter olmalıdır');
                isValid = false;
            } else {
                removeFieldError(firstName);
            }

            // Validate last name
            if (!lastName || !lastName.value.trim()) {
                if (lastName) showFieldError(lastName, 'Soyad gereklidir');
                isValid = false;
            } else if (!validateLastName(lastName.value)) {
                showFieldError(lastName, 'Soyad en az 2 karakter olmalıdır');
                isValid = false;
            } else {
                removeFieldError(lastName);
            }

            // Validate email
            if (!email || !email.value.trim()) {
                if (email) showFieldError(email, 'E-posta adresi gereklidir');
                isValid = false;
            } else if (!validateEmail(email.value)) {
                showFieldError(email, 'Geçerli bir e-posta adresi giriniz');
                isValid = false;
            } else {
                removeFieldError(email);
            }

            // Validate password
            if (!password || !password.value.trim()) {
                if (password) showFieldError(password, 'Şifre gereklidir');
                isValid = false;
            } else if (!validatePassword(password.value)) {
                showFieldError(password, 'Şifre en az 8 karakter olmalıdır');
                isValid = false;
            } else {
                removeFieldError(password);
            }

            // Validate password confirmation
            if (!passwordConfirm || !passwordConfirm.value.trim()) {
                if (passwordConfirm) showFieldError(passwordConfirm, 'Şifre tekrarı gereklidir');
                isValid = false;
            } else if (!validatePasswordMatch(password.value, passwordConfirm.value)) {
                showFieldError(passwordConfirm, 'Şifreler eşleşmiyor');
                isValid = false;
            } else {
                removeFieldError(passwordConfirm);
            }

            return isValid;
        }

        // Password toggle functionality
        function initPasswordToggles() {
            const loginPasswordToggle = document.getElementById('loginPasswordToggle');
            const loginPasswordInput = document.getElementById('loginPassword');
            const passwordToggle = document.getElementById('registerPasswordToggle');
            const passwordInput = document.getElementById('registerPassword');
            const passwordConfirmToggle = document.getElementById('registerPasswordConfirmToggle');
            const passwordConfirmInput = document.getElementById('registerPasswordConfirm');

            if (loginPasswordToggle && loginPasswordInput) {
                loginPasswordToggle.addEventListener('click', (e) => {
                    e.preventDefault();
                    const isPassword = loginPasswordInput.type === 'password';
                    loginPasswordInput.type = isPassword ? 'text' : 'password';
                    const icon = loginPasswordToggle.querySelector('i');
                    if (icon) {
                        icon.className = isPassword ? 'fas fa-eye-slash' : 'fas fa-eye';
                    }
                });
            }

            if (passwordToggle && passwordInput) {
                passwordToggle.addEventListener('click', (e) => {
                    e.preventDefault();
                    const isPassword = passwordInput.type === 'password';
                    passwordInput.type = isPassword ? 'text' : 'password';
                    const icon = passwordToggle.querySelector('i');
                    if (icon) {
                        icon.className = isPassword ? 'fas fa-eye-slash' : 'fas fa-eye';
                    }
                });
            }

            if (passwordConfirmToggle && passwordConfirmInput) {
                passwordConfirmToggle.addEventListener('click', (e) => {
                    e.preventDefault();
                    const isPassword = passwordConfirmInput.type === 'password';
                    passwordConfirmInput.type = isPassword ? 'text' : 'password';
                    const icon = passwordConfirmToggle.querySelector('i');
                    if (icon) {
                        icon.className = isPassword ? 'fas fa-eye-slash' : 'fas fa-eye';
                    }
                });
            }
        }

        // Real-time validation
        if (registerForm) {
            const phoneInput = document.getElementById('registerPhone');
            const firstNameInput = document.getElementById('registerFirstName');
            const lastNameInput = document.getElementById('registerLastName');
            const emailInput = document.getElementById('registerEmail');
            const passwordInput = document.getElementById('registerPassword');
            const passwordConfirmInput = document.getElementById('registerPasswordConfirm');

            if (phoneInput) {
                // Format phone input (remove non-digits, remove 90/+90 prefix, remove leading 0, limit to 10 digits)
                phoneInput.addEventListener('input', (e) => {
                    let value = cleanPhoneNumber(e.target.value);
                    e.target.value = value;
                    // Remove error on input
                    if (phoneInput.classList.contains('error')) {
                        removeFieldError(phoneInput);
                    }
                });
                phoneInput.addEventListener('blur', () => {
                    if (phoneInput.value.trim()) {
                        // Clean and update the value
                        const cleanedValue = cleanPhoneNumber(phoneInput.value);
                        phoneInput.value = cleanedValue;

                        if (!validatePhone(phoneInput.value)) {
                            const cleaned = phoneInput.value.replace(/\D/g, '');
                            if (cleaned.length !== 10) {
                                showFieldError(phoneInput, 'Telefon numarası 10 haneli olmalıdır');
                            } else if (cleaned.startsWith('0')) {
                                showFieldError(phoneInput, 'Telefon numarası 0 ile başlayamaz');
                            } else if (cleaned.startsWith('90')) {
                                showFieldError(phoneInput, 'Telefon numarası 90 ile başlayamaz');
                            } else {
                                showFieldError(phoneInput, 'Geçerli bir telefon numarası giriniz');
                            }
                        } else {
                            removeFieldError(phoneInput);
                        }
                    }
                });
            }

            if (firstNameInput) {
                firstNameInput.addEventListener('blur', () => {
                    if (firstNameInput.value.trim()) {
                        if (!validateFirstName(firstNameInput.value)) {
                            showFieldError(firstNameInput, 'Ad en az 2 karakter olmalıdır');
                        } else {
                            removeFieldError(firstNameInput);
                        }
                    }
                });
                firstNameInput.addEventListener('input', () => {
                    if (firstNameInput.classList.contains('error')) {
                        removeFieldError(firstNameInput);
                    }
                });
            }

            if (lastNameInput) {
                lastNameInput.addEventListener('blur', () => {
                    if (lastNameInput.value.trim()) {
                        if (!validateLastName(lastNameInput.value)) {
                            showFieldError(lastNameInput, 'Soyad en az 2 karakter olmalıdır');
                        } else {
                            removeFieldError(lastNameInput);
                        }
                    }
                });
                lastNameInput.addEventListener('input', () => {
                    if (lastNameInput.classList.contains('error')) {
                        removeFieldError(lastNameInput);
                    }
                });
            }

            if (emailInput) {
                emailInput.addEventListener('blur', () => {
                    if (emailInput.value.trim()) {
                        if (!validateEmail(emailInput.value)) {
                            showFieldError(emailInput, 'Geçerli bir e-posta adresi giriniz');
                        } else {
                            removeFieldError(emailInput);
                        }
                    }
                });
                emailInput.addEventListener('input', () => {
                    if (emailInput.classList.contains('error')) {
                        removeFieldError(emailInput);
                    }
                });
            }

            if (passwordInput) {
                passwordInput.addEventListener('blur', () => {
                    if (passwordInput.value.trim()) {
                        if (!validatePassword(passwordInput.value)) {
                            showFieldError(passwordInput, 'Şifre en az 8 karakter olmalıdır');
                        } else {
                            removeFieldError(passwordInput);
                        }
                    }
                });
                passwordInput.addEventListener('input', () => {
                    if (passwordInput.classList.contains('error')) {
                        removeFieldError(passwordInput);
                    }
                    // Check password match on password change
                    if (passwordConfirmInput && passwordConfirmInput.value.trim()) {
                        if (!validatePasswordMatch(passwordInput.value, passwordConfirmInput.value)) {
                            showFieldError(passwordConfirmInput, 'Şifreler eşleşmiyor');
                        } else {
                            removeFieldError(passwordConfirmInput);
                        }
                    }
                });
            }

            if (passwordConfirmInput) {
                passwordConfirmInput.addEventListener('blur', () => {
                    if (passwordConfirmInput.value.trim()) {
                        if (!validatePasswordMatch(passwordInput.value, passwordConfirmInput.value)) {
                            showFieldError(passwordConfirmInput, 'Şifreler eşleşmiyor');
                        } else {
                            removeFieldError(passwordConfirmInput);
                        }
                    }
                });
                passwordConfirmInput.addEventListener('input', () => {
                    if (passwordConfirmInput.classList.contains('error')) {
                        removeFieldError(passwordConfirmInput);
                    }
                });
            }

            // Initialize password toggles
            initPasswordToggles();
        }

        // Register Form Submit
        if (registerForm) {
            registerForm.addEventListener('submit', async (e) => {
                e.preventDefault();

                if (!validateRegisterForm()) {
                    if (window.ToastManager) {
                        window.showSwalToast('Lütfen tüm alanları doğru şekilde doldurun', 'error');
                    }
                    return;
                }

                let phone = document.getElementById('registerPhone').value;
                phone = cleanPhoneNumber(phone);
                const firstName = document.getElementById('registerFirstName').value.trim();
                const lastName = document.getElementById('registerLastName').value.trim();
                const email = document.getElementById('registerEmail').value.trim();
                const password = document.getElementById('registerPassword').value;
                const companyId = getRegisterCompanyId();
                const submitBtn = registerForm.querySelector('.btn-auth-submit');
                const originalBtnText = submitBtn ? submitBtn.textContent : '';

                const phoneInput = document.getElementById('registerPhone');
                if (phoneInput) phoneInput.value = phone;

                if (submitBtn) {
                    submitBtn.disabled = true;
                    submitBtn.textContent = (window.I18N && window.I18N.t ? window.I18N.t('loading') : 'Kontrol ediliyor...');
                }

                try {
                    const checkRes = await fetch(getSiteRoot() + '/yeppanel/db/ajax/web/register-check-email.php', {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({ email, company_id: companyId, lang: getAjaxLang() }),
                    });
                    const checkData = await checkRes.json();
                    if (!checkData.available) {
                        showSwalToast(checkData.message || 'Bu e-posta bu şubede zaten kayıtlı.', 'error');
                        const emailEl = document.getElementById('registerEmail');
                        if (emailEl) showFieldError(emailEl, checkData.message || '');
                        return;
                    }

                    if (submitBtn) submitBtn.textContent = (window.I18N && window.I18N.t ? window.I18N.t('verify_code_sending') : 'Kod gönderiliyor...');
                    const smsRes = await fetch(getSiteRoot() + '/yeppanel/db/ajax/web/send-sms-code.php', {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({ phone, company_id: companyId, lang: getAjaxLang() }),
                    });
                    const smsData = await smsRes.json();
                    if (!smsData.success) {
                        showSwalToast(smsData.message || 'SMS gönderilemedi.', 'error');
                        return;
                    }

                    const step2Phone = document.getElementById('step2Phone');
                    const step2Email = document.getElementById('step2Email');
                    if (step2Phone) step2Phone.textContent = phone;
                    if (step2Email) step2Email.textContent = email;
                    showRegisterStep2();
                } catch (err) {
                    showSwalToast('Bir hata oluştu. Lütfen tekrar deneyin.', 'error');
                } finally {
                    if (submitBtn) {
                        submitBtn.disabled = false;
                        submitBtn.textContent = originalBtnText;
                    }
                }
            });
        }

        // Back to Step 1 Button
        const backToStep1Btn = document.getElementById('backToStep1');
        if (backToStep1Btn) {
            backToStep1Btn.addEventListener('click', () => {
                showRegisterStep1();
            });
        }

        // Tekrar Kod Gönder (resend code) – üye ol 2. adım
        let registerResendCooldownUntil = 0;
        const resendCodeLink = document.getElementById('resendCode');
        if (resendCodeLink) {
            resendCodeLink.addEventListener('click', async (e) => {
                e.preventDefault();
                if (Date.now() < registerResendCooldownUntil) {
                    const sec = Math.ceil((registerResendCooldownUntil - Date.now()) / 1000);
                    showSwalToast('Lütfen ' + sec + ' saniye sonra tekrar deneyin.', 'warning');
                    return;
                }
                const phoneEl = document.getElementById('registerPhone');
                const phone = phoneEl ? cleanPhoneNumber(phoneEl.value) : '';
                if (!phone || phone.length !== 10) {
                    showSwalToast('Geçerli bir telefon numarası bulunamadı.', 'error');
                    return;
                }
                const companyId = getRegisterCompanyId();
                const linkText = resendCodeLink.textContent;
                resendCodeLink.textContent = (window.I18N && window.I18N.t ? window.I18N.t('loading') : 'Gönderiliyor...');
                resendCodeLink.style.pointerEvents = 'none';
                try {
                    const res = await fetch(getSiteRoot() + '/yeppanel/db/ajax/web/send-sms-code.php', {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({ phone, company_id: companyId, lang: getAjaxLang() }),
                    });
                    const data = await res.json();
                    if (data.success) {
                        showSwalToast(data.message || 'Kod tekrar gönderildi.', 'success');
                        registerResendCooldownUntil = Date.now() + 60000; // 60 sn cooldown
                    } else {
                        showSwalToast(data.message || 'Kod gönderilemedi.', 'error');
                    }
                } catch (err) {
                    showSwalToast('Bir hata oluştu. Lütfen tekrar deneyin.', 'error');
                } finally {
                    resendCodeLink.textContent = linkText;
                    resendCodeLink.style.pointerEvents = '';
                }
            });
        }

        // Verification Code Input Handling
        function initVerificationCode() {
            const codeInputs = document.querySelectorAll('.verification-code-input');
            const fillCodeDigits = (rawDigits, startIndex) => {
                const digits = String(rawDigits || '').replace(/\D/g, '').slice(0, 4);
                if (!digits) return;
                let cursor = startIndex;
                for (let i = 0; i < digits.length && cursor < codeInputs.length; i++) {
                    codeInputs[cursor].value = digits[i];
                    codeInputs[cursor].classList.remove('error', 'success');
                    cursor++;
                }
                const target = codeInputs[Math.min(cursor, codeInputs.length - 1)];
                if (target) target.focus();
            };

            codeInputs.forEach((input, index) => {
                // Only allow numbers
                input.addEventListener('input', (e) => {
                    const clean = e.target.value.replace(/\D/g, '');
                    if (clean.length > 1) {
                        e.target.value = '';
                        fillCodeDigits(clean, index);
                    } else {
                        e.target.value = clean.slice(0, 1);
                    }
                    removeFieldError(e.target);

                    // Auto-focus next input
                    if (e.target.value && index < codeInputs.length - 1) {
                        codeInputs[index + 1].focus();
                    }
                });

                // Handle backspace
                input.addEventListener('keydown', (e) => {
                    if (e.key === 'Backspace' && !e.target.value && index > 0) {
                        codeInputs[index - 1].focus();
                    }
                });

                // Handle paste
                input.addEventListener('paste', (e) => {
                    e.preventDefault();
                    const pastedData = e.clipboardData.getData('text');
                    fillCodeDigits(pastedData, index);
                });
            });
        }

        // Verification Code Submit (kayıt: kod + form verisi register.php'ye gider)
        const verifyCodeBtn = document.getElementById('verifyCodeBtn');
        if (verifyCodeBtn) {
            verifyCodeBtn.addEventListener('click', async (e) => {
                e.preventDefault();

                const registerModalEl = document.getElementById('registerModal');
                const codeInputs = registerModalEl ? registerModalEl.querySelectorAll('.verification-code-input') : document.querySelectorAll('.verification-code-input');
                const code = Array.from(codeInputs).map(input => input.value).join('');

                if (code.length !== 4) {
                    codeInputs.forEach(input => { input.classList.add('error'); });
                    showSwalToast('Lütfen 4 haneli kodu giriniz', 'error');
                    return;
                }

                const phoneEl = document.getElementById('registerPhone');
                const phone = phoneEl ? cleanPhoneNumber(phoneEl.value) : '';
                const email = document.getElementById('registerEmail') ? document.getElementById('registerEmail').value.trim() : '';
                const firstName = document.getElementById('registerFirstName') ? document.getElementById('registerFirstName').value.trim() : '';
                const lastName = document.getElementById('registerLastName') ? document.getElementById('registerLastName').value.trim() : '';
                const password = document.getElementById('registerPassword') ? document.getElementById('registerPassword').value : '';
                const companyId = getRegisterCompanyId();

                verifyCodeBtn.disabled = true;
                const originalText = verifyCodeBtn.textContent;
                verifyCodeBtn.textContent = (window.I18N && window.I18N.t ? window.I18N.t('loading') : 'Doğrulanıyor...');

                try {
                    const res = await fetch(getSiteRoot() + '/yeppanel/db/ajax/web/register.php', {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({
                            email,
                            phone,
                            firstName,
                            lastName,
                            password,
                            code,
                            company_id: companyId,
                            lang: getAjaxLang(),
                        }),
                    });
                    const data = await res.json();
                    const lang = (typeof getAjaxLang === 'function' ? getAjaxLang() : 'tr') || 'tr';
                    const msg = (lang === 'en' && data.message_en) ? data.message_en : (data.message_tr || data.message || '');

                    if (data.success) {
                        codeInputs.forEach(input => { input.classList.remove('error'); input.classList.add('success'); });
                        showSwalToast(msg || 'Kayıt başarıyla tamamlandı!', 'success');
                        (async function autoLoginAfterRegister() {
                            try {
                                const loginRes = await fetch(getSiteRoot() + '/yeppanel/db/ajax/web/login.php', {
                                    method: 'POST',
                                    headers: { 'Content-Type': 'application/json' },
                                    body: JSON.stringify({ email, password, lang: getAjaxLang() }),
                                });
                                const loginData = await loginRes.json();
                                if (loginData.success && loginData.user) {
                                    localStorage.setItem('isLoggedIn', 'true');
                                    localStorage.setItem('userEmail', email);
                                    localStorage.setItem('userId', loginData.user.id || '');
                                    localStorage.setItem('userName', loginData.user.name || loginData.user.firstName || email.split('@')[0]);
                                    localStorage.setItem('userFirstName', loginData.user.firstName || '');
                                    localStorage.setItem('userLastName', loginData.user.lastName || '');
                                    localStorage.setItem('userPhone', loginData.user.phone || '');
                                    try { localStorage.removeItem('guestOrder'); } catch (e) { }
                                    if (typeof updateUIForLoginState === 'function') updateUIForLoginState(true, loginData.user || null);
                                    document.dispatchEvent(new CustomEvent('loginStateChanged', { detail: { isLoggedIn: true } }));
                                    window.location.reload();
                                }
                            } catch (e) { /* ignore */ }
                            closeRegisterModal();
                        })();
                    } else {
                        codeInputs.forEach(input => { input.classList.remove('success'); input.classList.add('error'); });
                        showSwalToast(msg || 'Hatalı kod veya işlem başarısız.', 'error');
                        codeInputs.forEach(input => { input.value = ''; });
                        if (codeInputs[0]) codeInputs[0].focus();
                    }
                } catch (err) {
                    showSwalToast('Bir hata oluştu. Lütfen tekrar deneyin.', 'error');
                } finally {
                    verifyCodeBtn.disabled = false;
                    verifyCodeBtn.textContent = originalText;
                }
            });
        }

        // Initialize verification code inputs when modal opens
        if (registerModal) {
            const observer = new MutationObserver(() => {
                if (registerModal.classList.contains('active')) {
                    initVerificationCode();
                }
            });
            observer.observe(registerModal, { attributes: true, attributeFilter: ['class'] });
            // Initial check
            if (registerModal.classList.contains('active')) {
                initVerificationCode();
            }
        }

        // Login Form Submit
        if (loginForm) {
            loginForm.addEventListener('submit', async (e) => {
                e.preventDefault();

                const email = document.getElementById('loginEmail').value;
                const password = document.getElementById('loginPassword').value;
                const submitBtn = loginForm.querySelector('.btn-auth-submit');

                // Disable submit button during request
                if (submitBtn) {
                    submitBtn.disabled = true;
                    const originalText = submitBtn.textContent;
                    submitBtn.textContent = 'Giriş yapılıyor...';

                    try {
                        const response = await fetch(getSiteRoot() + '/yeppanel/db/ajax/web/login.php', {
                            method: 'POST',
                            headers: { 'Content-Type': 'application/json' },
                            body: JSON.stringify({ email, password, lang: getAjaxLang() })
                        });
                        const data = await response.json();
                        const success = data.success === true;
                        const translations = window.I18N?.getTranslations?.();
                        const lang = window.I18N?.getPreferredLanguage?.() || "tr";
                        const t = (key, fallback) =>
                            translations?.[lang]?.[key] !== undefined ? translations[lang][key] : fallback;

                        if (success) {
                            if (window.Swal && typeof window.Swal.fire === 'function') {
                                await window.Swal.fire({
                                    title: t("login_success_title", "Başarılı!"),
                                    text: t("login_success_message", "Giriş başarıyla yapıldı. Hoş geldiniz!"),
                                    icon: "success",
                                    confirmButtonText: t("back", "Tamam"),
                                    confirmButtonColor: "#8C734B",
                                    timer: 2000,
                                    timerProgressBar: true,
                                    toast: true,
                                    position: "top-end",
                                    showConfirmButton: false,
                                    width: "auto",
                                    padding: "1rem 1.5rem"
                                });
                            }

                            // Save login state to localStorage; misafir alışverişini kapat
                            localStorage.setItem('isLoggedIn', 'true');
                            localStorage.setItem('userEmail', email);
                            if (data.user) {
                                localStorage.setItem('userId', data.user.id || '1');
                                localStorage.setItem('userName', data.user.name || data.user.firstName || email.split('@')[0]);
                                localStorage.setItem('userFirstName', data.user.firstName || '');
                                localStorage.setItem('userLastName', data.user.lastName || '');
                                localStorage.setItem('userPhone', data.user.phone || '');
                            }
                            try { localStorage.removeItem('guestOrder'); } catch (e) { }

                            // Update UI immediately
                            updateUIForLoginState(true, data.user || null);
                            // Global login state event (sipariş sayfası vs. için)
                            document.dispatchEvent(new CustomEvent('loginStateChanged', {
                                detail: { isLoggedIn: true }
                            }));

                            // Close modal
                            closeLoginModal();

                            // Logout ile aynı davranış: mevcut sayfayı yenile.
                            window.location.reload();
                        } else {
                            const errorMessage = data.message || data.message_tr || 'Giriş başarısız. Lütfen tekrar deneyin.';
                            if (window.Swal && typeof window.Swal.fire === 'function') {
                                await window.Swal.fire({
                                    title: t("login_error_title", "Hata"),
                                    text: errorMessage,
                                    icon: "error",
                                    confirmButtonText: t("back", "Tamam"),
                                    confirmButtonColor: "#8C734B",
                                    timer: 3000,
                                    timerProgressBar: true,
                                    toast: true,
                                    position: "top-end",
                                    showConfirmButton: false
                                });
                            }
                        }
                    } catch (error) {
                        // Handle network or other errors
                        console.error('Login error:', error);
                        const translations = window.I18N?.getTranslations?.();
                        const lang = window.I18N?.getPreferredLanguage?.() || "tr";
                        const t = (key, fallback) =>
                            translations?.[lang]?.[key] !== undefined
                                ? translations[lang][key]
                                : fallback;

                        if (window.Swal && typeof window.Swal.fire === 'function') {
                            await window.Swal.fire({
                                title: t("login_error_title", "Hata"),
                                text: t("login_error_message", "Bir hata oluştu. Lütfen tekrar deneyin."),
                                icon: "error",
                                confirmButtonText: t("back", "Tamam"),
                                confirmButtonColor: "#8C734B",
                                timer: 3000,
                                timerProgressBar: true,
                                toast: true,
                                position: "top-end",
                                showConfirmButton: false
                            });
                        }
                    } finally {
                        // Re-enable submit button
                        if (submitBtn) {
                            submitBtn.disabled = false;
                            submitBtn.textContent = originalText || 'Giriş Yap';
                        }
                    }
                }
            });
        }

        // Event Listeners - Use event delegation for dynamically loaded buttons
        function attachAuthButtonListeners() {
            const btnLogin = document.getElementById('btnLogin');
            const btnRegister = document.getElementById('btnRegister');

            if (btnLogin && !btnLogin.dataset.listenerAttached) {
                btnLogin.addEventListener('click', (e) => {
                    e.preventDefault();
                    openLoginModal();
                });
                btnLogin.dataset.listenerAttached = 'true';
            }

            if (btnRegister && !btnRegister.dataset.listenerAttached) {
                btnRegister.addEventListener('click', (e) => {
                    e.preventDefault();
                    openRegisterModal();
                });
                btnRegister.dataset.listenerAttached = 'true';
            }
        }

        // Use event delegation on document for dynamically loaded buttons
        // This ensures buttons work even if they're added to DOM after page load
        document.addEventListener('click', function (e) {
            const target = e.target;
            const btnLogin = document.getElementById('btnLogin');
            const btnRegister = document.getElementById('btnRegister');

            // Desktop login button
            if (btnLogin && (target === btnLogin || btnLogin.contains(target))) {
                e.preventDefault();
                e.stopPropagation();
                openLoginModal();
                return;
            }

            // Desktop register button
            if (btnRegister && (target === btnRegister || btnRegister.contains(target))) {
                e.preventDefault();
                e.stopPropagation();
                openRegisterModal();
                return;
            }
        }, true); // Use capture phase for better reliability

        // Attach listeners immediately (for static buttons)
        attachAuthButtonListeners();

        // Also expose function to re-attach after dynamic content loads
        window.attachAuthButtonListeners = attachAuthButtonListeners;

        if (loginModalClose) {
            loginModalClose.addEventListener('click', closeLoginModal);
        }

        if (registerModalClose) {
            registerModalClose.addEventListener('click', closeRegisterModal);
        }

        // Overlay click disabled - modal only closes via close button or Escape key
        // Removed overlay click to close functionality per user request

        // Close on Escape key
        document.addEventListener('keydown', (e) => {
            if (e.key === 'Escape') {
                if (loginModal && loginModal.classList.contains('active')) {
                    closeLoginModal();
                }
                if (registerModal && registerModal.classList.contains('active')) {
                    closeRegisterModal();
                }
            }
        });

        // Misafir sipariş linki görünürlüğü (şube bazlı guestCheckoutEnabled)
        function updateGuestOrderLinkVisibility() {
            const data = window.HeaderData || {};
            const branches = data?.data?.app?.branches || data?.app?.branches || [];
            const branchId = localStorage.getItem('menuBranchId');
            const branch = branchId && branches.length ? branches.find(function (b) { return String(b.id) === String(branchId); }) : (branches[0] || null);
            const enabled = !!(branch && branch.guestCheckoutEnabled) || (branches.length && branches.some(function (b) { return b.guestCheckoutEnabled; }));
            const wrap = document.getElementById('guestOrderWrap');
            if (wrap) wrap.style.display = enabled ? 'block' : 'none';
        }
        if (document.readyState === 'loading') {
            document.addEventListener('DOMContentLoaded', updateGuestOrderLinkVisibility);
        } else {
            updateGuestOrderLinkVisibility();
        }
        document.addEventListener('headerDataLoaded', updateGuestOrderLinkVisibility);

        // Switch between login and register (delegated for dynamic i18n HTML)
        document.addEventListener('click', (e) => {
            const guestOrderLink = e.target.closest('#guestOrderLink');
            if (guestOrderLink) {
                e.preventDefault();
                try { localStorage.setItem('guestOrder', '1'); } catch (err) { }
                closeLoginModal();
                document.dispatchEvent(new CustomEvent('guestOrderStarted', { detail: {} }));
                return;
            }

            const registerLink = e.target.closest('#switchToRegister');
            if (registerLink) {
                e.preventDefault();
                closeLoginModal();
                setTimeout(() => openRegisterModal(), 200);
                return;
            }

            const loginLink = e.target.closest('#switchToLogin');
            if (loginLink) {
                e.preventDefault();
                closeRegisterModal();
                setTimeout(() => openLoginModal(), 200);
                return;
            }

            const legalLink = e.target.closest('a.legal-link[data-legal], a.order-phone-privacy-link[data-legal]');
            if (legalLink) {
                e.preventDefault();
                const type = legalLink.getAttribute('data-legal') || 'disclosure';
                if (type === 'terms' || type === 'disclosure') openLegalDocModal(type);
            }
        });

        // Mobile dropdown
        const mobileAuthDropdown = document.getElementById('mobileAuthDropdown');
        const mobileAuthTrigger = document.getElementById('mobileAuthTrigger');
        const mobileAuthMenu = document.getElementById('mobileAuthMenu');
        const mobileBtnLogin = document.getElementById('mobileBtnLogin');
        const mobileBtnRegister = document.getElementById('mobileBtnRegister');

        // Mobile dropdown toggle
        if (mobileAuthTrigger && mobileAuthDropdown) {
            mobileAuthTrigger.addEventListener('click', (e) => {
                e.stopPropagation();
                mobileAuthDropdown.classList.toggle('active');
            });

            // Close dropdown when clicking outside
            document.addEventListener('click', (e) => {
                if (!mobileAuthDropdown.contains(e.target) && !mobileAuthTrigger.contains(e.target)) {
                    mobileAuthDropdown.classList.remove('active');
                }
            });
        }

        if (mobileBtnLogin) {
            mobileBtnLogin.addEventListener('click', (e) => {
                e.preventDefault();
                e.stopPropagation();
                if (mobileAuthDropdown) mobileAuthDropdown.classList.remove('active');
                openLoginModal();
            });
        }

        if (mobileBtnRegister) {
            mobileBtnRegister.addEventListener('click', (e) => {
                e.preventDefault();
                e.stopPropagation();
                if (mobileAuthDropdown) mobileAuthDropdown.classList.remove('active');
                openRegisterModal();
            });
        }

        // Mobile menu auth buttons (inside mobile nav)
        const mobileMenuBtnLogin = document.getElementById('mobileMenuBtnLogin');
        const mobileMenuBtnRegister = document.getElementById('mobileMenuBtnRegister');

        if (mobileMenuBtnLogin) {
            mobileMenuBtnLogin.addEventListener('click', (e) => {
                e.preventDefault();
                // Close mobile menu by clicking close button
                const mobileNavClose = document.getElementById('mobileNavClose');
                if (mobileNavClose) {
                    mobileNavClose.click();
                }
                // Also manually close if click doesn't work
                const mobileNav = document.getElementById('mobileNav');
                const mobileMenuBtn = document.getElementById('mobileMenuBtn');
                if (mobileNav && mobileNav.classList.contains('active')) {
                    mobileNav.classList.remove('active');
                    if (mobileMenuBtn) mobileMenuBtn.classList.remove('active');
                    document.body.classList.remove('menu-open');
                }
                // Open login modal
                setTimeout(() => openLoginModal(), 300);
            });
        }

        if (mobileMenuBtnRegister) {
            mobileMenuBtnRegister.addEventListener('click', (e) => {
                e.preventDefault();
                // Close mobile menu by clicking close button
                const mobileNavClose = document.getElementById('mobileNavClose');
                if (mobileNavClose) {
                    mobileNavClose.click();
                }
                // Also manually close if click doesn't work
                const mobileNav = document.getElementById('mobileNav');
                const mobileMenuBtn = document.getElementById('mobileMenuBtn');
                if (mobileNav && mobileNav.classList.contains('active')) {
                    mobileNav.classList.remove('active');
                    if (mobileMenuBtn) mobileMenuBtn.classList.remove('active');
                    document.body.classList.remove('menu-open');
                }
                // Open register modal
                setTimeout(() => openRegisterModal(), 300);
            });
        }

        // User dropdown toggle
        const userBtn = document.getElementById('userBtn');
        const userDropdownMenu = document.getElementById('userDropdownMenu');

        if (userBtn && userDropdownMenu) {
            userBtn.addEventListener('click', (e) => {
                e.stopPropagation();
                const isActive = userDropdownMenu.style.display === 'block';
                userDropdownMenu.style.display = isActive ? 'none' : 'block';

                // Close on outside click
                if (!isActive) {
                    setTimeout(() => {
                        const closeDropdown = (e) => {
                            if (!userBtn.contains(e.target) && !userDropdownMenu.contains(e.target)) {
                                userDropdownMenu.style.display = 'none';
                                document.removeEventListener('click', closeDropdown);
                            }
                        };
                        setTimeout(() => document.addEventListener('click', closeDropdown), 0);
                    }, 0);
                }
            });
        }

        function clearClientLoginStorage() {
            localStorage.removeItem('isLoggedIn');
            localStorage.removeItem('userEmail');
            localStorage.removeItem('userId');
            localStorage.removeItem('userName');
            localStorage.removeItem('userFirstName');
            localStorage.removeItem('userLastName');
            localStorage.removeItem('userPhone');
        }

        function getSessionUserFromWindow() {
            const sessionUser = window.__yepSessionUser;
            if (!sessionUser || typeof sessionUser !== 'object') {
                return null;
            }
            const sessionUserId = Number(sessionUser.id || 0);
            if (!Number.isFinite(sessionUserId) || sessionUserId <= 0) {
                return null;
            }
            return sessionUser;
        }

        function persistClientUser(userData) {
            if (!userData || typeof userData !== 'object') {
                return;
            }
            localStorage.setItem('isLoggedIn', 'true');
            localStorage.setItem('userId', String(userData.id || ''));
            localStorage.setItem('userEmail', String(userData.email || ''));
            localStorage.setItem('userName', String(userData.name || userData.firstName || 'Müşteri'));
            localStorage.setItem('userFirstName', String(userData.firstName || ''));
            localStorage.setItem('userLastName', String(userData.lastName || ''));
            localStorage.setItem('userPhone', String(userData.phone || ''));
        }

        async function resolveServerLoginState() {
            if (isTahmisciBackendCatalogMode()) {
                clearClientLoginStorage();
                return { isLoggedIn: false, user: null };
            }
            const sessionUser = getSessionUserFromWindow();
            if (sessionUser) {
                persistClientUser(sessionUser);
                return { isLoggedIn: true, user: sessionUser };
            }

            try {
                const response = await fetch(getSiteRoot() + '/yeppanel/db/ajax/web/user-profile.php', {
                    method: 'GET',
                    credentials: 'same-origin',
                    cache: 'no-store'
                });
                if (!response.ok) {
                    return { isLoggedIn: false, user: null };
                }
                const payload = await response.json();
                if (payload && payload.success === true && payload.user && Number(payload.user.id || 0) > 0) {
                    persistClientUser(payload.user);
                    return { isLoggedIn: true, user: payload.user };
                }
                return { isLoggedIn: false, user: null };
            } catch (error) {
                return { isLoggedIn: false, user: null };
            }
        }

        // Logout button handler (Desktop & Mobile)
        const handleLogout = async (e) => {
            e.preventDefault();
            e.stopPropagation();
            // Clear login state
            clearClientLoginStorage();
            window.__yepSessionUser = null;
            // Update UI
            updateUIForLoginState(false);
            // Global login state event
            document.dispatchEvent(new CustomEvent('loginStateChanged', {
                detail: { isLoggedIn: false }
            }));
            // Close mobile nav if open
            const mobileNav = document.getElementById('mobileNav');
            if (mobileNav) {
                mobileNav.classList.remove('active');
            }
            const mobileMenuBtn = document.getElementById('mobileMenuBtn');
            if (mobileMenuBtn) {
                mobileMenuBtn.classList.remove('active');
            }
            // Server session temizliği: sayfa değiştirmeden logout endpointini çağır.
            try {
                await fetch(getSiteRoot() + '/cikis.php?ajax=1', {
                    method: 'GET',
                    credentials: 'same-origin',
                    cache: 'no-store',
                    headers: {
                        'X-Requested-With': 'XMLHttpRequest',
                        'Accept': 'application/json'
                    }
                });
            } catch (error) {
                // Ağ hatasında da aynı sayfada kalıp mevcut state ile devam ederiz.
            }

            // Header + session bağımlı sayfa bölümlerinin doğru yüklenmesi için aynı sayfayı yenile.
            window.location.reload();
        };

        // Use event delegation for logout buttons (they may be dynamically added)
        document.addEventListener('click', (e) => {
            const logoutBtn = e.target.closest('#logoutBtn');
            const mobileLogoutBtn = e.target.closest('#mobileLogoutBtn');

            if (logoutBtn || mobileLogoutBtn) {
                handleLogout(e);
            }
        });

        // Also attach directly if elements exist (for immediate binding)
        const logoutBtn = document.getElementById('logoutBtn');
        const mobileLogoutBtn = document.getElementById('mobileLogoutBtn');

        if (logoutBtn) {
            logoutBtn.addEventListener('click', handleLogout);
        }
        if (mobileLogoutBtn) {
            mobileLogoutBtn.addEventListener('click', handleLogout);
        }

        // Expose functions globally
        // Function to update UI based on login state
        function updateUIForLoginState(isLoggedIn, userData) {
            const authButtons = document.getElementById('authButtons');
            const userMenu = document.getElementById('userMenu');
            const mobileAuth = document.getElementById('mobileAuth');
            const mobileUserInfo = document.getElementById('mobileUserInfo');

            if (isLoggedIn) {
                const activeUser = (userData && typeof userData === 'object')
                    ? userData
                    : (getSessionUserFromWindow() || {
                        id: localStorage.getItem('userId') || '',
                        email: localStorage.getItem('userEmail') || '',
                        name: localStorage.getItem('userName') || 'Müşteri',
                        firstName: localStorage.getItem('userFirstName') || '',
                        lastName: localStorage.getItem('userLastName') || '',
                        phone: localStorage.getItem('userPhone') || ''
                    });
                persistClientUser(activeUser);
                if (!getSessionUserFromWindow()) {
                    window.__yepSessionUser = activeUser;
                }

                // Hide auth buttons, show user menu (always hidden on mobile via CSS)
                if (authButtons) {
                    authButtons.style.setProperty('display', 'none', 'important');
                }
                if (userMenu) {
                    userMenu.style.setProperty('display', 'flex', 'important');
                }
                // Hide mobile auth section when logged in (mobile nav)
                if (mobileAuth) {
                    mobileAuth.style.setProperty('display', 'none', 'important');
                }
                if (mobileUserInfo) {
                    mobileUserInfo.style.setProperty('display', 'block', 'important');
                }

                // Show mobile account nav content
                const mobileNavAccountContent = document.querySelector('.mobile-nav-account-content');
                if (mobileNavAccountContent) {
                    mobileNavAccountContent.style.setProperty('display', 'block', 'important');
                }

                // Show mobile profile menu, hide welcome
                const mobileUserMenu = document.getElementById('mobileUserMenu');
                const mobileUserWelcome = document.getElementById('mobileUserWelcome');
                if (mobileUserMenu) {
                    mobileUserMenu.style.display = 'flex';
                }
                if (mobileUserWelcome) {
                    mobileUserWelcome.style.display = 'none';
                }

                // Update display text: sadece name (ad), en fazla 10 karakter
                const userNameDisplay = document.getElementById('userNameDisplay');
                const userAvatar = document.getElementById('userAvatar');
                const userEmail = String(activeUser.email || '');
                const userFirstName = String(activeUser.firstName || '');
                const userName = String(activeUser.name || (userEmail ? userEmail.split('@')[0] : 'Müşteri'));
                const namePart = (userFirstName && userFirstName.trim()) ? userFirstName.trim() : (userName.trim().split(/\s+/)[0] || userName);
                const displayName = namePart.length > 10 ? namePart.substring(0, 10) : namePart;

                if (userNameDisplay) {
                    userNameDisplay.textContent = displayName;
                }
                // Header avatar: ikon yerine ad soyad baş harfleri (AÇ, YEP)
                if (userAvatar && (userName !== 'Müşteri' && userName)) {
                    const words = userName.trim().split(/\s+/).filter(Boolean);
                    const initials = words.slice(0, 3).map((w) => (w.charAt(0) || '')).join('').toUpperCase();
                    if (initials) {
                        userAvatar.innerHTML = '<span class="profile-menu-avatar-initials">' + initials + '</span>';
                    } else {
                        userAvatar.innerHTML = '<i class="fas fa-user"></i>';
                    }
                } else if (userAvatar) {
                    userAvatar.innerHTML = '<i class="fas fa-user"></i>';
                }
            } else {
                // Show auth buttons, hide user menu
                if (authButtons) {
                    // Only show on desktop (not mobile) - CSS already hides on mobile with !important
                    const isMobile = window.innerWidth < 992;
                    if (!isMobile) {
                        authButtons.style.setProperty('display', 'flex', 'important');
                    } else {
                        authButtons.style.setProperty('display', 'none', 'important');
                    }
                }
                if (userMenu) {
                    userMenu.style.setProperty('display', 'none', 'important');
                }
                const userAvatar = document.getElementById('userAvatar');
                if (userAvatar) {
                    userAvatar.innerHTML = '<i class="fas fa-user"></i>';
                }
                // Show mobile auth section when logged out (mobile nav)
                if (mobileAuth) {
                    mobileAuth.style.setProperty('display', 'flex', 'important');
                }
                if (mobileUserInfo) {
                    mobileUserInfo.style.setProperty('display', 'none', 'important');
                }

                // Hide mobile account nav content
                const mobileNavAccountContent = document.querySelector('.mobile-nav-account-content');
                if (mobileNavAccountContent) {
                    mobileNavAccountContent.style.setProperty('display', 'none', 'important');
                }

                // Hide mobile profile menu, show welcome
                const mobileUserMenu = document.getElementById('mobileUserMenu');
                const mobileUserWelcome = document.getElementById('mobileUserWelcome');
                if (mobileUserMenu) {
                    mobileUserMenu.style.display = 'none';
                }
                if (mobileUserWelcome) {
                    mobileUserWelcome.style.display = 'none';
                }
                window.__yepSessionUser = null;
                clearClientLoginStorage();
            }
        }

        // Oturum durumu her sayfa yüklemede server session üzerinden doğrulanır.
        resolveServerLoginState().then((state) => {
            if (!state.isLoggedIn) {
                clearClientLoginStorage();
                window.__yepSessionUser = null;
            }
            updateUIForLoginState(state.isLoggedIn, state.user);
        });

        window.openLoginModal = openLoginModal;
        window.closeLoginModal = closeLoginModal;
        window.openRegisterModal = openRegisterModal;
        window.closeRegisterModal = closeRegisterModal;
        window.openLegalDocModal = openLegalDocModal;
        window.closeLegalDocModal = closeLegalDocModal;
        window.updateUIForLoginState = updateUIForLoginState;
    }

    // Initialize when DOM is ready
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', initAuthModal);
    } else {
        // DOM is already ready
        initAuthModal();
    }
})();
