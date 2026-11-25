// Applies the reader's chosen appearance (light or dark) before the page is drawn, so there is no flash.
// With no choice saved, the page follows the device setting through CSS alone. Nothing is sent anywhere.
try { var t = localStorage.getItem('uo.theme'); if (t === 'dark' || t === 'light') document.documentElement.setAttribute('data-theme', t); } catch (e) { /* storage unavailable: follow the device */ }
