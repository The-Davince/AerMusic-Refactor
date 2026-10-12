(function() {
        var s = document.createElement('script');
        s.id = "script@app";
        s.src = "/static/assets/app/main.min.js";
        s.onload = function() {
            waitForSettings(function() {
                window.StyleCore.initSettings();
            });
        };
        function waitForSettings(callback) {
            if (window.StyleCore && window.AerSettingsUI) {
                callback();
            } else {
                setTimeout(function() { waitForSettings(callback); }, 100);
            }
        }
        document.body.appendChild(s);
    })();
