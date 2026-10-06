(function() {
        var s = document.createElement('script');
        s.id = "script@app";
        s.src = "/static/assets/app/main.min.js";
        s.onload = function() {
            setTimeout(function() {
                if (window.StyleCore) {
                    window.StyleCore.initSettings();
                }
            }, 100);
        };
        document.body.appendChild(s);
    })();
