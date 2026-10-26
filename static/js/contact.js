(function () {
    'use strict';

    var button = document.getElementById('copy-wechat');
    if (!button) return;

    var hint = button.querySelector('[data-copy-hint]');
    var restLabel = hint ? hint.textContent : '';
    var timer = null;

    function flash(message) {
        if (!hint) return;
        hint.textContent = message;
        hint.classList.add('is-done');
        window.clearTimeout(timer);
        timer = window.setTimeout(function () {
            hint.textContent = restLabel;
            hint.classList.remove('is-done');
        }, 1600);
    }

    function legacyCopy(value) {
        var field = document.createElement('textarea');
        field.value = value;
        field.setAttribute('readonly', '');
        field.style.position = 'fixed';
        field.style.top = '-1000px';
        document.body.appendChild(field);
        field.select();
        var ok = false;
        try {
            ok = document.execCommand('copy');
        } catch (error) {
            ok = false;
        }
        document.body.removeChild(field);
        flash(ok ? '已复制' : '复制失败');
    }

    button.addEventListener('click', function () {
        var value = button.getAttribute('data-wechat') || '';
        if (navigator.clipboard && window.isSecureContext) {
            navigator.clipboard.writeText(value).then(function () {
                flash('已复制');
            }, function () {
                legacyCopy(value);
            });
            return;
        }
        legacyCopy(value);
    });
})();
