(function () {
    'use strict';

    var root = document.documentElement;
    var mobileMenu = document.getElementById('mobile-menu');
    var mobileMenuButton = document.getElementById('mobile-menu-button');
    var mobileMenuClose = document.getElementById('mobile-menu-close');
    var menuLinks = document.querySelectorAll('[data-menu-link]');

    function setMenuOpen(open) {
        if (!mobileMenu || !mobileMenuButton) return;
        mobileMenu.classList.toggle('hidden', !open);
        mobileMenuButton.setAttribute('aria-expanded', String(open));
        document.body.style.overflow = open ? 'hidden' : '';
    }

    if (mobileMenuButton) {
        mobileMenuButton.setAttribute('aria-expanded', 'false');
        mobileMenuButton.addEventListener('click', function () {
            setMenuOpen(mobileMenu.classList.contains('hidden'));
        });
    }

    if (mobileMenuClose) {
        mobileMenuClose.addEventListener('click', function () {
            setMenuOpen(false);
        });
    }

    Array.prototype.forEach.call(menuLinks, function (link) {
        link.addEventListener('click', function () {
            setMenuOpen(false);
        });
    });

    if (mobileMenu) {
        mobileMenu.addEventListener('click', function (event) {
            if (event.target === mobileMenu) setMenuOpen(false);
        });
    }

    document.addEventListener('keydown', function (event) {
        if (event.key === 'Escape' && mobileMenu && !mobileMenu.classList.contains('hidden')) {
            setMenuOpen(false);
        }
    });

    function applyTheme(isDark) {
        root.classList.toggle('dark', isDark);
        localStorage.setItem('color-theme', isDark ? 'dark' : 'light');
    }

    var themeButtons = document.querySelectorAll('[data-theme-toggle]');
    Array.prototype.forEach.call(themeButtons, function (button) {
        button.addEventListener('click', function () {
            applyTheme(!root.classList.contains('dark'));
            if (mobileMenu && !mobileMenu.classList.contains('hidden')) setMenuOpen(false);
        });
    });

    var timeElements = document.querySelectorAll('#local-time, #mobile-local-time');
    if (timeElements.length) {
        var updateLocalTime = function () {
            var time = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
            Array.prototype.forEach.call(timeElements, function (element) {
                element.textContent = time;
            });
        };
        updateLocalTime();
        window.setInterval(updateLocalTime, 1000);
    }
})();
